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
  Percent,
  Target,
  TrendingUp,
  Users2,
} from "lucide-react";
import { formatCompactUSD, formatPercent, formatSignedPoints, formatUSD } from "@/components/viz/format";
import {
  AchievementCell,
  GpPercentCell,
  StatusKey,
  STATUS_META,
  getGpStatus,
} from "@/components/viz/status";
import { AchievementTile, ComparisonBar, EmptyState, ValueTile } from "@/components/viz/tiles";
import { TrendCard, TrendMeasure } from "@/components/viz/trend-chart";

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

type WeeklyTrendPoint = {
  weekNumber: number;
  revenue: number;
  gp: number;
  vendorCount: number;
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
  weeklyTrend: WeeklyTrendPoint[];
  attentionTotalCount: number;
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

  // Bar ve hedef işareti aynı ölçeği paylaşır, aksi halde hedef çizgisi yanıltır.
  const managerScale = Math.max(
    1,
    ...managerChartRows.flatMap((row) => [row.metrics.forecastGp, row.metrics.targetGp])
  );

  const trendMeasures: TrendMeasure[] = useMemo(() => {
    const toPoints = (pick: (point: WeeklyTrendPoint) => number) =>
      data.weeklyTrend.map((point) => ({
        label: `H${point.weekNumber}`,
        tooltipLabel: `Hafta ${point.weekNumber}`,
        value: pick(point),
        caption: `${point.vendorCount} kayıt`,
      }));

    return [
      {
        key: "gp",
        label: "GP",
        description: "Hafta bazında toplam forecast GP.",
        points: toPoints((point) => point.gp),
        format: formatUSD,
        formatAxis: formatCompactUSD,
        valueHeader: "Forecast GP",
      },
      {
        key: "revenue",
        label: "NSB",
        description: "Hafta bazında toplam forecast NSB.",
        points: toPoints((point) => point.revenue),
        format: formatUSD,
        formatAxis: formatCompactUSD,
        valueHeader: "Forecast NSB",
      },
    ];
  }, [data.weeklyTrend]);

  const toggleManager = (managerId: string) => {
    setExpandedManagers((current) => ({
      ...current,
      [managerId]: !(current[managerId] ?? false),
    }));
  };

  const selectQuarter = useCallback(
    async (quarter: number) => {
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
    },
    [data.selectedQuarter]
  );

  const hiddenAttentionCount = Math.max(0, data.attentionTotalCount - data.attentionItems.length);

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
          <div
            className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            role="group"
            aria-label="Çeyrek seçimi"
          >
            {[1, 2, 3, 4].map((quarter) => (
              <Button
                key={quarter}
                type="button"
                size="sm"
                variant={data.selectedQuarter === quarter ? "default" : "ghost"}
                onClick={() => void selectQuarter(quarter)}
                disabled={isLoading}
                aria-pressed={data.selectedQuarter === quarter}
                className={data.selectedQuarter === quarter ? "bg-[#2E5A43] text-white hover:bg-[#1F3A2E]" : ""}
              >
                Q{quarter}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Yeniden yükleme sırasında önceki görünüm sönükleştirilerek korunur;
          iskelet gösterip düzeni sıçratmaktansa veri yerinde kalır. */}
      <div
        className={`space-y-6 transition-opacity duration-200 ${isLoading ? "pointer-events-none opacity-50" : "opacity-100"}`}
        aria-busy={isLoading}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AchievementTile
            label="GP Achievement"
            achievement={totals.gpAchievement}
            forecastValue={totals.forecastGp}
            targetValue={totals.targetGp}
            icon={Target}
          />
          <AchievementTile
            label="NSB Achievement"
            achievement={totals.revenueAchievement}
            forecastValue={totals.forecastRevenue}
            targetValue={totals.targetRevenue}
            icon={TrendingUp}
          />
          <ValueTile
            label="Forecast GP%"
            value={formatPercent(totals.forecastGpPercent)}
            icon={Percent}
            rows={[
              { label: "Hedef GP%", value: formatPercent(totals.targetGpPercent) },
              {
                label: "Fark",
                value: formatSignedPoints(totals.forecastGpPercent - totals.targetGpPercent),
              },
            ]}
          />
          <ValueTile
            label="Backlog"
            value={formatUSD(totals.backlogRevenue)}
            icon={DollarSign}
            rows={[
              { label: "Backlog GP", value: formatUSD(totals.backlogGp) },
              {
                label: "Backlog GP%",
                value: formatPercent(totals.backlogGpPercent),
                status: getGpStatus(totals.backlogGpPercent, totals.targetGpPercent),
              },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TrendCard
            title="Haftalık Forecast Trendi"
            measures={trendMeasures}
            emptyMessage="Bu çeyrek için henüz forecast girilmemiş."
            captionHeader="Kayıt"
          />

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
                  Satış Müdürü Forecast GP Dağılımı
                </h3>
                <p className="text-xs text-slate-500">
                  Dolu çubuk forecast GP, dikey işaret hedef GP konumudur.
                </p>
              </div>
              <BarChart3 className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            </div>
            {managerChartRows.length === 0 ? (
              <EmptyState message="Görüntülenecek satış müdürü bulunmuyor." />
            ) : (
              <div className="space-y-3">
                {managerChartRows.map((row) => {
                  return (
                    <div
                      key={row.id}
                      className="grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,130px)_1fr_auto_auto] sm:items-center"
                    >
                      <div className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {row.name}
                      </div>
                      <ComparisonBar
                        value={row.metrics.forecastGp}
                        target={row.metrics.targetGp}
                        scale={managerScale}
                      />
                      {/* Değer çubuğun dışında: kısa çubuklarda içeri sığmayıp taşıyordu. */}
                      <div className="text-right font-mono text-xs font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {formatUSD(row.metrics.forecastGp)}
                      </div>
                      <div className="w-16 text-right font-mono text-xs font-bold tabular-nums">
                        <AchievementCell value={row.metrics.gpAchievement} target={row.metrics.targetGp} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
              <Users2 className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            </div>
            {data.managers.length === 0 ? (
              <div className="p-4">
                <EmptyState message="Erişebildiğiniz aktif vendor bulunmuyor." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-emerald-950 shadow-sm">
                    <TableRow>
                      <TableHead className="bg-emerald-900 text-xs font-extrabold uppercase tracking-wide text-emerald-50">
                        Satış Müdürü / Marka
                      </TableHead>
                      {["Target GP", "Forecast GP", "GP Achv%", "GP%", "Forecast NSB", "NSB Achv%", "Backlog GP"].map(
                        (heading) => (
                          <TableHead
                            key={heading}
                            className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50"
                          >
                            {heading}
                          </TableHead>
                        )
                      )}
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
                                aria-expanded={isExpanded}
                                className="flex w-full items-center gap-2 text-left font-semibold text-slate-950 dark:text-slate-100"
                              >
                                <ToggleIcon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                                  <Users2 className="h-4 w-4" aria-hidden="true" />
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate">{manager.managerName}</span>
                                  <span className="block text-[11px] font-medium text-slate-500">
                                    {manager.forecastedCount}/{manager.vendors.length} forecast, {manager.targetCount} hedef
                                  </span>
                                </span>
                              </button>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums text-emerald-950 dark:text-emerald-200">
                              {formatUSD(metrics.targetGp)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums text-emerald-950 dark:text-emerald-200">
                              {formatUSD(metrics.forecastGp)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                              <AchievementCell value={metrics.gpAchievement} target={metrics.targetGp} />
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                              <GpPercentCell
                                value={metrics.forecastGpPercent}
                                revenue={metrics.forecastRevenue}
                                targetGpPercent={metrics.targetGpPercent}
                              />
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums text-emerald-950 dark:text-emerald-200">
                              {formatUSD(metrics.forecastRevenue)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                              <AchievementCell value={metrics.revenueAchievement} target={metrics.targetRevenue} />
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums text-emerald-950 dark:text-emerald-200">
                              {formatUSD(metrics.backlogGp)}
                            </TableCell>
                          </TableRow>
                          {isExpanded &&
                            manager.vendors.map((vendor) => {
                              const vendorMetrics = vendor.current;
                              return (
                                <TableRow
                                  key={vendor.vendorId}
                                  className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                                >
                                  <TableCell className="pl-14 font-semibold text-slate-900 dark:text-slate-100">
                                    {vendor.vendorName}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs tabular-nums">
                                    {formatUSD(vendorMetrics.targetGp)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs tabular-nums">
                                    {formatUSD(vendorMetrics.forecastGp)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                                    <AchievementCell
                                      value={vendorMetrics.gpAchievement}
                                      target={vendorMetrics.targetGp}
                                    />
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                                    <GpPercentCell
                                      value={vendorMetrics.forecastGpPercent}
                                      revenue={vendorMetrics.forecastRevenue}
                                      targetGpPercent={vendorMetrics.targetGpPercent}
                                    />
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs tabular-nums">
                                    {formatUSD(vendorMetrics.forecastRevenue)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                                    <AchievementCell
                                      value={vendorMetrics.revenueAchievement}
                                      target={vendorMetrics.targetRevenue}
                                    />
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs tabular-nums">
                                    {formatUSD(vendorMetrics.backlogGp)}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">
                  Dikkat Gerekenler
                </h3>
                <p className="text-xs text-slate-500">
                  {data.attentionTotalCount > 0
                    ? `Öncelik sırasına göre ${data.attentionItems.length}/${data.attentionTotalCount} kayıt.`
                    : "Öncelikli kontrol listesi."}
                </p>
              </div>
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            </div>
            <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
              {data.attentionItems.length === 0 ? (
                <EmptyState message="Şu an öne çıkan bir risk görünmüyor." />
              ) : (
                data.attentionItems.map((item, index) => {
                  const severityStatus: StatusKey =
                    item.severity === "high" ? "crit" : item.severity === "medium" ? "warn" : "neutral";
                  const { ink, Icon } = STATUS_META[severityStatus];

                  return (
                    <div
                      key={`${item.vendorName}-${item.type}-${index}`}
                      className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                          {item.vendorName}
                        </span>
                        <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold ${ink}`}>
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                          {item.type}
                        </span>
                      </div>
                      <div className="mt-1 text-xs font-medium text-slate-500">{item.managerName}</div>
                      <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">{item.detail}</div>
                    </div>
                  );
                })
              )}
              {hiddenAttentionCount > 0 ? (
                <p className="pt-1 text-center text-xs font-medium text-slate-500">
                  +{hiddenAttentionCount} kayıt daha listelenmedi.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
