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
  Calendar,
  Lock,
  Edit2,
  LockKeyhole,
  Briefcase,
  Receipt,
  Coins,
  Percent,
  ChevronDown,
  ChevronRight,
  Users2,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import { getActuals, upsertActual, getSessionUser, importBacklogFromXls } from "./actions";
import { getCurrentFiscalContext } from "@/lib/fiscal";

interface ActualRow {
  vendorId: string;
  vendorName: string;
  managerId: string | null;
  managerName: string | null;
  backlog: number;
  invoiced: number;
  updatedAt: Date | string | null;
  isPeriodLocked: boolean;
}

interface ManagerActualGroup {
  id: string;
  managerName: string;
  rows: ActualRow[];
  backlog: number;
  invoiced: number;
  latestUpdatedAt: Date | string | null;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function ActualsPage() {
  const currentContext = getCurrentFiscalContext();

  const [fiscalYear, setFiscalYear] = useState<number>(currentContext.fiscalYear);
  const [quarter, setQuarter] = useState<number>(currentContext.quarter);
  // Default week clamped strictly to [1, 13]
  const defaultWeek = Math.max(1, Math.min(13, currentContext.weekInQuarter));
  const [weekNumber, setWeekNumber] = useState<number>(defaultWeek);

  const [actuals, setActuals] = useState<ActualRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<{ role?: string | null } | null>(null);
  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({});

  // Edit states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState<ActualRow | null>(null);
  const [backlogInput, setBacklogInput] = useState<string>("0");
  const [invoicedInput, setInvoicedInput] = useState<string>("0");
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

  // Fetch actuals list
  const loadActuals = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getActuals(fiscalYear, quarter, weekNumber);
      setActuals(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Backlog verileri yüklenirken hata oluştu."));
    } finally {
      setIsLoading(false);
    }
  }, [fiscalYear, quarter, weekNumber]);

  useEffect(() => {
    const loadTask = Promise.resolve().then(loadActuals);
    return () => {
      void loadTask;
    };
  }, [loadActuals]);

  const handleOpenEdit = (row: ActualRow) => {
    setSelectedVendor(row);
    setBacklogInput(row.backlog.toString());
    setInvoicedInput(row.invoiced.toString());
    setIsEditModalOpen(true);
  };

  const handleUpsertSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendor) return;

    const backlogVal = parseFloat(backlogInput);
    const invoicedVal = parseFloat(invoicedInput);

    if (isNaN(backlogVal) || backlogVal < 0 || isNaN(invoicedVal) || invoicedVal < 0) {
      toast.error("Lütfen geçerli pozitif sayılar giriniz.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await upsertActual(
        selectedVendor.vendorId,
        fiscalYear,
        quarter,
        weekNumber,
        backlogVal,
        invoicedVal
      );

      if (res.success) {
        toast.success("Revenue/GP değeri başarıyla güncellendi.");
        setIsEditModalOpen(false);
        loadActuals();
      } else {
        toast.error(res.error || "Güncelleme sırasında hata oluştu.");
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Beklenmeyen hata."));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper formatters
  const formatUSD = (val: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatUpdatedAt = (value: Date | string | null) => {
    return value ? new Date(value).toLocaleString("tr-TR") : "Girilmemiş";
  };

  const formatPercent = (revenue: number, gp: number) => {
    if (revenue <= 0) return "0.0%";
    return `${((gp / revenue) * 100).toFixed(1)}%`;
  };

  // Calculate live GP%
  const calculateLiveGPPercent = () => {
    const revenue = parseFloat(backlogInput);
    const gp = parseFloat(invoicedInput);
    if (isNaN(revenue) || isNaN(gp) || revenue <= 0) return "0.0%";
    return formatPercent(revenue, gp);
  };

  // Totals calculations
  const totalRevenue = actuals.reduce((sum, item) => sum + item.backlog, 0);
  const totalGP = actuals.reduce((sum, item) => sum + item.invoiced, 0);
  const totalGPPercent = totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0;

  const managerGroups = useMemo<ManagerActualGroup[]>(() => {
    const groupMap = new Map<string, ManagerActualGroup>();

    for (const row of actuals) {
      const groupId = row.managerId ?? "unassigned";
      const managerName = row.managerName ?? "Atanmamış";
      const existing = groupMap.get(groupId);

      if (existing) {
        existing.rows.push(row);
        existing.backlog += row.backlog;
        existing.invoiced += row.invoiced;
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
        backlog: row.backlog,
        invoiced: row.invoiced,
        latestUpdatedAt: row.updatedAt,
      });
    }

    return Array.from(groupMap.values()).sort((a, b) =>
      a.managerName.localeCompare(b.managerName, "tr")
    );
  }, [actuals]);

  const toggleManager = (managerId: string) => {
    setExpandedManagers((current) => ({
      ...current,
      [managerId]: !(current[managerId] ?? true),
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

      const result = await importBacklogFromXls(formData, fiscalYear, quarter, weekNumber);
      if (!result.success) {
        toast.error(result.error || "XLS yükleme sırasında hata oluştu.");
        return;
      }

      const skippedDuplicateCount = result.skippedDuplicateCount ?? 0;
      toast.success(`${result.importedCount} Revenue/GP satırı yüklendi.`);
      if (skippedDuplicateCount > 0) {
        toast.info(`${skippedDuplicateCount} tekrar eden satır mevcut vendor toplamına eklendi.`);
      }
      if (result.skippedVendorCount && result.skippedVendorCount > 0) {
        const vendorList = result.skippedVendors?.join(", ");
        toast.warning(
          `${result.skippedVendorCount} vendor eşleşmediği için atlandı${vendorList ? `: ${vendorList}` : ""}.`
        );
      }
      setIsBulkUploadModalOpen(false);
      setBulkFile(null);
      setBulkFileName("");
      await loadActuals();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "XLS yükleme sırasında hata oluştu."));
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  const isPeriodLocked = actuals.length > 0 && actuals[0].isPeriodLocked;

  const fiscalYearsRange = [
    currentContext.fiscalYear - 1,
    currentContext.fiscalYear,
    currentContext.fiscalYear + 1,
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Title & Period selections */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400 font-serif">
            Backlog
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-sans">
            Vendor bazlı haftalık Revenue, GP ve GP% verilerini takip edin.
          </p>
        </div>

        {/* Period Selector dropdowns */}
        <div className="flex items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-lg shadow-sm shrink-0">
          <Calendar className="h-4 w-4 text-emerald-600 shrink-0" />
          
          <div className="flex items-center gap-1.5">
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

          <div className="flex items-center gap-1.5">
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

          <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-700" />

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500 font-sans">Hafta:</span>
            <Select
              value={weekNumber.toString()}
              onValueChange={(val) => { if (val) setWeekNumber(parseInt(val)); }}
            >
              <SelectTrigger className="h-8 w-24 border-slate-200 text-xs font-medium focus:outline-none">
                <SelectValue placeholder="Hafta" />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                {Array.from({ length: 13 }, (_, i) => i + 1).map((w) => (
                  <SelectItem key={w} value={w.toString()} className="text-xs font-sans">
                    Hafta {w}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Locked period warning */}
      {isPeriodLocked && (
        <div className="flex items-center gap-2.5 p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg text-red-800 dark:text-red-300 text-sm font-sans font-medium">
          <LockKeyhole className="h-5 w-5 text-red-600 shrink-0" />
          <span>Bu mali çeyrek kilitlenmiştir. Dönem üzerindeki tüm Revenue/GP verileri salt okunur durumdadır.</span>
        </div>
      )}

      {/* Summary totals */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Revenue */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-sans">
              {user?.role === "DIREKTOR" ? "Toplam Revenue (Tüm)" : "Toplam Revenue (Sizin)"}
            </span>
            <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-sans">
              {formatUSD(totalRevenue)}
            </h3>
          </div>
          <div className="h-10 w-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Briefcase className="h-5 w-5" />
          </div>
        </div>

        {/* Total GP */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-sans">
              {user?.role === "DIREKTOR" ? "Toplam GP (Tüm)" : "Toplam GP (Sizin)"}
            </span>
            <h3 className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-sans">
              {formatUSD(totalGP)}
            </h3>
          </div>
          <div className="h-10 w-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Receipt className="h-5 w-5" />
          </div>
        </div>

        {/* GP Percent */}
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

      {/* Backlog Table */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="h-40 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            <span className="ml-2 text-slate-500 font-sans font-medium">Veriler yükleniyor...</span>
          </div>
        ) : actuals.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center text-slate-500 font-sans">
            <Coins className="h-10 w-10 text-slate-300 mb-2" />
            <span>Bu hafta için yetkilendirilmiş vendor bulunamadı.</span>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
              <TableRow>
                <TableHead className="font-semibold text-slate-700 dark:text-slate-300">Satış Müdürü / Vendor</TableHead>
                <TableHead className="text-right font-semibold text-slate-700 dark:text-slate-300">Revenue (USD)</TableHead>
                <TableHead className="text-right font-semibold text-slate-700 dark:text-slate-300">GP (USD)</TableHead>
                <TableHead className="text-right font-semibold text-slate-700 dark:text-slate-300 w-32">GP%</TableHead>
                <TableHead className="text-center font-semibold text-slate-700 dark:text-slate-300 w-44">Son Güncelleme</TableHead>
                <TableHead className="text-right font-semibold text-slate-700 dark:text-slate-300 w-32">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {managerGroups.map((group) => {
                const isExpanded = expandedManagers[group.id] ?? false;
                const ToggleIcon = isExpanded ? ChevronDown : ChevronRight;
                return (
                  <React.Fragment key={group.id}>
                    <TableRow
                      aria-expanded={isExpanded}
                      className="bg-slate-50/80 hover:bg-slate-100/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/60"
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
                      <TableCell className="text-right font-mono text-xs font-bold">{formatUSD(group.backlog)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold">{formatUSD(group.invoiced)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-bold text-emerald-800 dark:text-emerald-400">
                        {formatPercent(group.backlog, group.invoiced)}
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
                          <TableCell className="text-right font-mono text-xs">{formatUSD(row.backlog)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatUSD(row.invoiced)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold text-emerald-800 dark:text-emerald-400">
                            {formatPercent(row.backlog, row.invoiced)}
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
              <TableRow className="bg-slate-50/70 hover:bg-slate-50/70 dark:bg-slate-800/30 dark:hover:bg-slate-800/30 font-bold border-t-2 border-slate-200 dark:border-slate-800">
                <TableCell>GENEL TOPLAM</TableCell>
                <TableCell className="text-right font-mono text-xs">{formatUSD(totalRevenue)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{formatUSD(totalGP)}</TableCell>
                <TableCell className="text-right font-mono text-xs text-emerald-800 dark:text-emerald-400">
                  {totalRevenue > 0 ? `${totalGPPercent.toFixed(1)}%` : "0.0%"}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>

      {/* Bulk XLS Upload */}
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

      {/* Bulk XLS Upload dialog */}
      <Dialog open={isBulkUploadModalOpen} onOpenChange={setIsBulkUploadModalOpen}>
        <DialogContent className="sm:max-w-lg bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1F3A2E] dark:text-emerald-400 text-xl font-bold">
              XLS Bulk Yükleme
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-sans text-xs">
              FY{fiscalYear} - Q{quarter} - Hafta {weekNumber} Revenue/GP verileri için XLS veya XLSX dosyası seçin.
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
                htmlFor="actuals-bulk-file"
                className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Upload className="h-4 w-4" />
                Dosya Seç
              </Label>
              <Input
                id="actuals-bulk-file"
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

      {/* Actual Upsert Dialog */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="font-serif text-[#1F3A2E] dark:text-emerald-400 text-xl font-bold">
              {isPeriodLocked ? "Revenue/GP Detayı" : "Haftalık Revenue/GP Gir"}
            </DialogTitle>
            <DialogDescription className="text-slate-500 font-sans text-xs">
              <strong className="text-slate-800 dark:text-slate-200 font-sans">{selectedVendor?.vendorName}</strong> vendor kaydı için FY{fiscalYear} - Q{quarter} - Hafta {weekNumber} verisi.
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
              <Label htmlFor="actual-backlog" className="text-slate-700 dark:text-slate-300 font-medium">Revenue Değeri (USD)</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
                <Input
                  id="actual-backlog"
                  type="number"
                  step="any"
                  value={backlogInput}
                  onChange={(e) => setBacklogInput(e.target.value)}
                  disabled={isSubmitting || isPeriodLocked}
                  placeholder="0.00"
                  className="pl-7 border-slate-200 focus-visible:ring-emerald-700 font-sans"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="actual-invoiced" className="text-slate-700 dark:text-slate-300 font-medium">GP Değeri (USD)</Label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-400 text-sm">$</span>
                <Input
                  id="actual-invoiced"
                  type="number"
                  step="any"
                  value={invoicedInput}
                  onChange={(e) => setInvoicedInput(e.target.value)}
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
