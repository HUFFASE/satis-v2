"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";

interface SortableTableHeadProps {
  label: string;
  active?: boolean;
  direction?: "asc" | "desc";
  align?: "left" | "center" | "right";
  className?: string;
  colSpan?: number;
  rowSpan?: number;
  onClick: () => void;
}

export function SortableTableHead({
  label,
  active = false,
  direction = "asc",
  align = "left",
  className = "",
  colSpan,
  rowSpan,
  onClick,
}: SortableTableHeadProps) {
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const alignment =
    align === "right" ? "justify-end text-right" : align === "center" ? "justify-center text-center" : "justify-start text-left";

  return (
    <TableHead colSpan={colSpan} rowSpan={rowSpan} className={`bg-emerald-800 text-emerald-50 ${className}`}>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-1.5 rounded-sm py-1 text-xs font-extrabold uppercase tracking-wide transition hover:text-white ${alignment}`}
      >
        <span>{label}</span>
        <Icon className={`h-3.5 w-3.5 ${active ? "opacity-100" : "opacity-55"}`} />
      </button>
    </TableHead>
  );
}
