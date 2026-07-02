"use server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { getAccessibleVendorIds } from "@/lib/scope";
import { getFiscalContext } from "@/lib/fiscal";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";

function calculatePercent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function calculateGpPercent(revenue: number, gp: number) {
  return revenue > 0 ? (gp / revenue) * 100 : 0;
}

function emptyMetrics() {
  return {
    targetRevenue: 0,
    targetGp: 0,
    forecastRevenue: 0,
    forecastGp: 0,
    backlogRevenue: 0,
    backlogGp: 0,
  };
}

function mergeMetricPart(
  metrics: ReturnType<typeof emptyMetrics>,
  part: Partial<ReturnType<typeof emptyMetrics>> | undefined
) {
  if (!part) return metrics;

  return {
    targetRevenue: metrics.targetRevenue + (part.targetRevenue ?? 0),
    targetGp: metrics.targetGp + (part.targetGp ?? 0),
    forecastRevenue: metrics.forecastRevenue + (part.forecastRevenue ?? 0),
    forecastGp: metrics.forecastGp + (part.forecastGp ?? 0),
    backlogRevenue: metrics.backlogRevenue + (part.backlogRevenue ?? 0),
    backlogGp: metrics.backlogGp + (part.backlogGp ?? 0),
  };
}

function enrichMetrics(metrics: ReturnType<typeof emptyMetrics>) {
  return {
    ...metrics,
    targetGpPercent: calculateGpPercent(metrics.targetRevenue, metrics.targetGp),
    forecastGpPercent: calculateGpPercent(metrics.forecastRevenue, metrics.forecastGp),
    backlogGpPercent: calculateGpPercent(metrics.backlogRevenue, metrics.backlogGp),
    revenueAchievement: calculatePercent(metrics.forecastRevenue, metrics.targetRevenue),
    gpAchievement: calculatePercent(metrics.forecastGp, metrics.targetGp),
  };
}

function normalizeQuarters(quarters: number[] | undefined) {
  const validQuarters = Array.from(new Set((quarters ?? [1, 2, 3, 4]).filter((quarter) => quarter >= 1 && quarter <= 4))).sort(
    (a, b) => a - b
  );
  return validQuarters.length > 0 ? validQuarters : [1, 2, 3, 4];
}

export async function getDashboardData(fiscalYear?: number, quarters?: number[]) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  const current = getFiscalContext(new Date());
  const selectedFiscalYear = fiscalYear ?? current.fiscalYear;
  const selectedQuarters = normalizeQuarters(quarters);
  const accessibleVendorIds = await getAccessibleVendorIds(session.user);
  const currentPeriod = await ensureFiscalPeriod(current.fiscalYear, current.quarter);
  const selectedPeriods = await Promise.all(
    selectedQuarters.map((quarter) => ensureFiscalPeriod(selectedFiscalYear, quarter))
  );
  const selectedPeriodIds = selectedPeriods.map((period) => period.id);
  const selectedPeriodIdSet = new Set(selectedPeriodIds);
  const queryPeriodIds = Array.from(new Set([...selectedPeriodIds, currentPeriod.id]));

  const [vendors, periods] = await Promise.all([
    prisma.vendor.findMany({
      where: {
        id: { in: accessibleVendorIds },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        managerId: true,
        manager: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.fiscalPeriod.findMany({
      where: {
        id: { in: queryPeriodIds },
      },
      orderBy: [{ fiscalYear: "asc" }, { quarter: "asc" }],
    }),
  ]);

  const periodById = new Map(periods.map((period) => [period.id, period]));

  const [targets, activeForecasts, yearlyForecasts, currentActuals, yearlyActuals] = await Promise.all([
    prisma.target.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: { in: queryPeriodIds },
      },
    }),
    prisma.forecast.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: currentPeriod.id,
        isActive: true,
      },
    }),
    prisma.forecast.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: { in: queryPeriodIds },
        isActive: true,
      },
    }),
    prisma.actual.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: currentPeriod.id,
        weekNumber: current.weekInQuarter,
      },
    }),
    prisma.actual.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: { in: queryPeriodIds },
      },
    }),
  ]);

  const currentTargetMap = new Map(
    targets
      .filter((target) => target.fiscalPeriodId === currentPeriod.id)
      .map((target) => [target.vendorId, target])
  );
  const activeForecastMap = new Map(activeForecasts.map((forecast) => [forecast.vendorId, forecast]));
  const currentActualMap = new Map(currentActuals.map((actual) => [actual.vendorId, actual]));

  const yearlyTargetMap = new Map<string, ReturnType<typeof emptyMetrics>>();
  const yearlyForecastMap = new Map<string, ReturnType<typeof emptyMetrics>>();
  const yearlyActualMap = new Map<string, ReturnType<typeof emptyMetrics>>();
  const quarterlySummary = selectedQuarters.map((quarter) => ({
    quarter,
    ...emptyMetrics(),
  }));
  const quarterSummaryIndex = new Map(quarterlySummary.map((quarter, index) => [quarter.quarter, index]));

  for (const target of targets) {
    const period = periodById.get(target.fiscalPeriodId);
    if (!period || !selectedPeriodIdSet.has(period.id)) continue;
    const metrics = yearlyTargetMap.get(target.vendorId) ?? emptyMetrics();
    metrics.targetRevenue += Number(target.revenue);
    metrics.targetGp += Number(target.gp);
    yearlyTargetMap.set(target.vendorId, metrics);
    const quarterMetrics = quarterlySummary[quarterSummaryIndex.get(period.quarter) ?? -1];
    if (!quarterMetrics) continue;
    quarterMetrics.targetRevenue += Number(target.revenue);
    quarterMetrics.targetGp += Number(target.gp);
  }

  for (const forecast of yearlyForecasts) {
    const period = periodById.get(forecast.fiscalPeriodId);
    if (!period || !selectedPeriodIdSet.has(period.id)) continue;
    const metrics = yearlyForecastMap.get(forecast.vendorId) ?? emptyMetrics();
    metrics.forecastRevenue += Number(forecast.revenue);
    metrics.forecastGp += Number(forecast.gp);
    yearlyForecastMap.set(forecast.vendorId, metrics);
    const quarterMetrics = quarterlySummary[quarterSummaryIndex.get(period.quarter) ?? -1];
    if (!quarterMetrics) continue;
    quarterMetrics.forecastRevenue += Number(forecast.revenue);
    quarterMetrics.forecastGp += Number(forecast.gp);
  }

  for (const actual of yearlyActuals) {
    const period = periodById.get(actual.fiscalPeriodId);
    if (!period || !selectedPeriodIdSet.has(period.id)) continue;
    const metrics = yearlyActualMap.get(actual.vendorId) ?? emptyMetrics();
    metrics.backlogRevenue += Number(actual.backlog);
    metrics.backlogGp += Number(actual.invoiced);
    yearlyActualMap.set(actual.vendorId, metrics);
    const quarterMetrics = quarterlySummary[quarterSummaryIndex.get(period.quarter) ?? -1];
    if (!quarterMetrics) continue;
    quarterMetrics.backlogRevenue += Number(actual.backlog);
    quarterMetrics.backlogGp += Number(actual.invoiced);
  }

  const managerMap = new Map<
    string,
    {
      id: string;
      managerName: string;
      vendors: Array<{
        vendorId: string;
        vendorName: string;
        current: ReturnType<typeof enrichMetrics>;
        yearly: ReturnType<typeof enrichMetrics>;
        hasForecast: boolean;
        hasTarget: boolean;
      }>;
      current: ReturnType<typeof emptyMetrics>;
      yearly: ReturnType<typeof emptyMetrics>;
      forecastedCount: number;
      targetCount: number;
    }
  >();

  const currentTotals = emptyMetrics();
  const yearlyTotals = emptyMetrics();

  for (const vendor of vendors) {
    const target = currentTargetMap.get(vendor.id);
    const forecast = activeForecastMap.get(vendor.id);
    const actual = currentActualMap.get(vendor.id);
    const currentMetrics = {
      targetRevenue: target ? Number(target.revenue) : 0,
      targetGp: target ? Number(target.gp) : 0,
      forecastRevenue: forecast ? Number(forecast.revenue) : 0,
      forecastGp: forecast ? Number(forecast.gp) : 0,
      backlogRevenue: actual ? Number(actual.backlog) : 0,
      backlogGp: actual ? Number(actual.invoiced) : 0,
    };
    const yearlyMetrics = mergeMetricPart(
      mergeMetricPart(
        mergeMetricPart(emptyMetrics(), yearlyTargetMap.get(vendor.id)),
        yearlyForecastMap.get(vendor.id)
      ),
      yearlyActualMap.get(vendor.id)
    );

    const groupId = vendor.managerId ?? "unassigned";
    const group =
      managerMap.get(groupId) ??
      {
        id: groupId,
        managerName: vendor.manager?.name ?? "Atanmamış",
        vendors: [],
        current: emptyMetrics(),
        yearly: emptyMetrics(),
        forecastedCount: 0,
        targetCount: 0,
      };

    for (const key of Object.keys(currentMetrics) as Array<keyof typeof currentMetrics>) {
      group.current[key] += currentMetrics[key];
      currentTotals[key] += currentMetrics[key];
      group.yearly[key] += yearlyMetrics[key];
      yearlyTotals[key] += yearlyMetrics[key];
    }

    if (forecast) group.forecastedCount += 1;
    if (target) group.targetCount += 1;

    group.vendors.push({
      vendorId: vendor.id,
      vendorName: vendor.name,
      current: enrichMetrics(currentMetrics),
      yearly: enrichMetrics(yearlyMetrics),
      hasForecast: Boolean(forecast),
      hasTarget: Boolean(target),
    });
    managerMap.set(groupId, group);
  }

  const managers = Array.from(managerMap.values())
    .map((manager) => ({
      ...manager,
      current: enrichMetrics(manager.current),
      yearly: enrichMetrics(manager.yearly),
      vendors: manager.vendors.sort((a, b) => a.vendorName.localeCompare(b.vendorName, "tr")),
    }))
    .sort((a, b) => a.managerName.localeCompare(b.managerName, "tr"));

  const attentionItems = managers
    .flatMap((manager) =>
      manager.vendors.flatMap((vendor) => {
        const items = [];
        if (!vendor.hasForecast) {
          items.push({
            type: "Eksik Forecast",
            severity: "high",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: "Mevcut dönem için aktif forecast girilmemiş.",
          });
        }
        if (vendor.hasTarget && vendor.current.gpAchievement > 0 && vendor.current.gpAchievement < 75) {
          items.push({
            type: "Düşük GP Achievement",
            severity: "high",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: `GP achievement ${vendor.current.gpAchievement.toFixed(1)}%.`,
          });
        }
        if (vendor.hasTarget && vendor.current.revenueAchievement > 0 && vendor.current.revenueAchievement < 75) {
          items.push({
            type: "Düşük NSB Achievement",
            severity: "medium",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: `NSB achievement ${vendor.current.revenueAchievement.toFixed(1)}%.`,
          });
        }
        if (vendor.hasForecast && vendor.current.forecastGpPercent > 0 && vendor.current.forecastGpPercent < 10) {
          items.push({
            type: "Düşük GP%",
            severity: "medium",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: `Forecast GP% ${vendor.current.forecastGpPercent.toFixed(1)}%.`,
          });
        }
        if (vendor.current.backlogRevenue > 0 && vendor.current.forecastRevenue < vendor.current.backlogRevenue) {
          items.push({
            type: "Backlog Üstte",
            severity: "low",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: "Backlog NSB forecast NSB üzerinde.",
          });
        }
        return items;
      })
    )
    .slice(0, 12);

  return {
    currentContext: current,
    selectedFiscalYear,
    selectedQuarters,
    user: {
      role: session.user.role,
      name: session.user.name,
    },
    current: enrichMetrics(currentTotals),
    yearly: enrichMetrics(yearlyTotals),
    managers,
    attentionItems,
    quarterlySummary: quarterlySummary.map((quarter) => ({
      quarter: quarter.quarter,
      ...enrichMetrics(quarter),
    })),
  };
}
