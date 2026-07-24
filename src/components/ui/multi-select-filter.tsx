"use client";

import React, { useState, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, Search, X, Filter } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface MultiSelectFilterProps {
  title: string;
  options: FilterOption[];
  selectedValues: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function MultiSelectFilter({
  title,
  options,
  selectedValues,
  onChange,
  placeholder = "Ara...",
  icon,
  className = "",
}: MultiSelectFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase())
  );

  const isAllSelected =
    options.length > 0 && options.every((opt) => selectedValues.includes(opt.value));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      onChange([]);
    } else {
      onChange(options.map((opt) => opt.value));
    }
  };

  const toggleOption = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter((v) => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <div className={`relative inline-block text-left ${className}`} ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        className={`h-9 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shadow-sm transition-all duration-150 ${
          selectedValues.length > 0 ? "border-[#1F3A2E] dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20" : ""
        }`}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium">
          {icon || <Filter className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />}
          <span>{title}</span>
          {selectedValues.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 px-1.5 py-0 text-[10px] font-semibold bg-[#1F3A2E] text-white dark:bg-emerald-600"
            >
              {selectedValues.length}
            </Badge>
          )}
        </span>
        {selectedValues.length > 0 ? (
          <X
            className="ml-2 h-3.5 w-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            onClick={handleClear}
          />
        ) : (
          <ChevronDown className="ml-2 h-3.5 w-3.5 text-slate-400" />
        )}
      </Button>

      {isOpen && (
        <div className="absolute left-0 mt-1.5 w-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-xl z-50 animate-in fade-in-50 zoom-in-95 duration-100">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              type="text"
              placeholder={placeholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-xs bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
            />
          </div>

          <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-slate-100 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="hover:text-[#1F3A2E] dark:hover:text-emerald-400 transition-colors"
            >
              {isAllSelected ? "Tümünü Kaldır" : "Tümünü Seç"}
            </button>
            {selectedValues.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-red-500 hover:text-red-600 transition-colors"
              >
                Temizle
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1 custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <div className="py-3 text-center text-xs text-slate-400">Sonuç bulunamadı.</div>
            ) : (
              filteredOptions.map((option) => {
                const isChecked = selectedValues.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                      isChecked
                        ? "bg-emerald-50/70 dark:bg-emerald-950/40 text-[#1F3A2E] dark:text-emerald-300 font-medium"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleOption(option.value)}
                        className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-700 data-[state=checked]:bg-[#1F3A2E] dark:data-[state=checked]:bg-emerald-600"
                      />
                      <span className="truncate">{option.label}</span>
                    </div>
                    {option.count !== undefined && (
                      <span className="text-[10px] text-slate-400 font-normal">
                        ({option.count})
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
