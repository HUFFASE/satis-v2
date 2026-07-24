"use server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { getAccessibleVendorIds, assertVendorAccess } from "@/lib/scope";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { writeAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as XLSX from "xlsx";

const upsertActualSchema = z.object({
  backlog: z.number().min(0, "Revenue değeri sıfırdan küçük olamaz."),
  invoiced: z.number().min(0, "GP değeri sıfırdan küçük olamaz."),
});

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;

interface ParsedBacklogImportRow {
  rowNumber: number;
  managerName: string;
  vendor: string;
  backlog: number;
  invoiced: number;
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

function resolveLookupValue<T extends { id: string }>(
  lookup: Map<string, T>,
  rawValue: string
) {
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

function getCellText(row: unknown[], columnIndex: number) {
  const value = row[columnIndex];
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseImportNumber(value: string, fieldName: string, rowNumber: number) {
  const trimmed = value.trim();

  if (!trimmed || /^[-—–]+$/.test(trimmed)) {
    return 0;
  }

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

function isBacklogImportHeaderRow(managerName: string, vendor: string, revenue: string, gp: string) {
  const normalizedManager = normalizeLookupValue(managerName);
  const normalizedVendor = normalizeLookupValue(vendor);
  const normalizedRevenue = normalizeLookupValue(revenue);
  const normalizedGp = normalizeLookupValue(gp);

  return (
    normalizedManager.includes("SATIS") ||
    normalizedManager.includes("SALES") ||
    normalizedVendor.includes("VENDOR") ||
    normalizedRevenue.includes("REVENUE") ||
    normalizedGp === "GP" ||
    normalizedGp.includes("GROSS_PROFIT")
  );
}

function parseBacklogImportRows(rows: unknown[][]) {
  if (rows.length > MAX_IMPORT_ROWS + 20) {
    throw new Error(`Tek seferde en fazla ${MAX_IMPORT_ROWS} satır yüklenebilir.`);
  }

  const parsedRows: ParsedBacklogImportRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const managerName = getCellText(row, 3);
    const vendor = getCellText(row, 4);
    const revenue = getCellText(row, 20);
    const gp = getCellText(row, 21);

    if (!managerName && !vendor && !revenue && !gp) {
      return;
    }

    if (isBacklogImportHeaderRow(managerName, vendor, revenue, gp)) {
      return;
    }

    if (!managerName || !vendor) {
      return;
    }

    parsedRows.push({
      rowNumber,
      managerName,
      vendor,
      backlog: parseImportNumber(revenue, "Revenue", rowNumber),
      invoiced: parseImportNumber(gp, "GP", rowNumber),
    });
  });

  if (parsedRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Tek seferde en fazla ${MAX_IMPORT_ROWS} satır yüklenebilir.`);
  }

  return parsedRows;
}

function makeImportKey(vendorId: string, fiscalPeriodId: string, weekNumber: number) {
  return `${vendorId}:${fiscalPeriodId}:${weekNumber}`;
}

/**
 * Retrieves the list of actuals for accessible vendors at a specific fiscal year, quarter, and week number.
 * Missing rows are returned as 0 on-the-fly.
 */
export async function getActuals(fiscalYear: number, quarter: number, weekNumber: number) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  // 1. Get scoped active vendor IDs
  const accessibleVendorIds = await getAccessibleVendorIds(session.user);

  // 2. Resolve database FiscalPeriod row
  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  // 3. Fetch canonical vendors that the user has authorization for
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

  // 4. Query actual entries matching accessible vendors, fiscal period, and week number
  const actuals = await prisma.actual.findMany({
    where: {
      fiscalPeriodId: period.id,
      vendorId: { in: accessibleVendorIds },
      weekNumber,
    },
  });
  const actualMap = new Map(actuals.map((a) => [a.vendorId, a]));

  const [latestActual, maxWeekActual] = await Promise.all([
    prisma.actual.findFirst({
      where: {
        fiscalPeriodId: period.id,
        vendorId: { in: accessibleVendorIds },
      },
      orderBy: { updatedAt: "desc" },
      select: { weekNumber: true, updatedAt: true },
    }),
    prisma.actual.findFirst({
      where: {
        fiscalPeriodId: period.id,
        vendorId: { in: accessibleVendorIds },
      },
      orderBy: { weekNumber: "desc" },
      select: { weekNumber: true },
    }),
  ]);

  const rows = vendors.map((b) => {
    const actual = actualMap.get(b.id);
    return {
      vendorId: b.id,
      vendorName: b.name,
      managerId: b.managerId,
      managerName: b.manager?.name ?? null,
      backlog: actual ? Number(actual.backlog) : 0,
      invoiced: actual ? Number(actual.invoiced) : 0,
      updatedAt: actual ? actual.updatedAt : null,
      isPeriodLocked: period.isLocked,
      hasData: Boolean(actual),
      weekNumber: weekNumber,
    };
  });

  return {
    rows,
    latestUploadWeekNumber: latestActual?.weekNumber ?? maxWeekActual?.weekNumber ?? null,
    latestUploadAt: latestActual?.updatedAt ?? null,
  };
}

/**
 * Upserts a single vendor actual row after validating scoping access, week context, and locking states.
 */
export async function upsertActual(
  vendorId: string,
  fiscalYear: number,
  quarter: number,
  weekNumber: number,
  backlogInput: number,
  invoicedInput: number
) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "Oturum açık değil." };
  }

  // 1. Enforce Server-Side Scoping Protection
  try {
    await assertVendorAccess(session.user, vendorId);
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "Vendor yetkisi doğrulanamadı.") };
  }

  // 2. Validate Inputs
  const validation = upsertActualSchema.safeParse({ backlog: backlogInput, invoiced: invoicedInput });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { backlog, invoiced } = validation.data;

  // 3. Resolve Period and Verify Locking
  const period = await ensureFiscalPeriod(fiscalYear, quarter);
  if (period.isLocked) {
    return {
      success: false,
      error: "Seçilen çeyrek kilitlenmiş durumdadır. Kilitli dönemler üzerinde gerçekleşme güncellemesi yapılamaz.",
    };
  }

  // 4. Check if actuals record already exists for audit logs comparison
  const existing = await prisma.actual.findUnique({
    where: {
      vendorId_fiscalPeriodId_weekNumber: {
        vendorId,
        fiscalPeriodId: period.id,
        weekNumber,
      },
    },
  });

  // 5. Execute Upsert Operation
  const actual = await prisma.actual.upsert({
    where: {
      vendorId_fiscalPeriodId_weekNumber: {
        vendorId,
        fiscalPeriodId: period.id,
        weekNumber,
      },
    },
    update: {
      backlog,
      invoiced,
    },
    create: {
      vendorId,
      fiscalPeriodId: period.id,
      weekNumber,
      backlog,
      invoiced,
    },
  });

  // 6. Write to AuditLog
  await writeAuditLog({
    userId: session.user.id,
    action: existing ? "UPDATE_ACTUAL" : "CREATE_ACTUAL",
    entityType: "Actual",
    entityId: actual.id,
    oldValue: existing
      ? {
          backlog: Number(existing.backlog),
          invoiced: Number(existing.invoiced),
          weekNumber,
          fiscalPeriodId: period.id,
        }
      : null,
    newValue: {
      backlog: Number(actual.backlog),
      invoiced: Number(actual.invoiced),
      weekNumber,
      fiscalPeriodId: period.id,
    },
  });

  revalidatePath("/actuals");
  return { success: true };
}

/**
 * Imports Revenue/GP rows from a source XLS/XLSX file.
 * Source columns:
 * D = Sales manager, E = Vendor, U = Revenue, V = GP.
 */
export async function importBacklogFromXls(
  formData: FormData,
  fiscalYear: number,
  quarter: number,
  weekNumber: number
) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, error: "Oturum açık değil." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { success: false, error: "Yüklenecek dosya bulunamadı." };
  }

  if (!file.name.match(/\.(xls|xlsx|xlsb)$/i)) {
    return { success: false, error: "Lütfen .xls, .xlsx veya .xlsb uzantılı bir dosya seçiniz." };
  }

  if (file.size > MAX_IMPORT_FILE_SIZE) {
    return { success: false, error: "Dosya boyutu en fazla 5 MB olabilir." };
  }

  try {
    const accessibleVendorIds = await getAccessibleVendorIds(session.user);
    const period = await ensureFiscalPeriod(fiscalYear, quarter);

    if (period.isLocked) {
      return {
        success: false,
        error: "Seçilen çeyrek kilitlenmiş durumdadır. Kilitli dönemler üzerinde Revenue/GP yüklemesi yapılamaz.",
      };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const firstSheetName = workbook.SheetNames.find(
      (sheetName) => sheetName.trim().toLowerCase() === "monthly details"
    );

    if (!firstSheetName) {
      return { success: false, error: "Excel dosyasında Monthly details sheet'i bulunamadı." };
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    const parsedRows = parseBacklogImportRows(sheetRows);

    if (parsedRows.length === 0) {
      return { success: false, error: "Yüklenecek Revenue/GP satırı bulunamadı." };
    }

    const vendors = await prisma.vendor.findMany({
      where: {
        id: { in: accessibleVendorIds },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        code: true,
        managerId: true,
        manager: {
          select: {
            name: true,
          },
        },
        aliases: {
          select: {
            alias: true,
          },
        },
      },
    });
    const vendorLookup = new Map<
      string,
      {
        id: string;
        name: string;
        managerId: string | null;
        managerName: string | null;
      }
    >();

    for (const vendor of vendors) {
      const lookupValue = {
        id: vendor.id,
        name: vendor.name,
        managerId: vendor.managerId,
        managerName: vendor.manager?.name ?? null,
      };
      vendorLookup.set(normalizeLookupValue(vendor.name), lookupValue);
      if (vendor.code) {
        vendorLookup.set(normalizeLookupValue(vendor.code), lookupValue);
      }
      for (const alias of vendor.aliases) {
        vendorLookup.set(normalizeLookupValue(alias.alias), lookupValue);
      }
    }

    const errors: string[] = [];
    const importRows = new Map<
      string,
      {
        vendorId: string;
        backlog: number;
        invoiced: number;
      }
    >();
    const skippedVendors = new Set<string>();

    for (const row of parsedRows) {
      const vendor = resolveLookupValue(vendorLookup, row.vendor);
      if (!vendor) {
        skippedVendors.add(row.vendor);
        continue;
      }

      const importKey = makeImportKey(vendor.id, period.id, weekNumber);
      const existingRow = importRows.get(importKey);

      importRows.set(importKey, {
        vendorId: vendor.id,
        backlog: (existingRow?.backlog ?? 0) + row.backlog,
        invoiced: (existingRow?.invoiced ?? 0) + row.invoiced,
      });
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: `Dosya sistemdeki satış müdürü/vendor bilgileriyle uyuşmuyor. İlk hatalar: ${errors.slice(0, 8).join(" ")}`,
      };
    }

    const dedupedRows = Array.from(importRows.values());
    if (dedupedRows.length === 0) {
      return {
        success: false,
        error: "Dosyada sistemdeki vendor kayıtlarıyla eşleşen satır bulunamadı.",
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      for (const row of dedupedRows) {
        await tx.actual.upsert({
          where: {
            vendorId_fiscalPeriodId_weekNumber: {
              vendorId: row.vendorId,
              fiscalPeriodId: period.id,
              weekNumber,
            },
          },
          update: {
            backlog: row.backlog,
            invoiced: row.invoiced,
          },
          create: {
            vendorId: row.vendorId,
            fiscalPeriodId: period.id,
            weekNumber,
            backlog: row.backlog,
            invoiced: row.invoiced,
          },
        });
      }

      return tx.importLog.create({
        data: {
          dataType: "ACTUAL",
          uploadedById: session.user.id,
          fileName: file.name,
          rowCount: dedupedRows.length,
          status: "SUCCESS",
        },
      });
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "BULK_IMPORT_BACKLOG",
      entityType: "ImportLog",
      entityId: result.id,
      newValue: {
        fileName: file.name,
        inputRows: parsedRows.length,
        upsertedRows: dedupedRows.length,
        skippedVendorCount: skippedVendors.size,
        fiscalYear,
        quarter,
        weekNumber,
      },
    });

    revalidatePath("/actuals");
    return {
      success: true,
      importedCount: dedupedRows.length,
      skippedDuplicateCount: parsedRows.length - dedupedRows.length,
      skippedVendorCount: skippedVendors.size,
      skippedVendors: Array.from(skippedVendors).slice(0, 10),
    };
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "XLS yükleme sırasında hata oluştu.") };
  }
}

/**
 * Retrieves the currently authenticated session user profile client-side.
 */
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
