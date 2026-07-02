"use client";

import React, { useState } from "react";
import Sidebar from "./sidebar";
import Topbar from "./topbar";

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  user: {
    name?: string | null;
    role?: string | null;
    email?: string | null;
  };
}

export default function DashboardLayoutClient({ children, user }: DashboardLayoutClientProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="min-h-screen flex bg-white dark:bg-slate-950">
      {/* Fixed Navigation Sidebar */}
      <Sidebar user={user} isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />

      {/* Main Content Wrapper */}
      <div 
        className={`flex flex-col flex-1 min-w-0 transition-all duration-300 ${
          isCollapsed ? "pl-16" : "pl-64"
        }`}
      >
        {/* Header Navigation bar */}
        <Topbar user={user} />

        {/* Dynamic page contents with light cream corporate background */}
        <main className="flex-1 bg-white dark:bg-slate-950 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
