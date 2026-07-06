import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobileClosings, upsertMobileClosing } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";
import { getQueryObject, periodQuerySchema } from "../_utils";
import { z } from "zod";

const upsertSchema = z
  .object({
    vendorId: z.string().min(1),
    fiscalYear: z.number().int().min(2000).max(2100),
    quarter: z.number().int().min(1).max(4),
    revenue: z.number().min(0),
    gp: z.number().min(0),
  })
  .refine((value) => value.gp <= value.revenue, {
    message: "GP değeri revenue değerinden büyük olamaz.",
    path: ["gp"],
  });

export async function GET(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    const validation = periodQuerySchema.safeParse(getQueryObject(request));
    if (!validation.success) return mobileError(validation.error.issues[0].message, 400, "validation_error");
    return mobileOk(await getMobileClosings(user, validation.data.fiscalYear, validation.data.quarter));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Closing verileri alınamadı."), 400, "closings_failed");
  }
}

export async function POST(request: Request) {
  try {
    const user = await authenticateMobileRequest(request);
    const validation = upsertSchema.safeParse(await request.json());
    if (!validation.success) return mobileError(validation.error.issues[0].message, 400, "validation_error");
    return mobileOk(await upsertMobileClosing(user, validation.data));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Closing kaydedilemedi."), 400, "closing_save_failed");
  }
}
