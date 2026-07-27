"use client";

import React, { useEffect, useState, useCallback } from "react";
import { getCurrentFiscalContext } from "@/lib/fiscal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  FileSpreadsheet,
  Users2,
  AlertTriangle,
  Loader2,
  Upload,
  Building2,
  Coins,
  CalendarX,
  UserCheck,
  ShieldAlert,
} from "lucide-react";
import { CrmAuditDialog } from "@/components/scorecard/crm-audit-dialog";
import { VendorMappingDialog, UnmatchedBrand, AvailableVendor } from "@/components/scorecard/vendor-mapping-dialog";
import { CrmAuditDeal } from "@/lib/crm/tdsynnex-parser";
import {
  uploadCrmExcelAction,
  getManagerScorecardsAction,
  getVendorScorecardsAction,
} from "@/app/(app)/forecast-input/actions";
import { getManagerProfileCards, type ManagerProfileCard } from "./actions";
import { ManagerIdentityCard } from "@/components/scorecard/manager-identity-card";

interface ScorecardManagerItem {
  id: string;
  managerName: string;
  weightedCrmPipeline: number;
  rawCrmPipeline: number;
  tryWeightedPipeline?: number;
  tryRawPipeline?: number;
  tryDealCount?: number;
  overdueCount: number;
  crmHealthScore: number;
  forecastAccuracy: number;
  revenueAch: number;
  gpAch: number;
  overallScore: number;
  managerComment: string | null;
  crmAuditJson?: string | null;
}

interface ScorecardVendorItem {
  id: string;
  vendorName: string;
  vendorId: string | null;
  weightedCrmPipeline: number;
  rawCrmPipeline: number;
  tryWeightedPipeline?: number;
  tryRawPipeline?: number;
  tryDealCount?: number;
  overdueCount: number;
  crmHealthScore: number;
  totalDeals: number;
  crmAuditJson?: string | null;
}

function formatUSD(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTRY(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function ScorecardPage() {
  const currentContext = getCurrentFiscalContext();
  const [fiscalYear, setFiscalYear] = useState<number>(currentContext.fiscalYear);
  const [quarter, setQuarter] = useState<number>(currentContext.quarter);
  const [weekNumber, setWeekNumber] = useState<number>(currentContext.weekInQuarter);

  const [activeTab, setActiveTab] = useState<"vendors" | "managers">("vendors");

  const [isLoading, setIsLoading] = useState(true);
  const [managerScorecards, setManagerScorecards] = useState<ScorecardManagerItem[]>([]);
  const [vendorScorecards, setVendorScorecards] = useState<ScorecardVendorItem[]>([]);
  const [managerProfiles, setManagerProfiles] = useState<ManagerProfileCard[]>([]);
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null);

  // CRM Modal & Audit States
  const [isCrmUploadModalOpen, setIsCrmUploadModalOpen] = useState(false);
  const [crmFile, setCrmFile] = useState<File | null>(null);
  const [isCrmSubmitting, setIsCrmSubmitting] = useState(false);
  const [targetUploadWeek, setTargetUploadWeek] = useState<number>(currentContext.weekInQuarter);
  const [activeAuditCategory, setActiveAuditCategory] = useState<"OVERDUE" | "CURRENCY_CONFLICT" | "ZERO_INVOICING" | "UNASSIGNED_BRAND" | null>(null);

  const allAuditDeals = React.useMemo(() => {
    const dealMap = new Map<string, CrmAuditDeal>();
    managerScorecards.forEach((m: any) => {
      if (m.crmAuditJson) {
        try {
          const parsed: CrmAuditDeal[] = JSON.parse(m.crmAuditJson);
          parsed.forEach((d) => dealMap.set(d.code, d));
        } catch (e) {}
      }
    });
    vendorScorecards.forEach((v: any) => {
      if (v.crmAuditJson) {
        try {
          const parsed: CrmAuditDeal[] = JSON.parse(v.crmAuditJson);
          parsed.forEach((d) => {
            if (!dealMap.has(d.code)) dealMap.set(d.code, d);
          });
        } catch (e) {}
      }
    });
    return Array.from(dealMap.values());
  }, [managerScorecards, vendorScorecards]);

  const auditCounts = React.useMemo(() => {
    let overdue = 0;
    let currencyConflict = 0;
    let zeroInvoicing = 0;
    let unassigned = 0;

    allAuditDeals.forEach((d) => {
      if (d.issues.includes("OVERDUE")) overdue++;
      if (d.issues.includes("CURRENCY_CONFLICT")) currencyConflict++;
      if (d.issues.includes("ZERO_INVOICING")) zeroInvoicing++;
      if (d.issues.includes("UNASSIGNED_BRAND")) unassigned++;
    });

    return { overdue, currencyConflict, zeroInvoicing, unassigned };
  }, [allAuditDeals]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [mgrRes, vndRes, profileRes] = await Promise.all([
        getManagerScorecardsAction(fiscalYear, quarter, weekNumber),
        getVendorScorecardsAction(fiscalYear, quarter, weekNumber),
        getManagerProfileCards(fiscalYear, quarter, weekNumber),
      ]);
      setManagerScorecards(mgrRes);
      setVendorScorecards(vndRes);
      setManagerProfiles(profileRes);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Veriler yüklenirken hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  }, [fiscalYear, quarter, weekNumber]);

  useEffect(() => {
    let active = true;
    Promise.all([
      getManagerScorecardsAction(fiscalYear, quarter, weekNumber),
      getVendorScorecardsAction(fiscalYear, quarter, weekNumber),
      getManagerProfileCards(fiscalYear, quarter, weekNumber),
    ])
      .then(([mgrRes, vndRes, profileRes]) => {
        if (!active) return;
        setManagerScorecards(mgrRes);
        setVendorScorecards(vndRes);
        setManagerProfiles(profileRes);
      })
      .catch((err: unknown) => {
        if (!active) return;
        toast.error(err instanceof Error ? err.message : "Veriler yüklenirken hata oluştu.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fiscalYear, quarter, weekNumber]);

  // Vendor Mapping Modal States
  const [unmatchedBrands, setUnmatchedBrands] = useState<UnmatchedBrand[]>([]);
  const [availableVendors, setAvailableVendors] = useState<AvailableVendor[]>([]);
  const [isMappingDialogOpen, setIsMappingDialogOpen] = useState(false);

  const [lastTrySummary, setLastTrySummary] = useState<{ dealCount: number; rawPipeline: number; warningNotice: string | null } | null>(null);

  const executeUploadWithMappings = async (
    mappings: { excelBrand: string; targetVendorId: string }[],
    skipMappingCheck: boolean = false
  ) => {
    if (!crmFile) return;
    setIsCrmSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", crmFile);
      formData.append("fiscalYear", fiscalYear.toString());
      formData.append("quarter", quarter.toString());
      formData.append("weekNumber", targetUploadWeek.toString());

      const res = await uploadCrmExcelAction(
        formData,
        fiscalYear,
        quarter,
        targetUploadWeek,
        mappings.length > 0 ? JSON.stringify(mappings) : undefined,
        skipMappingCheck
      );

      if (res.requiresMapping) {
        setUnmatchedBrands(res.unmatchedBrands || []);
        setAvailableVendors(res.availableVendors || []);
        setIsMappingDialogOpen(true);
      } else if (res.success) {
        toast.success(
          `CRM Excel başarıyla işlendi! ${res.processedCount} fırsat kaydı kaydedildi.`
        );
        if (res.trySummary && res.trySummary.dealCount > 0) {
          setLastTrySummary({
            dealCount: res.trySummary.dealCount,
            rawPipeline: res.trySummary.rawPipeline,
            warningNotice: res.trySummary.warningNotice,
          });
          toast.warning(res.trySummary.warningNotice, { duration: 6000 });
        } else {
          setLastTrySummary(null);
        }
        setIsCrmUploadModalOpen(false);
        setIsMappingDialogOpen(false);
        setCrmFile(null);
        void loadData();
      } else {
        toast.error(res.error || "CRM Excel işlenirken bir hata oluştu.");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Yükleme sırasında hata oluştu.");
    } finally {
      setIsCrmSubmitting(false);
    }
  };

  const handleCrmUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeUploadWithMappings([]);
  };

  const handleConfirmMappings = async (
    mappings: { excelBrand: string; targetVendorId: string }[],
    skipRemaining?: boolean
  ) => {
    await executeUploadWithMappings(mappings, true);
  };

  const totalWeightedPipeline = vendorScorecards.reduce((acc, v) => acc + v.weightedCrmPipeline, 0);
  const totalRawPipeline = vendorScorecards.reduce((acc, v) => acc + v.rawCrmPipeline, 0);
  const totalTryRawPipeline = vendorScorecards.reduce((acc, v) => acc + (v.tryRawPipeline || 0), 0);
  const totalTryDealCount = vendorScorecards.reduce((acc, v) => acc + (v.tryDealCount || 0), 0);
  const totalOverdueCount = vendorScorecards.reduce((acc, v) => acc + v.overdueCount, 0);
  const avgHealthScore =
    vendorScorecards.length > 0
      ? Math.round(vendorScorecards.reduce((acc, v) => acc + v.crmHealthScore, 0) / vendorScorecards.length)
      : 100;

  return (
    <div className="space-y-6">
      {/* Satış müdürü kimlik kartı ve seçici şerit. Değerler karne tablosundan
          değil, dönemin forecast/hedef/kapanış kayıtlarından hesaplanır. */}
      <ManagerIdentityCard
        managers={managerProfiles}
        selectedUserId={selectedManagerId}
        onSelect={setSelectedManagerId}
        periodLabel={`FY${fiscalYear} Q${quarter} · ${weekNumber}. Hafta`}
      />

      <hr className="border-slate-200 dark:border-slate-800" />

      {/* Active Period Info Alert Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
        <div className="flex items-center gap-2">
          <Badge className="bg-[#1F3A2E] text-white hover:bg-[#1F3A2E] font-bold text-[10px]">
            Ana Değerlendirme Dönemi
          </Badge>
          <span>
            Aktif Dönem: <strong>FY{currentContext.fiscalYear} - Q{currentContext.quarter} ({currentContext.weekInQuarter}. Hafta)</strong>
          </span>
        </div>
        <span className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1 sm:mt-0 font-medium">
          Tüm çeyrek verileri görüntülenebilir; ana performans değerlendirmesi aktif çeyrek baz alınarak hesaplanır.
        </span>
      </div>

      {/* TRY Warning Alert Banner if TRY items uploaded or present in period */}
      {(lastTrySummary?.dealCount || totalTryDealCount > 0) ? (
        <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              <strong>Kur Uyarısı:</strong> Seçilen dönemde <strong>{totalTryDealCount || lastTrySummary?.dealCount} adet TL (TRY)</strong> fırsat tespit edildi. Toplam TL Ham Ciro: <strong>{formatTRY(totalTryRawPipeline || lastTrySummary?.rawPipeline || 0)}</strong>. Bu işler USD cinsinden ana pipeline'a dahil edilmemiş, ayrıştırılmıştır.
            </span>
          </div>
          {lastTrySummary && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setLastTrySummary(null)}
              className="h-6 text-[10px] text-amber-800 hover:bg-amber-100"
            >
              Kapat
            </Button>
          )}
        </div>
      ) : null}

      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-[#1F3A2E] dark:text-emerald-400 flex items-center gap-2.5">
            <FileSpreadsheet className="h-6 w-6 text-emerald-700 dark:text-emerald-400" />
            Satış Müdürü Karneleri & CRM Analizi
          </h1>
          <p className="text-xs text-slate-500 font-sans mt-0.5">
            Haftalık CS1_TDSYNNEX CRM Excel raporuna göre Marka ve Satış Müdürü bazlı fırsat büyüklükleri ve hijyen takibi.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Period Selector */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <Select value={fiscalYear.toString()} onValueChange={(v) => v && setFiscalYear(parseInt(v, 10))}>
              <SelectTrigger className="h-8 w-24 border-0 text-xs font-semibold focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                {[currentContext.fiscalYear - 1, currentContext.fiscalYear, currentContext.fiscalYear + 1].map((fy) => (
                  <SelectItem key={fy} value={fy.toString()} className="text-xs">
                    FY{fy} {fy === currentContext.fiscalYear ? "(Aktif)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-slate-300">|</span>

            <Select value={quarter.toString()} onValueChange={(v) => v && setQuarter(parseInt(v, 10))}>
              <SelectTrigger className="h-8 w-24 border-0 text-xs font-semibold focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                {[1, 2, 3, 4].map((q) => (
                  <SelectItem key={q} value={q.toString()} className="text-xs">
                    Q{q} {q === currentContext.quarter && fiscalYear === currentContext.fiscalYear ? "(Aktif)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-slate-300">|</span>

            <Select value={weekNumber.toString()} onValueChange={(v) => v && setWeekNumber(parseInt(v, 10))}>
              <SelectTrigger className="h-8 w-28 border-0 text-xs font-semibold focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                {Array.from({ length: 13 }, (_, i) => i + 1).map((w) => (
                  <SelectItem key={w} value={w.toString()} className="text-xs">
                    {w}. Hafta
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            onClick={() => setIsCrmUploadModalOpen(true)}
            className="h-9 bg-[#1F3A2E] text-white hover:bg-[#2E5A43] text-xs font-bold gap-1.5 shadow-xs"
          >
            <Upload className="h-4 w-4" /> CRM Excel Yükle
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${totalTryDealCount > 0 ? "lg:grid-cols-5" : "lg:grid-cols-4"} gap-4`}>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Topl. Ağırlıklı CRM ($)</span>
          <h3 className="mt-1 font-mono text-xl font-extrabold text-emerald-800 dark:text-emerald-300">
            {formatUSD(totalWeightedPipeline)}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Win rate & Invoicing çarpanlı net değer</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Ham CRM Pipeline ($)</span>
          <h3 className="mt-1 font-mono text-xl font-bold text-slate-700 dark:text-slate-200">
            {formatUSD(totalRawPipeline)}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Çarpan uygulanmamış ham USD ciro</p>
        </div>

        {totalTryDealCount > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-xs dark:border-amber-900/40 dark:bg-amber-950/40">
            <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">Ayrıştırılan TL (TRY) Ciro</span>
            <h3 className="mt-1 font-mono text-xl font-bold text-amber-900 dark:text-amber-300">
              {formatTRY(totalTryRawPipeline)}
            </h3>
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">{totalTryDealCount} adet TL fırsat (USD'den muaf)</p>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Günü Geçmiş Açık İşler</span>
          <h3 className="mt-1 font-mono text-xl font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="h-5 w-5" /> {totalOverdueCount} Açık Fırsat
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Temizlenmesi gereken geçmiş tarihli işler</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Ort. CRM Hijyen Skoru</span>
          <h3 className="mt-1 font-mono text-xl font-extrabold text-emerald-700 dark:text-emerald-400">
            %{avgHealthScore}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Hijyen bazı 100 puan üzerinden</p>
        </div>
      </div>

      {/* Interactive Hygiene & Audit Cards */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Haftalık CRM Hijyen & Denetim Kartları
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">Detaylı listeyi görmek için kartlara tıklayın</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <button type="button" onClick={() => setActiveAuditCategory("OVERDUE")} className="flex items-center justify-between p-3.5 rounded-xl border border-red-200 bg-red-50/60 hover:bg-red-100/80 transition-all text-left group dark:border-red-900/40 dark:bg-red-950/30">
            <div><span className="text-[11px] font-bold text-red-800 block">🔴 Günü Geçmiş İşler</span></div>
            <div className="font-mono text-lg font-black text-red-700">{auditCounts.overdue || totalOverdueCount}</div>
          </button>
          <button type="button" onClick={() => setActiveAuditCategory("CURRENCY_CONFLICT")} className="flex items-center justify-between p-3.5 rounded-xl border border-amber-200 bg-amber-50/60 hover:bg-amber-100/80 transition-all text-left group dark:border-amber-900/40 dark:bg-amber-950/30">
            <div><span className="text-[11px] font-bold text-amber-800 block">🔀 Kur Çelişkisi</span></div>
            <div className="font-mono text-lg font-black text-amber-700">{auditCounts.currencyConflict}</div>
          </button>
          <button type="button" onClick={() => setActiveAuditCategory("ZERO_INVOICING")} className="flex items-center justify-between p-3.5 rounded-xl border border-orange-200 bg-orange-50/60 hover:bg-orange-100/80 transition-all text-left group dark:border-orange-900/40 dark:bg-orange-950/30">
            <div><span className="text-[11px] font-bold text-orange-800 block">⚠️ Faturalanma %0</span></div>
            <div className="font-mono text-lg font-black text-orange-700">{auditCounts.zeroInvoicing}</div>
          </button>
          <button type="button" onClick={() => setActiveAuditCategory("UNASSIGNED_BRAND")} className="flex items-center justify-between p-3.5 rounded-xl border border-blue-200 bg-blue-50/60 hover:bg-blue-100/80 transition-all text-left group dark:border-blue-900/40 dark:bg-blue-950/30">
            <div><span className="text-[11px] font-bold text-blue-800 block">🛠️ Atanmamış Marka</span></div>
            <div className="font-mono text-lg font-black text-blue-700">{auditCounts.unassigned}</div>
          </button>
        </div>
      </div>

      {activeAuditCategory && (
        <CrmAuditDialog
          isOpen={!!activeAuditCategory}
          onClose={() => setActiveAuditCategory(null)}
          title={
            activeAuditCategory === "OVERDUE"
              ? "🔴 Günü Geçmiş Açık Fırsatlar"
              : activeAuditCategory === "CURRENCY_CONFLICT"
              ? "🔀 Kur Çelişkisi Olan Fırsatlar (USD vs TL)"
              : activeAuditCategory === "ZERO_INVOICING"
              ? "⚠️ Faturalanma İhtimali %0 Olan Pasif Fırsatlar"
              : "🛠️ Satış Müdürü Atanmamış Markaların Fırsatları"
          }
          description="İlgili kategorideki fırsatların detaylı listesi. Sütun başlıklarına tıklayarak Account Manager (OWNER) ve tutara göre sıralama yapabilirsiniz."
          category={activeAuditCategory}
          deals={allAuditDeals}
        />
      )}

      {/* Interactive Tabs Header */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("vendors")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === "vendors"
              ? "bg-[#1F3A2E] text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Building2 className="h-4 w-4" /> Marka Bazlı Dağılım ({vendorScorecards.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("managers")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
            activeTab === "managers"
              ? "bg-[#1F3A2E] text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Users2 className="h-4 w-4" /> Satış Müdürleri Karnesi ({managerScorecards.length})
        </button>
      </div>

      {/* Tab Content 1: Marka Bazlı Dağılım */}
      {activeTab === "vendors" && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
            </div>
          ) : vendorScorecards.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Seçilen hafta ({weekNumber}. Hafta) için henüz CRM verisi yüklenmemiş.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-50 dark:bg-slate-800/60">
                <TableRow>
                  <TableHead className="w-12 text-center font-bold">#</TableHead>
                  <TableHead>Marka (Vendor)</TableHead>
                  <TableHead className="text-right">Topl. Fırsat</TableHead>
                  <TableHead className="text-right font-bold">Ağırlıklı CRM ($)</TableHead>
                  <TableHead className="text-right">Ham Pipeline ($)</TableHead>
                  {totalTryDealCount > 0 && <TableHead className="text-right text-amber-700 dark:text-amber-400">TL Pipeline (₺)</TableHead>}
                  <TableHead className="text-center">Günü Geçmiş İş</TableHead>
                  <TableHead className="text-right">CRM Hijyen Skoru</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendorScorecards
                  .slice()
                  .sort((a, b) => b.weightedCrmPipeline - a.weightedCrmPipeline)
                  .map((v, idx) => (
                    <TableRow key={v.id || v.vendorName} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <TableCell className="text-center font-mono text-xs font-bold text-slate-400">{idx + 1}</TableCell>
                      <TableCell className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                        {v.vendorName}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-600 dark:text-slate-400">{v.totalDeals} Fırsat</TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-800 dark:text-emerald-300">
                        {formatUSD(v.weightedCrmPipeline)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                        {formatUSD(v.rawCrmPipeline)}
                      </TableCell>
                      {totalTryDealCount > 0 && (
                        <TableCell className="text-right font-mono text-xs font-medium text-amber-800 dark:text-amber-300">
                          {(v.tryDealCount || 0) > 0 ? formatTRY(v.tryRawPipeline || 0) : "-"}
                        </TableCell>
                      )}
                      <TableCell className="text-center font-mono text-xs">
                        {v.overdueCount > 0 ? (
                          <Badge variant="outline" className="border-red-300 bg-red-50 text-red-800 font-bold dark:border-red-800 dark:bg-red-950/60 dark:text-red-300">
                            {v.overdueCount} İş
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px]">Temiz</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-sm">
                        <span className={v.crmHealthScore < 80 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}>
                          %{v.crmHealthScore}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* Tab Content 2: Satış Müdürleri Karnesi */}
      {activeTab === "managers" && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
            </div>
          ) : managerScorecards.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Seçilen hafta için henüz Satış Müdürü verisi yüklenmemiş.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-50 dark:bg-slate-800/60">
                <TableRow>
                  <TableHead className="w-12 text-center font-bold">#</TableHead>
                  <TableHead>Satış Müdürü</TableHead>
                  <TableHead className="text-right font-bold">Ağırlıklı CRM ($)</TableHead>
                  <TableHead className="text-right">Ham Pipeline ($)</TableHead>
                  {totalTryDealCount > 0 && <TableHead className="text-right text-amber-700 dark:text-amber-400">TL Pipeline (₺)</TableHead>}
                  <TableHead className="text-center">Günü Geçmiş İş</TableHead>
                  <TableHead className="text-right">CRM Sağlık Skoru</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managerScorecards
                  .slice()
                  .sort((a, b) => b.weightedCrmPipeline - a.weightedCrmPipeline)
                  .map((m, idx) => (
                    <TableRow key={m.id || m.managerName} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <TableCell className="text-center font-mono text-xs font-bold text-slate-400">{idx + 1}</TableCell>
                      <TableCell className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <Users2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                        {m.managerName}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-800 dark:text-emerald-300">
                        {formatUSD(m.weightedCrmPipeline)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                        {formatUSD(m.rawCrmPipeline)}
                      </TableCell>
                      {totalTryDealCount > 0 && (
                        <TableCell className="text-right font-mono text-xs font-medium text-amber-800 dark:text-amber-300">
                          {(m.tryDealCount || 0) > 0 ? formatTRY(m.tryRawPipeline || 0) : "-"}
                        </TableCell>
                      )}
                      <TableCell className="text-center font-mono text-xs">
                        {m.overdueCount > 0 ? (
                          <Badge variant="outline" className="border-red-300 bg-red-50 text-red-800 font-bold dark:border-red-800 dark:bg-red-950/60 dark:text-red-300">
                            {m.overdueCount} İş
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px]">Temiz</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-sm">
                        <span className={m.crmHealthScore < 80 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}>
                          %{m.crmHealthScore}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* CRM Excel Upload Modal */}
      <Dialog open={isCrmUploadModalOpen} onOpenChange={setIsCrmUploadModalOpen}>
        <DialogContent className="sm:max-w-md border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-serif text-xl font-bold text-[#1F3A2E] dark:text-emerald-400">
              <FileSpreadsheet className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
              CRM Excel Yükleme (CS1_TDSYNNEX)
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Haftalık CRM Fırsat raporunu (CS1_TDSYNNEX...xlsx) yükleyerek Marka ve Satış Müdürü Ağırlıklı CRM Pipeline verilerini güncelleyin.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCrmUploadSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Hedef Hafta</Label>
              <Select value={targetUploadWeek.toString()} onValueChange={(val) => val && setTargetUploadWeek(parseInt(val, 10))}>
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

      {/* Interactive Vendor/Brand Mapping Dialog */}
      <VendorMappingDialog
        isOpen={isMappingDialogOpen}
        onClose={() => setIsMappingDialogOpen(false)}
        unmatchedBrands={unmatchedBrands}
        availableVendors={availableVendors}
        onConfirmMappings={handleConfirmMappings}
        isSubmitting={isCrmSubmitting}
      />
    </div>
  );
}
