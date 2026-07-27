const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdCompactFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatUSD(value: number) {
  return usdFormatter.format(value);
}

/** Eksen ve rozet gibi dar alanlar için kısaltılmış tutar ($1.9M). */
export function formatCompactUSD(value: number) {
  return usdCompactFormatter.format(value);
}

export function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

/** İşaretli fark: hedefin altı/üstü ayrımını sayının kendisinde taşır. */
export function formatSignedUSD(value: number) {
  return `${value >= 0 ? "+" : "−"}${formatUSD(Math.abs(value))}`;
}

export function formatSignedPoints(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)} puan`;
}
