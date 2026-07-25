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
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  DollarSign,
  Edit2,
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
  BarChart3,
} from "lucide-react";
import { MultiSelectFilter, FilterOption } from "@/components/ui/multi-select-filter";
import { getCurrentFiscalContext } from "@/lib/fiscal";
import {
  copyPreviousWeekForecastsForManager,
  getActiveForecasts,
  getForecastVersions,
  getManagerScorecardsAction,
  getVendorScorecardsAction,
  getSessionUser,
  getWeeklyForecastTrend,
  importForecastFromXls,
  inspectForecastWorkbook,
  submitForecast,
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

interface ForecastImportVendorOption {
  id: string;
  name: string;
}

interface ForecastImportInspectResult {
  sheetCount: number;
  matchedCount: number;
  unmatchedSheets: string[];
  vendors: ForecastImportVendorOption[];
}

const SKIP_FORECAST_SHEET_VALUE = "__skip__";
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

function formatDate(value: Date | string | null) {
  return value ? new Date(value).toLocaleString("tr-TR") : "Girilmemiş";
}

function getPercentTone(value: number) {
  if (value >= 20) return "text-emerald-700 dark:text-emerald-400";
  if (value >= 10) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function getAchievementTone(value: number) {
  if (value >= 100) return "text-emerald-700 dark:text-emerald-400";
  if (value >= 75) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

export default function ForecastInputPage() {
  const currentContext = getCurrentFiscalContext();
  const [fiscalYear, setFiscalYear] = useState(currentContext.fiscalYear);
  const [quarter, setQuarter] = useState(currentContext.quarter);
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [user, setUser] = useState<{ role?: string | null } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});

  const [selectedForecast, setSelectedForecast] = useState<ForecastRow | null>(null);
  const [revenueInput, setRevenueInput] = useState("0");
  const [gpInput, setGpInput] = useState("0");
  const [noteInput, setNoteInput] = useState("");
  const [viewWeekNumber, setViewWeekNumber] = useState<number | "active">("active");
  const [weeklyTrend, setWeeklyTrend] = useState<{ weekNumber: number; revenue: number; gp: number; count: number }[]>([]);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkFileName, setBulkFileName] = useState("");
  const [isBulkInspecting, setIsBulkInspecting] = useState(false);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [bulkInspectResult, setBulkInspectResult] = useState<ForecastImportInspectResult | null>(null);
  const [sheetMappings, setSheetMappings] = useState<Record<string, string>>({});
  const [bulkWeekNumber, setBulkWeekNumber] = useState<number>(currentContext.weekInQuarter);

  const handleOpenBulkModal = () => {
    setBulkWeekNumber(currentContext.weekInQuarter);
    setIsBulkUploadModalOpen(true);
  };
  const [copyingManagerId, setCopyingManagerId] = useState<string | null>(null);
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
  const forecastedCount = filteredForecasts.filter((row) => row.hasForecast).length;

  const activeWeekLabel = isSelectedCurrentPeriod
    ? `${currentContext.weekInQuarter}. Hafta`
    : `Aktif dönem FY${currentContext.fiscalYear} - Q${currentContext.quarter}`;

  const liveRevenue = parseFloat(revenueInput);
  const liveGP = parseFloat(gpInput);
  const liveGPPercent = Number.isFinite(liveRevenue) && liveRevenue > 0 && Number.isFinite(liveGP)
    ? (liveGP / liveRevenue) * 100
    : 0;

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

  const handleSelectBulkFile = async (file: File | undefined) => {
    setBulkFile(file ?? null);
    setBulkFileName(file?.name ?? "");
    setBulkInspectResult(null);
    setSheetMappings({});

    if (!file) return;

    setIsBulkInspecting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await inspectForecastWorkbook(formData);

      if (!result.success) {
        toast.error(result.error || "Excel dosyası okunamadı.");
        setBulkFile(null);
        setBulkFileName("");
        return;
      }

      const inspectResult = {
        sheetCount: result.sheetCount ?? 0,
        matchedCount: result.matchedCount ?? 0,
        unmatchedSheets: result.unmatchedSheets ?? [],
        vendors: result.vendors ?? [],
      };

      setBulkInspectResult(inspectResult);
      setSheetMappings(
        Object.fromEntries(inspectResult.unmatchedSheets.map((sheetName) => [sheetName, ""]))
      );

      if (inspectResult.unmatchedSheets.length === 0) {
        toast.success(`${inspectResult.sheetCount} sheet sistemdeki markalarla eşleşti.`);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Excel dosyası okunurken hata oluştu."));
      setBulkFile(null);
      setBulkFileName("");
    } finally {
      setIsBulkInspecting(false);
    }
  };

  const handleBulkImportSubmit = async () => {
    if (!bulkFile || !bulkInspectResult) return;

    const unmatchedSheets = bulkInspectResult.unmatchedSheets;
    const missingMappings = unmatchedSheets.filter((sheetName) => !sheetMappings[sheetName]);

    if (missingMappings.length > 0) {
      toast.error("Lütfen eşleşmeyen tüm sheetler için marka seçiniz.");
      return;
    }

    setIsBulkSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", bulkFile);
      formData.append(
        "mappings",
        JSON.stringify(
          unmatchedSheets.map((sheetName) => ({
            sheetName,
            vendorId: sheetMappings[sheetName],
          }))
        )
      );

      const result = await importForecastFromXls(formData, fiscalYear, quarter, bulkWeekNumber);
      if (!result.success) {
        toast.error(result.error || "Forecast XLS yükleme sırasında hata oluştu.");
        return;
      }

      toast.success(`${result.importedCount} forecast kaydı yüklendi.`);
      if (result.mergedSheetCount && result.mergedSheetCount > 0) {
        toast.info(`${result.mergedSheetCount} sheet aynı markada birleştirildi.`);
      }
      if (result.skippedSheetCount && result.skippedSheetCount > 0) {
        toast.info(`${result.skippedSheetCount} sheet atlandı.`);
      }
      setIsBulkUploadModalOpen(false);
      setBulkFile(null);
      setBulkFileName("");
      setBulkInspectResult(null);
      setSheetMappings({});
      await loadForecasts();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Forecast XLS yükleme sırasında hata oluştu."));
    } finally {
      setIsBulkSubmitting(false);
    }
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

  const handleOpenSubmit = (row: ForecastRow) => {
    setSelectedForecast(row);
    setRevenueInput(row.revenue.toString());
    setGpInput(row.gp.toString());
    setNoteInput(row.note ?? "");
    setIsSubmitModalOpen(true);
  };

  const handleSubmitForecast = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedForecast) return;

    const revenue = parseFloat(revenueInput);
    const gp = parseFloat(gpInput);

    if (!Number.isFinite(revenue) || revenue < 0 || !Number.isFinite(gp) || gp < 0) {
      toast.error("Lütfen geçerli pozitif sayılar giriniz.");
      return;
    }

    setIsSubmitting(true);
    try {
      const targetWeek = viewWeekNumber === "active" ? undefined : viewWeekNumber;
      const result = await submitForecast(
        selectedForecast.vendorId,
        fiscalYear,
        quarter,
        revenue,
        gp,
        targetWeek,
        noteInput
      );
      if (!result.success) {
        toast.error(result.error || "Forecast kaydedilemedi.");
        return;
      }

      toast.success(
        result.updatedExistingWeek
          ? `${result.weekNumber}. hafta forecast'i güncellendi.`
          : `${result.weekNumber}. hafta forecast'i aktif olarak kaydedildi.`
      );
      setIsSubmitModalOpen(false);
      await loadForecasts();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Forecast kaydedilirken hata oluştu."));
    } finally {
      setIsSubmitting(false);
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

  const handleCopyPreviousWeek = async (managerId: string) => {
    setCopyingManagerId(managerId);
    try {
      const result = await copyPreviousWeekForecastsForManager(
        managerId === "unassigned" ? null : managerId,
        fiscalYear,
        quarter
      );

      if (!result.success) {
        toast.error(result.error || "Önceki hafta forecast'i kopyalanamadı.");
        return;
      }

      toast.success(
        `${result.previousWeekNumber}. hafta forecast'i ${result.weekNumber}. haftaya kopyalandı. ${result.copiedCount} marka güncellendi.`
      );
      if (result.skippedCount && result.skippedCount > 0) {
        toast.info(`${result.skippedCount} markada önceki hafta forecast'i olmadığı için işlem yapılmadı.`);
      }
      await loadForecasts();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Önceki hafta forecast'i kopyalanırken hata oluştu."));
    } finally {
      setCopyingManagerId(null);
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

      {!isSelectedCurrentPeriod && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          Bu seçili dönem aktif çeyrek değil. Forecast girişi sadece aktif çeyrekte yapılabilir.
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {user?.role === "DIREKTOR" ? "Toplam Aktif Forecast" : "Aktif Forecast Toplamınız"}
            </span>
            <h3 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{formatUSD(totalRevenue)}</h3>
          </div>
          <DollarSign className="h-5 w-5 text-emerald-700" />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Toplam GP</span>
            <h3 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{formatUSD(totalGP)}</h3>
          </div>
          <TrendingUp className="h-5 w-5 text-emerald-700" />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Birleşik GP Oranı</span>
            <h3 className={`mt-1 text-2xl font-bold ${getPercentTone(totalGPPercent)}`}>
              {formatPercent(totalGPPercent)}
            </h3>
          </div>
          <Percent className="h-5 w-5 text-emerald-700" />
        </div>
      </div>

      {/* CRM & Scorecard Executive Banner */}
      {scorecards.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50/70 via-white to-cyan-50/70 p-4.5 shadow-sm dark:border-emerald-900/50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 space-y-3">
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
                  <FileSpreadsheet className="h-4 w-4 text-emerald-400" /> Scorecard & CRM Raporu ➔
                </Button>
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
            <div className="rounded-lg border border-slate-200/80 bg-white/90 p-3 shadow-xs dark:border-slate-800 dark:bg-slate-950/40">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Topl. Ağırlıklı CRM</span>
              <span className="font-mono text-base font-extrabold text-emerald-800 dark:text-emerald-300">
                {formatUSD(scorecards.reduce((acc, s) => acc + s.weightedCrmPipeline, 0))}
              </span>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-white/90 p-3 shadow-xs dark:border-slate-800 dark:bg-slate-950/40">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Ham CRM Pipeline</span>
              <span className="font-mono text-base font-bold text-slate-700 dark:text-slate-300">
                {formatUSD(scorecards.reduce((acc, s) => acc + s.rawCrmPipeline, 0))}
              </span>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-white/90 p-3 shadow-xs dark:border-slate-800 dark:bg-slate-950/40">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Günü Geçmiş Açık İşler</span>
              <span className="font-mono text-base font-bold text-red-600 dark:text-red-400">
                {scorecards.reduce((acc, s) => acc + s.overdueCount, 0)} Açık İş
              </span>
            </div>
            <div className="rounded-lg border border-slate-200/80 bg-white/90 p-3 shadow-xs dark:border-slate-800 dark:bg-slate-950/40">
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
            <TableHeader className="bg-emerald-800 shadow-sm">
              <TableRow>
                <SortableTableHead
                  rowSpan={2}
                  label="Marka"
                  active={sortKey === "managerName"}
                  direction={sortDirection}
                  onClick={() => handleSort("managerName")}
                  className="min-w-52"
                />
                <th colSpan={3} className="border-b border-l border-emerald-600 bg-emerald-800 px-4 py-2.5 text-center text-sm font-extrabold uppercase tracking-wide text-white">
                  Hedef
                </th>
                <th colSpan={3} className="border-b border-l border-emerald-600 bg-emerald-800 px-4 py-2.5 text-center text-sm font-extrabold uppercase tracking-wide text-white">
                  Forecast
                </th>
                <th colSpan={2} className="border-b border-l border-emerald-600 bg-emerald-800 px-4 py-2.5 text-center text-sm font-extrabold uppercase tracking-wide text-white">
                  Achievement
                </th>
                <th rowSpan={2} className="border-b border-l border-emerald-600 bg-emerald-800 px-4 py-2 text-right text-xs font-extrabold uppercase tracking-wide text-white">
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
                const isCopyingThisManager = copyingManagerId === group.id;
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
                                  <Badge variant="outline" className="border-cyan-300 bg-cyan-50 text-cyan-900 text-[10px] font-mono font-bold dark:border-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300">
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
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Önceki hafta forecast'ini mevcut haftaya kopyala"
                            aria-label={`${group.managerName} için önceki hafta forecast'ini mevcut haftaya kopyala`}
                            onClick={() => void handleCopyPreviousWeek(group.id)}
                            disabled={!isSelectedCurrentPeriod || isPeriodLocked || isCopyingThisManager}
                            className="h-6 w-6 shrink-0 text-slate-500 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-40 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300"
                          >
                            {isCopyingThisManager ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">
                        {formatUSD(group.targetRevenue)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(group.targetGp)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm font-extrabold ${getPercentTone(groupTargetGPPercent)}`}>
                        {formatPercent(groupTargetGPPercent)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(group.revenue)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(group.gp)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm font-extrabold ${getPercentTone(groupGPPercent)}`}>
                        {formatPercent(groupGPPercent)}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm font-extrabold ${getAchievementTone(groupRevenueAchievement)}`}>
                        {formatPercent(groupRevenueAchievement)}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm font-extrabold ${getAchievementTone(groupGPAchievement)}`}>
                        {formatPercent(groupGPAchievement)}
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
                          <TableCell className={`text-right font-mono text-[11px] font-bold ${getPercentTone(row.targetGpPercent)}`}>
                            {row.hasTarget ? formatPercent(row.targetGpPercent) : "-"}
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
                          <TableCell className={`text-right font-mono text-xs font-bold ${getPercentTone(row.gpPercent)}`}>
                            {row.hasForecast ? formatPercent(row.gpPercent) : "-"}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(row.revenueAchievement)}`}>
                            {row.hasTarget && row.hasForecast ? formatPercent(row.revenueAchievement) : "-"}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(row.gpAchievement)}`}>
                            {row.hasTarget && row.hasForecast ? formatPercent(row.gpAchievement) : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenSubmit(row)}
                                disabled={isPeriodLocked}
                                className="h-8 border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-emerald-800"
                              >
                                {isPeriodLocked ? <Lock className="h-3.5 w-3.5" /> : <Edit2 className="h-3.5 w-3.5" />}
                                {row.hasForecast ? "Güncelle" : "Forecast Gir"}
                              </Button>
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

      {/* Sleek Side-by-Side Forecast Trend Charts */}
      {weeklyTrend.length === 0 || weeklyTrend.every((w) => w.revenue === 0 && w.gp === 0) ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 font-sans shadow-sm">
          Seçili mali dönem için henüz haftalık forecast trend verisi bulunmuyor.
        </div>
      ) : (
        (() => {
          const maxRev = Math.max(1, ...weeklyTrend.map((w) => w.revenue));
          const maxGp = Math.max(1, ...weeklyTrend.map((w) => w.gp));
          const maxGpPercent = Math.max(10, ...weeklyTrend.map((w) => (w.revenue > 0 ? (w.gp / w.revenue) * 100 : 0)));
          const maxGpPercentScaled = Math.min(100, Math.ceil(maxGpPercent / 10) * 10 || 50);

          const width = 450;
          const height = 220;
          const paddingY = 30;

          // Chart 1 (Revenue): Left padding 55, Right 20
          const revPadLeft = 55;
          const revPadRight = 20;
          const revChartW = width - revPadLeft - revPadRight;
          const revChartH = height - paddingY * 2;

          const pointsRev = weeklyTrend.map((item, idx) => {
            const x = revPadLeft + (idx / (weeklyTrend.length - 1)) * revChartW;
            const y = height - paddingY - (item.revenue / maxRev) * revChartH;
            return { x, y, item };
          });

          // Chart 2 (GP & GP%): Left padding 55, Right 45
          const gpPadLeft = 55;
          const gpPadRight = 45;
          const gpChartW = width - gpPadLeft - gpPadRight;
          const gpChartH = height - paddingY * 2;

          const pointsGp = weeklyTrend.map((item, idx) => {
            const x = gpPadLeft + (idx / (weeklyTrend.length - 1)) * gpChartW;
            const y = height - paddingY - (item.gp / maxGp) * gpChartH;
            return { x, y, item };
          });

          const pointsGpPercent = weeklyTrend.map((item, idx) => {
            const gpPct = item.revenue > 0 ? (item.gp / item.revenue) * 100 : 0;
            const x = gpPadLeft + (idx / (weeklyTrend.length - 1)) * gpChartW;
            const y = height - paddingY - (gpPct / maxGpPercentScaled) * gpChartH;
            return { x, y, item, gpPct };
          });

          const buildSmoothPath = (pts: { x: number; y: number }[]) => {
            if (pts.length === 0) return "";
            let d = `M ${pts[0].x},${pts[0].y}`;
            for (let i = 0; i < pts.length - 1; i++) {
              const p0 = pts[i];
              const p1 = pts[i + 1];
              const cp1x = p0.x + (p1.x - p0.x) / 2;
              const cp1y = p0.y;
              const cp2x = p1.x - (p1.x - p0.x) / 2;
              const cp2y = p1.y;
              d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p1.x},${p1.y}`;
            }
            return d;
          };

          const revLineD = buildSmoothPath(pointsRev);
          const revAreaD = `${revLineD} L ${pointsRev[pointsRev.length - 1].x},${height - paddingY} L ${pointsRev[0].x},${height - paddingY} Z`;

          const gpLineD = buildSmoothPath(pointsGp);
          const gpAreaD = `${gpLineD} L ${pointsGp[pointsGp.length - 1].x},${height - paddingY} L ${pointsGp[0].x},${height - paddingY} Z`;

          const gpPercentLineD = buildSmoothPath(pointsGpPercent);

          const revYTicks = [0, 0.33, 0.66, 1].map((ratio) => ({
            value: Math.round(maxRev * ratio),
            y: height - paddingY - ratio * revChartH,
          }));

          const gpYTicks = [0, 0.33, 0.66, 1].map((ratio) => ({
            usdValue: Math.round(maxGp * ratio),
            pctValue: Math.round(maxGpPercentScaled * ratio),
            y: height - paddingY - ratio * gpChartH,
          }));

          return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Left Chart: Revenue Trend */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-serif text-base font-bold text-[#1F3A2E] dark:text-emerald-400 flex items-center gap-2">
                      <BarChart3 className="h-4.5 w-4.5 text-emerald-700 dark:text-emerald-400" />
                      Revenue (NSB) Trendi
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-sans">
                      FY{fiscalYear} Q{quarter} 1-13. haftalık ciro akışı.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold font-sans">
                    <span className="h-3 w-3 rounded-xs bg-[#2E5A43]" />
                    <span className="text-slate-700 dark:text-slate-300">Revenue</span>
                  </div>
                </div>

                <div className="relative w-full overflow-hidden pt-1">
                  <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto font-sans overflow-visible">
                    <defs>
                      <linearGradient id="revenue-area-gradient-standalone" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity="0.45" />
                        <stop offset="100%" stopColor="#10B981" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Gridlines & Y-Axis */}
                    {revYTicks.map((tick, i) => (
                      <g key={i}>
                        <line
                          x1={revPadLeft}
                          y1={tick.y}
                          x2={width - revPadRight}
                          y2={tick.y}
                          stroke="currentColor"
                          strokeDasharray="4 4"
                          className="text-slate-200 dark:text-slate-800"
                          strokeWidth="1"
                        />
                        <text
                          x={revPadLeft - 8}
                          y={tick.y + 3}
                          textAnchor="end"
                          className="fill-slate-400 text-[10px] font-mono font-medium"
                        >
                          {formatUSD(tick.value).replace(".00", "")}
                        </text>
                      </g>
                    ))}

                    <path d={revAreaD} fill="url(#revenue-area-gradient-standalone)" />
                    <path d={revLineD} fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" />

                    {pointsRev.map((p) => {
                      const isSelected = viewWeekNumber === p.item.weekNumber;
                      const isActiveWeek = p.item.weekNumber === currentContext.weekInQuarter && isSelectedCurrentPeriod;

                      return (
                        <g key={p.item.weekNumber} className="group cursor-pointer" onClick={() => setViewWeekNumber(p.item.weekNumber)}>
                          <line
                            x1={p.x}
                            y1={paddingY}
                            x2={p.x}
                            y2={height - paddingY}
                            stroke="#10B981"
                            strokeWidth="1.5"
                            strokeDasharray="3 3"
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          />
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={isSelected ? "5.5" : "3.5"}
                            className="fill-emerald-500 stroke-white dark:stroke-slate-900 group-hover:r-6 transition-all shadow-md"
                            strokeWidth="2"
                          />

                          {/* Interactive Hover Tooltip Badge */}
                          <g className="opacity-0 group-hover:opacity-100 transition-all pointer-events-none">
                            <rect
                              x={Math.max(10, Math.min(width - 130, p.x - 60))}
                              y={Math.max(4, p.y - 36)}
                              width="120"
                              height="26"
                              rx="6"
                              className="fill-slate-900/95 dark:fill-slate-950/95 stroke-emerald-500/50 shadow-lg"
                              strokeWidth="1"
                            />
                            <text
                              x={Math.max(10, Math.min(width - 130, p.x - 60)) + 60}
                              y={Math.max(4, p.y - 36) + 17}
                              textAnchor="middle"
                              className="fill-emerald-300 text-[10px] font-mono font-bold"
                            >
                              H{p.item.weekNumber}: {formatUSD(p.item.revenue)}
                            </text>
                          </g>

                          <text
                            x={p.x}
                            y={height - 6}
                            textAnchor="middle"
                            className={`text-[10px] font-mono font-bold transition-all ${
                              isSelected
                                ? "fill-emerald-600 dark:fill-emerald-400 font-extrabold text-[11px]"
                                : isActiveWeek
                                ? "fill-emerald-700 dark:fill-emerald-300"
                                : "fill-slate-500 group-hover:fill-slate-900 dark:group-hover:fill-slate-100"
                            }`}
                          >
                            H{p.item.weekNumber}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>

              {/* Right Chart: GP & % Karlılık Trend */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-serif text-base font-bold text-[#1F3A2E] dark:text-emerald-400 flex items-center gap-2">
                      <BarChart3 className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" />
                      GP (Brüt Kâr) & % Karlılık Trendi
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-sans">
                      FY{fiscalYear} Q{quarter} 1-13. haftalık brüt kâr ve % GP oranı.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-semibold font-sans">
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-xs bg-amber-500" />
                      <span className="text-slate-700 dark:text-slate-300">GP</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-3 w-3 rounded-full bg-cyan-500" />
                      <span className="text-slate-700 dark:text-slate-300">GP%</span>
                    </div>
                  </div>
                </div>

                <div className="relative w-full overflow-hidden pt-1">
                  <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto font-sans overflow-visible">
                    <defs>
                      <linearGradient id="gp-area-gradient-standalone" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.02" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Gridlines, Left Y-Axis (GP USD) & Right Y-Axis (% GP) */}
                    {gpYTicks.map((tick, i) => (
                      <g key={i}>
                        <line
                          x1={gpPadLeft}
                          y1={tick.y}
                          x2={width - gpPadRight}
                          y2={tick.y}
                          stroke="currentColor"
                          strokeDasharray="4 4"
                          className="text-slate-200 dark:text-slate-800"
                          strokeWidth="1"
                        />
                        <text
                          x={gpPadLeft - 8}
                          y={tick.y + 3}
                          textAnchor="end"
                          className="fill-slate-400 text-[10px] font-mono font-medium"
                        >
                          {formatUSD(tick.usdValue).replace(".00", "")}
                        </text>
                        <text
                          x={width - gpPadRight + 8}
                          y={tick.y + 3}
                          textAnchor="start"
                          className="fill-cyan-600 dark:fill-cyan-400 text-[10px] font-mono font-bold"
                        >
                          %{tick.pctValue}
                        </text>
                      </g>
                    ))}

                    <path d={gpAreaD} fill="url(#gp-area-gradient-standalone)" />
                    <path d={gpLineD} fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" />

                    <path d={gpPercentLineD} fill="none" stroke="#06B6D4" strokeWidth="2.5" strokeDasharray="5 3" strokeLinecap="round" />

                    {pointsGp.map((p, idx) => {
                      const pctP = pointsGpPercent[idx];
                      const isSelected = viewWeekNumber === p.item.weekNumber;
                      const isActiveWeek = p.item.weekNumber === currentContext.weekInQuarter && isSelectedCurrentPeriod;

                      return (
                        <g key={p.item.weekNumber} className="group cursor-pointer" onClick={() => setViewWeekNumber(p.item.weekNumber)}>
                          <line
                            x1={p.x}
                            y1={paddingY}
                            x2={p.x}
                            y2={height - paddingY}
                            stroke="#F59E0B"
                            strokeWidth="1.5"
                            strokeDasharray="3 3"
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          />
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={isSelected ? "5" : "3.5"}
                            className="fill-amber-500 stroke-white dark:stroke-slate-900 group-hover:r-5.5 transition-all shadow-md"
                            strokeWidth="1.5"
                          />
                          <circle
                            cx={pctP.x}
                            cy={pctP.y}
                            r={isSelected ? "4.5" : "3"}
                            className="fill-cyan-500 stroke-white dark:stroke-slate-900 group-hover:r-5 transition-all shadow-md"
                            strokeWidth="1.5"
                          />

                          {/* Interactive Hover Tooltip Badge */}
                          <g className="opacity-0 group-hover:opacity-100 transition-all pointer-events-none">
                            <rect
                              x={Math.max(10, Math.min(width - 135, p.x - 62.5))}
                              y={Math.max(4, Math.min(p.y, pctP.y) - 44)}
                              width="125"
                              height="36"
                              rx="6"
                              className="fill-slate-900/95 dark:fill-slate-950/95 stroke-amber-500/50 shadow-lg"
                              strokeWidth="1"
                            />
                            <text
                              x={Math.max(10, Math.min(width - 135, p.x - 62.5)) + 62.5}
                              y={Math.max(4, Math.min(p.y, pctP.y) - 44) + 15}
                              textAnchor="middle"
                              className="fill-amber-300 text-[10px] font-mono font-bold"
                            >
                              GP: {formatUSD(p.item.gp)}
                            </text>
                            <text
                              x={Math.max(10, Math.min(width - 135, p.x - 62.5)) + 62.5}
                              y={Math.max(4, Math.min(p.y, pctP.y) - 44) + 29}
                              textAnchor="middle"
                              className="fill-cyan-300 text-[10px] font-mono font-bold"
                            >
                              GP%: {formatPercent(pctP.gpPct)}
                            </text>
                          </g>

                          <text
                            x={p.x}
                            y={height - 6}
                            textAnchor="middle"
                            className={`text-[10px] font-mono font-bold transition-all ${
                              isSelected
                                ? "fill-amber-600 dark:fill-amber-400 font-extrabold text-[11px]"
                                : isActiveWeek
                                ? "fill-amber-700 dark:fill-amber-300"
                                : "fill-slate-500 group-hover:fill-slate-900 dark:group-hover:fill-slate-100"
                            }`}
                          >
                            H{p.item.weekNumber}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </div>
            </div>
          );
        })()
      )}

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

        <Button
          type="button"
          onClick={handleOpenBulkModal}
          className="h-9 bg-[#2E5A43] px-4 text-white hover:bg-[#1F3A2E] shadow-sm"
        >
          <Upload className="h-4 w-4" />
          XLS ile Bulk Yükle
        </Button>
      </div>

      <Dialog
        open={isBulkUploadModalOpen}
        onOpenChange={(open) => {
          setIsBulkUploadModalOpen(open);
          if (!open) {
            setBulkFile(null);
            setBulkFileName("");
            setBulkInspectResult(null);
            setSheetMappings({});
          }
        }}
      >
        <DialogContent className="sm:max-w-lg border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-bold text-[#1F3A2E] dark:text-emerald-400">
              Forecast XLS Bulk Yükleme
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              FY{fiscalYear} - Q{quarter} dönemi için seçilen haftaya forecast verilerini yükleyin.
            </DialogDescription>
          </DialogHeader>

          {/* Week Selection for Forecast Bulk Upload */}
          <div className="space-y-1.5 rounded-lg border border-emerald-200/60 bg-emerald-50/50 p-3.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <Label htmlFor="forecast-bulk-week-select" className="text-xs font-semibold text-slate-700 dark:text-slate-300 font-sans">
              Yüklenecek Hafta Seçimi:
            </Label>
            <div className="flex items-center gap-2">
              <Select
                value={bulkWeekNumber.toString()}
                onValueChange={(val) => { if (val) setBulkWeekNumber(parseInt(val)); }}
              >
                <SelectTrigger id="forecast-bulk-week-select" className="h-9 border-slate-200 bg-white text-xs font-semibold focus:outline-none dark:border-slate-800 dark:bg-slate-900">
                  <SelectValue placeholder="Hafta Seçin" />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  {Array.from({ length: 13 }, (_, i) => i + 1).map((w) => (
                    <SelectItem key={w} value={w.toString()} className="text-xs font-sans">
                      Hafta {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge className="bg-[#1F3A2E] text-white shrink-0 px-2.5 py-1 text-xs">
                FY{fiscalYear} Q{quarter} - {bulkWeekNumber}. Hafta
              </Badge>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Yüklediğiniz Excel satırları <strong>{bulkWeekNumber}. Hafta</strong> forecast verisi olarak kaydedilecektir.
            </p>
          </div>

          <div
            className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/70 p-8 text-center dark:border-slate-800 dark:bg-slate-950/30"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void handleSelectBulkFile(event.dataTransfer.files?.[0]);
            }}
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <div className="mt-4 space-y-1">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Dosyayı buraya sürükleyin
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                veya bilgisayarınızdan XLS / XLSX / XLSB dosyası seçin.
              </p>
            </div>

            <div className="mt-5 flex flex-col items-center gap-3">
              <Label
                htmlFor="forecast-bulk-file"
                className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Upload className="h-4 w-4" />
                Dosya Seç
              </Label>
              <Input
                id="forecast-bulk-file"
                type="file"
                accept=".xls,.xlsx,.xlsb"
                onChange={(event) => void handleSelectBulkFile(event.target.files?.[0])}
                className="sr-only"
              />
              {bulkFileName && (
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                  <span className="truncate">{bulkFileName}</span>
                </span>
              )}
              {isBulkInspecting && (
                <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-700" />
                  Sheet isimleri okunuyor...
                </span>
              )}
            </div>
          </div>

          {bulkInspectResult && (
            <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/20">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  {bulkInspectResult.sheetCount} sheet bulundu, {bulkInspectResult.matchedCount} sheet otomatik eşleşti.
                </span>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {bulkInspectResult.unmatchedSheets.length} eşleşmeyen
                </span>
              </div>

              {bulkInspectResult.unmatchedSheets.length > 0 && (
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {bulkInspectResult.unmatchedSheets.map((sheetName) => (
                    <div
                      key={sheetName}
                      className="grid gap-2 rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-[1fr_220px] sm:items-center"
                    >
                      <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {sheetName}
                      </span>
                      <Select
                        value={sheetMappings[sheetName] ?? ""}
                        onValueChange={(value) =>
                          setSheetMappings((current) => ({
                            ...current,
                            [sheetName]: value ?? "",
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 border-slate-200 text-xs">
                          <SelectValue placeholder="Marka seç" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72 bg-white border-slate-200">
                          <SelectItem value={SKIP_FORECAST_SHEET_VALUE} className="text-xs text-slate-500">
                            Atla
                          </SelectItem>
                          {bulkInspectResult.vendors.map((vendor) => (
                            <SelectItem key={vendor.id} value={vendor.id} className="text-xs">
                              {vendor.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsBulkUploadModalOpen(false)}
              disabled={isBulkSubmitting}
              className="border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              İptal
            </Button>
            <Button
              type="button"
              onClick={handleBulkImportSubmit}
              disabled={
                !bulkFile ||
                isBulkInspecting ||
                isBulkSubmitting ||
                !bulkInspectResult ||
                bulkInspectResult.unmatchedSheets.some((sheetName) => !sheetMappings[sheetName])
              }
              className="flex items-center gap-2 bg-[#2E5A43] text-white hover:bg-[#1F3A2E]"
            >
              {isBulkSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Yükle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSubmitModalOpen} onOpenChange={setIsSubmitModalOpen}>
        <DialogContent className="sm:max-w-md border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-bold text-[#1F3A2E] dark:text-emerald-400">
              Forecast {selectedForecast?.hasForecast ? "Güncelle" : "Gir"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              <strong className="text-slate-800 dark:text-slate-200">{selectedForecast?.vendorName}</strong> markası için FY{fiscalYear} - Q{quarter}, {currentContext.weekInQuarter}. hafta forecast değeri.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitForecast} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="forecast-revenue">Revenue (USD)</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-slate-400">$</span>
                <Input
                  id="forecast-revenue"
                  type="number"
                  step="any"
                  value={revenueInput}
                  onChange={(event) => setRevenueInput(event.target.value)}
                  disabled={isSubmitting}
                  className="border-slate-200 pl-7 focus-visible:ring-emerald-700"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="forecast-gp">GP (USD)</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-sm text-slate-400">$</span>
                <Input
                  id="forecast-gp"
                  type="number"
                  step="any"
                  value={gpInput}
                  onChange={(event) => setGpInput(event.target.value)}
                  disabled={isSubmitting}
                  className="border-slate-200 pl-7 focus-visible:ring-emerald-700"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="forecast-note" className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 font-sans">
                <MessageSquare className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                Forecast Notu (Opsiyonel)
              </Label>
              <textarea
                id="forecast-note"
                rows={3}
                placeholder="Bu üretici forecast'i için özel bir açıklama veya not girin..."
                value={noteInput}
                onChange={(event) => setNoteInput(event.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-800/40">
              <span className="text-xs font-semibold uppercase text-slate-500">Hesaplanan GP%</span>
              <span className={`font-mono text-sm font-bold ${getPercentTone(liveGPPercent)}`}>
                {formatPercent(liveGPPercent)}
              </span>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsSubmitModalOpen(false)} disabled={isSubmitting}>
                İptal
              </Button>
              <Button type="submit" disabled={isSubmitting} className="bg-[#2E5A43] text-white hover:bg-[#1F3A2E]">
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Kaydet
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
                      <TableCell className={`text-right font-mono text-xs font-bold ${getPercentTone(version.gpPercent)}`}>
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
