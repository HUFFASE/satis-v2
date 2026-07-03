import { z } from "zod";
import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobileForecastVersions } from "@/server/mobile/forecast-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";

const periodQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
});

interface RouteContext {
  params: Promise<{
    vendorId: string;
  }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await authenticateMobileRequest(request);
    const { vendorId } = await context.params;
    const url = new URL(request.url);
    const validation = periodQuerySchema.safeParse({
      fiscalYear: url.searchParams.get("fiscalYear"),
      quarter: url.searchParams.get("quarter"),
    });

    if (!validation.success) {
      return mobileError(validation.error.issues[0].message, 400, "validation_error");
    }

    const versions = await getMobileForecastVersions(
      user,
      vendorId,
      validation.data.fiscalYear,
      validation.data.quarter
    );

    return mobileOk({ versions });
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Forecast geçmişi alınamadı."), 400, "forecast_versions_failed");
  }
}
