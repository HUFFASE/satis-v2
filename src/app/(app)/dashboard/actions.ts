"use server";

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getAccessibleVendorIds } from "@/lib/scope";
import { getFiscalContext } from "@/lib/fiscal";
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

export async function getDashboardData(quarter?: number) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const current = getFiscalContext(new Date());
  const selectedQuarter = quarter && Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? quarter : current.quarter;
  const isCurrentQuarter = selectedQuarter === current.quarter;
  const accessibleVendorIds = await getAccessibleVendorIds(session.user);
  const selectedPeriod = await ensureFiscalPeriod(current.fiscalYear, selectedQuarter);

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

  const [targets, activeForecasts, actualRows, trendRows] = await Promise.all([
    prisma.target.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: selectedPeriod.id,
      },
    }),
    prisma.forecast.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: selectedPeriod.id,
        isActive: true,
      },
    }),
    prisma.actual.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: selectedPeriod.id,
        ...(isCurrentQuarter ? { weekNumber: { lte: current.weekInQuarter } } : {}),
      },
    }),
    // Haftalık trend: aktif olmayan versiyonlar dahil değil, her hafta o haftanın
    // yürürlükteki forecast'i olarak okunur.
    prisma.forecast.groupBy({
      by: ["weekNumber"],
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: selectedPeriod.id,
      },
      _sum: { revenue: true, gp: true },
      _count: { _all: true },
    }),
  ]);

  const targetMap = new Map(targets.map((target) => [target.vendorId, target]));
  const activeForecastMap = new Map(activeForecasts.map((forecast) => [forecast.vendorId, forecast]));
  const latestActualMap = getLatestBacklogSnapshots(actualRows, isCurrentQuarter ? current.weekInQuarter : undefined);

  // Geçmiş çeyreklerde 13 haftanın tamamı, içinde bulunulan çeyrekte yalnızca
  // yaşanmış haftalar gösterilir; aksi halde çizgi gelecek haftalarda sıfıra düşer.
  const lastTrendWeek = isCurrentQuarter ? Math.min(13, Math.max(1, current.weekInQuarter)) : 13;
  const trendMap = new Map(trendRows.map((row) => [row.weekNumber, row]));
  const weeklyTrend = Array.from({ length: lastTrendWeek }, (_, index) => {
    const weekNumber = index + 1;
    const row = trendMap.get(weekNumber);
    return {
      weekNumber,
      revenue: row?._sum.revenue ? Number(row._sum.revenue) : 0,
      gp: row?._sum.gp ? Number(row._sum.gp) : 0,
      vendorCount: row?._count._all ?? 0,
    };
  });

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
    const target = targetMap.get(vendor.id);
    const forecast = activeForecastMap.get(vendor.id);
    const actual = latestActualMap.get(`${vendor.id}:${selectedPeriod.id}`);
    const currentMetrics = {
      targetRevenue: target ? Number(target.revenue) : 0,
      targetGp: target ? Number(target.gp) : 0,
      forecastRevenue: forecast ? Number(forecast.revenue) : 0,
      forecastGp: forecast ? Number(forecast.gp) : 0,
      backlogRevenue: actual ? actualDisplayNsbTotal(actual) : 0,
      backlogGp: actual ? actualDisplayGpTotal(actual) : 0,
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

    if (forecast) group.forecastedCount += 1;
    if (target) group.targetCount += 1;

    group.vendors.push({
      vendorId: vendor.id,
      vendorName: vendor.name,
      current: enrichMetrics(currentMetrics),
      hasForecast: Boolean(forecast),
      hasTarget: Boolean(target),
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
    );

  // Kesme işlemi önceliğe göre sıralandıktan sonra yapılır; aksi halde listenin
  // sonundaki "high" bir uyarı, baştaki "low" uyarılar yüzünden düşebiliyordu.
  const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sortedAttentionItems = [...attentionItems].sort(
    (a, b) => (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3)
  );
  const attentionLimit = 12;

  return {
    attentionTotalCount: sortedAttentionItems.length,
    weeklyTrend,
    currentContext: current,
    selectedFiscalYear: current.fiscalYear,
    selectedQuarter,
    isCurrentQuarter,
    user: {
      role: session.user.role,
      name: session.user.name,
    },
    current: enrichMetrics(currentTotals),
    managers,
    attentionItems: sortedAttentionItems.slice(0, attentionLimit),
  };
}
