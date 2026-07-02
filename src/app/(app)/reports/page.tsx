import { getFiscalContext } from "@/lib/fiscal";
import { getReportsData } from "./actions";
import ReportsClient from "./reports-client";

export default async function ReportsPage() {
  const currentContext = getFiscalContext(new Date());
  const initialData = await getReportsData(currentContext.fiscalYear, [currentContext.quarter]);

  return <ReportsClient initialData={initialData} />;
}
