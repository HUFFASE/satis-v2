"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Target,
  DollarSign,
  TrendingUp,
  Percent,
  Calendar,
  Lock,
  Edit2,
  LockKeyhole,
  ChevronDown,
  ChevronRight,
  Users2,
  FileSpreadsheet,
  Upload,
  Download,
} from "lucide-react";
import { getTargets, upsertTarget, getSessionUser, importTargetsFromXls } from "./actions";
import { getCurrentFiscalContext } from "@/lib/fiscal";

interface TargetRow {
  vendorId: string;
  vendorName: string;
  managerId: string | null;
  managerName: string | null;
  revenue: number;
  gp: number;
  updatedAt: Date | string | null;
  isPeriodLocked: boolean;
}

interface ManagerTargetGroup {
  id: string;
  managerName: string;
  rows: TargetRow[];
  revenue: number;
  gp: number;
  latestUpdatedAt: Date | string | null;
}

type TargetSortKey = "managerName" | "revenue" | "gp" | "gpPercent" | "latestUpdatedAt";
type SortDirection = "asc" | "desc";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function escapeExcelCell(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export default function TargetsPage() {
  const currentContext = getCurrentFiscalContext();

  const [fiscalYear, setFiscalYear] = useState<number>(currentContext.fiscalYear);
  const [quarter, setQuarter] = useState<number>(currentContext.quarter);
  const [targets, setTargets] = useState<TargetRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<{ role?: string | null } | null>(null);
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<TargetSortKey>("managerName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Form states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<TargetRow | null>(null);
  const [revenueInput, setRevenueInput] = useState<string>("0");
  const [gpInput, setGpInput] = useState<string>("0");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkFileName, setBulkFileName] = useState<string>("");
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

  // Fetch session details
  useEffect(() => {
    const loadUser = async () => {
      try {
        const u = await getSessionUser();
        setUser(u);
      } catch (err) {
        console.error("Kullanıcı oturumu yüklenemedi", err);
      }
    };
    loadUser();
  }, []);

  // Fetch target list for selected periods
  const loadTargets = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getTargets(fiscalYear, quarter);
      setTargets(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Hedefler yüklenirken hata oluştu."));
    } finally {
      setIsLoading(false);
    }
  }, [fiscalYear, quarter]);

  useEffect(() => {
    const loadTask = Promise.resolve().then(loadTargets);
    return () => {
      void loadTask;
    };
  }, [loadTargets]);

  const handleOpenEdit = (row: TargetRow) => {
    setSelectedVendor(row);
    setRevenueInput(row.revenue.toString());
    setGpInput(row.gp.toString());
    setIsEditModalOpen(true);
  };

  const handleUpsertSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendor) return;

    const rev = parseFloat(revenueInput);
    const gpVal = parseFloat(gpInput);

    if (isNaN(rev) || rev < 0 || isNaN(gpVal) || gpVal < 0) {
      toast.error("Lütfen geçerli pozitif sayılar giriniz.");
      return;
    }

    if (gpVal > rev) {
      toast.error("GP hedefi, Ciro (Revenue) hedefinden büyük olamaz.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await upsertTarget(
        selectedVendor.vendorId,
        fiscalYear,
        quarter,
        rev,
        gpVal
      );

      if (res.success) {
        toast.success("Hedef başarıyla güncellendi.");
        setIsEditModalOpen(false);
        loadTargets();
      } else {
        toast.error(res.error || "Güncelleme sırasında hata oluştu.");
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Beklenmeyen hata."));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper formats
  const formatUSD = (val: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatPercent = (revenue: number, gp: number) => {
    if (revenue <= 0) return "0.0%";
    const pct = (gp / revenue) * 100;
    return `${pct.toFixed(1)}%`;
  };

  const formatUpdatedAt = (value: Date | string | null) => {
    return value ? new Date(value).toLocaleString("tr-TR") : "Belirlenmemiş";
  };

  // Calculate live values during edits
  const calculateLiveGPPercent = () => {
    const rev = parseFloat(revenueInput);
    const gpVal = parseFloat(gpInput);
    if (isNaN(rev) || isNaN(gpVal) || rev <= 0) return "0.0%";
    return `${((gpVal / rev) * 100).toFixed(1)}%`;
  };

  // Totals calculations
  const totalRevenue = targets.reduce((sum, item) => sum + item.revenue, 0);
  const totalGP = targets.reduce((sum, item) => sum + item.gp, 0);
  const totalGPPercent = totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0;

  const managerGroups = useMemo<ManagerTargetGroup[]>(() => {
    const groupMap = new Map<string, ManagerTargetGroup>();

    for (const row of targets) {
      const groupId = row.managerId ?? "unassigned";
      const managerName = row.managerName ?? "Atanmamış";
      const existing = groupMap.get(groupId);

      if (existing) {
        existing.rows.push(row);
        existing.revenue += row.revenue;
        existing.gp += row.gp;
        if (
          row.updatedAt &&
          (!existing.latestUpdatedAt ||
            new Date(row.updatedAt).getTime() > new Date(existing.latestUpdatedAt).getTime())
        ) {
          existing.latestUpdatedAt = row.updatedAt;
        }
        continue;
      }

      groupMap.set(groupId, {
        id: groupId,
        managerName,
        rows: [row],
        revenue: row.revenue,
        gp: row.gp,
        latestUpdatedAt: row.updatedAt,
      });
    }

    return Array.from(groupMap.values()).sort((a, b) =>
      a.managerName.localeCompare(b.managerName, "tr")
    );
  }, [targets]);

  const handleSort = (key: TargetSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "managerName" ? "asc" : "desc");
  };

  const sortedManagerGroups = useMemo(() => {
    const getValue = (group: ManagerTargetGroup) => {
      if (sortKey === "managerName") return group.managerName;
      if (sortKey === "gpPercent") return group.revenue > 0 ? (group.gp / group.revenue) * 100 : 0;
      if (sortKey === "latestUpdatedAt") return group.latestUpdatedAt ? new Date(group.latestUpdatedAt).getTime() : 0;
      return group[sortKey];
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
      [managerId]: !(current[managerId] ?? true),
    }));
  };

  const handleDownloadTemplate = () => {
    const headers = ["Number", "Vendor", "Quarter", "Revenue", "GP"];
    const sampleRow = ["1", "VENDOR_NAME", `FY${fiscalYear}-Q${quarter}`, "0", "0"];
    const rows = [headers, sampleRow];
    const tableRows = rows
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${escapeExcelCell(cell)}</td>`).join("")}</tr>`
      )
      .join("");
    const workbook = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    td { mso-number-format:"\\@"; }
  </style>
</head>
<body>
  <table>${tableRows}</table>
</body>
</html>`;
    const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `target-template-FY${fiscalYear}-Q${quarter}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleSelectBulkFile = (file: File | undefined) => {
    if (!file) {
      setBulkFile(null);
      setBulkFileName("");
      return;
    }

    setBulkFile(file);
    setBulkFileName(file.name);
  };

  const handleBulkImportSubmit = async () => {
    if (!bulkFile) return;

    setIsBulkSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", bulkFile);

      const result = await importTargetsFromXls(formData, fiscalYear, quarter);
      if (!result.success) {
        toast.error(result.error || "XLS yükleme sırasında hata oluştu.");
        return;
      }

      const skippedDuplicateCount = result.skippedDuplicateCount ?? 0;
      toast.success(`${result.importedCount} hedef satırı yüklendi.`);
      if (skippedDuplicateCount > 0) {
        toast.info(`${skippedDuplicateCount} tekrar eden satırda son değer kullanıldı.`);
      }
      setIsBulkUploadModalOpen(false);
      setBulkFile(null);
      setBulkFileName("");
      await loadTargets();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "XLS yükleme sırasında hata oluştu."));
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const isPeriodLocked = targets.length > 0 && targets[0].isPeriodLocked;

  const fiscalYearsRange = [
    currentContext.fiscalYear - 1,
    currentContext.fiscalYear,
    currentContext.fiscalYear + 1,
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Title & Period select */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400 font-serif">
            Hedef Yönetimi
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-sans">
            Vendor bazlı dönemsel Ciro (Revenue) ve GP hedeflerini belirleyin.
          </p>
        </div>

        {/* Period Selector dropdowns */}
        <div className="flex items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-lg shadow-sm">
          <Calendar className="h-4 w-4 text-emerald-600 shrink-0" />
          
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 font-sans">Mali Yıl:</span>
            <Select
              value={fiscalYear.toString()}
              onValueChange={(val) => { if (val) setFiscalYear(parseInt(val)); }}
            >
              <SelectTrigger className="h-8 w-24 border-slate-200 text-xs font-medium focus:outline-none">
                <SelectValue placeholder="Yıl" />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                {fiscalYearsRange.map((y) => (
                  <SelectItem key={y} value={y.toString()} className="text-xs font-sans">
                    FY{y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-700" />

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 font-sans">Çeyrek:</span>
            <Select
              value={quarter.toString()}
              onValueChange={(val) => { if (val) setQuarter(parseInt(val)); }}
            >
              <SelectTrigger className="h-8 w-20 border-slate-200 text-xs font-medium focus:outline-none">
                <SelectValue placeholder="Çeyrek" />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                {[1, 2, 3, 4].map((q) => (
                  <SelectItem key={q} value={q.toString()} className="text-xs font-sans">
                    Q{q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Locked period banner warning */}
      {isPeriodLocked && (
        <div className="flex items-center gap-2.5 p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg text-red-800 dark:text-red-300 text-sm font-sans font-medium">
          <LockKeyhole className="h-5 w-5 text-red-600 shrink-0 animate-bounce" />
          <span>Bu mali çeyrek kilitlenmiştir. Dönem üzerindeki tüm hedefler salt okunur durumdadır.</span>
        </div>
      )}

      {/* Totals Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Revenue */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-sans">
              {user?.role === "DIREKTOR" ? "Toplam Ciro Hedefi (Tüm)" : "Toplam Ciro Hedefiniz"}
            </span>
            <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-sans">
              {formatUSD(totalRevenue)}
            </h3>
          </div>
          <div className="h-10 w-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <DollarSign className="h-5 w-5" />
          </div>
        </div>

        {/* Total GP */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-sans">
              {user?.role === "DIREKTOR" ? "Toplam GP Hedefi (Tüm)" : "Toplam GP Hedefiniz"}
            </span>
            <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-sans">
              {formatUSD(totalGP)}
            </h3>
          </div>
          <div className="h-10 w-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <TrendingUp className="h-5 w-5" />
          </div>
        </div>

        {/* Total GP% */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-sans">
              Ortalama GP Oranı
            </span>
            <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-sans">
              {totalGPPercent.toFixed(1)}%
            </h3>
          </div>
          <div className="h-10 w-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Percent className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Targets Table */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="h-40 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            <span className="ml-2 text-slate-500 font-sans font-medium">Hedefler yükleniyor...</span>
          </div>
        ) : targets.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center text-slate-500 font-sans">
            <Target className="h-10 w-10 text-slate-300 mb-2" />
            <span>Bu çeyrek için yetkilendirilmiş vendor bulunamadı.</span>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-emerald-950 shadow-sm">
              <TableRow>
                <SortableTableHead label="Satış Müdürü / Vendor" active={sortKey === "managerName"} direction={sortDirection} onClick={() => handleSort("managerName")} />
                <SortableTableHead label="Revenue Hedefi (USD)" align="right" active={sortKey === "revenue"} direction={sortDirection} onClick={() => handleSort("revenue")} />
                <SortableTableHead label="GP Hedefi (USD)" align="right" active={sortKey === "gp"} direction={sortDirection} onClick={() => handleSort("gp")} />
                <SortableTableHead label="GP%" align="right" active={sortKey === "gpPercent"} direction={sortDirection} onClick={() => handleSort("gpPercent")} className="w-32" />
                <SortableTableHead label="Son Güncelleme" align="center" active={sortKey === "latestUpdatedAt"} direction={sortDirection} onClick={() => handleSort("latestUpdatedAt")} className="w-44" />
                <TableHead className="w-32 bg-emerald-900 text-right text-xs font-extrabold uppercase tracking-wide text-emerald-50">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedManagerGroups.map((group) => {
                const isExpanded = expandedManagers[group.id] ?? false;
                const ToggleIcon = isExpanded ? ChevronDown : ChevronRight;

                return (
                  <React.Fragment key={group.id}>
                    <TableRow
                      aria-expanded={isExpanded}
                      className="border-l-4 border-emerald-700 bg-emerald-50/80 shadow-[inset_0_-1px_0_rgba(16,185,129,0.18)] hover:bg-emerald-100/80 dark:border-emerald-500 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30"
                    >
                      <TableCell className="font-semibold text-slate-950 dark:text-slate-100">
                        <button
                          type="button"
                          onClick={() => toggleManager(group.id)}
                          className="flex w-full items-center gap-2 text-left"
                        >
                          <ToggleIcon className="h-4 w-4 text-slate-500" />
                          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                            <Users2 className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate">{group.managerName}</span>
                            <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              {group.rows.length} vendor
                            </span>
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(group.revenue)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-950 dark:text-emerald-200">{formatUSD(group.gp)}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-800 dark:text-emerald-300">
                        {formatPercent(group.revenue, group.gp)}
                      </TableCell>
                      <TableCell className="text-center text-slate-500 font-sans text-[11px]">
                        {formatUpdatedAt(group.latestUpdatedAt)}
                      </TableCell>
                      <TableCell className="text-right text-[11px] font-medium text-slate-500">
                        Toplam
                      </TableCell>
                    </TableRow>

                    {isExpanded &&
                      group.rows.map((row) => (
                        <TableRow key={row.vendorId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <TableCell className="pl-14 font-semibold text-slate-800 dark:text-slate-200">
                            {row.vendorName}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatUSD(row.revenue)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatUSD(row.gp)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold text-emerald-800 dark:text-emerald-400">
                            {formatPercent(row.revenue, row.gp)}
                          </TableCell>
                          <TableCell className="text-center text-slate-500 font-sans text-[11px]">
                            {formatUpdatedAt(row.updatedAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant={isPeriodLocked ? "ghost" : "outline"}
                              size="sm"
                              onClick={() => handleOpenEdit(row)}
                              className={`h-8 font-sans ${
                                isPeriodLocked
                                  ? "text-slate-400 border-transparent hover:bg-transparent"
                                  : "border-slate-200 hover:bg-slate-50 hover:text-emerald-800 text-slate-700"
                              }`}
                            >
                              {isPeriodLocked ? (
                                <>
                                  <Lock className="h-3.5 w-3.5 mr-1 text-slate-400" />
                                  İncele
                                </>
                              ) : (
                                <>
                                  <Edit2 className="h-3.5 w-3.5 mr-1" />
                                  Düzenle
                                </>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </React.Fragment>
                );
              })}

              {/* Summary Bottom Row */}
              <TableRow className="border-t-2 border-emerald-800 bg-[#1F3A2E] font-bold text-white hover:bg-[#1F3A2E] dark:border-emerald-500 dark:bg-emerald-950">
                <TableCell>GENEL TOPLAM</TableCell>
                <TableCell className="text-right font-mono text-sm font-extrabold">{formatUSD(totalRevenue)}</TableCell>
                <TableCell className="text-right font-mono text-sm font-extrabold">{formatUSD(totalGP)}</TableCell>
                <TableCell className="text-right font-mono text-sm font-extrabold text-emerald-100">
                  {totalRevenue > 0 ? `${totalGPPercent.toFixed(1)}%` : "0.0%"}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>

      {/* Bulk XLS Upload */}
      <div className="flex flex-col justify-end gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          onClick={handleDownloadTemplate}
          className="h-9 border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50 hover:text-emerald-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Download className="h-4 w-4" />
          Template XLS İndir
        </Button>
        <Button
          type="button"
          onClick={() => setIsBulkUploadModalOpen(true)}
          className="h-9 bg-[#2E5A43] px-4 text-white hover:bg-[#1F3A2E]"
        >
          <Upload className="h-4 w-4" />
          XLS ile Bulk Yükle
        </Button>
      </div>

      {/* Bulk XLS Upload dialog */}
      <Dialog open={isBulkUploadModalOpen} onOpenChange={setIsBulkUploadModalOpen}>
        <DialogContent className="sm:max-w-lg bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1F3A2E] dark:text-emerald-400 text-xl font-bold">
              XLS Bulk Yükleme
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-sans text-xs">
              FY{fiscalYear} - Q{quarter} hedefleri için XLS veya XLSX dosyası seçin.
            </DialogDescription>
          </DialogHeader>

          <div
            className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/70 p-8 text-center dark:border-slate-800 dark:bg-slate-950/30"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              handleSelectBulkFile(event.dataTransfer.files?.[0]);
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
                htmlFor="target-bulk-file"
                className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Upload className="h-4 w-4" />
                Dosya Seç
              </Label>
              <Input
                id="target-bulk-file"
                type="file"
                accept=".xls,.xlsx,.xlsb"
                onChange={(event) => handleSelectBulkFile(event.target.files?.[0])}
                className="sr-only"
              />
              {bulkFileName && (
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                  <span className="truncate">{bulkFileName}</span>
                </span>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsBulkUploadModalOpen(false)}
              disabled={isBulkSubmitting}
              className="border-slate-200 hover:bg-slate-50 text-slate-700"
            >
              İptal
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadTemplate}
              disabled={isBulkSubmitting}
              className="border-slate-200 hover:bg-slate-50 hover:text-emerald-800 text-slate-700"
            >
              <Download className="h-4 w-4" />
              Template İndir
            </Button>
            <Button
              type="button"
              onClick={handleBulkImportSubmit}
              disabled={!bulkFile || isBulkSubmitting}
              className="bg-[#2E5A43] hover:bg-[#1F3A2E] text-white flex items-center gap-2"
            >
              {isBulkSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Yükle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Target Editor dialog */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1F3A2E] dark:text-emerald-400 text-xl font-bold">
              {isPeriodLocked ? "Hedef Detayları" : "Dönemsel Hedef Belirle"}
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-sans text-xs">
              <strong className="text-slate-800 dark:text-slate-200 font-sans">{selectedVendor?.vendorName}</strong> vendor kaydı için FY{fiscalYear} - Q{quarter} hedefleri.
            </DialogDescription>
          </DialogHeader>

          {isPeriodLocked && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 rounded text-xs font-sans font-medium flex items-center gap-1.5">
              <Lock className="h-4 w-4 text-amber-600 shrink-0" />
              <span>Bu çeyrek kilitlendiği için değerler değiştirilemez.</span>
            </div>
          )}

          <form onSubmit={handleUpsertSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="target-rev" className="text-slate-700 dark:text-slate-300 font-medium">Revenue Hedefi (USD)</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
                <Input
                  id="target-rev"
                  type="number"
                  step="any"
                  value={revenueInput}
                  onChange={(e) => setRevenueInput(e.target.value)}
                  disabled={isSubmitting || isPeriodLocked}
                  placeholder="0.00"
                  className="pl-7 border-slate-200 focus-visible:ring-emerald-700 font-sans"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="target-gp" className="text-slate-700 dark:text-slate-300 font-medium">GP Hedefi (USD)</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
                <Input
                  id="target-gp"
                  type="number"
                  step="any"
                  value={gpInput}
                  onChange={(e) => setGpInput(e.target.value)}
                  disabled={isSubmitting || isPeriodLocked}
                  placeholder="0.00"
                  className="pl-7 border-slate-200 focus-visible:ring-emerald-700 font-sans"
                />
              </div>
            </div>

            {/* Live GP% Indicator */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-lg flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase font-sans">Hesaplanan GP Oranı (%):</span>
              <span className="font-mono text-sm font-bold text-emerald-800 dark:text-emerald-400">
                {calculateLiveGPPercent()}
              </span>
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditModalOpen(false)}
                disabled={isSubmitting}
                className="border-slate-200 hover:bg-slate-50 text-slate-700"
              >
                {isPeriodLocked ? "Kapat" : "İptal"}
              </Button>
              {!isPeriodLocked && (
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#2E5A43] hover:bg-[#1F3A2E] text-white flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Kaydet
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
