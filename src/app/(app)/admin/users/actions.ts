"use server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { hashPassword } from "@/lib/auth-utils";
import { passwordSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Validates that the active session belongs to a DIREKTOR.
 */
async function requireDirector() {
  const session = await auth();
  if (!session?.user || session.user.role !== "DIREKTOR") {
    throw new Error("Bu işlemi gerçekleştirmek için yetkiniz bulunmamaktadır.");
  }
  return session.user;
}

// Zod schemas for input validation
const createUserSchema = z.object({
  name: z.string().min(1, "Ad Soyad alanı boş olamaz."),
  email: z.string().email("Geçerli bir e-posta adresi giriniz."),
  role: z.enum(["DIREKTOR", "SATIS_MUDURU"]),
  password: passwordSchema,
  isActive: z.boolean(),
  imageUrl: z.string().url("Geçersiz görsel URL formatı.").or(z.literal("")).optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(1, "Ad Soyad alanı boş olamaz."),
  email: z.string().email("Geçerli bir e-posta adresi giriniz."),
  role: z.enum(["DIREKTOR", "SATIS_MUDURU"]),
  isActive: z.boolean(),
  imageUrl: z.string().url("Geçersiz görsel URL formatı.").or(z.literal("")).optional(),
});

/**
 * Retrieves all users in alphabetical order, detailing their role,
 * active status, profile image URL, and assigned vendor details. NEVER returns password hashes.
 */
export async function getUsers() {
  await requireDirector();

  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      imageUrl: true,
      managedVendors: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    imageUrl: u.imageUrl,
    assignedVendors: u.managedVendors.map((b) => b.name),
    assignedVendorIds: u.managedVendors.map((b) => b.id),
  }));
}

function calculateGpPercent(revenue: number, gp: number) {
  return revenue > 0 ? (gp / revenue) * 100 : 0;
}

export async function getUserDetail(userId: string) {
  await requireDirector();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      imageUrl: true,
      createdAt: true,
      updatedAt: true,
      managedVendors: {
        select: {
          id: true,
          name: true,
          code: true,
          isActive: true,
        },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!user) {
    throw new Error("Kullanıcı bulunamadı.");
  }

  const vendors =
    user.role === "DIREKTOR"
      ? await prisma.vendor.findMany({
          where: { isActive: true },
          select: { id: true, name: true, code: true, isActive: true },
          orderBy: { name: "asc" },
        })
      : user.managedVendors;
  const vendorIds = vendors.map((vendor) => vendor.id);

  const [targets, forecasts, actuals, closings] =
    vendorIds.length === 0
      ? [[], [], [], []]
      : await Promise.all([
          prisma.target.findMany({
            where: { vendorId: { in: vendorIds } },
            include: { fiscalPeriod: true, vendor: { select: { name: true } } },
            orderBy: [{ fiscalPeriod: { fiscalYear: "asc" } }, { fiscalPeriod: { quarter: "asc" } }],
          }),
          prisma.forecast.findMany({
            where: { vendorId: { in: vendorIds }, isActive: true },
            include: { fiscalPeriod: true, vendor: { select: { name: true } } },
            orderBy: [{ fiscalPeriod: { fiscalYear: "asc" } }, { fiscalPeriod: { quarter: "asc" } }],
          }),
          prisma.actual.findMany({
            where: { vendorId: { in: vendorIds } },
            include: { fiscalPeriod: true, vendor: { select: { name: true } } },
            orderBy: [{ fiscalPeriod: { fiscalYear: "asc" } }, { fiscalPeriod: { quarter: "asc" } }, { weekNumber: "asc" }],
          }),
          prisma.closing.findMany({
            where: { vendorId: { in: vendorIds } },
            include: { fiscalPeriod: true, vendor: { select: { name: true } } },
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
      vendorCount: Set<string>;
    }
  >();
  const vendorMap = new Map<
    string,
    {
      vendorId: string;
      vendorName: string;
      targetRevenue: number;
      targetGp: number;
      forecastRevenue: number;
      forecastGp: number;
      backlogRevenue: number;
      backlogGp: number;
      closingRevenue: number;
      closingGp: number;
    }
  >();

  function emptyVendor(vendorId: string, vendorName: string) {
    return {
      vendorId,
      vendorName,
      targetRevenue: 0,
      targetGp: 0,
      forecastRevenue: 0,
      forecastGp: 0,
      backlogRevenue: 0,
      backlogGp: 0,
      closingRevenue: 0,
      closingGp: 0,
    };
  }

  for (const vendor of vendors) {
    vendorMap.set(vendor.id, emptyVendor(vendor.id, vendor.name));
  }

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
      vendorCount: new Set<string>(),
    };
    periodMap.set(period.id, row);
    return row;
  }

  function vendorRow(vendorId: string, vendorName: string) {
    const existing = vendorMap.get(vendorId);
    if (existing) return existing;
    const row = emptyVendor(vendorId, vendorName);
    vendorMap.set(vendorId, row);
    return row;
  }

  for (const target of targets) {
    const period = periodRow(target.fiscalPeriod);
    const vendor = vendorRow(target.vendorId, target.vendor.name);
    const revenue = Number(target.revenue);
    const gp = Number(target.gp);
    period.targetRevenue += revenue;
    period.targetGp += gp;
    period.vendorCount.add(target.vendorId);
    vendor.targetRevenue += revenue;
    vendor.targetGp += gp;
  }

  for (const forecast of forecasts) {
    const period = periodRow(forecast.fiscalPeriod);
    const vendor = vendorRow(forecast.vendorId, forecast.vendor.name);
    const revenue = Number(forecast.revenue);
    const gp = Number(forecast.gp);
    period.forecastRevenue += revenue;
    period.forecastGp += gp;
    period.vendorCount.add(forecast.vendorId);
    vendor.forecastRevenue += revenue;
    vendor.forecastGp += gp;
  }

  for (const actual of actuals) {
    const period = periodRow(actual.fiscalPeriod);
    const vendor = vendorRow(actual.vendorId, actual.vendor.name);
    const revenue = Number(actual.backlog);
    const gp = Number(actual.invoiced);
    period.backlogRevenue += revenue;
    period.backlogGp += gp;
    period.vendorCount.add(actual.vendorId);
    vendor.backlogRevenue += revenue;
    vendor.backlogGp += gp;
  }

  for (const closing of closings) {
    const period = periodRow(closing.fiscalPeriod);
    const vendor = vendorRow(closing.vendorId, closing.vendor.name);
    const revenue = Number(closing.revenue);
    const gp = Number(closing.gp);
    period.closingRevenue += revenue;
    period.closingGp += gp;
    period.vendorCount.add(closing.vendorId);
    vendor.closingRevenue += revenue;
    vendor.closingGp += gp;
  }

  const periods = Array.from(periodMap.values()).sort(
    (a, b) => b.fiscalYear - a.fiscalYear || b.quarter - a.quarter
  );
  const vendorRows = Array.from(vendorMap.values()).sort((a, b) => a.vendorName.localeCompare(b.vendorName, "tr"));
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
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      imageUrl: user.imageUrl,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
    vendors,
    counts: {
      vendors: vendors.length,
      targets: targets.length,
      forecasts: forecasts.length,
      actuals: actuals.length,
      closings: closings.length,
    },
    totals: {
      ...totals,
      targetGpPercent: calculateGpPercent(totals.targetRevenue, totals.targetGp),
      forecastGpPercent: calculateGpPercent(totals.forecastRevenue, totals.forecastGp),
      backlogGpPercent: calculateGpPercent(totals.backlogRevenue, totals.backlogGp),
      closingGpPercent: calculateGpPercent(totals.closingRevenue, totals.closingGp),
    },
    periods: periods.map((row) => ({
      fiscalYear: row.fiscalYear,
      quarter: row.quarter,
      vendorCount: row.vendorCount.size,
      targetRevenue: row.targetRevenue,
      targetGp: row.targetGp,
      forecastRevenue: row.forecastRevenue,
      forecastGp: row.forecastGp,
      backlogRevenue: row.backlogRevenue,
      backlogGp: row.backlogGp,
      closingRevenue: row.closingRevenue,
      closingGp: row.closingGp,
    })),
    vendorRows,
  };
}

/**
 * Creates a new user in the system.
 */
export async function createUser(rawData: z.infer<typeof createUserSchema>) {
  const admin = await requireDirector();

  // Validate fields
  const validation = createUserSchema.safeParse(rawData);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { name, email, role, password, isActive, imageUrl } = validation.data;
  const normalizedEmail = email.trim().toLowerCase();

  // Check email uniqueness
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existing) {
    return { success: false, error: "Bu e-posta adresi ile kayıtlı bir kullanıcı zaten mevcut." };
  }

  const hashedPassword = await hashPassword(password);

  // Insert user inside the database
  const user = await prisma.user.create({
    data: {
      name,
      email: normalizedEmail,
      role,
      passwordHash: hashedPassword,
      isActive,
      imageUrl: imageUrl?.trim() || null,
    },
  });

  // Write audit log (omitting password credentials)
  await writeAuditLog({
    userId: admin.id,
    action: "CREATE_USER",
    entityType: "User",
    entityId: user.id,
    newValue: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      imageUrl: user.imageUrl,
    },
  });

  revalidatePath("/admin/users");
  return { success: true };
}

/**
 * Updates details for a user. Enforces admin-count safeguards.
 */
export async function updateUser(
  id: string,
  rawData: z.infer<typeof updateUserSchema>
) {
  const admin = await requireDirector();

  // Self-update guard: prevent modifying one's own role or active status
  if (admin.id === id && (rawData.role !== "DIREKTOR" || !rawData.isActive)) {
    return {
      success: false,
      error: "Kendi hesabınızın rolünü değiştiremez veya kendinizi pasifleştiremezsiniz.",
    };
  }

  const validation = updateUserSchema.safeParse(rawData);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const { name, email, role, isActive, imageUrl } = validation.data;
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { id },
  });

  if (!existing) {
    return { success: false, error: "Güncellenmek istenen kullanıcı bulunamadı." };
  }

  // Check email uniqueness if email has changed
  if (normalizedEmail !== existing.email) {
    const emailExists = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (emailExists) {
      return { success: false, error: "Bu e-posta adresi başka bir kullanıcı tarafından kullanılmaktadır." };
    }
  }

  // Safeguard: Prevent leaving 0 active DIREKTORs
  if (existing.role === "DIREKTOR" && existing.isActive) {
    if (!isActive || role !== "DIREKTOR") {
      const activeDirectorsCount = await prisma.user.count({
        where: {
          role: "DIREKTOR",
          isActive: true,
        },
      });
      if (activeDirectorsCount <= 1) {
        return {
          success: false,
          error: "Sistemde en az bir aktif direktör bulunmalıdır. Bu kullanıcının rolü veya aktifliği değiştirilemez.",
        };
      }
    }
  }

  // Update user details
  const updated = await prisma.user.update({
    where: { id },
    data: {
      name,
      email: normalizedEmail,
      role,
      isActive,
      imageUrl: imageUrl?.trim() || null,
    },
  });

  // Write audit log
  await writeAuditLog({
    userId: admin.id,
    action: "UPDATE_USER",
    entityType: "User",
    entityId: id,
    oldValue: {
      id: existing.id,
      name: existing.name,
      email: existing.email,
      role: existing.role,
      isActive: existing.isActive,
      imageUrl: existing.imageUrl,
    },
    newValue: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      isActive: updated.isActive,
      imageUrl: updated.imageUrl,
    },
  });

  revalidatePath("/admin/users");
  return { success: true };
}

/**
 * Resets a user's password. Requires director session and password validation.
 */
export async function resetUserPassword(id: string, rawPassword: string) {
  const admin = await requireDirector();

  const validation = passwordSchema.safeParse(rawPassword);
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0].message };
  }

  const existing = await prisma.user.findUnique({
    where: { id },
  });

  if (!existing) {
    return { success: false, error: "Kullanıcı bulunamadı." };
  }

  const hashedPassword = await hashPassword(validation.data);

  await prisma.user.update({
    where: { id },
    data: {
      passwordHash: hashedPassword,
    },
  });

  // Audit password reset action without exposing credentials
  await writeAuditLog({
    userId: admin.id,
    action: "RESET_USER_PASSWORD",
    entityType: "User",
    entityId: id,
    newValue: { status: "PASSWORD_RESET_SUCCESS" },
  });

  return { success: true };
}

/**
 * Toggles user active status. Enforces safeguards.
 */
export async function toggleUserActive(id: string) {
  const admin = await requireDirector();

  if (admin.id === id) {
    return { success: false, error: "Kendi hesabınızı pasifleştiremezsiniz." };
  }

  const existing = await prisma.user.findUnique({
    where: { id },
  });

  if (!existing) {
    return { success: false, error: "Kullanıcı bulunamadı." };
  }

  const targetActiveState = !existing.isActive;

  // Safeguard: check if turning off the last active director
  if (existing.role === "DIREKTOR" && existing.isActive && !targetActiveState) {
    const activeDirectorsCount = await prisma.user.count({
      where: {
        role: "DIREKTOR",
        isActive: true,
      },
    });
    if (activeDirectorsCount <= 1) {
      return {
        success: false,
        error: "Sistemde en az bir aktif direktör bulunmalıdır. Bu kullanıcının aktifliği kapatılamaz.",
      };
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      isActive: targetActiveState,
    },
  });

  await writeAuditLog({
    userId: admin.id,
    action: targetActiveState ? "ACTIVATE_USER" : "DEACTIVATE_USER",
    entityType: "User",
    entityId: id,
    oldValue: { isActive: existing.isActive },
    newValue: { isActive: updated.isActive },
  });

  revalidatePath("/admin/users");
  return { success: true };
}

/**
 * Deletes a user. Enforces administrative safeguards.
 */
export async function deleteUser(id: string) {
  const admin = await requireDirector();

  if (admin.id === id) {
    return { success: false, error: "Kendi hesabınızı silemezsiniz." };
  }

  const existing = await prisma.user.findUnique({
    where: { id },
  });

  if (!existing) {
    return { success: false, error: "Silinmek istenen kullanıcı bulunamadı." };
  }

  // Safeguard: Check last active director
  if (existing.role === "DIREKTOR" && existing.isActive) {
    const activeDirectorsCount = await prisma.user.count({
      where: {
        role: "DIREKTOR",
        isActive: true,
      },
    });
    if (activeDirectorsCount <= 1) {
      return {
        success: false,
        error: "Sistemde en az bir aktif direktör bulunmalıdır. Bu kullanıcı silinemez.",
      };
    }
  }

  await prisma.user.delete({
    where: { id },
  });

  await writeAuditLog({
    userId: admin.id,
    action: "DELETE_USER",
    entityType: "User",
    entityId: id,
    oldValue: {
      id: existing.id,
      name: existing.name,
      email: existing.email,
      role: existing.role,
      isActive: existing.isActive,
    },
  });

  revalidatePath("/admin/users");
  return { success: true };
}
