import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobileVendors } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";

export async function GET(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    return mobileOk(await getMobileVendors(user));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Vendor verileri alınamadı."), 400, "vendors_failed");
  }
}
