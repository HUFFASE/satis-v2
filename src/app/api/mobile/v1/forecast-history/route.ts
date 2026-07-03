import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobileForecastHistory } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";
import { getQueryObject, periodQuerySchema } from "../_utils";

export async function GET(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    const validation = periodQuerySchema.safeParse(getQueryObject(request));
    if (!validation.success) return mobileError(validation.error.issues[0].message, 400, "validation_error");
    return mobileOk(await getMobileForecastHistory(user, validation.data.fiscalYear, validation.data.quarter));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Forecast history verileri alınamadı."), 400, "forecast_history_failed");
  }
}
