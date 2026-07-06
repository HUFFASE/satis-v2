"use server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Validates that the active session belongs to a DIREKTOR.
 * Throws an error if unauthorized.
 */
async function requireDirector() {
  const session = await auth();
  if (!session?.user || session.user.role !== "DIREKTOR") {
    throw new Error("Bu işlemi gerçekleştirmek için yetkiniz bulunmamaktadır.");
  }
  return session.user;
}

// Zod schemas for input validation
const vendorFormSchema = z.object({
  name: z.string().min(1, "Vendor adı boş olamaz."),
  code: z.string().optional(),
  logoUrl: z.string().url("Geçersiz logo URL formatı.").or(z.literal("")).optional(),
  managerId: z.string().nullable().optional(),
});

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Retrieves all active managers (SATIS_MUDURU) to map to vendors.
 */
export async function getActiveSalesManagers() {
  await requireDirector();
  return prisma.user.findMany({
    where: {
      role: "SATIS_MUDURU",
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Validates that a manager assignment, if provided, points to an active SATIS_MUDURU user.
 * A director should not be set as a vendor's responsible manager.
 */
async function assertValidManagerAssignment(managerId: string | null | undefined) {
  if (!managerId) return;

  const manager = await prisma.user.findUnique({
    where: { id: managerId },
    select: { role: true, isActive: true },
  });

  if (!manager || manager.role !== "SATIS_MUDURU") {
    throw new Error("Sorumlu yönetici yalnızca bir Satış Müdürü olabilir.");
  }
  if (!manager.isActive) {
    throw new Error("Pasif bir kullanıcı vendor sorumlusu olarak atanamaz.");
  }
}

/**
 * Retrieves all vendors in alphabetical order, detailing the responsible manager,
 * aliases, and checking whether they have active transaction records.
 */
export async function getVendors() {
  await requireDirector();

  const vendors = await prisma.vendor.findMany({
    orderBy: { name: "asc" },
    include: {
      manager: {
        select: {
          id: true,
          name: true,
        },
      },
      _count: {
        select: {
          aliases: true,
          forecasts: true,
          targets: true,
          actuals: true,
        },
      },
    },
  });

  return vendors.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    logoUrl: b.logoUrl,
    isActive: b.isActive,
    aliasCount: b._count.aliases,
    managerCount: b.manager ? 1 : 0,
    managerId: b.manager?.id || null,
    managerName: b.manager?.name || null,
    hasTransactions:
      b._count.forecasts > 0 ||
      b._count.targets > 0 ||
      b._count.actuals > 0,
  }));
}

function calculateGpPercent(revenue: number, gp: number) {
  return revenue > 0 ? (gp / revenue) * 100 : 0;
}

export async function getVendorDetail(vendorId: string) {
  await requireDirector();

  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: {
      manager: { select: { id: true, name: true, email: true } },
      aliases: { orderBy: { alias: "asc" } },
      _count: {
        select: {
          aliases: true,
          forecasts: true,
          targets: true,
          actuals: true,
          closings: true,
        },
      },
    },
  });

  if (!vendor) {
    throw new Error("Vendor bulunamadı.");
  }

  const [targets, forecasts, actuals, closings] = await Promise.all([
    prisma.target.findMany({
      where: { vendorId },
      include: { fiscalPeriod: true },
      orderBy: [{ fiscalPeriod: { fiscalYear: "asc" } }, { fiscalPeriod: { quarter: "asc" } }],
    }),
    prisma.forecast.findMany({
      where: { vendorId },
      include: { fiscalPeriod: true, submittedBy: { select: { name: true } } },
      orderBy: [{ fiscalPeriod: { fiscalYear: "asc" } }, { fiscalPeriod: { quarter: "asc" } }, { weekNumber: "asc" }],
    }),
    prisma.actual.findMany({
      where: { vendorId },
      include: { fiscalPeriod: true },
      orderBy: [{ fiscalPeriod: { fiscalYear: "asc" } }, { fiscalPeriod: { quarter: "asc" } }, { weekNumber: "asc" }],
    }),
    prisma.closing.findMany({
      where: { vendorId },
      include: { fiscalPeriod: true },
      orderBy: [{ fiscalPeriod: { fiscalYear: "asc" } }, { fiscalPeriod: { quarter: "asc" } }],
    }),
  ]);

  const periodMap = new Map<
    string,
    {
      fiscalYear: number;
      quarter: number;
      targetRevenue: number;
      targetGp: number;
      forecastRevenue: number;
      forecastGp: number;
      backlogRevenue: number;
      backlogGp: number;
      closingRevenue: number;
      closingGp: number;
      activeForecastWeek: number | null;
      latestBacklogWeek: number | null;
    }
  >();

  function periodRow(period: { id: string; fiscalYear: number; quarter: number }) {
    const existing = periodMap.get(period.id);
    if (existing) return existing;
    const row = {
      fiscalYear: period.fiscalYear,
      quarter: period.quarter,
      targetRevenue: 0,
      targetGp: 0,
      forecastRevenue: 0,
      forecastGp: 0,
      backlogRevenue: 0,
      backlogGp: 0,
      closingRevenue: 0,
      closingGp: 0,
      activeForecastWeek: null,
      latestBacklogWeek: null,
    };
    periodMap.set(period.id, row);
    return row;
  }

  for (const target of targets) {
    const row = periodRow(target.fiscalPeriod);
    row.targetRevenue += Number(target.revenue);
    row.targetGp += Number(target.gp);
  }

  for (const forecast of forecasts) {
    if (!forecast.isActive) continue;
    const row = periodRow(forecast.fiscalPeriod);
    row.forecastRevenue += Number(forecast.revenue);
    row.forecastGp += Number(forecast.gp);
    row.activeForecastWeek = forecast.weekNumber;
  }

  for (const actual of actuals) {
    const row = periodRow(actual.fiscalPeriod);
    row.backlogRevenue += Number(actual.backlog);
    row.backlogGp += Number(actual.invoiced);
    row.latestBacklogWeek = Math.max(row.latestBacklogWeek ?? 0, actual.weekNumber);
  }

  for (const closing of closings) {
    const row = periodRow(closing.fiscalPeriod);
    row.closingRevenue += Number(closing.revenue);
    row.closingGp += Number(closing.gp);
  }

  const periods = Array.from(periodMap.values()).sort(
    (a, b) => b.fiscalYear - a.fiscalYear || b.quarter - a.quarter
  );

  const totals = periods.reduce(
    (acc, row) => {
      acc.targetRevenue += row.targetRevenue;
      acc.targetGp += row.targetGp;
      acc.forecastRevenue += row.forecastRevenue;
      acc.forecastGp += row.forecastGp;
      acc.backlogRevenue += row.backlogRevenue;
      acc.backlogGp += row.backlogGp;
      acc.closingRevenue += row.closingRevenue;
      acc.closingGp += row.closingGp;
      return acc;
    },
    {
      targetRevenue: 0,
      targetGp: 0,
      forecastRevenue: 0,
      forecastGp: 0,
      backlogRevenue: 0,
      backlogGp: 0,
      closingRevenue: 0,
      closingGp: 0,
    }
  );

  return {
    vendor: {
      id: vendor.id,
      name: vendor.name,
      code: vendor.code,
      logoUrl: vendor.logoUrl,
      isActive: vendor.isActive,
      managerId: vendor.managerId,
      managerName: vendor.manager?.name ?? null,
      managerEmail: vendor.manager?.email ?? null,
      createdAt: vendor.createdAt.toISOString(),
      updatedAt: vendor.updatedAt.toISOString(),
    },
    aliases: vendor.aliases.map((alias) => ({
      id: alias.id,
      alias: alias.alias,
      createdAt: alias.createdAt.toISOString(),
    })),
    counts: {
      aliases: vendor._count.aliases,
      forecasts: vendor._count.forecasts,
      targets: vendor._count.targets,
      actuals: vendor._count.actuals,
      closings: vendor._count.closings,
    },
    totals: {
      ...totals,
      targetGpPercent: calculateGpPercent(totals.targetRevenue, totals.targetGp),
      forecastGpPercent: calculateGpPercent(totals.forecastRevenue, totals.forecastGp),
      backlogGpPercent: calculateGpPercent(totals.backlogRevenue, totals.backlogGp),
      closingGpPercent: calculateGpPercent(totals.closingRevenue, totals.closingGp),
    },
    periods: periods.map((row) => ({
      ...row,
      targetGpPercent: calculateGpPercent(row.targetRevenue, row.targetGp),
      forecastGpPercent: calculateGpPercent(row.forecastRevenue, row.forecastGp),
      backlogGpPercent: calculateGpPercent(row.backlogRevenue, row.backlogGp),
      closingGpPercent: calculateGpPercent(row.closingRevenue, row.closingGp),
    })),
  };
}

/**
 * Creates a vendor with an uppercase-normalized canonical name and optionally associates a single manager.
 */
export async function createVendor(rawData: z.infer<typeof vendorFormSchema>) {
  const user = await requireDirector();

  // Validate inputs
  const validation = vendorFormSchema.safeParse(rawData);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { name, code, logoUrl, managerId } = validation.data;

  // Normalize vendor name
  const normalizedName = name.trim().toUpperCase().replace(/\s+/g, "_");

  // Verify uniqueness of vendor name
  const existing = await prisma.vendor.findUnique({
    where: { name: normalizedName },
  });

  if (existing) {
    return { success: false, error: `"${normalizedName}" vendor kaydı zaten mevcut.` };
  }

  // Enforce manager assignment invariant (active SATIS_MUDURU only)
  try {
    await assertValidManagerAssignment(managerId);
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "Vendor sorumlusu doğrulanamadı.") };
  }

  // Create vendor inside database
  const vendor = await prisma.vendor.create({
    data: {
      name: normalizedName,
      code: code?.trim() || null,
      logoUrl: logoUrl?.trim() || null,
      isActive: true,
      managerId: managerId || null,
    },
  });

  // Write audit log
  await writeAuditLog({
    userId: user.id,
    action: "CREATE_VENDOR",
    entityType: "Vendor",
    entityId: vendor.id,
    newValue: vendor,
  });

  revalidatePath("/admin/vendors");
  return { success: true };
}

/**
 * Updates an existing vendor's details, logo, and responsible manager link.
 */
export async function updateVendor(
  id: string,
  rawData: z.infer<typeof vendorFormSchema> & { isActive: boolean }
) {
  const user = await requireDirector();

  const validation = vendorFormSchema.safeParse(rawData);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { name, code, logoUrl, managerId } = validation.data;
  const normalizedName = name.trim().toUpperCase().replace(/\s+/g, "_");

  const existing = await prisma.vendor.findUnique({
    where: { id },
  });

  if (!existing) {
    return { success: false, error: "Düzenlenmek istenen vendor bulunamadı." };
  }

  // Verify name uniqueness if it is changing
  if (normalizedName !== existing.name) {
    const nameExists = await prisma.vendor.findUnique({
      where: { name: normalizedName },
    });
    if (nameExists) {
      return { success: false, error: `"${normalizedName}" vendor kaydı zaten mevcut.` };
    }
  }

  // Enforce manager assignment invariant (active SATIS_MUDURU only)
  try {
    await assertValidManagerAssignment(managerId);
  } catch (err: unknown) {
    return { success: false, error: getErrorMessage(err, "Vendor sorumlusu doğrulanamadı.") };
  }

  // Update vendor details and the responsible manager (single scalar field)
  const updated = await prisma.vendor.update({
    where: { id },
    data: {
      name: normalizedName,
      code: code?.trim() || null,
      logoUrl: logoUrl?.trim() || null,
      isActive: rawData.isActive,
      managerId: managerId || null,
    },
  });

  // Write audit log
  await writeAuditLog({
    userId: user.id,
    action: "UPDATE_VENDOR",
    entityType: "Vendor",
    entityId: id,
    oldValue: existing,
    newValue: updated,
  });

  revalidatePath("/admin/vendors");
  return { success: true };
}

/**
 * Deletes a vendor from the system. Prevents deletion if related financial records exist.
 */
export async function deleteVendor(id: string) {
  const user = await requireDirector();

  const existing = await prisma.vendor.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          forecasts: true,
          targets: true,
          actuals: true,
        },
      },
    },
  });

  if (!existing) {
    return { success: false, error: "Silinmek istenen vendor bulunamadı." };
  }

  // Block deletion if database constraints are active
  if (
    existing._count.forecasts > 0 ||
    existing._count.targets > 0 ||
    existing._count.actuals > 0
  ) {
    return {
      success: false,
      error: "Bu vendor silinemez çünkü ilişkili forecast, hedef veya gerçekleşen veri bulunmaktadır. Lütfen silmek yerine pasifleştiriniz.",
    };
  }

  await prisma.vendor.delete({
    where: { id },
  });

  await writeAuditLog({
    userId: user.id,
    action: "DELETE_VENDOR",
    entityType: "Vendor",
    entityId: id,
    oldValue: existing,
  });

  revalidatePath("/admin/vendors");
  return { success: true };
}

/**
 * Returns all aliases registered for a specific vendor.
 */
export async function getVendorAliases(vendorId: string) {
  await requireDirector();
  return prisma.vendorAlias.findMany({
    where: { vendorId },
    orderBy: { alias: "asc" },
  });
}

/**
 * Adds an alternative Excel name alias to a vendor.
 */
export async function addVendorAlias(vendorId: string, alias: string) {
  const user = await requireDirector();
  const normalizedAlias = alias.trim();

  if (!normalizedAlias) {
    return { success: false, error: "Takma ad boş olamaz." };
  }

  // 1. Verify global uniqueness across all vendor aliases
  const existingAlias = await prisma.vendorAlias.findUnique({
    where: { alias: normalizedAlias },
    include: { vendor: true },
  });

  if (existingAlias) {
    return {
      success: false,
      error: `Bu takma ad zaten "${existingAlias.vendor.name}" vendor kaydına atanmıştır.`,
    };
  }

  // 2. Prevent setting alias identical to a canonical vendor name
  const canonicalVendor = await prisma.vendor.findUnique({
    where: { name: normalizedAlias.toUpperCase().replace(/\s+/g, "_") },
  });

  if (canonicalVendor) {
    return {
      success: false,
      error: `Bu takma ad, "${canonicalVendor.name}" vendor kaydının ana adı ile çakışmaktadır.`,
    };
  }

  const newAlias = await prisma.vendorAlias.create({
    data: {
      vendorId,
      alias: normalizedAlias,
    },
  });

  // Write audit log
  await writeAuditLog({
    userId: user.id,
    action: "ADD_VENDOR_ALIAS",
    entityType: "VendorAlias",
    entityId: newAlias.id,
    newValue: newAlias,
  });

  revalidatePath("/admin/vendors");
  return { success: true };
}

/**
 * Deletes a vendor alias from the database.
 */
export async function deleteVendorAlias(aliasId: string) {
  const user = await requireDirector();

  const existing = await prisma.vendorAlias.findUnique({
    where: { id: aliasId },
  });

  if (!existing) {
    return { success: false, error: "Silinmek istenen takma ad bulunamadı." };
  }

  await prisma.vendorAlias.delete({
    where: { id: aliasId },
  });

  // Write audit log
  await writeAuditLog({
    userId: user.id,
    action: "DELETE_VENDOR_ALIAS",
    entityType: "VendorAlias",
    entityId: aliasId,
    oldValue: existing,
  });

  revalidatePath("/admin/vendors");
  return { success: true };
}
