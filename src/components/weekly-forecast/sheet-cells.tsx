"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatEditable,
  formatSheetCurrency,
  formatSheetPercent,
  parseNumberInput,
} from "@/lib/weekly-forecast/format";

/**
 * Excel dolgu renklerinin karşılığı:
 *   sarı  #FFFF00 → girilebilir hücre
 *   gri   #D9D9D9 → hesaplanan / kilitli hücre
 *   dolgusuz        → etiket & başlık
 *
 * Koyu temada aynı semantik korunur; ham Excel renkleri okunaksız olduğu için
 * eşdeğer koyu tonlar kullanılır.
 */

const BASE = "border border-slate-300 px-2 py-1 text-[13px] leading-tight align-middle dark:border-slate-700";
const COMPUTED_FILL = "bg-[#D9D9D9] dark:bg-slate-800";
const INPUT_FILL = "bg-[#FFFF00] dark:bg-amber-500/25";

export function LabelCell({
  children,
  className,
  colSpan,
  bold,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
  bold?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        BASE,
        "whitespace-pre-line text-slate-900 dark:text-slate-100",
        bold && "font-semibold",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function HeaderCell({
  children,
  colSpan,
}: {
  children?: React.ReactNode;
  colSpan?: number;
}) {
  return (
    <th
      colSpan={colSpan}
      className={cn(
        BASE,
        "whitespace-pre-line bg-white text-center font-semibold text-slate-900 dark:bg-slate-900 dark:text-slate-100",
      )}
    >
      {children}
    </th>
  );
}

/** Excel'de içeriği olmayan hücre. */
export function EmptyCell({ colSpan, title }: { colSpan?: number; title?: string }) {
  return <td colSpan={colSpan} title={title} className={cn(BASE, "bg-white dark:bg-slate-900")} />;
}

/**
 * CRM karşılaştırma işareti — hücrenin altında ikinci satır olarak görünür.
 * `status` her zaman ikonla birlikte gelir; yalnızca renge güvenilmez.
 */
export interface CrmMarker {
  crmValue: number;
  diff: number;
  status: "match" | "warn" | "crit";
  dealCount: number;
  /** Karşılaştırma modu kapalıyken yalnızca ikon gösterilir */
  showValue: boolean;
  tooltip: string;
}

const MARKER_STYLE: Record<CrmMarker["status"], { renk: string; simge: string }> = {
  match: { renk: "text-emerald-700 dark:text-emerald-400", simge: "✓" },
  warn: { renk: "text-amber-700 dark:text-amber-400", simge: "▲" },
  crit: { renk: "text-red-700 dark:text-red-400", simge: "✕" },
};

function MarkerLine({ marker }: { marker: CrmMarker }) {
  const style = MARKER_STYLE[marker.status];
  if (!marker.showValue) {
    // Mod kapalı: yalnızca sapmalı hücrelerde küçük bir işaret
    if (marker.status === "match") return null;
    return (
      <span className={cn("absolute right-0.5 top-0 text-[9px] leading-none", style.renk)}>
        {style.simge}
      </span>
    );
  }
  return (
    <span className={cn("block px-1.5 pb-0.5 text-right text-[10px] leading-tight", style.renk)}>
      {style.simge} {formatSheetCurrency(marker.crmValue)}
      {marker.status !== "match" && (
        <span className="ml-1 opacity-80">
          ({marker.diff > 0 ? "+" : ""}
          {formatSheetCurrency(marker.diff)})
        </span>
      )}
    </span>
  );
}

/** Hesaplanan hücre — Excel'de gri, kilitli. */
export function ComputedCell({
  value,
  kind = "currency",
  bold,
  title,
  crm,
}: {
  value: number | null | undefined;
  kind?: "currency" | "percent" | "na";
  bold?: boolean;
  /** Verilmezse varsayılan "hesaplanan hücre" açıklaması gösterilir. */
  title?: string;
  /**
   * CRM karşılaştırma işareti. Kapanmış ay hücreleri de hesaplanan hücreye
   * dönüştüğü için burada da gösterilmeli — SM düzeltemese bile sapmayı
   * görmeli. Aksi halde CRM denetiminin çoğu görünmez olurdu.
   */
  crm?: CrmMarker;
}) {
  const text =
    kind === "na"
      ? "N/A"
      : kind === "percent"
        ? formatSheetPercent(value)
        : formatSheetCurrency(value);

  return (
    <td
      className={cn(
        BASE,
        COMPUTED_FILL,
        "whitespace-nowrap text-right tabular-nums text-slate-900 dark:text-slate-100",
        crm && "relative",
        bold && "font-semibold",
      )}
      title={crm?.tooltip ?? title ?? "Hesaplanan hücre — düzenlenemez"}
    >
      {text}
      {crm && <MarkerLine marker={crm} />}
    </td>
  );
}

/** Girilebilir hücre — Excel'de sarı, kilitsiz. */
export function InputCell({
  value,
  onCommit,
  disabled,
  path,
  crm,
}: {
  value: number;
  onCommit: (next: number) => void;
  disabled?: boolean;
  path: string;
  /** CRM karşılaştırma işareti; verilmezse hücre normal görünür. */
  crm?: CrmMarker;
}) {
  // draft === null → odak dışı, biçimlendirilmiş görünüm
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseNumberInput(draft);
    setDraft(null);
    if (parsed !== null && parsed !== value) onCommit(parsed);
  };

  return (
    <td className={cn(BASE, INPUT_FILL, "relative p-0")} title={crm?.tooltip}>
      <input
        data-cell={path}
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? formatSheetCurrency(value)}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          setDraft(formatEditable(value));
          requestAnimationFrame(() => event.target.select());
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
        className="w-full bg-transparent px-1.5 py-1 text-right text-[13px] whitespace-nowrap tabular-nums text-slate-900 outline-none focus:bg-white focus:ring-2 focus:ring-emerald-600 focus:ring-inset disabled:cursor-not-allowed disabled:opacity-70 dark:text-slate-100 dark:focus:bg-slate-950"
      />
      {crm && <MarkerLine marker={crm} />}
    </td>
  );
}
