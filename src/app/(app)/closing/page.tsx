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
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  Percent,
  Target,
  TrendingUp,
  Upload,
  Users2,
} from "lucide-react";
import { getCurrentFiscalContext } from "@/lib/fiscal";
import { getClosings, importClosingsFromXls } from "./actions";

interface ClosingRow {
  vendorId: string;
  vendorName: string;
  vendorCode: string | null;
  managerId: string | null;
  managerName: string | null;
  targetRevenue: number;
  targetGp: number;
  targetGpPercent: number;
  forecastRevenue: number;
  forecastGp: number;
  forecastGpPercent: number;
  closingRevenue: number;
  closingGp: number;
  closingGpPercent: number;
  targetAchievement: number;
  targetGpAchievement: number;
  forecastAchievement: number;
  forecastGpAchievement: number;
  hasClosing: boolean;
  updatedAt: Date | string | null;
  isPeriodLocked: boolean;
}

interface ManagerClosingGroup {
  id: string;
  managerName: string;
  rows: ClosingRow[];
  targetRevenue: number;
  targetGp: number;
  forecastRevenue: number;
  forecastGp: number;
  closingRevenue: number;
  closingGp: number;
  closedCount: number;
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

function calculatePercent(value: number, target: number) {
  return target > 0 ? (value / target) * 100 : 0;
}

function calculateGpPercent(revenue: number, gp: number) {
  return revenue > 0 ? (gp / revenue) * 100 : 0;
}

function getAchievementTone(value: number) {
  if (value >= 100) return "text-emerald-700 dark:text-emerald-400";
  if (value >= 75) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function escapeExcelCell(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default function ClosingPage() {
  const currentContext = getCurrentFiscalContext();
  const [fiscalYear, setFiscalYear] = useState(currentContext.fiscalYear);
  const [quarter, setQuarter] = useState(currentContext.quarter);
  const [rows, setRows] = useState<ClosingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkFileName, setBulkFileName] = useState("");
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

  const fiscalYearsRange = [
    currentContext.fiscalYear - 1,
    currentContext.fiscalYear,
    currentContext.fiscalYear + 1,
  ];

  const loadClosings = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getClosings(fiscalYear, quarter);
      setRows(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Kapanış verileri yüklenirken hata oluştu."));
    } finally {
      setIsLoading(false);
    }
  }, [fiscalYear, quarter]);

  useEffect(() => {
    void Promise.resolve().then(loadClosings);
  }, [loadClosings]);

  const totals = rows.reduce(
    (acc, row) => {
      acc.targetRevenue += row.targetRevenue;
      acc.targetGp += row.targetGp;
      acc.forecastRevenue += row.forecastRevenue;
      acc.forecastGp += row.forecastGp;
      acc.closingRevenue += row.closingRevenue;
      acc.closingGp += row.closingGp;
      acc.closedCount += row.hasClosing ? 1 : 0;
      return acc;
    },
    {
      targetRevenue: 0,
      targetGp: 0,
      forecastRevenue: 0,
      forecastGp: 0,
      closingRevenue: 0,
      closingGp: 0,
      closedCount: 0,
    }
  );

  const managerGroups = useMemo<ManagerClosingGroup[]>(() => {
    const groupMap = new Map<string, ManagerClosingGroup>();

    for (const row of rows) {
      const groupId = row.managerId ?? "unassigned";
      const existing =
        groupMap.get(groupId) ??
        {
          id: groupId,
          managerName: row.managerName ?? "Atanmamış",
          rows: [],
          targetRevenue: 0,
          targetGp: 0,
          forecastRevenue: 0,
          forecastGp: 0,
          closingRevenue: 0,
          closingGp: 0,
          closedCount: 0,
        };

      existing.rows.push(row);
      existing.targetRevenue += row.targetRevenue;
      existing.targetGp += row.targetGp;
      existing.forecastRevenue += row.forecastRevenue;
      existing.forecastGp += row.forecastGp;
      existing.closingRevenue += row.closingRevenue;
      existing.closingGp += row.closingGp;
      existing.closedCount += row.hasClosing ? 1 : 0;
      groupMap.set(groupId, existing);
    }

    return Array.from(groupMap.values())
      .map((group) => ({
        ...group,
        rows: group.rows.sort((a, b) => a.vendorName.localeCompare(b.vendorName, "tr")),
      }))
      .sort((a, b) => a.managerName.localeCompare(b.managerName, "tr"));
  }, [rows]);

  const toggleManager = (managerId: string) => {
    setExpandedManagers((current) => ({
      ...current,
      [managerId]: !(current[managerId] ?? false),
    }));
  };

  const handleSelectBulkFile = (file: File | undefined) => {
    setBulkFile(file ?? null);
    setBulkFileName(file?.name ?? "");
  };

  const handleBulkImportSubmit = async () => {
    if (!bulkFile) return;

    setIsBulkSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", bulkFile);
      const result = await importClosingsFromXls(formData, fiscalYear, quarter);
      if (!result.success) {
        toast.error(result.error || "Kapanış XLS yükleme sırasında hata oluştu.");
        return;
      }

      toast.success(`${result.importedCount} kapanış satırı yüklendi.`);
      if (result.skippedCount && result.skippedCount > 0) {
        toast.warning(`${result.skippedCount} marka eşleşmediği için atlandı: ${result.skippedBrands?.join(", ")}`);
      }
      setIsBulkUploadModalOpen(false);
      setBulkFile(null);
      setBulkFileName("");
      await loadClosings();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Kapanış XLS yükleme sırasında hata oluştu."));
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const headers = ["Number", "finansal yıl + çeyrek", "Marka", "kapanış revenue", "kapanış GP"];
    const sampleRows = [
      ["1", `FY${fiscalYear}-Q${quarter}`, "CISCO", "1000000", "100000"],
      ["2", `FY${fiscalYear}-Q${quarter}`, "ARUBA", "500000", "60000"],
    ];
    const html = `<!doctype html><html><head><meta charset="UTF-8" /></head><body><table><tr>${headers
      .map((header) => `<th>${escapeExcelCell(header)}</th>`)
      .join("")}</tr>${sampleRows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeExcelCell(cell)}</td>`).join("")}</tr>`)
      .join("")}</table></body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kapanis-template-FY${fiscalYear}-Q${quarter}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const targetAchievement = calculatePercent(totals.closingRevenue, totals.targetRevenue);
  const forecastAchievement = calculatePercent(totals.closingRevenue, totals.forecastRevenue);
  const closingGpPercent = calculateGpPercent(totals.closingRevenue, totals.closingGp);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-serif text-2xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400">
            Kapanış
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Çeyrek sonu kapanış rakamlarını yükleyin ve target/forecast karşılaştırmasını izleyin.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
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
        <div className="flex min-h-28 items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <span className="text-xs font-semibold uppercase text-slate-500">Kapanış NSB</span>
            <div className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-100">{formatUSD(totals.closingRevenue)}</div>
            <div className="mt-1 text-xs font-medium text-slate-500">GP {formatUSD(totals.closingGp)}</div>
          </div>
          <CheckCircle2 className="h-6 w-6 text-emerald-700" />
        </div>
        <div className="flex min-h-28 items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <span className="text-xs font-semibold uppercase text-slate-500">Target Achievement</span>
            <div className={`mt-1 text-2xl font-bold ${getAchievementTone(targetAchievement)}`}>{formatPercent(targetAchievement)}</div>
            <div className="mt-1 text-xs font-medium text-slate-500">Target {formatUSD(totals.targetRevenue)}</div>
          </div>
          <Target className="h-6 w-6 text-emerald-700" />
        </div>
        <div className="flex min-h-28 items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <span className="text-xs font-semibold uppercase text-slate-500">Forecast vs Kapanış</span>
            <div className={`mt-1 text-2xl font-bold ${getAchievementTone(forecastAchievement)}`}>{formatPercent(forecastAchievement)}</div>
            <div className="mt-1 text-xs font-medium text-slate-500">Forecast {formatUSD(totals.forecastRevenue)}</div>
          </div>
          <TrendingUp className="h-6 w-6 text-emerald-700" />
        </div>
        <div className="flex min-h-28 items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <span className="text-xs font-semibold uppercase text-slate-500">Kapanış GP%</span>
            <div className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-100">{formatPercent(closingGpPercent)}</div>
            <div className="mt-1 text-xs font-medium text-slate-500">{totals.closedCount}/{rows.length} marka yüklü</div>
          </div>
          <Percent className="h-6 w-6 text-emerald-700" />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
            <span className="ml-2 text-sm font-medium text-slate-500">Kapanış verileri yükleniyor...</span>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
              <TableRow>
                <TableHead>Satış Müdürü / Vendor</TableHead>
                <TableHead className="text-right">Target NSB</TableHead>
                <TableHead className="text-right">Forecast NSB</TableHead>
                <TableHead className="text-right">Kapanış NSB</TableHead>
                <TableHead className="text-right">Kapanış GP</TableHead>
                <TableHead className="text-right">GP%</TableHead>
                <TableHead className="text-right">Target Achv</TableHead>
                <TableHead className="text-right">Forecast Achv</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {managerGroups.map((group) => {
                const isExpanded = expandedManagers[group.id] ?? false;
                const ToggleIcon = isExpanded ? ChevronDown : ChevronRight;
                const groupTargetAchievement = calculatePercent(group.closingRevenue, group.targetRevenue);
                const groupForecastAchievement = calculatePercent(group.closingRevenue, group.forecastRevenue);
                const groupGpPercent = calculateGpPercent(group.closingRevenue, group.closingGp);

                return (
                  <React.Fragment key={group.id}>
                    <TableRow className="bg-slate-50/80 hover:bg-slate-100/80 dark:bg-slate-800/40">
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => toggleManager(group.id)}
                          className="flex w-full items-center gap-2 text-left font-semibold text-slate-950 dark:text-slate-100"
                        >
                          <ToggleIcon className="h-4 w-4 text-slate-500" />
                          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                            <Users2 className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate">{group.managerName}</span>
                            <span className="block text-[11px] font-medium text-slate-500">{group.closedCount}/{group.rows.length} kapanış</span>
                          </span>
                        </button>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold">{formatUSD(group.targetRevenue)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold">{formatUSD(group.forecastRevenue)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold">{formatUSD(group.closingRevenue)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold">{formatUSD(group.closingGp)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold">{formatPercent(groupGpPercent)}</TableCell>
                      <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(groupTargetAchievement)}`}>{formatPercent(groupTargetAchievement)}</TableCell>
                      <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(groupForecastAchievement)}`}>{formatPercent(groupForecastAchievement)}</TableCell>
                    </TableRow>
                    {isExpanded &&
                      group.rows.map((row) => (
                        <TableRow key={row.vendorId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                          <TableCell className="pl-14 font-semibold text-slate-900 dark:text-slate-100">
                            {row.vendorName}
                            {row.vendorCode && <span className="ml-2 text-[11px] font-normal text-slate-500">{row.vendorCode}</span>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatUSD(row.targetRevenue)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatUSD(row.forecastRevenue)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatUSD(row.closingRevenue)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatUSD(row.closingGp)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-bold">{formatPercent(row.closingGpPercent)}</TableCell>
                          <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(row.targetAchievement)}`}>
                            {formatPercent(row.targetAchievement)}
                          </TableCell>
                          <TableCell className={`text-right font-mono text-xs font-bold ${getAchievementTone(row.forecastAchievement)}`}>
                            {formatPercent(row.forecastAchievement)}
                          </TableCell>
                        </TableRow>
                      ))}
                  </React.Fragment>
                );
              })}
              <TableRow className="border-t-2 border-slate-200 bg-slate-50/70 font-bold dark:border-slate-800 dark:bg-slate-800/30">
                <TableCell>GENEL TOPLAM ({totals.closedCount}/{rows.length})</TableCell>
                <TableCell className="text-right font-mono text-xs">{formatUSD(totals.targetRevenue)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{formatUSD(totals.forecastRevenue)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{formatUSD(totals.closingRevenue)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{formatUSD(totals.closingGp)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{formatPercent(closingGpPercent)}</TableCell>
                <TableCell className={`text-right font-mono text-xs ${getAchievementTone(targetAchievement)}`}>{formatPercent(targetAchievement)}</TableCell>
                <TableCell className={`text-right font-mono text-xs ${getAchievementTone(forecastAchievement)}`}>{formatPercent(forecastAchievement)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleDownloadTemplate} className="h-9 border-slate-200 text-slate-700 hover:bg-slate-50">
          <Download className="h-4 w-4" />
          Template İndir
        </Button>
        <Button type="button" onClick={() => setIsBulkUploadModalOpen(true)} className="h-9 bg-[#2E5A43] px-4 text-white hover:bg-[#1F3A2E]">
          <Upload className="h-4 w-4" />
          XLS ile Bulk Yükle
        </Button>
      </div>

      <Dialog open={isBulkUploadModalOpen} onOpenChange={setIsBulkUploadModalOpen}>
        <DialogContent className="sm:max-w-lg border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-bold text-[#1F3A2E] dark:text-emerald-400">
              Kapanış XLS Bulk Yükleme
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Beklenen kolonlar: Number, finansal yıl + çeyrek, Marka, kapanış revenue, kapanış GP.
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
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Dosyayı buraya sürükleyin</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                veya bilgisayarınızdan XLS / XLSX / XLSB dosyası seçin.
              </p>
            </div>

            <div className="mt-5 flex flex-col items-center gap-3">
              <Label htmlFor="closing-bulk-file" className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                <Upload className="h-4 w-4" />
                Dosya Seç
              </Label>
              <Input id="closing-bulk-file" type="file" accept=".xls,.xlsx,.xlsb" onChange={(event) => handleSelectBulkFile(event.target.files?.[0])} className="sr-only" />
              {bulkFileName && (
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                  <span className="truncate">{bulkFileName}</span>
                </span>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300">
            <div className="font-semibold text-slate-800 dark:text-slate-100">Template kolonları</div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <span>Number</span>
              <span>finansal yıl + çeyrek</span>
              <span>Marka</span>
              <span>kapanış revenue</span>
              <span>kapanış GP</span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsBulkUploadModalOpen(false)} disabled={isBulkSubmitting} className="border-slate-200 text-slate-700 hover:bg-slate-50">
              İptal
            </Button>
            <Button type="button" onClick={handleBulkImportSubmit} disabled={!bulkFile || isBulkSubmitting} className="flex items-center gap-2 bg-[#2E5A43] text-white hover:bg-[#1F3A2E]">
              {isBulkSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Yükle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
