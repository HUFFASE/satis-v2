import { auth } from "@/auth";
import { redirect } from "next/navigation";
import DashboardLayoutClient from "@/components/layout/dashboard-layout-client";
import { TooltipProvider } from "@/components/ui/tooltip";

interface AppLayoutProps {
  children: React.ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const session = await auth();

  // Defense-in-depth: Redirect to login if session does not exist
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <TooltipProvider>
      <DashboardLayoutClient user={session.user}>
        {children}
      </DashboardLayoutClient>
    </TooltipProvider>
  );
}
