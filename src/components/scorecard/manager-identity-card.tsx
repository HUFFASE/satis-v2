"use client";

import React, { useState } from "react";
import type { ManagerProfileCard } from "@/app/(app)/scorecard/actions";
import { formatPercent, formatUSD } from "@/components/viz/format";
import {
  STATUS_META,
  StatusKey,
  getAchievementStatus,
  getGpStatus,
} from "@/components/viz/status";
import { EmptyState } from "@/components/viz/tiles";
import { CARD_HOVER_SHADOW } from "@/components/viz/card-shell";

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** CRM hijyen skorunun durum karşılığı. */
function getHygieneStatus(score: number | null): StatusKey {
  if (score === null) return "neutral";
  if (score >= 90) return "good";
  if (score >= 80) return "warn";
  return "crit";
}

/**
 * Profil fotoğrafı. Kaynak, yöneticiler tarafından serbestçe girilen bir URL
 * olduğu için next/image kullanılmıyor: uzak alan adları önceden bilinemediğinden
 * next.config'e whitelist yazılamaz. Görsel yoksa veya yüklenemezse baş harfler
 * gösterilir.
 */
function ManagerPhoto({
  name,
  imageUrl,
  className = "",
  textClassName = "",
  rounded = "rounded-md",
}: {
  name: string;
  imageUrl: string | null;
  className?: string;
  textClassName?: string;
  rounded?: string;
}) {
  const [hasFailed, setHasFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !hasFailed;

  /**
   * Görsel, React olay dinleyicisi bağlanmadan önce (sunucudan gelen HTML
   * ayrıştırılırken) hata verirse `onError` hiç çalışmaz ve kırık görsel
   * simgesi ekranda kalır. Bağlandığı anda yükleme durumunu ayrıca kontrol
   * etmek bu durumu da yakalar.
   */
  const detectAlreadyFailed = (node: HTMLImageElement | null) => {
    if (node && node.complete && node.naturalWidth === 0) setHasFailed(true);
  };

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-emerald-800 font-semibold text-emerald-50 ${rounded} ${className}`}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={detectAlreadyFailed}
          src={imageUrl as string}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setHasFailed(true)}
        />
      ) : (
        <span className={textClassName}>{getInitials(name)}</span>
      )}
    </span>
  );
}

/**
 * Kimlik kartı alanı: harf aralıklı küçük etiket üstte, değer altta —
 * resmi kimlik belgelerindeki alan düzeni.
 */
function IdField({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status?: StatusKey;
}) {
  const meta = status ? STATUS_META[status] : null;
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </div>
      <div
        className={`mt-0.5 flex items-center gap-1 font-mono text-sm font-bold tabular-nums ${
          meta ? meta.ink : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {meta ? <meta.Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

/**
 * Satış müdürü kimlik kartı ve altındaki seçici şerit.
 *
 * Değerler karne tablosundan değil dönemin forecast/hedef kayıtlarından gelir;
 * karne tablosundaki başarım kolonları veritabanında hiç doldurulmuyor.
 */
export function ManagerIdentityCard({
  managers,
  selectedUserId,
  onSelect,
  periodLabel,
}: {
  managers: ManagerProfileCard[];
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
  periodLabel: string;
}) {
  if (managers.length === 0) {
    return <EmptyState message="Görüntülenecek satış müdürü bulunmuyor." />;
  }

  const selected = managers.find((manager) => manager.userId === selectedUserId) ?? managers[0];
  const hasTarget = selected.targetGp > 0;
  const hygieneStatus = getHygieneStatus(selected.crmHealthScore);

  return (
    <section className="print-block space-y-6">
      {/* Kart sayfada ortalanır ve kimlik kartı oranlarında dar tutulur. */}
      <div className={`mx-auto w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${CARD_HOVER_SHADOW}`}>
        {/* Belge başlığı bandı */}
        <div className="flex items-center justify-between gap-3 bg-[#1F3A2E] px-4 py-2 text-emerald-50">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em]">
            Satış Müdürü Karnesi
          </span>
          <span className="text-[11px] font-medium text-emerald-200">{periodLabel}</span>
        </div>

        <div className="flex gap-4 p-4">
          {/* Vesikalık: resmi belgelerdeki gibi dikdörtgen ve sol üstte */}
          <ManagerPhoto
            name={selected.managerName}
            imageUrl={selected.imageUrl}
            className="h-[104px] w-20 border border-slate-200 dark:border-slate-700"
            textClassName="text-xl"
          />

          <div className="min-w-0 flex-1">
            <IdField label="Adı Soyadı" value={selected.managerName} />

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <IdField label="Forecast NSB" value={formatUSD(selected.forecastRevenue)} />
              <IdField label="Forecast GP" value={formatUSD(selected.forecastGp)} />
              <IdField
                label="Kârlılık"
                value={formatPercent(selected.forecastGpPercent)}
                status={
                  selected.targetGpPercent > 0
                    ? getGpStatus(selected.forecastGpPercent, selected.targetGpPercent)
                    : undefined
                }
              />
              <IdField
                label="GP Achievement"
                value={hasTarget ? formatPercent(selected.gpAchievement) : "—"}
                status={hasTarget ? getAchievementStatus(selected.gpAchievement) : "neutral"}
              />
              <IdField
                label="Marka"
                value={`${selected.forecastedVendorCount}/${selected.vendorCount}`}
              />
              <IdField
                label="Hijyen Skoru"
                value={selected.crmHealthScore === null ? "—" : `%${selected.crmHealthScore}`}
                status={hygieneStatus}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Seçici şerit: kartın altında, ortalanmış */}
      {managers.length > 1 ? (
        <div className="print-hide flex flex-wrap items-start justify-center gap-6">
          {managers.map((manager) => {
            const isSelected = manager.userId === selected.userId;
            const status = getHygieneStatus(manager.crmHealthScore);

            return (
              <button
                key={manager.userId}
                type="button"
                onClick={() => onSelect(manager.userId)}
                aria-pressed={isSelected}
                title={
                  manager.crmHealthScore === null
                    ? `${manager.managerName} — CRM karnesi yok`
                    : `${manager.managerName} — hijyen %${manager.crmHealthScore}`
                }
                className="group flex w-24 flex-col items-center gap-2"
              >
                <span className="relative">
                  <ManagerPhoto
                    name={manager.managerName}
                    imageUrl={manager.imageUrl}
                    rounded="rounded-full"
                    className={`h-16 w-16 transition-all ${
                      isSelected
                        ? "ring-2 ring-[#1F3A2E] ring-offset-2 dark:ring-emerald-400 dark:ring-offset-slate-950"
                        : "ring-1 ring-slate-200 group-hover:ring-slate-400 dark:ring-slate-700"
                    }`}
                    textClassName="text-base"
                  />
                  {/* Hijyen durumu renk dışında ikonla da taşınır. */}
                  <span
                    className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white dark:bg-slate-900"
                    aria-hidden="true"
                  >
                    {React.createElement(STATUS_META[status].Icon, {
                      className: `h-4 w-4 ${STATUS_META[status].ink}`,
                    })}
                  </span>
                </span>
                <span
                  className={`line-clamp-2 text-center text-[11px] leading-tight ${
                    isSelected
                      ? "font-bold text-[#1F3A2E] dark:text-emerald-300"
                      : "font-medium text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {manager.managerName}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
