import prisma from "@/lib/prisma";
import { getAccessibleVendorIds } from "@/lib/scope";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { getClosedMonths, getQuarterMonthLabels } from "@/lib/fiscal";
import {
  aggregateContexts,
  aggregateInputs,
  computeForecast,
  type ForecastComputed,
  type ForecastContext,
} from "./calc";
import { monthlyTriples, actualMonthlyTriples } from "@/lib/monthly";
import { emptyInputs, forecastInputsSchema, type ForecastInputs } from "./schema";
import type { Actual } from "@prisma/client";

/** Total sekmesinin sanal kimliği — gerçek bir vendor kaydına karşılık gelmez. */
export const TOTAL_TAB_ID = "__total__";

export interface SessionUser {
  id: string;
  role: string;
}

/**
 * Target / Actual tablolarından gelen, formun sahibi olmadığı değerler.
 *
 * Invoiced/backlog satırları her zaman aktif `Actual` kaydından gelir;
 * `WeeklyForecastSheet` bu alanları saklamaz.
 */
export interface SheetReference {
  /** Target.revenue → formdaki AOP NSB (B10). Salt-okunur, Hedefler ekranından yönetilir. */
  targetRevenue: number | null;
  /** Target.gp → formdaki AOP NGP (B11) */
  targetGp: number | null;
  /** Target aylık kırılımı → formdaki C21:E21 / C22:E22. null = girilmemiş. */
  targetRevenueMonthly: [number, number, number] | null;
  targetGpMonthly: [number, number, number] | null;
  /** Actual.invoiced (çeyrek, NSB) */
  actualInvoiced: number | null;
  /** Actual.backlog (çeyrek, NSB) */
  actualBacklog: number | null;
  /** Actual kaydının ait olduğu hafta */
  actualWeekNumber: number | null;
}

export interface SheetPayload {
  id: string;
  name: string;
  /** Vendor'ın sorumlu satış müdürü — SM filtresi bunun üzerinden çalışır. */
  managerId: string | null;
  managerName: string | null;
  /** Total sekmesi ve kilitli dönemlerde true */
  readOnly: boolean;
  inputs: ForecastInputs;
  /** AOP gibi DB'den gelen değerler — istemci yeniden hesaplarken de gerekli. */
  context: ForecastContext;
  computed: ForecastComputed;
  reference: SheetReference;
  updatedAt: string | null;
  updatedByName: string | null;
}

export interface WeeklyForecastReport {
  fiscalYear: number;
  quarter: number;
  weekNumber: number;
  isLocked: boolean;
  /**
   * Çeyreğin M1/M2/M3'ü takvim olarak kapandı mı. Kapanan ayın hücreleri
   * formda salt-okunur olur. Takvimden türetilir, DB'de saklanmaz.
   */
  closedMonths: [boolean, boolean, boolean];
  /** Ay adları, ör. ["Haziran 2026","Temmuz 2026","Ağustos 2026"] */
  monthLabels: [string, string, string];
  sheets: SheetPayload[];
}

function parseInputs(value: unknown): ForecastInputs {
  const parsed = forecastInputsSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyInputs();
}

const toNumber = (value: { toString(): string } | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value.toString());

/**
 * OLK ("Last Officially Given OLK to Finance", C10/C11) şimdilik SM tarafından
 * elle girilir; hiçbir tablodan ön-doldurulmaz. İleride ayrı bir OLK tablosu ve
 * ekranı açıldığında, AOP'nin Target'tan geldiği gibi OLK da oradan gelecek —
 * bağlanacak tek yer `buildContext` ve aşağıdaki `SheetReference`.
 */
function buildContext(reference: SheetReference): ForecastContext {
  return {
    aopNsb: reference.targetRevenue,
    aopNgp: reference.targetGp,
    targetNsbMonthly: reference.targetRevenueMonthly,
    targetNgpMonthly: reference.targetGpMonthly,
  };
}

export function applyActualToInputs(
  inputs: ForecastInputs,
  actual: Actual | undefined,
): ForecastInputs {
  const triples = actualMonthlyTriples(actual);
  if (!triples) return inputs;

  return {
    ...inputs,
    invoicedNsb: triples.invoicedNsb,
    invoicedGp: triples.invoicedGp,
    backlogNsb: triples.backlogNsb,
    backlogGp: triples.backlogGp,
  };
}

export async function getWeeklyForecastReport(
  user: SessionUser,
  fiscalYear: number,
  quarter: number,
  weekNumber: number,
): Promise<WeeklyForecastReport> {
  const period = await ensureFiscalPeriod(fiscalYear, quarter);
  const accessibleIds = await getAccessibleVendorIds(user);

  const [vendors, sheets, targets, actuals] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: accessibleIds }, isActive: true },
      orderBy: { name: "asc" },
      include: { manager: { select: { id: true, name: true } } },
    }),
    prisma.weeklyForecastSheet.findMany({
      where: { fiscalPeriodId: period.id, weekNumber, vendorId: { in: accessibleIds } },
      include: { updatedBy: { select: { name: true } } },
    }),
    prisma.target.findMany({
      where: { fiscalPeriodId: period.id, vendorId: { in: accessibleIds } },
    }),
    // Forma referans olarak en güncel (<= seçili hafta) backlog/invoiced kaydı
    prisma.actual.findMany({
      where: {
        fiscalPeriodId: period.id,
        vendorId: { in: accessibleIds },
        weekNumber: { lte: weekNumber },
      },
      orderBy: { weekNumber: "desc" },
    }),
  ]);

  const sheetByVendor = new Map(sheets.map((s) => [s.vendorId, s]));
  const targetByVendor = new Map(targets.map((t) => [t.vendorId, t]));
  const latestActualByVendor = new Map<string, (typeof actuals)[number]>();
  for (const actual of actuals) {
    if (!latestActualByVendor.has(actual.vendorId)) latestActualByVendor.set(actual.vendorId, actual);
  }

  const vendorSheets: SheetPayload[] = vendors.map((vendor) => {
    const target = targetByVendor.get(vendor.id);
    const actual = latestActualByVendor.get(vendor.id);
    const targetMonthly = monthlyTriples(target);
    const reference: SheetReference = {
      targetRevenue: toNumber(target?.revenue),
      targetGp: toNumber(target?.gp),
      targetRevenueMonthly: targetMonthly?.revenue ?? null,
      targetGpMonthly: targetMonthly?.gp ?? null,
      actualInvoiced: toNumber(actual?.invoiced),
      actualBacklog: toNumber(actual?.backlog),
      actualWeekNumber: actual?.weekNumber ?? null,
    };

    const row = sheetByVendor.get(vendor.id);
    const sheetInputs = row ? parseInputs(row.inputs) : emptyInputs();
    const inputs = applyActualToInputs(sheetInputs, actual);
    const context = buildContext(reference);

    return {
      id: vendor.id,
      name: vendor.name,
      managerId: vendor.manager?.id ?? null,
      managerName: vendor.manager?.name ?? null,
      readOnly: period.isLocked,
      inputs,
      context,
      computed: computeForecast(inputs, context),
      reference,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedByName: row?.updatedBy?.name ?? null,
    };
  });

  const totalInputs = aggregateInputs(vendorSheets.map((s) => s.inputs));
  const totalContext = aggregateContexts(vendorSheets.map((s) => s.context));
  const totalReference: SheetReference = {
    targetRevenue: sumReference(vendorSheets, "targetRevenue"),
    targetGp: sumReference(vendorSheets, "targetGp"),
    targetRevenueMonthly: totalContext.targetNsbMonthly,
    targetGpMonthly: totalContext.targetNgpMonthly,
    actualInvoiced: sumReference(vendorSheets, "actualInvoiced"),
    actualBacklog: sumReference(vendorSheets, "actualBacklog"),
    actualWeekNumber: null,
  };

  return {
    fiscalYear: period.fiscalYear,
    quarter: period.quarter,
    weekNumber,
    isLocked: period.isLocked,
    closedMonths: getClosedMonths(period.fiscalYear, period.quarter),
    monthLabels: getQuarterMonthLabels(period.fiscalYear, period.quarter),
    sheets: [
      ...vendorSheets,
      {
        id: TOTAL_TAB_ID,
        name: "Total",
        managerId: null,
        managerName: null,
        readOnly: true,
        inputs: totalInputs,
        context: totalContext,
        computed: computeForecast(totalInputs, totalContext),
        reference: totalReference,
        updatedAt: null,
        updatedByName: null,
      },
    ],
  };
}

function sumReference(
  sheets: SheetPayload[],
  key: keyof Omit<SheetReference, "actualWeekNumber">,
): number | null {
  const values = sheets.map((s) => s.reference[key]).filter((v): v is number => v !== null);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0);
}

/**
 * Formdan türeyen çeyrek toplamları.
 *
 * Şu an yalnızca bu ekran tarafından kullanılıyor. Form ileride mevcut
 * `Forecast` tablosuna bağlandığında (Forecast Giriş sayfasının bu formdaki
 * aylık verilerin toplamını göstermesi için) yazılacak değerler bunlardır:
 * `revenue` → Forecast.revenue, `gp` → Forecast.gp.
 */
export async function getWeeklyForecastQuarterTotals(
  user: SessionUser,
  fiscalYear: number,
  quarter: number,
  weekNumber: number,
): Promise<{ vendorId: string; vendorName: string; revenue: number; gp: number }[]> {
  const report = await getWeeklyForecastReport(user, fiscalYear, quarter, weekNumber);
  return report.sheets
    .filter((s) => s.id !== TOTAL_TAB_ID)
    .map((s) => ({
      vendorId: s.id,
      vendorName: s.name,
      revenue: s.computed.qNsbTotal,
      gp: s.computed.qNgpTotal,
    }));
}

/**
 * Tek bir vendor için hesap bağlamını kurar (AOP + aylık hedefler).
 * `getWeeklyForecastReport` ile aynı kaynağı kullanır; Kaydet akışı raporun
 * tamamını yüklemeden aynı sonucu üretebilsin diye ayrı tutuldu.
 */
export async function buildForecastContext(
  fiscalPeriodId: string,
  vendorId: string,
): Promise<ForecastContext> {
  const target = await prisma.target.findUnique({
    where: { vendorId_fiscalPeriodId: { vendorId, fiscalPeriodId } },
  });
  const monthly = monthlyTriples(target);
  return {
    aopNsb: toNumber(target?.revenue),
    aopNgp: toNumber(target?.gp),
    targetNsbMonthly: monthly?.revenue ?? null,
    targetNgpMonthly: monthly?.gp ?? null,
  };
}
