"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Building2, CheckCircle2, HelpCircle, Loader2 } from "lucide-react";

export interface UnmatchedBrand {
  brandName: string;
  totalDeals: number;
  rawPipeline: number;
}

export interface AvailableVendor {
  id: string;
  name: string;
  code: string | null;
  managerName: string;
  managerRole: string | null;
}

interface VendorMappingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  unmatchedBrands: UnmatchedBrand[];
  availableVendors: AvailableVendor[];
  onConfirmMappings: (mappings: { excelBrand: string; targetVendorId: string }[], skipRemaining?: boolean) => void;
  isSubmitting?: boolean;
}

export function VendorMappingDialog({
  isOpen,
  onClose,
  unmatchedBrands,
  availableVendors,
  onConfirmMappings,
  isSubmitting = false,
}: VendorMappingDialogProps) {
  // Mapping state: excelBrand -> targetVendorId
  const [selectedMappings, setSelectedMappings] = useState<Record<string, string>>({});

  const handleSelectChange = (excelBrand: string, vendorId: string) => {
    setSelectedMappings((prev) => ({
      ...prev,
      [excelBrand]: vendorId,
    }));
  };

  const handleSave = () => {
    const mappings = Object.entries(selectedMappings)
      .filter(([_, vendorId]) => vendorId && vendorId !== "SKIP")
      .map(([excelBrand, targetVendorId]) => ({ excelBrand, targetVendorId }));

    onConfirmMappings(mappings, false);
  };

  const handleSkipAll = () => {
    onConfirmMappings([], true);
  };

  const formatUSD = (val: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="!w-[90vw] !max-w-3xl max-h-[85vh] flex flex-col p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <DialogHeader className="flex flex-col gap-1.5 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Eşleşmeyen CRM Markalarını Tanımlayın
            </DialogTitle>
            <Badge variant="outline" className="ml-auto font-mono text-xs border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200 font-bold">
              {unmatchedBrands.length} Marka Uyuşmuyor
            </Badge>
          </div>
          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
            Yüklenen CRM Excel dosyasında veritabanımızla otomatik eşleşmeyen veya Satış Müdürü atanmamış markalar tespit edildi. Lütfen bu markaların hangi sisteme ait markayla eşleşeceğini seçin. Yapılan seçimler otomatik **Takma Ad (Alias)** olarak kaydedilecek ve sonraki yüklemelerde hatırlanacaktır.
          </DialogDescription>
        </DialogHeader>

        {/* Unmatched Brands List */}
        <div className="flex-1 overflow-y-auto my-3 space-y-3 pr-1">
          {unmatchedBrands.map((b) => {
            const currentSelected = selectedMappings[b.brandName] || "";
            return (
              <div
                key={b.brandName}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-emerald-300 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      {b.brandName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                    <span>{b.totalDeals} Fırsat</span>
                    <span>•</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">{formatUSD(b.rawPipeline)}</span>
                  </div>
                </div>

                <div className="w-full sm:w-72">
                  <Select
                    value={currentSelected}
                    onValueChange={(val) => handleSelectChange(b.brandName, val || "")}
                  >
                    <SelectTrigger className="h-9 text-xs bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                      <SelectValue placeholder="Sistem markası seçin..." />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 max-h-60">
                      <SelectItem value="SKIP" className="text-xs text-slate-400 italic">
                        -- Eşleştirmeden Geç (Atanmamış Kalacak) --
                      </SelectItem>
                      {availableVendors.map((v) => (
                        <SelectItem key={v.id} value={v.id} className="text-xs">
                          <div className="flex items-center justify-between gap-2 w-full">
                            <span className="font-bold">{v.name}</span>
                            <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono">
                              ({v.managerName})
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={handleSkipAll}
            disabled={isSubmitting}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            Olduğu Gibi Devam Et (Atanmamış Olarak Yükle)
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-xs border-slate-200"
            >
              İptal
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSubmitting}
              className="bg-emerald-700 text-xs font-bold text-white hover:bg-emerald-800 shadow-xs dark:bg-emerald-600 dark:hover:bg-emerald-500 flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Eşleştiriliyor...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Eşleştirmeleri Kaydet & Yükle
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
