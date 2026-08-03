"use client";

import type { ForecastComputed } from "@/lib/weekly-forecast/calc";
import { WIN_RATE_BUCKETS, type ForecastInputs } from "@/lib/weekly-forecast/schema";
import { compareCell } from "@/lib/crm/crosscheck-core";
import { formatSheetCurrency } from "@/lib/weekly-forecast/format";
import { round2 } from "@/lib/monthly";
import {
  ComputedCell,
  EmptyCell,
  HeaderCell,
  InputCell,
  LabelCell,
  type CrmMarker,
} from "./sheet-cells";

/**
 * Excel sekmesinin (A1:I46) birebir karşılığı.
 * Yorumlardaki satır/sütun referansları orijinal dosyaya aittir.
 */

interface Props {
  inputs: ForecastInputs;
  computed: ForecastComputed;
  monthLabels: string[];
  /** Total sekmesi ve kapatılmış dönemlerde true — hiçbir hücre girilemez. */
  readOnly: boolean;
  /**
   * Takvim olarak kapanmış aylar [M1,M2,M3]. Kapanan ayın hücreleri
   * salt-okunur olur; aylık olmayan hücreler (OLK) bundan etkilenmez.
   */
  closedMonths?: [boolean, boolean, boolean];
  /**
   * CRM karşılaştırması — yalnızca win-rate kova hücrelerine (satır 32-37)
   * uygulanır, çünkü CRM'de karşılığı olan tek alan orası.
   */
  crm?: {
    /** kova anahtarı → [M1,M2,M3] CRM tutarları (USD) */
    usd: Record<string, [number, number, number]>;
    /** Karşılaştırma modu açık mı — kapalıyken yalnızca sapma ikonu görünür */
    showValues: boolean;
    sourceWeek: number;
  } | null;
  onCellChange: (path: string, value: number) => void;
}

const MONTHS = [0, 1, 2] as const;
const NO_CLOSED: [boolean, boolean, boolean] = [false, false, false];

export function ForecastSheet({
  inputs,
  computed: c,
  monthLabels,
  readOnly,
  closedMonths = NO_CLOSED,
  crm = null,
  onCellChange,
}: Props) {
  /** Kova hücresi için CRM karşılaştırma işareti. */
  const crmMarker = (bucketKey: string, month: 0 | 1 | 2, formValue: number): CrmMarker | undefined => {
    const row = crm?.usd[bucketKey];
    if (!row) return undefined;
    const crmValue = row[month];
    // İki taraf da sıfırsa gösterecek bir şey yok — gürültü yapma
    if (crmValue === 0 && formValue === 0) return undefined;
    const status = compareCell(formValue, crmValue);
    const diff = round2(formValue - crmValue);
    return {
      crmValue,
      diff,
      status,
      dealCount: 0,
      showValue: crm!.showValues,
      tooltip:
        `${monthLabels[month]} · CRM (${crm!.sourceWeek}. hafta): ${formatSheetCurrency(crmValue)} · ` +
        `Form: ${formatSheetCurrency(formValue)} · ` +
        (status === "match"
          ? "tutuyor"
          : `fark ${diff > 0 ? "+" : ""}${formatSheetCurrency(diff)}`),
    };
  };
  /**
   * Sarı hücre. Salt-okunur modda ya da ayı kapanmışsa hesaplanan gibi
   * gösterilir. `month` verilmezse hücre aylık değildir (ör. OLK).
   */
  const cell = (path: string, value: number, month?: 0 | 1 | 2, crmMark?: CrmMarker) => {
    const monthClosed = month !== undefined && closedMonths[month];
    if (readOnly || monthClosed) {
      // Kapalı ay da olsa CRM sapması görünmeli — SM düzeltemez ama bilmeli.
      // İşaret ComputedCell'e de geçirilir, aksi halde CRM denetiminin çoğu
      // (kapanmış aylara düşen kısmı) görünmez olurdu.
      return (
        <ComputedCell
          key={path}
          value={value}
          crm={crmMark}
          title={
            monthClosed
              ? `${monthLabels[month]} kapandı — bu ay üzerinde değişiklik yapılamaz`
              : undefined
          }
        />
      );
    }
    return (
      <InputCell
        key={path}
        path={path}
        value={value}
        crm={crmMark}
        onCommit={(v) => onCellChange(path, v)}
      />
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1300px] border-collapse bg-white dark:bg-slate-900">
        <colgroup>
          <col className="w-[280px]" />
          {Array.from({ length: 8 }, (_, i) => (
            <col key={i} className="w-[128px]" />
          ))}
        </colgroup>

        <tbody>
          {/* ── satır 9-11: Q Vendor özeti ───────────────────────────── */}
          <tr>
            <EmptyCell />
            <HeaderCell>AOP</HeaderCell>
            <HeaderCell>Last Officially Given OLK to Finance</HeaderCell>
            <EmptyCell />
            <HeaderCell>Forecast</HeaderCell>
            <HeaderCell>BU Manager +/- Adjustment</HeaderCell>
            <HeaderCell>Total (Forecast+Adjustment)</HeaderCell>
            <HeaderCell>Expected AOP Achievement</HeaderCell>
            <HeaderCell>Expected OLK Achievement</HeaderCell>
          </tr>
          <tr>
            <LabelCell bold>Q Vendor NSB</LabelCell>
            {/* B10 = C21+D21+E21 */}
            <ComputedCell value={c.aopNsb} />
            {cell("olkNsb", inputs.olkNsb)}
            <EmptyCell />
            <ComputedCell value={c.qNsbForecast} />
            <ComputedCell value={c.qNsbAdjustment} />
            <ComputedCell value={c.qNsbTotal} bold />
            <ComputedCell value={c.qNsbAopAchievement} kind="percent" />
            <ComputedCell value={c.qNsbOlkAchievement} kind="percent" />
          </tr>
          <tr>
            <LabelCell bold>Q Vendor NGP</LabelCell>
            <ComputedCell value={c.aopNgp} />
            {cell("olkNgp", inputs.olkNgp)}
            <EmptyCell />
            <ComputedCell value={c.qNgpForecast} />
            <ComputedCell value={c.qNgpAdjustment} />
            <ComputedCell value={c.qNgpTotal} bold />
            <ComputedCell value={c.qNgpAopAchievement} kind="percent" />
            <ComputedCell value={c.qNgpOlkAchievement} kind="percent" />
          </tr>

          <SpacerRow />

          {/* ── satır 14-18: fiilen kesilen & backlog ─────────────────── */}
          <tr>
            <EmptyCell />
            <EmptyCell />
            <HeaderCell>M1</HeaderCell>
            <HeaderCell>M2</HeaderCell>
            <HeaderCell>M3</HeaderCell>
            <EmptyCell colSpan={4} />
          </tr>
          {(
            [
              ["Total Q INVOİCED NSB as of now", "invoicedNsb", inputs.invoicedNsb, c.invoicedNsbQ],
              [
                "Total Q INVOİCED GP  as of now\n(/w customer rebate & cache discount)",
                "invoicedGp",
                inputs.invoicedGp,
                c.invoicedGpQ,
              ],
              ["Total Q Backlog NSB as of now", "backlogNsb", inputs.backlogNsb, c.backlogNsbQ],
              [
                "Total Q Backlog GP as of now\n(/w customer rebate & cache discount)",
                "backlogGp",
                inputs.backlogGp,
                c.backlogGpQ,
              ],
            ] as const
          ).map(([label, field, values, total]) => (
            <tr key={field}>
              <LabelCell>{label}</LabelCell>
              <ComputedCell value={total} title="Backlog ekranından gelir — düzenlenemez" />
              {MONTHS.map((m) => (
                <ComputedCell
                  key={`${field}.${m}`}
                  value={values[m]}
                  title="Backlog ekranından gelir — düzenlenemez"
                />
              ))}
              <EmptyCell colSpan={4} />
            </tr>
          ))}

          <SpacerRow />

          {/* ── satır 20-28: aylık hedef / forecast ───────────────────── */}
          <tr>
            <EmptyCell />
            <HeaderCell>Total Target ( OLK )</HeaderCell>
            <HeaderCell>M1</HeaderCell>
            <HeaderCell>M2</HeaderCell>
            <HeaderCell>M3</HeaderCell>
            <HeaderCell>Total</HeaderCell>
            <HeaderCell>Difference</HeaderCell>
            <EmptyCell colSpan={2} />
          </tr>
          {/* Aylık hedefler Hedefler ekranından gelir — formda salt-okunur.
              Kırılım girilmemişse hücre boş kalır ($ - değil). */}
          <tr>
            <LabelCell>M Vendor NSB - Target</LabelCell>
            {/* B21 = C10 */}
            <ComputedCell value={inputs.olkNsb} />
            {MONTHS.map((m) =>
              c.targetNsbResolved ? (
                <ComputedCell key={m} value={c.targetNsbResolved[m]} />
              ) : (
                <EmptyCell key={m} title="Aylık hedef kırılımı girilmemiş — Hedefler ekranından girilir" />
              ),
            )}
            <ComputedCell value={c.targetNsbTotal} />
            <ComputedCell value={c.targetNsbDiff} />
            <EmptyCell colSpan={2} />
          </tr>
          <tr>
            <LabelCell>M Vendor NGP - Target</LabelCell>
            <ComputedCell value={inputs.olkNgp} />
            {MONTHS.map((m) =>
              c.targetNgpResolved ? (
                <ComputedCell key={m} value={c.targetNgpResolved[m]} />
              ) : (
                <EmptyCell key={m} title="Aylık hedef kırılımı girilmemiş — Hedefler ekranından girilir" />
              ),
            )}
            <ComputedCell value={c.targetNgpTotal} />
            <ComputedCell value={c.targetNgpDiff} />
            <EmptyCell colSpan={2} />
          </tr>
          <tr>
            <LabelCell>M Vendor NSB - Forecast</LabelCell>
            <EmptyCell />
            {MONTHS.map((m) => (
              <ComputedCell key={m} value={c.forecastNsb[m]} />
            ))}
            <ComputedCell value={c.forecastNsbTotal} />
            <ComputedCell value={c.forecastNsbDiff} />
            <EmptyCell colSpan={2} />
          </tr>
          <tr>
            <LabelCell>M Vendor NGP - Forecast</LabelCell>
            <EmptyCell />
            {MONTHS.map((m) => (
              <ComputedCell key={m} value={c.forecastNgp[m]} />
            ))}
            <ComputedCell value={c.forecastNgpTotal} />
            <ComputedCell value={c.forecastNgpDiff} />
            <EmptyCell colSpan={2} />
          </tr>
          <tr>
            <LabelCell>Montly Adjustment - NSB</LabelCell>
            <EmptyCell />
            {MONTHS.map((m) => cell(`adjNsb.${m}`, inputs.adjNsb[m], m))}
            <ComputedCell value={c.adjNsbTotal} />
            <EmptyCell colSpan={3} />
          </tr>
          <tr>
            <LabelCell>Montly Adjustment - NGP</LabelCell>
            <EmptyCell />
            {MONTHS.map((m) => cell(`adjNgp.${m}`, inputs.adjNgp[m], m))}
            <ComputedCell value={c.adjNgpTotal} />
            <EmptyCell colSpan={3} />
          </tr>
          <tr>
            <LabelCell>M Vendor GP% - Target</LabelCell>
            <EmptyCell />
            {c.gpPctTarget.map((v, i) => (
              <ComputedCell key={i} value={v} kind="percent" />
            ))}
            <EmptyCell colSpan={3} />
          </tr>
          <tr>
            <LabelCell>M Vendor GP% - Forecast</LabelCell>
            <EmptyCell />
            {c.gpPctForecast.map((v, i) => (
              <ComputedCell key={i} value={v} kind="percent" />
            ))}
            <EmptyCell colSpan={3} />
          </tr>

          <SpacerRow />

          {/* ── satır 30-46: CRM forecast & ağırlıklı beklenti ────────── */}
          <tr>
            <EmptyCell />
            {monthLabels.map((label, i) => (
              <HeaderCell key={i} colSpan={2}>
                {label}
              </HeaderCell>
            ))}
            <HeaderCell colSpan={2}>Q Total</HeaderCell>
          </tr>
          <tr>
            <EmptyCell />
            {MONTHS.map((m) => (
              <FragmentPair
                key={m}
                left={<HeaderCell>CRM forecast</HeaderCell>}
                right={<HeaderCell>Weighted Expectation</HeaderCell>}
              />
            ))}
            <HeaderCell>CRM Forecast</HeaderCell>
            <HeaderCell>Weighted Expectation</HeaderCell>
          </tr>

          {WIN_RATE_BUCKETS.map((bucket) => {
            const crmForecast = inputs.crm[bucket.key];
            const weighted = c.weightedByBucket[bucket.key];
            return (
              <tr key={bucket.key}>
                {/* A32/A33 Excel'de gri, A34-A37 dolgusuz */}
                <LabelCell className={bucket.weight === null ? "bg-[#D9D9D9] dark:bg-slate-800" : undefined}>
                  {bucket.label}
                </LabelCell>
                {MONTHS.map((m) => (
                  <FragmentPair
                    key={m}
                    left={cell(
                      `crm.${bucket.key}.${m}`,
                      crmForecast[m],
                      m,
                      crmMarker(bucket.key, m, crmForecast[m]),
                    )}
                    right={
                      weighted === null ? (
                        <ComputedCell value={null} kind="na" />
                      ) : (
                        <ComputedCell value={weighted[m]} />
                      )
                    }
                  />
                ))}
                <ComputedCell value={c.crmQTotalByBucket[bucket.key]} />
                {c.weightedQTotalByBucket[bucket.key] === null ? (
                  <ComputedCell value={null} kind="na" />
                ) : (
                  <ComputedCell value={c.weightedQTotalByBucket[bucket.key]} />
                )}
              </tr>
            );
          })}

          <tr>
            <LabelCell>Expected NSB Total</LabelCell>
            {MONTHS.map((m) => (
              <FragmentPair
                key={m}
                left={<ComputedCell value={null} kind="currency" />}
                right={<ComputedCell value={c.expectedNsb[m]} bold />}
              />
            ))}
            <ComputedCell value={null} kind="currency" />
            <ComputedCell value={c.expectedNsbQ} bold />
          </tr>
          <tr>
            <LabelCell>Expected NSB Total /W Backlog + Invoiced</LabelCell>
            <EmptyCell colSpan={7} />
            <ComputedCell value={c.expectedNsbWithBase} bold />
          </tr>

          <SpacerRow />

          {(
            [
              [
                "Expected GP Total based on Weighted calculation\n(/w customer rebate & cache discount)",
                "gpWeighted",
                inputs.gpWeighted,
                c.gpWeightedQ,
              ],
              [
                "Estimated and/or realized total backend rebate",
                "rebate",
                inputs.rebate,
                c.rebateQ,
              ],
              ["Budgeted FX rate impact ", "fxImpact", inputs.fxImpact, c.fxImpactQ],
              [
                "Stock Provisioing impact",
                "stockProvision",
                inputs.stockProvision,
                c.stockProvisionQ,
              ],
            ] as const
          ).map(([label, field, values, total]) => (
            <tr key={field}>
              <LabelCell>{label}</LabelCell>
              {MONTHS.map((m) => (
                <FragmentPair
                  key={m}
                  left={<EmptyCell />}
                  right={cell(`${field}.${m}`, values[m], m)}
                />
              ))}
              <EmptyCell />
              <ComputedCell value={total} />
            </tr>
          ))}

          <tr>
            <LabelCell bold>EXPECTED NGP total</LabelCell>
            <EmptyCell colSpan={7} />
            <ComputedCell value={c.expectedNgpQ} bold />
          </tr>
          <tr>
            <LabelCell bold>EXPECTED NGP total /W Backlog + Invoiced</LabelCell>
            <EmptyCell colSpan={7} />
            <ComputedCell value={c.expectedNgpWithBase} bold />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Excel'de bir ay iki sütun kaplar: CRM forecast + Weighted Expectation. */
function FragmentPair({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <>
      {left}
      {right}
    </>
  );
}

function SpacerRow() {
  return (
    <tr>
      <td className="h-3 border-0" colSpan={9} />
    </tr>
  );
}
