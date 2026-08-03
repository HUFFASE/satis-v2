"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { getCurrentFiscalContext } from "@/lib/fiscal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
import { toast } from "sonner";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Loader2,
  Building2,
  Users2,
  AlertTriangle,
  Coins,
  ShieldCheck,
  TrendingUp,
  Info,
} from "lucide-react";
import {
  getCrmAnalyticsDataAction,
  SmCrmAnalyticsItem,
  AccountManagerPerformanceItem,
  WeeklyHygieneTrendItem,
} from "./actions";
import { BrandDetailDialog } from "@/components/crm-analytics/brand-detail-dialog";
import { CARD_HOVER_SHADOW, KPI_TILE_SHELL_XL } from "@/components/viz/card-shell";

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

export default function CrmAnalyticsPage() {
  const currentContext = getCurrentFiscalContext();
  const [fiscalYear, setFiscalYear] = useState<number>(currentContext.fiscalYear);
  const [quarter, setQuarter] = useState<number>(currentContext.quarter);
  const [weekNumber, setWeekNumber] = useState<number>(currentContext.weekInQuarter);

  const [isLoading, setIsLoading] = useState(true);
  const [smItems, setSmItems] = useState<SmCrmAnalyticsItem[]>([]);
  const [amList, setAmList] = useState<AccountManagerPerformanceItem[]>([]);
  const [weeklyTrend, setWeeklyTrend] = useState<WeeklyHygieneTrendItem[]>([]);
  const [totalDeals, setTotalDeals] = useState<number>(0);

  // Accordion open state: Set of SM IDs that are expanded
  const [expandedSmIds, setExpandedSmIds] = useState<Set<string>>(new Set());

  // Selected Brand for Dialog Modal
  const [selectedBrand, setSelectedBrand] = useState<{
    vendorName: string;
    totalDeals: number;
    rawPipeline: number;
    tryRawPipeline: number;
    weightedPipeline: number;
    crmHealthScore: number;
    crmAuditJson?: string | null;
  } | null>(null);

  const toggleSmAccordion = (id: string) => {
    setExpandedSmIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getCrmAnalyticsDataAction(fiscalYear, quarter, weekNumber);
      setSmItems(res.smAnalyticsItems);
      setAmList(res.amList);
      setWeeklyTrend(res.weeklyTrend);
      setTotalDeals(res.totalDealsInQuarter);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "CRM Verileri yüklenirken hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  }, [fiscalYear, quarter, weekNumber]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Overall Aggregates
  const totalRawUSD = useMemo(() => smItems.reduce((acc, item) => acc + item.rawPipeline, 0), [smItems]);
  const totalWeightedUSD = useMemo(() => smItems.reduce((acc, item) => acc + item.weightedPipeline, 0), [smItems]);
  const totalRawTRY = useMemo(() => smItems.reduce((acc, item) => acc + item.tryRawPipeline, 0), [smItems]);
  const avgCrmHealth = useMemo(() => {
    if (smItems.length === 0) return 100;
    return Math.round(smItems.reduce((acc, item) => acc + item.crmHealthScore, 0) / smItems.length);
  }, [smItems]);

  return (
    <div className="space-y-8 p-6 pb-16 bg-slate-50/50 dark:bg-slate-950 min-h-screen">
      {/* Header & Fiscal Controls */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              CRM Veri & Performans Analizi
            </h1>
            <Badge variant="outline" className="border-emerald-700/30 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/50 dark:text-emerald-300 font-bold">
              {fiscalYear} - Q{quarter} (Hafta {weekNumber})
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Yüklenen CRM verilerine göre Satış Müdürü akordiyon detayları, Marka modalları, CRM Hijyen trendi ve Account Manager performans tablosu.
          </p>
        </div>

        {/* Filters Header */}
        <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">Mali Yıl:</span>
            <Select value={fiscalYear.toString()} onValueChange={(v) => v && setFiscalYear(Number(v))}>
              <SelectTrigger className="h-8 w-24 text-xs font-bold border-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                <SelectItem value="2025" className="text-xs">FY25</SelectItem>
                <SelectItem value="2026" className="text-xs">FY26</SelectItem>
                <SelectItem value="2027" className="text-xs">FY27</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">Çeyrek:</span>
            <Select value={quarter.toString()} onValueChange={(v) => v && setQuarter(Number(v))}>
              <SelectTrigger className="h-8 w-20 text-xs font-bold border-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200">
                <SelectItem value="1" className="text-xs">Q1</SelectItem>
                <SelectItem value="2" className="text-xs">Q2</SelectItem>
                <SelectItem value="3" className="text-xs">Q3</SelectItem>
                <SelectItem value="4" className="text-xs">Q4</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-500">Hafta:</span>
            <Select value={weekNumber.toString()} onValueChange={(v) => v && setWeekNumber(Number(v))}>
              <SelectTrigger className="h-8 w-24 text-xs font-bold border-slate-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200 max-h-56">
                {Array.from({ length: 13 }, (_, i) => i + 1).map((w) => (
                  <SelectItem key={w} value={w.toString()} className="text-xs">
                    {w}. Hafta
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={KPI_TILE_SHELL_XL}>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Toplam Ham Pipeline ($)</span>
          <h3 className="mt-1 font-mono text-xl font-bold text-slate-900 dark:text-slate-100">
            {formatUSD(totalRawUSD)}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">{totalDeals} Adet CRM Fırsat Kaydı</p>
        </div>

        <div className={`rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/30 ${CARD_HOVER_SHADOW}`}>
          <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block">Ağırlıklı Pipeline ($)</span>
          <h3 className="mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-300">
            {formatUSD(totalWeightedUSD)}
          </h3>
          <p className="text-[11px] text-emerald-600/90 dark:text-emerald-400 mt-0.5">Risk & Faturalanma çarpanlı net değer</p>
        </div>

        {totalRawTRY > 0 && (
          <div className={`rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/40 dark:bg-amber-950/40 ${CARD_HOVER_SHADOW}`}>
            <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider block">TL (TRY) Pipeline</span>
            <h3 className="mt-1 font-mono text-xl font-bold text-amber-900 dark:text-amber-300">
              {formatTRY(totalRawTRY)}
            </h3>
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">USD kurundan bağımsız TL fırsatlar</p>
          </div>
        )}

        <div className={KPI_TILE_SHELL_XL}>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Ort. CRM Hijyen Skoru</span>
          <h3 className="mt-1 font-mono text-xl font-extrabold text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" /> %{avgCrmHealth}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">Günü geçmiş iş bazı 100 puan üzerinden</p>
        </div>
      </div>

      {/* SECTION 1: Sales Manager Accordion Table with Brand Sub-rows */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users2 className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Satış Müdürü Bazlı CRM Pipeline & Marka Kırılımı (Akordiyon Görünüm)
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">Satırın solundaki oku tıklayarak markaları görebilir, markaya tıklayıp fırsat detayını açabilirsiniz.</span>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
          {isLoading ? (
            <div className="flex items-center justify-center p-12 text-slate-500 gap-2 text-xs">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> CRM Analiz Verileri Yükleniyor...
            </div>
          ) : smItems.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
              <Info className="h-6 w-6 text-amber-500" />
              <span className="font-bold text-slate-700 dark:text-slate-200">
                {fiscalYear} - Q{quarter} Hafta {weekNumber} dönemi için henüz CRM Excel verisi yüklenmemiştir.
              </span>
              <span className="text-slate-400">
                "Scorecard & CRM" sayfasından CS1_TDSYNNEX Excel dosyasını yükleyerek verileri aktarabilirsiniz.
              </span>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-100 dark:bg-slate-800/90">
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead className="font-bold text-xs">Satış Müdürü / Marka</TableHead>
                  <TableHead className="text-center font-bold text-xs w-24">Fırsat Adedi</TableHead>
                  <TableHead className="text-right font-bold text-xs w-36">Ham Pipeline ($)</TableHead>
                  <TableHead className="text-right font-bold text-xs w-32">TL Pipeline (₺)</TableHead>
                  <TableHead className="text-center font-bold text-[11px] w-28 text-emerald-800 dark:text-emerald-400">%100 Win</TableHead>
                  <TableHead className="text-center font-bold text-[11px] w-28 text-blue-800 dark:text-blue-400">%75 Commit</TableHead>
                  <TableHead className="text-center font-bold text-[11px] w-28 text-amber-800 dark:text-amber-400">%75 (%50)</TableHead>
                  <TableHead className="text-center font-bold text-[11px] w-28 text-orange-800 dark:text-orange-400">%50 (%25)</TableHead>
                  <TableHead className="text-center font-bold text-[11px] w-24 text-slate-500">%25 (%5)</TableHead>
                  <TableHead className="text-right font-bold text-xs w-40 text-emerald-700 dark:text-emerald-400">Ağırlıklı Pipeline ($)</TableHead>
                  <TableHead className="text-center font-bold text-xs w-28">Hijyen Skoru</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {smItems.map((sm) => {
                  const isExpanded = expandedSmIds.has(sm.id);
                  return (
                    <React.Fragment key={sm.id}>
                      {/* SM Primary Main Row */}
                      <TableRow
                        onClick={() => toggleSmAccordion(sm.id)}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 font-semibold text-xs border-b border-slate-200 dark:border-slate-800"
                      >
                        <TableCell className="text-slate-400">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          <Users2 className="h-4 w-4 text-slate-500" />
                          {sm.managerName}
                        </TableCell>
                        <TableCell className="text-center font-mono font-bold">{sm.totalDeals}</TableCell>
                        <TableCell className="text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                          {formatUSD(sm.rawPipeline)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-amber-700 dark:text-amber-400">
                          {sm.tryRawPipeline > 0 ? formatTRY(sm.tryRawPipeline) : "-"}
                        </TableCell>

                        {/* Win Rate Breakdowns */}
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center">
                            <span className="font-mono font-bold text-xs text-emerald-900 dark:text-emerald-300">
                              {sm.winRateBreakdown.win100.amount > 0 ? formatUSD(sm.winRateBreakdown.win100.amount) : "-"}
                            </span>
                            <span className="text-[10px] text-slate-500 font-semibold">({sm.winRateBreakdown.win100.count} Adet)</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center">
                            <span className="font-mono font-bold text-xs text-blue-900 dark:text-blue-300">
                              {sm.winRateBreakdown.win75Commit.amount > 0 ? formatUSD(sm.winRateBreakdown.win75Commit.amount) : "-"}
                            </span>
                            <span className="text-[10px] text-slate-500 font-semibold">({sm.winRateBreakdown.win75Commit.count} Adet)</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center">
                            <span className="font-mono font-bold text-xs text-amber-900 dark:text-amber-300">
                              {sm.winRateBreakdown.win75Half.amount > 0 ? formatUSD(sm.winRateBreakdown.win75Half.amount) : "-"}
                            </span>
                            <span className="text-[10px] text-slate-500 font-semibold">({sm.winRateBreakdown.win75Half.count} Adet)</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center">
                            <span className="font-mono font-bold text-xs text-orange-900 dark:text-orange-300">
                              {sm.winRateBreakdown.win50Quarter.amount > 0 ? formatUSD(sm.winRateBreakdown.win50Quarter.amount) : "-"}
                            </span>
                            <span className="text-[10px] text-slate-500 font-semibold">({sm.winRateBreakdown.win50Quarter.count} Adet)</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center">
                            <span className="font-mono font-bold text-xs text-slate-700 dark:text-slate-300">
                              {sm.winRateBreakdown.win25.amount > 0 ? formatUSD(sm.winRateBreakdown.win25.amount) : "-"}
                            </span>
                            <span className="text-[10px] text-slate-400 font-semibold">({sm.winRateBreakdown.win25.count} Adet)</span>
                          </div>
                        </TableCell>

                        <TableCell className="text-right font-mono font-bold text-sm text-emerald-700 dark:text-emerald-400">
                          {formatUSD(sm.weightedPipeline)}
                        </TableCell>

                        <TableCell className="text-center font-mono font-bold">
                          <span className={sm.crmHealthScore < 80 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}>
                            %{sm.crmHealthScore}
                          </span>
                        </TableCell>
                      </TableRow>

                      {/* Brand Sub-rows when expanded */}
                      {isExpanded &&
                        sm.brands.map((b, bIdx) => (
                          <TableRow
                            key={`${sm.id}-brand-${bIdx}`}
                            onClick={() => setSelectedBrand(b)}
                            className="bg-slate-50/70 hover:bg-emerald-50/50 dark:bg-slate-900/60 dark:hover:bg-emerald-950/30 cursor-pointer transition-colors border-b border-slate-100 dark:border-slate-800/50 text-xs"
                          >
                            <TableCell></TableCell>
                            <TableCell className="pl-8 font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                              <Building2 className="h-3.5 w-3.5 text-emerald-600" />
                              {b.vendorName}
                            </TableCell>
                            <TableCell className="text-center font-mono text-slate-600 dark:text-slate-400">
                              {b.totalDeals} Fırsat
                            </TableCell>
                            <TableCell className="text-right font-mono text-slate-800 dark:text-slate-200">
                              {formatUSD(b.rawPipeline)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-amber-700 dark:text-amber-400">
                              {b.tryRawPipeline > 0 ? formatTRY(b.tryRawPipeline) : "-"}
                            </TableCell>
                            <TableCell colSpan={5} className="text-center text-[10px] text-slate-400 italic">
                              Marka Detay Modalı İçin Tıklayın ➔
                            </TableCell>
                            <TableCell className="text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                              {formatUSD(b.weightedPipeline)}
                            </TableCell>
                            <TableCell className="text-center font-mono text-[11px] font-semibold text-slate-600">
                              %{b.crmHealthScore}
                            </TableCell>
                          </TableRow>
                        ))}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* SECTION 2: Account Manager (OWNER) Performance Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Account Manager (OWNER) Bazlı CRM Performans & Hijyen Tablosu
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">Excel'deki OWNER temsilcilerinin kapanan işleri, ciroları ve hijyen puanları</span>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
          {amList.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              Account Manager bazlı listelenecek veri bulunamadı.
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-100 dark:bg-slate-800/90">
                <TableRow>
                  <TableHead className="font-bold text-xs">Account Manager (OWNER)</TableHead>
                  <TableHead className="text-center font-bold text-xs w-28">Fırsat Adedi</TableHead>
                  <TableHead className="text-right font-bold text-xs w-36">Ham Pipeline ($)</TableHead>
                  <TableHead className="text-right font-bold text-xs w-32">TL Pipeline (₺)</TableHead>
                  <TableHead className="text-[11px] font-bold text-center w-36 text-emerald-800 dark:text-emerald-400">%100 Kapanan İşler</TableHead>
                  <TableHead className="text-right font-bold text-xs w-40 text-emerald-700 dark:text-emerald-400">Ağırlıklı Pipeline ($)</TableHead>
                  <TableHead className="text-center font-bold text-xs w-28 text-red-600 dark:text-red-400">Günü Geçmiş</TableHead>
                  <TableHead className="text-center font-bold text-xs w-24 text-amber-600 dark:text-amber-400">Kur Çelişkisi</TableHead>
                  <TableHead className="text-center font-bold text-xs w-24 text-orange-600 dark:text-orange-400">%0 Faturalanma</TableHead>
                  <TableHead className="text-center font-bold text-xs w-32">AM Hijyen Puanı</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {amList.map((am, idx) => (
                  <TableRow key={`${am.accountManagerName}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <TableCell className="font-bold text-xs text-slate-900 dark:text-slate-100">
                      {am.accountManagerName}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs font-semibold">
                      {am.totalDeals}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-xs text-slate-900 dark:text-slate-100">
                      {formatUSD(am.rawPipelineUSD)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-xs text-amber-700 dark:text-amber-400">
                      {am.rawPipelineTRY > 0 ? formatTRY(am.rawPipelineTRY) : "-"}
                    </TableCell>
                    
                    {/* Closed Won %100 Column */}
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center">
                        <span className="font-mono font-bold text-xs text-emerald-700 dark:text-emerald-400">
                          {am.closedWonAmountUSD > 0 ? formatUSD(am.closedWonAmountUSD) : "-"}
                        </span>
                        <span className="text-[10px] text-emerald-600 font-semibold">
                          ({am.closedWonCount} Adet)
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="text-right font-mono font-bold text-xs text-emerald-700 dark:text-emerald-400">
                      {formatUSD(am.weightedPipelineUSD)}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">
                      {am.overdueCount > 0 ? (
                        <Badge variant="outline" className="border-red-300 bg-red-50 text-red-900 dark:bg-red-950 font-bold">
                          {am.overdueCount} İş
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px]">Temiz</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">
                      {am.currencyConflictCount > 0 ? (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 font-bold">
                          {am.currencyConflictCount}
                        </Badge>
                      ) : (
                        <span className="text-slate-400 text-[11px]">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">
                      {am.zeroInvoicingCount > 0 ? (
                        <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-900 dark:bg-orange-950 font-bold">
                          {am.zeroInvoicingCount}
                        </Badge>
                      ) : (
                        <span className="text-slate-400 text-[11px]">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono font-extrabold text-sm">
                      <span className={am.hygieneScore < 80 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}>
                        %{am.hygieneScore}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Brand Detail Modal */}
      {selectedBrand && (
        <BrandDetailDialog
          isOpen={!!selectedBrand}
          onClose={() => setSelectedBrand(null)}
          vendorName={selectedBrand.vendorName}
          totalDeals={selectedBrand.totalDeals}
          rawPipeline={selectedBrand.rawPipeline}
          tryRawPipeline={selectedBrand.tryRawPipeline}
          weightedPipeline={selectedBrand.weightedPipeline}
          crmHealthScore={selectedBrand.crmHealthScore}
          crmAuditJson={selectedBrand.crmAuditJson}
        />
      )}
    </div>
  );
}
