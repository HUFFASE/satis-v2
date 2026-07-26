import * as xlsx from "xlsx";
import { getFiscalContext } from "../fiscal";

export interface CrmOpportunityRow {
  opportunityCode: string;
  name: string;
  brand: string;
  selling: number;
  currency: string;
  isTry: boolean;
  winRate: string;
  invoicingWinRate: string;
  orderDateStr?: string;
  invoiceDateStr?: string;
  status: string;
  multiplier: number;
  weightedSelling: number;
  isOverdue: boolean;
}

export interface CrmAuditDeal {
  code: string;
  name: string;
  brand: string;
  accountManager: string;
  salesManager?: string;
  selling: number;
  currency: string;
  partnerCurrency: string;
  winRate: string;
  invoicingWinRate: string;
  multiplier: number;
  dateStr: string;
  issues: ("OVERDUE" | "CURRENCY_CONFLICT" | "ZERO_INVOICING" | "UNASSIGNED_BRAND")[];
}

export interface CrmBrandSummary {
  brandName: string;
  totalDeals: number;
  rawPipeline: number;         // USD only
  weightedPipeline: number;    // USD only
  tryTotalDeals: number;
  tryRawPipeline: number;      // TRY only
  tryWeightedPipeline: number; // TRY only
  overdueCount: number;
  crmHealthScore: number; // 0 - 100
  overdueList: { code: string; name: string; brand: string; dateStr: string; selling: number }[];
  auditDeals: CrmAuditDeal[];
}

export interface CrmTrySummary {
  dealCount: number;
  rawPipeline: number;
  weightedPipeline: number;
  warningNotice: string | null;
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

export function parseTDSynnexCrmExcel(
  fileBuffer: Buffer,
  targetFiscalYear?: number,
  targetQuarter?: number
): {
  rows: CrmOpportunityRow[];
  brandSummaries: Record<string, CrmBrandSummary>;
  trySummary: CrmTrySummary;
  filteredOutCount: number;
  allAuditDeals: CrmAuditDeal[];
} {
  const wb = xlsx.read(fileBuffer, { type: "buffer" });
  const sheetName = wb.SheetNames.find((s) => s.toLowerCase().includes("opp")) || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rawJson = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet);

  const rows: CrmOpportunityRow[] = [];
  const brandMap: Record<string, CrmBrandSummary> = {};
  const allAuditDeals: CrmAuditDeal[] = [];

  let tryDealCount = 0;
  let tryRawPipelineSum = 0;
  let tryWeightedPipelineSum = 0;
  let filteredOutCount = 0;

  const now = new Date();

  rawJson.forEach((r) => {
    const brand = String(r["BRAND AND UNIT"] || "").trim().toUpperCase();
    const code = String(r["OPPORTUNITY CODE"] || r["NAME"] || "").trim();
    const name = String(r["NAME"] || "").trim();
    const selling = Number(r["SELLING"]) || 0;
    const currency = String(r["CURRENCY"] || "USD").trim().toUpperCase();
    const partnerCurrency = String(r["PARTNER PAYMENT CURRENCY"] || "").trim().toUpperCase();
    const accountManager = String(r["OWNER"] || "").trim();
    const winRate = String(r["WINRATE"] || "").trim();
    const invoicingWinRate = String(r["INVOICING WIN RATE"] || "").trim();
    const status = String(r["STATUS"] || "Open").trim();
    const invoiceDateStr = String(r["DATE INVOICE"] || r["DATE ORDER"] || "").trim();

    if (!brand || selling <= 0) return;

    // Filter by target Fiscal Year & Quarter if provided
    if (targetFiscalYear && targetQuarter && invoiceDateStr) {
      const parts = invoiceDateStr.split("/");
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          const invDate = new Date(year, month, day);
          const ctx = getFiscalContext(invDate);
          if (ctx.fiscalYear !== targetFiscalYear || ctx.quarter !== targetQuarter) {
            filteredOutCount++;
            return; // Skip rows outside target period
          }
        }
      }
    }

    const isTry = currency.includes("TL") || currency.includes("TRY");
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

    // Audit Issues Detection
    const issues: CrmAuditDeal["issues"] = [];
    if (isOverdue) issues.push("OVERDUE");

    // Currency Conflict: If primary currency differs from partner currency or one is TRY while other is USD
    if (
      (currency && partnerCurrency && currency !== partnerCurrency) ||
      (isTry && !partnerCurrency.includes("TL") && !partnerCurrency.includes("TRY")) ||
      (!isTry && (partnerCurrency.includes("TL") || partnerCurrency.includes("TRY")))
    ) {
      issues.push("CURRENCY_CONFLICT");
    }

    // Invoicing Win Rate = 0
    if (invoicingWinRate.startsWith("0") || invoicingWinRate.includes("0%")) {
      issues.push("ZERO_INVOICING");
    }

    const auditDeal: CrmAuditDeal = {
      code,
      name,
      brand,
      accountManager: accountManager || "Belirtilmemiş",
      selling,
      currency,
      partnerCurrency: partnerCurrency || currency,
      winRate,
      invoicingWinRate,
      multiplier,
      dateStr: invoiceDateStr,
      issues,
    };

    allAuditDeals.push(auditDeal);

    const rowObj: CrmOpportunityRow = {
      opportunityCode: code,
      name,
      brand,
      selling,
      currency,
      isTry,
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
        tryTotalDeals: 0,
        tryRawPipeline: 0,
        tryWeightedPipeline: 0,
        overdueCount: 0,
        crmHealthScore: 100,
        overdueList: [],
        auditDeals: [],
      };
    }
    const b = brandMap[brand];
    b.totalDeals += 1;
    b.auditDeals.push(auditDeal);

    if (isTry) {
      // Exclude from main USD calculations, track under TRY
      b.tryTotalDeals += 1;
      b.tryRawPipeline += selling;
      b.tryWeightedPipeline += weightedSelling;

      tryDealCount += 1;
      tryRawPipelineSum += selling;
      tryWeightedPipelineSum += weightedSelling;
    } else {
      // Main USD calculation
      b.rawPipeline += selling;
      b.weightedPipeline += weightedSelling;
    }

    if (isOverdue) {
      b.overdueCount += 1;
      b.overdueList.push({ code, name, brand, dateStr: invoiceDateStr, selling });
    }
  });

  // Calculate CRM Health Score (Ratio of healthy/clean deals to total deals)
  Object.values(brandMap).forEach((b) => {
    const issueCount = (b.auditDeals || []).filter(d => d.issues && d.issues.length > 0).length;
    b.crmHealthScore = b.totalDeals === 0 ? 100 : Math.max(0, Math.round(((b.totalDeals - issueCount) / b.totalDeals) * 100));
  });

  const trySummary: CrmTrySummary = {
    dealCount: tryDealCount,
    rawPipeline: tryRawPipelineSum,
    weightedPipeline: tryWeightedPipelineSum,
    warningNotice:
      tryDealCount > 0
        ? `⚠️ ${tryDealCount} adet fırsat kaydı TL (TRY) para birimindedir. Bu işler USD cinsinden hesaplanan ana pipeline'a dahil edilmemiş, ayrı olarak raporlanmıştır.`
        : null,
  };

  return { rows, brandSummaries: brandMap, trySummary, filteredOutCount, allAuditDeals };
}
