import { z } from "zod";
import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getMobilePeriods } from "@/server/mobile/data-service";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";
import { getQueryObject } from "../_utils";

const querySchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

export async function GET(request: Request) {
  try {
    await authenticateMobileRequest(request);
    const validation = querySchema.safeParse(getQueryObject(request));
    if (!validation.success) return mobileError(validation.error.issues[0].message, 400, "validation_error");
    return mobileOk(await getMobilePeriods(validation.data.fiscalYear));
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Dönem verileri alınamadı."), 400, "periods_failed");
  }
}
