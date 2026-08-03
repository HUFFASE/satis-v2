"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AlertTriangle, Bell, CheckCircle2, LogOut } from "lucide-react";
import { getNotificationGroups } from "./notification-actions";

type NotificationGroup = Awaited<ReturnType<typeof getNotificationGroups>>[number];

interface TopbarProps {
  user: {
    name?: string | null;
    role?: string | null;
    email?: string | null;
  };
}

export default function Topbar({ user }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [notificationGroups, setNotificationGroups] = useState<NotificationGroup[]>([]);
  const [isNotificationLoading, setIsNotificationLoading] = useState(true);
  const [readGroupTypes, setReadGroupTypes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let isMounted = true;
    void getNotificationGroups()
      .then((groups) => {
        if (isMounted) setNotificationGroups(groups);
      })
      .finally(() => {
        if (isMounted) setIsNotificationLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [pathname]);

  const getPageTitle = (path: string) => {
    switch (path) {
      case "/dashboard":
        return "Kontrol Paneli";
      case "/forecast-input":
        return "Forecast Giriş";
      case "/weekly-forecast":
        return "Haftalık Detay Formu";
      case "/forecast-history":
        return "Tahmin Geçmişi";
      case "/targets":
        return "Dönemsel Hedefler";
      case "/actuals":
        return "Backlog";
      case "/closing":
        return "Kapanış";
      case "/reports":
        return "Raporlama & Analiz";
      case "/scorecard":
        return "Satış Müdürü Karneleri & CRM Analizi";
      case "/admin/users":
        return "Kullanıcı Yönetimi";
      case "/admin/vendors":
        return "Vendor Yönetimi";
      default:
        return "Yönetim Paneli";
    }
  };

  const formattedRole = user.role === "DIREKTOR" ? "DİREKTÖR" : "SATIŞ MÜDÜRÜ";
  const unreadCount = notificationGroups.filter((group) => !readGroupTypes[group.type]).length;

  const getSeverityClass = (severity: NotificationGroup["severity"]) => {
    if (severity === "high") return "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300";
    if (severity === "medium") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300";
    return "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300";
  };

  const getSeverityDot = (severity: NotificationGroup["severity"]) => {
    if (severity === "high") return "bg-red-600";
    if (severity === "medium") return "bg-amber-500";
    return "bg-slate-500";
  };

  const handleNotificationClick = (group: NotificationGroup) => {
    setReadGroupTypes((current) => ({ ...current, [group.type]: true }));
    router.push(group.targetUrl);
  };

  const markAllRead = () => {
    setReadGroupTypes(
      notificationGroups.reduce<Record<string, boolean>>((acc, group) => {
        acc[group.type] = true;
        return acc;
      }, {})
    );
  };

  const getInitials = (name?: string | null) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  return (
    <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 flex items-center justify-between sticky top-0 z-30 shadow-sm">
      {/* Page Title */}
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 font-serif">
          {getPageTitle(pathname)}
        </h1>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 ? (
              <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
                {unreadCount}
              </span>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="mt-2 w-[380px] overflow-visible border-slate-200 p-0 shadow-xl dark:border-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <div className="font-serif text-base font-bold text-[#1F3A2E] dark:text-emerald-400">Bildirimler</div>
                <div className="text-xs text-slate-500">Konu bazlı gruplanmış uyarılar</div>
              </div>
              {notificationGroups.length > 0 ? (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  Tümünü okundu yap
                </button>
              ) : null}
            </div>
            <div className="max-h-[520px] space-y-2 overflow-y-auto p-3">
              {isNotificationLoading ? (
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                  Bildirimler yükleniyor...
                </div>
              ) : notificationGroups.length === 0 ? (
                <div className="flex items-center gap-3 rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <CheckCircle2 className="h-5 w-5" />
                  Şu an aksiyon gerektiren bildirim yok.
                </div>
              ) : (
                notificationGroups.map((group) => {
                  const isRead = readGroupTypes[group.type] ?? false;
                  const previewItems = group.items.slice(0, 12);
                  return (
                    <div key={group.type} className="group/notification relative">
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(group)}
                        className={`grid w-full grid-cols-[1fr_auto] gap-3 rounded-lg border p-3 text-left transition hover:shadow-sm ${getSeverityClass(group.severity)} ${
                          isRead ? "opacity-60" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${getSeverityDot(group.severity)}`} />
                            <span className="truncate text-sm font-bold">{group.title}</span>
                            {!isRead ? <span className="h-2 w-2 rounded-full bg-red-600" /> : null}
                          </div>
                          <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{group.summary}</div>
                          {group.items[0] ? (
                            <div className="mt-2 truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              {group.items[0].label} {group.items[1] ? `+${group.items.length - 1} daha` : ""}
                            </div>
                          ) : null}
                        </div>
                        <Badge className="self-start bg-white text-slate-800 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                          {group.count}
                        </Badge>
                      </button>
                      <div className="pointer-events-none absolute right-full top-0 z-50 mr-3 hidden w-80 rounded-lg border border-slate-200 bg-white p-3 text-slate-900 shadow-xl group-hover/notification:block group-focus-within/notification:block dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-sm font-bold">{group.title}</div>
                          <Badge variant="outline">{group.count} kayıt</Badge>
                        </div>
                        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                          {previewItems.map((item, index) => (
                            <div key={`${group.type}-${item.label}-${index}`} className="rounded-md bg-slate-50 p-2 dark:bg-slate-950">
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-xs font-bold">{item.label}</span>
                                {item.value ? <span className="shrink-0 font-mono text-[11px] font-bold">{item.value}</span> : null}
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{item.detail}</div>
                            </div>
                          ))}
                          {group.items.length > previewItems.length ? (
                            <div className="rounded-md bg-slate-50 p-2 text-xs font-semibold text-slate-500 dark:bg-slate-950">
                              +{group.items.length - previewItems.length} kayıt daha
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-slate-500">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Tıklayınca ilgili sayfaya gider.
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1F3A2E]/20 dark:hover:bg-slate-800">
            <Avatar className="h-9 w-9 border border-slate-200 dark:border-slate-800">
              <AvatarFallback className="bg-[#1F3A2E] text-white text-xs font-bold">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="hidden md:flex flex-col items-start text-left">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                {user.name}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-sans">
                {formattedRole}
              </span>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 mt-2 border-slate-200 dark:border-slate-800 shadow-lg">
            <div className="px-1.5 py-1 font-sans">
              <div className="flex flex-col">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{user.name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</span>
              </div>
            </div>
            <DropdownMenuSeparator className="bg-slate-100 dark:bg-slate-800" />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="cursor-pointer font-sans py-2 text-red-600 focus:text-red-700 dark:text-red-400 dark:focus:text-red-300"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Çıkış Yap
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
