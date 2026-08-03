import prisma from "@/lib/prisma";
import { round2 } from "@/lib/monthly";
import { isTryCurrency, type CrmAuditDeal } from "./tdsynnex-parser";
import {
  applyDealToVendor,
  emptyVendorData,
  type CrmCrossCheck,
  type VendorCrmData,
} from "./crosscheck-core";

/**
 * CRM fırsatlarını haftalık formun 18 sarı hücresine (6 kova × 3 ay) eşler.
 *
 * Veri kaynağı `VendorScorecard.crmAuditJson` — sistemde fırsat başına tablo
 * YOK, tüm fırsatlar bu JSON metninde duruyor. Aynı deseni
 * `crm-analytics/actions.ts` de kullanıyor.
 *
 * Bu modül yalnızca OKUR; forma hiçbir şey yazmaz.
 * Saf eşleme/karşılaştırma mantığı için bkz. crosscheck-core.ts
 */
export async function getCrmBucketMatrix(
  fiscalPeriodId: string,
  fiscalYear: number,
  quarter: number,
  weekNumber: number,
  vendorIds: string[],
): Promise<CrmCrossCheck | null> {
  if (vendorIds.length === 0) return null;

  // Hangi haftayı kullanacağız: istenen hafta, yoksa en yakın önceki dolu hafta.
  // `Actual` okumasındaki geri-düşme deseninin aynısı.
  const candidates = await prisma.vendorScorecard.findMany({
    where: { fiscalPeriodId, weekNumber: { lte: weekNumber }, crmAuditJson: { not: null } },
    select: { weekNumber: true },
    orderBy: { weekNumber: "desc" },
    take: 1,
  });
  if (candidates.length === 0) return null;
  const sourceWeek = candidates[0].weekNumber;

  const scorecards = await prisma.vendorScorecard.findMany({
    where: { fiscalPeriodId, weekNumber: sourceWeek },
    select: { vendorId: true, vendorName: true, crmAuditJson: true },
  });

  const byVendor: Record<string, VendorCrmData> = {};
  const unmatchedMap = new Map<string, { dealCount: number; usd: number }>();
  let parseErrors = 0;

  // Aynı fırsat birden fazla marka satırında görünebiliyor (bulanık marka
  // eşleşmesi); vendor atamasından ÖNCE global olarak tekilleştir.
  const seen = new Set<string>();

  for (const sc of scorecards) {
    if (!sc.crmAuditJson) continue;

    let deals: CrmAuditDeal[];
    try {
      const parsed = JSON.parse(sc.crmAuditJson);
      if (!Array.isArray(parsed)) throw new Error("dizi değil");
      deals = parsed as CrmAuditDeal[];
    } catch {
      parseErrors++;
      continue;
    }

    // Vendor'a bağlanamamış marka: fırsatları hiçbir sekmeye ait değil
    if (!sc.vendorId) {
      const agg = unmatchedMap.get(sc.vendorName) ?? { dealCount: 0, usd: 0 };
      for (const d of deals) {
        if (seen.has(d.code)) continue;
        seen.add(d.code);
        agg.dealCount++;
        if (!isTryCurrency(d.currency, d.partnerCurrency)) {
          agg.usd = round2(agg.usd + (Number(d.selling) || 0));
        }
      }
      unmatchedMap.set(sc.vendorName, agg);
      continue;
    }

    if (!vendorIds.includes(sc.vendorId)) continue;

    // Birden çok marka satırı aynı vendor'a eşleşebilir → topla, üzerine yazma
    const target = (byVendor[sc.vendorId] ??= emptyVendorData());
    target.hasData = true;

    for (const d of deals) {
      if (seen.has(d.code)) continue;
      seen.add(d.code);
      applyDealToVendor(target, d, fiscalYear, quarter);
    }
  }

  return {
    sourceWeek,
    requestedWeek: weekNumber,
    byVendor,
    unmatched: [...unmatchedMap.entries()]
      .map(([vendorName, v]) => ({ vendorName, ...v }))
      .filter((u) => u.dealCount > 0),
    parseErrors,
  };
}
