"use server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { getAccessibleVendorIds } from "@/lib/scope";

function calculateGpPercent(revenue: number, gp: number) {
  return revenue > 0 ? (gp / revenue) * 100 : 0;
}

function calculateAccuracy(value: number, baseline: number) {
  if (baseline <= 0) return 0;
  return Math.max(0, 100 - (Math.abs(value - baseline) / baseline) * 100);
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalizeNumbers(values: number[] | undefined, fallback: number[]) {
  const normalized = Array.from(new Set((values ?? fallback).filter((value) => Number.isFinite(value)))).sort(
    (a, b) => a - b
  );
  return normalized.length > 0 ? normalized : fallback;
}

export async function getForecastHistoryData(fiscalYear: number, quarter: number) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  const accessibleVendorIds = await getAccessibleVendorIds(session.user);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  const [vendors, forecasts, targets] = await Promise.all([
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
    prisma.forecast.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: period.id,
      },
      select: {
        id: true,
        vendorId: true,
        weekNumber: true,
        revenue: true,
        gp: true,
        isActive: true,
        updatedAt: true,
        submittedBy: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [
        { weekNumber: "asc" },
        { updatedAt: "asc" },
      ],
    }),
    prisma.target.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: period.id,
      },
      select: {
        vendorId: true,
        revenue: true,
        gp: true,
      },
    }),
  ]);

  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const activeForecastMap = new Map(forecasts.filter((forecast) => forecast.isActive).map((forecast) => [forecast.vendorId, forecast]));
  const targetMap = new Map(targets.map((target) => [target.vendorId, target]));

  const forecastRows = forecasts
    .map((forecast) => {
      const vendor = vendorMap.get(forecast.vendorId);
      const activeForecast = activeForecastMap.get(forecast.vendorId);
      const target = targetMap.get(forecast.vendorId);
      const revenue = Number(forecast.revenue);
      const gp = Number(forecast.gp);
      const baselineRevenue = activeForecast ? Number(activeForecast.revenue) : target ? Number(target.revenue) : 0;
      const baselineGp = activeForecast ? Number(activeForecast.gp) : target ? Number(target.gp) : 0;

      return {
        id: forecast.id,
        vendorId: forecast.vendorId,
        vendorName: vendor?.name ?? "Bilinmeyen Marka",
        managerId: vendor?.managerId ?? "unassigned",
        managerName: vendor?.manager?.name ?? "Atanmamış",
        weekNumber: forecast.weekNumber,
        isActive: forecast.isActive,
        revenue,
        gp,
        gpPercent: calculateGpPercent(revenue, gp),
        revenueAccuracy: calculateAccuracy(revenue, baselineRevenue),
        gpAccuracy: calculateAccuracy(gp, baselineGp),
        baselineRevenue,
        baselineGp,
        updatedAt: forecast.updatedAt,
        submittedByName: forecast.submittedBy.name,
      };
    });

  type ForecastHistoryRow = (typeof forecastRows)[number];
  type VendorGroup = {
    vendorId: string;
    vendorName: string;
    rows: ForecastHistoryRow[];
    revenue: number;
    gp: number;
    revenueAccuracyValues: number[];
    gpAccuracyValues: number[];
    activeCount: number;
  };
  type ManagerGroup = {
    id: string;
    managerName: string;
    rows: ForecastHistoryRow[];
    vendorMap: Map<string, VendorGroup>;
    weeklyMap: Map<
      number,
      {
        weekNumber: number;
        rows: ForecastHistoryRow[];
        revenue: number;
        gp: number;
        revenueAccuracyValues: number[];
        gpAccuracyValues: number[];
        activeCount: number;
        vendorIds: Set<string>;
        updatedAt: Date;
      }
    >;
    revenue: number;
    gp: number;
    revenueAccuracyValues: number[];
    gpAccuracyValues: number[];
    activeCount: number;
  };

  const managerMap = new Map<string, ManagerGroup>();

  for (const row of forecastRows) {
    const group: ManagerGroup =
      managerMap.get(row.managerId) ??
      {
        id: row.managerId,
        managerName: row.managerName,
        rows: [],
        vendorMap: new Map<string, VendorGroup>(),
        weeklyMap: new Map(),
        revenue: 0,
        gp: 0,
        revenueAccuracyValues: [],
        gpAccuracyValues: [],
        activeCount: 0,
      };
    const vendorGroup: VendorGroup =
      group.vendorMap.get(row.vendorId) ??
      {
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        rows: [],
        revenue: 0,
        gp: 0,
        revenueAccuracyValues: [],
        gpAccuracyValues: [],
        activeCount: 0,
      };
    const managerWeek: ManagerGroup["weeklyMap"] extends Map<number, infer WeekGroup> ? WeekGroup : never =
      group.weeklyMap.get(row.weekNumber) ??
      {
        weekNumber: row.weekNumber,
        rows: [],
        revenue: 0,
        gp: 0,
        revenueAccuracyValues: [],
        gpAccuracyValues: [],
        activeCount: 0,
        vendorIds: new Set<string>(),
        updatedAt: row.updatedAt,
      };

    group.rows.push(row);
    group.revenue += row.revenue;
    group.gp += row.gp;
    if (row.revenueAccuracy > 0) group.revenueAccuracyValues.push(row.revenueAccuracy);
    if (row.gpAccuracy > 0) group.gpAccuracyValues.push(row.gpAccuracy);
    if (row.isActive) group.activeCount += 1;

    managerWeek.rows.push(row);
    managerWeek.revenue += row.revenue;
    managerWeek.gp += row.gp;
    if (row.revenueAccuracy > 0) managerWeek.revenueAccuracyValues.push(row.revenueAccuracy);
    if (row.gpAccuracy > 0) managerWeek.gpAccuracyValues.push(row.gpAccuracy);
    if (row.isActive) managerWeek.activeCount += 1;
    managerWeek.vendorIds.add(row.vendorId);
    if (row.updatedAt > managerWeek.updatedAt) managerWeek.updatedAt = row.updatedAt;

    vendorGroup.rows.push(row);
    vendorGroup.revenue += row.revenue;
    vendorGroup.gp += row.gp;
    if (row.revenueAccuracy > 0) vendorGroup.revenueAccuracyValues.push(row.revenueAccuracy);
    if (row.gpAccuracy > 0) vendorGroup.gpAccuracyValues.push(row.gpAccuracy);
    if (row.isActive) vendorGroup.activeCount += 1;
    group.vendorMap.set(row.vendorId, vendorGroup);
    group.weeklyMap.set(row.weekNumber, managerWeek);
    managerMap.set(row.managerId, group);
  }

  const managers = Array.from(managerMap.values())
    .map((manager) => ({
      id: manager.id,
      managerName: manager.managerName,
      rowCount: manager.rows.length,
      activeCount: manager.activeCount,
      archivedCount: manager.rows.length - manager.activeCount,
      revenue: manager.revenue,
      gp: manager.gp,
      gpPercent: calculateGpPercent(manager.revenue, manager.gp),
      revenueAccuracy: average(manager.revenueAccuracyValues),
      gpAccuracy: average(manager.gpAccuracyValues),
      weeklyTotals: Array.from(manager.weeklyMap.values())
        .map((week) => ({
          weekNumber: week.weekNumber,
          rowCount: week.rows.length,
          activeCount: week.activeCount,
          archivedCount: week.rows.length - week.activeCount,
          vendorCount: week.vendorIds.size,
          revenue: week.revenue,
          gp: week.gp,
          gpPercent: calculateGpPercent(week.revenue, week.gp),
          revenueAccuracy: average(week.revenueAccuracyValues),
          gpAccuracy: average(week.gpAccuracyValues),
          updatedAt: week.updatedAt,
        }))
        .sort((a, b) => a.weekNumber - b.weekNumber),
      vendors: Array.from(manager.vendorMap.values())
        .map((vendor) => ({
          vendorId: vendor.vendorId,
          vendorName: vendor.vendorName,
          rowCount: vendor.rows.length,
          activeCount: vendor.activeCount,
          archivedCount: vendor.rows.length - vendor.activeCount,
          revenue: vendor.revenue,
          gp: vendor.gp,
          gpPercent: calculateGpPercent(vendor.revenue, vendor.gp),
          revenueAccuracy: average(vendor.revenueAccuracyValues),
          gpAccuracy: average(vendor.gpAccuracyValues),
          rows: vendor.rows.sort((a, b) => a.weekNumber - b.weekNumber),
        }))
        .sort((a, b) => a.vendorName.localeCompare(b.vendorName, "tr")),
    }))
    .sort((a, b) => a.managerName.localeCompare(b.managerName, "tr"));

  const weekMap = new Map<
    number,
    {
      weekNumber: number;
      count: number;
      revenue: number;
      gp: number;
      revenueAccuracyValues: number[];
    }
  >();

  for (const row of forecastRows) {
    const week =
      weekMap.get(row.weekNumber) ??
      {
        weekNumber: row.weekNumber,
        count: 0,
        revenue: 0,
        gp: 0,
        revenueAccuracyValues: [],
      };

    week.count += 1;
    week.revenue += row.revenue;
    week.gp += row.gp;
    if (row.revenueAccuracy > 0) week.revenueAccuracyValues.push(row.revenueAccuracy);
    weekMap.set(row.weekNumber, week);
  }

  const weeklySummary = Array.from(weekMap.values())
    .map((week) => ({
      weekNumber: week.weekNumber,
      count: week.count,
      revenue: week.revenue,
      gp: week.gp,
      gpPercent: calculateGpPercent(week.revenue, week.gp),
      revenueAccuracy: average(week.revenueAccuracyValues),
    }))
    .sort((a, b) => a.weekNumber - b.weekNumber);

  const accuracyValues = forecastRows.map((row) => row.revenueAccuracy).filter((value) => value > 0);
  const gpAccuracyValues = forecastRows.map((row) => row.gpAccuracy).filter((value) => value > 0);

  return {
    fiscalYear,
    quarter,
    totals: {
      forecastCount: forecastRows.length,
      archivedCount: forecastRows.filter((row) => !row.isActive).length,
      activeCount: forecastRows.filter((row) => row.isActive).length,
      vendorCount: new Set(forecastRows.map((row) => row.vendorId)).size,
      revenue: forecastRows.reduce((sum, row) => sum + row.revenue, 0),
      gp: forecastRows.reduce((sum, row) => sum + row.gp, 0),
      revenueAccuracy: average(accuracyValues),
      gpAccuracy: average(gpAccuracyValues),
    },
    managers,
    weeklySummary,
  };
}

export async function getForecastTrendData(params: {
  fiscalYears: number[];
  quarters: number[];
  managerIds: string[];
  vendorIds: string[];
}) {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  const fallbackYear = new Date().getFullYear();
  const fiscalYears = normalizeNumbers(params.fiscalYears, [fallbackYear]);
  const quarters = normalizeNumbers(params.quarters, [1, 2, 3, 4]).filter((quarter) => quarter >= 1 && quarter <= 4);
  const accessibleVendorIds = await getAccessibleVendorIds(session.user);

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
    Promise.all(fiscalYears.flatMap((year) => quarters.map((quarter) => ensureFiscalPeriod(year, quarter)))),
  ]);

  const managerIds = new Set(params.managerIds);
  const vendorIds = new Set(params.vendorIds);
  const filteredVendorIds = vendors
    .filter((vendor) => managerIds.size === 0 || (vendor.managerId && managerIds.has(vendor.managerId)))
    .filter((vendor) => vendorIds.size === 0 || vendorIds.has(vendor.id))
    .map((vendor) => vendor.id);
  const periodIds = periods.map((period) => period.id);
  const periodById = new Map(periods.map((period) => [period.id, period]));

  const forecasts = await prisma.forecast.findMany({
    where: {
      vendorId: { in: filteredVendorIds },
      fiscalPeriodId: { in: periodIds },
    },
    select: {
      fiscalPeriodId: true,
      weekNumber: true,
      revenue: true,
      gp: true,
      isActive: true,
    },
    orderBy: [
      { fiscalPeriodId: "asc" },
      { weekNumber: "asc" },
    ],
  });

  const pointMap = new Map<
    string,
    {
      fiscalYear: number;
      quarter: number;
      weekNumber: number;
      revenue: number;
      gp: number;
      activeCount: number;
      archivedCount: number;
      count: number;
    }
  >();

  for (const forecast of forecasts) {
    const period = periodById.get(forecast.fiscalPeriodId);
    if (!period) continue;
    const key = `${period.fiscalYear}:${period.quarter}:${forecast.weekNumber}`;
    const point =
      pointMap.get(key) ??
      {
        fiscalYear: period.fiscalYear,
        quarter: period.quarter,
        weekNumber: forecast.weekNumber,
        revenue: 0,
        gp: 0,
        activeCount: 0,
        archivedCount: 0,
        count: 0,
      };

    point.revenue += Number(forecast.revenue);
    point.gp += Number(forecast.gp);
    point.count += 1;
    if (forecast.isActive) point.activeCount += 1;
    else point.archivedCount += 1;
    pointMap.set(key, point);
  }

  const points = Array.from(pointMap.values())
    .sort((a, b) => a.fiscalYear - b.fiscalYear || a.quarter - b.quarter || a.weekNumber - b.weekNumber)
    .map((point, index, rows) => {
      const previous = rows[index - 1];
      return {
        ...point,
        label: `FY${point.fiscalYear} Q${point.quarter} H${point.weekNumber}`,
        gpPercent: calculateGpPercent(point.revenue, point.gp),
        revenueChange: previous ? point.revenue - previous.revenue : 0,
        gpChange: previous ? point.gp - previous.gp : 0,
      };
    });

  const managerOptions = Array.from(
    new Map(
      vendors.map((vendor) => [
        vendor.managerId ?? "unassigned",
        {
          id: vendor.managerId ?? "unassigned",
          name: vendor.manager?.name ?? "Atanmamış",
        },
      ])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name, "tr"));

  return {
    points,
    managerOptions,
    vendorOptions: vendors.map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      managerId: vendor.managerId ?? "unassigned",
    })),
  };
}
