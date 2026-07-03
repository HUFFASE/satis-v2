import { z } from "zod";
import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobileForecastTrends } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";
import { getQueryObject } from "../_utils";

const querySchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2100).optional(),
  quarters: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((part) => Number(part.trim()))
            .filter((quarter) => Number.isInteger(quarter))
        : undefined
    ),
  managerId: z.string().optional(),
  vendorId: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    const validation = querySchema.safeParse(getQueryObject(request));
    if (!validation.success) return mobileError(validation.error.issues[0].message, 400, "validation_error");
    return mobileOk(await getMobileForecastTrends(user, validation.data));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Forecast trend verileri alınamadı."), 400, "forecast_trends_failed");
  }
}
