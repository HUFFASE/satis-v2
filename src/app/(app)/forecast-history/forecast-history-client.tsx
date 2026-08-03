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
  Filter,
  X,
  FileSpreadsheet,
} from "lucide-react";
import { MultiSelectFilter, FilterOption } from "@/components/ui/multi-select-filter";
import { formatCompactUSD, formatPercent, formatUSD } from "@/components/viz/format";
import { STATUS_META, StatusValue, getAccuracyStatus } from "@/components/viz/status";
import { EmptyState, Meter, ValueTile } from "@/components/viz/tiles";
import { KPI_TILE_SHELL } from "@/components/viz/card-shell";
import { TrendCard, TrendMeasure } from "@/components/viz/trend-chart";
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

function formatDate(value: Date | string) {
  return new Date(value).toLocaleString("tr-TR");
}

/**
 * Uzunluk büyüklüğü kodladığı için taban değeri yok: sıfır, sıfır genişlikte
 * çizilir. Önceki %4'lük taban, hiç forecast girilmemiş haftaları da dolu
 * gösteriyordu.
 */
function MiniBar({ value, color = "var(--viz-series)" }: { value: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--viz-track)]">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }}
      />
    </div>
  );
}

/**
 * Doğruluk kartı. Accuracy zaten 0-100 aralığında olduğu için ölçer doğal ölçek;
 * hedef karşılaştırması gerekmiyor.
 */
function AccuracyTile({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  const status = getAccuracyStatus(value);
  const { ink, Icon: StatusIcon, label: statusLabel } = STATUS_META[status];

  return (
    <div className={KPI_TILE_SHELL}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <div className={`mt-2 flex items-baseline gap-2 ${ink}`}>
        <span className="font-sans text-3xl font-semibold leading-none">{formatPercent(value)}</span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold">
          <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {statusLabel}
        </span>
      </div>
      <Meter value={value} status={status} />
      <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
        Aktif forecast / hedef bazlı.
      </p>
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

  // Multi-select filter states for History view (Satış Müdürü -> Marka)
  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);

  const managerOptions = useMemo<FilterOption[]>(() => {
    return data.managers.map((m) => ({
      value: m.id,
      label: m.managerName,
      count: m.vendors.length,
    })).sort((a, b) => a.label.localeCompare(b.label, "tr"));
  }, [data.managers]);

  const vendorOptions = useMemo<FilterOption[]>(() => {
    const relevantManagers = selectedManagerIds.length > 0
      ? data.managers.filter((m) => selectedManagerIds.includes(m.id))
      : data.managers;

    const map = new Map<string, string>();
    for (const m of relevantManagers) {
      for (const v of m.vendors) {
        map.set(v.vendorId, v.vendorName);
      }
    }
    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "tr"));
  }, [data.managers, selectedManagerIds]);

  const handleManagerChange = (newManagerIds: string[]) => {
    setSelectedManagerIds(newManagerIds);
    if (newManagerIds.length > 0) {
      const validVendorIds = new Set<string>();
      for (const m of data.managers) {
        if (newManagerIds.includes(m.id)) {
          for (const v of m.vendors) {
            validVendorIds.add(v.vendorId);
          }
        }
      }
      setSelectedVendorIds((prev) => prev.filter((id) => validVendorIds.has(id)));
    }
  };

  const clearAllFilters = () => {
    setSelectedManagerIds([]);
    setSelectedVendorIds([]);
  };

  // GP ve NSB büyüklükleri çok farklı; tek grafikte iki ayrı eksene yerleştirmek
  // ölçek hizası keyfî olduğu için sahte bir ilişki üretiyordu. Ayrı ölçüler olarak sunulur.
  const trendMeasures: TrendMeasure[] = useMemo(() => {
    const points = trendData?.points ?? [];
    // Birden fazla çeyrek seçiliyse hafta numaraları tekrar ettiği için
    // (H13'ten sonra yine H1) eksen etiketine çeyrek de eklenir.
    const spansMultiplePeriods =
      new Set(points.map((point) => `${point.fiscalYear}:${point.quarter}`)).size > 1;
    const toPoints = (pick: (point: (typeof points)[number]) => number) =>
      points.map((point) => ({
        label: spansMultiplePeriods ? `Q${point.quarter}H${point.weekNumber}` : `H${point.weekNumber}`,
        tooltipLabel: point.label,
        value: pick(point),
        caption: `${point.count} kayıt (${point.activeCount} aktif)`,
      }));

    return [
      {
        key: "gp",
        label: "GP",
        description: "Seçili filtrelere göre haftalık forecast GP.",
        points: toPoints((point) => point.gp),
        format: formatUSD,
        formatAxis: formatCompactUSD,
        valueHeader: "Forecast GP",
        periodHeader: "Dönem",
      },
      {
        key: "revenue",
        label: "NSB",
        description: "Seçili filtrelere göre haftalık forecast NSB.",
        points: toPoints((point) => point.revenue),
        format: formatUSD,
        formatAxis: formatCompactUSD,
        valueHeader: "Forecast NSB",
        periodHeader: "Dönem",
      },
      {
        key: "gpPercent",
        label: "GP%",
        description: "Seçili filtrelere göre haftalık kârlılık oranı.",
        points: toPoints((point) => point.gpPercent),
        format: formatPercent,
        formatAxis: (value: number) => `%${value.toFixed(1)}`,
        valueHeader: "GP%",
        periodHeader: "Dönem",
        zeroBaseline: false,
      },
    ];
  }, [trendData?.points]);

  const filteredManagers = useMemo(() => {
    return data.managers
      .filter((m) => selectedManagerIds.length === 0 || selectedManagerIds.includes(m.id))
      .map((m) => {
        const filteredVendors = m.vendors.filter(
          (v) => selectedVendorIds.length === 0 || selectedVendorIds.includes(v.vendorId)
        );
        return {
          ...m,
          vendors: filteredVendors,
        };
      })
      .filter((m) => m.vendors.length > 0);
  }, [data.managers, selectedManagerIds, selectedVendorIds]);

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

      {/* Dynamic Multi-Select Filter Bar (Satış Müdürü -> Marka) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mr-1">
            <Filter className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" /> Filtreler:
          </span>

          <MultiSelectFilter
            title="Satış Müdürü"
            options={managerOptions}
            selectedValues={selectedManagerIds}
            onChange={handleManagerChange}
            placeholder="Satış Müdürü ara..."
            icon={<Users2 className="h-3.5 w-3.5 text-slate-500" />}
          />

          <MultiSelectFilter
            title="Marka"
            options={vendorOptions}
            selectedValues={selectedVendorIds}
            onChange={setSelectedVendorIds}
            placeholder="Marka ara..."
            icon={<FileSpreadsheet className="h-3.5 w-3.5 text-slate-500" />}
          />

          {(selectedManagerIds.length > 0 || selectedVendorIds.length > 0) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
              className="h-9 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <X className="mr-1 h-3.5 w-3.5" /> Filtreleri Temizle
            </Button>
          )}
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Gösterilen: <span className="font-bold text-slate-900 dark:text-slate-100">{filteredManagers.length}</span> / {data.managers.length} Satış Müdürü
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ValueTile
          label="Forecast Kayıt"
          value={data.totals.forecastCount.toString()}
          icon={Archive}
          rows={[
            { label: "Aktif", value: data.totals.activeCount.toString() },
            { label: "Arşiv", value: data.totals.archivedCount.toString() },
          ]}
        />
        <ValueTile
          label="Forecast NSB"
          value={formatUSD(data.totals.revenue)}
          icon={TrendingUp}
          rows={[
            { label: "Forecast GP", value: formatUSD(data.totals.gp) },
            // Bu sayfanın toplamlarında hedef GP% taşınmıyor; karşılaştırma
            // tabanı olmadan kârlılığa iyi/kötü demek yanıltır, renksiz bırakılır.
            {
              label: "GP%",
              value: formatPercent(data.totals.revenue > 0 ? (data.totals.gp / data.totals.revenue) * 100 : 0),
            },
          ]}
        />
        <AccuracyTile label="NSB Accuracy" value={data.totals.revenueAccuracy} icon={Percent} />
        <AccuracyTile label="GP Accuracy" value={data.totals.gpAccuracy} icon={BarChart3} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <div className={KPI_TILE_SHELL}>
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
              <EmptyState message="Seçili çeyrek için forecast bulunamadı." />
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
                  <div className="text-right font-mono text-xs font-bold tabular-nums">
                    <StatusValue
                      value={formatPercent(week.revenueAccuracy)}
                      status={getAccuracyStatus(week.revenueAccuracy)}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={KPI_TILE_SHELL}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
                Satış Müdürü Accuracy
              </h3>
              <p className="text-xs text-slate-500">Haftalık forecastlerin ortalama doğruluğu.</p>
            </div>
            <Users2 className="h-5 w-5 text-emerald-700" />
          </div>
          {/* Filtre uygulanmış liste kullanılır; burası daha önce filtreleri
              yok sayıp her zaman tüm satış müdürlerini gösteriyordu. */}
          <div className="space-y-3">
            {filteredManagers.length === 0 ? (
              <EmptyState message="Seçili filtrelere uyan satış müdürü yok." />
            ) : (
              filteredManagers.map((manager) => (
                <div key={manager.id} className="grid gap-2 sm:grid-cols-[150px_1fr_76px] sm:items-center">
                  <div className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {manager.managerName}
                  </div>
                  <MiniBar
                    value={manager.revenueAccuracy}
                    color={STATUS_META[getAccuracyStatus(manager.revenueAccuracy)].mark}
                  />
                  <div className="text-right font-mono text-xs font-bold tabular-nums">
                    <StatusValue
                      value={formatPercent(manager.revenueAccuracy)}
                      status={getAccuracyStatus(manager.revenueAccuracy)}
                    />
                  </div>
                </div>
              ))
            )}
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
            {filteredManagers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-sm text-slate-500">
                  Seçili filtreler veya çeyrek için forecast bulunamadı.
                </TableCell>
              </TableRow>
            ) : viewMode === "manager" ? (
              filteredManagers.map((manager) => {
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
                      <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                        <StatusValue
                          value={formatPercent(manager.revenueAccuracy)}
                          status={getAccuracyStatus(manager.revenueAccuracy)}
                        />
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
                          <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                            <StatusValue
                              value={formatPercent(week.revenueAccuracy)}
                              status={getAccuracyStatus(week.revenueAccuracy)}
                            />
                          </TableCell>
                          <TableCell className="text-right text-[11px] text-slate-500">{formatDate(week.updatedAt)}</TableCell>
                        </TableRow>
                      ))}
                  </React.Fragment>
                );
              })
            ) : (
              filteredManagers.map((manager) => {
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
                      <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                        <StatusValue
                          value={formatPercent(manager.revenueAccuracy)}
                          status={getAccuracyStatus(manager.revenueAccuracy)}
                        />
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
                              <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                                <StatusValue
                                  value={formatPercent(vendor.revenueAccuracy)}
                                  status={getAccuracyStatus(vendor.revenueAccuracy)}
                                />
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
                                  <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                                    <StatusValue
                                      value={formatPercent(row.revenueAccuracy)}
                                      status={getAccuracyStatus(row.revenueAccuracy)}
                                    />
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

      <div className={KPI_TILE_SHELL}>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
              Forecast Değişimi
            </h3>
            <p className="text-xs text-slate-500">Aşağıdaki filtreler yalnızca bu grafiği kapsar.</p>
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

        <TrendCard
          bare
          title="Haftalık Akış"
          measures={trendMeasures}
          emptyMessage="Seçili filtreler için forecast değişimi bulunamadı."
          captionHeader="Kayıt"
        />
        <p className="mt-2 text-xs font-medium text-slate-500">
          {trendData?.points.length ?? 0} hafta noktası.
        </p>
      </div>
    </div>
  );
}
