"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Archive,
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronRight,
  Loader2,
  Percent,
  TrendingUp,
  Users2,
} from "lucide-react";
import { getCurrentFiscalContext } from "@/lib/fiscal";
import { getForecastHistoryData, getForecastTrendData } from "./actions";

type ForecastHistoryData = Awaited<ReturnType<typeof getForecastHistoryData>>;
type ForecastTrendData = Awaited<ReturnType<typeof getForecastTrendData>>;
type HistoryViewMode = "manager" | "vendor";

interface ForecastHistoryClientProps {
  initialData: ForecastHistoryData;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
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

function formatDate(value: Date | string) {
  return new Date(value).toLocaleString("tr-TR");
}

function getAccuracyTone(value: number) {
  if (value >= 90) return "text-emerald-700 dark:text-emerald-400";
  if (value >= 75) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function MiniBar({ value, colorClass = "bg-[#2E5A43]" }: { value: number; colorClass?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
    </div>
  );
}

function Kpi({
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
    <div className="flex min-h-28 items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0">
        <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
        <div className="mt-1 truncate text-2xl font-bold text-slate-950 dark:text-slate-100">{value}</div>
        <div className="mt-1 text-xs font-medium text-slate-500">{subValue}</div>
      </div>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}

function TrendLineChart({ points }: { points: ForecastTrendData["points"] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = 860;
  const height = 340;
  const paddingLeft = 76;
  const paddingRight = 88;
  const paddingTop = 34;
  const paddingBottom = 56;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const maxGp = Math.max(1, ...points.map((point) => point.gp));
  const maxRevenue = Math.max(1, ...points.map((point) => point.revenue));

  const getX = (index: number) =>
    paddingLeft + (points.length <= 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth);
  const getGpY = (value: number) => paddingTop + chartHeight - (value / maxGp) * chartHeight;
  const getRevenueY = (value: number) => paddingTop + chartHeight - (value / maxRevenue) * chartHeight;
  const makePath = (field: "gp" | "revenue") =>
    points
      .map((point, index) => {
        const y = field === "gp" ? getGpY(point.gp) : getRevenueY(point.revenue);
        return `${index === 0 ? "M" : "L"} ${getX(index)} ${y}`;
      })
      .join(" ");
  const compactMoney = (value: number) =>
    new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex];
  const tooltipX = hoveredIndex === null ? 0 : getX(hoveredIndex);
  const tooltipY = hoveredPoint ? Math.min(getGpY(hoveredPoint.gp), getRevenueY(hoveredPoint.revenue)) : 0;
  const tooltipBoxX = Math.max(10, Math.min(width - 190, tooltipX - 90));
  const tooltipBoxY = Math.max(10, tooltipY - 94);

  if (points.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-500 dark:bg-slate-950/30">
        Seçili filtreler için forecast değişimi bulunamadı.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[860px] rounded-lg bg-slate-50 dark:bg-slate-950/30" aria-label="Forecast değişimi çizgi grafiği">
        {[0, 1, 2, 3, 4].map((line) => {
          const ratio = line / 4;
          const y = paddingTop + ratio * chartHeight;
          const gpTick = maxGp - maxGp * ratio;
          const revenueTick = maxRevenue - maxRevenue * ratio;
          return (
            <g key={line}>
              <line x1={paddingLeft} x2={width - paddingRight} y1={y} y2={y} stroke="#E2E8F0" strokeWidth="1" />
              <text x={paddingLeft - 10} y={y + 4} textAnchor="end" className="fill-emerald-800 text-[10px] font-semibold">
                {compactMoney(gpTick)}
              </text>
              <text x={width - paddingRight + 10} y={y + 4} textAnchor="start" className="fill-slate-600 text-[10px] font-semibold">
                {compactMoney(revenueTick)}
              </text>
            </g>
          );
        })}
        <line x1={paddingLeft} x2={paddingLeft} y1={paddingTop} y2={paddingTop + chartHeight} stroke="#2E5A43" strokeWidth="2" />
        <line x1={width - paddingRight} x2={width - paddingRight} y1={paddingTop} y2={paddingTop + chartHeight} stroke="#64748B" strokeWidth="2" />
        <text x={paddingLeft} y={20} textAnchor="start" className="fill-emerald-800 text-[11px] font-bold">
          GP
        </text>
        <text x={width - paddingRight} y={20} textAnchor="end" className="fill-slate-600 text-[11px] font-bold">
          Revenue / NSB
        </text>
        <path d={makePath("revenue")} fill="none" stroke="#64748B" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        <path d={makePath("gp")} fill="none" stroke="#2E5A43" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
        {points.map((point, index) => (
          <g
            key={`${point.label}-${index}`}
            className="cursor-pointer"
            tabIndex={0}
            onBlur={() => setHoveredIndex(null)}
            onFocus={() => setHoveredIndex(index)}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <title>{`${point.label} | GP ${formatUSD(point.gp)} | NSB ${formatUSD(point.revenue)}`}</title>
            <circle cx={getX(index)} cy={getRevenueY(point.revenue)} r="12" fill="transparent" />
            <circle cx={getX(index)} cy={getGpY(point.gp)} r="12" fill="transparent" />
            <circle cx={getX(index)} cy={getRevenueY(point.revenue)} r="4" fill="#64748B" />
            <circle cx={getX(index)} cy={getGpY(point.gp)} r="5" fill="#2E5A43" />
            <text x={getX(index)} y={height - 24} textAnchor="middle" className="fill-slate-500 text-[10px] font-semibold">
              H{point.weekNumber}
            </text>
            <text x={getX(index)} y={height - 10} textAnchor="middle" className="fill-slate-400 text-[9px] font-medium">
              Q{point.quarter}
            </text>
          </g>
        ))}
        {hoveredPoint ? (
          <g pointerEvents="none">
            <line
              x1={tooltipX}
              x2={tooltipX}
              y1={paddingTop}
              y2={paddingTop + chartHeight}
              stroke="#94A3B8"
              strokeDasharray="4 4"
              strokeWidth="1.5"
            />
            <rect
              x={tooltipBoxX}
              y={tooltipBoxY}
              width="180"
              height="82"
              rx="8"
              fill="#FFFFFF"
              stroke="#CBD5E1"
              strokeWidth="1"
              className="dark:fill-slate-900 dark:stroke-slate-700"
            />
            <text x={tooltipBoxX + 12} y={tooltipBoxY + 20} className="fill-slate-900 text-[12px] font-bold dark:fill-slate-100">
              {hoveredPoint.label}
            </text>
            <text x={tooltipBoxX + 12} y={tooltipBoxY + 42} className="fill-emerald-800 text-[12px] font-bold">
              GP: {formatUSD(hoveredPoint.gp)}
            </text>
            <text x={tooltipBoxX + 12} y={tooltipBoxY + 62} className="fill-slate-600 text-[12px] font-bold dark:fill-slate-300">
              Revenue: {formatUSD(hoveredPoint.revenue)}
            </text>
            <text x={tooltipBoxX + 12} y={tooltipBoxY + 78} className="fill-slate-500 text-[10px] font-semibold">
              GP% {formatPercent(hoveredPoint.gpPercent)}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

export default function ForecastHistoryClient({ initialData }: ForecastHistoryClientProps) {
  const currentContext = getCurrentFiscalContext();
  const [fiscalYear, setFiscalYear] = useState(initialData.fiscalYear);
  const [quarter, setQuarter] = useState(initialData.quarter);
  const [data, setData] = useState(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<HistoryViewMode>("manager");
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});
  const [expandedVendors, setExpandedVendors] = useState<Record<string, boolean>>({});
  const [trendData, setTrendData] = useState<ForecastTrendData | null>(null);
  const [isTrendLoading, setIsTrendLoading] = useState(false);
  const [trendFiscalYears, setTrendFiscalYears] = useState<number[]>([initialData.fiscalYear]);
  const [trendQuarters, setTrendQuarters] = useState<number[]>([initialData.quarter]);
  const [trendManagerIds, setTrendManagerIds] = useState<string[]>([]);
  const [trendVendorIds, setTrendVendorIds] = useState<string[]>([]);

  const fiscalYearsRange = [
    currentContext.fiscalYear - 1,
    currentContext.fiscalYear,
    currentContext.fiscalYear + 1,
  ];

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getForecastHistoryData(fiscalYear, quarter);
      setData(result);
      setExpandedManagers({});
      setExpandedVendors({});
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Forecast geçmişi yüklenirken hata oluştu."));
    } finally {
      setIsLoading(false);
    }
  }, [fiscalYear, quarter]);

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData]);

  const maxWeeklyRevenue = useMemo(
    () => Math.max(1, ...data.weeklySummary.map((week) => week.revenue)),
    [data.weeklySummary]
  );
  const managerBasedRecordCount = useMemo(
    () => data.managers.reduce((sum, manager) => sum + manager.weeklyTotals.length, 0),
    [data.managers]
  );
  const vendorBasedRecordCount = useMemo(
    () => data.managers.reduce((sum, manager) => sum + manager.vendors.reduce((vendorSum, vendor) => vendorSum + vendor.rowCount, 0), 0),
    [data.managers]
  );
  const filteredTrendVendorOptions = useMemo(
    () =>
      (trendData?.vendorOptions ?? []).filter(
        (vendor) => trendManagerIds.length === 0 || trendManagerIds.includes(vendor.managerId)
      ),
    [trendData?.vendorOptions, trendManagerIds]
  );

  const loadTrendData = useCallback(async () => {
    setIsTrendLoading(true);
    try {
      const result = await getForecastTrendData({
        fiscalYears: trendFiscalYears,
        quarters: trendQuarters,
        managerIds: trendManagerIds,
        vendorIds: trendVendorIds,
      });
      setTrendData(result);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Forecast değişim grafiği yüklenirken hata oluştu."));
    } finally {
      setIsTrendLoading(false);
    }
  }, [trendFiscalYears, trendQuarters, trendManagerIds, trendVendorIds]);

  useEffect(() => {
    void Promise.resolve().then(loadTrendData);
  }, [loadTrendData]);

  const toggleManager = (managerId: string) => {
    setExpandedManagers((current) => ({
      ...current,
      [managerId]: !(current[managerId] ?? false),
    }));
  };

  const toggleVendor = (vendorId: string) => {
    setExpandedVendors((current) => ({
      ...current,
      [vendorId]: !(current[vendorId] ?? false),
    }));
  };

  const toggleTrendNumber = (value: number, setter: React.Dispatch<React.SetStateAction<number[]>>) => {
    setter((current) => {
      const exists = current.includes(value);
      const next = exists ? current.filter((item) => item !== value) : [...current, value].sort((a, b) => a - b);
      if (next.length === 0) {
        toast.error("Grafik için en az bir seçim kalmalı.");
        return current;
      }
      return next;
    });
  };

  const toggleTrendString = (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-serif text-2xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400">
            Geçmiş Forecast
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Arşivlenmiş forecast versiyonlarını ve accuracy görünümünü takip edin.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-950">
            <Button
              type="button"
              size="sm"
              variant={viewMode === "manager" ? "default" : "ghost"}
              onClick={() => setViewMode("manager")}
              className={viewMode === "manager" ? "bg-[#2E5A43] text-white hover:bg-[#1F3A2E]" : ""}
            >
              SM Bazlı
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === "vendor" ? "default" : "ghost"}
              onClick={() => setViewMode("vendor")}
              className={viewMode === "vendor" ? "bg-[#2E5A43] text-white hover:bg-[#1F3A2E]" : ""}
            >
              Vendor Bazlı
            </Button>
          </div>
          <Calendar className="h-4 w-4 text-emerald-700" />
          <Select value={fiscalYear.toString()} onValueChange={(value) => setFiscalYear(Number(value))}>
            <SelectTrigger className="h-8 w-24 border-slate-200 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200">
              {fiscalYearsRange.map((year) => (
                <SelectItem key={year} value={year.toString()} className="text-xs">
                  FY{year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={quarter.toString()} onValueChange={(value) => setQuarter(Number(value))}>
            <SelectTrigger className="h-8 w-20 border-slate-200 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border-slate-200">
              {[1, 2, 3, 4].map((q) => (
                <SelectItem key={q} value={q.toString()} className="text-xs">
                  Q{q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge className="bg-emerald-800 text-emerald-50 hover:bg-emerald-800">
            FY{fiscalYear} Q{quarter}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Forecast Kayıt" value={data.totals.forecastCount.toString()} subValue={`${data.totals.activeCount} aktif, ${data.totals.archivedCount} arşiv`} icon={Archive} />
        <Kpi label="Forecast NSB" value={formatUSD(data.totals.revenue)} subValue={`GP ${formatUSD(data.totals.gp)} / ${data.totals.vendorCount} marka`} icon={TrendingUp} />
        <Kpi label="NSB Accuracy" value={formatPercent(data.totals.revenueAccuracy)} subValue="Aktif forecast/target bazlı" icon={Percent} />
        <Kpi label="GP Accuracy" value={formatPercent(data.totals.gpAccuracy)} subValue="Aktif forecast/target bazlı" icon={BarChart3} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
                Haftalık Forecast Akışı
              </h3>
              <p className="text-xs text-slate-500">Hafta hafta aktif ve arşiv forecast NSB akışı.</p>
            </div>
            <BarChart3 className="h-5 w-5 text-emerald-700" />
          </div>
          <div className="space-y-3">
            {data.weeklySummary.length === 0 ? (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950/30">
                Seçili çeyrek için forecast bulunamadı.
              </div>
            ) : (
              data.weeklySummary.map((week) => (
                <div key={week.weekNumber} className="grid gap-2 sm:grid-cols-[70px_1fr_86px] sm:items-center">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300">{week.weekNumber}. Hafta</div>
                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                      <span>{formatUSD(week.revenue)}</span>
                      <span>{week.count} kayıt</span>
                    </div>
                    <MiniBar value={(week.revenue / maxWeeklyRevenue) * 100} />
                  </div>
                  <div className={`text-right font-mono text-xs font-bold ${getAccuracyTone(week.revenueAccuracy)}`}>
                    {formatPercent(week.revenueAccuracy)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
                Satış Müdürü Accuracy
              </h3>
              <p className="text-xs text-slate-500">Haftalık forecastlerin ortalama doğruluğu.</p>
            </div>
            <Users2 className="h-5 w-5 text-emerald-700" />
          </div>
          <div className="space-y-3">
            {data.managers.map((manager) => (
              <div key={manager.id} className="grid gap-2 sm:grid-cols-[150px_1fr_76px] sm:items-center">
                <div className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">{manager.managerName}</div>
                <MiniBar value={manager.revenueAccuracy} colorClass={manager.revenueAccuracy >= 90 ? "bg-emerald-700" : manager.revenueAccuracy >= 75 ? "bg-amber-500" : "bg-red-600"} />
                <div className={`text-right font-mono text-xs font-bold ${getAccuracyTone(manager.revenueAccuracy)}`}>
                  {formatPercent(manager.revenueAccuracy)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div>
            <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
              {viewMode === "manager" ? "SM Bazlı Haftalık Forecast" : "Vendor Bazlı Haftalık Forecast"}
            </h3>
            <p className="text-xs text-slate-500">
              {viewMode === "manager"
                ? "Satış müdürünü açarak haftalık toplam forecast geçmişini görün."
                : "Satış müdürünü, ardından vendor satırını açarak hafta hafta forecastleri görün."}
            </p>
          </div>
          {isLoading && <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />}
        </div>

        <div className="grid grid-cols-1 gap-3 border-b border-slate-100 p-4 dark:border-slate-800 md:grid-cols-2">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/30">
            <div className="text-xs font-semibold uppercase text-slate-500">SM Bazlı Kayıt</div>
            <div className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-100">{managerBasedRecordCount}</div>
            <div className="mt-1 text-xs text-slate-500">Satış müdürü + hafta toplam kaydı</div>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/30">
            <div className="text-xs font-semibold uppercase text-slate-500">Vendor Bazlı Kayıt</div>
            <div className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-100">{vendorBasedRecordCount}</div>
            <div className="mt-1 text-xs text-slate-500">Vendor + hafta forecast kaydı</div>
          </div>
        </div>

        <Table>
          <TableHeader className="bg-emerald-950 shadow-sm">
            <TableRow>
              <TableHead className="bg-emerald-900 text-xs font-extrabold uppercase tracking-wide text-emerald-50">Satış Müdürü / Marka</TableHead>
              <TableHead className="bg-emerald-900 text-center text-xs font-extrabold uppercase tracking-wide text-emerald-50">Durum</TableHead>
              <TableHead className="bg-emerald-900 text-center text-xs font-extrabold uppercase tracking-wide text-emerald-50">Hafta</TableHead>
              <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">NSB</TableHead>
              <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">GP</TableHead>
              <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">GP%</TableHead>
              <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">NSB Accuracy</TableHead>
              <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">Güncelleme</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.managers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-sm text-slate-500">
                  Seçili çeyrek için forecast bulunamadı.
                </TableCell>
              </TableRow>
            ) : viewMode === "manager" ? (
              data.managers.map((manager) => {
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
                              {manager.weeklyTotals.length} hafta, {manager.rowCount} forecast
                            </span>
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{manager.activeCount > 0 ? "Aktif var" : "Arşiv"}</Badge>
                      </TableCell>
                      <TableCell className="text-center text-xs text-slate-500">Aktif</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(manager.revenue)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(manager.gp)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-800 dark:text-emerald-300">{formatPercent(manager.gpPercent)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm font-extrabold ${getAccuracyTone(manager.revenueAccuracy)}`}>
                        {formatPercent(manager.revenueAccuracy)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                    {isExpanded &&
                      manager.weeklyTotals.map((week) => (
                        <TableRow key={`${manager.id}-${week.weekNumber}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                          <TableCell className="pl-14">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{manager.managerName}</div>
                            <div className="text-[11px] text-slate-500">
                              {week.vendorCount} vendor, {week.rowCount} forecast
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              className={
                                week.activeCount > 0
                                  ? "bg-emerald-800 text-emerald-50 hover:bg-emerald-800"
                                  : "bg-slate-100 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300"
                              }
                            >
                              {week.activeCount > 0 ? "Aktif" : "Arşiv"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center text-xs">{week.weekNumber}. Hafta</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatUSD(week.revenue)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatUSD(week.gp)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold">{formatPercent(week.gpPercent)}</TableCell>
                          <TableCell className={`text-right font-mono text-xs font-bold ${getAccuracyTone(week.revenueAccuracy)}`}>
                            {formatPercent(week.revenueAccuracy)}
                          </TableCell>
                          <TableCell className="text-right text-[11px] text-slate-500">{formatDate(week.updatedAt)}</TableCell>
                        </TableRow>
                      ))}
                  </React.Fragment>
                );
              })
            ) : (
              data.managers.map((manager) => {
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
                              {manager.rowCount} forecast, {manager.activeCount} aktif, {manager.archivedCount} arşiv
                            </span>
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{manager.vendors.length} vendor</Badge>
                      </TableCell>
                      <TableCell className="text-center text-xs text-slate-500">Aktif</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(manager.revenue)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(manager.gp)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-800 dark:text-emerald-300">{formatPercent(manager.gpPercent)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm font-extrabold ${getAccuracyTone(manager.revenueAccuracy)}`}>
                        {formatPercent(manager.revenueAccuracy)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                    {isExpanded &&
                      manager.vendors.map((vendor) => {
                        const vendorKey = `${manager.id}:${vendor.vendorId}`;
                        const isVendorExpanded = expandedVendors[vendorKey] ?? false;
                        const VendorToggleIcon = isVendorExpanded ? ChevronDown : ChevronRight;

                        return (
                          <React.Fragment key={vendorKey}>
                            <TableRow className="border-l-4 border-emerald-600 bg-white hover:bg-emerald-50/70 dark:border-emerald-500 dark:bg-slate-900 dark:hover:bg-emerald-950/20">
                              <TableCell className="pl-12">
                                <button
                                  type="button"
                                  onClick={() => toggleVendor(vendorKey)}
                                  className="flex w-full items-center gap-2 text-left"
                                >
                                  <VendorToggleIcon className="h-4 w-4 text-slate-500" />
                                  <span>
                                    <span className="block font-semibold text-slate-900 dark:text-slate-100">{vendor.vendorName}</span>
                                    <span className="block text-[11px] text-slate-500">
                                      {vendor.rowCount} forecast, {vendor.activeCount} aktif, {vendor.archivedCount} arşiv
                                    </span>
                                  </span>
                                </button>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant="outline">{vendor.activeCount > 0 ? "Aktif var" : "Arşiv"}</Badge>
                              </TableCell>
                              <TableCell className="text-center text-xs text-slate-500">Aktif</TableCell>
                              <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(vendor.revenue)}</TableCell>
                              <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(vendor.gp)}</TableCell>
                              <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-800 dark:text-emerald-300">{formatPercent(vendor.gpPercent)}</TableCell>
                              <TableCell className={`text-right font-mono text-sm font-extrabold ${getAccuracyTone(vendor.revenueAccuracy)}`}>
                                {formatPercent(vendor.revenueAccuracy)}
                              </TableCell>
                              <TableCell />
                            </TableRow>
                            {isVendorExpanded &&
                              vendor.rows.map((row) => (
                                <TableRow key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                                  <TableCell className="pl-20">
                                    <div className="font-semibold text-slate-900 dark:text-slate-100">{row.vendorName}</div>
                                    <div className="text-[11px] text-slate-500">{row.submittedByName}</div>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <Badge
                                      className={
                                        row.isActive
                                          ? "bg-emerald-800 text-emerald-50 hover:bg-emerald-800"
                                          : "bg-slate-100 text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300"
                                      }
                                    >
                                      {row.isActive ? "Aktif" : "Arşiv"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-center text-xs">{row.weekNumber}. Hafta</TableCell>
                                  <TableCell className="text-right font-mono text-xs">{formatUSD(row.revenue)}</TableCell>
                                  <TableCell className="text-right font-mono text-xs">{formatUSD(row.gp)}</TableCell>
                                  <TableCell className="text-right font-mono text-xs font-bold">{formatPercent(row.gpPercent)}</TableCell>
                                  <TableCell className={`text-right font-mono text-xs font-bold ${getAccuracyTone(row.revenueAccuracy)}`}>
                                    {formatPercent(row.revenueAccuracy)}
                                  </TableCell>
                                  <TableCell className="text-right text-[11px] text-slate-500">{formatDate(row.updatedAt)}</TableCell>
                                </TableRow>
                              ))}
                          </React.Fragment>
                        );
                      })}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
              Forecast Değişimi
            </h3>
            <p className="text-xs text-slate-500">Seçili filtrelere göre haftalık GP ve NSB trendi.</p>
          </div>
          {isTrendLoading && <Loader2 className="h-5 w-5 animate-spin text-emerald-700" />}
        </div>

        <div className="mb-5 grid gap-3 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Yıl</div>
            <div className="flex flex-wrap gap-1.5">
              {fiscalYearsRange.map((year) => (
                <Button
                  key={year}
                  type="button"
                  size="sm"
                  variant={trendFiscalYears.includes(year) ? "default" : "outline"}
                  className={trendFiscalYears.includes(year) ? "bg-[#2E5A43] text-white hover:bg-[#1F3A2E]" : "bg-white dark:bg-slate-900"}
                  onClick={() => toggleTrendNumber(year, setTrendFiscalYears)}
                >
                  FY{year}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Çeyrek</div>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4].map((q) => (
                <Button
                  key={q}
                  type="button"
                  size="sm"
                  variant={trendQuarters.includes(q) ? "default" : "outline"}
                  className={trendQuarters.includes(q) ? "bg-[#2E5A43] text-white hover:bg-[#1F3A2E]" : "bg-white dark:bg-slate-900"}
                  onClick={() => toggleTrendNumber(q, setTrendQuarters)}
                >
                  Q{q}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Satış Müdürü</div>
            <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
              {(trendData?.managerOptions ?? []).map((manager) => (
                <button
                  key={manager.id}
                  type="button"
                  onClick={() => toggleTrendString(manager.id, setTrendManagerIds)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-medium ${
                    trendManagerIds.includes(manager.id)
                      ? "bg-emerald-800 text-white"
                      : "bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-950 dark:text-slate-300"
                  }`}
                >
                  <span className="truncate">{manager.name}</span>
                  {trendManagerIds.includes(manager.id) ? <span>Seçili</span> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Vendor</div>
            <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
              {filteredTrendVendorOptions.map((vendor) => (
                <button
                  key={vendor.id}
                  type="button"
                  onClick={() => toggleTrendString(vendor.id, setTrendVendorIds)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-medium ${
                    trendVendorIds.includes(vendor.id)
                      ? "bg-emerald-800 text-white"
                      : "bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-950 dark:text-slate-300"
                  }`}
                >
                  <span className="truncate">{vendor.name}</span>
                  {trendVendorIds.includes(vendor.id) ? <span>Seçili</span> : null}
                </button>
              ))}
            </div>
          </div>
        </div>

        <TrendLineChart points={trendData?.points ?? []} />
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-[#2E5A43]" /> GP</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-slate-500" /> NSB</span>
          <span>{trendData?.points.length ?? 0} hafta noktası</span>
        </div>
      </div>
    </div>
  );
}
