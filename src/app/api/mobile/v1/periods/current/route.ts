import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { formatFiscalPeriod, getFiscalContext } from "@/lib/fiscal";
import { authenticateMobileRequest } from "@/server/mobile/auth";
import { getErrorMessage, mobileError, mobileOk } from "@/server/mobile/responses";

export async function GET(request: Request) {
  try {
    await authenticateMobileRequest(request);
    const context = getFiscalContext(new Date());
    const period = await ensureFiscalPeriod(context.fiscalYear, context.quarter);

    return mobileOk({
      ...context,
      label: formatFiscalPeriod(context.fiscalYear, context.quarter),
      isLocked: period.isLocked,
      periodId: period.id,
    });
  } catch (error: unknown) {
    return mobileError(getErrorMessage(error, "Aktif dönem bilgisi alınamadı."), 401, "unauthorized");
  }
}
