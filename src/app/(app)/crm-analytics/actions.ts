"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { getAccessibleVendorIds } from "@/lib/scope";
import { CrmAuditDeal, calculateOpportunityMultiplier } from "@/lib/crm/tdsynnex-parser";

function vendorScorecardScopeFilter(accessibleVendorIds: string[], accessibleVendorNames: string[]) {
  return {
    OR: [
      { vendorId: { in: accessibleVendorIds } },
      { vendorName: { in: accessibleVendorNames, mode: "insensitive" as const } },
    ],
  };
}

export interface WinRateTierItem {
  count: number;
  amount: number;
}

export interface SmCrmAnalyticsItem {
  id: string;
  managerName: string;
  userId: string | null;
  totalDeals: number;
  rawPipeline: number;
  tryRawPipeline: number;
  tryDealCount: number;
  weightedPipeline: number;
  overdueCount: number;
  crmHealthScore: number;
  winRateBreakdown: {
    win100: WinRateTierItem;
    win75Commit: WinRateTierItem;
    win75Half: WinRateTierItem;
    win50Quarter: WinRateTierItem;
    win25: WinRateTierItem;
    zero: WinRateTierItem;
  };
  brands: {
    vendorName: string;
    totalDeals: number;
    rawPipeline: number;
    tryRawPipeline: number;
    weightedPipeline: number;
    overdueCount: number;
    crmHealthScore: number;
    crmAuditJson?: string | null;
  }[];
}

export interface AccountManagerPerformanceItem {
  accountManagerName: string;
  totalDeals: number;
  rawPipelineUSD: number;
  rawPipelineTRY: number;
  weightedPipelineUSD: number;
  closedWonCount: number;
  closedWonAmountUSD: number;
  overdueCount: number;
  currencyConflictCount: number;
  zeroInvoicingCount: number;
  issueDealsCount: number;
  hygieneScore: number;
}

export interface WeeklyHygieneTrendItem {
  weekNumber: number;
  avgHealthScore: number;
  totalOverdueCount: number;
  totalDealsCount: number;
}

export async function getCrmAnalyticsDataAction(
  fiscalYear: number,
  quarter: number,
  weekNumber: number
) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  const period = await ensureFiscalPeriod(fiscalYear, quarter);
  const isDirector = session.user.role === "DIREKTOR";
  const accessibleVendorIds = await getAccessibleVendorIds(session.user);
  const accessibleVendors = isDirector
    ? []
    : await prisma.vendor.findMany({
        where: { id: { in: accessibleVendorIds }, isActive: true },
        select: { id: true, name: true },
      });
  const accessibleVendorNames = accessibleVendors.map((vendor) => vendor.name);
  const vendorScope = isDirector
    ? undefined
    : accessibleVendorIds.length === 0
      ? { vendorId: { in: [] as string[] } }
      : vendorScorecardScopeFilter(accessibleVendorIds, accessibleVendorNames);

  // 1. Fetch Sales Manager scorecards
  const managerScorecards = await prisma.salesManagerScorecard.findMany({
    where: {
      fiscalPeriodId: period.id,
      weekNumber,
      ...(isDirector ? {} : { userId: session.user.id }),
    },
    include: {
      user: { select: { id: true, name: true, role: true } },
    },
  });

  // 2. Fetch Vendor scorecards for the week
  const vendorScorecards = await prisma.vendorScorecard.findMany({
    where: {
      fiscalPeriodId: period.id,
      weekNumber,
      ...(vendorScope ?? {}),
    },
    include: {
      vendor: {
        include: {
          manager: { select: { id: true, name: true } },
        },
      },
    },
  });

  // Collect all audit deals to aggregate Account Manager (OWNER) data & win rate breakdowns
  const allDealsMap = new Map<string, CrmAuditDeal>();

  managerScorecards.forEach((m) => {
    if (m.crmAuditJson) {
      try {
        const parsed: CrmAuditDeal[] = JSON.parse(m.crmAuditJson);
        parsed.forEach((d) => {
          allDealsMap.set(d.code, { ...d, salesManager: d.salesManager || m.managerName });
        });
      } catch (e) {}
    }
  });

  vendorScorecards.forEach((v) => {
    const vSmName = v.vendor?.manager?.name || "";
    if (v.crmAuditJson) {
      try {
        const parsed: CrmAuditDeal[] = JSON.parse(v.crmAuditJson);
        parsed.forEach((d) => {
          if (!allDealsMap.has(d.code)) {
            allDealsMap.set(d.code, { ...d, salesManager: d.salesManager || vSmName });
          }
        });
      } catch (e) {}
    }
  });

  const allDeals = Array.from(allDealsMap.values());

  // 3. Map SM Items with brand sub-rows
  const smAnalyticsItems: SmCrmAnalyticsItem[] = managerScorecards.map((sm) => {
    // Find brands belonging to this SM
    const smBrands = vendorScorecards.filter((v) => {
      if (v.vendor?.manager?.id && sm.userId) {
        return v.vendor.manager.id === sm.userId;
      }
      return false;
    });

    // Calculate Win Rate breakdown for this SM's deals
    const smDeals = allDeals.filter((d) => {
      if (d.salesManager && d.salesManager === sm.managerName) return true;
      return smBrands.some((b) => b.vendorName.toUpperCase() === d.brand.toUpperCase());
    });

    const win100 = { count: 0, amount: 0 };
    const win75Commit = { count: 0, amount: 0 };
    const win75Half = { count: 0, amount: 0 };
    const win50Quarter = { count: 0, amount: 0 };
    const win25 = { count: 0, amount: 0 };
    const zero = { count: 0, amount: 0 };

    smDeals.forEach((d) => {
      // ⚠ `d.multiplier` canlı crmAuditJson verisinde YOK — `?? 0` ile okumak
      // %75/%50/%25 fırsatlarını sessizce "zero" kovasına düşürüyordu.
      // Oran metinlerinden yeniden hesaplıyoruz (parser ile aynı kural).
      const mult = calculateOpportunityMultiplier(d.winRate, d.invoicingWinRate);
      const amt = d.selling || 0;

      if (d.winRate === "%100" || mult === 1.0) {
        if (d.winRate === "%100") {
          win100.count++;
          win100.amount += amt;
        } else {
          win75Commit.count++;
          win75Commit.amount += amt;
        }
      } else if (mult === 0.5) {
        win75Half.count++;
        win75Half.amount += amt;
      } else if (mult === 0.25) {
        win50Quarter.count++;
        win50Quarter.amount += amt;
      } else if (mult === 0.05) {
        win25.count++;
        win25.amount += amt;
      } else {
        zero.count++;
        zero.amount += amt;
      }
    });

    const totalSmDeals = smDeals.length > 0 ? smDeals.length : smBrands.reduce((acc, b) => acc + b.totalDeals, 0);

    return {
      id: sm.id,
      managerName: sm.managerName,
      userId: sm.userId,
      totalDeals: totalSmDeals,
      rawPipeline: Number(sm.rawCrmPipeline),
      tryRawPipeline: Number(sm.tryRawPipeline ?? 0),
      tryDealCount: sm.tryDealCount ?? 0,
      weightedPipeline: Number(sm.weightedCrmPipeline),
      overdueCount: sm.overdueCount,
      crmHealthScore: sm.crmHealthScore,
      winRateBreakdown: {
        win100,
        win75Commit,
        win75Half,
        win50Quarter,
        win25,
        zero,
      },
      brands: smBrands.map((b) => ({
        vendorName: b.vendorName,
        totalDeals: b.totalDeals,
        rawPipeline: Number(b.rawCrmPipeline),
        tryRawPipeline: Number(b.tryRawPipeline ?? 0),
        weightedPipeline: Number(b.weightedCrmPipeline),
        overdueCount: b.overdueCount,
        crmHealthScore: b.crmHealthScore,
        crmAuditJson: b.crmAuditJson,
      })),
    };
  });

  // 4. Aggregate Account Manager (OWNER) Performance
  const amMap = new Map<string, AccountManagerPerformanceItem>();

  allDeals.forEach((d) => {
    const amName = d.accountManager || "Belirtilmemiş";
    if (!amMap.has(amName)) {
      amMap.set(amName, {
        accountManagerName: amName,
        totalDeals: 0,
        rawPipelineUSD: 0,
        rawPipelineTRY: 0,
        weightedPipelineUSD: 0,
        closedWonCount: 0,
        closedWonAmountUSD: 0,
        overdueCount: 0,
        currencyConflictCount: 0,
        zeroInvoicingCount: 0,
        issueDealsCount: 0,
        hygieneScore: 100,
      });
    }

    const item = amMap.get(amName)!;
    item.totalDeals += 1;
    const mult = calculateOpportunityMultiplier(d.winRate, d.invoicingWinRate);

    if (d.winRate === "%100") {
      item.closedWonCount += 1;
      if (d.currency === "USD") item.closedWonAmountUSD += d.selling;
    }

    if (d.currency === "USD") {
      item.rawPipelineUSD += d.selling;
      item.weightedPipelineUSD += d.selling * mult;
    } else {
      item.rawPipelineTRY += d.selling;
    }

    if (d.issues.length > 0) {
      item.issueDealsCount += 1;
    }

    if (d.issues.includes("OVERDUE")) item.overdueCount += 1;
    if (d.issues.includes("CURRENCY_CONFLICT")) item.currencyConflictCount += 1;
    if (d.issues.includes("ZERO_INVOICING")) item.zeroInvoicingCount += 1;
  });

  // Calculate hygiene score for each AM: Ratio of clean deals out of total deals
  const amList = Array.from(amMap.values()).map((am) => {
    const cleanDeals = Math.max(0, am.totalDeals - am.issueDealsCount);
    const hygieneScore = am.totalDeals === 0 ? 100 : Math.max(0, Math.round((cleanDeals / am.totalDeals) * 100));
    return {
      ...am,
      hygieneScore,
    };
  }).sort((a, b) => b.rawPipelineUSD - a.rawPipelineUSD);

  // 5. Weekly CRM Hygiene Trend (Weeks 1 to 13)
  const allWeeksVendors = await prisma.vendorScorecard.findMany({
    where: {
      fiscalPeriodId: period.id,
      ...(vendorScope ?? {}),
    },
    select: { weekNumber: true, crmHealthScore: true, overdueCount: true, totalDeals: true },
  });

  const weeklyTrendMap = new Map<number, { scores: number[]; overdue: number; deals: number }>();
  for (let w = 1; w <= 13; w++) {
    weeklyTrendMap.set(w, { scores: [], overdue: 0, deals: 0 });
  }

  allWeeksVendors.forEach((v) => {
    const entry = weeklyTrendMap.get(v.weekNumber);
    if (entry) {
      entry.scores.push(v.crmHealthScore);
      entry.overdue += v.overdueCount;
      entry.deals += v.totalDeals;
    }
  });

  const weeklyTrend: WeeklyHygieneTrendItem[] = Array.from(weeklyTrendMap.entries()).map(
    ([weekNum, data]) => {
      const avgScore =
        data.scores.length > 0
          ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length)
          : 100;
      return {
        weekNumber: weekNum,
        avgHealthScore: avgScore,
        totalOverdueCount: data.overdue,
        totalDealsCount: data.deals,
      };
    }
  );

  return {
    smAnalyticsItems,
    amList,
    weeklyTrend,
    totalDealsInQuarter: allDeals.length,
  };
}
