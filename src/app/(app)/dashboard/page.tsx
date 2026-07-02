import DashboardClient from "./dashboard-client";
import { getDashboardData } from "./actions";

export default async function DashboardPage() {
  const data = await getDashboardData();

  return <DashboardClient data={data} />;
}
