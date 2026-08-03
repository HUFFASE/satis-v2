import { getMonthIndexInQuarter } from "@/lib/fiscal";
import { round2 } from "@/lib/monthly";
import {
  bucketKeyFromRates,
  isInvalidRateCombo,
  isTryCurrency,
  type CrmAuditDeal,
  type CrmBucketKey,
} from "./tdsynnex-parser";

/**
 * CRM çapraz kontrolünün SAF mantığı — veritabanına dokunmaz, bu yüzden
 * testlerden doğrudan çağrılabilir. DB sorgusu için bkz. weekly-crosscheck.ts
 */

export type BucketMatrix = Record<CrmBucketKey, [number, number, number]>;

export const BUCKET_KEYS: CrmBucketKey[] = [
  "w100i100",
  "w100i50",
  "w75i100",
  "w75i50",
  "w50i50",
  "w25",
];

function emptyMatrix(): BucketMatrix {
  return Object.fromEntries(BUCKET_KEYS.map((k) => [k, [0, 0, 0]])) as BucketMatrix;
}

export interface VendorCrmData {
  /** USD fırsatlar — formla karşılaştırılan matris */
  usd: BucketMatrix;
  /** TL fırsatlar — karşılaştırmaya GİRMEZ, yalnızca bilgi */
  try: BucketMatrix;
  dealCount: number;
  tryDealCount: number;
  tryTotal: number;
  /** Hiçbir kovaya girmeyen ama meşru fırsatlar (%75+0, %50+0 gibi) */
  unbucketed: { count: number; usd: number };
  /** Çelişkili oran girişi (%100 kazanma + %0 faturalanma) — hatalı veri */
  invalidEntries: { count: number; usd: number };
  /** Fatura tarihi çeyrek dışına düşen fırsatlar */
  outOfQuarter: { count: number; usd: number };
  /** Tarihi okunamayan fırsat sayısı */
  unparsedDate: number;
  /** Bu vendor için CRM verisi var mı (crmAuditJson null ise false) */
  hasData: boolean;
}

export interface CrmCrossCheck {
  /** Verinin alındığı hafta — istenen haftadan farklı olabilir, HER ZAMAN göster */
  sourceWeek: number;
  requestedWeek: number;
  byVendor: Record<string, VendorCrmData>;
  /** Vendor'a bağlanamamış marka kayıtları */
  unmatched: { vendorName: string; dealCount: number; usd: number }[];
  /** Bozuk JSON nedeniyle atlanan scorecard satırı sayısı */
  parseErrors: number;
}

export function emptyVendorData(): VendorCrmData {
  return {
    usd: emptyMatrix(),
    try: emptyMatrix(),
    dealCount: 0,
    tryDealCount: 0,
    tryTotal: 0,
    unbucketed: { count: 0, usd: 0 },
    invalidEntries: { count: 0, usd: 0 },
    outOfQuarter: { count: 0, usd: 0 },
    unparsedDate: 0,
    hasData: false,
  };
}

/** `dd/mm/yyyy` — katı biçim; başka hiçbir şey kabul edilmez. */
export function parseDealDate(dateStr: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dateStr ?? "").trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  const year = Number(m[3]);
  const d = new Date(year, month, day, 12, 0, 0, 0);
  // Taşma kontrolü (ör. 31/02/2026 → 3 Mart'a kayar, reddedilmeli)
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

/**
 * Tek bir fırsatı vendor matrisine işler.
 *
 * Kova JSON'daki `multiplier` alanından DEĞİL, oran metinlerinden hesaplanır —
 * canlı veride o alan yok. Eşleşmeyen fırsat tahmin edilmez, sayaca gider.
 */
export function applyDealToVendor(
  target: VendorCrmData,
  deal: CrmAuditDeal,
  fiscalYear: number,
  quarter: number,
): void {
  const amount = Number(deal.selling) || 0;
  target.dealCount++;

  const bucket = bucketKeyFromRates(deal.winRate, deal.invoicingWinRate);
  const isTry = isTryCurrency(deal.currency, deal.partnerCurrency);

  if (isTry) {
    target.tryDealCount++;
    target.tryTotal = round2(target.tryTotal + amount);
  }

  if (!bucket) {
    // Çelişkili giriş mi, yoksa meşru sıfır-olasılıklı fırsat mı?
    const kova = isInvalidRateCombo(deal.winRate, deal.invoicingWinRate)
      ? target.invalidEntries
      : target.unbucketed;
    kova.count++;
    if (!isTry) kova.usd = round2(kova.usd + amount);
    return;
  }

  const date = parseDealDate(deal.dateStr);
  if (!date) {
    target.unparsedDate++;
    return;
  }

  const monthIndex = getMonthIndexInQuarter(date, fiscalYear, quarter);
  if (monthIndex === null) {
    target.outOfQuarter.count++;
    if (!isTry) target.outOfQuarter.usd = round2(target.outOfQuarter.usd + amount);
    return;
  }

  const matrix = isTry ? target.try : target.usd;
  matrix[bucket][monthIndex] = round2(matrix[bucket][monthIndex] + amount);
}

/** Görünen markaların matrislerini toplar — Total sekmesi için. */
export function aggregateCrmData(all: VendorCrmData[]): VendorCrmData {
  const acc = emptyVendorData();
  for (const v of all) {
    if (!v.hasData) continue;
    acc.hasData = true;
    acc.dealCount += v.dealCount;
    acc.tryDealCount += v.tryDealCount;
    acc.tryTotal = round2(acc.tryTotal + v.tryTotal);
    acc.unbucketed.count += v.unbucketed.count;
    acc.unbucketed.usd = round2(acc.unbucketed.usd + v.unbucketed.usd);
    acc.invalidEntries.count += v.invalidEntries.count;
    acc.invalidEntries.usd = round2(acc.invalidEntries.usd + v.invalidEntries.usd);
    acc.outOfQuarter.count += v.outOfQuarter.count;
    acc.outOfQuarter.usd = round2(acc.outOfQuarter.usd + v.outOfQuarter.usd);
    acc.unparsedDate += v.unparsedDate;
    for (const k of BUCKET_KEYS) {
      for (let m = 0; m < 3; m++) {
        acc.usd[k][m] = round2(acc.usd[k][m] + v.usd[k][m]);
        acc.try[k][m] = round2(acc.try[k][m] + v.try[k][m]);
      }
    }
  }
  return acc;
}

/**
 * Bir hücrenin karşılaştırma sonucu.
 *
 * Tolerans: $1 mutlak taban + %0,5 göreli. Rakamlar 5-7 haneli ve SM
 * yuvarlayarak giriyor; tam eşitlik aramak her hücreyi işaretlerdi.
 */
export type CrmCellStatus = "match" | "warn" | "crit";

export function compareCell(formValue: number, crmValue: number): CrmCellStatus {
  const diff = Math.abs(formValue - crmValue);
  const tolerance = Math.max(1, 0.005 * Math.max(Math.abs(formValue), Math.abs(crmValue)));
  if (diff <= tolerance) return "match";
  // Tek taraflı (birinde para var diğerinde yok) her zaman kritik
  if (formValue === 0 || crmValue === 0) return "crit";
  const ratio = diff / Math.max(Math.abs(formValue), Math.abs(crmValue));
  return ratio > 0.05 ? "crit" : "warn";
}
