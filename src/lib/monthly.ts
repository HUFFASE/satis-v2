/**
 * Çeyrek içi aylık kırılım yardımcıları.
 *
 * `Target` ve `Closing` tabloları çeyrek toplamını (`revenue`/`gp`) tutmaya
 * devam eder; aylık kolonlar (`revenueM1..M3`, `gpM1..M3`) buna ek olarak
 * gelir. Aylık alanlar ya hep birlikte dolu olur ya da hep birlikte null'dur —
 * null "henüz girilmemiş" demektir ve sıfırdan farklıdır.
 */

export type MonthlyTriple = [number, number, number];

/** Aylık kolonları olan herhangi bir kayıt (Target ya da Closing). */
interface MonthlyColumns {
  revenue: unknown;
  gp: unknown;
  revenueM1: unknown;
  revenueM2: unknown;
  revenueM3: unknown;
  gpM1: unknown;
  gpM2: unknown;
  gpM3: unknown;
}

const isFilled = (v: unknown) => v !== null && v !== undefined;

/** Prisma Decimal | number | string → number */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value.toString());
}

/**
 * Aylık kırılım girilmiş mi? Ya altısı da dolu ya da hiçbiri.
 * Kısmi giriş yazma katmanında reddedilir; buraya yalnızca doğrudan SQL ile
 * gelebilir, o durumda "girilmemiş" sayılır.
 */
export function hasMonthlyBreakdown(row: MonthlyColumns | null | undefined): boolean {
  if (!row) return false;
  return (
    isFilled(row.revenueM1) &&
    isFilled(row.revenueM2) &&
    isFilled(row.revenueM3) &&
    isFilled(row.gpM1) &&
    isFilled(row.gpM2) &&
    isFilled(row.gpM3)
  );
}

/**
 * Aylık üçlüleri döndürür. Kırılım yoksa `null` — çağıran taraf bunu
 * "girilmemiş" olarak göstermeli, sıfır olarak DEĞİL.
 */
export function monthlyTriples(
  row: MonthlyColumns | null | undefined,
): { revenue: MonthlyTriple; gp: MonthlyTriple } | null {
  if (!hasMonthlyBreakdown(row)) return null;
  const r = row as MonthlyColumns;
  return {
    revenue: [toNumber(r.revenueM1), toNumber(r.revenueM2), toNumber(r.revenueM3)],
    gp: [toNumber(r.gpM1), toNumber(r.gpM2), toNumber(r.gpM3)],
  };
}

/** Para tutarlarını kuruşa yuvarlar — Decimal(18,2)'ye yazmadan önce şart. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sumTriple(triple: MonthlyTriple): number {
  return round2(triple[0] + triple[1] + triple[2]);
}

/** Kuruş toleransı: float toplamları tam eşitlikle karşılaştırılamaz. */
export const MONTHLY_SUM_TOLERANCE = 0.01;

/** Aylık kolonları olan Actual kaydı. */
export interface ActualMonthlyColumns {
  invoicedNsbM1: unknown;
  invoicedNsbM2: unknown;
  invoicedNsbM3: unknown;
  invoicedGpM1: unknown;
  invoicedGpM2: unknown;
  invoicedGpM3: unknown;
  backlogNsbM1: unknown;
  backlogNsbM2: unknown;
  backlogNsbM3: unknown;
  backlogGpM1: unknown;
  backlogGpM2: unknown;
  backlogGpM3: unknown;
}

const ACTUAL_MONTHLY_FIELDS: (keyof ActualMonthlyColumns)[] = [
  "invoicedNsbM1",
  "invoicedNsbM2",
  "invoicedNsbM3",
  "invoicedGpM1",
  "invoicedGpM2",
  "invoicedGpM3",
  "backlogNsbM1",
  "backlogNsbM2",
  "backlogNsbM3",
  "backlogGpM1",
  "backlogGpM2",
  "backlogGpM3",
];

export function hasActualMonthlyBreakdown(row: ActualMonthlyColumns | null | undefined): boolean {
  if (!row) return false;
  return ACTUAL_MONTHLY_FIELDS.every((field) => isFilled(row[field]));
}

export function actualMonthlyTriples(
  row: ActualMonthlyColumns | null | undefined,
): {
  invoicedNsb: MonthlyTriple;
  invoicedGp: MonthlyTriple;
  backlogNsb: MonthlyTriple;
  backlogGp: MonthlyTriple;
} | null {
  if (!hasActualMonthlyBreakdown(row)) return null;
  const r = row as ActualMonthlyColumns;
  return {
    invoicedNsb: [toNumber(r.invoicedNsbM1), toNumber(r.invoicedNsbM2), toNumber(r.invoicedNsbM3)],
    invoicedGp: [toNumber(r.invoicedGpM1), toNumber(r.invoicedGpM2), toNumber(r.invoicedGpM3)],
    backlogNsb: [toNumber(r.backlogNsbM1), toNumber(r.backlogNsbM2), toNumber(r.backlogNsbM3)],
    backlogGp: [toNumber(r.backlogGpM1), toNumber(r.backlogGpM2), toNumber(r.backlogGpM3)],
  };
}

/** Aylık toplam çeyrek değeriyle tutuyor mu? */
export function monthlySumMatches(triple: MonthlyTriple, quarterTotal: number): boolean {
  return Math.abs(sumTriple(triple) - quarterTotal) <= MONTHLY_SUM_TOLERANCE;
}

/** Çeyrek Invoiced NSB + Backlog NSB (Excel Q3 NSB Inv.+Backl.). */
export function actualDisplayNsbTotal(
  row: { invoiced: unknown; backlog: unknown } | null | undefined,
): number {
  if (!row) return 0;
  return round2(toNumber(row.invoiced) + toNumber(row.backlog));
}

/** Çeyrek Invoiced GP + Backlog GP toplamı. */
export function actualDisplayGpTotal(row: ActualMonthlyColumns | null | undefined): number {
  if (!row) return 0;
  const invoicedGp = round2(
    toNumber(row.invoicedGpM1) + toNumber(row.invoicedGpM2) + toNumber(row.invoicedGpM3),
  );
  const backlogGp = round2(
    toNumber(row.backlogGpM1) + toNumber(row.backlogGpM2) + toNumber(row.backlogGpM3),
  );
  const hasGpBreakdown =
    isFilled(row.invoicedGpM1) ||
    isFilled(row.invoicedGpM2) ||
    isFilled(row.invoicedGpM3) ||
    isFilled(row.backlogGpM1) ||
    isFilled(row.backlogGpM2) ||
    isFilled(row.backlogGpM3);
  if (hasGpBreakdown) {
    return round2(invoicedGp + backlogGp);
  }
  return 0;
}
