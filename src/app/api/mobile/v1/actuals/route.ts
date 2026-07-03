import { z } from "zod";
import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobileActuals, upsertMobileActual } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";
import { getQueryObject } from "../_utils";

const actualsQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
  weekNumber: z.coerce.number().int().min(1).max(14),
});

const upsertSchema = z.object({
  vendorId: z.string().min(1),
  fiscalYear: z.number().int().min(2000).max(2100),
  quarter: z.number().int().min(1).max(4),
  weekNumber: z.number().int().min(1).max(14),
  backlog: z.number().min(0),
  invoiced: z.number().min(0),
});

export async function GET(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    const validation = actualsQuerySchema.safeParse(getQueryObject(request));
    if (!validation.success) return mobileError(validation.error.issues[0].message, 400, "validation_error");
    return mobileOk(await getMobileActuals(user, validation.data.fiscalYear, validation.data.quarter, validation.data.weekNumber));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Actual verileri alınamadı."), 400, "actuals_failed");
  }
}

export async function POST(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    const validation = upsertSchema.safeParse(await request.json());
    if (!validation.success) return mobileError(validation.error.issues[0].message, 400, "validation_error");
    return mobileOk(await upsertMobileActual(user, validation.data));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Actual kaydedilemedi."), 400, "actual_save_failed");
  }
}
