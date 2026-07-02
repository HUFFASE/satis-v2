import prisma from "./prisma";

interface SessionUser {
  id: string;
  role: string;
}

function getPrismaAccessErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code);

    if (code === "P1001") {
      return "Veritabanına ulaşılamıyor. SSH tüneli veya veritabanı bağlantısını kontrol edin.";
    }

    if (code === "P2021") {
      return "Vendor tablosu veritabanında bulunamadı. Prisma migration/schema durumunu kontrol edin.";
    }

    if (code === "P2022") {
      return "Vendor tablosundaki kolonlar Prisma şemasıyla uyumlu değil. Migration/schema durumunu kontrol edin.";
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Vendor erişim bilgileri alınırken beklenmeyen bir hata oluştu.";
}

/**
 * Returns an array of vendor IDs that the given user session is authorized to access.
 * - DIREKTOR: Returns all active vendors.
 * - SATIS_MUDURU: Returns only assigned vendors.
 */
export async function getAccessibleVendorIds(user: SessionUser): Promise<string[]> {
  try {
    if (user.role === "DIREKTOR") {
      const vendors = await prisma.vendor.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      return vendors.map((b) => b.id);
    }

    // Sales manager (SATIS_MUDURU): fetch vendors they are the responsible manager for.
    const managedVendors = await prisma.vendor.findMany({
      where: {
        managerId: user.id,
        isActive: true,
      },
      select: { id: true },
    });
    return managedVendors.map((b) => b.id);
  } catch (error: unknown) {
    throw new Error(getPrismaAccessErrorMessage(error));
  }
}

/**
 * Asserts that the current session user has access to a specific vendor ID.
 * Throws an Error if unauthorized.
 */
export async function assertVendorAccess(user: SessionUser, vendorId: string): Promise<void> {
  const accessibleIds = await getAccessibleVendorIds(user);
  if (!accessibleIds.includes(vendorId)) {
    throw new Error("Bu vendor kaydına erişim yetkiniz bulunmamaktadır.");
  }
}
