"use client";

import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Building2, Coins, Calculator } from "lucide-react";
import { CrmAuditDeal } from "@/lib/crm/tdsynnex-parser";

interface BrandDetailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  vendorName: string;
  totalDeals: number;
  rawPipeline: number;
  tryRawPipeline: number;
  weightedPipeline: number;
  crmHealthScore: number;
  crmAuditJson?: string | null;
}

type SortField = "code" | "name" | "accountManager" | "selling" | "multiplier";
type SortOrder = "asc" | "desc";

export function BrandDetailDialog({
  isOpen,
  onClose,
  vendorName,
  totalDeals,
  rawPipeline,
  tryRawPipeline,
  weightedPipeline,
  crmHealthScore,
  crmAuditJson,
}: BrandDetailDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("selling");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Parse audit deals for this brand
  const deals: CrmAuditDeal[] = useMemo(() => {
    if (!crmAuditJson) return [];
    try {
      return JSON.parse(crmAuditJson);
    } catch (e) {
      return [];
    }
  }, [crmAuditJson]);

  // Search filter
  const searchFiltered = useMemo(() => {
    if (!searchTerm.trim()) return deals;
    const term = searchTerm.toLowerCase();
    return deals.filter(
      (d) =>
        d.code.toLowerCase().includes(term) ||
        d.name.toLowerCase().includes(term) ||
        d.accountManager.toLowerCase().includes(term)
    );
  }, [deals, searchTerm]);

  // Sorted deals
  const sortedDeals = useMemo(() => {
    return searchFiltered.slice().sort((a, b) => {
      let aVal: any = (a as any)[sortField];
      let bVal: any = (b as any)[sortField];

      if (typeof aVal === "string") {
        aVal = aVal.toLowerCase();
        bVal = (bVal || "").toLowerCase();
      }

      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [searchFiltered, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const formatUSD = (val: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatTRY = (val: number) => {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!w-[94vw] !max-w-7xl sm:!max-w-7xl max-h-[90vh] flex flex-col p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <DialogHeader className="flex flex-col gap-1.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-emerald-700 dark:text-emerald-400" />
            <DialogTitle className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {vendorName} - Marka Detay Raporu
            </DialogTitle>
            <Badge variant="secondary" className="ml-auto font-mono text-xs px-3 py-1 font-bold">
              CRM Hijyen: %{crmHealthScore}
            </Badge>
          </div>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            {vendorName} markasına ait fırsatların adetleri, toplam tutarları, ağırlık çarpanları ve Account Manager dağılımları.
          </DialogDescription>
        </DialogHeader>

        {/* Summary Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 my-3">
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Fırsat Adedi</span>
            <span className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">{totalDeals} Adet</span>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Ham Pipeline ($)</span>
            <span className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">{formatUSD(rawPipeline)}</span>
          </div>

          {tryRawPipeline > 0 && (
            <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/30">
              <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider block">TL Pipeline (₺)</span>
              <span className="font-mono text-lg font-bold text-amber-900 dark:text-amber-300">{formatTRY(tryRawPipeline)}</span>
            </div>
          )}

          <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/30">
            <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block">Hesaplanmış Ağırlıklı Pipeline</span>
            <span className="font-mono text-lg font-bold text-emerald-700 dark:text-emerald-300">{formatUSD(weightedPipeline)}</span>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Fırsat adı, kodu veya Account Manager ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9 text-xs bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700"
          />
        </div>

        {/* Opportunities Table */}
        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          {sortedDeals.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400 font-medium">
              Bu marka için listelenecek fırsat kaydı bulunamadı.
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-slate-100 dark:bg-slate-800/90 backdrop-blur-xs z-10">
                <TableRow>
                  <TableHead className="w-32 cursor-pointer select-none" onClick={() => handleSort("code")}>
                    <div className="flex items-center gap-1 font-bold text-xs">
                      Kod {sortField === "code" ? (sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none min-w-[220px]" onClick={() => handleSort("name")}>
                    <div className="flex items-center gap-1 font-bold text-xs">
                      Fırsat Adı {sortField === "name" ? (sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </div>
                  </TableHead>
                  <TableHead className="w-44 cursor-pointer select-none" onClick={() => handleSort("accountManager")}>
                    <div className="flex items-center gap-1 font-bold text-xs text-emerald-800 dark:text-emerald-400">
                      Account Manager (OWNER) {sortField === "accountManager" ? (sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </div>
                  </TableHead>
                  <TableHead className="w-36 text-right cursor-pointer select-none" onClick={() => handleSort("selling")}>
                    <div className="flex items-center justify-end gap-1 font-bold text-xs">
                      Ham Tutar {sortField === "selling" ? (sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </div>
                  </TableHead>
                  <TableHead className="w-28 text-center font-bold text-xs cursor-pointer select-none" onClick={() => handleSort("multiplier")}>
                    <div className="flex items-center justify-center gap-1">
                      Çarpan {sortField === "multiplier" ? (sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </div>
                  </TableHead>
                  <TableHead className="w-36 text-right font-bold text-xs text-emerald-700 dark:text-emerald-400">
                    Ağırlıklı Tutar
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDeals.map((d, idx) => (
                  <TableRow key={`${d.code}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <TableCell className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {d.code}
                    </TableCell>
                    <TableCell className="font-medium text-xs text-slate-900 dark:text-slate-100">
                      {d.name}
                    </TableCell>
                    <TableCell className="font-semibold text-xs text-emerald-900 dark:text-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/20 px-2 rounded">
                      {d.accountManager || "Belirtilmemiş"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-xs text-slate-900 dark:text-slate-100">
                      {d.currency === "USD" ? formatUSD(d.selling) : formatTRY(d.selling)}
                    </TableCell>
                    <TableCell className="text-center font-mono">
                      <Badge variant="outline" className="text-[10px] font-bold border-slate-300 bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                        x{d.multiplier}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-xs text-emerald-700 dark:text-emerald-400">
                      {d.currency === "USD" ? formatUSD(d.selling * d.multiplier) : formatTRY(d.selling * d.multiplier)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
