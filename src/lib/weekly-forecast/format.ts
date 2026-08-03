/**
 * Form hücrelerine özel biçimleyiciler.
 *
 * Uygulamanın geri kalanı `@/components/viz/format` kullanır (kuruşsuz $1,234).
 * Bu form Excel'in accounting formatını birebir taklit ettiği için — iki ondalık
 * ve sıfır yerine "-" — ayrı bir biçimleyici gerekiyor.
 */

const accounting = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Excel: _("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_) */
export function formatSheetCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value === 0) return "$  -";
  const abs = accounting.format(Math.abs(value));
  return value < 0 ? `$ (${abs})` : `$ ${abs}`;
}

/** Excel biçimi "0%" */
export function formatSheetPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `${Math.round(value * 100)}%`;
}

/** Girdi kutusuna odaklanıldığında gösterilen ham biçim. */
export function formatEditable(value: number): string {
  return value === 0 ? "" : String(value);
}

export function parseNumberInput(raw: string): number | null {
  const cleaned = raw.replace(/[\s,$]/g, "").replace(/\.(?=.*\.)/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
