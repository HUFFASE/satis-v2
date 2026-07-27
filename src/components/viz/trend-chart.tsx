"use client";

import React, { useState } from "react";
import { LineChart, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./tiles";

export type TrendPoint = {
  /** X ekseninde görünen kısa etiket ("H5"). */
  label: string;
  value: number;
  /** Tooltip başlığı; verilmezse label kullanılır ("FY2026 Q3 H5" gibi uzun form). */
  tooltipLabel?: string;
  /** Tooltip'te değerin altında görünen ek bilgi ("16 kayıt" gibi). */
  caption?: string;
};

export type TrendMeasure = {
  key: string;
  /** Geçiş düğmesindeki kısa etiket. */
  label: string;
  /** Kart alt başlığı. */
  description: string;
  points: TrendPoint[];
  format: (value: number) => string;
  formatAxis: (value: number) => string;
  /** Yatay referans çizgisi (dönem hedefi). */
  target?: number | null;
  targetLabel?: string;
  /** Tablo görünümündeki değer kolonunun başlığı. */
  valueHeader: string;
  /** Tablo ve eksendeki dönem kolonunun başlığı. Varsayılan "Hafta". */
  periodHeader?: string;
  /**
   * Y ekseni sıfırdan başlasın mı? Tutarlarda evet (varsayılan). Dar bir bantta
   * gezinen oranlarda sıfır tabanı tüm dalgalanmayı düzleştirdiği için kapatılabilir;
   * bu durumda alan dolgusu da çizilmez, çünkü sıfırdan başlamayan bir dolgu
   * büyüklüğü olduğundan farklı gösterir.
   */
  zeroBaseline?: boolean;
};

const WIDTH = 720;
const HEIGHT = 220;
const PADDING = { top: 18, right: 20, bottom: 30, left: 66 };

/**
 * Tek ölçekli haftalık trend grafiği.
 *
 * İki ölçüyü (örneğin GP ve GP%) aynı plot'a iki ayrı eksenle çizmek, ölçeklerin
 * hizası keyfî olduğu için var olmayan bir korelasyon uydurur; bu yüzden ölçüler
 * aynı anda değil, geçiş düğmesiyle gösterilir.
 *
 * Noktalar düz çizgiyle bağlanır. Eğrisel (bezier) yumuşatma haftalar arasına
 * ölçülmemiş değerler koyar ve gerçek verinin üstüne çıkan tepeler üretebilir.
 */
function TrendPlot({ measure }: { measure: TrendMeasure }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const points = measure.points;
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const target = measure.target && measure.target > 0 ? measure.target : null;
  const zeroBaseline = measure.zeroBaseline !== false;
  // Hedef ölçeğe dahil edilmezse referans çizgisi grafiğin dışında kalır.
  const scaleValues =
    points.length > 0
      ? [...points.map((point) => point.value), ...(target !== null ? [target] : [])]
      : [0];
  const rawMax = Math.max(...scaleValues);
  const rawMin = Math.min(...scaleValues);
  // Dar bantlı serilerde bile çizginin kenarlara yapışmaması için pay bırakılır.
  const headroom = Math.max((rawMax - rawMin) * 0.25, Math.abs(rawMax) * 0.02, 0.5);
  const maxValue = zeroBaseline ? Math.max(1, rawMax) : rawMax + headroom;
  const minValue = zeroBaseline ? 0 : Math.max(0, rawMin - headroom);
  // Sıfırdan başlamayan eksen, okuyucunun ölçeği yanlış varsaymaması için işaretlenir.
  const isTruncatedAxis = !zeroBaseline && minValue > 0;
  const span = Math.max(1e-9, maxValue - minValue);
  const ticks = [0, 0.5, 1].map((ratio) => minValue + ratio * span);

  const xAt = (index: number) =>
    PADDING.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yAt = (value: number) => PADDING.top + plotHeight - ((value - minValue) / span) * plotHeight;

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xAt(index).toFixed(2)} ${yAt(point.value).toFixed(2)}`)
    .join(" ");
  const baseline = PADDING.top + plotHeight;
  const areaPath = `${linePath} L ${xAt(points.length - 1).toFixed(2)} ${baseline} L ${xAt(0).toFixed(2)} ${baseline} Z`;

  const lastIndex = points.length - 1;
  const labelStep = Math.max(1, Math.ceil(points.length / 13));
  const active = hoverIndex ?? lastIndex;
  const activePoint = points[active];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-[220px] w-full"
        role="img"
        aria-label={`${measure.label} haftalık trendi`}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke="var(--viz-grid)"
              strokeWidth="1"
            />
            <text
              x={PADDING.left - 8}
              y={yAt(tick) + 4}
              textAnchor="end"
              className="fill-slate-500 text-[11px] tabular-nums"
            >
              {measure.formatAxis(tick)}
            </text>
          </g>
        ))}

        {zeroBaseline ? <path d={areaPath} fill="var(--viz-series)" opacity="0.1" /> : null}
        <path
          d={linePath}
          fill="none"
          stroke="var(--viz-series)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Hedef çizgisi. Kesikli olması burada bilinçli: bu bir ızgara değil,
            gerçek bir eşik — kesik desen tam olarak bunu anlatır. */}
        {target !== null ? (
          <g>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={yAt(target)}
              y2={yAt(target)}
              stroke="var(--viz-ref)"
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            {/* Etiket sola yaslı: sağ üst köşe son haftanın doğrudan etiketine
                ayrılmış durumda, ikisi aynı tarafta olunca üst üste biniyordu. */}
            <text
              x={PADDING.left + 4}
              y={Math.max(10, yAt(target) - 6)}
              textAnchor="start"
              className="fill-slate-600 text-[11px] font-semibold tabular-nums dark:fill-slate-300"
            >
              {measure.targetLabel ?? "Hedef"} {measure.formatAxis(target)}
            </text>
          </g>
        ) : null}

        {/* Nokta sayısı arttığında etiketler üst üste bineceği için seyreltilir;
            son nokta her zaman etiketlenir. */}
        {points.map((point, index) =>
          // Son etiket her zaman çizildiği için, ona çok yakın düşen aralık
          // etiketi atlanır; aksi halde ikisi üst üste biniyordu.
          (index % labelStep === 0 && lastIndex - index >= labelStep) || index === lastIndex ? (
            <text
              key={`${point.label}-${index}`}
              x={xAt(index)}
              y={HEIGHT - 10}
              textAnchor="middle"
              className="fill-slate-500 text-[11px] tabular-nums"
            >
              {point.label}
            </text>
          ) : null
        )}

        <line
          x1={xAt(active)}
          x2={xAt(active)}
          y1={PADDING.top}
          y2={baseline}
          stroke="var(--viz-ref)"
          strokeWidth="1"
          opacity={hoverIndex === null ? 0 : 0.4}
        />
        {/* Yüzey renginde 2px halka, nokta çizginin üstüne bindiğinde ayrışmasını sağlar. */}
        <circle
          cx={xAt(active)}
          cy={yAt(points[active].value)}
          r="5"
          fill="var(--viz-series)"
          stroke="var(--viz-surface)"
          strokeWidth="2"
        />

        {/* Son haftanın değeri doğrudan etiketlenir; kalan haftalar eksen ve
            tooltip üzerinden okunur (her noktaya sayı yazmak grafiği boğuyor). */}
        {hoverIndex === null ? (
          <text
            x={xAt(lastIndex)}
            y={Math.max(12, yAt(points[lastIndex].value) - 12)}
            textAnchor="end"
            className="fill-slate-700 text-[11px] font-semibold tabular-nums dark:fill-slate-200"
          >
            {measure.formatAxis(points[lastIndex].value)}
          </text>
        ) : null}

        {points.map((point, index) => (
          <rect
            key={`${point.label}-${index}`}
            x={xAt(index) - plotWidth / Math.max(1, points.length) / 2}
            y={PADDING.top}
            width={plotWidth / Math.max(1, points.length)}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={() => setHoverIndex(index)}
          />
        ))}
      </svg>

      {/* Tooltip SVG değil HTML: sabit genişlikli bir <rect> içine uzun tutarlar sığmıyordu. */}
      {hoverIndex !== null && activePoint ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-slate-700 dark:bg-slate-800"
          style={{
            left: `${(xAt(active) / WIDTH) * 100}%`,
            top: `${(yAt(activePoint.value) / HEIGHT) * 100}%`,
          }}
        >
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            {activePoint.tooltipLabel ?? activePoint.label}
          </div>
          <div className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
            {measure.format(activePoint.value)}
          </div>
          {activePoint.caption ? <div className="text-[11px] text-slate-500">{activePoint.caption}</div> : null}
        </div>
      ) : null}

      {/* Kesilmiş eksen açıkça belirtilir; okuyucu ölçeğin sıfırdan başladığını
          varsayarsa dalgalanmayı olduğundan büyük görür. */}
      {isTruncatedAxis ? (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          Y ekseni {measure.formatAxis(minValue)} değerinden başlıyor.
        </p>
      ) : null}
    </div>
  );
}

/** Grafiğin WCAG-temiz ikizi: her değer tablo olarak da okunabilir. */
function TrendTable({ measure, captionHeader }: { measure: TrendMeasure; captionHeader?: string }) {
  const hasCaption = measure.points.some((point) => point.caption);
  return (
    <div className="max-h-[220px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white dark:bg-slate-900">
          <tr className="border-b border-slate-200 text-left dark:border-slate-800">
            <th className="py-1.5 font-semibold text-slate-500">{measure.periodHeader ?? "Hafta"}</th>
            <th className="py-1.5 text-right font-semibold text-slate-500">{measure.valueHeader}</th>
            {hasCaption ? (
              <th className="py-1.5 text-right font-semibold text-slate-500">{captionHeader ?? "Detay"}</th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {measure.points.map((point, index) => (
            <tr
              key={`${point.label}-${index}`}
              className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
            >
              <td className="py-1.5 font-medium text-slate-700 dark:text-slate-300">
                {point.tooltipLabel ?? point.label}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {measure.format(point.value)}
              </td>
              {hasCaption ? (
                <td className="py-1.5 text-right font-mono tabular-nums text-slate-500">{point.caption ?? "—"}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Trend kartı: başlık, ölçü geçişi (birden fazla ölçü varsa), grafik/tablo geçişi.
 * Dashboard ve Forecast sayfaları bunu paylaşır.
 */
export function TrendCard({
  title,
  icon: Icon,
  measures,
  emptyMessage,
  captionHeader,
  bare = false,
}: {
  title: string;
  icon?: React.ElementType;
  measures: TrendMeasure[];
  emptyMessage: string;
  captionHeader?: string;
  /**
   * Zaten bir kartın içine yerleştiriliyorsa kendi kabuğunu ve başlığını çizmez;
   * iç içe iki çerçeve görsel olarak ağır duruyordu.
   */
  bare?: boolean;
}) {
  const [measureKey, setMeasureKey] = useState(measures[0]?.key);
  const [showTable, setShowTable] = useState(false);

  const measure = measures.find((item) => item.key === measureKey) ?? measures[0];
  const hasData = Boolean(measure) && measure.points.some((point) => point.value !== 0);

  return (
    <div
      className={
        bare
          ? ""
          : "rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      }
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          {bare ? null : (
            <h3 className="font-serif text-lg font-bold text-[#1F3A2E] dark:text-emerald-400">{title}</h3>
          )}
          <p className="text-xs text-slate-500">{measure?.description}</p>
        </div>
        <div className="print-hide flex items-center gap-1">
          {measures.length > 1 ? (
            <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-800" role="group">
              {measures.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setMeasureKey(item.key)}
                  aria-pressed={item.key === measure?.key}
                  className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${
                    item.key === measure?.key
                      ? "bg-[#2E5A43] text-white"
                      : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
          {Icon ? <Icon className="ml-1 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" /> : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setShowTable((current) => !current)}
            aria-pressed={showTable}
            title={showTable ? "Grafiği göster" : "Tablo olarak göster"}
          >
            {showTable ? <LineChart className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {!measure || !hasData ? (
        <EmptyState message={emptyMessage} />
      ) : showTable ? (
        <TrendTable measure={measure} captionHeader={captionHeader} />
      ) : (
        <TrendPlot measure={measure} />
      )}
    </div>
  );
}
