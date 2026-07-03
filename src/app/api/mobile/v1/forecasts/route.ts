import { z } from "zod";
import { authenticateMobileRequest } from "@/server/mobile/auth";
import {
  getMobileActiveForecasts,
  submitMobileForecast,
} from "@/server/mobile/forecast-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";

const periodQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
});

const submitForecastSchema = z.object({
  vendorId: z.string().min(1, "Vendor seçimi zorunludur."),
  fiscalYear: z.number().int().min(2000).max(2100),
  quarter: z.number().int().min(1).max(4),
  revenue: z.number().min(0, "Revenue değeri sıfırdan küçük olamaz."),
  gp: z.number().min(0, "GP değeri sıfırdan küçük olamaz."),
});

export async function GET(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    const url = new URL(request.url);
    const validation = periodQuerySchema.safeParse({
      fiscalYear: url.searchParams.get("fiscalYear"),
      quarter: url.searchParams.get("quarter"),
    });

    if (!validation.success) {
      return mobileError(validation.error.issues[0].message, 400, "validation_error");
    }

    const forecasts = await getMobileActiveForecasts(user, validation.data.fiscalYear, validation.data.quarter);
    return mobileOk({ forecasts });
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Forecast verileri alınamadı."), 401, "forecast_fetch_failed");
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return mobileError("Geçerli bir JSON gövdesi gönderiniz.", 400, "invalid_json");
  }

  const validation = submitForecastSchema.safeParse(body);
  if (!validation.success) {
    return mobileError(validation.error.issues[0].message, 400, "validation_error");
  }

  try {
    const user = await authenticateMobileRequest(request);
    const result = await submitMobileForecast(user, validation.data);
    return mobileOk(result);
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Forecast kaydedilemedi."), 400, "forecast_submit_failed");
  }
}
