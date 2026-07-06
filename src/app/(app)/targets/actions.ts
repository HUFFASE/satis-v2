"use server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { getAccessibleVendorIds, assertVendorAccess } from "@/lib/scope";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { writeAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import * as XLSX from "xlsx";

const upsertTargetSchema = z.object({
  revenue: z.number().min(0, "Revenue hedefi sıfırdan küçük olamaz."),
  gp: z.number().min(0, "GP hedefi sıfırdan küçük olamaz."),
});

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;

interface ParsedTargetImportRow {
  rowNumber: number;
  vendor: string;
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
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

function getCellText(row: Record<string, unknown>, key: string) {
  const directValue = row[key];
  if (directValue !== undefined && directValue !== null) {
    return String(directValue).trim();
  }

  const normalizedKey = key.toLowerCase();
  const entry = Object.entries(row).find(([header]) => header.trim().toLowerCase() === normalizedKey);
  return entry?.[1] === undefined || entry[1] === null ? "" : String(entry[1]).trim();
}

function parseImportNumber(value: string, fieldName: string, rowNumber: number) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${rowNumber}. satırda ${fieldName} değeri geçerli değil.`);
  }

  return parsed;
}

function parseQuarterValue(value: string, fallbackFiscalYear: number, fallbackQuarter: number) {
  const trimmed = value.trim();

  if (!trimmed) {
    return { fiscalYear: fallbackFiscalYear, quarter: fallbackQuarter };
  }

  const fullMatch = trimmed.match(/(?:FY)?\s*(\d{4})\s*[-/ ]?\s*Q\s*([1-4])/i);
  if (fullMatch) {
    return {
      fiscalYear: Number(fullMatch[1]),
      quarter: Number(fullMatch[2]),
    };
  }

  const quarterOnlyMatch = trimmed.match(/^Q\s*([1-4])$/i);
  if (quarterOnlyMatch) {
    return {
      fiscalYear: fallbackFiscalYear,
      quarter: Number(quarterOnlyMatch[1]),
    };
  }

  throw new Error(`Quarter değeri "${trimmed}" okunamadı. Beklenen örnek: FY${fallbackFiscalYear}-Q${fallbackQuarter}.`);
}

function parseTargetImportRows(
  rows: Record<string, unknown>[],
  fallbackFiscalYear: number,
  fallbackQuarter: number
) {
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Tek seferde en fazla ${MAX_IMPORT_ROWS} satır yüklenebilir.`);
  }

  return rows
    .map((row, index): ParsedTargetImportRow | null => {
      const rowNumber = index + 2;
      const vendor = getCellText(row, "Vendor");
      const quarterText = getCellText(row, "Quarter");
      const revenueText = getCellText(row, "Revenue");
      const gpText = getCellText(row, "GP");

      if (!vendor && !quarterText && !revenueText && !gpText) {
        return null;
      }

      if (!vendor) {
        throw new Error(`${rowNumber}. satırda Vendor alanı boş.`);
      }

      const { fiscalYear, quarter } = parseQuarterValue(quarterText, fallbackFiscalYear, fallbackQuarter);
      const revenue = parseImportNumber(revenueText, "Revenue", rowNumber);
      const gp = parseImportNumber(gpText, "GP", rowNumber);

      return {
        rowNumber,
        vendor,
        fiscalYear,
        quarter,
        revenue,
        gp,
      };
    })
    .filter((row): row is ParsedTargetImportRow => row !== null);
}

function makeImportKey(vendorId: string, fiscalPeriodId: string) {
  return `${vendorId}:${fiscalPeriodId}`;
}

/**
 * Returns the targets list for accessible vendors in a selected fiscal quarter.
 * Inserts missing targets as 0 on-the-fly.
 */
export async function getTargets(fiscalYear: number, quarter: number) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  // 1. Get user scoped active vendor IDs
  const accessibleVendorIds = await getAccessibleVendorIds(session.user);

  // 2. Resolve database FiscalPeriod row
  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  // 3. Fetch canonical vendors that user has authorization for
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

  // 4. Query target entries matching accessible vendors and fiscal period
  const targets = await prisma.target.findMany({
    where: {
      fiscalPeriodId: period.id,
      vendorId: { in: accessibleVendorIds },
    },
  });

  const targetMap = new Map(targets.map((t) => [t.vendorId, t]));

  return vendors.map((b) => {
    const target = targetMap.get(b.id);
    return {
      vendorId: b.id,
      vendorName: b.name,
      managerId: b.managerId,
      managerName: b.manager?.name ?? null,
      revenue: target ? Number(target.revenue) : 0,
      gp: target ? Number(target.gp) : 0,
      updatedAt: target ? target.updatedAt : null,
      isPeriodLocked: period.isLocked,
    };
  });
}

/**
 * Upserts a single vendor target row after validating scoping access and locking states.
 */
export async function upsertTarget(
  vendorId: string,
  fiscalYear: number,
  quarter: number,
  revenueInput: number,
  gpInput: number
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

  // 2. Validate Input Metrics
  const validation = upsertTargetSchema.safeParse({ revenue: revenueInput, gp: gpInput });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { revenue, gp } = validation.data;

  // 3. Resolve Period and Verify Locking
  const period = await ensureFiscalPeriod(fiscalYear, quarter);
  if (period.isLocked) {
    return {
      success: false,
      error: "Seçilen çeyrek kilitlenmiş durumdadır. Kilitli dönemler üzerinde hedef güncellemesi yapılamaz.",
    };
  }

  // 4. Check if targets record already exists for audit logs comparison
  const existing = await prisma.target.findUnique({
    where: {
      vendorId_fiscalPeriodId: {
        vendorId,
        fiscalPeriodId: period.id,
      },
    },
  });

  // 5. Execute Upsert Operation
  const target = await prisma.target.upsert({
    where: {
      vendorId_fiscalPeriodId: {
        vendorId,
        fiscalPeriodId: period.id,
      },
    },
    update: {
      revenue,
      gp,
    },
    create: {
      vendorId,
      fiscalPeriodId: period.id,
      revenue,
      gp,
    },
  });

  // 6. Write to AuditLog
  await writeAuditLog({
    userId: session.user.id,
    action: existing ? "UPDATE_TARGET" : "CREATE_TARGET",
    entityType: "Target",
    entityId: target.id,
    oldValue: existing
      ? { revenue: Number(existing.revenue), gp: Number(existing.gp), fiscalPeriodId: period.id }
      : null,
    newValue: { revenue: Number(target.revenue), gp: Number(target.gp), fiscalPeriodId: period.id },
  });

  revalidatePath("/targets");
  return { success: true };
}

/**
 * Imports target rows from an XLS/XLSX file using the template columns:
 * Number, Vendor, Quarter, Revenue, GP.
 */
export async function importTargetsFromXls(
  formData: FormData,
  fallbackFiscalYear: number,
  fallbackQuarter: number
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
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
      return { success: false, error: "Excel dosyasında okunabilir bir sayfa bulunamadı." };
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: "",
      raw: false,
    });
    const parsedRows = parseTargetImportRows(rawRows, fallbackFiscalYear, fallbackQuarter);

    if (parsedRows.length === 0) {
      return { success: false, error: "Yüklenecek hedef satırı bulunamadı." };
    }

    const vendors = await prisma.vendor.findMany({
      where: {
        id: { in: accessibleVendorIds },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        aliases: {
          select: {
            alias: true,
          },
        },
      },
    });
    const vendorLookup = new Map<string, string>();

    for (const vendor of vendors) {
      vendorLookup.set(normalizeLookupValue(vendor.name), vendor.id);
      for (const alias of vendor.aliases) {
        vendorLookup.set(normalizeLookupValue(alias.alias), vendor.id);
      }
    }

    const periodMap = new Map<string, Awaited<ReturnType<typeof ensureFiscalPeriod>>>();
    const importTargets = new Map<
      string,
      {
        vendorId: string;
        fiscalPeriodId: string;
        revenue: number;
        gp: number;
        rowNumber: number;
      }
    >();

    for (const row of parsedRows) {
      const vendorId = vendorLookup.get(normalizeLookupValue(row.vendor));
      if (!vendorId) {
        throw new Error(`${row.rowNumber}. satırdaki Vendor için yetkili/aktif kayıt bulunamadı: ${row.vendor}`);
      }

      const periodKey = `${row.fiscalYear}:${row.quarter}`;
      let period = periodMap.get(periodKey);
      if (!period) {
        period = await ensureFiscalPeriod(row.fiscalYear, row.quarter);
        periodMap.set(periodKey, period);
      }

      if (period.isLocked) {
        throw new Error(`${row.rowNumber}. satırdaki FY${row.fiscalYear}-Q${row.quarter} dönemi kilitli.`);
      }

      importTargets.set(makeImportKey(vendorId, period.id), {
        vendorId,
        fiscalPeriodId: period.id,
        revenue: row.revenue,
        gp: row.gp,
        rowNumber: row.rowNumber,
      });
    }

    const dedupedTargets = Array.from(importTargets.values());
    const result = await prisma.$transaction(async (tx) => {
      for (const target of dedupedTargets) {
        await tx.target.upsert({
          where: {
            vendorId_fiscalPeriodId: {
              vendorId: target.vendorId,
              fiscalPeriodId: target.fiscalPeriodId,
            },
          },
          update: {
            revenue: target.revenue,
            gp: target.gp,
          },
          create: {
            vendorId: target.vendorId,
            fiscalPeriodId: target.fiscalPeriodId,
            revenue: target.revenue,
            gp: target.gp,
          },
        });
      }

      return tx.importLog.create({
        data: {
          dataType: "TARGET",
          uploadedById: session.user.id,
          fileName: file.name,
          rowCount: dedupedTargets.length,
          status: "SUCCESS",
        },
      });
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "BULK_IMPORT_TARGETS",
      entityType: "ImportLog",
      entityId: result.id,
      newValue: {
        fileName: file.name,
        inputRows: parsedRows.length,
        upsertedRows: dedupedTargets.length,
      },
    });

    revalidatePath("/targets");
    return {
      success: true,
      importedCount: dedupedTargets.length,
      skippedDuplicateCount: parsedRows.length - dedupedTargets.length,
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
