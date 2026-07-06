"use server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { getAccessibleVendorIds } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;

interface ParsedClosingRow {
  rowNumber: number;
  number: string;
  brand: string;
  fiscalYear: number;
  quarter: number;
  revenue: number;
  gp: number;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;

  if (/ECMA-376 Encrypted file|EncryptionInfo|encrypted/i.test(error.message)) {
    return "Excel dosyası şifreli, korumalı veya bozuk görünüyor. Lütfen dosyayı Excel'de açıp şifresiz/korumasız yeni bir XLSX olarak kaydedin ve tekrar yükleyin.";
  }

  return error.message;
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

  if (exactMatch) return exactMatch;

  const candidates = Array.from(lookup.entries())
    .filter(([key]) => key.includes(normalizedValue))
    .map(([, value]) => value);
  const uniqueCandidates = Array.from(
    new Map(candidates.map((candidate) => [candidate.id, candidate])).values()
  );

  return uniqueCandidates.length === 1 ? uniqueCandidates[0] : null;
}

function getCellText(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const directValue = row[key];
    if (directValue !== undefined && directValue !== null) {
      return String(directValue).trim();
    }

    const normalizedKey = key.toLowerCase();
    const entry = Object.entries(row).find(([header]) => header.trim().toLowerCase() === normalizedKey);
    if (entry?.[1] !== undefined && entry[1] !== null) {
      return String(entry[1]).trim();
    }
  }

  return "";
}

function parseImportNumber(value: string, fieldName: string, rowNumber: number) {
  const trimmed = value.trim();

  if (!trimmed || /^[-—–]+$/.test(trimmed)) return 0;

  const withoutCurrency = trimmed
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
    throw new Error(`${rowNumber}. satırda ${fieldName} değeri geçerli değil: "${value}".`);
  }

  return parsed;
}

function parseQuarterValue(value: string, fallbackFiscalYear: number, fallbackQuarter: number) {
  const trimmed = value.trim();
  if (!trimmed) return { fiscalYear: fallbackFiscalYear, quarter: fallbackQuarter };

  const fullMatch = trimmed.match(/(?:FY)?\s*(\d{4})\s*[-/ ]?\s*Q\s*([1-4])/i);
  if (fullMatch) {
    return { fiscalYear: Number(fullMatch[1]), quarter: Number(fullMatch[2]) };
  }

  const quarterOnlyMatch = trimmed.match(/^Q\s*([1-4])$/i);
  if (quarterOnlyMatch) {
    return { fiscalYear: fallbackFiscalYear, quarter: Number(quarterOnlyMatch[1]) };
  }

  throw new Error(`Quarter değeri "${trimmed}" okunamadı. Beklenen örnek: FY${fallbackFiscalYear}-Q${fallbackQuarter}.`);
}

function parseClosingRows(rows: Record<string, unknown>[], fallbackFiscalYear: number, fallbackQuarter: number) {
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Tek seferde en fazla ${MAX_IMPORT_ROWS} satır yüklenebilir.`);
  }

  return rows
    .map((row, index): ParsedClosingRow | null => {
      const rowNumber = index + 2;
      const number = getCellText(row, ["Number"]);
      const brand = getCellText(row, ["Marka", "Vendor", "Brand"]);
      const quarterText = getCellText(row, ["finansal yıl + çeyrek", "Fiscal Period", "Quarter"]);
      const revenueText = getCellText(row, ["kapanış revenue", "Closing Revenue", "Revenue"]);
      const gpText = getCellText(row, ["kapanış GP", "Closing GP", "GP"]);

      if (!number && !brand && !quarterText && !revenueText && !gpText) return null;
      if (!brand) throw new Error(`${rowNumber}. satırda Marka alanı boş.`);

      const { fiscalYear, quarter } = parseQuarterValue(quarterText, fallbackFiscalYear, fallbackQuarter);
      const revenue = parseImportNumber(revenueText, "Kapanış Revenue", rowNumber);
      const gp = parseImportNumber(gpText, "Kapanış GP", rowNumber);

      return { rowNumber, number, brand, fiscalYear, quarter, revenue, gp };
    })
    .filter((row): row is ParsedClosingRow => row !== null);
}

function calculateGpPercent(revenue: number, gp: number) {
  return revenue > 0 ? (gp / revenue) * 100 : 0;
}

function calculateAchievement(value: number, target: number) {
  return target > 0 ? (value / target) * 100 : 0;
}

function makeImportKey(vendorId: string, fiscalPeriodId: string) {
  return `${vendorId}:${fiscalPeriodId}`;
}

export async function getClosings(fiscalYear: number, quarter: number) {
  const session = await auth();
  if (!session?.user) throw new Error("Oturum açık değil.");

  const accessibleVendorIds = await getAccessibleVendorIds(session.user);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  const [vendors, targets, forecasts, closings] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: accessibleVendorIds }, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        managerId: true,
        manager: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.target.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: period.id },
    }),
    prisma.forecast.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: period.id, isActive: true },
    }),
    prisma.closing.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: period.id },
    }),
  ]);

  const targetMap = new Map(targets.map((target) => [target.vendorId, target]));
  const forecastMap = new Map(forecasts.map((forecast) => [forecast.vendorId, forecast]));
  const closingMap = new Map(closings.map((closing) => [closing.vendorId, closing]));

  return vendors.map((vendor) => {
    const target = targetMap.get(vendor.id);
    const forecast = forecastMap.get(vendor.id);
    const closing = closingMap.get(vendor.id);
    const targetRevenue = target ? Number(target.revenue) : 0;
    const targetGp = target ? Number(target.gp) : 0;
    const forecastRevenue = forecast ? Number(forecast.revenue) : 0;
    const forecastGp = forecast ? Number(forecast.gp) : 0;
    const closingRevenue = closing ? Number(closing.revenue) : 0;
    const closingGp = closing ? Number(closing.gp) : 0;

    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      vendorCode: vendor.code,
      managerId: vendor.managerId,
      managerName: vendor.manager?.name ?? null,
      targetRevenue,
      targetGp,
      targetGpPercent: calculateGpPercent(targetRevenue, targetGp),
      forecastRevenue,
      forecastGp,
      forecastGpPercent: calculateGpPercent(forecastRevenue, forecastGp),
      closingRevenue,
      closingGp,
      closingGpPercent: calculateGpPercent(closingRevenue, closingGp),
      targetAchievement: calculateAchievement(closingRevenue, targetRevenue),
      targetGpAchievement: calculateAchievement(closingGp, targetGp),
      forecastAchievement: calculateAchievement(closingRevenue, forecastRevenue),
      forecastGpAchievement: calculateAchievement(closingGp, forecastGp),
      hasClosing: Boolean(closing),
      updatedAt: closing?.updatedAt ?? null,
      isPeriodLocked: period.isLocked,
    };
  });
}

export async function importClosingsFromXls(formData: FormData, fallbackFiscalYear: number, fallbackQuarter: number) {
  const session = await auth();
  if (!session?.user) return { success: false, error: "Oturum açık değil." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "Yüklenecek dosya bulunamadı." };
  if (!file.name.match(/\.(xls|xlsx|xlsb)$/i)) {
    return { success: false, error: "Lütfen .xls, .xlsx veya .xlsb uzantılı bir dosya seçiniz." };
  }
  if (file.size > MAX_IMPORT_FILE_SIZE) return { success: false, error: "Dosya boyutu en fazla 5 MB olabilir." };

  try {
    const accessibleVendorIds = await getAccessibleVendorIds(session.user);
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return { success: false, error: "Excel dosyasında okunabilir bir sayfa bulunamadı." };

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], {
      defval: "",
      raw: false,
    });
    const parsedRows = parseClosingRows(rows, fallbackFiscalYear, fallbackQuarter);
    if (parsedRows.length === 0) return { success: false, error: "Yüklenecek kapanış satırı bulunamadı." };

    const vendors = await prisma.vendor.findMany({
      where: { id: { in: accessibleVendorIds }, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        aliases: { select: { alias: true } },
      },
    });

    const vendorLookup = new Map<string, { id: string; name: string }>();
    for (const vendor of vendors) {
      const value = { id: vendor.id, name: vendor.name };
      vendorLookup.set(normalizeLookupValue(vendor.name), value);
      if (vendor.code) vendorLookup.set(normalizeLookupValue(vendor.code), value);
      for (const alias of vendor.aliases) vendorLookup.set(normalizeLookupValue(alias.alias), value);
    }

    const importRows = new Map<
      string,
      {
        vendorId: string;
        fiscalPeriodId: string;
        revenue: number;
        gp: number;
      }
    >();
    const skippedBrands = new Set<string>();

    for (const row of parsedRows) {
      const vendor = resolveLookupValue(vendorLookup, row.brand);
      if (!vendor) {
        skippedBrands.add(row.brand);
        continue;
      }

      const period = await ensureFiscalPeriod(row.fiscalYear, row.quarter);
      if (period.isLocked) {
        return {
          success: false,
          error: `FY${row.fiscalYear} Q${row.quarter} kilitli olduğu için kapanış yüklemesi yapılamaz.`,
        };
      }

      const importKey = makeImportKey(vendor.id, period.id);
      const existing = importRows.get(importKey);
      importRows.set(importKey, {
        vendorId: vendor.id,
        fiscalPeriodId: period.id,
        revenue: (existing?.revenue ?? 0) + row.revenue,
        gp: (existing?.gp ?? 0) + row.gp,
      });
    }

    const dedupedRows = Array.from(importRows.values());
    if (dedupedRows.length === 0) {
      return { success: false, error: "Dosyada sistemdeki vendor kayıtlarıyla eşleşen kapanış satırı bulunamadı." };
    }

    const importLog = await prisma.$transaction(async (tx) => {
      for (const row of dedupedRows) {
        await tx.closing.upsert({
          where: {
            vendorId_fiscalPeriodId: {
              vendorId: row.vendorId,
              fiscalPeriodId: row.fiscalPeriodId,
            },
          },
          update: {
            revenue: row.revenue,
            gp: row.gp,
          },
          create: {
            vendorId: row.vendorId,
            fiscalPeriodId: row.fiscalPeriodId,
            revenue: row.revenue,
            gp: row.gp,
          },
        });
      }

      return tx.importLog.create({
        data: {
          dataType: "CLOSING",
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
        action: "BULK_IMPORT_CLOSING",
        entityType: "ImportLog",
        entityId: importLog.id,
        newValue: {
          fileName: file.name,
          inputRows: parsedRows.length,
          upsertedRows: dedupedRows.length,
          skippedBrands: Array.from(skippedBrands).slice(0, 20),
        },
      },
    });

    revalidatePath("/closing");
    return {
      success: true,
      importedCount: dedupedRows.length,
      skippedCount: skippedBrands.size,
      skippedBrands: Array.from(skippedBrands).slice(0, 10),
    };
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "Kapanış XLS yükleme sırasında hata oluştu.") };
  }
}
