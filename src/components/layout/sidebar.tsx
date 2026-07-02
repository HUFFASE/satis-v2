"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TrendingUp,
  LayoutDashboard,
  CalendarDays,
  History,
  Target,
  BarChart3,
  CheckCircle2,
  Users2,
  FolderLock,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
} from "lucide-react";

interface SidebarProps {
  user: {
    name?: string | null;
    role?: string | null;
    email?: string | null;
  };
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

export default function Sidebar({ user, isCollapsed, setIsCollapsed }: SidebarProps) {
  const pathname = usePathname();

  const role = user.role || "SATIS_MUDURU";
  const formattedRole = role === "DIREKTOR" ? "DİREKTÖR" : "SATIŞ MÜDÜRÜ";

  // Get initials for Avatar fallback
  const getInitials = (name?: string | null) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  const navGroups = [
    {
      title: "GENEL",
      items: [
        { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      ],
    },
    {
      title: "FORECAST",
      items: [
        { name: "Forecast Giriş", href: "/forecast-input", icon: CalendarDays },
        { name: "Geçmiş", href: "/forecast-history", icon: History },
      ],
    },
    {
      title: "HEDEF & BACKLOG",
      items: [
        { name: "Hedefler", href: "/targets", icon: Target },
        { name: "Backlog", href: "/actuals", icon: TrendingDown },
        { name: "Kapanış", href: "/closing", icon: CheckCircle2 },
      ],
    },
    {
      title: "ANALİZ",
      items: [
        { name: "Raporlama", href: "/reports", icon: BarChart3 },
      ],
    },
    {
      title: "YÖNETİM",
      roles: ["DIREKTOR"],
      items: [
        { name: "Kullanıcı Yönetimi", href: "/admin/users", icon: Users2 },
        { name: "Vendor Yönetimi", href: "/admin/vendors", icon: FolderLock },
      ],
    },
  ];

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "flex flex-col h-screen fixed left-0 top-0 bg-[#1F3A2E] text-slate-100 border-r border-slate-800 transition-all duration-300 z-40 select-none shadow-xl",
          isCollapsed ? "w-16" : "w-64"
        )}
      >
        {/* Header / app name */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-emerald-900/40">
          <Link href="/dashboard" className="flex items-center gap-2 overflow-hidden shrink-0">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-emerald-700/60 text-white shrink-0">
              <TrendingUp className="h-5 w-5" />
            </div>
            {!isCollapsed && (
              <span className="font-serif font-semibold text-lg tracking-wide text-white whitespace-nowrap animate-in fade-in">
                SATIŞ FORECAST
              </span>
            )}
          </Link>
          {!isCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsCollapsed(true)}
              className="text-slate-300 hover:text-white hover:bg-emerald-800/40 h-8 w-8 shrink-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Collapsed Toggle Button */}
        {isCollapsed && (
          <div className="flex justify-center py-2 border-b border-emerald-900/40">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsCollapsed(false)}
              className="text-slate-300 hover:text-white hover:bg-emerald-800/40 h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Navigation List */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin scrollbar-thumb-emerald-900">
          {navGroups.map((group, groupIdx) => {
            // Filter groups by user role
            if (group.roles && !group.roles.includes(role)) {
              return null;
            }

            return (
              <div key={groupIdx} className="space-y-1">
                {!isCollapsed && (
                  <h3 className="px-3 text-xs font-semibold text-emerald-400/70 tracking-wider">
                    {group.title}
                  </h3>
                )}
                <div className="space-y-1">
                  {group.items.map((item, itemIdx) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;

                    const linkContent = (
                      <Link
                        href={item.href}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group duration-150",
                          isActive
                            ? "bg-[#2E5A43] text-white shadow-inner font-semibold"
                            : "text-slate-300 hover:bg-emerald-800/20 hover:text-white"
                        )}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-white" : "text-emerald-400 group-hover:text-white")} />
                        {!isCollapsed && <span className="truncate">{item.name}</span>}
                      </Link>
                    );

                    if (isCollapsed) {
                      return (
                        <Tooltip key={itemIdx}>
                          <TooltipTrigger render={linkContent} />
                          <TooltipContent side="right" className="bg-[#1f3a2e] text-white border-emerald-800">
                            {item.name}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return <React.Fragment key={itemIdx}>{linkContent}</React.Fragment>;
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User profile card at bottom */}
        <div className="p-3 border-t border-emerald-900/40 bg-emerald-950/20">
          <div className={cn("flex items-center gap-3 overflow-hidden", isCollapsed ? "justify-center" : "")}>
            <Avatar className="h-9 w-9 border border-emerald-800/80 shrink-0">
              <AvatarFallback className="bg-emerald-800 text-white text-xs font-bold">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            {!isCollapsed && (
              <div className="flex-1 min-w-0 flex flex-col items-start gap-0.5">
                <span className="text-sm font-semibold text-slate-100 truncate w-full">
                  {user.name}
                </span>
                <Badge className="text-[10px] px-1.5 py-0 bg-emerald-800 hover:bg-emerald-800 text-emerald-100 font-sans tracking-wide shrink-0">
                  {formattedRole}
                </Badge>
              </div>
            )}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
