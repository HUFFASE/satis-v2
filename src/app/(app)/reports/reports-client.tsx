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
  Printer,
  Percent,
  Target,
  TrendingUp,
  Users2,
} from "lucide-react";
import { getCurrentFiscalContext } from "@/lib/fiscal";
import { getReportsData } from "./actions";
import {
  formatCompactUSD,
  formatPercent,
  formatSignedPoints,
  formatSignedUSD,
  formatUSD,
} from "@/components/viz/format";
import {
  AchievementCell,
  GpPercentCell,
  StatusKey,
  STATUS_META,
  StatusValue,
  getAchievementStatus,
  getGpStatus,
} from "@/components/viz/status";
import { AchievementTile, ComparisonBar, EmptyState, Meter, ValueTile } from "@/components/viz/tiles";
import { KPI_TILE_SHELL } from "@/components/viz/card-shell";
import { TrendCard, TrendMeasure } from "@/components/viz/trend-chart";

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

/** Uyarı önem derecesini ortak durum paletine eşler. */
function getSeverityStatus(severity: string): StatusKey {
  if (severity === "high") return "crit";
  if (severity === "medium") return "warn";
  return "neutral";
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Hedef GP oranı; kârlılık durumunun karşılaştırma tabanı. */
function gpPercentOf(revenue: number, gp: number) {
  return revenue > 0 ? (gp / revenue) * 100 : 0;
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
    );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Ölçerli performans kartı; %100 üstü değerler kırpılmadan gösterilir. */
function PerformanceTile({ label, value, description }: { label: string; value: number; description: string }) {
  const status = getAchievementStatus(value);
  const { ink, Icon: StatusIcon, label: statusLabel } = STATUS_META[status];

  return (
    <div className={KPI_TILE_SHELL}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          <BarChart3 className="h-4 w-4" aria-hidden="true" />
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
      <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">{description}</p>
    </div>
  );
}

/**
 * Rapor çıktısının HTML'ini üretir. İndirme işleminden ayrı tutulur; böylece
 * üretilen çıktı yan etki olmadan denenebilir.
 */
export function buildReportHtml(data: ReportsData, basis: ReportBasis) {
  const labels = getBasisLabels(basis);
  const periodLabel = `FY${data.fiscalYear} - ${data.quarters.map((quarter) => `Q${quarter}`).join(", ")}`;
  const totals = getBasisValues(data.totals, basis);

  // Ekrandaki durum paletinin karşılığı. Renk burada da tek başına anlam
  // taşımaz: her değer bir simge ve gerekli yerlerde metin etiketle birlikte
  // yazılır (renk körlüğü ve siyah-beyaz çıktı için).
  const STATUS_XLS: Record<StatusKey, { ink: string; mark: string; glyph: string; label: string }> = {
    good: { ink: "#047857", mark: "#047857", glyph: "✓", label: "Hedefte" },
    warn: { ink: "#B45309", mark: "#D97706", glyph: "!", label: "Takipte" },
    crit: { ink: "#B91C1C", mark: "#DC2626", glyph: "▲", label: "Riskli" },
    neutral: { ink: "#64748B", mark: "#E2E8F0", glyph: "–", label: "Veri yok" },
  };

  const money = formatUSD;

  /** Ekrandaki StatusValue'nun karşılığı: simge + sayı, durum renginde. */
  const statusCell = (value: number, status: StatusKey) =>
    `<td class="status" style="color:${STATUS_XLS[status].ink}">${STATUS_XLS[status].glyph} ${formatPercent(
      value
    )}</td>`;

  /** Payda yoksa oran tanımsızdır; ekranda olduğu gibi tire yazılır. */
  const achievementCell = (value: number, target: number) =>
    target > 0
      ? statusCell(value, getAchievementStatus(value))
      : `<td class="status" style="color:${STATUS_XLS.neutral.ink}">—</td>`;

  const gpPercentCell = (value: number, revenue: number, target: number) =>
    revenue > 0 && target > 0
      ? statusCell(value, getGpStatus(value, target))
      : `<td class="status" style="color:${STATUS_XLS.neutral.ink}">—</td>`;

  /**
   * Ekrandaki Meter'ın karşılığı. Ölçek max(100, değer) olduğu için %100'ü aşan
   * gerçekleşme kırpılmaz; aşan kısım ayrı bir segment olarak çizilir.
   * Excel mutlak konumlandırmayı güvenilir şekilde işlemediği için işaret
   * yerine iki segment kullanılır.
   */
  const meter = (value: number, hasTarget: boolean) => {
    if (!hasTarget) return `<td class="bar-cell"></td>`;
    const scale = Math.max(100, value);
    const base = (Math.min(value, 100) / scale) * 100;
    const over = value > 100 ? ((value - 100) / scale) * 100 : 0;
    const color = STATUS_XLS[getAchievementStatus(value)].mark;
    const segments =
      `<span style="width:${base.toFixed(1)}%;background:${color}"></span>` +
      (over > 0 ? `<span style="width:${over.toFixed(1)}%;background:#1F3A2E"></span>` : "");
    return `<td class="bar-cell"><div class="bar">${segments}</div></td>`;
  };

  const th = (values: string[]) => `<tr>${values.map((value) => `<th>${escapeHtml(value)}</th>`).join("")}</tr>`;
  const td = (value: string | number) => `<td>${value}</td>`;
  const tdText = (value: string) => `<td>${escapeHtml(value)}</td>`;
  const tdNum = (value: string) => `<td class="num">${value}</td>`;

  // Ekrandaki sıralamanın aynısı: performansa göre azalan.
  const rankedManagers = data.managers
    .map((manager) => ({ manager, values: getBasisValues(manager, basis) }))
    .sort((a, b) => b.values.performance - a.values.performance);

  // Forecast bazında labels.achievement ile labels.performance aynı metriktir;
  // ekranda olduğu gibi yalnızca kapanış bazında ayrı bir sütun/satır açılır.
  const hasSeparatePerformance = basis === "closing";

  const summaryRow = (label: string, value: string, meterCell?: string) =>
    `<tr><td class="kpi-label">${escapeHtml(label)}</td>${value}${meterCell ?? "<td></td>"}</tr>`;

  const managerRows = rankedManagers
    .map(({ manager, values }) =>
      [
        "<tr>",
        tdText(manager.managerName),
        tdNum(money(values.gp)),
        tdNum(money(manager.targetGp)),
        achievementCell(values.gpAchievement, manager.targetGp),
        meter(values.gpAchievement, manager.targetGp > 0),
        ...(hasSeparatePerformance
          ? [statusCell(values.performance, getAchievementStatus(values.performance))]
          : []),
        tdNum(money(values.revenue)),
        achievementCell(values.revenueAchievement, manager.targetRevenue),
        gpPercentCell(values.gpPercent, values.revenue, gpPercentOf(manager.targetRevenue, manager.targetGp)),
        "</tr>",
      ].join("")
    )
    .join("");

  const vendorRows = rankedManagers
    .flatMap(({ manager }) =>
      manager.vendors.map((vendor) => {
        const values = getBasisValues(vendor, basis);
        return [
          "<tr>",
          tdText(manager.managerName),
          tdText(vendor.vendorName),
          tdNum(money(values.gp)),
          tdNum(money(vendor.targetGp)),
          achievementCell(values.gpAchievement, vendor.targetGp),
          meter(values.gpAchievement, vendor.targetGp > 0),
          ...(hasSeparatePerformance
            ? [statusCell(values.performance, getAchievementStatus(values.performance))]
            : []),
          tdNum(money(values.revenue)),
          achievementCell(values.revenueAchievement, vendor.targetRevenue),
          gpPercentCell(values.gpPercent, values.revenue, gpPercentOf(manager.targetRevenue, manager.targetGp)),
          "</tr>",
        ].join("");
      })
    )
    .join("");

  // Ekrandaki gibi önem sırasına dizilir. Dışa aktarımda kesme yoktur:
  // ekrandaki 16'lık sınır yerleşim kaygısıydı, dosyada tüm kayıtlar bulunur.
  const risks = [...getBasisRisks(data, basis)].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
  );

  const targetGpPercentTotal =
    data.totals.targetRevenue > 0 ? (data.totals.targetGp / data.totals.targetRevenue) * 100 : 0;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
body{font-family:Calibri,Arial,sans-serif;color:#0f172a;background:#ffffff}
h1{font-family:Georgia,'Times New Roman',serif;font-size:22px;margin:0 0 4px;color:#1F3A2E}
h2{font-family:Georgia,'Times New Roman',serif;font-size:15px;margin:22px 0 8px;color:#1F3A2E}
.subtitle{font-size:12px;color:#64748B;margin-bottom:4px}
table{border-collapse:collapse;width:100%;margin-bottom:14px}
th{background:#1F3A2E;color:#ffffff;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
th,td{border:1px solid #E2E8F0;padding:6px 8px;font-size:12px;vertical-align:middle}
td.num{text-align:right;font-family:Consolas,'Courier New',monospace}
td.status{text-align:right;font-family:Consolas,'Courier New',monospace;font-weight:bold}
td.kpi-label{font-weight:bold;background:#F8FAFC;width:220px}
.bar-cell{width:132px}
.bar{width:120px;height:10px;background:#D6F0E3;border-radius:10px;overflow:hidden;white-space:nowrap;font-size:0}
.bar span{display:inline-block;height:10px;vertical-align:top}
.legend{font-size:11px;color:#64748B;margin:2px 0 14px}
</style>
</head>
<body>
<h1>Raporlama</h1>
<div class="subtitle">${escapeHtml(periodLabel)} &middot; ${escapeHtml(labels.name)}</div>

<h2>Özet</h2>
<table>
${summaryRow(labels.gp, tdNum(money(totals.gp)))}
${summaryRow(
  labels.achievement,
  achievementCell(totals.gpAchievement, data.totals.targetGp),
  meter(totals.gpAchievement, data.totals.targetGp > 0)
)}
${summaryRow(labels.revenue, tdNum(money(totals.revenue)))}
${summaryRow(
  labels.revenueAchievement,
  achievementCell(totals.revenueAchievement, data.totals.targetRevenue),
  meter(totals.revenueAchievement, data.totals.targetRevenue > 0)
)}
${summaryRow("Hedef GP", tdNum(money(data.totals.targetGp)))}
${summaryRow("GP Farkı", tdNum(formatSignedUSD(totals.gp - data.totals.targetGp)))}
${summaryRow("Hedef Revenue", tdNum(money(data.totals.targetRevenue)))}
${summaryRow("Revenue Farkı", tdNum(formatSignedUSD(totals.revenue - data.totals.targetRevenue)))}
${summaryRow(labels.gpPercent, gpPercentCell(totals.gpPercent, totals.revenue, targetGpPercentTotal))}
${summaryRow("Hedef GP%", tdNum(formatPercent(targetGpPercentTotal)))}
${summaryRow("GP% Farkı", tdNum(formatSignedPoints(totals.gpPercent - targetGpPercentTotal)))}
${
  hasSeparatePerformance
    ? summaryRow(
        labels.performance,
        statusCell(totals.performance, getAchievementStatus(totals.performance)),
        meter(totals.performance, true)
      )
    : ""
}
</table>
<div class="legend">Durum eşikleri: ${STATUS_XLS.good.glyph} ${STATUS_XLS.good.label} (%100+) &middot; ${STATUS_XLS.warn.glyph} ${STATUS_XLS.warn.label} (%75-100) &middot; ${STATUS_XLS.crit.glyph} ${STATUS_XLS.crit.label} (%75 altı) &middot; — hedef girilmemiş</div>

<h2>${escapeHtml(labels.compareTitle)}</h2>
<table>
${th(["Dönem", labels.gp, "Target GP", "GP Achv", "Grafik", labels.revenue, "Target Revenue", "Revenue Achv"])}
${data.quarterSummary
  .map((quarter) => {
    const values = getBasisValues(quarter, basis);
    return [
      "<tr>",
      tdText(`Q${quarter.quarter}`),
      tdNum(money(values.gp)),
      tdNum(money(quarter.targetGp)),
      achievementCell(values.gpAchievement, quarter.targetGp),
      meter(values.gpAchievement, quarter.targetGp > 0),
      tdNum(money(values.revenue)),
      tdNum(money(quarter.targetRevenue)),
      achievementCell(values.revenueAchievement, quarter.targetRevenue),
      "</tr>",
    ].join("");
  })
  .join("")}
</table>

<h2>SM Performansı</h2>
<table>
${th([
  "Satış Müdürü",
  labels.gp,
  "Target GP",
  "GP Achv",
  "Grafik",
  ...(hasSeparatePerformance ? [labels.performance] : []),
  labels.revenue,
  "Revenue Achv",
  "GP%",
])}
${managerRows}
</table>

<h2>Haftalık Backlog</h2>
<table>
${th(["Dönem", "Hafta", "Backlog GP", "Backlog Revenue", "GP%"])}
${data.weeklyBacklog
  .map((week) =>
    [
      "<tr>",
      tdText(`Q${week.quarter}`),
      td(week.weekNumber),
      tdNum(money(week.backlogGp)),
      tdNum(money(week.backlogRevenue)),
      gpPercentCell(week.backlogGpPercent, week.backlogRevenue, 0),
      "</tr>",
    ].join("")
  )
  .join("")}
</table>

<h2>SM Performansı &mdash; Vendor Detayı</h2>
<table>
${th([
  "Satış Müdürü",
  "Vendor",
  labels.gp,
  "Target GP",
  "GP Achv",
  "Grafik",
  ...(hasSeparatePerformance ? [labels.performance] : []),
  labels.revenue,
  "Revenue Achv",
  "GP%",
])}
${vendorRows}
</table>

<h2>Dikkat Noktaları (${risks.length})</h2>
<table>
${th(["Öncelik", "Uyarı", "Satış Müdürü", "Vendor", "Detay"])}
${risks
  .map((risk) => {
    const status = getSeverityStatus(risk.severity);
    return [
      "<tr>",
      `<td style="color:${STATUS_XLS[status].ink};font-weight:bold">${STATUS_XLS[status].glyph} ${escapeHtml(
        risk.severity === "high" ? "Yüksek" : risk.severity === "medium" ? "Orta" : "Düşük"
      )}</td>`,
      tdText(risk.type),
      tdText(risk.managerName),
      tdText(risk.vendorName),
      tdText(risk.detail),
      "</tr>",
    ].join("");
  })
  .join("")}
</table>
</body>
</html>`;

  return html;
}

function exportReportToExcel(data: ReportsData, basis: ReportBasis) {
  const blob = new Blob([buildReportHtml(data, basis)], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
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
  const [isPrinting, setIsPrinting] = useState(false);

  const fiscalYearsRange = [
    currentContext.fiscalYear - 1,
    currentContext.fiscalYear,
    currentContext.fiscalYear + 1,
  ];

  const labels = getBasisLabels(reportBasis);
  const totalValues = getBasisValues(data.totals, reportBasis);
  // Kesme işlemi sıralamadan sonra yapılır; aksi halde listenin sonundaki bir
  // "high" uyarı, baştaki düşük öncelikli kayıtlar yüzünden düşebiliyordu.
  const allRisks = useMemo(
    () =>
      [...getBasisRisks(data, reportBasis)].sort(
        (a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
      ),
    [data, reportBasis]
  );
  // Forecast bazında labels.achievement ile labels.performance aynı metriktir;
  // ayrı sütun/kart yalnızca kapanış bazında açılır.
  const hasSeparatePerformance = reportBasis === "closing";
  const MANAGER_CHART_LIMIT = 8;
  const rankedManagers = useMemo(
    () =>
      data.managers
        .map((manager) => ({ manager, values: getBasisValues(manager, reportBasis) }))
        .sort((a, b) => b.values.performance - a.values.performance),
    [data.managers, reportBasis]
  );
  const hiddenManagerCount = Math.max(0, rankedManagers.length - MANAGER_CHART_LIMIT);
  const RISK_LIMIT = 16;
  const basisRisks = allRisks.slice(0, RISK_LIMIT);
  const hiddenRiskCount = Math.max(0, allRisks.length - basisRisks.length);
  const targetGpPercent =
    data.totals.targetRevenue > 0 ? (data.totals.targetGp / data.totals.targetRevenue) * 100 : 0;
  const maxQuarterValue = useMemo(
    () =>
      Math.max(
        1,
        ...data.quarterSummary.flatMap((quarter) => [getBasisValues(quarter, reportBasis).gp, quarter.targetGp])
      ),
    [data.quarterSummary, reportBasis]
  );
  const backlogMeasures: TrendMeasure[] = useMemo(() => {
    const weeks = data.weeklyBacklog;
    // Birden fazla çeyrek seçilebildiği için hafta numaraları tekrar eder;
    // etikete çeyrek de eklenir.
    const spansMultipleQuarters = new Set(weeks.map((week) => week.quarter)).size > 1;
    const toPoints = (pick: (week: (typeof weeks)[number]) => number) =>
      weeks.map((week) => ({
        label: spansMultipleQuarters ? `Q${week.quarter}H${week.weekNumber}` : `H${week.weekNumber}`,
        tooltipLabel: `Q${week.quarter} Hafta ${week.weekNumber}`,
        value: pick(week),
      }));

    return [
      {
        key: "gp",
        label: "GP",
        description: "Hafta bazında backlog GP.",
        points: toPoints((week) => week.backlogGp),
        format: formatUSD,
        formatAxis: formatCompactUSD,
        valueHeader: "Backlog GP",
        periodHeader: "Dönem",
      },
      {
        key: "revenue",
        label: "Revenue",
        description: "Hafta bazında backlog revenue.",
        points: toPoints((week) => week.backlogRevenue),
        format: formatUSD,
        formatAxis: formatCompactUSD,
        valueHeader: "Backlog Revenue",
        periodHeader: "Dönem",
      },
    ];
  }, [data.weeklyBacklog]);

  /**
   * PDF, ayrı bir şablondan değil sayfanın kendisinden üretilir: kullanıcı
   * yazdırma penceresinde "PDF olarak kaydet"i seçer. Böylece çıktı ekrandaki
   * kartlar, ölçerler ve SVG grafiklerle birebir aynı olur ve vektör kalır.
   *
   * Yazdırmadan önce tüm satış müdürleri açılır; kapalı akordiyon satırları
   * çıktıda vendor detayı olmadan çıkıyordu. Yazdırma bitince önceki durum
   * geri yüklenir.
   */
  const handlePrintPdf = useCallback(() => {
    const previousExpanded = expandedManagers;
    setExpandedManagers(Object.fromEntries(data.managers.map((manager) => [manager.id, true])));
    setIsPrinting(true);

    const restore = () => {
      setExpandedManagers(previousExpanded);
      setIsPrinting(false);
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);

    // Açılan satırların boyanmasını beklemeden yazdırma diyalogu açılırsa
    // detaylar çıktıya girmiyor.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
  }, [data.managers, expandedManagers]);

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
          {/* Yazdırırken üst çubuk ve filtreler gizlendiği için dönem/baz bilgisi
              bu satırda taşınır. CSS `@media print` yerine state kullanılıyor:
              ekranda doğrulanabiliyor ve derleme zincirine bağımlı değil. */}
          {isPrinting ? (
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {periodLabel} · {labels.name}
            </p>
          ) : null}
        </div>
        <div className="print-hide flex flex-wrap items-center gap-2">
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
          <Button
            type="button"
            variant="outline"
            className="gap-2 bg-white dark:bg-slate-900"
            onClick={handlePrintPdf}
          >
            <Printer className="h-4 w-4" />
            PDF Çıktısı
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm font-medium text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          Rapor verileri yükleniyor...
        </div>
      ) : null}

      {/* Forecast bazında labels.achievement ile labels.performance aynı metriği
          gösteriyordu (ikisi de forecastGpVsTarget); o kart yalnızca kapanış
          bazında, gerçekten farklı bir değer taşıdığında çiziliyor. */}
      <div className={`grid gap-4 md:grid-cols-2 ${reportBasis === "closing" ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
        <AchievementTile
          label={labels.achievement}
          achievement={totalValues.gpAchievement}
          forecastValue={totalValues.gp}
          targetValue={data.totals.targetGp}
          icon={Target}
        />
        <AchievementTile
          label={labels.revenueAchievement}
          achievement={totalValues.revenueAchievement}
          forecastValue={totalValues.revenue}
          targetValue={data.totals.targetRevenue}
          icon={TrendingUp}
        />
        <ValueTile
          label={labels.gpPercent}
          value={formatPercent(totalValues.gpPercent)}
          icon={Percent}
          rows={[
            {
              label: "Hedef GP%",
              value: formatPercent(targetGpPercent),
            },
            {
              label: "Fark",
              value: formatSignedPoints(totalValues.gpPercent - targetGpPercent),
            },
            { label: "Dönem", value: `${periodLabel} · ${labels.name}` },
          ]}
        />
        {hasSeparatePerformance ? (
          <PerformanceTile
            label={labels.performance}
            value={totalValues.performance}
            description={labels.performanceDescription}
          />
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className={`print-block ${KPI_TILE_SHELL}`}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">{labels.compareTitle}</h2>
              <p className="text-xs text-slate-500">GP önce, revenue ikinci sırada gösterilir.</p>
            </div>
            <Badge variant="outline">{labels.name}</Badge>
          </div>
          {/* Hedef, ikinci bir gri çubuk yerine dikey işaretle gösterilir:
              iki çubuk "iki ayrı seri" izlenimi veriyordu, oysa biri eşik. */}
          {data.quarterSummary.length === 0 ? (
            <EmptyState message="Seçili dönem için çeyrek verisi bulunamadı." />
          ) : (
            <div className="space-y-4">
              {data.quarterSummary.map((quarter) => {
                const values = getBasisValues(quarter, reportBasis);
                const achievement = quarter.targetGp > 0 ? (values.gp / quarter.targetGp) * 100 : 0;
                return (
                  <div key={quarter.quarter} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">Q{quarter.quarter}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatUSD(values.gp)}
                        </span>
                        <span className="w-16 text-right font-mono font-bold tabular-nums">
                          <AchievementCell value={achievement} target={quarter.targetGp} />
                        </span>
                      </span>
                    </div>
                    <ComparisonBar value={values.gp} target={quarter.targetGp} scale={maxQuarterValue} />
                    <div className="text-[11px] text-slate-500">
                      Hedef GP {formatUSD(quarter.targetGp)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className={`print-block ${KPI_TILE_SHELL}`}>
          <div className="mb-4">
            <h2 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">Forecast Performansı</h2>
            <p className="text-xs text-slate-500">Satış müdürü bazında {labels.performance.toLowerCase()}.</p>
          </div>
          {/* Liste önce performansa göre sıralanır: kesme işlemi öncesinde
              sıralama yoktu, yani gösterilen 8 kişi rastgele seçiliyordu. */}
          <div className="space-y-3">
            {data.managers.length === 0 ? (
              <EmptyState message="Gösterilecek satış müdürü verisi bulunamadı." />
            ) : (
              rankedManagers.slice(0, MANAGER_CHART_LIMIT).map(({ manager, values }) => (
                <div key={manager.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {manager.managerName}
                    </span>
                    <span className="font-mono text-xs font-bold tabular-nums">
                      <StatusValue
                        value={formatPercent(values.performance)}
                        status={getAchievementStatus(values.performance)}
                      />
                    </span>
                  </div>
                  <Meter value={values.performance} status={getAchievementStatus(values.performance)} />
                </div>
              ))
            )}
            {hiddenManagerCount > 0 ? (
              <p className="pt-1 text-center text-xs font-medium text-slate-500">
                +{hiddenManagerCount} satış müdürü daha listelenmedi.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {/* Önceki sürüm GP ve Revenue çubuklarını tek ölçekte yan yana çiziyordu;
          GP revenue'nun ~%15'i olduğu için GP çubukları okunamaz inceliğe
          düşüyordu. Ayrıca %4'lük taban yüzünden sıfır backlog da dolu
          görünüyor ve değerler yalnızca tarayıcı tooltip'inde okunabiliyordu. */}
      <TrendCard
        title="Haftalık Backlog"
        measures={backlogMeasures}
        emptyMessage="Seçili dönem için backlog verisi bulunamadı."
        captionHeader="Detay"
      />

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <div>
            <h2 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">SM Performansı</h2>
            <p className="text-xs text-slate-500">Akordiyon tabloda vendor detayları.</p>
          </div>
          <Users2 className="h-5 w-5 text-emerald-800 dark:text-emerald-300" />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-emerald-950 shadow-sm">
              <TableRow>
                <TableHead className="min-w-56 bg-emerald-900 text-xs font-extrabold uppercase tracking-wide text-emerald-50">Satış Müdürü / Vendor</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">{labels.gp}</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">Target GP</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">GP Achv</TableHead>
                {hasSeparatePerformance ? (
                  <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">
                    {labels.performance}
                  </TableHead>
                ) : null}
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">{labels.revenue}</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">Revenue Achv</TableHead>
                <TableHead className="bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">GP%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.managers.map((manager) => {
                const isExpanded = expandedManagers[manager.id] ?? false;
                const managerValues = getBasisValues(manager, reportBasis);
                return (
                  <React.Fragment key={manager.id}>
                    <TableRow className="cursor-pointer border-l-4 border-emerald-700 bg-emerald-50/80 shadow-[inset_0_-1px_0_rgba(16,185,129,0.18)] hover:bg-emerald-100/80 dark:border-emerald-500 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30" onClick={() => toggleManager(manager.id)}>
                      <TableCell className="font-semibold">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span>{manager.managerName}</span>
                          <Badge variant="outline">{manager.vendors.length} vendor</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(managerValues.gp)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(manager.targetGp)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                        <AchievementCell value={managerValues.gpAchievement} target={manager.targetGp} />
                      </TableCell>
                      {hasSeparatePerformance ? (
                        <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                          <StatusValue
                            value={formatPercent(managerValues.performance)}
                            status={getAchievementStatus(managerValues.performance)}
                          />
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(managerValues.revenue)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                        <AchievementCell value={managerValues.revenueAchievement} target={manager.targetRevenue} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                        <GpPercentCell
                          value={managerValues.gpPercent}
                          revenue={managerValues.revenue}
                          targetGpPercent={gpPercentOf(manager.targetRevenue, manager.targetGp)}
                        />
                      </TableCell>
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
                              <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                                <AchievementCell value={vendorValues.gpAchievement} target={vendor.targetGp} />
                              </TableCell>
                              {hasSeparatePerformance ? (
                                <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                                  <StatusValue
                                    value={formatPercent(vendorValues.performance)}
                                    status={getAchievementStatus(vendorValues.performance)}
                                  />
                                </TableCell>
                              ) : null}
                              <TableCell className="text-right font-mono text-xs">{formatUSD(vendorValues.revenue)}</TableCell>
                              <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                                <AchievementCell value={vendorValues.revenueAchievement} target={vendor.targetRevenue} />
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs tabular-nums">
                                <GpPercentCell
                                  value={vendorValues.gpPercent}
                                  revenue={vendorValues.revenue}
                                  targetGpPercent={gpPercentOf(vendor.targetRevenue, vendor.targetGp)}
                                />
                              </TableCell>
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

      <section className={`print-block ${KPI_TILE_SHELL}`}>
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
          <div>
            <h2 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">Dikkat Noktaları</h2>
            <p className="text-xs text-slate-500">
              {allRisks.length > 0
                ? `Öncelik sırasına göre ${basisRisks.length}/${allRisks.length} kayıt.`
                : "Öncelikli kontrol listesi."}
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {basisRisks.map((risk, index) => (
            <div key={`${risk.managerName}-${risk.vendorName}-${risk.type}-${index}`} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
              <span
                className={`mb-2 inline-flex items-center gap-1 text-[11px] font-semibold ${
                  STATUS_META[getSeverityStatus(risk.severity)].ink
                }`}
              >
                {React.createElement(STATUS_META[getSeverityStatus(risk.severity)].Icon, {
                  className: "h-3.5 w-3.5",
                  "aria-hidden": true,
                })}
                {risk.type}
              </span>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{risk.vendorName}</div>
              <div className="text-xs text-slate-500">{risk.managerName}</div>
              <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">{risk.detail}</div>
            </div>
          ))}
          {basisRisks.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-4">
              <EmptyState message="Seçili dönem için kritik dikkat noktası görünmüyor." />
            </div>
          ) : null}
          {hiddenRiskCount > 0 ? (
            <p className="text-xs font-medium text-slate-500 md:col-span-2 xl:col-span-4">
              +{hiddenRiskCount} kayıt daha listelenmedi.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
