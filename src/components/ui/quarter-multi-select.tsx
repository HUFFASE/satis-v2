"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface QuarterMultiSelectProps {
  selectedQuarters: number[];
  onChange: (quarters: number[]) => void;
  disabled?: boolean;
  className?: string;
  allowAllShortcut?: boolean;
}

export function QuarterMultiSelect({
  selectedQuarters,
  onChange,
  disabled = false,
  className,
  allowAllShortcut = false,
}: QuarterMultiSelectProps) {
  const quarters = [1, 2, 3, 4];
  const allSelected = quarters.every((q) => selectedQuarters.includes(q));

  const toggleQuarter = (quarter: number) => {
    if (disabled) return;

    const exists = selectedQuarters.includes(quarter);
    let nextQuarters: number[];

    if (exists) {
      // En az bir çeyrek seçili kalmalı
      if (selectedQuarters.length === 1) {
        return;
      }
      nextQuarters = selectedQuarters.filter((q) => q !== quarter);
    } else {
      nextQuarters = [...selectedQuarters, quarter].sort((a, b) => a - b);
    }

    onChange(nextQuarters);
  };

  const toggleAll = () => {
    if (disabled) return;
    if (allSelected) {
      // Varsayılan olarak Q1'e dön
      onChange([1]);
    } else {
      onChange([1, 2, 3, 4]);
    }
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900",
        className
      )}
      role="group"
      aria-label="Çeyrek filtreleri"
    >
      {allowAllShortcut && (
        <Button
          type="button"
          size="sm"
          variant={allSelected ? "default" : "ghost"}
          disabled={disabled}
          onClick={toggleAll}
          className={cn(
            "h-8 px-2.5 text-xs font-semibold",
            allSelected ? "bg-[#2E5A43] text-white hover:bg-[#244936]" : "text-slate-600 dark:text-slate-400"
          )}
        >
          Tüm Yıl
        </Button>
      )}
      {quarters.map((quarter) => {
        const isSelected = selectedQuarters.includes(quarter);
        return (
          <Button
            key={quarter}
            type="button"
            size="sm"
            variant={isSelected ? "default" : "ghost"}
            disabled={disabled}
            onClick={() => toggleQuarter(quarter)}
            aria-pressed={isSelected}
            className={cn(
              "h-8 px-3 text-xs font-semibold transition-colors",
              isSelected
                ? "bg-[#2E5A43] text-white hover:bg-[#244936]"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            )}
          >
            Q{quarter}
          </Button>
        );
      })}
    </div>
  );
}

export default QuarterMultiSelect;
