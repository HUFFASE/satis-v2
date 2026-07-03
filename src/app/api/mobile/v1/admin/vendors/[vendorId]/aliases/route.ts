import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobileVendorAliases } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";

interface RouteContext {
  params: Promise<{
    vendorId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await authenticateMobileRequest(request);
    const { vendorId } = await context.params;
    return mobileOk(await getMobileVendorAliases(user, vendorId));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Vendor alias verileri alınamadı."), 403, "vendor_aliases_failed");
  }
}
