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
import { Search, ArrowUpDown, ArrowUp, ArrowDown, UserCheck, AlertTriangle, Coins, CalendarX } from "lucide-react";
import { CrmAuditDeal } from "@/lib/crm/tdsynnex-parser";

interface CrmAuditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  category: "OVERDUE" | "CURRENCY_CONFLICT" | "ZERO_INVOICING" | "UNASSIGNED_BRAND";
  deals: CrmAuditDeal[];
}

type SortField = "code" | "name" | "brand" | "accountManager" | "selling" | "dateStr";
type SortOrder = "asc" | "desc";

export function CrmAuditDialog({
  isOpen,
  onClose,
  title,
  description,
  category,
  deals,
}: CrmAuditDialogProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("selling");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Filter deals for this specific category
  const filteredCategoryDeals = useMemo(() => {
    return deals.filter((d) => d.issues.includes(category));
  }, [deals, category]);

  // Search filter
  const searchFiltered = useMemo(() => {
    if (!searchTerm.trim()) return filteredCategoryDeals;
    const term = searchTerm.toLowerCase();
    return filteredCategoryDeals.filter(
      (d) =>
        d.code.toLowerCase().includes(term) ||
        d.name.toLowerCase().includes(term) ||
        d.brand.toLowerCase().includes(term) ||
        d.accountManager.toLowerCase().includes(term)
    );
  }, [filteredCategoryDeals, searchTerm]);

  // Sorted deals
  const sortedDeals = useMemo(() => {
    return searchFiltered.slice().sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

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

  const totalValueUSD = useMemo(() => {
    return searchFiltered.reduce((sum, d) => sum + (d.currency === "USD" ? d.selling : 0), 0);
  }, [searchFiltered]);

  const totalValueTRY = useMemo(() => {
    return searchFiltered.reduce((sum, d) => sum + (d.currency !== "USD" ? d.selling : 0), 0);
  }, [searchFiltered]);

  const formatCurrency = (val: number, currency: string) => {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: currency.includes("TL") || currency.includes("TRY") ? "TRY" : "USD",
      maximumFractionDigits: 0,
    }).format(val);
  };

  const getCategoryIcon = () => {
    switch (category) {
      case "OVERDUE":
        return <CalendarX className="h-5 w-5 text-red-500" />;
      case "CURRENCY_CONFLICT":
        return <Coins className="h-5 w-5 text-amber-500" />;
      case "ZERO_INVOICING":
        return <AlertTriangle className="h-5 w-5 text-orange-500" />;
      case "UNASSIGNED_BRAND":
        return <UserCheck className="h-5 w-5 text-blue-500" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!w-[94vw] !max-w-7xl sm:!max-w-7xl max-h-[90vh] flex flex-col p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <DialogHeader className="flex flex-col gap-1.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            {getCategoryIcon()}
            <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {title}
            </DialogTitle>
            <Badge variant="secondary" className="ml-auto font-mono text-xs px-2.5 py-0.5 font-bold">
              {searchFiltered.length} Adet Fırsat
            </Badge>
          </div>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            {description}
          </DialogDescription>
        </DialogHeader>

        {/* Top Controls: Search Bar & Total Summary */}
        <div className="flex flex-wrap items-center justify-between gap-3 my-3">
          <div className="relative flex-1 min-w-[280px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Fırsat adı, kodu, marka veya Account Manager ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700"
            />
          </div>
          <div className="flex items-center gap-2 text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg text-slate-700 dark:text-slate-300">
            <span>Tutar: {formatCurrency(totalValueUSD, "USD")}</span>
            {totalValueTRY > 0 && <span className="text-amber-600 dark:text-amber-400"> + {formatCurrency(totalValueTRY, "TRY")}</span>}
          </div>
        </div>

        {/* Sortable Table Container */}
        <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          {sortedDeals.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400 font-medium">
              Arama kriterlerine uygun fırsat kaydı bulunamadı.
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-slate-100 dark:bg-slate-800/90 backdrop-blur-xs z-10">
                <TableRow>
                  <TableHead className="w-36 cursor-pointer select-none" onClick={() => handleSort("code")}>
                    <div className="flex items-center gap-1 font-bold text-xs">
                      Kod {sortField === "code" ? (sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer select-none min-w-[220px]" onClick={() => handleSort("name")}>
                    <div className="flex items-center gap-1 font-bold text-xs">
                      Fırsat Adı {sortField === "name" ? (sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </div>
                  </TableHead>
                  <TableHead className="w-40 cursor-pointer select-none" onClick={() => handleSort("brand")}>
                    <div className="flex items-center gap-1 font-bold text-xs">
                      Marka {sortField === "brand" ? (sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </div>
                  </TableHead>
                  <TableHead className="w-48 cursor-pointer select-none" onClick={() => handleSort("accountManager")}>
                    <div className="flex items-center gap-1 font-bold text-xs text-emerald-800 dark:text-emerald-400">
                      Account Mgr (OWNER) {sortField === "accountManager" ? (sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </div>
                  </TableHead>
                  <TableHead className="w-36 text-right cursor-pointer select-none" onClick={() => handleSort("selling")}>
                    <div className="flex items-center justify-end gap-1 font-bold text-xs">
                      Tutar {sortField === "selling" ? (sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </div>
                  </TableHead>
                  <TableHead className="w-40 text-center font-bold text-xs">
                    Kur / Detay
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDeals.map((d, idx) => (
                  <TableRow key={`${d.code}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <TableCell className="font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {d.code}
                    </TableCell>
                    <TableCell className="font-medium text-xs text-slate-900 dark:text-slate-100 font-sans" title={d.name}>
                      {d.name}
                    </TableCell>
                    <TableCell className="font-bold text-xs text-slate-700 dark:text-slate-300">
                      {d.brand}
                    </TableCell>
                    <TableCell className="font-semibold text-xs text-emerald-900 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 px-2 rounded">
                      {d.accountManager || "Belirtilmemiş"}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-xs text-slate-900 dark:text-slate-100">
                      {formatCurrency(d.selling, d.currency)}
                    </TableCell>
                    <TableCell className="text-center font-mono text-[11px]">
                      {category === "CURRENCY_CONFLICT" ? (
                        <div className="flex items-center justify-center gap-1">
                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200 text-[10px] font-bold">
                            {d.currency} ➔ {d.partnerCurrency}
                          </Badge>
                        </div>
                      ) : category === "ZERO_INVOICING" ? (
                        <Badge variant="outline" className="border-orange-300 bg-orange-50 text-orange-900 dark:bg-orange-950 dark:text-orange-200 text-[10px]">
                          Fatura: %0
                        </Badge>
                      ) : category === "OVERDUE" ? (
                        <span className="text-red-600 dark:text-red-400 font-medium text-[11px]">
                          {d.dateStr}
                        </span>
                      ) : (
                        <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-200 text-[10px]">
                          Atanmamış
                        </Badge>
                      )}
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
