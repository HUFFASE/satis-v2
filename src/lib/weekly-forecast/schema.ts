import { z } from "zod";

/**
 * Excel'deki SARI (girilebilir / kilitsiz) hücrelerin tam karşılığı.
 * Kaynak: FY26Q3_BU_DataApp_Weekly Forecast report — her vendor sekmesi A1:I46.
 *
 * Üçlü diziler her zaman [M1, M2, M3] sırasındadır.
 */

/** Excel satır 32-37: win-rate / invoice-rate kovaları. Sıra Excel'deki satır sırasıdır. */
export const WIN_RATE_BUCKETS = [
  { key: "w100i100", row: 32, label: "WinRate:%100 &\nInvoiceRate:%100", weight: null },
  { key: "w100i50", row: 33, label: "WinRate:%100 &\nInvoiceRate:%50", weight: null },
  { key: "w75i100", row: 34, label: "WinRate:%75 &\nInvoiceRate:%100", weight: 1 },
  { key: "w75i50", row: 35, label: "WinRate:%75 &\nInvoiceRate:%50", weight: 0.5 },
  { key: "w50i50", row: 36, label: "WinRate:%50 &\nInvoiceRate:%50", weight: 0.25 },
  { key: "w25", row: 37, label: "WinRate:25%", weight: 0.05 },
] as const;

export type BucketKey = (typeof WIN_RATE_BUCKETS)[number]["key"];

const triple = z.tuple([z.number(), z.number(), z.number()]);

export const forecastInputsSchema = z.object({
  /** C10 — Last Officially Given OLK to Finance (NSB) */
  olkNsb: z.number(),
  /** C11 — Last Officially Given OLK to Finance (NGP) */
  olkNgp: z.number(),
  /** C15:E15 */
  invoicedNsb: triple,
  /** C16:E16 */
  invoicedGp: triple,
  /** C17:E17 */
  backlogNsb: triple,
  /** C18:E18 */
  backlogGp: triple,
  /** C21:E21 — aylık AOP hedefi (NSB) */
  targetNsb: triple,
  /** C22:E22 — aylık AOP hedefi (NGP) */
  targetNgp: triple,
  /** C25:E25 — BU Manager aylık düzeltmesi (NSB) */
  adjNsb: triple,
  /** C26:E26 — BU Manager aylık düzeltmesi (NGP) */
  adjNgp: triple,
  /** B/D/F 32:37 — CRM forecast, kova × ay */
  crm: z.object({
    w100i100: triple,
    w100i50: triple,
    w75i100: triple,
    w75i50: triple,
    w50i50: triple,
    w25: triple,
  }),
  /** C41,E41,G41 — Expected GP Total based on Weighted calculation */
  gpWeighted: triple,
  /** C42,E42,G42 — Estimated and/or realized total backend rebate */
  rebate: triple,
  /** C43,E43,G43 — Budgeted FX rate impact */
  fxImpact: triple,
  /** C44,E44,G44 — Stock Provisioning impact */
  stockProvision: triple,
});

export type ForecastInputs = z.infer<typeof forecastInputsSchema>;

const zeros = (): [number, number, number] => [0, 0, 0];

export function emptyInputs(): ForecastInputs {
  return {
    olkNsb: 0,
    olkNgp: 0,
    invoicedNsb: zeros(),
    invoicedGp: zeros(),
    backlogNsb: zeros(),
    backlogGp: zeros(),
    targetNsb: zeros(),
    targetNgp: zeros(),
    adjNsb: zeros(),
    adjNgp: zeros(),
    crm: {
      w100i100: zeros(),
      w100i50: zeros(),
      w75i100: zeros(),
      w75i50: zeros(),
      w50i50: zeros(),
      w25: zeros(),
    },
    gpWeighted: zeros(),
    rebate: zeros(),
    fxImpact: zeros(),
    stockProvision: zeros(),
  };
}

/**
 * Aylık hedef satırları (C21:E22) artık `Target` tablosundan gelir ve formda
 * salt-okunurdur. Alanlar şemada KALIR — eski sayfa JSON'ları hâlâ parse
 * edilebilmeli ve SHEET_LEGACY geri-düşmesi bunları okuyor.
 */
const TARGET_PATHS: readonly string[] = ["targetNsb", "targetNgp"].flatMap((f) =>
  [0, 1, 2].map((m) => `${f}.${m}`),
);

/** Backlog ekranından gelen invoiced/backlog satırları — formda salt-okunur. */
const ACTUAL_PATHS: readonly string[] = ["invoicedNsb", "invoicedGp", "backlogNsb", "backlogGp"].flatMap(
  (f) => [0, 1, 2].map((m) => `${f}.${m}`),
);

/** Şemadaki tüm sayısal yollar — denetim izi ve okuma için. */
export const ALL_INPUT_PATHS: readonly string[] = (() => {
  const paths: string[] = ["olkNsb", "olkNgp"];
  const tripleFields = [
    "invoicedNsb",
    "invoicedGp",
    "backlogNsb",
    "backlogGp",
    "targetNsb",
    "targetNgp",
    "adjNsb",
    "adjNgp",
    "gpWeighted",
    "rebate",
    "fxImpact",
    "stockProvision",
  ];
  for (const f of tripleFields) for (let m = 0; m < 3; m++) paths.push(`${f}.${m}`);
  for (const b of WIN_RATE_BUCKETS) for (let m = 0; m < 3; m++) paths.push(`crm.${b.key}.${m}`);
  return paths;
})();

/** SM'in gerçekten yazabildiği yollar — hedef ve actual satırları hariç. */
export const EDITABLE_INPUT_PATHS: readonly string[] = ALL_INPUT_PATHS.filter(
  (p) => !TARGET_PATHS.includes(p) && !ACTUAL_PATHS.includes(p),
);

/** WeeklyForecastSheet'e yazılmaması gereken actual kaynaklı alanları sıfırlar. */
export function stripActualBackedInputs(inputs: ForecastInputs): ForecastInputs {
  const next = structuredClone(inputs);
  next.invoicedNsb = [0, 0, 0];
  next.invoicedGp = [0, 0, 0];
  next.backlogNsb = [0, 0, 0];
  next.backlogGp = [0, 0, 0];
  return next;
}

/** Bir yolun ait olduğu ay (0/1/2); aylık olmayan hücrelerde null. */
export function monthIndexOfPath(path: string): 0 | 1 | 2 | null {
  const parts = path.split(".");
  const last = Number(parts[parts.length - 1]);
  return last === 0 || last === 1 || last === 2 ? (last as 0 | 1 | 2) : null;
}

/** Tek bir hücre güncellemesi. */
export const cellUpdateSchema = z.object({
  path: z.string().refine((p) => EDITABLE_INPUT_PATHS.includes(p), {
    message: "Bu hücre girilebilir değil (kilitli/hesaplanan hücre)",
  }),
  value: z.number().finite(),
});

export type CellUpdate = z.infer<typeof cellUpdateSchema>;

export function readPath(inputs: ForecastInputs, path: string): number {
  const parts = path.split(".");
  let node: unknown = inputs;
  for (const part of parts) {
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "number" ? node : 0;
}

export function writePath(inputs: ForecastInputs, path: string, value: number): ForecastInputs {
  const next = structuredClone(inputs);
  const parts = path.split(".");
  let node: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
  return next;
}
