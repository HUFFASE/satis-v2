import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { getFiscalContext, getQuarterDateRange } from "@/lib/fiscal";
import { assertVendorAccess, getAccessibleVendorIds } from "@/lib/scope";
import { writeAuditLog } from "@/lib/audit";
import { getLatestBacklogSnapshots } from "@/lib/backlog";
import type { MobileSessionUser } from "./auth";

type MobileMetrics = ReturnType<typeof emptyMetrics>;

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

function addMetrics(base: MobileMetrics, part: Partial<MobileMetrics>) {
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

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function enrichMetrics(metrics: MobileMetrics) {
  return {
    ...metrics,
    targetGpPercent: calculateGpPercent(metrics.targetRevenue, metrics.targetGp),
    forecastGpPercent: calculateGpPercent(metrics.forecastRevenue, metrics.forecastGp),
    closingGpPercent: calculateGpPercent(metrics.closingRevenue, metrics.closingGp),
    backlogGpPercent: calculateGpPercent(metrics.backlogRevenue, metrics.backlogGp),
    forecastRevenueAchievement: calculatePercent(metrics.forecastRevenue, metrics.targetRevenue),
    forecastGpAchievement: calculatePercent(metrics.forecastGp, metrics.targetGp),
    closingRevenueAchievement: calculatePercent(metrics.closingRevenue, metrics.targetRevenue),
    closingGpAchievement: calculatePercent(metrics.closingGp, metrics.targetGp),
    forecastRevenueAccuracy: calculateAccuracy(metrics.forecastRevenue, metrics.closingRevenue),
    forecastGpAccuracy: calculateAccuracy(metrics.forecastGp, metrics.closingGp),
  };
}

function normalizeQuarters(quarters?: number[]) {
  const validQuarters = Array.from(new Set((quarters ?? [1, 2, 3, 4]).filter((quarter) => quarter >= 1 && quarter <= 4))).sort(
    (a, b) => a - b
  );
  return validQuarters.length > 0 ? validQuarters : [1, 2, 3, 4];
}

function metricKey(vendorId: string, fiscalPeriodId: string) {
  return `${vendorId}:${fiscalPeriodId}`;
}

async function getScopedVendors(user: MobileSessionUser, includeInactive = false) {
  const accessibleVendorIds = await getAccessibleVendorIds(user);
  return prisma.vendor.findMany({
    where: {
      id: { in: accessibleVendorIds },
      ...(includeInactive ? {} : { isActive: true }),
    },
    select: {
      id: true,
      name: true,
      code: true,
      logoUrl: true,
      isActive: true,
      managerId: true,
      manager: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function getMobilePeriods(fiscalYear?: number) {
  const current = getFiscalContext(new Date());
  const selectedFiscalYear = fiscalYear ?? current.fiscalYear;
  const periods = await Promise.all([1, 2, 3, 4].map((quarter) => ensureFiscalPeriod(selectedFiscalYear, quarter)));

  return {
    current,
    fiscalYear: selectedFiscalYear,
    periods: periods.map((period) => ({
      id: period.id,
      fiscalYear: period.fiscalYear,
      quarter: period.quarter,
      startDate: period.startDate.toISOString(),
      endDate: period.endDate.toISOString(),
      isLocked: period.isLocked,
      isCurrent: period.fiscalYear === current.fiscalYear && period.quarter === current.quarter,
    })),
  };
}

export async function getMobileVendors(user: MobileSessionUser) {
  const vendors = await getScopedVendors(user);
  return {
    vendors: vendors.map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      code: vendor.code,
      logoUrl: vendor.logoUrl,
      isActive: vendor.isActive,
      managerId: vendor.managerId,
      managerName: vendor.manager?.name ?? null,
      managerEmail: vendor.manager?.email ?? null,
    })),
  };
}

export async function getMobileDashboard(user: MobileSessionUser, fiscalYear?: number, quarters?: number[]) {
  const current = getFiscalContext(new Date());
  const selectedFiscalYear = fiscalYear ?? current.fiscalYear;
  const selectedQuarters = normalizeQuarters(quarters);
  const periods = await Promise.all(selectedQuarters.map((quarter) => ensureFiscalPeriod(selectedFiscalYear, quarter)));
  const periodIds = periods.map((period) => period.id);
  const periodById = new Map(periods.map((period) => [period.id, period]));
  const accessibleVendorIds = await getAccessibleVendorIds(user);

  const [vendors, targets, forecasts, actuals, closings] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: accessibleVendorIds }, isActive: true },
      select: { id: true, name: true, code: true, managerId: true, manager: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.target.findMany({ where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds } } }),
    prisma.forecast.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds }, isActive: true },
    }),
    prisma.actual.findMany({ where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds } } }),
    prisma.closing.findMany({ where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds } } }),
  ]);

  const totals = emptyMetrics();
  const quarterMap = new Map<number, MobileMetrics>();
  const managerMap = new Map<
    string,
    {
      id: string;
      managerName: string;
      metrics: MobileMetrics;
      vendorIds: Set<string>;
      forecastedVendorIds: Set<string>;
      targetedVendorIds: Set<string>;
      closedVendorIds: Set<string>;
    }
  >();

  for (const quarter of selectedQuarters) {
    quarterMap.set(quarter, emptyMetrics());
  }

  const vendorManager = new Map(
    vendors.map((vendor) => [
      vendor.id,
      {
        id: vendor.managerId ?? "unassigned",
        managerName: vendor.manager?.name ?? "Atanmamış",
      },
    ])
  );

  function managerFor(vendorId: string) {
    const manager = vendorManager.get(vendorId) ?? { id: "unassigned", managerName: "Atanmamış" };
    const group =
      managerMap.get(manager.id) ??
      {
        id: manager.id,
        managerName: manager.managerName,
        metrics: emptyMetrics(),
        vendorIds: new Set<string>(),
        forecastedVendorIds: new Set<string>(),
        targetedVendorIds: new Set<string>(),
        closedVendorIds: new Set<string>(),
      };
    group.vendorIds.add(vendorId);
    managerMap.set(manager.id, group);
    return group;
  }

  for (const target of targets) {
    const period = periodById.get(target.fiscalPeriodId);
    if (!period) continue;
    const part = { targetRevenue: Number(target.revenue), targetGp: Number(target.gp) };
    addMetrics(totals, part);
    addMetrics(quarterMap.get(period.quarter) ?? emptyMetrics(), part);
    const group = managerFor(target.vendorId);
    group.targetedVendorIds.add(target.vendorId);
    addMetrics(group.metrics, part);
  }

  for (const forecast of forecasts) {
    const period = periodById.get(forecast.fiscalPeriodId);
    if (!period) continue;
    const part = { forecastRevenue: Number(forecast.revenue), forecastGp: Number(forecast.gp) };
    addMetrics(totals, part);
    addMetrics(quarterMap.get(period.quarter) ?? emptyMetrics(), part);
    const group = managerFor(forecast.vendorId);
    group.forecastedVendorIds.add(forecast.vendorId);
    addMetrics(group.metrics, part);
  }

  const latestActuals = getLatestBacklogSnapshots(actuals);
  for (const actual of latestActuals.values()) {
    const period = periodById.get(actual.fiscalPeriodId);
    if (!period) continue;
    const part = { backlogRevenue: Number(actual.backlog), backlogGp: Number(actual.invoiced) };
    addMetrics(totals, part);
    addMetrics(quarterMap.get(period.quarter) ?? emptyMetrics(), part);
    addMetrics(managerFor(actual.vendorId).metrics, part);
  }

  for (const closing of closings) {
    const period = periodById.get(closing.fiscalPeriodId);
    if (!period) continue;
    const part = { closingRevenue: Number(closing.revenue), closingGp: Number(closing.gp) };
    addMetrics(totals, part);
    addMetrics(quarterMap.get(period.quarter) ?? emptyMetrics(), part);
    const group = managerFor(closing.vendorId);
    group.closedVendorIds.add(closing.vendorId);
    addMetrics(group.metrics, part);
  }

  for (const vendor of vendors) {
    managerFor(vendor.id);
  }

  return {
    fiscalYear: selectedFiscalYear,
    quarters: selectedQuarters,
    current,
    totals: enrichMetrics(totals),
    counts: {
      vendorCount: vendors.length,
      forecastedVendorCount: new Set(forecasts.map((forecast) => forecast.vendorId)).size,
      targetedVendorCount: new Set(targets.map((target) => target.vendorId)).size,
      closingVendorCount: new Set(closings.map((closing) => closing.vendorId)).size,
    },
    quarterSummary: selectedQuarters.map((quarter) => ({
      quarter,
      ...enrichMetrics(quarterMap.get(quarter) ?? emptyMetrics()),
    })),
    managers: Array.from(managerMap.values())
      .map((group) => ({
        id: group.id,
        managerName: group.managerName,
        vendorCount: group.vendorIds.size,
        forecastedVendorCount: group.forecastedVendorIds.size,
        targetedVendorCount: group.targetedVendorIds.size,
        closingVendorCount: group.closedVendorIds.size,
        ...enrichMetrics(group.metrics),
      }))
      .sort((a, b) => b.forecastRevenue - a.forecastRevenue || a.managerName.localeCompare(b.managerName, "tr")),
  };
}

export async function getMobileTargets(user: MobileSessionUser, fiscalYear: number, quarter: number) {
  const accessibleVendorIds = await getAccessibleVendorIds(user);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);
  const [vendors, targets] = await Promise.all([
    getScopedVendors(user),
    prisma.target.findMany({ where: { fiscalPeriodId: period.id, vendorId: { in: accessibleVendorIds } } }),
  ]);
  const targetMap = new Map(targets.map((target) => [target.vendorId, target]));

  return {
    fiscalYear,
    quarter,
    isPeriodLocked: period.isLocked,
    targets: vendors.map((vendor) => {
      const target = targetMap.get(vendor.id);
      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        managerId: vendor.managerId,
        managerName: vendor.manager?.name ?? null,
        revenue: target ? Number(target.revenue) : 0,
        gp: target ? Number(target.gp) : 0,
        gpPercent: target ? calculateGpPercent(Number(target.revenue), Number(target.gp)) : 0,
        updatedAt: target?.updatedAt.toISOString() ?? null,
        hasTarget: Boolean(target),
      };
    }),
  };
}

export async function upsertMobileTarget(
  user: MobileSessionUser,
  input: { vendorId: string; fiscalYear: number; quarter: number; revenue: number; gp: number }
) {
  await assertVendorAccess(user, input.vendorId);
  const period = await ensureFiscalPeriod(input.fiscalYear, input.quarter);
  if (period.isLocked) {
    throw new Error("Seçilen çeyrek kilitlenmiş durumdadır. Kilitli dönemler üzerinde hedef güncellemesi yapılamaz.");
  }

  const existing = await prisma.target.findUnique({
    where: { vendorId_fiscalPeriodId: { vendorId: input.vendorId, fiscalPeriodId: period.id } },
  });
  const target = await prisma.target.upsert({
    where: { vendorId_fiscalPeriodId: { vendorId: input.vendorId, fiscalPeriodId: period.id } },
    update: { revenue: input.revenue, gp: input.gp },
    create: { vendorId: input.vendorId, fiscalPeriodId: period.id, revenue: input.revenue, gp: input.gp },
  });

  await writeAuditLog({
    userId: user.id,
    action: existing ? "MOBILE_UPDATE_TARGET" : "MOBILE_CREATE_TARGET",
    entityType: "Target",
    entityId: target.id,
    oldValue: existing ? { revenue: Number(existing.revenue), gp: Number(existing.gp), fiscalPeriodId: period.id } : null,
    newValue: { revenue: Number(target.revenue), gp: Number(target.gp), fiscalPeriodId: period.id },
  });

  return { success: true, targetId: target.id };
}

export async function getMobileActuals(user: MobileSessionUser, fiscalYear: number, quarter: number, weekNumber: number) {
  const accessibleVendorIds = await getAccessibleVendorIds(user);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);
  const [vendors, actuals] = await Promise.all([
    getScopedVendors(user),
    prisma.actual.findMany({
      where: { fiscalPeriodId: period.id, vendorId: { in: accessibleVendorIds }, weekNumber },
    }),
  ]);
  const actualMap = new Map(actuals.map((actual) => [actual.vendorId, actual]));

  return {
    fiscalYear,
    quarter,
    weekNumber,
    isPeriodLocked: period.isLocked,
    actuals: vendors.map((vendor) => {
      const actual = actualMap.get(vendor.id);
      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        managerId: vendor.managerId,
        managerName: vendor.manager?.name ?? null,
        backlog: actual ? Number(actual.backlog) : 0,
        invoiced: actual ? Number(actual.invoiced) : 0,
        gpPercent: actual ? calculateGpPercent(Number(actual.backlog), Number(actual.invoiced)) : 0,
        updatedAt: actual?.updatedAt.toISOString() ?? null,
        hasActual: Boolean(actual),
      };
    }),
  };
}

export async function upsertMobileActual(
  user: MobileSessionUser,
  input: { vendorId: string; fiscalYear: number; quarter: number; weekNumber: number; backlog: number; invoiced: number }
) {
  await assertVendorAccess(user, input.vendorId);
  const period = await ensureFiscalPeriod(input.fiscalYear, input.quarter);
  if (period.isLocked) {
    throw new Error("Seçilen çeyrek kilitlenmiş durumdadır. Kilitli dönemler üzerinde gerçekleşme güncellemesi yapılamaz.");
  }

  const existing = await prisma.actual.findUnique({
    where: {
      vendorId_fiscalPeriodId_weekNumber: {
        vendorId: input.vendorId,
        fiscalPeriodId: period.id,
        weekNumber: input.weekNumber,
      },
    },
  });
  const actual = await prisma.actual.upsert({
    where: {
      vendorId_fiscalPeriodId_weekNumber: {
        vendorId: input.vendorId,
        fiscalPeriodId: period.id,
        weekNumber: input.weekNumber,
      },
    },
    update: { backlog: input.backlog, invoiced: input.invoiced },
    create: {
      vendorId: input.vendorId,
      fiscalPeriodId: period.id,
      weekNumber: input.weekNumber,
      backlog: input.backlog,
      invoiced: input.invoiced,
    },
  });

  await writeAuditLog({
    userId: user.id,
    action: existing ? "MOBILE_UPDATE_ACTUAL" : "MOBILE_CREATE_ACTUAL",
    entityType: "Actual",
    entityId: actual.id,
    oldValue: existing
      ? { backlog: Number(existing.backlog), invoiced: Number(existing.invoiced), weekNumber: input.weekNumber }
      : null,
    newValue: { backlog: Number(actual.backlog), invoiced: Number(actual.invoiced), weekNumber: input.weekNumber },
  });

  return { success: true, actualId: actual.id };
}

export async function getMobileClosings(user: MobileSessionUser, fiscalYear: number, quarter: number) {
  const accessibleVendorIds = await getAccessibleVendorIds(user);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);
  const [vendors, targets, forecasts, closings] = await Promise.all([
    getScopedVendors(user),
    prisma.target.findMany({ where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: period.id } }),
    prisma.forecast.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: period.id, isActive: true },
    }),
    prisma.closing.findMany({ where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: period.id } }),
  ]);

  const targetMap = new Map(targets.map((target) => [target.vendorId, target]));
  const forecastMap = new Map(forecasts.map((forecast) => [forecast.vendorId, forecast]));
  const closingMap = new Map(closings.map((closing) => [closing.vendorId, closing]));

  return {
    fiscalYear,
    quarter,
    isPeriodLocked: period.isLocked,
    closings: vendors.map((vendor) => {
      const target = targetMap.get(vendor.id);
      const forecast = forecastMap.get(vendor.id);
      const closing = closingMap.get(vendor.id);
      const targetRevenue = target ? Number(target.revenue) : 0;
      const targetGp = target ? Number(target.gp) : 0;
      const forecastRevenue = forecast ? Number(forecast.revenue) : 0;
      const forecastGp = forecast ? Number(forecast.gp) : 0;
      const closingRevenue = closing ? Number(closing.revenue) : 0;
      const closingGp = closing ? Number(closing.gp) : 0;

      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorCode: vendor.code,
        managerId: vendor.managerId,
        managerName: vendor.manager?.name ?? null,
        targetRevenue,
        targetGp,
        targetGpPercent: calculateGpPercent(targetRevenue, targetGp),
        forecastRevenue,
        forecastGp,
        forecastGpPercent: calculateGpPercent(forecastRevenue, forecastGp),
        closingRevenue,
        closingGp,
        closingGpPercent: calculateGpPercent(closingRevenue, closingGp),
        targetAchievement: calculatePercent(closingRevenue, targetRevenue),
        targetGpAchievement: calculatePercent(closingGp, targetGp),
        forecastAchievement: calculatePercent(closingRevenue, forecastRevenue),
        forecastGpAchievement: calculatePercent(closingGp, forecastGp),
        hasClosing: Boolean(closing),
        updatedAt: closing?.updatedAt.toISOString() ?? null,
      };
    }),
  };
}

export async function upsertMobileClosing(
  user: MobileSessionUser,
  input: { vendorId: string; fiscalYear: number; quarter: number; revenue: number; gp: number }
) {
  await assertVendorAccess(user, input.vendorId);
  const period = await ensureFiscalPeriod(input.fiscalYear, input.quarter);
  if (period.isLocked) {
    throw new Error("Seçilen çeyrek kilitlenmiş durumdadır. Kilitli dönemler üzerinde kapanış güncellemesi yapılamaz.");
  }

  const existing = await prisma.closing.findUnique({
    where: { vendorId_fiscalPeriodId: { vendorId: input.vendorId, fiscalPeriodId: period.id } },
  });
  const closing = await prisma.closing.upsert({
    where: { vendorId_fiscalPeriodId: { vendorId: input.vendorId, fiscalPeriodId: period.id } },
    update: { revenue: input.revenue, gp: input.gp },
    create: { vendorId: input.vendorId, fiscalPeriodId: period.id, revenue: input.revenue, gp: input.gp },
  });

  await writeAuditLog({
    userId: user.id,
    action: existing ? "MOBILE_UPDATE_CLOSING" : "MOBILE_CREATE_CLOSING",
    entityType: "Closing",
    entityId: closing.id,
    oldValue: existing ? { revenue: Number(existing.revenue), gp: Number(existing.gp), fiscalPeriodId: period.id } : null,
    newValue: { revenue: Number(closing.revenue), gp: Number(closing.gp), fiscalPeriodId: period.id },
  });

  return { success: true, closingId: closing.id };
}

export async function getMobileReports(user: MobileSessionUser, fiscalYear: number, quarters?: number[]) {
  const selectedQuarters = normalizeQuarters(quarters);
  const periods = await Promise.all(selectedQuarters.map((quarter) => ensureFiscalPeriod(fiscalYear, quarter)));
  const periodIds = periods.map((period) => period.id);
  const periodById = new Map(periods.map((period) => [period.id, period]));
  const accessibleVendorIds = await getAccessibleVendorIds(user);

  const [vendors, targets, forecasts, closings, actuals] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: accessibleVendorIds }, isActive: true },
      select: { id: true, name: true, code: true, managerId: true, manager: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.target.findMany({ where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds } } }),
    prisma.forecast.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds }, isActive: true },
    }),
    prisma.closing.findMany({ where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds } } }),
    prisma.actual.findMany({ where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: { in: periodIds } } }),
  ]);

  const totals = emptyMetrics();
  const quarterMap = new Map<number, MobileMetrics>();
  const vendorPeriodMetrics = new Map<string, MobileMetrics>();
  const weeklyMap = new Map<string, MobileMetrics & { quarter: number; weekNumber: number }>();
  for (const quarter of selectedQuarters) quarterMap.set(quarter, emptyMetrics());

  function addToVendorPeriod(vendorId: string, fiscalPeriodId: string, part: Partial<MobileMetrics>) {
    const period = periodById.get(fiscalPeriodId);
    if (!period) return;
    const metrics = vendorPeriodMetrics.get(metricKey(vendorId, fiscalPeriodId)) ?? emptyMetrics();
    addMetrics(metrics, part);
    addMetrics(totals, part);
    addMetrics(quarterMap.get(period.quarter) ?? emptyMetrics(), part);
    vendorPeriodMetrics.set(metricKey(vendorId, fiscalPeriodId), metrics);
  }

  for (const target of targets) {
    addToVendorPeriod(target.vendorId, target.fiscalPeriodId, {
      targetRevenue: Number(target.revenue),
      targetGp: Number(target.gp),
    });
  }
  for (const forecast of forecasts) {
    addToVendorPeriod(forecast.vendorId, forecast.fiscalPeriodId, {
      forecastRevenue: Number(forecast.revenue),
      forecastGp: Number(forecast.gp),
    });
  }
  for (const closing of closings) {
    addToVendorPeriod(closing.vendorId, closing.fiscalPeriodId, {
      closingRevenue: Number(closing.revenue),
      closingGp: Number(closing.gp),
    });
  }
  for (const actual of actuals) {
    const period = periodById.get(actual.fiscalPeriodId);
    if (!period) continue;
    const part = { backlogRevenue: Number(actual.backlog), backlogGp: Number(actual.invoiced) };
    addToVendorPeriod(actual.vendorId, actual.fiscalPeriodId, part);
    const weeklyKey = `${period.quarter}:${actual.weekNumber}`;
    const weekly = weeklyMap.get(weeklyKey) ?? { quarter: period.quarter, weekNumber: actual.weekNumber, ...emptyMetrics() };
    addMetrics(weekly, part);
    weeklyMap.set(weeklyKey, weekly);
  }

  const closingKeys = new Set(closings.map((closing) => metricKey(closing.vendorId, closing.fiscalPeriodId)));
  const managers = new Map<
    string,
    {
      id: string;
      managerName: string;
      metrics: MobileMetrics;
      vendors: Map<string, { vendorId: string; vendorName: string; vendorCode: string | null; metrics: MobileMetrics; closingCount: number; periodCount: number }>;
    }
  >();

  for (const vendor of vendors) {
    const groupId = vendor.managerId ?? "unassigned";
    const group =
      managers.get(groupId) ??
      { id: groupId, managerName: vendor.manager?.name ?? "Atanmamış", metrics: emptyMetrics(), vendors: new Map() };
    const vendorSummary =
      group.vendors.get(vendor.id) ??
      { vendorId: vendor.id, vendorName: vendor.name, vendorCode: vendor.code, metrics: emptyMetrics(), closingCount: 0, periodCount: periods.length };

    for (const period of periods) {
      const metrics = vendorPeriodMetrics.get(metricKey(vendor.id, period.id));
      if (metrics) {
        addMetrics(vendorSummary.metrics, metrics);
        addMetrics(group.metrics, metrics);
      }
      if (closingKeys.has(metricKey(vendor.id, period.id))) vendorSummary.closingCount += 1;
    }
    group.vendors.set(vendor.id, vendorSummary);
    managers.set(groupId, group);
  }

  const managerRows = Array.from(managers.values())
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

  const risks = managerRows
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
        return items;
      })
    )
    .slice(0, 16);

  return {
    fiscalYear,
    quarters: selectedQuarters,
    totals: enrichMetrics(totals),
    managers: managerRows,
    quarterSummary: selectedQuarters.map((quarter) => ({ quarter, ...enrichMetrics(quarterMap.get(quarter) ?? emptyMetrics()) })),
    weeklyBacklog: Array.from(weeklyMap.values())
      .map((week) => ({ quarter: week.quarter, weekNumber: week.weekNumber, ...enrichMetrics(week) }))
      .sort((a, b) => a.quarter - b.quarter || a.weekNumber - b.weekNumber),
    risks,
  };
}

export async function getMobileForecastHistory(user: MobileSessionUser, fiscalYear: number, quarter: number) {
  const accessibleVendorIds = await getAccessibleVendorIds(user);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);
  const [vendors, forecasts, targets] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: accessibleVendorIds }, isActive: true },
      select: { id: true, name: true, managerId: true, manager: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.forecast.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: period.id },
      select: {
        id: true,
        vendorId: true,
        weekNumber: true,
        revenue: true,
        gp: true,
        isActive: true,
        updatedAt: true,
        submittedBy: { select: { name: true } },
      },
      orderBy: [{ weekNumber: "asc" }, { updatedAt: "asc" }],
    }),
    prisma.target.findMany({ where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: period.id } }),
  ]);

  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const activeMap = new Map(forecasts.filter((forecast) => forecast.isActive).map((forecast) => [forecast.vendorId, forecast]));
  const targetMap = new Map(targets.map((target) => [target.vendorId, target]));

  const rows = forecasts.map((forecast) => {
    const vendor = vendorMap.get(forecast.vendorId);
    const activeForecast = activeMap.get(forecast.vendorId);
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
      updatedAt: forecast.updatedAt.toISOString(),
      submittedByName: forecast.submittedBy.name,
    };
  });

  const managers = Array.from(
    rows.reduce((map, row) => {
      const group =
        map.get(row.managerId) ??
        {
          id: row.managerId,
          managerName: row.managerName,
          rowCount: 0,
          activeCount: 0,
          revenue: 0,
          gp: 0,
          revenueAccuracyValues: [] as number[],
          gpAccuracyValues: [] as number[],
        };
      group.rowCount += 1;
      group.activeCount += row.isActive ? 1 : 0;
      group.revenue += row.revenue;
      group.gp += row.gp;
      if (row.revenueAccuracy > 0) group.revenueAccuracyValues.push(row.revenueAccuracy);
      if (row.gpAccuracy > 0) group.gpAccuracyValues.push(row.gpAccuracy);
      map.set(row.managerId, group);
      return map;
    }, new Map<string, { id: string; managerName: string; rowCount: number; activeCount: number; revenue: number; gp: number; revenueAccuracyValues: number[]; gpAccuracyValues: number[] }>())
      .values()
  ).map((group) => ({
    id: group.id,
    managerName: group.managerName,
    rowCount: group.rowCount,
    activeCount: group.activeCount,
    archivedCount: group.rowCount - group.activeCount,
    revenue: group.revenue,
    gp: group.gp,
    gpPercent: calculateGpPercent(group.revenue, group.gp),
    revenueAccuracy: average(group.revenueAccuracyValues),
    gpAccuracy: average(group.gpAccuracyValues),
  }));

  return { fiscalYear, quarter, rows, managers };
}

export async function getMobileForecastTrends(
  user: MobileSessionUser,
  params: { fiscalYear?: number; quarters?: number[]; managerId?: string; vendorId?: string }
) {
  const current = getFiscalContext(new Date());
  const fiscalYear = params.fiscalYear ?? current.fiscalYear;
  const selectedQuarters = normalizeQuarters(params.quarters);
  const periods = await Promise.all(selectedQuarters.map((quarter) => ensureFiscalPeriod(fiscalYear, quarter)));
  const periodIds = periods.map((period) => period.id);
  const periodById = new Map(periods.map((period) => [period.id, period]));
  const accessibleVendorIds = await getAccessibleVendorIds(user);

  const vendorWhere: Prisma.VendorWhereInput = {
    id: { in: accessibleVendorIds },
    isActive: true,
    ...(params.managerId ? { managerId: params.managerId === "unassigned" ? null : params.managerId } : {}),
    ...(params.vendorId ? { id: params.vendorId } : {}),
  };

  const vendors = await prisma.vendor.findMany({
    where: vendorWhere,
    select: { id: true, name: true, managerId: true, manager: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const vendorIds = vendors.map((vendor) => vendor.id);
  const forecasts = await prisma.forecast.findMany({
    where: { vendorId: { in: vendorIds }, fiscalPeriodId: { in: periodIds } },
    orderBy: [{ fiscalPeriodId: "asc" }, { weekNumber: "asc" }, { updatedAt: "asc" }],
  });

  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const trend = forecasts.map((forecast) => {
    const period = periodById.get(forecast.fiscalPeriodId);
    const vendor = vendorMap.get(forecast.vendorId);
    return {
      id: forecast.id,
      fiscalYear: period?.fiscalYear ?? fiscalYear,
      quarter: period?.quarter ?? 0,
      weekNumber: forecast.weekNumber,
      vendorId: forecast.vendorId,
      vendorName: vendor?.name ?? "Bilinmeyen Marka",
      managerId: vendor?.managerId ?? "unassigned",
      managerName: vendor?.manager?.name ?? "Atanmamış",
      revenue: Number(forecast.revenue),
      gp: Number(forecast.gp),
      gpPercent: calculateGpPercent(Number(forecast.revenue), Number(forecast.gp)),
      isActive: forecast.isActive,
      updatedAt: forecast.updatedAt.toISOString(),
    };
  });

  return { fiscalYear, quarters: selectedQuarters, trend };
}

export async function getMobileAdminUsers(user: MobileSessionUser) {
  if (user.role !== "DIREKTOR") throw new Error("Bu işlemi gerçekleştirmek için yetkiniz bulunmamaktadır.");
  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      imageUrl: true,
      managedVendors: { select: { id: true, name: true } },
    },
  });

  return {
    users: users.map((item) => ({
      id: item.id,
      name: item.name,
      email: item.email,
      role: item.role,
      isActive: item.isActive,
      imageUrl: item.imageUrl,
      assignedVendors: item.managedVendors.map((vendor) => vendor.name),
      assignedVendorIds: item.managedVendors.map((vendor) => vendor.id),
    })),
  };
}

export async function getMobileAdminVendors(user: MobileSessionUser) {
  if (user.role !== "DIREKTOR") throw new Error("Bu işlemi gerçekleştirmek için yetkiniz bulunmamaktadır.");
  const vendors = await prisma.vendor.findMany({
    orderBy: { name: "asc" },
    include: {
      manager: { select: { id: true, name: true, email: true } },
      _count: { select: { aliases: true, forecasts: true, targets: true, actuals: true, closings: true } },
    },
  });

  return {
    vendors: vendors.map((vendor) => ({
      id: vendor.id,
      name: vendor.name,
      code: vendor.code,
      logoUrl: vendor.logoUrl,
      isActive: vendor.isActive,
      managerId: vendor.manager?.id ?? null,
      managerName: vendor.manager?.name ?? null,
      managerEmail: vendor.manager?.email ?? null,
      aliasCount: vendor._count.aliases,
      forecastCount: vendor._count.forecasts,
      targetCount: vendor._count.targets,
      actualCount: vendor._count.actuals,
      closingCount: vendor._count.closings,
      hasTransactions: vendor._count.forecasts > 0 || vendor._count.targets > 0 || vendor._count.actuals > 0 || vendor._count.closings > 0,
    })),
  };
}

export async function getMobileVendorAliases(user: MobileSessionUser, vendorId: string) {
  if (user.role !== "DIREKTOR") throw new Error("Bu işlemi gerçekleştirmek için yetkiniz bulunmamaktadır.");
  const aliases = await prisma.vendorAlias.findMany({
    where: { vendorId },
    orderBy: { alias: "asc" },
  });
  return {
    aliases: aliases.map((alias) => ({
      id: alias.id,
      vendorId: alias.vendorId,
      alias: alias.alias,
      createdAt: alias.createdAt.toISOString(),
    })),
  };
}

export function getQuarterWeeks(fiscalYear: number, quarter: number) {
  const { startDate, endDate } = getQuarterDateRange(fiscalYear, quarter);
  const weeks = [];
  const current = new Date(startDate);
  let weekNumber = 1;

  while (current <= endDate) {
    const weekStart = new Date(current);
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (weekEnd > endDate) weekEnd.setTime(endDate.getTime());
    weeks.push({
      weekNumber,
      startDate: weekStart.toISOString(),
      endDate: weekEnd.toISOString(),
    });
    current.setDate(current.getDate() + 7);
    weekNumber += 1;
  }

  return weeks;
}
