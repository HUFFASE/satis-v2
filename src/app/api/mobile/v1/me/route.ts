import prisma from "@/lib/prisma";
import { getAccessibleVendorIds } from "@/lib/scope";
import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";

export async function GET(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
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
        logoUrl: true,
        managerId: true,
      },
      orderBy: { name: "asc" },
    });

    return mobileOk({
      user,
      vendors,
    });
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Mobil kullanıcı bilgisi alınamadı."), 401, "unauthorized");
  }
}
