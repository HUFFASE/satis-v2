"use server";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getAccessibleVendorIds } from "@/lib/scope";
import { getFiscalContext, hasMixedFiscalPeriods, isFiscalPeriodClosed } from "@/lib/fiscal";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { getLatestBacklogSnapshots } from "@/lib/backlog";
import { actualDisplayGpTotal, actualDisplayNsbTotal } from "@/lib/monthly";

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

function normalizeQuarters(quarters?: number[] | number): number[] {
  if (!quarters) return [];
  const list = Array.isArray(quarters) ? quarters : [quarters];
  const valid = Array.from(new Set(list.filter((q) => Number.isInteger(q) && q >= 1 && q <= 4))).sort((a, b) => a - b);
  return valid;
}

export async function getDashboardData(quarters?: number[] | number, fiscalYearParam?: number) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const current = getFiscalContext(new Date());
  const fiscalYear = fiscalYearParam ?? current.fiscalYear;
  const parsedQuarters = normalizeQuarters(quarters);
  const selectedQuarters = parsedQuarters.length > 0 ? parsedQuarters : [current.quarter];

  const accessibleVendorIds = await getAccessibleVendorIds(session.user);
  const periods = await Promise.all(
    selectedQuarters.map((quarter) => ensureFiscalPeriod(fiscalYear, quarter))
  );
  const periodIds = periods.map((period) => period.id);
  const periodIdByQuarter = new Map(periods.map((period) => [period.quarter, period.id]));

  const vendors = await prisma.vendor.findMany({
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
  });

  const isMixedPeriods = hasMixedFiscalPeriods(periods, current);
  const closedPeriods = periods.filter((p) => isFiscalPeriodClosed(p, current));
  const openPeriods = periods.filter((p) => !isFiscalPeriodClosed(p, current));

  const [targets, activeForecasts, actualRows, trendRows, closings] = await Promise.all([
    prisma.target.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: { in: periodIds },
      },
    }),
    prisma.forecast.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: { in: periodIds },
        isActive: true,
      },
    }),
    prisma.actual.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: { in: periodIds },
      },
    }),
    // Haftalık trend: seçili çeyrekler ve haftalar bazında gruplama
    prisma.forecast.groupBy({
      by: ["fiscalPeriodId", "weekNumber"],
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: { in: periodIds },
        isActive: true,
      },
      _sum: { revenue: true, gp: true },
      _count: { _all: true },
    }),
    prisma.closing.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: { in: periodIds },
      },
    }),
  ]);

  // Satıcı bazında toplam hedefler
  const targetSumsByVendor = new Map<string, { revenue: number; gp: number; count: number }>();
  for (const target of targets) {
    const existing = targetSumsByVendor.get(target.vendorId) ?? { revenue: 0, gp: 0, count: 0 };
    existing.revenue += Number(target.revenue);
    existing.gp += Number(target.gp);
    existing.count += 1;
    targetSumsByVendor.set(target.vendorId, existing);
  }

  // Satıcı ve dönem anahtarlı map'ler
  const metricKey = (vendorId: string, fiscalPeriodId: string) => `${vendorId}:${fiscalPeriodId}`;
  const forecastByVendorPeriod = new Map(
    activeForecasts.map((f) => [metricKey(f.vendorId, f.fiscalPeriodId), f])
  );
  const closingByVendorPeriod = new Map(
    closings.map((c) => [metricKey(c.vendorId, c.fiscalPeriodId), c])
  );

  // Satıcı bazında forecast/kapanış rakamları:
  // Eğer hem kapalı hem açık çeyrekler seçildiyse; kapalı çeyreklerde varsa kapanış (yoksa forecast), açık çeyreklerde forecast toplanır.
  const forecastSumsByVendor = new Map<string, { revenue: number; gp: number; count: number }>();

  for (const vendor of vendors) {
    const sum = { revenue: 0, gp: 0, count: 0 };

    for (const period of periods) {
      const key = metricKey(vendor.id, period.id);
      const isClosed = isFiscalPeriodClosed(period, current);

      if (isMixedPeriods) {
        if (isClosed) {
          const closing = closingByVendorPeriod.get(key);
          if (closing && (closing.revenue !== null || closing.gp !== null)) {
            sum.revenue += Number(closing.revenue ?? 0);
            sum.gp += Number(closing.gp ?? 0);
            sum.count += 1;
          } else {
            const forecast = forecastByVendorPeriod.get(key);
            if (forecast) {
              sum.revenue += Number(forecast.revenue);
              sum.gp += Number(forecast.gp);
              sum.count += 1;
            }
          }
        } else {
          // Açık çeyrek: forecast kullanılır
          const forecast = forecastByVendorPeriod.get(key);
          if (forecast) {
            sum.revenue += Number(forecast.revenue);
            sum.gp += Number(forecast.gp);
            sum.count += 1;
          }
        }
      } else {
        // Tek tür (tamamı açık veya tek çeyrek) - standart aktif forecast
        const forecast = forecastByVendorPeriod.get(key);
        if (forecast) {
          sum.revenue += Number(forecast.revenue);
          sum.gp += Number(forecast.gp);
          sum.count += 1;
        }
      }
    }

    forecastSumsByVendor.set(vendor.id, sum);
  }

  // Satıcı ve dönem bazında en güncel backlog
  // Kapanmış çeyreklerin backlogları artık satışa (kapanış/faturalanan) döndüğü için
  // sadece AÇIK (cari veya gelecek) çeyreklerin bekleyen backlog'u hesaplanır.
  const backlogSumsByVendor = new Map<string, { revenue: number; gp: number }>();
  for (const period of periods) {
    if (isFiscalPeriodClosed(period, current)) {
      // Kapalı çeyreklerin backlog'u satışa dönmüştür, bekleyen backlog olarak mükerrer sayılmaz
      continue;
    }
    const isThisCurrentQuarter = period.fiscalYear === current.fiscalYear && period.quarter === current.quarter;
    const periodActuals = actualRows.filter((row) => row.fiscalPeriodId === period.id);
    const latestActualMap = getLatestBacklogSnapshots(
      periodActuals,
      isThisCurrentQuarter ? current.weekInQuarter : undefined
    );

    for (const vendor of vendors) {
      const actual = latestActualMap.get(`${vendor.id}:${period.id}`);
      if (actual) {
        const existing = backlogSumsByVendor.get(vendor.id) ?? { revenue: 0, gp: 0 };
        existing.revenue += actualDisplayNsbTotal(actual);
        existing.gp += actualDisplayGpTotal(actual);
        backlogSumsByVendor.set(vendor.id, existing);
      }
    }
  }

  // Haftalık trend noktalarını sıralı oluştur
  const trendKey = (periodId: string, week: number) => `${periodId}:${week}`;
  const trendRowMap = new Map(trendRows.map((row) => [trendKey(row.fiscalPeriodId, row.weekNumber), row]));

  const weeklyTrend: Array<{
    quarter: number;
    weekNumber: number;
    label: string;
    tooltipLabel: string;
    revenue: number;
    gp: number;
    vendorCount: number;
  }> = [];

  for (const quarter of selectedQuarters) {
    const periodId = periodIdByQuarter.get(quarter);
    if (!periodId) continue;
    const isThisCurrentQuarter = fiscalYear === current.fiscalYear && quarter === current.quarter;
    const lastWeek = isThisCurrentQuarter ? Math.min(13, Math.max(1, current.weekInQuarter)) : 13;

    for (let w = 1; w <= lastWeek; w++) {
      const row = trendRowMap.get(trendKey(periodId, w));
      weeklyTrend.push({
        quarter,
        weekNumber: w,
        label: selectedQuarters.length > 1 ? `Q${quarter}H${w}` : `H${w}`,
        tooltipLabel: `Q${quarter} Hafta ${w}`,
        revenue: row?._sum.revenue ? Number(row._sum.revenue) : 0,
        gp: row?._sum.gp ? Number(row._sum.gp) : 0,
        vendorCount: row?._count._all ?? 0,
      });
    }
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
        hasForecast: boolean;
        hasTarget: boolean;
      }>;
      current: ReturnType<typeof emptyMetrics>;
      forecastedCount: number;
      targetCount: number;
    }
  >();

  const currentTotals = emptyMetrics();

  for (const vendor of vendors) {
    const targetData = targetSumsByVendor.get(vendor.id);
    const forecastData = forecastSumsByVendor.get(vendor.id);
    const backlogData = backlogSumsByVendor.get(vendor.id);

    const currentMetrics = {
      targetRevenue: targetData ? targetData.revenue : 0,
      targetGp: targetData ? targetData.gp : 0,
      forecastRevenue: forecastData ? forecastData.revenue : 0,
      forecastGp: forecastData ? forecastData.gp : 0,
      backlogRevenue: backlogData ? backlogData.revenue : 0,
      backlogGp: backlogData ? backlogData.gp : 0,
    };

    const groupId = vendor.managerId ?? "unassigned";
    const group =
      managerMap.get(groupId) ??
      {
        id: groupId,
        managerName: vendor.manager?.name ?? "Atanmamış",
        vendors: [],
        current: emptyMetrics(),
        forecastedCount: 0,
        targetCount: 0,
      };

    for (const key of Object.keys(currentMetrics) as Array<keyof typeof currentMetrics>) {
      group.current[key] += currentMetrics[key];
      currentTotals[key] += currentMetrics[key];
    }

    if (forecastData && forecastData.count > 0) group.forecastedCount += 1;
    if (targetData && targetData.count > 0) group.targetCount += 1;

    group.vendors.push({
      vendorId: vendor.id,
      vendorName: vendor.name,
      current: enrichMetrics(currentMetrics),
      hasForecast: Boolean(forecastData && forecastData.count > 0),
      hasTarget: Boolean(targetData && targetData.count > 0),
    });
    managerMap.set(groupId, group);
  }

  const managers = Array.from(managerMap.values())
    .map((manager) => ({
      ...manager,
      current: enrichMetrics(manager.current),
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
            detail: "Seçili dönem için aktif forecast girilmemiş.",
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
    );

  const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sortedAttentionItems = [...attentionItems].sort(
    (a, b) => (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3)
  );
  const attentionLimit = 12;

  return {
    attentionTotalCount: sortedAttentionItems.length,
    weeklyTrend,
    currentContext: current,
    selectedFiscalYear: fiscalYear,
    selectedQuarters,
    isMixedPeriods,
    closedQuarters: closedPeriods.map((p) => p.quarter),
    openQuarters: openPeriods.map((p) => p.quarter),
    user: {
      role: session.user.role,
      name: session.user.name,
    },
    current: enrichMetrics(currentTotals),
    managers,
    attentionItems: sortedAttentionItems.slice(0, attentionLimit),
  };
}
