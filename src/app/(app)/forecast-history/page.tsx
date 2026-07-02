import { getCurrentFiscalContext } from "@/lib/fiscal";
import { getForecastHistoryData } from "./actions";
import ForecastHistoryClient from "./forecast-history-client";

export default async function ForecastHistoryPage() {
  const current = getCurrentFiscalContext();
  const data = await getForecastHistoryData(current.fiscalYear, current.quarter);

  return <ForecastHistoryClient initialData={data} />;
}
