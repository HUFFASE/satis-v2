import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobileAdminVendors } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";

export async function GET(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    return mobileOk(await getMobileAdminVendors(user));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Admin vendor verileri alınamadı."), 403, "admin_vendors_failed");
  }
}
