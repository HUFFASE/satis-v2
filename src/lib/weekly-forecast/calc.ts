import { WIN_RATE_BUCKETS, type ForecastInputs, emptyInputs } from "./schema";

/**
 * Excel'deki her formülün birebir karşılığı.
 * Yorumlardaki hücre referansları orijinal vendor sekmesine aittir.
 */

export type Triple = [number, number, number];

const t = (a: number, b: number, c: number): Triple => [a, b, c];
const sum3 = (v: Triple) => v[0] + v[1] + v[2];
const add3 = (a: Triple, b: Triple): Triple => t(a[0] + b[0], a[1] + b[1], a[2] + b[2]);
/** Excel bölme davranışı: payda 0 ise #DIV/0! → burada null */
const div = (a: number, b: number | null): number | null =>
  b === null || b === 0 ? null : a / b;

/**
 * Formun dışından gelen, veritabanının sahibi olduğu değerler.
 *
 * Excel'de AOP, aylık hedef satırlarının toplamıydı (B10 = C21+D21+E21).
 * Burada hem AOP hem aylık hedefler `Target` tablosundan gelir ve formda
 * salt-okunurdur — Hedefler ekranından direktörler yönetir.
 */
export interface ForecastContext {
  /** Target.revenue — Excel B10. null = bu vendor için hedef girilmemiş */
  aopNsb: number | null;
  /** Target.gp — Excel B11 */
  aopNgp: number | null;
  /** Target.revenueM1..M3 — Excel C21:E21. null = aylık kırılım girilmemiş */
  targetNsbMonthly: Triple | null;
  /** Target.gpM1..M3 — Excel C22:E22 */
  targetNgpMonthly: Triple | null;
}

export const EMPTY_CONTEXT: ForecastContext = {
  aopNsb: null,
  aopNgp: null,
  targetNsbMonthly: null,
  targetNgpMonthly: null,
};

/** Aylık hedef satırlarının kaynağı — arayüzde nasıl gösterileceğini belirler. */
export type TargetSource = "TARGET_MONTHLY" | "SHEET_LEGACY" | "QUARTER_ONLY";

export interface ForecastComputed {
  /** satır 32-37, "CRM forecast" kolonları (B/D/F) — girdinin aynası */
  crmByBucket: Record<string, Triple>;
  /** satır 32-37, "Weighted Expectation" kolonları (C/E/G). null = N/A */
  weightedByBucket: Record<string, Triple | null>;
  /** H32:H37 — CRM forecast Q toplamı */
  crmQTotalByBucket: Record<string, number>;
  /** I34:I37 — Weighted Q toplamı. null = N/A */
  weightedQTotalByBucket: Record<string, number | null>;

  /** C38,E38,G38 — Expected NSB Total (aylık) */
  expectedNsb: Triple;
  /** I38 */
  expectedNsbQ: number;
  /** I39 — Expected NSB Total /W Backlog + Invoiced */
  expectedNsbWithBase: number;

  /** I41,I42,I43,I44 */
  gpWeightedQ: number;
  rebateQ: number;
  fxImpactQ: number;
  stockProvisionQ: number;
  /** I45 — EXPECTED NGP total */
  expectedNgpQ: number;
  /** I46 — EXPECTED NGP total /W Backlog + Invoiced */
  expectedNgpWithBase: number;

  /** B15:B18 — çeyrek toplamları */
  invoicedNsbQ: number;
  invoicedGpQ: number;
  backlogNsbQ: number;
  backlogGpQ: number;

  /** satır 21 — M Vendor NSB - Target (SM'in aylık dağıtımı) */
  targetNsbTotal: number; // F21
  targetNsbDiff: number; // G21
  /** satır 22 */
  targetNgpTotal: number; // F22
  targetNgpDiff: number; // G22

  /**
   * Aylık dağıtımın resmi hedefe göre sapması: F21 - AOP.
   * Aylık hedefler Target'tan geldiğinde bu her zaman 0'dır; yalnızca eski
   * sayfa verisi (SHEET_LEGACY) kullanılıyorsa sıfırdan farklı olabilir.
   */
  targetNsbVariance: number | null;
  targetNgpVariance: number | null;

  /** Aylık hedef satırlarının hangi kaynaktan geldiği. */
  targetSource: TargetSource;
  /** C21:E21 — gösterilecek aylık hedefler. null = kırılım yok, satır boş. */
  targetNsbResolved: Triple | null;
  /** C22:E22 */
  targetNgpResolved: Triple | null;

  /** satır 23 — M Vendor NSB - Forecast (aylık) */
  forecastNsb: Triple; // C23:E23
  forecastNsbTotal: number; // F23
  forecastNsbDiff: number; // G23
  /** satır 24 — M Vendor NGP - Forecast */
  forecastNgp: Triple; // C24:E24
  forecastNgpTotal: number; // F24
  forecastNgpDiff: number; // G24

  /** F25 / F26 */
  adjNsbTotal: number;
  adjNgpTotal: number;

  /** satır 27/28 — GP% (aylık + toplam). null = N/A (sıfıra bölme) */
  gpPctTarget: [number | null, number | null, number | null, number | null];
  gpPctForecast: [number | null, number | null, number | null, number | null];

  /** satır 10 — Q Vendor NSB. AOP artık Target tablosundan gelir. */
  aopNsb: number | null; // B10
  qNsbForecast: number; // E10
  qNsbAdjustment: number; // F10
  qNsbTotal: number; // G10
  qNsbAopAchievement: number | null; // H10
  qNsbOlkAchievement: number | null; // I10

  /** satır 11 — Q Vendor NGP */
  aopNgp: number | null; // B11
  qNgpForecast: number; // E11
  qNgpAdjustment: number; // F11
  qNgpTotal: number; // G11
  qNgpAopAchievement: number | null; // H11
  qNgpOlkAchievement: number | null; // I11
}

export function computeForecast(
  i: ForecastInputs,
  ctx: ForecastContext = EMPTY_CONTEXT,
): ForecastComputed {
  const crmByBucket: Record<string, Triple> = {};
  const weightedByBucket: Record<string, Triple | null> = {};
  const crmQTotalByBucket: Record<string, number> = {};
  const weightedQTotalByBucket: Record<string, number | null> = {};

  for (const b of WIN_RATE_BUCKETS) {
    const crm = i.crm[b.key] as Triple;
    crmByBucket[b.key] = crm;
    crmQTotalByBucket[b.key] = sum3(crm); // H32:H37 = B+D+F
    if (b.weight === null) {
      // C32/E32/G32 ve C33/E33/G33 → "N/A"
      weightedByBucket[b.key] = null;
      weightedQTotalByBucket[b.key] = null;
    } else {
      const w = t(crm[0] * b.weight, crm[1] * b.weight, crm[2] * b.weight);
      weightedByBucket[b.key] = w;
      weightedQTotalByBucket[b.key] = sum3(w); // I34:I37 = C+E+G
    }
  }

  // C38 = C34+C35+C36+C37 (N/A satırları hesaba katılmaz)
  const weightedRows = WIN_RATE_BUCKETS.filter((b) => b.weight !== null).map(
    (b) => weightedByBucket[b.key] as Triple,
  );
  const expectedNsb = weightedRows.reduce<Triple>((acc, v) => add3(acc, v), t(0, 0, 0));
  const expectedNsbQ = sum3(expectedNsb); // I38 = SUM(I34:I37)

  // B15:B18 = C+D+E
  const invoicedNsbQ = sum3(i.invoicedNsb);
  const invoicedGpQ = sum3(i.invoicedGp);
  const backlogNsbQ = sum3(i.backlogNsb);
  const backlogGpQ = sum3(i.backlogGp);

  // I39 = I38 + B15 + B17
  const expectedNsbWithBase = expectedNsbQ + invoicedNsbQ + backlogNsbQ;

  // I41..I44 = C+E+G
  const gpWeightedQ = sum3(i.gpWeighted);
  const rebateQ = sum3(i.rebate);
  const fxImpactQ = sum3(i.fxImpact);
  const stockProvisionQ = sum3(i.stockProvision);
  // I45 = I41+I42+I43+I44 ; I46 = I45 + B16 + B18
  const expectedNgpQ = gpWeightedQ + rebateQ + fxImpactQ + stockProvisionQ;
  const expectedNgpWithBase = expectedNgpQ + invoicedGpQ + backlogGpQ;

  // C23 = C38+C15+C17 | D23 = E38+D15+D17 | E23 = G38+E15+E17
  const forecastNsb = t(
    expectedNsb[0] + i.invoicedNsb[0] + i.backlogNsb[0],
    expectedNsb[1] + i.invoicedNsb[1] + i.backlogNsb[1],
    expectedNsb[2] + i.invoicedNsb[2] + i.backlogNsb[2],
  );
  // C24 = SUM(C41:C44)+C16+C18 (aylık GP kalemleri + invoiced + backlog)
  const gpMonthly = (m: number) =>
    i.gpWeighted[m] + i.rebate[m] + i.fxImpact[m] + i.stockProvision[m];
  const forecastNgp = t(
    gpMonthly(0) + i.invoicedGp[0] + i.backlogGp[0],
    gpMonthly(1) + i.invoicedGp[1] + i.backlogGp[1],
    gpMonthly(2) + i.invoicedGp[2] + i.backlogGp[2],
  );

  // B10/B11 (AOP) ve C21:E22 (aylık hedefler) artık Target tablosundan gelir.
  //
  // Geri-düşme merdiveni:
  //  TARGET_MONTHLY — Hedefler ekranında aylık kırılım var, onu kullan
  //  SHEET_LEGACY   — kırılım yok ama sayfada eskiden elle girilmiş değer var,
  //                   veriyi görsel olarak silmemek için onu göster
  //  QUARTER_ONLY   — ikisi de yok; satırlar boş, F21 çeyrek toplamına düşer
  const aopNsb = ctx.aopNsb;
  const aopNgp = ctx.aopNgp;

  const sheetHasLegacyTarget = sum3(i.targetNsb) !== 0 || sum3(i.targetNgp) !== 0;
  const targetSource: TargetSource =
    ctx.targetNsbMonthly && ctx.targetNgpMonthly
      ? "TARGET_MONTHLY"
      : sheetHasLegacyTarget
        ? "SHEET_LEGACY"
        : "QUARTER_ONLY";

  const tNsb: Triple = ctx.targetNsbMonthly ?? i.targetNsb;
  const tNgp: Triple = ctx.targetNgpMonthly ?? i.targetNgp;

  // QUARTER_ONLY'de aylık satırlar boştur ama F21 çeyrek hedefini göstermeli ki
  // AOP karşılaştırması yanıltıcı olmasın.
  const targetNsbTotal = targetSource === "QUARTER_ONLY" ? (aopNsb ?? 0) : sum3(tNsb); // F21
  const targetNgpTotal = targetSource === "QUARTER_ONLY" ? (aopNgp ?? 0) : sum3(tNgp); // F22
  const targetNsbVariance = aopNsb === null ? null : targetNsbTotal - aopNsb;
  const targetNgpVariance = aopNgp === null ? null : targetNgpTotal - aopNgp;
  // G21 = -1*(B21-F21), B21 = OLK
  const targetNsbDiff = targetNsbTotal - i.olkNsb;
  const targetNgpDiff = targetNgpTotal - i.olkNgp;

  const forecastNsbTotal = sum3(forecastNsb); // F23
  const forecastNgpTotal = sum3(forecastNgp); // F24
  // G23 = -1*(B21-F23) — B21 = OLK NSB
  const forecastNsbDiff = forecastNsbTotal - i.olkNsb;
  const forecastNgpDiff = forecastNgpTotal - i.olkNgp;

  const adjNsbTotal = sum3(i.adjNsb); // F25
  const adjNgpTotal = sum3(i.adjNgp); // F26

  // satır 27 = row22/row21 ; satır 28 = (row24+row26)/(row23+row25)
  // Çözümlenmiş aylık hedefler üzerinden — QUARTER_ONLY'de aylık kırılım
  // olmadığı için N/A çıkar, bu doğru davranıştır (uydurma oran üretmez).
  const gpPctTarget: (number | null)[] =
    targetSource === "QUARTER_ONLY"
      ? [null, null, null]
      : [0, 1, 2].map((m) => div(tNgp[m], tNsb[m]));
  gpPctTarget.push(div(targetNgpTotal, targetNsbTotal));
  const gpPctForecast: (number | null)[] = [0, 1, 2].map((m) =>
    div(forecastNgp[m] + i.adjNgp[m], forecastNsb[m] + i.adjNsb[m]),
  );
  gpPctForecast.push(div(forecastNgpTotal + adjNgpTotal, forecastNsbTotal + adjNsbTotal));

  // satır 10/11: E=I39/I46, F=F25/F26, G=E+F, H=G/B, I=G/C
  const qNsbForecast = expectedNsbWithBase;
  const qNsbAdjustment = adjNsbTotal;
  const qNsbTotal = qNsbForecast + qNsbAdjustment;
  const qNgpForecast = expectedNgpWithBase;
  const qNgpAdjustment = adjNgpTotal;
  const qNgpTotal = qNgpForecast + qNgpAdjustment;

  return {
    crmByBucket,
    weightedByBucket,
    crmQTotalByBucket,
    weightedQTotalByBucket,
    expectedNsb,
    expectedNsbQ,
    expectedNsbWithBase,
    gpWeightedQ,
    rebateQ,
    fxImpactQ,
    stockProvisionQ,
    expectedNgpQ,
    expectedNgpWithBase,
    invoicedNsbQ,
    invoicedGpQ,
    backlogNsbQ,
    backlogGpQ,
    targetNsbTotal,
    targetNsbDiff,
    targetNgpTotal,
    targetNgpDiff,
    targetNsbVariance,
    targetNgpVariance,
    targetSource,
    targetNsbResolved: targetSource === "QUARTER_ONLY" ? null : tNsb,
    targetNgpResolved: targetSource === "QUARTER_ONLY" ? null : tNgp,
    forecastNsb,
    forecastNsbTotal,
    forecastNsbDiff,
    forecastNgp,
    forecastNgpTotal,
    forecastNgpDiff,
    adjNsbTotal,
    adjNgpTotal,
    gpPctTarget: gpPctTarget as ForecastComputed["gpPctTarget"],
    gpPctForecast: gpPctForecast as ForecastComputed["gpPctForecast"],
    aopNsb,
    qNsbForecast,
    qNsbAdjustment,
    qNsbTotal,
    qNsbAopAchievement: div(qNsbTotal, aopNsb),
    qNsbOlkAchievement: div(qNsbTotal, i.olkNsb),
    aopNgp,
    qNgpForecast,
    qNgpAdjustment,
    qNgpTotal,
    qNgpAopAchievement: div(qNgpTotal, aopNgp),
    qNgpOlkAchievement: div(qNgpTotal, i.olkNgp),
  };
}

/**
 * Total sekmesi: Excel'de her hücre marka sekmelerinin toplamıdır.
 * Girdileri toplayıp aynı formül setini uygulamak, hücre bazında toplamakla
 * özdeştir (tüm formüller toplamaya göre lineer olduğundan) — tek istisna
 * GP%% ve achievement oranları, ki Excel'de de toplamlardan yeniden hesaplanır.
 */
export function aggregateInputs(all: ForecastInputs[]): ForecastInputs {
  const acc = emptyInputs();
  const addTriple = (a: Triple, b: Triple): Triple => add3(a, b);
  for (const i of all) {
    acc.olkNsb += i.olkNsb;
    acc.olkNgp += i.olkNgp;
    acc.invoicedNsb = addTriple(acc.invoicedNsb, i.invoicedNsb);
    acc.invoicedGp = addTriple(acc.invoicedGp, i.invoicedGp);
    acc.backlogNsb = addTriple(acc.backlogNsb, i.backlogNsb);
    acc.backlogGp = addTriple(acc.backlogGp, i.backlogGp);
    acc.targetNsb = addTriple(acc.targetNsb, i.targetNsb);
    acc.targetNgp = addTriple(acc.targetNgp, i.targetNgp);
    acc.adjNsb = addTriple(acc.adjNsb, i.adjNsb);
    acc.adjNgp = addTriple(acc.adjNgp, i.adjNgp);
    for (const b of WIN_RATE_BUCKETS) {
      acc.crm[b.key] = addTriple(acc.crm[b.key], i.crm[b.key]);
    }
    acc.gpWeighted = addTriple(acc.gpWeighted, i.gpWeighted);
    acc.rebate = addTriple(acc.rebate, i.rebate);
    acc.fxImpact = addTriple(acc.fxImpact, i.fxImpact);
    acc.stockProvision = addTriple(acc.stockProvision, i.stockProvision);
  }
  return acc;
}

/**
 * Total sekmesinin AOP'si: görünen markaların Target toplamı.
 * Hiçbirinde hedef yoksa null döner (achievement N/A olur); bazılarında varsa
 * yalnızca hedefi olanlar toplanır.
 */
export function aggregateContexts(all: ForecastContext[]): ForecastContext {
  const sumScalar = (key: "aopNsb" | "aopNgp") => {
    const values = all.map((c) => c[key]).filter((v): v is number => v !== null);
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
  };
  // Aylık üçlüler eleman bazında toplanır; hiçbirinde kırılım yoksa null kalır
  // ki Total sekmesi de "kırılım girilmemiş" durumunu doğru gösterebilsin.
  const sumTripleKey = (key: "targetNsbMonthly" | "targetNgpMonthly"): Triple | null => {
    const values = all.map((c) => c[key]).filter((v): v is Triple => v !== null);
    if (values.length === 0) return null;
    return values.reduce<Triple>((acc, v) => add3(acc, v), t(0, 0, 0));
  };
  return {
    aopNsb: sumScalar("aopNsb"),
    aopNgp: sumScalar("aopNgp"),
    targetNsbMonthly: sumTripleKey("targetNsbMonthly"),
    targetNgpMonthly: sumTripleKey("targetNgpMonthly"),
  };
}
