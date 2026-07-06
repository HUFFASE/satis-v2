"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { getCurrentFiscalContext } from "@/lib/fiscal";
import {
  copyPreviousWeekForecastsForManager,
  getActiveForecasts,
  getForecastVersions,
  getSessionUser,
  importForecastFromXls,
  inspectForecastWorkbook,
  submitForecast,
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
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkFileName, setBulkFileName] = useState("");
  const [isBulkInspecting, setIsBulkInspecting] = useState(false);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [bulkInspectResult, setBulkInspectResult] = useState<ForecastImportInspectResult | null>(null);
  const [sheetMappings, setSheetMappings] = useState<Record<string, string>>({});
  const [copyingManagerId, setCopyingManagerId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<ForecastSortKey>("managerName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [historyVendor, setHistoryVendor] = useState<ForecastRow | null>(null);
  const [versions, setVersions] = useState<ForecastVersion[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const isSelectedCurrentPeriod =
    fiscalYear === currentContext.fiscalYear && quarter === currentContext.quarter;
  const isPeriodLocked = forecasts.some((row) => row.isPeriodLocked);

  const fiscalYearsRange = [
    currentContext.fiscalYear - 1,
    currentContext.fiscalYear,
    currentContext.fiscalYear + 1,
  ];

  const loadForecasts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getActiveForecasts(fiscalYear, quarter);
      setForecasts(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Forecast verileri yüklenirken hata oluştu."));
    } finally {
      setIsLoading(false);
    }
  }, [fiscalYear, quarter]);

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

  const totalTargetRevenue = forecasts.reduce((sum, row) => sum + row.targetRevenue, 0);
  const totalTargetGP = forecasts.reduce((sum, row) => sum + row.targetGp, 0);
  const totalRevenue = forecasts.reduce((sum, row) => sum + row.revenue, 0);
  const totalGP = forecasts.reduce((sum, row) => sum + row.gp, 0);
  const totalGPPercent = totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0;
  const totalTargetGPPercent = totalTargetRevenue > 0 ? (totalTargetGP / totalTargetRevenue) * 100 : 0;
  const totalRevenueAchievement = totalTargetRevenue > 0 ? (totalRevenue / totalTargetRevenue) * 100 : 0;
  const totalGPAchievement = totalTargetGP > 0 ? (totalGP / totalTargetGP) * 100 : 0;
  const forecastedCount = forecasts.filter((row) => row.hasForecast).length;

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

    for (const row of forecasts) {
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
  }, [forecasts]);

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
    if (!bulkFile) return;

    const unmatchedSheets = bulkInspectResult?.unmatchedSheets ?? [];
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

      const result = await importForecastFromXls(formData, fiscalYear, quarter);
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

  const handleOpenSubmit = (row: ForecastRow) => {
    setSelectedForecast(row);
    setRevenueInput(row.revenue.toString());
    setGpInput(row.gp.toString());
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
      const result = await submitForecast(selectedForecast.vendorId, fiscalYear, quarter, revenue, gp);
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

          <Badge className="bg-emerald-800 text-emerald-50 hover:bg-emerald-800">
            Aktif Hafta: {activeWeekLabel}
          </Badge>
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
                              <span className="block truncate">{group.managerName}</span>
                              <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
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
                            {row.vendorName}
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

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => setIsBulkUploadModalOpen(true)}
          className="h-9 bg-[#2E5A43] px-4 text-white hover:bg-[#1F3A2E]"
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
              FY{fiscalYear} - Q{quarter} forecast verileri için XLS veya XLSX dosyası seçin.
            </DialogDescription>
          </DialogHeader>

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
    </div>
  );
}
