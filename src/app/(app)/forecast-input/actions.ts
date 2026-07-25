"use server";

import { auth } from "@/auth";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { getAccessibleVendorIds, assertVendorAccess } from "@/lib/scope";
import { getFiscalContext } from "@/lib/fiscal";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as XLSX from "xlsx";
import { parseTDSynnexCrmExcel } from "@/lib/crm/tdsynnex-parser";

const submitForecastSchema = z.object({
  revenue: z.number().min(0, "Revenue değeri sıfırdan küçük olamaz."),
  gp: z.number().min(0, "GP değeri sıfırdan küçük olamaz."),
  note: z.string().optional(),
});

const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;
const SKIP_FORECAST_SHEET_VALUE = "__skip__";

const forecastSheetMappingSchema = z.array(
  z.object({
    sheetName: z.string().min(1),
    vendorId: z.string().min(1),
  })
);

function getErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;

  if (/ECMA-376 Encrypted file|EncryptionInfo|encrypted/i.test(error.message)) {
    return "Excel dosyası şifreli, korumalı veya bozuk görünüyor. Lütfen dosyayı Excel'de açıp şifresiz/korumasız yeni bir XLSX olarak kaydedin ve tekrar yükleyin.";
  }

  return error.message;
}

function calculateGpPercent(revenue: number, gp: number) {
  return revenue > 0 ? (gp / revenue) * 100 : 0;
}

function normalizeLookupValue(value: string) {
  return value
    .trim()
    .replace(/[ıİ]/g, "i")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[şŞ]/g, "s")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveLookupValue<T extends { id: string }>(lookup: Map<string, T>, rawValue: string) {
  const normalizedValue = normalizeLookupValue(rawValue);
  const exactMatch = lookup.get(normalizedValue);

  if (exactMatch) {
    return exactMatch;
  }

  const candidates = Array.from(lookup.entries())
    .filter(([key]) => key.includes(normalizedValue))
    .map(([, value]) => value);
  const uniqueCandidates = Array.from(
    new Map(candidates.map((candidate) => [candidate.id, candidate])).values()
  );

  return uniqueCandidates.length === 1 ? uniqueCandidates[0] : null;
}

function parseImportNumber(value: unknown, fieldName: string, sheetName: string, cellAddress: string) {
  const text = value === undefined || value === null ? "" : String(value).trim();

  if (!text || /^[-—–]+$/.test(text)) {
    return 0;
  }

  const withoutCurrency = text
    .replace(/\((.*)\)/, "-$1")
    .replace(/[$€£₺]/g, "")
    .replace(/\s/g, "");
  const lastComma = withoutCurrency.lastIndexOf(",");
  const lastDot = withoutCurrency.lastIndexOf(".");
  let normalized = withoutCurrency;

  if (lastComma > -1 && lastDot > -1) {
    normalized =
      lastComma > lastDot
        ? withoutCurrency.replace(/\./g, "").replace(",", ".")
        : withoutCurrency.replace(/,/g, "");
  } else if (lastComma > -1) {
    const fractionLength = withoutCurrency.length - lastComma - 1;
    normalized =
      fractionLength === 3
        ? withoutCurrency.replace(/,/g, "")
        : withoutCurrency.replace(",", ".");
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${sheetName} sheet'indeki ${cellAddress} hücresinde ${fieldName} değeri geçerli değil: "${text}".`);
  }

  return parsed;
}

function getImportFile(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { file: null, error: "Yüklenecek dosya bulunamadı." };
  }

  if (!file.name.match(/\.(xls|xlsx|xlsb)$/i)) {
    return { file: null, error: "Lütfen .xls, .xlsx veya .xlsb uzantılı bir dosya seçiniz." };
  }

  if (file.size > MAX_IMPORT_FILE_SIZE) {
    return { file: null, error: "Dosya boyutu en fazla 5 MB olabilir." };
  }

  return { file, error: null };
}

async function readWorkbookFromFile(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return XLSX.read(buffer, { type: "buffer", cellDates: false });
}

async function getAccessibleVendorLookup(user: { id: string; role: string }) {
  const accessibleVendorIds = await getAccessibleVendorIds(user);
  const vendors = await prisma.vendor.findMany({
    where: {
      id: { in: accessibleVendorIds },
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      code: true,
      aliases: {
        select: {
          alias: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const vendorLookup = new Map<string, { id: string; name: string }>();
  for (const vendor of vendors) {
    const lookupValue = { id: vendor.id, name: vendor.name };
    vendorLookup.set(normalizeLookupValue(vendor.name), lookupValue);
    if (vendor.code) {
      vendorLookup.set(normalizeLookupValue(vendor.code), lookupValue);
    }
    for (const alias of vendor.aliases) {
      vendorLookup.set(normalizeLookupValue(alias.alias), lookupValue);
    }
  }

  return {
    vendors: vendors.map((vendor) => ({ id: vendor.id, name: vendor.name })),
    vendorLookup,
    accessibleVendorIds,
  };
}

function assertCurrentFiscalPeriod(fiscalYear: number, quarter: number) {
  const currentContext = getFiscalContext(new Date());

  if (currentContext.fiscalYear !== fiscalYear || currentContext.quarter !== quarter) {
    throw new Error(
      `Forecast yalnızca aktif çeyrek için girilebilir. Aktif dönem FY${currentContext.fiscalYear} - Q${currentContext.quarter}, aktif hafta ${currentContext.weekInQuarter}. hafta.`
    );
  }

  return currentContext.weekInQuarter;
}

async function writeActiveForecast(
  tx: Prisma.TransactionClient,
  input: {
    vendorId: string;
    fiscalPeriodId: string;
    weekNumber: number;
    revenue: number;
    gp: number;
    note?: string | null;
    submittedById: string;
  }
) {
  const previousActive = await tx.forecast.findFirst({
    where: {
      vendorId: input.vendorId,
      fiscalPeriodId: input.fiscalPeriodId,
      isActive: true,
    },
  });

  const existingWeekForecast = await tx.forecast.findFirst({
    where: {
      vendorId: input.vendorId,
      fiscalPeriodId: input.fiscalPeriodId,
      weekNumber: input.weekNumber,
    },
  });

  await tx.forecast.updateMany({
    where: {
      vendorId: input.vendorId,
      fiscalPeriodId: input.fiscalPeriodId,
      ...(existingWeekForecast ? { id: { not: existingWeekForecast.id } } : {}),
    },
    data: {
      isActive: false,
    },
  });

  const forecast = existingWeekForecast
    ? await tx.forecast.update({
        where: { id: existingWeekForecast.id },
        data: {
          revenue: input.revenue,
          gp: input.gp,
          note: input.note !== undefined ? input.note : existingWeekForecast.note,
          submittedById: input.submittedById,
          isActive: true,
        },
      })
    : await tx.forecast.create({
        data: {
          vendorId: input.vendorId,
          fiscalPeriodId: input.fiscalPeriodId,
          weekNumber: input.weekNumber,
          revenue: input.revenue,
          gp: input.gp,
          note: input.note ?? null,
          submittedById: input.submittedById,
          isActive: true,
        },
      });

  return {
    forecast,
    previousActive,
    wasUpdate: Boolean(previousActive && previousActive.weekNumber === input.weekNumber),
  };
}

export async function getActiveForecasts(fiscalYear: number, quarter: number, selectedWeekNumber?: number) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  const currentContext = getFiscalContext(new Date());
  const isCurrentFiscalPeriod = currentContext.fiscalYear === fiscalYear && currentContext.quarter === quarter;
  const targetWeek = selectedWeekNumber && selectedWeekNumber >= 1 && selectedWeekNumber <= 13
    ? selectedWeekNumber
    : (isCurrentFiscalPeriod ? currentContext.weekInQuarter : undefined);

  const activeBacklogWeekNumber = targetWeek ?? currentContext.weekInQuarter;
  const accessibleVendorIds = await getAccessibleVendorIds(session.user);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  const vendors = await prisma.vendor.findMany({
    where: {
      id: { in: accessibleVendorIds },
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      managerId: true,
      manager: {
        select: {
          name: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const forecasts = await prisma.forecast.findMany({
    where: {
      vendorId: { in: accessibleVendorIds },
      fiscalPeriodId: period.id,
      ...(targetWeek ? { weekNumber: targetWeek } : { isActive: true }),
    },
  });
  const forecastMap = new Map(forecasts.map((forecast) => [forecast.vendorId, forecast]));

  const [targets, actuals] = await Promise.all([
    prisma.target.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: period.id,
      },
    }),
    prisma.actual.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: period.id,
        weekNumber: activeBacklogWeekNumber,
      },
    }),
  ]);
  const targetMap = new Map(targets.map((target) => [target.vendorId, target]));
  const actualMap = new Map(actuals.map((actual) => [actual.vendorId, actual]));

  const latestForecast = await prisma.forecast.findFirst({
    where: {
      vendorId: { in: accessibleVendorIds },
      fiscalPeriodId: period.id,
    },
    orderBy: { updatedAt: "desc" },
    select: { weekNumber: true, updatedAt: true },
  });

  const rows = vendors.map((vendor) => {
    const forecast = forecastMap.get(vendor.id);
    const target = targetMap.get(vendor.id);
    const actual = actualMap.get(vendor.id);
    const forecastRevenue = forecast ? Number(forecast.revenue) : 0;
    const forecastGp = forecast ? Number(forecast.gp) : 0;
    const targetRevenue = target ? Number(target.revenue) : 0;
    const targetGp = target ? Number(target.gp) : 0;
    const backlogRevenue = actual ? Number(actual.backlog) : 0;

    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      managerId: vendor.managerId,
      managerName: vendor.manager?.name ?? null,
      targetRevenue,
      targetGp,
      targetGpPercent: calculateGpPercent(targetRevenue, targetGp),
      revenue: forecastRevenue,
      gp: forecastGp,
      gpPercent: calculateGpPercent(forecastRevenue, forecastGp),
      revenueAchievement: targetRevenue > 0 ? (forecastRevenue / targetRevenue) * 100 : 0,
      gpAchievement: targetGp > 0 ? (forecastGp / targetGp) * 100 : 0,
      weekNumber: forecast?.weekNumber ?? targetWeek ?? null,
      submittedAt: forecast?.updatedAt ?? null,
      note: forecast?.note ?? null,
      hasForecast: Boolean(forecast),
      hasTarget: Boolean(target),
      backlogRevenue,
      backlogWeekNumber: activeBacklogWeekNumber,
      hasBacklog: Boolean(actual),
      isBelowBacklog: Boolean(forecast && actual && forecastRevenue < backlogRevenue),
      isPeriodLocked: period.isLocked,
    };
  });

  return {
    rows,
    latestUploadWeekNumber: latestForecast?.weekNumber ?? null,
    latestUploadAt: latestForecast?.updatedAt ?? null,
  };
}

export async function getForecastVersions(vendorId: string, fiscalYear: number, quarter: number) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  await assertVendorAccess(session.user, vendorId);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  const versions = await prisma.forecast.findMany({
    where: {
      vendorId,
      fiscalPeriodId: period.id,
    },
    orderBy: [
      { weekNumber: "asc" },
      { updatedAt: "desc" },
    ],
    select: {
      id: true,
      weekNumber: true,
      revenue: true,
      gp: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      submittedBy: {
        select: {
          name: true,
        },
      },
    },
  });

  return versions.map((version) => {
    const revenue = Number(version.revenue);
    const gp = Number(version.gp);

    return {
      id: version.id,
      weekNumber: version.weekNumber,
      revenue,
      gp,
      gpPercent: calculateGpPercent(revenue, gp),
      isActive: version.isActive,
      submittedAt: version.updatedAt,
      createdAt: version.createdAt,
      submittedByName: version.submittedBy.name,
    };
  });
}

export async function submitForecast(
  vendorId: string,
  fiscalYear: number,
  quarter: number,
  revenueInput: number,
  gpInput: number,
  targetWeekNumber?: number,
  noteInput?: string
) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "Oturum açık değil." };
  }

  try {
    await assertVendorAccess(session.user, vendorId);
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "Vendor yetkisi doğrulanamadı.") };
  }

  const validation = submitForecastSchema.safeParse({ revenue: revenueInput, gp: gpInput, note: noteInput });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { revenue, gp, note } = validation.data;
  let weekNumber: number;
  if (targetWeekNumber && targetWeekNumber >= 1 && targetWeekNumber <= 13) {
    weekNumber = targetWeekNumber;
  } else {
    try {
      weekNumber = assertCurrentFiscalPeriod(fiscalYear, quarter);
    } catch (err: unknown) {
      return { success: false, error: getErrorMessage(err, "Seçilen dönem aktif forecast döneminde değil.") };
    }
  }

  try {
    const period = await ensureFiscalPeriod(fiscalYear, quarter);
    if (period.isLocked) {
      return {
        success: false,
        error: "Seçilen çeyrek kilitlenmiş durumdadır. Kilitli dönemler üzerinde forecast girilemez.",
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      const { forecast, previousActive, wasUpdate } = await writeActiveForecast(tx, {
          vendorId,
          fiscalPeriodId: period.id,
          weekNumber,
          revenue,
          gp,
          note,
          submittedById: session.user.id,
        });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "FORECAST_SUBMIT",
          entityType: "Forecast",
          entityId: forecast.id,
          oldValue: previousActive
            ? {
                id: previousActive.id,
                weekNumber: previousActive.weekNumber,
                revenue: Number(previousActive.revenue),
                gp: Number(previousActive.gp),
                isActive: previousActive.isActive,
              }
            : Prisma.JsonNull,
          newValue: {
            id: forecast.id,
            weekNumber: forecast.weekNumber,
            revenue: Number(forecast.revenue),
            gp: Number(forecast.gp),
            isActive: forecast.isActive,
          },
        },
      });

      return {
        forecast,
        wasUpdate,
      };
    });

    revalidatePath("/forecast-input");

    return {
      success: true,
      weekNumber,
      updatedExistingWeek: result.wasUpdate,
    };
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "Forecast kaydedilirken hata oluştu.") };
  }
}

export async function copyPreviousWeekForecastsForManager(
  managerId: string | null,
  fiscalYear: number,
  quarter: number
) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "Oturum açık değil." };
  }

  let weekNumber: number;
  try {
    weekNumber = assertCurrentFiscalPeriod(fiscalYear, quarter);
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "Seçilen dönem aktif forecast döneminde değil.") };
  }

  if (weekNumber <= 1) {
    return { success: false, error: "Bu çeyreğin ilk haftasında kopyalanacak önceki hafta forecast'i bulunmaz." };
  }

  try {
    const accessibleVendorIds = await getAccessibleVendorIds(session.user);
    const period = await ensureFiscalPeriod(fiscalYear, quarter);

    if (period.isLocked) {
      return {
        success: false,
        error: "Seçilen çeyrek kilitlenmiş durumdadır. Kilitli dönemler üzerinde forecast kopyalanamaz.",
      };
    }

    const vendors = await prisma.vendor.findMany({
      where: {
        id: { in: accessibleVendorIds },
        isActive: true,
        managerId,
      },
      select: {
        id: true,
      },
    });

    const vendorIds = vendors.map((vendor) => vendor.id);
    if (vendorIds.length === 0) {
      return { success: false, error: "Bu satış müdürü için kopyalanacak marka bulunamadı." };
    }

    const previousWeekNumber = weekNumber - 1;
    const previousForecasts = await prisma.forecast.findMany({
      where: {
        vendorId: { in: vendorIds },
        fiscalPeriodId: period.id,
        weekNumber: previousWeekNumber,
      },
      select: {
        vendorId: true,
        revenue: true,
        gp: true,
      },
    });

    if (previousForecasts.length === 0) {
      return {
        success: false,
        error: `${previousWeekNumber}. haftada bu satış müdürüne ait forecast bulunamadı.`,
      };
    }

    await prisma.$transaction(async (tx) => {
      for (const previousForecast of previousForecasts) {
        const { forecast, previousActive } = await writeActiveForecast(tx, {
          vendorId: previousForecast.vendorId,
          fiscalPeriodId: period.id,
          weekNumber,
          revenue: Number(previousForecast.revenue),
          gp: Number(previousForecast.gp),
          submittedById: session.user.id,
        });

        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: "FORECAST_COPY_PREVIOUS_WEEK",
            entityType: "Forecast",
            entityId: forecast.id,
            oldValue: previousActive
              ? {
                  id: previousActive.id,
                  weekNumber: previousActive.weekNumber,
                  revenue: Number(previousActive.revenue),
                  gp: Number(previousActive.gp),
                  isActive: previousActive.isActive,
                }
              : Prisma.JsonNull,
            newValue: {
              id: forecast.id,
              sourceWeekNumber: previousWeekNumber,
              weekNumber: forecast.weekNumber,
              revenue: Number(forecast.revenue),
              gp: Number(forecast.gp),
              isActive: forecast.isActive,
            },
          },
        });
      }
    });

    revalidatePath("/forecast-input");
    return {
      success: true,
      copiedCount: previousForecasts.length,
      skippedCount: vendorIds.length - previousForecasts.length,
      previousWeekNumber,
      weekNumber,
    };
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "Önceki hafta forecast'i kopyalanırken hata oluştu.") };
  }
}

export async function inspectForecastWorkbook(formData: FormData) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "Oturum açık değil." };
  }

  const { file, error } = getImportFile(formData);
  if (!file) {
    return { success: false, error };
  }

  try {
    const workbook = await readWorkbookFromFile(file);
    const sheetNames = workbook.SheetNames.filter((sheetName) => sheetName.trim());

    if (sheetNames.length === 0) {
      return { success: false, error: "Excel dosyasında okunabilir sheet bulunamadı." };
    }

    const { vendors, vendorLookup } = await getAccessibleVendorLookup(session.user);
    const unmatchedSheets = sheetNames.filter((sheetName) => !resolveLookupValue(vendorLookup, sheetName));

    return {
      success: true,
      sheetCount: sheetNames.length,
      matchedCount: sheetNames.length - unmatchedSheets.length,
      unmatchedSheets,
      vendors,
    };
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "Excel dosyası okunurken hata oluştu.") };
  }
}

export async function importForecastFromXls(
  formData: FormData,
  fiscalYear: number,
  quarter: number,
  targetWeekNumber?: number
) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "Oturum açık değil." };
  }

  const { file, error } = getImportFile(formData);
  if (!file) {
    return { success: false, error };
  }

  const rawMappings = formData.get("mappings");
  let parsedMappings: unknown = [];
  try {
    parsedMappings = rawMappings ? JSON.parse(String(rawMappings)) : [];
  } catch {
    return { success: false, error: "Sheet/marka eşleştirmeleri okunamadı." };
  }

  const mappingsValidation = forecastSheetMappingSchema.safeParse(parsedMappings);

  if (!mappingsValidation.success) {
    return { success: false, error: "Sheet/marka eşleştirmeleri okunamadı." };
  }

  let weekNumber: number;
  if (targetWeekNumber && targetWeekNumber >= 1 && targetWeekNumber <= 13) {
    weekNumber = targetWeekNumber;
  } else {
    try {
      weekNumber = assertCurrentFiscalPeriod(fiscalYear, quarter);
    } catch (err: unknown) {
      return { success: false, error: getErrorMessage(err, "Seçilen dönem aktif forecast döneminde değil.") };
    }
  }

  try {
    const period = await ensureFiscalPeriod(fiscalYear, quarter);
    if (period.isLocked) {
      return {
        success: false,
        error: "Seçilen çeyrek kilitlenmiş durumdadır. Kilitli dönemler üzerinde forecast yüklemesi yapılamaz.",
      };
    }

    const workbook = await readWorkbookFromFile(file);
    const sheetNames = workbook.SheetNames.filter((sheetName) => sheetName.trim());

    if (sheetNames.length === 0) {
      return { success: false, error: "Excel dosyasında okunabilir sheet bulunamadı." };
    }

    const { vendorLookup, accessibleVendorIds } = await getAccessibleVendorLookup(session.user);
    const accessibleVendorSet = new Set(accessibleVendorIds);
    const manualMappingMap = new Map(mappingsValidation.data.map((mapping) => [mapping.sheetName, mapping.vendorId]));
    const missingMappings: string[] = [];
    const skippedSheets: string[] = [];
    const importRows = new Map<
      string,
      {
        vendorId: string;
        sheetName: string;
        revenue: number;
        gp: number;
      }
    >();

    for (const sheetName of sheetNames) {
      const autoMatchedVendor = resolveLookupValue(vendorLookup, sheetName);
      const mappedVendorId = autoMatchedVendor?.id ?? manualMappingMap.get(sheetName);

      if (mappedVendorId === SKIP_FORECAST_SHEET_VALUE) {
        skippedSheets.push(sheetName);
        continue;
      }

      if (!mappedVendorId) {
        missingMappings.push(sheetName);
        continue;
      }

      if (!accessibleVendorSet.has(mappedVendorId)) {
        return { success: false, error: `${sheetName} sheet'i için seçilen markaya erişim yetkiniz yok.` };
      }

      const worksheet = workbook.Sheets[sheetName];
      const revenue = parseImportNumber(worksheet?.G10?.v ?? worksheet?.G10?.w, "Revenue", sheetName, "G10");
      const gp = parseImportNumber(worksheet?.G11?.v ?? worksheet?.G11?.w, "GP", sheetName, "G11");

      const existingRow = importRows.get(mappedVendorId);
      importRows.set(mappedVendorId, {
        vendorId: mappedVendorId,
        sheetName: existingRow ? `${existingRow.sheetName}, ${sheetName}` : sheetName,
        revenue: (existingRow?.revenue ?? 0) + revenue,
        gp: (existingRow?.gp ?? 0) + gp,
      });
    }

    if (missingMappings.length > 0) {
      return {
        success: false,
        error: `Marka eşleştirmesi eksik sheetler: ${missingMappings.slice(0, 8).join(", ")}`,
      };
    }

    const dedupedRows = Array.from(importRows.values());
    if (dedupedRows.length === 0) {
      return { success: false, error: "Yüklenecek forecast verisi bulunamadı. Tüm sheetler atlanmış olabilir." };
    }

    const result = await prisma.$transaction(async (tx) => {
      for (const row of dedupedRows) {
        const { forecast, previousActive } = await writeActiveForecast(tx, {
          vendorId: row.vendorId,
          fiscalPeriodId: period.id,
          weekNumber,
          revenue: row.revenue,
          gp: row.gp,
          submittedById: session.user.id,
        });

        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: "FORECAST_BULK_IMPORT",
            entityType: "Forecast",
            entityId: forecast.id,
            oldValue: previousActive
              ? {
                  id: previousActive.id,
                  weekNumber: previousActive.weekNumber,
                  revenue: Number(previousActive.revenue),
                  gp: Number(previousActive.gp),
                  isActive: previousActive.isActive,
                }
              : Prisma.JsonNull,
            newValue: {
              id: forecast.id,
              weekNumber: forecast.weekNumber,
              revenue: Number(forecast.revenue),
              gp: Number(forecast.gp),
              isActive: forecast.isActive,
              sourceSheet: row.sheetName,
            },
          },
        });
      }

      return tx.importLog.create({
        data: {
          dataType: "FORECAST",
          uploadedById: session.user.id,
          fileName: file.name,
          rowCount: dedupedRows.length,
          status: "SUCCESS",
        },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "BULK_IMPORT_FORECAST",
        entityType: "ImportLog",
        entityId: result.id,
        newValue: {
          fileName: file.name,
          inputSheets: sheetNames.length,
          upsertedRows: dedupedRows.length,
          skippedSheets,
          fiscalYear,
          quarter,
          weekNumber,
        },
      },
    });

    revalidatePath("/forecast-input");
    const processedSheetCount = sheetNames.length - skippedSheets.length;
    return {
      success: true,
      importedCount: dedupedRows.length,
      mergedSheetCount: processedSheetCount - dedupedRows.length,
      skippedSheetCount: skippedSheets.length,
    };
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "Forecast XLS yükleme sırasında hata oluştu.") };
  }
}

export async function getSessionUser() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }
  return {
    name: session.user.name,
    role: session.user.role,
  };
}

export async function getWeeklyForecastTrend(fiscalYear: number, quarter: number) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  const accessibleVendorIds = await getAccessibleVendorIds(session.user);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  const forecasts = await prisma.forecast.findMany({
    where: {
      fiscalPeriodId: period.id,
      vendorId: { in: accessibleVendorIds },
    },
    select: {
      weekNumber: true,
      revenue: true,
      gp: true,
    },
  });

  const weeklyMap = new Map<number, { revenue: number; gp: number; count: number }>();
  for (let w = 1; w <= 13; w++) {
    weeklyMap.set(w, { revenue: 0, gp: 0, count: 0 });
  }

  for (const f of forecasts) {
    const existing = weeklyMap.get(f.weekNumber);
    if (existing) {
      existing.revenue += Number(f.revenue);
      existing.gp += Number(f.gp);
      existing.count += 1;
    }
  }

  return Array.from(weeklyMap.entries()).map(([weekNumber, data]) => ({
    weekNumber,
    revenue: data.revenue,
    gp: data.gp,
    count: data.count,
  }));
}

export async function uploadCrmExcelAction(formData: FormData, fiscalYear: number, quarter: number, weekNumber: number) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "Oturum açık değil." };
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return { success: false, error: "Lütfen geçerli bir CRM Excel dosyası seçin." };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseTDSynnexCrmExcel(buffer);
    const period = await ensureFiscalPeriod(fiscalYear, quarter);

    const brandSummaries = Object.values(parsed.brandSummaries);

    // 1. Fetch DB Vendors with their assigned Sales Managers (User) and Aliases
    const dbVendors = await prisma.vendor.findMany({
      include: {
        manager: { select: { id: true, name: true } },
        aliases: { select: { alias: true } },
      },
    });

    // Manager CRM aggregation map: managerName -> aggregated metrics
    const managerCrmMap: Record<
      string,
      {
        managerName: string;
        userId: string | null;
        weightedPipeline: number;
        rawPipeline: number;
        overdueCount: number;
      }
    > = {};

    // Also fetch all system users with role 'MANAGER' or vendors' assigned managers to ensure all SMs are included
    const allDbManagers = await prisma.user.findMany({
      where: { role: { in: ["SATIS_MUDURU", "DIREKTOR"] } },
      select: { id: true, name: true },
    });

    for (const m of allDbManagers) {
      managerCrmMap[m.name] = {
        managerName: m.name,
        userId: m.id,
        weightedPipeline: 0,
        rawPipeline: 0,
        overdueCount: 0,
      };
    }

    // 2. Process each Brand Summary from Excel & match to DB Vendor & Sales Manager
    for (const b of brandSummaries) {
      const bNameUpper = b.brandName.toUpperCase();
      const matchedVendor = dbVendors.find(
        (v) =>
          v.name.toUpperCase() === bNameUpper ||
          v.code?.toUpperCase() === bNameUpper ||
          v.aliases.some((a) => a.alias.toUpperCase() === bNameUpper) ||
          v.name.toUpperCase().includes(bNameUpper) ||
          bNameUpper.includes(v.name.toUpperCase())
      );

      // Upsert VendorScorecard
      await prisma.vendorScorecard.upsert({
        where: {
          vendorName_fiscalPeriodId_weekNumber: {
            vendorName: b.brandName,
            fiscalPeriodId: period.id,
            weekNumber,
          },
        },
        create: {
          vendorName: b.brandName,
          vendorId: matchedVendor?.id ?? null,
          fiscalPeriodId: period.id,
          weekNumber,
          weightedCrmPipeline: b.weightedPipeline,
          rawCrmPipeline: b.rawPipeline,
          overdueCount: b.overdueCount,
          crmHealthScore: b.crmHealthScore,
          totalDeals: b.totalDeals,
        },
        update: {
          vendorId: matchedVendor?.id ?? null,
          weightedCrmPipeline: b.weightedPipeline,
          rawCrmPipeline: b.rawPipeline,
          overdueCount: b.overdueCount,
          crmHealthScore: b.crmHealthScore,
          totalDeals: b.totalDeals,
        },
      });

      // Aggregate for Assigned Sales Manager (SM) from System DB
      if (matchedVendor?.manager?.name) {
        const smName = matchedVendor.manager.name;
        if (!managerCrmMap[smName]) {
          managerCrmMap[smName] = {
            managerName: smName,
            userId: matchedVendor.manager.id,
            weightedPipeline: 0,
            rawPipeline: 0,
            overdueCount: 0,
          };
        }
        managerCrmMap[smName].weightedPipeline += b.weightedPipeline;
        managerCrmMap[smName].rawPipeline += b.rawPipeline;
        managerCrmMap[smName].overdueCount += b.overdueCount;
      }
    }

    // 3. Upsert SalesManagerScorecard for each system Sales Manager
    for (const sm of Object.values(managerCrmMap)) {
      const crmHealthScore = Math.max(30, 100 - sm.overdueCount * 5);
      const overall = Math.round((crmHealthScore * 0.4 + 60) * 100) / 100;

      await prisma.salesManagerScorecard.upsert({
        where: {
          managerName_fiscalPeriodId_weekNumber: {
            managerName: sm.managerName,
            fiscalPeriodId: period.id,
            weekNumber,
          },
        },
        create: {
          managerName: sm.managerName,
          userId: sm.userId,
          fiscalPeriodId: period.id,
          weekNumber,
          weightedCrmPipeline: sm.weightedPipeline,
          rawCrmPipeline: sm.rawPipeline,
          overdueCount: sm.overdueCount,
          crmHealthScore,
          overallScore: overall,
        },
        update: {
          userId: sm.userId,
          weightedCrmPipeline: sm.weightedPipeline,
          rawCrmPipeline: sm.rawPipeline,
          overdueCount: sm.overdueCount,
          crmHealthScore,
          overallScore: overall,
        },
      });
    }

    await prisma.importLog.create({
      data: {
        dataType: "CRM",
        uploadedById: session.user.id,
        fileName: file.name,
        rowCount: parsed.rows.length,
        status: "SUCCESS",
      },
    });

    revalidatePath("/forecast-input");
    revalidatePath("/scorecard");

    return {
      success: true,
      processedCount: parsed.rows.length,
      brandCount: brandSummaries.length,
      managerCount: Object.keys(managerCrmMap).length,
    };
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "CRM Excel yüklenirken hata oluştu.") };
  }
}

export async function getManagerScorecardsAction(fiscalYear: number, quarter: number, weekNumber: number) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  if (!prisma.salesManagerScorecard) {
    return [];
  }

  const scorecards = await prisma.salesManagerScorecard.findMany({
    where: {
      fiscalPeriodId: period.id,
      weekNumber,
    },
  });

  return scorecards.map((s) => ({
    id: s.id,
    managerName: s.managerName,
    weightedCrmPipeline: Number(s.weightedCrmPipeline),
    rawCrmPipeline: Number(s.rawCrmPipeline),
    overdueCount: s.overdueCount,
    crmHealthScore: s.crmHealthScore,
    forecastAccuracy: Number(s.forecastAccuracy),
    revenueAch: Number(s.revenueAch),
    gpAch: Number(s.gpAch),
    overallScore: Number(s.overallScore),
    managerComment: s.managerComment,
  }));
}

export async function getVendorScorecardsAction(fiscalYear: number, quarter: number, weekNumber: number) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  if (!prisma.vendorScorecard) {
    return [];
  }

  const scorecards = await prisma.vendorScorecard.findMany({
    where: {
      fiscalPeriodId: period.id,
      weekNumber,
    },
  });

  return scorecards.map((v) => ({
    id: v.id,
    vendorName: v.vendorName,
    vendorId: v.vendorId,
    weightedCrmPipeline: Number(v.weightedCrmPipeline),
    rawCrmPipeline: Number(v.rawCrmPipeline),
    overdueCount: v.overdueCount,
    crmHealthScore: v.crmHealthScore,
    totalDeals: v.totalDeals,
  }));
}
