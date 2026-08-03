"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock3,
  DollarSign,
  FileSpreadsheet,
  History,
  Loader2,
  Lock,
  Percent,
  TrendingUp,
  Upload,
  Users2,
  Filter,
  X,
  MessageSquare,
  StickyNote,
} from "lucide-react";
import { MultiSelectFilter, FilterOption } from "@/components/ui/multi-select-filter";
import { formatCompactUSD, formatPercent, formatSignedPoints, formatUSD } from "@/components/viz/format";
import { AchievementCell, GpPercentCell, STATUS_META, StatusValue, getGpStatus } from "@/components/viz/status";
import { AchievementTile, ValueTile } from "@/components/viz/tiles";
import { CARD_HOVER_SHADOW } from "@/components/viz/card-shell";
import { TrendCard, TrendMeasure } from "@/components/viz/trend-chart";
import { getCurrentFiscalContext } from "@/lib/fiscal";
import {
  getActiveForecasts,
  getForecastVersions,
  getManagerScorecardsAction,
  getVendorScorecardsAction,
  getSessionUser,
  getWeeklyForecastTrend,
  uploadCrmExcelAction,
} from "./actions";

interface ForecastRow {
  vendorId: string;
  vendorName: string;
  managerId: string | null;
  managerName: string | null;
  targetRevenue: number;
  targetGp: number;
  targetGpPercent: number;
  revenue: number;
  gp: number;
  gpPercent: number;
  revenueAchievement: number;
  gpAchievement: number;
  weekNumber: number | null;
  submittedAt: Date | string | null;
  note: string | null;
  hasForecast: boolean;
  hasTarget: boolean;
  backlogRevenue: number;
  backlogWeekNumber: number;
  hasBacklog: boolean;
  isBelowBacklog: boolean;
  isPeriodLocked: boolean;
}

interface ForecastVersion {
  id: string;
  weekNumber: number;
  revenue: number;
  gp: number;
  gpPercent: number;
  isActive: boolean;
  submittedAt: Date | string;
  createdAt: Date | string;
  submittedByName: string;
}

interface ScorecardItem {
  id: string;
  managerName: string;
  weightedCrmPipeline: number;
  rawCrmPipeline: number;
  overdueCount: number;
  crmHealthScore: number;
  forecastAccuracy: number;
  revenueAch: number;
  gpAch: number;
  overallScore: number;
  managerComment: string | null;
}

interface ScorecardVendorItem {
  id: string;
  vendorName: string;
  vendorId: string | null;
  weightedCrmPipeline: number;
  rawCrmPipeline: number;
  overdueCount: number;
  crmHealthScore: number;
  totalDeals: number;
}

interface ManagerForecastGroup {
  id: string;
  managerName: string;
  rows: ForecastRow[];
  targetRevenue: number;
  targetGp: number;
  revenue: number;
  gp: number;
  forecastedCount: number;
  targetedCount: number;
  backlogRiskCount: number;
  latestSubmittedAt: Date | string | null;
}



type ForecastSortKey =
  | "managerName"
  | "targetRevenue"
  | "targetGp"
  | "targetGpPercent"
  | "revenue"
  | "gp"
  | "gpPercent"
  | "revenueAchievement"
  | "gpAchievement";
type SortDirection = "asc" | "desc";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: Date | string | null) {
  return value ? new Date(value).toLocaleString("tr-TR") : "Girilmemiş";
}

export default function ForecastInputPage() {
  const currentContext = getCurrentFiscalContext();
  const [fiscalYear, setFiscalYear] = useState(currentContext.fiscalYear);
  const [quarter, setQuarter] = useState(currentContext.quarter);
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [user, setUser] = useState<{ role?: string | null } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});

  const [viewWeekNumber, setViewWeekNumber] = useState<number | "active">("active");
  const [weeklyTrend, setWeeklyTrend] = useState<{ weekNumber: number; revenue: number; gp: number; count: number }[]>([]);

  const [sortKey, setSortKey] = useState<ForecastSortKey>("managerName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [historyVendor, setHistoryVendor] = useState<ForecastRow | null>(null);
  const [versions, setVersions] = useState<ForecastVersion[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  // Multi-select filter states (Satış Müdürü -> Marka)
  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);

  // Sales Manager options for multi-select filter
  const managerOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const row of forecasts) {
      const id = row.managerId ?? "unassigned";
      const label = row.managerName ?? "Atanmamış";
      const existing = map.get(id);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(id, { label, count: 1 });
      }
    }
    return Array.from(map.entries())
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label, "tr"));
  }, [forecasts]);

  // Vendor options for multi-select filter (cascaded by selected Sales Managers)
  const vendorOptions = useMemo<FilterOption[]>(() => {
    const relevantRows = selectedManagerIds.length > 0
      ? forecasts.filter((row) => selectedManagerIds.includes(row.managerId ?? "unassigned"))
      : forecasts;

    const map = new Map<string, { label: string; count: number }>();
    for (const row of relevantRows) {
      map.set(row.vendorId, { label: row.vendorName, count: 1 });
    }
    return Array.from(map.entries())
      .map(([value, { label }]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "tr"));
  }, [forecasts, selectedManagerIds]);

  const handleManagerChange = (newManagerIds: string[]) => {
    setSelectedManagerIds(newManagerIds);
    if (newManagerIds.length > 0) {
      const validVendorIds = forecasts
        .filter((row) => newManagerIds.includes(row.managerId ?? "unassigned"))
        .map((row) => row.vendorId);
      setSelectedVendorIds((prev) => prev.filter((id) => validVendorIds.includes(id)));
    }
  };

  const clearAllFilters = () => {
    setSelectedManagerIds([]);
    setSelectedVendorIds([]);
  };

  // Filtered forecasts array
  const filteredForecasts = useMemo(() => {
    return forecasts.filter((row) => {
      const managerId = row.managerId ?? "unassigned";
      const matchesManager = selectedManagerIds.length === 0 || selectedManagerIds.includes(managerId);
      const matchesVendor = selectedVendorIds.length === 0 || selectedVendorIds.includes(row.vendorId);
      return matchesManager && matchesVendor;
    });
  }, [forecasts, selectedManagerIds, selectedVendorIds]);

  const isSelectedCurrentPeriod =
    fiscalYear === currentContext.fiscalYear && quarter === currentContext.quarter;
  const isPeriodLocked = forecasts.some((row) => row.isPeriodLocked);

  const fiscalYearsRange = [
    currentContext.fiscalYear - 1,
    currentContext.fiscalYear,
    currentContext.fiscalYear + 1,
  ];

  // CRM & Scorecard states
  const [isCrmUploadModalOpen, setIsCrmUploadModalOpen] = useState(false);
  const [crmFile, setCrmFile] = useState<File | null>(null);
  const [isCrmSubmitting, setIsCrmSubmitting] = useState(false);
  const [crmWeekNumber, setCrmWeekNumber] = useState<number>(currentContext.weekInQuarter);
  const [scorecards, setScorecards] = useState<ScorecardItem[]>([]);
  const [vendorScorecards, setVendorScorecards] = useState<ScorecardVendorItem[]>([]);
  const [isScorecardLeaderboardOpen, setIsScorecardLeaderboardOpen] = useState(false);

  const [latestUploadWeekNumber, setLatestUploadWeekNumber] = useState<number | null>(null);

  const loadForecasts = useCallback(async () => {
    setIsLoading(true);
    try {
      const activeCtx = getCurrentFiscalContext();
      const selectedWeekParam = viewWeekNumber === "active" ? activeCtx.weekInQuarter : viewWeekNumber;
      const [res, trendData, scorecardData, vendorScorecardData] = await Promise.all([
        getActiveForecasts(fiscalYear, quarter, viewWeekNumber === "active" ? undefined : viewWeekNumber),
        getWeeklyForecastTrend(fiscalYear, quarter),
        getManagerScorecardsAction(fiscalYear, quarter, selectedWeekParam),
        getVendorScorecardsAction(fiscalYear, quarter, selectedWeekParam),
      ]);
      setForecasts(res.rows);
      setLatestUploadWeekNumber(res.latestUploadWeekNumber);
      setWeeklyTrend(trendData);
      setScorecards(scorecardData);
      setVendorScorecards(vendorScorecardData);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Forecast verileri yüklenirken hata oluştu."));
    } finally {
      setIsLoading(false);
    }
  }, [fiscalYear, quarter, viewWeekNumber]);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      try {
        const sessionUser = await getSessionUser();
        setUser(sessionUser);
      } catch (err) {
        console.error("Kullanıcı oturumu yüklenemedi", err);
      }
    });
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadForecasts);
  }, [loadForecasts]);

  const totalTargetRevenue = filteredForecasts.reduce((sum, row) => sum + row.targetRevenue, 0);
  const totalTargetGP = filteredForecasts.reduce((sum, row) => sum + row.targetGp, 0);
  const totalRevenue = filteredForecasts.reduce((sum, row) => sum + row.revenue, 0);
  const totalGP = filteredForecasts.reduce((sum, row) => sum + row.gp, 0);
  const totalGPPercent = totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0;
  const totalTargetGPPercent = totalTargetRevenue > 0 ? (totalTargetGP / totalTargetRevenue) * 100 : 0;
  const totalRevenueAchievement = totalTargetRevenue > 0 ? (totalRevenue / totalTargetRevenue) * 100 : 0;
  const totalGPAchievement = totalTargetGP > 0 ? (totalGP / totalTargetGP) * 100 : 0;

  const trendCaption = useCallback(
    (count: number) => `${count} kayıt`,
    []
  );

  const revenueTrendMeasures: TrendMeasure[] = useMemo(
    () => [
      {
        key: "revenue",
        label: "NSB",
        description: `FY${fiscalYear} Q${quarter} haftalık ciro akışı.`,
        points: weeklyTrend.map((week) => ({
          label: `H${week.weekNumber}`,
          tooltipLabel: `Hafta ${week.weekNumber}`,
          value: week.revenue,
          caption: trendCaption(week.count),
        })),
        format: formatUSD,
        formatAxis: formatCompactUSD,
        target: totalTargetRevenue,
        targetLabel: "Hedef NSB",
        valueHeader: "Forecast NSB",
      },
    ],
    [fiscalYear, quarter, weeklyTrend, totalTargetRevenue, trendCaption]
  );

  // GP ve GP% ayrı ölçüler olarak sunulur; ikisini tek grafikte iki eksene
  // yerleştirmek ölçek hizası keyfî olduğu için yanıltıcı bir ilişki üretiyordu.
  const gpTrendMeasures: TrendMeasure[] = useMemo(
    () => [
      {
        key: "gp",
        label: "GP",
        description: `FY${fiscalYear} Q${quarter} haftalık brüt kâr akışı.`,
        points: weeklyTrend.map((week) => ({
          label: `H${week.weekNumber}`,
          tooltipLabel: `Hafta ${week.weekNumber}`,
          value: week.gp,
          caption: trendCaption(week.count),
        })),
        format: formatUSD,
        formatAxis: formatCompactUSD,
        target: totalTargetGP,
        targetLabel: "Hedef GP",
        valueHeader: "Forecast GP",
      },
      {
        key: "gpPercent",
        label: "GP%",
        description: `FY${fiscalYear} Q${quarter} haftalık kârlılık oranı.`,
        points: weeklyTrend.map((week) => ({
          label: `H${week.weekNumber}`,
          tooltipLabel: `Hafta ${week.weekNumber}`,
          value: week.revenue > 0 ? (week.gp / week.revenue) * 100 : 0,
          caption: trendCaption(week.count),
        })),
        format: formatPercent,
        formatAxis: (value: number) => `%${value.toFixed(1)}`,
        target: totalTargetGPPercent,
        targetLabel: "Hedef",
        valueHeader: "Forecast GP%",
        zeroBaseline: false,
      },
    ],
    [fiscalYear, quarter, weeklyTrend, totalTargetGP, totalTargetGPPercent, trendCaption]
  );
  const forecastedCount = filteredForecasts.filter((row) => row.hasForecast).length;

  const activeWeekLabel = isSelectedCurrentPeriod
    ? `${currentContext.weekInQuarter}. Hafta`
    : `Aktif dönem FY${currentContext.fiscalYear} - Q${currentContext.quarter}`;

  const managerGroups = useMemo<ManagerForecastGroup[]>(() => {
    const groupMap = new Map<string, ManagerForecastGroup>();

    for (const row of filteredForecasts) {
      const groupId = row.managerId ?? "unassigned";
      const managerName = row.managerName ?? "Atanmamış";
      const existing = groupMap.get(groupId);

      if (existing) {
        existing.rows.push(row);
        existing.targetRevenue += row.targetRevenue;
        existing.targetGp += row.targetGp;
        existing.revenue += row.revenue;
        existing.gp += row.gp;
        existing.forecastedCount += row.hasForecast ? 1 : 0;
        existing.targetedCount += row.hasTarget ? 1 : 0;
        existing.backlogRiskCount += row.isBelowBacklog ? 1 : 0;
        if (
          row.submittedAt &&
          (!existing.latestSubmittedAt ||
            new Date(row.submittedAt).getTime() > new Date(existing.latestSubmittedAt).getTime())
        ) {
          existing.latestSubmittedAt = row.submittedAt;
        }
        continue;
      }

      groupMap.set(groupId, {
        id: groupId,
        managerName,
        rows: [row],
        targetRevenue: row.targetRevenue,
        targetGp: row.targetGp,
        revenue: row.revenue,
        gp: row.gp,
        forecastedCount: row.hasForecast ? 1 : 0,
        targetedCount: row.hasTarget ? 1 : 0,
        backlogRiskCount: row.isBelowBacklog ? 1 : 0,
        latestSubmittedAt: row.submittedAt,
      });
    }

    return Array.from(groupMap.values())
      .map((group) => ({
        ...group,
        rows: [...group.rows].sort((a, b) => a.vendorName.localeCompare(b.vendorName, "tr")),
      }))
      .sort((a, b) => a.managerName.localeCompare(b.managerName, "tr"));
  }, [filteredForecasts]);

  const handleSort = (key: ForecastSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "managerName" ? "asc" : "desc");
  };

  const sortedManagerGroups = useMemo(() => {
    const getValue = (group: ManagerForecastGroup) => {
      const targetGPPercent = group.targetRevenue > 0 ? (group.targetGp / group.targetRevenue) * 100 : 0;
      const gpPercent = group.revenue > 0 ? (group.gp / group.revenue) * 100 : 0;
      const revenueAchievement = group.targetRevenue > 0 ? (group.revenue / group.targetRevenue) * 100 : 0;
      const gpAchievement = group.targetGp > 0 ? (group.gp / group.targetGp) * 100 : 0;

      switch (sortKey) {
        case "managerName":
          return group.managerName;
        case "targetRevenue":
          return group.targetRevenue;
        case "targetGp":
          return group.targetGp;
        case "targetGpPercent":
          return targetGPPercent;
        case "revenue":
          return group.revenue;
        case "gp":
          return group.gp;
        case "gpPercent":
          return gpPercent;
        case "revenueAchievement":
          return revenueAchievement;
        case "gpAchievement":
          return gpAchievement;
      }
    };

    return [...managerGroups].sort((a, b) => {
      const left = getValue(a);
      const right = getValue(b);
      const result =
        typeof left === "string" && typeof right === "string"
          ? left.localeCompare(right, "tr")
          : Number(left) - Number(right);
      return sortDirection === "asc" ? result : -result;
    });
  }, [managerGroups, sortDirection, sortKey]);

  const toggleManager = (managerId: string) => {
    setExpandedManagers((current) => ({
      ...current,
      [managerId]: !(current[managerId] ?? false),
    }));
  };

  const handleCrmUploadSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!crmFile) {
      toast.error("Lütfen geçerli bir CRM Excel dosyası seçin.");
      return;
    }

    setIsCrmSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", crmFile);

      const result = await uploadCrmExcelAction(formData, fiscalYear, quarter, crmWeekNumber);
      if (!result.success) {
        toast.error(result.error || "CRM dosyası işlenemedi.");
        return;
      }

      toast.success(`${result.processedCount} fırsat kaydı işlendi. ${result.managerCount} Satış Müdürü güncellendi.`);
      setIsCrmUploadModalOpen(false);
      setCrmFile(null);
      await loadForecasts();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "CRM Excel dosyası yüklenirken hata oluştu."));
    } finally {
      setIsCrmSubmitting(false);
    }
  };

  const handleOpenHistory = async (row: ForecastRow) => {
    setHistoryVendor(row);
    setIsHistoryOpen(true);
    setIsHistoryLoading(true);
    try {
      const data = await getForecastVersions(row.vendorId, fiscalYear, quarter);
      setVersions(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Versiyon geçmişi yüklenemedi."));
      setVersions([]);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400 font-serif">
            Forecast Giriş
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-sans">
            Aktif çeyrek için haftalık forecast girin; önceki aktif forecast otomatik arşivlenir.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Calendar className="h-4 w-4 text-emerald-700" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Mali Yıl:</span>
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
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Çeyrek:</span>
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
          </div>

          <div className="flex items-center gap-2 border-l border-slate-200 pl-3 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-500">Görüntülenen Hafta:</span>
            <Select
              value={viewWeekNumber.toString()}
              onValueChange={(val) => {
                if (!val) return;
                if (val === "active") setViewWeekNumber("active");
                else setViewWeekNumber(parseInt(val));
              }}
            >
              <SelectTrigger className="h-8 w-44 border-slate-200 bg-white text-xs font-semibold focus:outline-none dark:border-slate-800 dark:bg-slate-900">
                <SelectValue placeholder="Aktif Hafta" />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200 max-h-64">
                <SelectItem value="active" className="text-xs font-semibold text-emerald-800 dark:text-emerald-400">
                  Aktif Hafta ({currentContext.weekInQuarter}. Hafta)
                </SelectItem>
                {Array.from({ length: 13 }, (_, i) => i + 1).map((w) => (
                  <SelectItem key={w} value={w.toString()} className="text-xs font-sans">
                    {w}. Hafta Kayıtları
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Badge className="bg-emerald-800 text-emerald-50 hover:bg-emerald-800">
            Aktif Hafta: {activeWeekLabel}
          </Badge>

          {latestUploadWeekNumber && (
            <Badge variant="outline" className="border-emerald-700 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 flex items-center gap-1">
              <Upload className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
              Son Yükleme: Hafta {latestUploadWeekNumber}
            </Badge>
          )}
        </div>
      </div>

      {/* Forecast girişi Haftalık Detay Formu'na taşındı — bu sayfa artık
          salt-okunur özet ve geçmiş görünümüdür. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300">
        <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
        <span>
          Forecast girişi artık <strong>Haftalık Detay Formu</strong> üzerinden yapılıyor. Bu sayfa
          özet ve geçmiş görünümüdür.
        </span>
        <Link href="/weekly-forecast" className="ml-auto">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 bg-[#1F3A2E] px-3 text-xs font-bold text-white hover:bg-[#2E5A43]"
          >
            Haftalık Detay Formu
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>

      {!isSelectedCurrentPeriod && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          Bu seçili dönem aktif çeyrek değil.
        </div>
      )}

      {isPeriodLocked && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
          <Lock className="h-4 w-4" />
          Seçilen çeyrek kilitli olduğu için forecast girişi kapalıdır.
        </div>
      )}

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
          Gösterilen: <span className="font-bold text-slate-900 dark:text-slate-100">{filteredForecasts.length}</span> / {forecasts.length} marka
        </div>
      </div>

      {/* Hedef karşılaştırması zaten hesaplanıyordu ama kartlarda kullanılmıyordu;
          artık her kart tutarı hedefiyle birlikte gösteriyor. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AchievementTile
          label={user?.role === "DIREKTOR" ? "NSB Achievement" : "NSB Achievement (Sizin)"}
          achievement={totalRevenueAchievement}
          forecastValue={totalRevenue}
          targetValue={totalTargetRevenue}
          icon={DollarSign}
        />
        <AchievementTile
          label="GP Achievement"
          achievement={totalGPAchievement}
          forecastValue={totalGP}
          targetValue={totalTargetGP}
          icon={TrendingUp}
        />
        <ValueTile
          label="Birleşik GP Oranı"
          value={formatPercent(totalGPPercent)}
          icon={Percent}
          rows={[
            { label: "Hedef GP%", value: formatPercent(totalTargetGPPercent) },
            { label: "Fark", value: formatSignedPoints(totalGPPercent - totalTargetGPPercent) },
          ]}
        />
        <ValueTile
          label="Forecast Girişi"
          value={`${forecastedCount}/${forecasts.length}`}
          icon={FileSpreadsheet}
          rows={[
            { label: "Gösterilen marka", value: `${filteredForecasts.length}` },
            {
              label: "Backlog uyarısı",
              value: `${filteredForecasts.filter((row) => row.isBelowBacklog).length}`,
              status: filteredForecasts.some((row) => row.isBelowBacklog) ? "crit" : "good",
            },
          ]}
        />
      </div>

      {/* CRM & Scorecard Executive Banner */}
      {scorecards.length > 0 && (
        <div className={`space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20 ${CARD_HOVER_SHADOW}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1F3A2E] text-white shadow-xs">
                <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
              </span>
              <div>
                <h3 className="font-serif text-sm font-bold text-[#1F3A2E] dark:text-emerald-400 flex items-center gap-2">
                  Haftalık CRM Fırsat & Satış Müdürü Karneleri ({viewWeekNumber === "active" ? currentContext.weekInQuarter : viewWeekNumber}. Hafta)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-sans">
                  CS1_TDSYNNEX Excel dosyasından hesaplanan {scorecards.length} Satış Müdürü ağırlıklı CRM fırsat büyüklüğü ve temizlik puanları.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsScorecardLeaderboardOpen(true)}
                className="h-8.5 border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50 text-xs font-bold gap-1.5 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300 shadow-xs"
              >
                <Users2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> Tüm Müdür Karneleri ({scorecards.length})
              </Button>
              <Link href="/scorecard">
                <Button
                  type="button"
                  size="sm"
                  className="h-8.5 bg-[#1F3A2E] text-white hover:bg-[#2E5A43] text-xs font-bold gap-1.5 shadow-xs"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-400" /> Scorecard & CRM Raporu
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
            <div className={`rounded-lg border border-slate-200/80 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-950/40 ${CARD_HOVER_SHADOW}`}>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Topl. Ağırlıklı CRM</span>
              <span className="font-mono text-base font-extrabold text-emerald-800 dark:text-emerald-300">
                {formatUSD(scorecards.reduce((acc, s) => acc + s.weightedCrmPipeline, 0))}
              </span>
            </div>
            <div className={`rounded-lg border border-slate-200/80 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-950/40 ${CARD_HOVER_SHADOW}`}>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Ham CRM Pipeline</span>
              <span className="font-mono text-base font-bold text-slate-700 dark:text-slate-300">
                {formatUSD(scorecards.reduce((acc, s) => acc + s.rawCrmPipeline, 0))}
              </span>
            </div>
            <div className={`rounded-lg border border-slate-200/80 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-950/40 ${CARD_HOVER_SHADOW}`}>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Günü Geçmiş Açık İşler</span>
              <StatusValue
                className="font-mono text-base font-bold"
                status={scorecards.reduce((acc, s) => acc + s.overdueCount, 0) > 0 ? "crit" : "good"}
                value={`${scorecards.reduce((acc, s) => acc + s.overdueCount, 0)} Açık İş`}
              />
            </div>
            <div className={`rounded-lg border border-slate-200/80 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-950/40 ${CARD_HOVER_SHADOW}`}>
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Ort. CRM Sağlık Skoru</span>
              <span className="font-mono text-base font-extrabold text-emerald-700 dark:text-emerald-400">
                %{Math.round(scorecards.reduce((acc, s) => acc + s.crmHealthScore, 0) / (scorecards.length || 1))}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
            <span className="ml-2 text-sm font-medium text-slate-500">Forecast verileri yükleniyor...</span>
          </div>
        ) : managerGroups.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center text-slate-500">
            <Clock3 className="mb-2 h-10 w-10 text-slate-300" />
            <span>Bu çeyrek için henüz forecast girilmemiş.</span>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-emerald-900 shadow-sm">
              <TableRow>
                <SortableTableHead
                  rowSpan={2}
                  label="Marka"
                  active={sortKey === "managerName"}
                  direction={sortDirection}
                  onClick={() => handleSort("managerName")}
                  className="min-w-52"
                />
                <th colSpan={3} className="border-b border-l border-emerald-700 bg-emerald-900 px-4 py-2.5 text-center text-sm font-extrabold uppercase tracking-wide text-white">
                  Hedef
                </th>
                <th colSpan={3} className="border-b border-l border-emerald-700 bg-emerald-900 px-4 py-2.5 text-center text-sm font-extrabold uppercase tracking-wide text-white">
                  Forecast
                </th>
                <th colSpan={2} className="border-b border-l border-emerald-700 bg-emerald-900 px-4 py-2.5 text-center text-sm font-extrabold uppercase tracking-wide text-white">
                  Achievement
                </th>
                <th rowSpan={2} className="border-b border-l border-emerald-700 bg-emerald-900 px-4 py-2 text-right text-xs font-extrabold uppercase tracking-wide text-white">
                  İşlem
                </th>
              </TableRow>
              <TableRow>
                <SortableTableHead label="NSB" align="right" active={sortKey === "targetRevenue"} direction={sortDirection} onClick={() => handleSort("targetRevenue")} />
                <SortableTableHead label="GP" align="right" active={sortKey === "targetGp"} direction={sortDirection} onClick={() => handleSort("targetGp")} />
                <SortableTableHead label="GP%" align="right" active={sortKey === "targetGpPercent"} direction={sortDirection} onClick={() => handleSort("targetGpPercent")} />
                <SortableTableHead label="NSB" align="right" active={sortKey === "revenue"} direction={sortDirection} onClick={() => handleSort("revenue")} />
                <SortableTableHead label="GP" align="right" active={sortKey === "gp"} direction={sortDirection} onClick={() => handleSort("gp")} />
                <SortableTableHead label="GP%" align="right" active={sortKey === "gpPercent"} direction={sortDirection} onClick={() => handleSort("gpPercent")} />
                <SortableTableHead label="NSB" align="right" active={sortKey === "revenueAchievement"} direction={sortDirection} onClick={() => handleSort("revenueAchievement")} />
                <SortableTableHead label="GP" align="right" active={sortKey === "gpAchievement"} direction={sortDirection} onClick={() => handleSort("gpAchievement")} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedManagerGroups.map((group) => {
                const isExpanded = expandedManagers[group.id] ?? false;
                const ToggleIcon = isExpanded ? ChevronDown : ChevronRight;
                const groupTargetGPPercent =
                  group.targetRevenue > 0 ? (group.targetGp / group.targetRevenue) * 100 : 0;
                const groupGPPercent = group.revenue > 0 ? (group.gp / group.revenue) * 100 : 0;
                const groupRevenueAchievement =
                  group.targetRevenue > 0 ? (group.revenue / group.targetRevenue) * 100 : 0;
                const groupGPAchievement = group.targetGp > 0 ? (group.gp / group.targetGp) * 100 : 0;
                const sc = scorecards.find(
                  (s) =>
                    s.managerName.toUpperCase() === group.managerName.toUpperCase() ||
                    group.managerName.toUpperCase().includes(s.managerName.toUpperCase()) ||
                    s.managerName.toUpperCase().includes(group.managerName.toUpperCase())
                );

                return (
                  <React.Fragment key={group.id}>
                    <TableRow
                      aria-expanded={isExpanded}
                      className="border-l-4 border-emerald-700 bg-emerald-50/80 shadow-[inset_0_-1px_0_rgba(16,185,129,0.18)] hover:bg-emerald-100/80 dark:border-emerald-500 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30"
                    >
                      <TableCell className="font-semibold text-slate-950 dark:text-slate-100">
                        <div className="flex w-full items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleManager(group.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <ToggleIcon className="h-4 w-4 shrink-0 text-slate-500" />
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                              <Users2 className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="truncate font-bold text-slate-900 dark:text-slate-100">{group.managerName}</span>
                                {sc && (
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] py-0.5 px-2 font-bold flex items-center gap-1 shadow-xs ${
                                      sc.crmHealthScore < 80
                                        ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-300"
                                        : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
                                    }`}
                                  >
                                    CRM Sağlık: %{sc.crmHealthScore}
                                    {sc.overdueCount > 0 && <span className="text-red-600 font-extrabold dark:text-red-400">({sc.overdueCount} Günü Geçmiş)</span>}
                                  </Badge>
                                )}
                                {sc && sc.weightedCrmPipeline > 0 && (
                                  <Badge variant="outline" className="border-emerald-300 bg-white text-emerald-900 text-[10px] font-mono font-bold dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300">
                                    Ağırlıklı CRM: {formatUSD(sc.weightedCrmPipeline)}
                                  </Badge>
                                )}
                              </span>
                              <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                                {group.forecastedCount}/{group.rows.length} forecast, {group.targetedCount} hedef
                                {group.backlogRiskCount > 0 ? `, ${group.backlogRiskCount} backlog uyarısı` : ""}
                              </span>
                            </span>
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">
                        {formatUSD(group.targetRevenue)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(group.targetGp)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                        <GpPercentCell value={groupTargetGPPercent} revenue={group.targetRevenue} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(group.revenue)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(group.gp)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                        <GpPercentCell
                          value={groupGPPercent}
                          revenue={group.revenue}
                          targetGpPercent={groupTargetGPPercent}
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                        <AchievementCell value={groupRevenueAchievement} target={group.targetRevenue} />
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                        <AchievementCell value={groupGPAchievement} target={group.targetGp} />
                      </TableCell>
                      <TableCell className="text-right text-[11px] font-medium text-slate-500">
                        Satış Müdürü
                      </TableCell>
                    </TableRow>

                    {isExpanded &&
                      group.rows.map((row) => (
                        <TableRow
                          key={row.vendorId}
                          className={
                            row.isBelowBacklog
                              ? "bg-red-50/80 hover:bg-red-100/80 dark:bg-red-950/20 dark:hover:bg-red-950/30"
                              : "hover:bg-slate-50/60 dark:hover:bg-slate-800/30"
                          }
                        >
                          <TableCell className={`pl-14 font-semibold ${row.isBelowBacklog ? "text-red-900 dark:text-red-200" : "text-slate-900 dark:text-slate-100"}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{row.vendorName}</span>

                              {/* Brand / Vendor level CRM Badges */}
                              {(() => {
                                const vSc = vendorScorecards.find(
                                  (v) =>
                                    v.vendorName.toUpperCase() === row.vendorName.toUpperCase() ||
                                    v.vendorName.toUpperCase().includes(row.vendorName.toUpperCase()) ||
                                    row.vendorName.toUpperCase().includes(v.vendorName.toUpperCase())
                                );
                                if (!vSc) return null;
                                return (
                                  <div className="inline-flex items-center gap-1.5">
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] py-0 px-1.5 font-bold bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                                      title={`Ağırlıklı CRM: ${formatUSD(vSc.weightedCrmPipeline)}`}
                                    >
                                      CRM: {formatUSD(vSc.weightedCrmPipeline)}
                                    </Badge>
                                    {vSc.overdueCount > 0 ? (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] py-0 px-1.5 font-bold bg-red-50 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-300"
                                        title={`${vSc.overdueCount} Günü Geçmiş İş`}
                                      >
                                        Hijyen: %{vSc.crmHealthScore} ({vSc.overdueCount} Geçmiş)
                                      </Badge>
                                    ) : (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] py-0 px-1.5 font-semibold bg-emerald-50/60 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300"
                                      >
                                        Hijyen: %100
                                      </Badge>
                                    )}
                                  </div>
                                );
                              })()}
                              {row.hasForecast && row.weekNumber ? (
                                <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-semibold bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                                  Hafta {row.weekNumber} Yüklemesi
                                </Badge>
                              ) : null}
                              {row.note ? (
                                <div
                                  className="group relative inline-flex items-center"
                                  title={`Forecast Notu: ${row.note}`}
                                >
                                  <Badge
                                    variant="outline"
                                    className="cursor-pointer border-amber-300 bg-amber-50 text-[10px] font-bold text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-300 flex items-center gap-1 px-2 py-0.5 shadow-xs transition-all animate-pulse"
                                  >
                                    <MessageSquare className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
                                    <span>Not Var</span>
                                  </Badge>

                                  <div className="absolute left-0 top-full z-40 mt-1.5 hidden w-72 rounded-lg border border-amber-200 bg-white p-3 text-xs text-slate-800 shadow-xl dark:border-amber-800 dark:bg-slate-900 dark:text-slate-100 group-hover:block transition-all">
                                    <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-300 mb-1 border-b border-amber-100 dark:border-amber-900/50 pb-1">
                                      <StickyNote className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                      <span>{row.vendorName} Forecast Notu</span>
                                    </div>
                                    <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700 dark:text-slate-200 font-sans">
                                      {row.note}
                                    </p>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            {row.isBelowBacklog ? (
                              <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-red-700 dark:text-red-300">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Aktif backlog H{row.backlogWeekNumber}: {formatUSD(row.backlogRevenue)}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right font-mono text-[11px]">
                            {row.hasTarget ? formatUSD(row.targetRevenue) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-[11px]">
                            {row.hasTarget ? formatUSD(row.targetGp) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-[11px] font-bold tabular-nums">
                            <GpPercentCell value={row.targetGpPercent} revenue={row.hasTarget ? row.targetRevenue : 0} />
                          </TableCell>
                          <TableCell className={`text-right font-mono text-xs ${row.isBelowBacklog ? "font-bold text-red-700 dark:text-red-300" : ""}`}>
                            {row.hasForecast ? (
                              <span className="inline-flex items-center justify-end gap-1">
                                {row.isBelowBacklog ? (
                                  <AlertTriangle
                                    className="h-3.5 w-3.5 text-red-600 dark:text-red-300"
                                    aria-label="Forecast backlog altında"
                                  />
                                ) : null}
                                <span>{formatUSD(row.revenue)}</span>
                              </span>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{row.hasForecast ? formatUSD(row.gp) : "-"}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                            <GpPercentCell
                              value={row.gpPercent}
                              revenue={row.hasForecast ? row.revenue : 0}
                              targetGpPercent={row.targetGpPercent}
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                            <AchievementCell
                              value={row.revenueAchievement}
                              target={row.hasTarget && row.hasForecast ? row.targetRevenue : 0}
                            />
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                            <AchievementCell
                              value={row.gpAchievement}
                              target={row.hasTarget && row.hasForecast ? row.targetGp : 0}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {/* Forecast girişi Haftalık Detay Formu'na taşındı;
                                  düğme kaldırılmak yerine oraya yönlendiriyor. */}
                              <Link href="/weekly-forecast">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-emerald-800"
                                >
                                  <ArrowRight className="h-3.5 w-3.5" />
                                  Formda Aç
                                </Button>
                              </Link>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenHistory(row)}
                                className="h-8 text-slate-600 hover:bg-slate-50 hover:text-emerald-800"
                              >
                                <History className="h-3.5 w-3.5" />
                                Geçmiş
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                  </React.Fragment>
                );
              })}

              <TableRow className="border-t-2 border-emerald-800 bg-[#1F3A2E] font-bold text-white hover:bg-[#1F3A2E] dark:border-emerald-500 dark:bg-emerald-950">
                <TableCell>GENEL TOPLAM ({forecastedCount}/{forecasts.length})</TableCell>
                <TableCell className="text-right font-mono text-sm font-extrabold">{formatUSD(totalTargetRevenue)}</TableCell>
                <TableCell className="text-right font-mono text-sm font-extrabold">{formatUSD(totalTargetGP)}</TableCell>
                <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-100">
                  {formatPercent(totalTargetGPPercent)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-extrabold">{formatUSD(totalRevenue)}</TableCell>
                <TableCell className="text-right font-mono text-sm font-extrabold">{formatUSD(totalGP)}</TableCell>
                <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-100">
                  {formatPercent(totalGPPercent)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-100">
                  {formatPercent(totalRevenueAchievement)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-100">
                  {formatPercent(totalGPAchievement)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TrendCard
          title="Revenue (NSB) Trendi"
          measures={revenueTrendMeasures}
          emptyMessage="Seçili dönem için henüz haftalık forecast verisi bulunmuyor."
          captionHeader="Kayıt"
        />
        <TrendCard
          title="GP & Kârlılık Trendi"
          measures={gpTrendMeasures}
          emptyMessage="Seçili dönem için henüz haftalık forecast verisi bulunmuyor."
          captionHeader="Kayıt"
        />
      </div>

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          onClick={() => {
            setCrmWeekNumber(viewWeekNumber === "active" ? currentContext.weekInQuarter : viewWeekNumber);
            setIsCrmUploadModalOpen(true);
          }}
          className="h-9 bg-[#1F3A2E] px-4 text-white hover:bg-[#2E5A43] shadow-sm"
        >
          <FileSpreadsheet className="h-4 w-4" />
          CRM Excel Yükle (Scorecard)
        </Button>

      </div>

      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="sm:max-w-3xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-serif text-xl font-bold text-[#1F3A2E] dark:text-emerald-400">
              <History className="h-5 w-5" />
              Forecast Geçmişi
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              <strong className="text-slate-800 dark:text-slate-200">{historyVendor?.vendorName}</strong> markasının FY{fiscalYear} - Q{quarter} forecast versiyonları.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-800">
            {isHistoryLoading ? (
              <div className="flex h-32 items-center justify-center text-slate-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-emerald-700" />
                Geçmiş yükleniyor...
              </div>
            ) : versions.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-slate-500">
                Bu çeyrek için henüz forecast girilmemiş.
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
                  <TableRow>
                    <TableHead>Hafta</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">GP</TableHead>
                    <TableHead className="text-right">GP%</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Güncelleyen</TableHead>
                    <TableHead className="text-right">Tarih</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.map((version) => (
                    <TableRow key={version.id}>
                      <TableCell className="font-medium">{version.weekNumber}. Hafta</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatUSD(version.revenue)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatUSD(version.gp)}</TableCell>
                      <TableCell className={`text-right font-mono text-xs font-bold tabular-nums ${STATUS_META[getGpStatus(version.gpPercent, historyVendor?.targetGpPercent ?? 0)].ink}`}>
                        {formatPercent(version.gpPercent)}
                      </TableCell>
                      <TableCell>
                        {version.isActive ? (
                          <Badge className="bg-emerald-800 text-emerald-50 hover:bg-emerald-800">Aktif</Badge>
                        ) : (
                          <Badge variant="outline" className="border-slate-200 text-slate-500">Arşiv</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">{version.submittedByName}</TableCell>
                      <TableCell className="text-right text-[11px] text-slate-500">{formatDate(version.submittedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsHistoryOpen(false)}>
              Kapat
              <ChevronRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CRM Excel Upload Modal */}
      <Dialog open={isCrmUploadModalOpen} onOpenChange={setIsCrmUploadModalOpen}>
        <DialogContent className="sm:max-w-md border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-serif text-xl font-bold text-[#1F3A2E] dark:text-emerald-400">
              <FileSpreadsheet className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
              CRM Excel Yükleme (Scorecard)
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Haftalık CRM Fırsat raporunu (CS1_TDSYNNEX...xlsx) yükleyerek Ağırlıklı CRM Pipeline ve CRM Hijyen Puanlarını güncelleyin.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCrmUploadSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Hedef Hafta</Label>
              <Select value={crmWeekNumber.toString()} onValueChange={(val) => val && setCrmWeekNumber(parseInt(val, 10))}>
                <SelectTrigger className="h-9 text-xs border-slate-200">
                  <SelectValue placeholder="Hafta seçin" />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  {Array.from({ length: 13 }, (_, i) => i + 1).map((w) => (
                    <SelectItem key={w} value={w.toString()} className="text-xs">
                      {w}. Hafta Kaydı Olarak Yükle
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold">CRM Excel Dosyası (CS1_TDSYNNEX...xlsx)</Label>
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setCrmFile(e.target.files?.[0] ?? null)}
                className="text-xs border-slate-200"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsCrmUploadModalOpen(false)} disabled={isCrmSubmitting}>
                İptal
              </Button>
              <Button type="submit" disabled={isCrmSubmitting || !crmFile} className="bg-[#1F3A2E] text-white hover:bg-[#2E5A43]">
                {isCrmSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                CRM Dosyasını İşle
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Full Scorecard Leaderboard Modal */}
      <Dialog open={isScorecardLeaderboardOpen} onOpenChange={setIsScorecardLeaderboardOpen}>
        <DialogContent className="sm:max-w-4xl border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-serif text-xl font-bold text-[#1F3A2E] dark:text-emerald-400">
              <Users2 className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
              Satış Müdürü Karneleri ({scorecards.length} Kişi)
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {viewWeekNumber === "active" ? currentContext.weekInQuarter : viewWeekNumber}. Hafta CS1_TDSYNNEX CRM Excel yüklemesine göre tüm Satış Müdürlerinin Ağırlıklı CRM Pipeline ve CRM Hijyen Puanı sıralaması.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[460px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <Table>
              <TableHeader className="bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="w-12 text-center font-bold">#</TableHead>
                  <TableHead>Satış Müdürü</TableHead>
                  <TableHead className="text-right">Ağırlıklı CRM ($)</TableHead>
                  <TableHead className="text-right">Ham Pipeline ($)</TableHead>
                  <TableHead className="text-center">Günü Geçmiş</TableHead>
                  <TableHead className="text-right">CRM Sağlık Skoru</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scorecards
                  .slice()
                  .sort((a, b) => b.weightedCrmPipeline - a.weightedCrmPipeline)
                  .map((sc, idx) => (
                    <TableRow key={sc.id || sc.managerName} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <TableCell className="text-center font-mono font-bold text-xs text-slate-400">{idx + 1}</TableCell>
                      <TableCell className="font-bold text-slate-900 dark:text-slate-100">{sc.managerName}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-800 dark:text-emerald-300">
                        {formatUSD(sc.weightedCrmPipeline)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                        {formatUSD(sc.rawCrmPipeline)}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs">
                        {sc.overdueCount > 0 ? (
                          <Badge variant="outline" className="border-red-300 bg-red-50 text-red-800 font-bold dark:border-red-800 dark:bg-red-950/60 dark:text-red-300">
                            {sc.overdueCount} İş
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px]">Temiz</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-sm">
                        <span className={sc.crmHealthScore < 80 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}>
                          %{sc.crmHealthScore}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsScorecardLeaderboardOpen(false)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
