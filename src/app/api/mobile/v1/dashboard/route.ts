import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobileDashboard } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";
import { getQueryObject, optionalYearQuartersQuerySchema } from "../_utils";

export async function GET(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    const validation = optionalYearQuartersQuerySchema.safeParse(getQueryObject(request));
    if (!validation.success) return mobileError(validation.error.issues[0].message, 400, "validation_error");
    return mobileOk(await getMobileDashboard(user, validation.data.fiscalYear, validation.data.quarters));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Dashboard verileri alınamadı."), 400, "dashboard_failed");
  }
}
