import * as xlsx from "xlsx";

export interface CrmOpportunityRow {
  opportunityCode: string;
  name: string;
  brand: string;
  selling: number;
  currency: string;
  winRate: string;
  invoicingWinRate: string;
  orderDateStr?: string;
  invoiceDateStr?: string;
  status: string;
  multiplier: number;
  weightedSelling: number;
  isOverdue: boolean;
}

export interface CrmBrandSummary {
  brandName: string;
  totalDeals: number;
  rawPipeline: number;
  weightedPipeline: number;
  overdueCount: number;
  crmHealthScore: number; // 0 - 100
  overdueList: { code: string; name: string; brand: string; dateStr: string; selling: number }[];
}

export function calculateOpportunityMultiplier(winRateStr: string, invoicingStr: string): number {
  const win = String(winRateStr || "").trim();
  const inv = String(invoicingStr || "").trim();

  // Rule 1: %100 win rate -> 1.0 (100%)
  if (win === "%100") return 1.0;

  // Rule 2: %75 win rate
  if (win === "%75") {
    if (inv.startsWith("100")) return 1.0; // %75 win rate + %100 faturalanma -> 1.0
    if (inv.startsWith("50")) return 0.5;  // %75 win rate + %50 faturalanma -> 0.5
    return 0.0;
  }

  // Rule 3: %50 win rate
  if (win === "%50") {
    if (inv.startsWith("50") || inv.startsWith("100")) return 0.25; // %50 win rate + %50 faturalanma -> 0.25
    return 0.0;
  }

  // Rule 4: %25 win rate
  if (win === "%25") {
    return 0.05; // %25 win rate -> 0.05
  }

  return 0.0;
}

export function parseTDSynnexCrmExcel(fileBuffer: Buffer): {
  rows: CrmOpportunityRow[];
  brandSummaries: Record<string, CrmBrandSummary>;
} {
  const wb = xlsx.read(fileBuffer, { type: "buffer" });
  const sheetName = wb.SheetNames.find((s) => s.toLowerCase().includes("opp")) || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rawJson = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet);

  const rows: CrmOpportunityRow[] = [];
  const brandMap: Record<string, CrmBrandSummary> = {};

  const now = new Date();

  rawJson.forEach((r) => {
    const brand = String(r["BRAND AND UNIT"] || "").trim().toUpperCase();
    const code = String(r["OPPORTUNITY CODE"] || r["NAME"] || "").trim();
    const name = String(r["NAME"] || "").trim();
    const selling = Number(r["SELLING"]) || 0;
    const currency = String(r["CURRENCY"] || "USD").trim();
    const winRate = String(r["WINRATE"] || "").trim();
    const invoicingWinRate = String(r["INVOICING WIN RATE"] || "").trim();
    const status = String(r["STATUS"] || "Open").trim();
    const invoiceDateStr = String(r["DATE INVOICE"] || r["DATE ORDER"] || "").trim();

    if (!brand || selling <= 0) return;

    const multiplier = calculateOpportunityMultiplier(winRate, invoicingWinRate);
    const weightedSelling = Math.round(selling * multiplier * 100) / 100;

    // Hygiene Check: Check if invoice date is past current date
    let isOverdue = false;
    if (invoiceDateStr && status.toLowerCase() === "open") {
      const parts = invoiceDateStr.split("/");
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        const invDate = new Date(year, month, day);
        if (invDate < now && (now.getTime() - invDate.getTime()) > 86400000) {
          isOverdue = true;
        }
      }
    }

    const rowObj: CrmOpportunityRow = {
      opportunityCode: code,
      name,
      brand,
      selling,
      currency,
      winRate,
      invoicingWinRate,
      invoiceDateStr,
      status,
      multiplier,
      weightedSelling,
      isOverdue,
    };
    rows.push(rowObj);

    // Grouping strictly per Brand (Marka)
    if (!brandMap[brand]) {
      brandMap[brand] = {
        brandName: brand,
        totalDeals: 0,
        rawPipeline: 0,
        weightedPipeline: 0,
        overdueCount: 0,
        crmHealthScore: 100,
        overdueList: [],
      };
    }
    const b = brandMap[brand];
    b.totalDeals += 1;
    b.rawPipeline += selling;
    b.weightedPipeline += weightedSelling;
    if (isOverdue) {
      b.overdueCount += 1;
      b.overdueList.push({ code, name, brand, dateStr: invoiceDateStr, selling });
    }
  });

  // Calculate CRM Health Score (100 minus penalty)
  Object.values(brandMap).forEach((b) => {
    b.crmHealthScore = Math.max(30, 100 - b.overdueCount * 5);
  });

  return { rows, brandSummaries: brandMap };
}
