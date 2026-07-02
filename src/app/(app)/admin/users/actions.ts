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
