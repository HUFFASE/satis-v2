import React from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from "lucide-react";
import { formatPercent } from "./format";

export type StatusKey = "good" | "warn" | "crit" | "neutral";

/**
 * Durum paleti. Renk tek başına anlam taşımaz: her durum kendi ikonuyla birlikte
 * gösterilir ve sayısal değer her zaman ekranda kalır. Bunun sebebi ölçüm —
 * açık temada metin okunabilirliği için gereken koyulukta amber ile kırmızı
 * normal görüşte bile ΔE 9.1 ile birbirine yakın kalıyor, yani renk tek başına
 * ayırt edici olamıyor. Renk değerleri globals.css'teki --viz-* tokenlarından gelir.
 */
export const STATUS_META: Record<
  StatusKey,
  { ink: string; mark: string; Icon: React.ElementType; label: string }
> = {
  good: { ink: "text-[var(--viz-good-ink)]", mark: "var(--viz-good)", Icon: CheckCircle2, label: "Hedefte" },
  warn: { ink: "text-[var(--viz-warn-ink)]", mark: "var(--viz-warn)", Icon: CircleAlert, label: "Takipte" },
  crit: { ink: "text-[var(--viz-crit-ink)]", mark: "var(--viz-crit)", Icon: AlertTriangle, label: "Riskli" },
  neutral: { ink: "text-slate-500 dark:text-slate-400", mark: "var(--viz-grid)", Icon: Info, label: "Bilgi" },
};

/** Hedef gerçekleşme eşikleri: %100 ve üstü hedefte, %75 altı riskli. */
export function getAchievementStatus(value: number): StatusKey {
  if (value >= 100) return "good";
  if (value >= 75) return "warn";
  return "crit";
}

/**
 * Forecast doğruluk eşikleri: %90 ve üstü iyi, %75 altı riskli.
 * Achievement'tan farklı eşikler kullanır — orada hedefi tutturmak %100 demek,
 * burada tahminin gerçeğe yakınlığı ölçülüyor.
 */
export function getAccuracyStatus(value: number): StatusKey {
  if (value >= 90) return "good";
  if (value >= 75) return "warn";
  return "crit";
}

/**
 * Kârlılık durumu, dönemin hedef GP%'sine göre değerlendirilir; sabit bir eşik
 * kullanılmaz. Sabit %20/%10 eşikleri gerçek veride yanılttı: hedef GP% ~%5.8
 * olan bir dönemde %6.5 kârlılık "riskli" görünüyor, satırların büyük kısmı
 * kırmızıya boyandığı için renk bilgi taşımayı bırakıyordu.
 *
 * Hedefin üstü hedefte, hedefin %85'i ve üstü takipte, altı riskli sayılır.
 */
export function getGpStatus(value: number, targetGpPercent: number): StatusKey {
  if (targetGpPercent <= 0) return "neutral";
  if (value >= targetGpPercent) return "good";
  if (value >= targetGpPercent * 0.85) return "warn";
  return "crit";
}

/** Renk + ikon + sayı üçlüsünü birlikte taşıyan hücre içeriği. */
export function StatusValue({
  value,
  status,
  className = "",
  title,
}: {
  value: string;
  status: StatusKey;
  className?: string;
  title?: string;
}) {
  const { ink, Icon, label } = STATUS_META[status];
  return (
    <span className={`inline-flex items-center justify-end gap-1 ${ink} ${className}`} title={title}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{value}</span>
      <span className="sr-only">{title ?? label}</span>
    </span>
  );
}

/**
 * Hedefi olmayan satırda achievement matematiksel olarak 0 çıkar; bunu kırmızı
 * "%0.0 riskli" diye göstermek yanlış okunuyordu. Payda yoksa değer gösterilmez.
 */
export function AchievementCell({ value, target }: { value: number; target: number }) {
  if (target <= 0) {
    return <StatusValue value="—" status="neutral" title="Bu dönem için hedef girilmemiş" />;
  }
  return <StatusValue value={formatPercent(value)} status={getAchievementStatus(value)} />;
}

/**
 * Kârlılık yüzdesi hücresi.
 *
 * Ciro yoksa oran tanımsızdır. Hedef GP% verilmediyse değer renksiz yazılır:
 * bir kârlılık oranının iyi mi kötü mü olduğu, karşılaştırılacak bir hedef
 * olmadan söylenemez.
 */
export function GpPercentCell({
  value,
  revenue,
  targetGpPercent,
}: {
  value: number;
  revenue: number;
  targetGpPercent?: number;
}) {
  if (revenue <= 0) {
    return <StatusValue value="—" status="neutral" title="Ciro girilmediği için oran hesaplanamıyor" />;
  }
  if (!targetGpPercent || targetGpPercent <= 0) {
    return <span className="tabular-nums">{formatPercent(value)}</span>;
  }
  return (
    <StatusValue
      value={formatPercent(value)}
      status={getGpStatus(value, targetGpPercent)}
      title={`Hedef GP% ${formatPercent(targetGpPercent)}`}
    />
  );
}
