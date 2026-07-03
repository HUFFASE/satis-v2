import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getQuarterWeeks } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";
import { getQueryObject, periodQuerySchema } from "../../_utils";

export async function GET(request: Request) {
  try {
    await authenticateMobileRequest(request);
    const validation = periodQuerySchema.safeParse(getQueryObject(request));
    if (!validation.success) return mobileError(validation.error.issues[0].message, 400, "validation_error");
    return mobileOk({
      fiscalYear: validation.data.fiscalYear,
      quarter: validation.data.quarter,
      weeks: getQuarterWeeks(validation.data.fiscalYear, validation.data.quarter),
    });
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Hafta verileri alınamadı."), 400, "period_weeks_failed");
  }
}
