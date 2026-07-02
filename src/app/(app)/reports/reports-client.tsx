"use client";

import React, { useCallback, useMemo, useState } from "react";
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
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Download,
  LineChart,
  Percent,
  Target,
  TrendingUp,
  Users2,
} from "lucide-react";
import { getCurrentFiscalContext } from "@/lib/fiscal";
import { getReportsData } from "./actions";

type ReportsData = Awaited<ReturnType<typeof getReportsData>>;
type ReportBasis = "closing" | "forecast";

type ReportMetricSource = {
  targetRevenue: number;
  targetGp: number;
  forecastRevenue: number;
  forecastGp: number;
  forecastGpPercent: number;
  forecastRevenueVsTarget: number;
  forecastGpVsTarget: number;
  forecastGpAccuracy: number;
  closingRevenue: number;
  closingGp: number;
  closingGpPercent: number;
  closingRevenueAchievement: number;
  closingGpAchievement: number;
};

interface ReportsClientProps {
  initialData: ReportsData;
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

function getSeverityClass(severity: string) {
  if (severity === "high") return "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-300";
  if (severity === "medium") return "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300";
  return "bg-slate-50 text-slate-700 ring-slate-200 dark:bg-slate-900 dark:text-slate-300";
}

function getBarColor(value: number) {
  if (value >= 100) return "bg-emerald-700";
  if (value >= 75) return "bg-amber-500";
  return "bg-red-600";
}

function getBasisLabels(basis: ReportBasis) {
  return basis === "closing"
    ? {
        name: "Kapanış bazlı",
        gp: "Kapanış GP",
        revenue: "Kapanış Revenue",
        gpPercent: "Kapanış GP%",
        compareTitle: "Target vs Kapanış",
        achievement: "GP Achievement",
        revenueAchievement: "Revenue Achievement",
        performance: "Forecast GP Accuracy",
        performanceDescription: "Forecast GP vs Kapanış GP",
        detailsSuffix: "kapanış",
      }
    : {
        name: "Forecast bazlı",
        gp: "Forecast GP",
        revenue: "Forecast Revenue",
        gpPercent: "Forecast GP%",
        compareTitle: "Target vs Forecast",
        achievement: "Forecast GP Achievement",
        revenueAchievement: "Forecast Revenue Achievement",
        performance: "Forecast GP Achievement",
        performanceDescription: "Forecast GP / Target GP",
        detailsSuffix: "forecast",
      };
}

function getBasisValues(source: ReportMetricSource, basis: ReportBasis) {
  if (basis === "forecast") {
    return {
      revenue: source.forecastRevenue,
      gp: source.forecastGp,
      gpPercent: source.forecastGpPercent,
      revenueAchievement: source.forecastRevenueVsTarget,
      gpAchievement: source.forecastGpVsTarget,
      performance: source.forecastGpVsTarget,
    };
  }

  return {
    revenue: source.closingRevenue,
    gp: source.closingGp,
    gpPercent: source.closingGpPercent,
    revenueAchievement: source.closingRevenueAchievement,
    gpAchievement: source.closingGpAchievement,
    performance: source.forecastGpAccuracy,
  };
}

function getBasisRisks(data: ReportsData, basis: ReportBasis) {
  if (basis === "closing") return data.risks;

  return data.managers
    .flatMap((manager) =>
      manager.vendors.flatMap((vendor) => {
        const items = [];
        if (vendor.forecastGp === 0 && vendor.forecastRevenue === 0) {
          items.push({
            type: "Eksik Forecast",
            severity: "high",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: "Seçili dönem için forecast verisi yok.",
          });
        }
        if (vendor.targetGp > 0 && vendor.forecastGpVsTarget < 75) {
          items.push({
            type: "Düşük Forecast GP",
            severity: "high",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: `Forecast GP achievement ${vendor.forecastGpVsTarget.toFixed(1)}%.`,
          });
        }
        if (vendor.forecastRevenue > 0 && vendor.forecastGpPercent < 10) {
          items.push({
            type: "Düşük Forecast GP%",
            severity: "medium",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: `Forecast GP% ${vendor.forecastGpPercent.toFixed(1)}%.`,
          });
        }
        if (vendor.backlogRevenue > vendor.forecastRevenue && vendor.backlogRevenue > 0) {
          items.push({
            type: "Backlog Üstte",
            severity: "medium",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: "Backlog revenue forecast revenue üzerinde.",
          });
        }
        return items;
      })
    )
    .slice(0, 16);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ProgressBar({
  value,
  colorClass,
}: {
  value: number;
  colorClass?: string;
}) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full rounded-full ${colorClass ?? getBarColor(value)}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  subValue,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  subValue: string;
  icon: React.ElementType;
  tone?: string;
}) {
  return (
    <div className="grid min-h-32 grid-cols-[1fr_auto] gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0">
        <span className="text-xs font-semibold uppercase text-slate-500">{label}</span>
        <div className={`mt-1 truncate text-2xl font-bold ${tone ?? "text-slate-950 dark:text-slate-100"}`}>
          {value}
        </div>
        <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{subValue}</div>
      </div>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}

function HorizontalBars({
  label,
  primaryLabel,
  primaryValue,
  secondaryLabel,
  secondaryValue,
  maxValue,
}: {
  label: string;
  primaryLabel: string;
  primaryValue: number;
  secondaryLabel: string;
  secondaryValue: number;
  maxValue: number;
}) {
  const safeMax = Math.max(1, maxValue);
  return (
    <div className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
        <span className="font-mono text-xs font-bold text-slate-500">{formatUSD(primaryValue)}</span>
      </div>
      <div className="space-y-2">
        <div>
          <div className="mb-1 flex justify-between text-[11px] font-medium text-slate-500">
            <span>{primaryLabel}</span>
            <span>{formatUSD(primaryValue)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-[#2E5A43]" style={{ width: `${(primaryValue / safeMax) * 100}%` }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[11px] font-medium text-slate-500">
            <span>{secondaryLabel}</span>
            <span>{formatUSD(secondaryValue)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-slate-500" style={{ width: `${(secondaryValue / safeMax) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function exportReportToExcel(data: ReportsData, basis: ReportBasis) {
  const labels = getBasisLabels(basis);
  const periodLabel = `FY${data.fiscalYear} - ${data.quarters.map((quarter) => `Q${quarter}`).join(", ")}`;
  const bar = (value: number) => {
    const width = Math.max(0, Math.min(100, value));
    const color = value >= 100 ? "#047857" : value >= 75 ? "#D97706" : "#DC2626";
    return `<div class="bar"><span style="width:${width}%;background:${color};"></span></div>`;
  };
  const money = (value: number) => Math.round(value).toLocaleString("en-US");
  const percent = (value: number) => `${value.toFixed(1)}%`;
  const row = (values: Array<string | number>) => `<tr>${values.map((value) => `<td>${value}</td>`).join("")}</tr>`;
  const header = (values: string[]) => `<tr>${values.map((value) => `<th>${escapeHtml(value)}</th>`).join("")}</tr>`;

  const managerRows = data.managers
    .map((manager) => {
      const values = getBasisValues(manager, basis);
      return row([
        escapeHtml(manager.managerName),
        money(values.gp),
        money(manager.targetGp),
        percent(values.gpAchievement),
        bar(values.gpAchievement),
        percent(values.performance),
        bar(values.performance),
        money(values.revenue),
        percent(values.revenueAchievement),
        percent(values.gpPercent),
      ]);
    })
    .join("");

  const vendorRows = data.managers
    .flatMap((manager) =>
      manager.vendors.map((vendor) => {
        const values = getBasisValues(vendor, basis);
        return row([
          escapeHtml(manager.managerName),
          escapeHtml(vendor.vendorName),
          money(values.gp),
          money(vendor.targetGp),
          percent(values.gpAchievement),
          bar(values.gpAchievement),
          percent(values.performance),
          money(values.revenue),
          percent(values.revenueAchievement),
          percent(values.gpPercent),
        ]);
      })
    )
    .join("");

  const risks = getBasisRisks(data, basis);

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
body{font-family:Arial,sans-serif;color:#0f172a}
h1{font-size:24px;margin:0 0 6px}
h2{font-size:16px;margin:24px 0 8px;color:#1F3A2E}
table{border-collapse:collapse;width:100%;margin-bottom:16px}
th{background:#1F3A2E;color:#fff;text-align:left}
th,td{border:1px solid #cbd5e1;padding:7px;font-size:12px;vertical-align:middle}
.kpi td:first-child{font-weight:bold;background:#f8fafc}
.bar{width:120px;height:10px;background:#e2e8f0;border-radius:10px;overflow:hidden}
.bar span{display:block;height:10px;border-radius:10px}
</style>
</head>
<body>
<h1>Raporlama</h1>
<div>${escapeHtml(periodLabel)} | ${escapeHtml(labels.name)}</div>
<h2>Özet</h2>
<table class="kpi">
${row([labels.gp, money(getBasisValues(data.totals, basis).gp)])}
${row([labels.achievement, percent(getBasisValues(data.totals, basis).gpAchievement), bar(getBasisValues(data.totals, basis).gpAchievement)])}
${row([labels.performance, percent(getBasisValues(data.totals, basis).performance), bar(getBasisValues(data.totals, basis).performance)])}
${row([labels.revenue, money(getBasisValues(data.totals, basis).revenue)])}
${row([labels.revenueAchievement, percent(getBasisValues(data.totals, basis).revenueAchievement), bar(getBasisValues(data.totals, basis).revenueAchievement)])}
${row([labels.gpPercent, percent(getBasisValues(data.totals, basis).gpPercent)])}
</table>
<h2>${escapeHtml(labels.compareTitle)}</h2>
<table>
${header(["Dönem", labels.gp, "Target GP", "GP Achv", "Grafik", labels.revenue, "Target Revenue", "Revenue Achv"])}
${data.quarterSummary
  .map((quarter) => {
    const values = getBasisValues(quarter, basis);
    return row([
      `Q${quarter.quarter}`,
      money(values.gp),
      money(quarter.targetGp),
      percent(values.gpAchievement),
      bar(values.gpAchievement),
      money(values.revenue),
      money(quarter.targetRevenue),
      percent(values.revenueAchievement),
    ]);
  })
  .join("")}
</table>
<h2>Forecast Performansı</h2>
<table>
${header(["Satış Müdürü", labels.gp, "Target GP", "GP Achv", "GP Achv Grafik", labels.performance, "Performans Grafik", labels.revenue, "Revenue Achv", "GP%"])}
${managerRows}
</table>
<h2>Haftalık Backlog</h2>
<table>
${header(["Dönem", "Hafta", "Backlog GP", "Backlog Revenue", "GP%"])}
${data.weeklyBacklog
  .map((week) =>
    row([`Q${week.quarter}`, week.weekNumber, money(week.backlogGp), money(week.backlogRevenue), percent(week.backlogGpPercent)])
  )
  .join("")}
</table>
<h2>SM Performansı Detay</h2>
<table>
${header(["Satış Müdürü", "Vendor", labels.gp, "Target GP", "GP Achv", "Grafik", labels.performance, labels.revenue, "Revenue Achv", "GP%"])}
${vendorRows}
</table>
<h2>Dikkat Noktaları</h2>
<table>
${header(["Öncelik", "Satış Müdürü", "Vendor", "Detay"])}
${risks.map((risk) => row([escapeHtml(risk.type), escapeHtml(risk.managerName), escapeHtml(risk.vendorName), escapeHtml(risk.detail)])).join("")}
</table>
</body>
</html>`;

  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `raporlama-${basis}-FY${data.fiscalYear}-${data.quarters.map((quarter) => `Q${quarter}`).join("-")}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsClient({ initialData }: ReportsClientProps) {
  const currentContext = getCurrentFiscalContext();
  const [fiscalYear, setFiscalYear] = useState(initialData.fiscalYear);
  const [selectedQuarters, setSelectedQuarters] = useState<number[]>(initialData.quarters);
  const [data, setData] = useState(initialData);
  const [reportBasis, setReportBasis] = useState<ReportBasis>("closing");
  const [isLoading, setIsLoading] = useState(false);
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});

  const fiscalYearsRange = [
    currentContext.fiscalYear - 1,
    currentContext.fiscalYear,
    currentContext.fiscalYear + 1,
  ];

  const labels = getBasisLabels(reportBasis);
  const totalValues = getBasisValues(data.totals, reportBasis);
  const basisRisks = useMemo(() => getBasisRisks(data, reportBasis), [data, reportBasis]);
  const maxQuarterValue = useMemo(
    () =>
      Math.max(
        1,
        ...data.quarterSummary.flatMap((quarter) => [getBasisValues(quarter, reportBasis).gp, quarter.targetGp])
      ),
    [data.quarterSummary, reportBasis]
  );
  const maxWeeklyBacklog = useMemo(
    () => Math.max(1, ...data.weeklyBacklog.flatMap((week) => [week.backlogGp, week.backlogRevenue])),
    [data.weeklyBacklog]
  );

  const refreshData = useCallback(
    async (nextFiscalYear = fiscalYear, nextQuarters = selectedQuarters) => {
      setIsLoading(true);
      try {
        const reportData = await getReportsData(nextFiscalYear, nextQuarters);
        setData(reportData);
        setExpandedManagers({});
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : "Rapor verileri alınırken hata oluştu.");
      } finally {
        setIsLoading(false);
      }
    },
    [fiscalYear, selectedQuarters]
  );

  const handleYearChange = (value: string | null) => {
    if (!value) return;
    const nextFiscalYear = Number(value);
    setFiscalYear(nextFiscalYear);
    void refreshData(nextFiscalYear, selectedQuarters);
  };

  const toggleQuarter = (quarter: number) => {
    const exists = selectedQuarters.includes(quarter);
    const nextQuarters = exists
      ? selectedQuarters.filter((selectedQuarter) => selectedQuarter !== quarter)
      : [...selectedQuarters, quarter].sort((a, b) => a - b);

    if (nextQuarters.length === 0) {
      toast.error("En az bir çeyrek seçili olmalı.");
      return;
    }

    setSelectedQuarters(nextQuarters);
    void refreshData(fiscalYear, nextQuarters);
  };

  const toggleManager = (managerId: string) => {
    setExpandedManagers((current) => ({
      ...current,
      [managerId]: !(current[managerId] ?? false),
    }));
  };

  const periodLabel = `FY${data.fiscalYear} - ${data.quarters.map((quarter) => `Q${quarter}`).join(", ")}`;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400">
            Raporlama
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Target karşılaştırması, forecast performansı, haftalık backlog ve SM detayları.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(fiscalYear)} onValueChange={handleYearChange}>
            <SelectTrigger className="w-28 bg-white dark:bg-slate-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fiscalYearsRange.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  FY{year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            {[1, 2, 3, 4].map((quarter) => (
              <Button
                key={quarter}
                type="button"
                variant={selectedQuarters.includes(quarter) ? "default" : "ghost"}
                size="sm"
                className={selectedQuarters.includes(quarter) ? "bg-[#2E5A43] hover:bg-[#244936]" : ""}
                onClick={() => toggleQuarter(quarter)}
              >
                Q{quarter}
              </Button>
            ))}
          </div>
          <div className="flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            <Button
              type="button"
              variant={reportBasis === "closing" ? "default" : "ghost"}
              size="sm"
              className={reportBasis === "closing" ? "bg-[#2E5A43] hover:bg-[#244936]" : ""}
              onClick={() => setReportBasis("closing")}
            >
              Kapanış
            </Button>
            <Button
              type="button"
              variant={reportBasis === "forecast" ? "default" : "ghost"}
              size="sm"
              className={reportBasis === "forecast" ? "bg-[#2E5A43] hover:bg-[#244936]" : ""}
              onClick={() => setReportBasis("forecast")}
            >
              Forecast
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            className="gap-2 bg-white dark:bg-slate-900"
            onClick={() => exportReportToExcel(data, reportBasis)}
          >
            <Download className="h-4 w-4" />
            Excel Çıktısı
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm font-medium text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          Rapor verileri yükleniyor...
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label={labels.gp}
          value={formatUSD(totalValues.gp)}
          subValue={`Target GP: ${formatUSD(data.totals.targetGp)}`}
          icon={TrendingUp}
        />
        <KpiCard
          label={labels.achievement}
          value={formatPercent(totalValues.gpAchievement)}
          subValue={`${labels.gp} / Target GP`}
          icon={Target}
          tone={getAchievementTone(totalValues.gpAchievement)}
        />
        <KpiCard
          label={labels.performance}
          value={formatPercent(totalValues.performance)}
          subValue={labels.performanceDescription}
          icon={BarChart3}
          tone={getAchievementTone(totalValues.performance)}
        />
        <KpiCard
          label={labels.revenue}
          value={formatUSD(totalValues.revenue)}
          subValue={`Target Revenue: ${formatUSD(data.totals.targetRevenue)}`}
          icon={LineChart}
        />
        <KpiCard
          label={labels.gpPercent}
          value={formatPercent(totalValues.gpPercent)}
          subValue={`${periodLabel} | ${labels.name}`}
          icon={Percent}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-950 dark:text-slate-100">{labels.compareTitle}</h2>
              <p className="text-xs text-slate-500">GP önce, revenue ikinci sırada gösterilir.</p>
            </div>
            <Badge variant="outline">{labels.name}</Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {data.quarterSummary.map((quarter) => {
              const values = getBasisValues(quarter, reportBasis);
              return (
                <HorizontalBars
                  key={quarter.quarter}
                  label={`Q${quarter.quarter}`}
                  primaryLabel={labels.gp}
                  primaryValue={values.gp}
                  secondaryLabel="Target GP"
                  secondaryValue={quarter.targetGp}
                  maxValue={maxQuarterValue}
                />
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-950 dark:text-slate-100">Forecast Performansı</h2>
            <p className="text-xs text-slate-500">Satış müdürü bazında {labels.performance.toLowerCase()}.</p>
          </div>
          <div className="space-y-3">
            {data.managers.slice(0, 8).map((manager) => {
              const values = getBasisValues(manager, reportBasis);
              return (
                <div key={manager.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{manager.managerName}</span>
                    <span className={`font-mono text-xs font-bold ${getAchievementTone(values.performance)}`}>
                      {formatPercent(values.performance)}
                    </span>
                  </div>
                  <ProgressBar value={values.performance} />
                </div>
              );
            })}
            {data.managers.length === 0 ? (
              <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-950">
                Gösterilecek SM verisi bulunamadı.
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-950 dark:text-slate-100">Haftalık Backlog Grafiği</h2>
            <p className="text-xs text-slate-500">Backlog GP ana metrik, revenue destek metrik olarak gösterilir.</p>
          </div>
          <Badge variant="outline">{data.weeklyBacklog.length} hafta</Badge>
        </div>
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-max items-end gap-3">
            {data.weeklyBacklog.map((week) => (
              <div key={`${week.quarter}-${week.weekNumber}`} className="flex w-16 flex-col items-center gap-2">
                <div className="flex h-36 w-full items-end justify-center gap-1 rounded-md bg-slate-50 p-1 dark:bg-slate-950">
                  <span
                    className="w-5 rounded-t-sm bg-[#2E5A43]"
                    style={{ height: `${Math.max(4, (week.backlogGp / maxWeeklyBacklog) * 100)}%` }}
                    title={`GP ${formatUSD(week.backlogGp)}`}
                  />
                  <span
                    className="w-5 rounded-t-sm bg-slate-500"
                    style={{ height: `${Math.max(4, (week.backlogRevenue / maxWeeklyBacklog) * 100)}%` }}
                    title={`Revenue ${formatUSD(week.backlogRevenue)}`}
                  />
                </div>
                <div className="text-center text-[11px] font-semibold text-slate-500">
                  Q{week.quarter} H{week.weekNumber}
                </div>
              </div>
            ))}
            {data.weeklyBacklog.length === 0 ? (
              <div className="w-full rounded-lg bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-950">
                Seçili dönem için backlog verisi bulunamadı.
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex gap-4 text-xs font-medium text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#2E5A43]" /> GP</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-500" /> Revenue</span>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-950 dark:text-slate-100">SM Performansı</h2>
            <p className="text-xs text-slate-500">Akordiyon tabloda vendor detayları.</p>
          </div>
          <Users2 className="h-5 w-5 text-emerald-800 dark:text-emerald-300" />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56">Satış Müdürü / Vendor</TableHead>
                <TableHead className="text-right">{labels.gp}</TableHead>
                <TableHead className="text-right">Target GP</TableHead>
                <TableHead className="text-right">GP Achv</TableHead>
                <TableHead className="text-right">{labels.performance}</TableHead>
                <TableHead className="text-right">{labels.revenue}</TableHead>
                <TableHead className="text-right">Revenue Achv</TableHead>
                <TableHead className="text-right">GP%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.managers.map((manager) => {
                const isExpanded = expandedManagers[manager.id] ?? false;
                const managerValues = getBasisValues(manager, reportBasis);
                return (
                  <React.Fragment key={manager.id}>
                    <TableRow className="cursor-pointer bg-slate-50/80 hover:bg-slate-100 dark:bg-slate-950/40 dark:hover:bg-slate-900" onClick={() => toggleManager(manager.id)}>
                      <TableCell className="font-semibold">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span>{manager.managerName}</span>
                          <Badge variant="outline">{manager.vendors.length} vendor</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold">{formatUSD(managerValues.gp)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatUSD(manager.targetGp)}</TableCell>
                      <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(managerValues.gpAchievement)}`}>{formatPercent(managerValues.gpAchievement)}</TableCell>
                      <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(managerValues.performance)}`}>{formatPercent(managerValues.performance)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatUSD(managerValues.revenue)}</TableCell>
                      <TableCell className={`text-right font-mono text-xs ${getAchievementTone(managerValues.revenueAchievement)}`}>{formatPercent(managerValues.revenueAchievement)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatPercent(managerValues.gpPercent)}</TableCell>
                    </TableRow>
                    {isExpanded
                      ? manager.vendors.map((vendor) => {
                          const vendorValues = getBasisValues(vendor, reportBasis);
                          return (
                            <TableRow key={vendor.vendorId}>
                              <TableCell className="pl-10 text-sm">
                                <div className="font-medium text-slate-800 dark:text-slate-100">{vendor.vendorName}</div>
                                <div className="text-xs text-slate-500">
                                  {reportBasis === "closing"
                                    ? `${vendor.closingCount}/${vendor.periodCount} ${labels.detailsSuffix}`
                                    : labels.name}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs font-bold">{formatUSD(vendorValues.gp)}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{formatUSD(vendor.targetGp)}</TableCell>
                              <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(vendorValues.gpAchievement)}`}>{formatPercent(vendorValues.gpAchievement)}</TableCell>
                              <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(vendorValues.performance)}`}>{formatPercent(vendorValues.performance)}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{formatUSD(vendorValues.revenue)}</TableCell>
                              <TableCell className={`text-right font-mono text-xs ${getAchievementTone(vendorValues.revenueAchievement)}`}>{formatPercent(vendorValues.revenueAchievement)}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{formatPercent(vendorValues.gpPercent)}</TableCell>
                            </TableRow>
                          );
                        })
                      : null}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <h2 className="text-base font-bold text-slate-950 dark:text-slate-100">Dikkat Noktaları</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {basisRisks.map((risk, index) => (
            <div key={`${risk.managerName}-${risk.vendorName}-${risk.type}-${index}`} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
              <Badge className={`mb-2 ring-1 ${getSeverityClass(risk.severity)}`}>{risk.type}</Badge>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{risk.vendorName}</div>
              <div className="text-xs text-slate-500">{risk.managerName}</div>
              <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">{risk.detail}</div>
            </div>
          ))}
          {basisRisks.length === 0 ? (
            <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-950">
              Seçili dönem için kritik dikkat noktası görünmüyor.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
