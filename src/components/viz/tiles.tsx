import React from "react";
import { Inbox } from "lucide-react";
import { StatusKey, STATUS_META, getAchievementStatus, StatusValue } from "./status";
import { formatPercent, formatSignedUSD, formatUSD } from "./format";
import { KPI_TILE_SHELL } from "./card-shell";

/**
 * Hedefe göre gerçekleşmeyi gösteren ölçer. Ölçek max(100, değer) olduğu için
 * %100'ü aşan gerçekleşme kırpılmaz; %100 sınırı ayrı bir işaretle gösterilir.
 */
export function Meter({ value, status }: { value: number; status: StatusKey }) {
  const scale = Math.max(100, value);
  const fillPercent = scale > 0 ? Math.min(100, (value / scale) * 100) : 0;
  const targetPercent = scale > 0 ? (100 / scale) * 100 : 100;
  const isOverAchieved = value > 100;

  return (
    <div className="mt-3">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--viz-track)]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${fillPercent}%`, backgroundColor: STATUS_META[status].mark }}
        />
        {/* %100 sınırı: dolgunun üzerine geldiğinde kaybolmaması için iki yanı
            yüzey rengiyle halkalanır. */}
        {isOverAchieved ? (
          <span
            className="absolute top-0 h-full w-0.5 bg-[var(--viz-ref)] shadow-[1px_0_0_var(--viz-surface),-1px_0_0_var(--viz-surface)]"
            style={{ left: `${targetPercent}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <span>0%</span>
        <span>Hedef %100</span>
      </div>
    </div>
  );
}

const TILE_SHELL = `print-block ${KPI_TILE_SHELL}`;
const TILE_ICON =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300";

function TileHeader({ label, icon: Icon }: { label: string; icon: React.ElementType }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className={TILE_ICON}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
    </div>
  );
}

function TileRows({ rows }: { rows: Array<{ label: string; value: string; status?: StatusKey }> }) {
  if (rows.length === 0) return null;
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
      {rows.map((row) => (
        <React.Fragment key={row.label}>
          <dt className="text-slate-500">{row.label}</dt>
          <dd className="text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {row.status ? <StatusValue value={row.value} status={row.status} /> : row.value}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Hedefe göre gerçekleşme kartı: büyük yüzde + ölçer + mutlak değerler. */
export function AchievementTile({
  label,
  achievement,
  forecastValue,
  targetValue,
  icon,
  valueLabel = "Forecast",
  targetLabel = "Hedef",
}: {
  label: string;
  achievement: number;
  forecastValue: number;
  targetValue: number;
  icon: React.ElementType;
  /** Gerçekleşen değerin satır etiketi (kapanış sayfasında "Kapanış" olur). */
  valueLabel?: string;
  /** Karşılaştırma tabanının etiketi (kapanışta "Forecast" da olabilir). */
  targetLabel?: string;
}) {
  const hasTarget = targetValue > 0;
  const status = hasTarget ? getAchievementStatus(achievement) : "neutral";
  const { ink, Icon: StatusIcon, label: statusLabel } = STATUS_META[status];

  return (
    <div className={TILE_SHELL}>
      <TileHeader label={label} icon={icon} />
      <div className={`mt-2 flex items-baseline gap-2 ${ink}`}>
        <span className="font-sans text-3xl font-semibold leading-none">
          {hasTarget ? formatPercent(achievement) : "—"}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold">
          <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {hasTarget ? statusLabel : `${targetLabel} yok`}
        </span>
      </div>
      {hasTarget ? <Meter value={achievement} status={status} /> : null}
      <TileRows
        rows={[
          { label: valueLabel, value: formatUSD(forecastValue) },
          { label: targetLabel, value: hasTarget ? formatUSD(targetValue) : "—" },
          ...(hasTarget
            ? [
                {
                  label: "Fark",
                  value: formatSignedUSD(forecastValue - targetValue),
                  status: (forecastValue - targetValue >= 0 ? "good" : "crit") as StatusKey,
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

/** Hedefi olmayan, tek başına okunan değer kartı. */
export function ValueTile({
  label,
  value,
  rows,
  icon,
}: {
  label: string;
  value: string;
  rows: Array<{ label: string; value: string; status?: StatusKey }>;
  icon: React.ElementType;
}) {
  return (
    <div className={TILE_SHELL}>
      <TileHeader label={label} icon={icon} />
      <div className="mt-2 break-words font-sans text-3xl font-semibold leading-none text-slate-950 dark:text-slate-100">
        {value}
      </div>
      <TileRows rows={rows} />
    </div>
  );
}

/**
 * Gerçekleşen değeri çubukla, hedefi dikey işaretle gösterir. İkisi aynı ölçeği
 * paylaşır; ayrı ölçekler hedef çizgisini anlamsız bir yere koyardı.
 *
 * Çubukta taban değer yoktur: uzunluk büyüklüğü kodladığı için sıfır, sıfır
 * genişlikte çizilir.
 */
export function ComparisonBar({
  value,
  target,
  scale,
  height = "h-5",
}: {
  value: number;
  target: number;
  scale: number;
  height?: string;
}) {
  const safeScale = Math.max(1, scale);
  const valuePercent = Math.max(0, Math.min(100, (value / safeScale) * 100));
  const targetPercent = Math.max(0, Math.min(100, (target / safeScale) * 100));

  return (
    <div className={`relative w-full rounded-sm bg-[var(--viz-track)] ${height}`}>
      <div
        className="h-full rounded-l-none rounded-r-[4px] bg-[var(--viz-series)] transition-[width] duration-500"
        style={{ width: `${valuePercent}%` }}
      />
      {/* İşaretin iki yanı yüzey rengiyle halkalanır, aksi halde dolgunun
          üzerine geldiğinde kayboluyordu. */}
      {target > 0 ? (
        <span
          className="absolute top-[-3px] h-[calc(100%+6px)] w-0.5 rounded-full bg-[var(--viz-ref)] shadow-[1px_0_0_var(--viz-surface),-1px_0_0_var(--viz-surface)]"
          style={{ left: `${targetPercent}%` }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center dark:border-slate-800 dark:bg-slate-950/20">
      <Inbox className="h-6 w-6 text-slate-400" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  );
}
