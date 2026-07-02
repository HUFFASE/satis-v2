import { auth } from "@/auth";
import { redirect } from "next/navigation";

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const session = await auth();

  // Defense-in-depth guard: Force redirect standard users to the main dashboard
  if (session?.user?.role !== "DIREKTOR") {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
