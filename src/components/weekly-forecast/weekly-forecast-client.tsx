"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  FileSpreadsheet,
  Filter,
  Loader2,
  Lock,
  Save,
  Users2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/multi-select-filter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  aggregateContexts,
  aggregateInputs,
  computeForecast,
  type ForecastContext,
} from "@/lib/weekly-forecast/calc";
import { WIN_RATE_BUCKETS, writePath, type ForecastInputs } from "@/lib/weekly-forecast/schema";
import { formatSheetCurrency } from "@/lib/weekly-forecast/format";
import { getCurrentFiscalContext, getQuarterMonthLabels } from "@/lib/fiscal";
import {
  getCrmCrossCheckAction,
  getReportAction,
  saveCellsAction,
  submitWeeklyForecastAction,
} from "@/app/(app)/weekly-forecast/actions";
import {
  aggregateCrmData,
  compareCell,
  type CrmCrossCheck,
  type VendorCrmData,
} from "@/lib/crm/crosscheck-core";
import { ForecastSheet } from "./forecast-sheet";

const TOTAL_TAB_ID = "__total__";

interface SheetReference {
  targetRevenue: number | null;
  targetGp: number | null;
  targetRevenueMonthly: [number, number, number] | null;
  targetGpMonthly: [number, number, number] | null;
  actualInvoiced: number | null;
  actualBacklog: number | null;
  actualWeekNumber: number | null;
}

interface Sheet {
  id: string;
  name: string;
  managerId: string | null;
  managerName: string | null;
  readOnly: boolean;
  inputs: ForecastInputs;
  /** AOP gibi DB kaynaklı değerler; yerel yeniden hesaplama için gerekli. */
  context: ForecastContext;
  reference: SheetReference;
  updatedAt: string | null;
  updatedByName: string | null;
}

const UNASSIGNED = "unassigned";
const NO_CLOSED_MONTHS: [boolean, boolean, boolean] = [false, false, false];

type SaveState = "idle" | "saving" | "saved" | "error";

interface Loaded {
  key: string;
  isLocked: boolean;
  /** Takvim olarak kapanmış aylar [M1,M2,M3] — sunucudan gelir. */
  closedMonths: [boolean, boolean, boolean];
  sheets: Sheet[];
}

export function WeeklyForecastClient() {
  const currentContext = getCurrentFiscalContext();
  const [fiscalYear, setFiscalYear] = useState(currentContext.fiscalYear);
  const [quarter, setQuarter] = useState(currentContext.quarter);
  const [weekNumber, setWeekNumber] = useState(currentContext.weekInQuarter);

  /** Seçili çeyreğin gerçek ay adları — Excel'deki "Month 1/2/3" yerine. */
  const monthLabels = useMemo(
    () => getQuarterMonthLabels(fiscalYear, quarter),
    [fiscalYear, quarter],
  );

  const requestKey = `${fiscalYear}:${quarter}:${weekNumber}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Çoklu seçim filtreleri (Satış Müdürü -> Marka)
  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);

  // CRM çapraz kontrolü — form yüklemesinden BAĞIMSIZ; veri yoksa form yine açılır
  const [crmData, setCrmData] = useState<{ key: string; value: CrmCrossCheck | null } | null>(null);
  const [crmCompareOn, setCrmCompareOn] = useState(false);

  // Kaydet akışı
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // vendorId → bekleyen hücre güncellemeleri
  const pending = useRef(new Map<string, Map<string, number>>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getReportAction(fiscalYear, quarter, weekNumber)
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setLoadError({ key: requestKey, message: result.error });
          return;
        }
        setLoaded({
          key: requestKey,
          isLocked: result.report.isLocked,
          closedMonths: result.report.closedMonths,
          sheets: result.report.sheets
            .filter((sheet) => sheet.id !== TOTAL_TAB_ID)
            .map((sheet) => ({
              id: sheet.id,
              name: sheet.name,
              managerId: sheet.managerId,
              managerName: sheet.managerName,
              readOnly: sheet.readOnly,
              inputs: sheet.inputs,
              context: sheet.context,
              reference: sheet.reference,
              updatedAt: sheet.updatedAt,
              updatedByName: sheet.updatedByName,
            })),
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError({
            key: requestKey,
            message: error instanceof Error ? error.message : "Form verileri yüklenemedi.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fiscalYear, quarter, weekNumber, requestKey]);

  useEffect(() => {
    let cancelled = false;
    void getCrmCrossCheckAction(fiscalYear, quarter, weekNumber)
      .then((result) => {
        if (cancelled) return;
        // Hata veya veri yokluğu formu etkilemez — yalnızca işaret gösterilmez
        setCrmData({ key: requestKey, value: result.success ? result.data : null });
      })
      .catch(() => {
        if (!cancelled) setCrmData({ key: requestKey, value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [fiscalYear, quarter, weekNumber, requestKey]);

  const crm = crmData?.key === requestKey ? crmData.value : null;

  const fresh = loaded?.key === requestKey ? loaded : null;
  const sheets = useMemo(() => fresh?.sheets ?? [], [fresh]);
  const isLocked = fresh?.isLocked ?? false;
  const closedMonths = fresh?.closedMonths ?? NO_CLOSED_MONTHS;

  const setSheets = useCallback((updater: (prev: Sheet[]) => Sheet[]) => {
    setLoaded((prev) => (prev ? { ...prev, sheets: updater(prev.sheets) } : prev));
  }, []);

  const flush = useCallback(async () => {
    const batch = pending.current;
    if (batch.size === 0) return;
    pending.current = new Map();
    setSaveState("saving");

    try {
      for (const [vendorId, cells] of batch) {
        const result = await saveCellsAction({
          vendorId,
          fiscalYear,
          quarter,
          weekNumber,
          updates: [...cells].map(([path, value]) => ({ path, value })),
        });

        if (!result.success) {
          setSaveState("error");
          toast.error(result.error);
          return;
        }

        // sunucudan dönen girdiler Actual ile birleştirilmiş halde gelir
        setSheets((prev) =>
          prev.map((sheet) =>
            sheet.id === vendorId ? { ...sheet, inputs: result.inputs } : sheet,
          ),
        );
      }
      setSaveState("saved");
    } catch (error: unknown) {
      setSaveState("error");
      toast.error(error instanceof Error ? error.message : "Form kaydedilemedi.");
    }
  }, [fiscalYear, quarter, weekNumber, setSheets]);

  const handleCellChange = useCallback(
    (vendorId: string, path: string, value: number) => {
      // 1) anında yerel hesap — Total dahil tüm türetilmiş hücreler güncellenir
      setSheets((prev) =>
        prev.map((sheet) =>
          sheet.id === vendorId ? { ...sheet, inputs: writePath(sheet.inputs, path, value) } : sheet,
        ),
      );
      // 2) kuyruğa al, kısa bir gecikmeyle topluca kaydet
      const cells = pending.current.get(vendorId) ?? new Map<string, number>();
      cells.set(path, value);
      pending.current.set(vendorId, cells);
      setSaveState("saving");
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => void flush(), 600);
    },
    [flush, setSheets],
  );

  // Satış müdürü seçenekleri — yalnızca erişilebilir markalardan türetilir.
  const managerOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const sheet of sheets) {
      const id = sheet.managerId ?? UNASSIGNED;
      const label = sheet.managerName ?? "Atanmamış";
      const existing = map.get(id);
      if (existing) existing.count += 1;
      else map.set(id, { label, count: 1 });
    }
    return [...map.entries()]
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label, "tr"));
  }, [sheets]);

  // Marka seçenekleri, seçili satış müdürlerine göre daraltılır.
  const vendorOptions = useMemo<FilterOption[]>(() => {
    const relevant =
      selectedManagerIds.length > 0
        ? sheets.filter((s) => selectedManagerIds.includes(s.managerId ?? UNASSIGNED))
        : sheets;
    return relevant
      .map((s) => ({ value: s.id, label: s.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "tr"));
  }, [sheets, selectedManagerIds]);

  const visibleSheets = useMemo(
    () =>
      sheets.filter((sheet) => {
        const managerId = sheet.managerId ?? UNASSIGNED;
        const matchesManager =
          selectedManagerIds.length === 0 || selectedManagerIds.includes(managerId);
        const matchesVendor =
          selectedVendorIds.length === 0 || selectedVendorIds.includes(sheet.id);
        return matchesManager && matchesVendor;
      }),
    [sheets, selectedManagerIds, selectedVendorIds],
  );

  const handleManagerChange = (nextManagerIds: string[]) => {
    setSelectedManagerIds(nextManagerIds);
    if (nextManagerIds.length > 0) {
      // Artık görünmeyen markaların seçimini düşür.
      const validVendorIds = sheets
        .filter((s) => nextManagerIds.includes(s.managerId ?? UNASSIGNED))
        .map((s) => s.id);
      setSelectedVendorIds((prev) => prev.filter((id) => validVendorIds.includes(id)));
    }
  };

  const clearAllFilters = () => {
    setSelectedManagerIds([]);
    setSelectedVendorIds([]);
  };

  // Total, ekranda görünen markaların toplamıdır — filtre onu da daraltır.
  const totalInputs = useMemo(
    () => aggregateInputs(visibleSheets.map((s) => s.inputs)),
    [visibleSheets],
  );

  const totalContext = useMemo(
    () => aggregateContexts(visibleSheets.map((s) => s.context)),
    [visibleSheets],
  );

  const totalSheet: Sheet = useMemo(
    () => ({
      id: TOTAL_TAB_ID,
      name: "Total",
      managerId: null,
      managerName: null,
      readOnly: true,
      inputs: totalInputs,
      context: totalContext,
      reference: {
        targetRevenue: sumRef(visibleSheets, "targetRevenue"),
        targetGp: sumRef(visibleSheets, "targetGp"),
        // Aylık üçlüler bağlamdan gelir (aggregateContexts eleman bazında toplar)
        targetRevenueMonthly: totalContext.targetNsbMonthly,
        targetGpMonthly: totalContext.targetNgpMonthly,
        actualInvoiced: sumRef(visibleSheets, "actualInvoiced"),
        actualBacklog: sumRef(visibleSheets, "actualBacklog"),
        actualWeekNumber: null,
      },
      updatedAt: null,
      updatedByName: null,
    }),
    [visibleSheets, totalInputs, totalContext],
  );

  // Seçili sekme filtre dışında kaldıysa ilk görünen markaya, o da yoksa Total'a düş.
  const active = useMemo(() => {
    if (activeId === TOTAL_TAB_ID) return totalSheet;
    return visibleSheets.find((sheet) => sheet.id === activeId) ?? visibleSheets[0] ?? totalSheet;
  }, [activeId, visibleSheets, totalSheet]);

  const computed = useMemo(() => computeForecast(active.inputs, active.context), [active]);

  /**
   * Formu Forecast tablosuna yayınlar.
   *
   * ⚠ Önce `flush()` — hücre kayıtları 600 ms gecikmeli; o pencerede Kaydet'e
   * basılırsa bir ÖNCEKİ sunucu durumu yayınlanırdı. Bu fazın en olası sessiz
   * hata kaynağı.
   */
  const handleSubmit = useCallback(async () => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    await flush();

    setSubmitting(true);
    try {
      const result = await submitWeeklyForecastAction({
        vendorId: active.id,
        fiscalYear,
        quarter,
        weekNumber,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const onceki = result.previous
        ? ` (önceki: ${formatSheetCurrency(result.previous.revenue)} / ${formatSheetCurrency(result.previous.gp)})`
        : "";
      toast.success(
        `FY${fiscalYear}Q${quarter} ${result.weekNumber}. hafta kaydedildi — ` +
          `NSB ${formatSheetCurrency(result.revenue)}, GP ${formatSheetCurrency(result.gp)}${onceki}`,
      );
      setConfirmOpen(false);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Forecast kaydedilemedi.");
    } finally {
      setSubmitting(false);
    }
  }, [active.id, fiscalYear, quarter, weekNumber, flush, setConfirmOpen]);


  /**
   * Aktif sekmenin CRM verisi. Total sekmesinde görünen markaların matrisleri
   * toplanır — `aggregateInputs`'ün form tarafında yaptığının aynısı.
   */
  const activeCrm: VendorCrmData | null = useMemo(() => {
    if (!crm) return null;
    if (active.id === TOTAL_TAB_ID) {
      const list = visibleSheets
        .map((s) => crm.byVendor[s.id])
        .filter((v): v is VendorCrmData => Boolean(v));
      const agg = aggregateCrmData(list);
      return agg.hasData ? agg : null;
    }
    return crm.byVendor[active.id] ?? null;
  }, [crm, active.id, visibleSheets]);

  /** 18 hücrenin (6 kova × 3 ay) kaçı tutuyor — hem özet şeridi hem uyarılar için. */
  const crmOzetAktif = useMemo(() => {
    if (!activeCrm) return null;
    let eslesen = 0;
    let sapan = 0;
    for (const b of WIN_RATE_BUCKETS) {
      const crmRow = activeCrm.usd[b.key];
      const formRow = active.inputs.crm[b.key];
      if (!crmRow) continue;
      for (let m = 0; m < 3; m++) {
        if (crmRow[m] === 0 && formRow[m] === 0) continue;
        if (compareCell(formRow[m], crmRow[m]) === "match") eslesen++;
        else sapan++;
      }
    }
    return { eslesen, sapan, toplam: eslesen + sapan };
  }, [activeCrm, active.inputs]);

  /** ForecastSheet'e verilecek biçim — yalnızca USD matrisi karşılaştırılır. */
  const sheetCrm = useMemo(
    () =>
      activeCrm && crm
        ? { usd: activeCrm.usd, showValues: crmCompareOn, sourceWeek: crm.sourceWeek }
        : null,
    [activeCrm, crm, crmCompareOn],
  );

  /**
   * Kaydetmeyi engellemeyen ama SM'in görmesi gereken durumlar.
   * Bilinçli olarak uyarı — bloklamak yerine bilgilendirip karar bırakıyoruz.
   */
  const submitWarnings = useMemo(() => {
    const list: string[] = [];
    if (computed.targetSource === "QUARTER_ONLY") {
      list.push("Bu marka için aylık hedef kırılımı girilmemiş.");
    }
    if (computed.qNgpTotal > computed.qNsbTotal) {
      list.push("GP toplamı NSB toplamından büyük.");
    }
    if (computed.qNsbTotal < 0 || computed.qNgpTotal < 0) {
      list.push("Toplam negatif — FX veya stok karşılığı kalemlerinden kaynaklanıyor olabilir.");
    }
    if (crmOzetAktif && crmOzetAktif.sapan > 0) {
      list.push(`CRM ile ${crmOzetAktif.sapan} hücrede sapma var.`);
    }
    if (activeCrm && activeCrm.invalidEntries.count > 0) {
      list.push(
        `CRM'de ${activeCrm.invalidEntries.count} hatalı giriş var (%100 kazanma + %0 faturalanma); karşılaştırmaya dahil edilmedi.`,
      );
    }
    return list;
  }, [computed, crmOzetAktif, activeCrm]);


  const fiscalYearsRange = [
    currentContext.fiscalYear - 1,
    currentContext.fiscalYear,
    currentContext.fiscalYear + 1,
  ];

  if (loadError?.key === requestKey) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {loadError.message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-serif text-2xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400">
            Haftalık Detay Formu
          </h2>
          <p className="font-sans text-sm text-slate-500 dark:text-slate-400">
            Marka bazında haftalık forecast formu. Yalnızca sarı hücreler doldurulur; gri
            hücreler otomatik hesaplanır.
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
              <SelectContent className="border-slate-200 bg-white">
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
              <SelectContent className="border-slate-200 bg-white">
                {[1, 2, 3, 4].map((q) => (
                  <SelectItem key={q} value={q.toString()} className="text-xs">
                    Q{q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 border-l border-slate-200 pl-3 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-500">Hafta:</span>
            <Select value={weekNumber.toString()} onValueChange={(value) => setWeekNumber(Number(value))}>
              <SelectTrigger className="h-8 w-36 border-slate-200 text-xs font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64 border-slate-200 bg-white">
                {Array.from({ length: 13 }, (_, i) => i + 1).map((week) => (
                  <SelectItem key={week} value={week.toString()} className="font-sans text-xs">
                    {week}. Hafta
                    {week === currentContext.weekInQuarter ? " (Aktif)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <SaveIndicator state={saveState} />

          {/* Kaydet — formu Forecast tablosuna yayınlar. Total sekmesinde
              gizli; yalnızca içinde bulunulan hafta için etkin. */}
          {active.id !== TOTAL_TAB_ID && (
            <Button
              type="button"
              size="sm"
              disabled={isLocked || active.readOnly || weekNumber !== currentContext.weekInQuarter}
              onClick={() => setConfirmOpen(true)}
              title={
                weekNumber !== currentContext.weekInQuarter
                  ? `Yalnızca içinde bulunulan hafta (${currentContext.weekInQuarter}. hafta) kaydedilebilir`
                  : undefined
              }
              className="h-8 gap-1.5 bg-[#2E5A43] px-3 text-xs font-semibold text-white hover:bg-[#1F3A2E]"
            >
              <Save className="h-3.5 w-3.5" />
              Kaydet
            </Button>
          )}
        </div>
      </div>

      {isLocked && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
          <Lock className="h-4 w-4" />
          Seçilen çeyrek kilitli olduğu için form girişi kapalıdır.
        </div>
      )}

      {/* Kapanan aylar — hücreler sessizce grileşmesin, sebebi yazsın */}
      {!isLocked && closedMonths.some(Boolean) && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <Lock className="h-4 w-4 shrink-0 text-slate-500" />
          <span>
            <strong>
              {closedMonths
                .map((kapali, i) => (kapali ? monthLabels[i] : null))
                .filter(Boolean)
                .join(" ve ")}
            </strong>{" "}
            {closedMonths.filter(Boolean).length > 1 ? "kapandı" : "kapandı"} — bu ayların hücreleri
            düzenlenemez.
            {closedMonths.some((k) => !k) && (
              <>
                {" "}
                Açık ay:{" "}
                <strong>
                  {closedMonths
                    .map((kapali, i) => (kapali ? null : monthLabels[i]))
                    .filter(Boolean)
                    .join(", ")}
                </strong>
                .
              </>
            )}
          </span>
        </div>
      )}

      {/* Çoklu seçim filtre çubuğu (Satış Müdürü -> Marka) */}
      {fresh && sheets.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Filter className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" /> Filtreler:
            </span>

            {/* Tek satış müdürü varsa (SM kendi görünümü) filtre anlamsız olur. */}
            {managerOptions.length > 1 && (
              <MultiSelectFilter
                title="Satış Müdürü"
                options={managerOptions}
                selectedValues={selectedManagerIds}
                onChange={handleManagerChange}
                placeholder="Satış Müdürü ara..."
                icon={<Users2 className="h-3.5 w-3.5 text-slate-500" />}
              />
            )}

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
                className="h-9 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
              >
                <X className="mr-1 h-3.5 w-3.5" /> Filtreleri Temizle
              </Button>
            )}

            {/* CRM karşılaştırma modu — 18 hücreyi tek bakışta taramak için */}
            {crm && (
              <Button
                type="button"
                variant={crmCompareOn ? "default" : "outline"}
                size="sm"
                onClick={() => setCrmCompareOn((v) => !v)}
                className={cn(
                  "h-9 gap-1.5 px-3 text-xs font-semibold",
                  crmCompareOn
                    ? "bg-[#2E5A43] text-white hover:bg-[#1F3A2E]"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50",
                )}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                CRM Karşılaştır
              </Button>
            )}
          </div>

          <div className="text-xs font-medium text-slate-500">
            Gösterilen:{" "}
            <span className="font-bold text-slate-900 dark:text-slate-100">
              {visibleSheets.length}
            </span>{" "}
            / {sheets.length} marka
          </div>
        </div>
      )}

      {!fresh ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
          <span className="ml-2 text-sm font-medium text-slate-500">Form yükleniyor...</span>
        </div>
      ) : sheets.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          <FileSpreadsheet className="mb-2 h-10 w-10 text-slate-300" />
          <span>Sorumlu olduğunuz aktif bir marka bulunamadı.</span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <nav className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 px-3 pt-2 dark:border-slate-800 dark:bg-slate-950/40">
            {visibleSheets.map((sheet) => (
              <Tab
                key={sheet.id}
                label={sheet.name}
                title={sheet.managerName ?? "Satış müdürü atanmamış"}
                active={sheet.id === active.id}
                onClick={() => setActiveId(sheet.id)}
              />
            ))}
            <Tab
              label="Total"
              active={active.id === TOTAL_TAB_ID}
              onClick={() => setActiveId(TOTAL_TAB_ID)}
              className="ml-2"
            />
          </nav>

          <ReferenceBar
            sheet={active}
            computed={computed}
            visibleCount={visibleSheets.length}
            crm={activeCrm}
            crmWeek={crm?.sourceWeek ?? null}
            requestedWeek={weekNumber}
            unmatched={crm?.unmatched ?? []}
            crmOzet={crmOzetAktif}
          />

          <div className="p-3">
            <ForecastSheet
              key={active.id}
              inputs={active.inputs}
              computed={computed}
              monthLabels={monthLabels}
              readOnly={active.readOnly || isLocked}
              closedMonths={closedMonths}
              crm={sheetCrm}
              onCellChange={(path, value) => handleCellChange(active.id, path, value)}
            />
          </div>
        </div>
      )}

      {/* Kaydetme onayı — yayınlanacak rakamı ve varsa uyarıları gösterir */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="border-slate-200 bg-white sm:max-w-lg dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-bold text-[#1F3A2E] dark:text-emerald-400">
              Forecast Kaydet
            </DialogTitle>
            <DialogDescription className="font-sans text-xs text-slate-500">
              <strong className="text-slate-800 dark:text-slate-200">{active.name}</strong> ·
              FY{fiscalYear} Q{quarter} · {weekNumber}. hafta
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-2 rounded-lg bg-slate-50 p-3.5 dark:bg-slate-800/40">
              <div className="flex items-center justify-between">
                <span className="font-sans text-xs font-semibold uppercase text-slate-500">
                  NSB (Forecast + Adjustment)
                </span>
                <span className="font-mono text-sm font-bold text-emerald-800 dark:text-emerald-400">
                  {formatSheetCurrency(computed.qNsbTotal)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-sans text-xs font-semibold uppercase text-slate-500">
                  GP (Forecast + Adjustment)
                </span>
                <span className="font-mono text-sm font-bold text-emerald-800 dark:text-emerald-400">
                  {formatSheetCurrency(computed.qNgpTotal)}
                </span>
              </div>
            </div>

            {submitWarnings.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Dikkat edilmesi gerekenler
                </div>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-900 dark:text-amber-300">
                  {submitWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
                <p className="pt-1 text-[11px] text-amber-800 dark:text-amber-400">
                  Bunlar kaydetmeyi engellemez; yine de kaydedebilirsiniz.
                </p>
              </div>
            )}

            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Bu rakam Forecast Giriş, Dashboard ve raporlarda görünecek. Aynı hafta içinde
              tekrar kaydederek güncelleyebilirsiniz; önceki değer denetim kaydında saklanır.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
              className="border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              İptal
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className="gap-2 bg-[#2E5A43] text-white hover:bg-[#1F3A2E]"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type ScalarRefKey = "targetRevenue" | "targetGp" | "actualInvoiced" | "actualBacklog";

function sumRef(sheets: Sheet[], key: ScalarRefKey) {
  const values = sheets.map((s) => s.reference[key]).filter((v): v is number => v !== null);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
}

/**
 * Hedefler ve Backlog ekranlarındaki kayıtlarla karşılaştırma şeridi.
 * Form bu değerleri ön-doldurur ama SM üzerine yazabildiği için sapma burada görünür.
 */
function ReferenceBar({
  sheet,
  computed,
  visibleCount,
  crm,
  crmWeek,
  requestedWeek,
  unmatched,
  crmOzet,
}: {
  sheet: Sheet;
  computed: ReturnType<typeof computeForecast>;
  visibleCount: number;
  crm: VendorCrmData | null;
  crmWeek: number | null;
  requestedWeek: number;
  unmatched: { vendorName: string; dealCount: number; usd: number }[];
  crmOzet: { eslesen: number; sapan: number; toplam: number } | null;
}) {

  const isTotal = sheet.id === TOTAL_TAB_ID;
  // AOP ve aylık hedefler artık doğrudan Target'tan geldiği için aralarında
  // sapma olamaz; kıyas yalnızca Backlog ekranıyla anlamlı.
  const items: { label: string; reference: number | null; formValue: number; hint?: string }[] = [
    {
      label: "Invoiced NSB (Backlog ekranı)",
      reference: sheet.reference.actualInvoiced,
      formValue: computed.invoicedNsbQ,
      hint: sheet.reference.actualWeekNumber
        ? `${sheet.reference.actualWeekNumber}. hafta kaydı`
        : undefined,
    },
    {
      label: "Backlog NSB (Backlog ekranı)",
      reference: sheet.reference.actualBacklog,
      formValue: computed.backlogNsbQ,
      hint: sheet.reference.actualWeekNumber
        ? `${sheet.reference.actualWeekNumber}. hafta kaydı`
        : undefined,
    },
  ];

  return (
    <div className="space-y-2 border-b border-slate-200 bg-amber-50/60 px-3 py-2 dark:border-slate-800 dark:bg-amber-950/10">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700 dark:text-slate-300">
        {isTotal ? (
          <span>
            <strong>Total</strong> ekranda görünen {visibleCount} markanın toplamıdır ve tamamen
            hesaplanır — hücreler düzenlenemez. Filtre değiştikçe toplam da daralır.
          </span>
        ) : (
          <>
            <span>
              Yalnızca <span className="bg-[#FFFF00] px-1 font-semibold text-slate-900">sarı</span>{" "}
              hücreler doldurulur.{" "}
              <span className="bg-[#D9D9D9] px-1 text-slate-900">Gri</span> hücreler formüllüdür.
              AOP ve aylık hedefler <strong>Hedefler</strong> ekranından gelir.
            </span>
            {sheet.managerName && (
              <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                <Users2 className="h-3.5 w-3.5" />
                {sheet.managerName}
              </span>
            )}
            {sheet.updatedAt && (
              <span className="text-slate-500 dark:text-slate-400">
                Son kayıt: {new Date(sheet.updatedAt).toLocaleString("tr-TR")}
                {sheet.updatedByName ? ` · ${sheet.updatedByName}` : ""}
              </span>
            )}
          </>
        )}
      </div>

      {/* CRM çapraz kontrol özeti */}
      {crm && crmOzet && crmOzet.toplam > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700 dark:text-slate-300">
          <span className="font-medium">
            CRM{crmWeek !== null && crmWeek !== requestedWeek ? ` (${crmWeek}. hafta verisi)` : ""}:{" "}
            <span className="text-emerald-700 dark:text-emerald-400">
              {crmOzet.eslesen}/{crmOzet.toplam} hücre eşleşiyor
            </span>
            {crmOzet.sapan > 0 && (
              <span className="text-amber-700 dark:text-amber-400"> · {crmOzet.sapan} sapma</span>
            )}
          </span>
          {/* Çelişkili giriş: %100 kazanma ama %0 faturalanma — CRM'de düzeltilmeli */}
          {crm.invalidEntries.count > 0 && (
            <span
              className="font-medium text-red-700 dark:text-red-400"
              title="Kazanma oranı %100 olan bir fırsatın faturalanma oranı %0 olamaz. Bu kayıtlar CRM'de düzeltilmeli; karşılaştırmaya dahil edilmediler."
            >
              {crm.invalidEntries.count} hatalı giriş (%100 kazanma + %0 faturalanma,{" "}
              {formatSheetCurrency(crm.invalidEntries.usd)}) — karşılaştırma dışı
            </span>
          )}
          {crm.unbucketed.count > 0 && (
            <span className="text-slate-500 dark:text-slate-400">
              {crm.unbucketed.count} fırsat hiçbir kovaya girmiyor (
              {formatSheetCurrency(crm.unbucketed.usd)})
            </span>
          )}
          {crm.tryDealCount > 0 && (
            <span className="text-slate-500 dark:text-slate-400">
              {crm.tryDealCount} işlem ₺ — karşılaştırmaya dahil değil
            </span>
          )}
          {crm.outOfQuarter.count > 0 && (
            <span className="text-slate-500 dark:text-slate-400">
              {crm.outOfQuarter.count} fırsat çeyrek dışı tarihli
            </span>
          )}
          {crm.unparsedDate > 0 && (
            <span className="text-slate-500 dark:text-slate-400">
              {crm.unparsedDate} fırsatın tarihi okunamadı
            </span>
          )}
          {unmatched.length > 0 && (
            <span className="text-amber-700 dark:text-amber-400">
              CRM&apos;de eşleşmeyen marka: {unmatched.map((u) => u.vendorName).join(", ")}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Aylık hedef kırılımı durumu — eksikse SM nereye bakacağını bilmeli */}
        {computed.targetSource !== "TARGET_MONTHLY" && (
          <Badge
            variant="outline"
            className="gap-1.5 border-amber-300 bg-white text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300"
          >
            <AlertTriangle className="h-3 w-3" />
            {computed.targetSource === "QUARTER_ONLY"
              ? "Aylık hedef kırılımı girilmemiş — Hedefler ekranından girilir"
              : "Aylık hedefler eski form kaydından geliyor — Hedefler ekranından güncellenmeli"}
          </Badge>
        )}
        {items.map((item) => {
          if (item.reference === null) return null;
          const diff = item.formValue - item.reference;
          const matches = Math.abs(diff) < 0.5;
          return (
            <Badge
              key={item.label}
              variant="outline"
              className={cn(
                "gap-1.5 font-mono text-[10px] font-semibold",
                matches
                  ? "border-emerald-300 bg-white text-emerald-900 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300"
                  : "border-amber-300 bg-white text-amber-900 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-300",
              )}
              title={item.hint}
            >
              <span className="font-sans font-medium text-slate-500 dark:text-slate-400">
                {item.label}:
              </span>
              {formatSheetCurrency(item.reference)}
              {!matches && <span>· fark {formatSheetCurrency(diff)}</span>}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

function Tab({
  label,
  active,
  onClick,
  className,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "-mb-px rounded-t border border-b-0 px-3 py-1.5 text-[13px] transition-colors",
        active
          ? "border-slate-300 bg-white font-semibold text-emerald-900 dark:border-slate-700 dark:bg-slate-900 dark:text-emerald-300"
          : "border-transparent bg-transparent text-slate-500 hover:bg-white/70 hover:text-slate-800 dark:hover:bg-slate-900/60 dark:hover:text-slate-200",
        className,
      )}
    >
      {label}
    </button>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Kaydediliyor
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <Save className="h-3.5 w-3.5" /> Kaydedildi
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400">
        <AlertTriangle className="h-3.5 w-3.5" /> Kaydedilemedi
      </span>
    );
  }
  return null;
}
