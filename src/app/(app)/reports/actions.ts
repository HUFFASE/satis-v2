"use server";

import { auth } from "@/auth";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import prisma from "@/lib/prisma";
import { getAccessibleVendorIds } from "@/lib/scope";

type Metrics = ReturnType<typeof emptyMetrics>;

function emptyMetrics() {
  return {
    targetRevenue: 0,
    targetGp: 0,
    forecastRevenue: 0,
    forecastGp: 0,
    closingRevenue: 0,
    closingGp: 0,
    backlogRevenue: 0,
    backlogGp: 0,
  };
}

function addMetrics(base: Metrics, part: Partial<Metrics>) {
  base.targetRevenue += part.targetRevenue ?? 0;
  base.targetGp += part.targetGp ?? 0;
  base.forecastRevenue += part.forecastRevenue ?? 0;
  base.forecastGp += part.forecastGp ?? 0;
  base.closingRevenue += part.closingRevenue ?? 0;
  base.closingGp += part.closingGp ?? 0;
  base.backlogRevenue += part.backlogRevenue ?? 0;
  base.backlogGp += part.backlogGp ?? 0;
  return base;
}

function calculatePercent(value: number, target: number) {
  return target > 0 ? (value / target) * 100 : 0;
}

function calculateGpPercent(revenue: number, gp: number) {
  return revenue > 0 ? (gp / revenue) * 100 : 0;
}

function calculateAccuracy(value: number, baseline: number) {
  if (baseline <= 0) return 0;
  return Math.max(0, 100 - (Math.abs(value - baseline) / baseline) * 100);
}

function enrichMetrics(metrics: Metrics) {
  return {
    ...metrics,
    targetGpPercent: calculateGpPercent(metrics.targetRevenue, metrics.targetGp),
    forecastGpPercent: calculateGpPercent(metrics.forecastRevenue, metrics.forecastGp),
    closingGpPercent: calculateGpPercent(metrics.closingRevenue, metrics.closingGp),
    backlogGpPercent: calculateGpPercent(metrics.backlogRevenue, metrics.backlogGp),
    closingRevenueAchievement: calculatePercent(metrics.closingRevenue, metrics.targetRevenue),
    closingGpAchievement: calculatePercent(metrics.closingGp, metrics.targetGp),
    forecastRevenueAccuracy: calculateAccuracy(metrics.forecastRevenue, metrics.closingRevenue),
    forecastGpAccuracy: calculateAccuracy(metrics.forecastGp, metrics.closingGp),
    forecastRevenueVsTarget: calculatePercent(metrics.forecastRevenue, metrics.targetRevenue),
    forecastGpVsTarget: calculatePercent(metrics.forecastGp, metrics.targetGp),
  };
}

function metricKey(vendorId: string, fiscalPeriodId: string) {
  return `${vendorId}:${fiscalPeriodId}`;
}

function normalizeQuarters(quarters: number[]) {
  const validQuarters = Array.from(new Set(quarters.filter((quarter) => quarter >= 1 && quarter <= 4))).sort(
    (a, b) => a - b
  );
  return validQuarters.length > 0 ? validQuarters : [1, 2, 3, 4];
}

export async function getReportsData(fiscalYear: number, quarters: number[]) {
  const session = await auth();
  if (!session?.user) throw new Error("Oturum açık değil.");

  const selectedQuarters = normalizeQuarters(quarters);
  const accessibleVendorIds = await getAccessibleVendorIds(session.user);
  const periods = await Promise.all(
    selectedQuarters.map((quarter) => ensureFiscalPeriod(fiscalYear, quarter))
  );
  const periodIds = periods.map((period) => period.id);
  const periodById = new Map(periods.map((period) => [period.id, period]));
  const quarterByPeriodId = new Map(periods.map((period) => [period.id, period.quarter]));

  const [vendors, targets, forecasts, closings, actuals] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: accessibleVendorIds }, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        managerId: true,
        manager: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.target.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds } },
    }),
    prisma.forecast.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds }, isActive: true },
    }),
    prisma.closing.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds } },
    }),
    prisma.actual.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds } },
    }),
  ]);

  const vendorPeriodMetrics = new Map<string, Metrics>();
  const totals = emptyMetrics();
  const quarterMap = new Map<number, Metrics>();
  const weeklyMap = new Map<string, Metrics & { quarter: number; weekNumber: number }>();

  for (const quarter of selectedQuarters) {
    quarterMap.set(quarter, emptyMetrics());
  }

  for (const target of targets) {
    const quarter = quarterByPeriodId.get(target.fiscalPeriodId);
    if (!quarter) continue;
    const metrics = vendorPeriodMetrics.get(metricKey(target.vendorId, target.fiscalPeriodId)) ?? emptyMetrics();
    const part = { targetRevenue: Number(target.revenue), targetGp: Number(target.gp) };
    addMetrics(metrics, part);
    addMetrics(totals, part);
    addMetrics(quarterMap.get(quarter) ?? emptyMetrics(), part);
    vendorPeriodMetrics.set(metricKey(target.vendorId, target.fiscalPeriodId), metrics);
  }

  for (const forecast of forecasts) {
    const quarter = quarterByPeriodId.get(forecast.fiscalPeriodId);
    if (!quarter) continue;
    const metrics = vendorPeriodMetrics.get(metricKey(forecast.vendorId, forecast.fiscalPeriodId)) ?? emptyMetrics();
    const part = { forecastRevenue: Number(forecast.revenue), forecastGp: Number(forecast.gp) };
    addMetrics(metrics, part);
    addMetrics(totals, part);
    addMetrics(quarterMap.get(quarter) ?? emptyMetrics(), part);
    vendorPeriodMetrics.set(metricKey(forecast.vendorId, forecast.fiscalPeriodId), metrics);
  }

  for (const closing of closings) {
    const quarter = quarterByPeriodId.get(closing.fiscalPeriodId);
    if (!quarter) continue;
    const metrics = vendorPeriodMetrics.get(metricKey(closing.vendorId, closing.fiscalPeriodId)) ?? emptyMetrics();
    const part = { closingRevenue: Number(closing.revenue), closingGp: Number(closing.gp) };
    addMetrics(metrics, part);
    addMetrics(totals, part);
    addMetrics(quarterMap.get(quarter) ?? emptyMetrics(), part);
    vendorPeriodMetrics.set(metricKey(closing.vendorId, closing.fiscalPeriodId), metrics);
  }

  for (const actual of actuals) {
    const period = periodById.get(actual.fiscalPeriodId);
    if (!period) continue;
    const metrics = vendorPeriodMetrics.get(metricKey(actual.vendorId, actual.fiscalPeriodId)) ?? emptyMetrics();
    const part = { backlogRevenue: Number(actual.backlog), backlogGp: Number(actual.invoiced) };
    addMetrics(metrics, part);
    addMetrics(totals, part);
    addMetrics(quarterMap.get(period.quarter) ?? emptyMetrics(), part);
    vendorPeriodMetrics.set(metricKey(actual.vendorId, actual.fiscalPeriodId), metrics);

    const weeklyKey = `${period.quarter}:${actual.weekNumber}`;
    const weekly =
      weeklyMap.get(weeklyKey) ??
      {
        quarter: period.quarter,
        weekNumber: actual.weekNumber,
        ...emptyMetrics(),
      };
    addMetrics(weekly, part);
    weeklyMap.set(weeklyKey, weekly);
  }

  const closingKeys = new Set(closings.map((closing) => metricKey(closing.vendorId, closing.fiscalPeriodId)));
  const managerMap = new Map<
    string,
    {
      id: string;
      managerName: string;
      metrics: Metrics;
      vendors: Map<
        string,
        {
          vendorId: string;
          vendorName: string;
          vendorCode: string | null;
          metrics: Metrics;
          closingCount: number;
          periodCount: number;
        }
      >;
    }
  >();

  for (const vendor of vendors) {
    const groupId = vendor.managerId ?? "unassigned";
    const group =
      managerMap.get(groupId) ??
      {
        id: groupId,
        managerName: vendor.manager?.name ?? "Atanmamış",
        metrics: emptyMetrics(),
        vendors: new Map(),
      };

    const vendorSummary =
      group.vendors.get(vendor.id) ??
      {
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorCode: vendor.code,
        metrics: emptyMetrics(),
        closingCount: 0,
        periodCount: periods.length,
      };

    for (const period of periods) {
      const metrics = vendorPeriodMetrics.get(metricKey(vendor.id, period.id));
      if (metrics) {
        addMetrics(vendorSummary.metrics, metrics);
        addMetrics(group.metrics, metrics);
      }
      if (closingKeys.has(metricKey(vendor.id, period.id))) {
        vendorSummary.closingCount += 1;
      }
    }

    group.vendors.set(vendor.id, vendorSummary);
    managerMap.set(groupId, group);
  }

  const managers = Array.from(managerMap.values())
    .map((manager) => ({
      id: manager.id,
      managerName: manager.managerName,
      ...enrichMetrics(manager.metrics),
      vendors: Array.from(manager.vendors.values())
        .map((vendor) => ({
          vendorId: vendor.vendorId,
          vendorName: vendor.vendorName,
          vendorCode: vendor.vendorCode,
          closingCount: vendor.closingCount,
          periodCount: vendor.periodCount,
          ...enrichMetrics(vendor.metrics),
        }))
        .sort((a, b) => a.vendorName.localeCompare(b.vendorName, "tr")),
    }))
    .sort((a, b) => b.closingGpAchievement - a.closingGpAchievement || a.managerName.localeCompare(b.managerName, "tr"));

  const quarterSummary = selectedQuarters.map((quarter) => ({
    quarter,
    ...enrichMetrics(quarterMap.get(quarter) ?? emptyMetrics()),
  }));

  const weeklyBacklog = Array.from(weeklyMap.values())
    .map((week) => ({
      quarter: week.quarter,
      weekNumber: week.weekNumber,
      ...enrichMetrics(week),
    }))
    .sort((a, b) => a.quarter - b.quarter || a.weekNumber - b.weekNumber);

  const risks = managers
    .flatMap((manager) =>
      manager.vendors.flatMap((vendor) => {
        const items = [];
        if (vendor.closingCount < vendor.periodCount) {
          items.push({
            type: "Eksik Kapanış",
            severity: "high",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: `${vendor.periodCount - vendor.closingCount} dönem için kapanış verisi yok.`,
          });
        }
        if (vendor.targetGp > 0 && vendor.closingGpAchievement < 75) {
          items.push({
            type: "Düşük GP Achievement",
            severity: "high",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: `Kapanış GP achievement ${vendor.closingGpAchievement.toFixed(1)}%.`,
          });
        }
        if (vendor.closingGp > 0 && vendor.forecastGpAccuracy < 75) {
          items.push({
            type: "Forecast Sapması",
            severity: "medium",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: `Forecast GP accuracy ${vendor.forecastGpAccuracy.toFixed(1)}%.`,
          });
        }
        if (vendor.closingRevenue > 0 && vendor.closingGpPercent < 10) {
          items.push({
            type: "Düşük GP%",
            severity: "medium",
            managerName: manager.managerName,
            vendorName: vendor.vendorName,
            detail: `Kapanış GP% ${vendor.closingGpPercent.toFixed(1)}%.`,
          });
        }
        return items;
      })
    )
    .slice(0, 16);

  return {
    fiscalYear,
    quarters: selectedQuarters,
    totals: enrichMetrics(totals),
    managers,
    quarterSummary,
    weeklyBacklog,
    risks,
  };
}
