import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobileAdminUsers } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";

export async function GET(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    return mobileOk(await getMobileAdminUsers(user));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Kullanıcı verileri alınamadı."), 403, "admin_users_failed");
  }
}
