import { z } from "zod";
import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobileTargets, upsertMobileTarget } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";
import { getQueryObject, periodQuerySchema } from "../_utils";

const upsertSchema = z.object({
  vendorId: z.string().min(1),
  fiscalYear: z.number().int().min(2000).max(2100),
  quarter: z.number().int().min(1).max(4),
  revenue: z.number().min(0),
  gp: z.number().min(0),
});

export async function GET(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    const validation = periodQuerySchema.safeParse(getQueryObject(request));
    if (!validation.success) return mobileError(validation.error.issues[0].message, 400, "validation_error");
    return mobileOk(await getMobileTargets(user, validation.data.fiscalYear, validation.data.quarter));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Target verileri alınamadı."), 400, "targets_failed");
  }
}

export async function POST(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    const validation = upsertSchema.safeParse(await request.json());
    if (!validation.success) return mobileError(validation.error.issues[0].message, 400, "validation_error");
    return mobileOk(await upsertMobileTarget(user, validation.data));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Target kaydedilemedi."), 400, "target_save_failed");
  }
}
