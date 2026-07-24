"use client";

import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDashboardData } from "./actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  DollarSign,
  LineChart,
  Percent,
  Target,
  TrendingUp,
  Users2,
} from "lucide-react";

type MetricSet = {
  targetRevenue: number;
  targetGp: number;
  forecastRevenue: number;
  forecastGp: number;
  backlogRevenue: number;
  backlogGp: number;
  targetGpPercent: number;
  forecastGpPercent: number;
  backlogGpPercent: number;
  revenueAchievement: number;
  gpAchievement: number;
};

type DashboardData = {
  currentContext: {
    fiscalYear: number;
    quarter: number;
    weekInQuarter: number;
  };
  selectedFiscalYear: number;
  selectedQuarter: number;
  isCurrentQuarter: boolean;
  user: {
    role?: string | null;
    name?: string | null;
  };
  current: MetricSet;
  managers: Array<{
    id: string;
    managerName: string;
    current: MetricSet;
    forecastedCount: number;
    targetCount: number;
    vendors: Array<{
      vendorId: string;
      vendorName: string;
      current: MetricSet;
      hasForecast: boolean;
      hasTarget: boolean;
    }>;
  }>;
  attentionItems: Array<{
    type: string;
    severity: string;
    managerName: string;
    vendorName: string;
    detail: string;
  }>;
};

interface DashboardClientProps {
  data: DashboardData;
}

function formatUSD(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function getAchievementTone(value: number) {
  if (value >= 100) return "text-emerald-700 dark:text-emerald-400";
  if (value >= 75) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function getGpTone(value: number) {
  if (value >= 20) return "text-emerald-700 dark:text-emerald-400";
  if (value >= 10) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function DonutGauge({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(140, value));
  const offset = circumference - (Math.min(clamped, 100) / 100) * circumference;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <svg viewBox="0 0 80 80" className="h-16 w-16 shrink-0" aria-hidden="true">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#E2E8F0" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={value >= 100 ? "#047857" : value >= 75 ? "#D97706" : "#DC2626"}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="8"
          transform="rotate(-90 40 40)"
        />
      </svg>
      <div>
        <div className={`font-mono text-lg font-bold ${getAchievementTone(value)}`}>{formatPercent(value)}</div>
        <div className="text-xs font-medium text-slate-500">{label}</div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  subValue,
  icon: Icon,
}: {
  label: string;
  value: string;
  subValue: string;
  icon: React.ElementType;
}) {
  return (
    <div className="grid min-h-32 grid-cols-[1fr_auto] gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0">
        <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
        <div className="mt-1 break-words font-mono text-xl font-bold leading-tight text-slate-950 tabular-nums dark:text-slate-100 sm:text-2xl">{value}</div>
        <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{subValue}</div>
      </div>
      <div className="flex items-start justify-end">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function DashboardClient({ data: initialData }: DashboardClientProps) {
  const [data, setData] = useState(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});

  const totals = data.current;
  const periodLabel = data.isCurrentQuarter
    ? `FY${data.selectedFiscalYear} Q${data.selectedQuarter} - Hafta ${data.currentContext.weekInQuarter}`
    : `FY${data.selectedFiscalYear} Q${data.selectedQuarter}`;
  const managerChartRows = useMemo(
    () =>
      data.managers
        .map((manager) => ({
          id: manager.id,
          name: manager.managerName,
          metrics: manager.current,
        }))
        .sort((a, b) => b.metrics.forecastGp - a.metrics.forecastGp),
    [data.managers]
  );
  const maxManagerForecastGp = Math.max(1, ...managerChartRows.map((row) => row.metrics.forecastGp));

  const toggleManager = (managerId: string) => {
    setExpandedManagers((current) => ({
      ...current,
      [managerId]: !(current[managerId] ?? false),
    }));
  };

  const selectQuarter = useCallback(async (quarter: number) => {
    if (quarter === data.selectedQuarter) return;

    setIsLoading(true);
    try {
      const dashboardData = await getDashboardData(quarter);
      setData(dashboardData);
      setExpandedManagers({});
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Dashboard verileri alınırken hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  }, [data.selectedQuarter]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-serif text-2xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400">
            Dashboard
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Seçili çeyrek için hedef, forecast ve son girilen backlog görünümü.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-emerald-800 text-emerald-50 hover:bg-emerald-800">{periodLabel}</Badge>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {[1, 2, 3, 4].map((quarter) => (
              <Button
                key={quarter}
                type="button"
                size="sm"
                variant={data.selectedQuarter === quarter ? "default" : "ghost"}
                onClick={() => void selectQuarter(quarter)}
                disabled={isLoading}
                className={data.selectedQuarter === quarter ? "bg-[#2E5A43] text-white hover:bg-[#1F3A2E]" : ""}
              >
                Q{quarter}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm font-medium text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          Seçili çeyrek verileri güncelleniyor...
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Target GP"
          value={formatUSD(totals.targetGp)}
          subValue={`Target NSB ${formatUSD(totals.targetRevenue)}`}
          icon={Target}
        />
        <KpiCard
          label="Forecast GP"
          value={formatUSD(totals.forecastGp)}
          subValue={`Forecast NSB ${formatUSD(totals.forecastRevenue)}`}
          icon={TrendingUp}
        />
        <KpiCard
          label="GP Achievement"
          value={formatPercent(totals.gpAchievement)}
          subValue={`NSB achievement ${formatPercent(totals.revenueAchievement)}`}
          icon={Percent}
        />
        <KpiCard
          label="Backlog GP"
          value={formatUSD(totals.backlogGp)}
          subValue={`Backlog NSB ${formatUSD(totals.backlogRevenue)}`}
          icon={DollarSign}
        />
        <KpiCard
          label="Forecast NSB"
          value={formatUSD(totals.forecastRevenue)}
          subValue={`Target NSB ${formatUSD(totals.targetRevenue)}`}
          icon={LineChart}
        />
        <KpiCard
          label="Forecast GP%"
          value={formatPercent(totals.forecastGpPercent)}
          subValue={`Backlog GP% ${formatPercent(totals.backlogGpPercent)}`}
          icon={BarChart3}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
                Achievement Göstergeleri
              </h3>
              <p className="text-xs text-slate-500">NSB ve GP hedef gerçekleşme resmi.</p>
            </div>
            <Percent className="h-5 w-5 text-emerald-700" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DonutGauge value={totals.revenueAchievement} label="NSB Achievement" />
            <DonutGauge value={totals.gpAchievement} label="GP Achievement" />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
                Satış Müdürü Forecast GP Dağılımı
              </h3>
              <p className="text-xs text-slate-500">Forecast GP büyüklüğü ve GP achievement oranı.</p>
            </div>
            <BarChart3 className="h-5 w-5 text-emerald-700" />
          </div>
          <div className="space-y-3">
            {managerChartRows.map((row) => (
              <div key={row.id} className="grid gap-2 sm:grid-cols-[150px_1fr_76px] sm:items-center">
                <div className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">{row.name}</div>
                <div className="h-7 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                  <div
                    className="flex h-full items-center justify-end rounded-md bg-[#2E5A43] px-2 text-[11px] font-semibold text-white"
                    style={{ width: `${Math.max(8, (row.metrics.forecastGp / maxManagerForecastGp) * 100)}%` }}
                  >
                    {formatUSD(row.metrics.forecastGp)}
                  </div>
                </div>
                <div className={`text-right font-mono text-xs font-bold ${getAchievementTone(row.metrics.gpAchievement)}`}>
                  {formatPercent(row.metrics.gpAchievement)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div>
              <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
                Satış Müdürü Özeti
              </h3>
              <p className="text-xs text-slate-500">Akordiyonu açarak marka detaylarını görün.</p>
            </div>
            <Users2 className="h-5 w-5 text-emerald-700" />
          </div>
          <Table>
            <TableHeader className="bg-emerald-950 shadow-sm">
              <TableRow>
                <TableHead className="bg-emerald-900 text-xs font-extrabold uppercase tracking-wide text-emerald-50">Satış Müdürü / Marka</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">Target GP</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">Forecast GP</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">GP Achv%</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">GP%</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">Forecast NSB</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">NSB Achv%</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">Backlog GP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.managers.map((manager) => {
                const metrics = manager.current;
                const isExpanded = expandedManagers[manager.id] ?? false;
                const ToggleIcon = isExpanded ? ChevronDown : ChevronRight;

                return (
                  <React.Fragment key={manager.id}>
                    <TableRow className="border-l-4 border-emerald-700 bg-emerald-50/80 shadow-[inset_0_-1px_0_rgba(16,185,129,0.18)] hover:bg-emerald-100/80 dark:border-emerald-500 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30">
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => toggleManager(manager.id)}
                          className="flex w-full items-center gap-2 text-left font-semibold text-slate-950 dark:text-slate-100"
                        >
                          <ToggleIcon className="h-4 w-4 text-slate-500" />
                          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                            <Users2 className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate">{manager.managerName}</span>
                            <span className="block text-[11px] font-medium text-slate-500">
                              {manager.forecastedCount}/{manager.vendors.length} forecast, {manager.targetCount} hedef
                            </span>
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(metrics.targetGp)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(metrics.forecastGp)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm font-extrabold ${getAchievementTone(metrics.gpAchievement)}`}>
                        {formatPercent(metrics.gpAchievement)}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm font-extrabold ${getGpTone(metrics.forecastGpPercent)}`}>
                        {formatPercent(metrics.forecastGpPercent)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(metrics.forecastRevenue)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm font-extrabold ${getAchievementTone(metrics.revenueAchievement)}`}>
                        {formatPercent(metrics.revenueAchievement)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(metrics.backlogGp)}</TableCell>
                    </TableRow>
                    {isExpanded &&
                      manager.vendors.map((vendor) => {
                        const vendorMetrics = vendor.current;
                        return (
                          <TableRow key={vendor.vendorId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                            <TableCell className="pl-14 font-semibold text-slate-900 dark:text-slate-100">
                              {vendor.vendorName}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{formatUSD(vendorMetrics.targetGp)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{formatUSD(vendorMetrics.forecastGp)}</TableCell>
                            <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(vendorMetrics.gpAchievement)}`}>
                              {formatPercent(vendorMetrics.gpAchievement)}
                            </TableCell>
                            <TableCell className={`text-right font-mono text-xs font-bold ${getGpTone(vendorMetrics.forecastGpPercent)}`}>
                              {formatPercent(vendorMetrics.forecastGpPercent)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{formatUSD(vendorMetrics.forecastRevenue)}</TableCell>
                            <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(vendorMetrics.revenueAchievement)}`}>
                              {formatPercent(vendorMetrics.revenueAchievement)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{formatUSD(vendorMetrics.backlogGp)}</TableCell>
                          </TableRow>
                        );
                      })}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
                Dikkat Gerekenler
              </h3>
              <p className="text-xs text-slate-500">Öncelikli kontrol listesi.</p>
            </div>
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
            {data.attentionItems.length === 0 ? (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/30">
                Şu an öne çıkan bir risk görünmüyor.
              </div>
            ) : (
              data.attentionItems.map((item, index) => (
                <div key={`${item.vendorName}-${item.type}-${index}`} className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{item.vendorName}</span>
                    <Badge
                      variant="outline"
                      className={
                        item.severity === "high"
                          ? "border-red-200 text-red-700"
                          : item.severity === "medium"
                            ? "border-amber-200 text-amber-700"
                            : "border-slate-200 text-slate-600"
                      }
                    >
                      {item.type}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-500">{item.managerName}</div>
                  <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">{item.detail}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
