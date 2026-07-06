import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { getFiscalContext } from "@/lib/fiscal";
import { assertVendorAccess, getAccessibleVendorIds } from "@/lib/scope";
import type { MobileSessionUser } from "./auth";

function calculateGpPercent(revenue: number, gp: number) {
  return revenue > 0 ? (gp / revenue) * 100 : 0;
}

function assertCurrentFiscalPeriod(fiscalYear: number, quarter: number) {
  const currentContext = getFiscalContext(new Date());

  if (currentContext.fiscalYear !== fiscalYear || currentContext.quarter !== quarter) {
    throw new Error(
      `Forecast yalnızca aktif çeyrek için girilebilir. Aktif dönem FY${currentContext.fiscalYear} - Q${currentContext.quarter}, aktif hafta ${currentContext.weekInQuarter}. hafta.`
    );
  }

  return currentContext.weekInQuarter;
}

async function writeActiveForecast(
  tx: Prisma.TransactionClient,
  input: {
    vendorId: string;
    fiscalPeriodId: string;
    weekNumber: number;
    revenue: number;
    gp: number;
    submittedById: string;
  }
) {
  const previousActive = await tx.forecast.findFirst({
    where: {
      vendorId: input.vendorId,
      fiscalPeriodId: input.fiscalPeriodId,
      isActive: true,
    },
  });

  const existingWeekForecast = await tx.forecast.findFirst({
    where: {
      vendorId: input.vendorId,
      fiscalPeriodId: input.fiscalPeriodId,
      weekNumber: input.weekNumber,
    },
  });

  await tx.forecast.updateMany({
    where: {
      vendorId: input.vendorId,
      fiscalPeriodId: input.fiscalPeriodId,
      ...(existingWeekForecast ? { id: { not: existingWeekForecast.id } } : {}),
    },
    data: {
      isActive: false,
    },
  });

  const forecast = existingWeekForecast
    ? await tx.forecast.update({
        where: { id: existingWeekForecast.id },
        data: {
          revenue: input.revenue,
          gp: input.gp,
          submittedById: input.submittedById,
          isActive: true,
        },
      })
    : await tx.forecast.create({
        data: {
          vendorId: input.vendorId,
          fiscalPeriodId: input.fiscalPeriodId,
          weekNumber: input.weekNumber,
          revenue: input.revenue,
          gp: input.gp,
          submittedById: input.submittedById,
          isActive: true,
        },
      });

  return {
    forecast,
    previousActive,
    wasUpdate: Boolean(previousActive && previousActive.weekNumber === input.weekNumber),
  };
}

export async function getMobileActiveForecasts(user: MobileSessionUser, fiscalYear: number, quarter: number) {
  const currentContext = getFiscalContext(new Date());
  const isCurrentFiscalPeriod = currentContext.fiscalYear === fiscalYear && currentContext.quarter === quarter;
  const activeBacklogWeekNumber = currentContext.weekInQuarter;
  const accessibleVendorIds = await getAccessibleVendorIds(user);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  const [vendors, forecasts, targets, actuals] = await Promise.all([
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
        ...(isCurrentFiscalPeriod ? { weekNumber: currentContext.weekInQuarter } : { isActive: true }),
      },
    }),
    prisma.target.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: period.id,
      },
    }),
    prisma.actual.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: period.id,
        weekNumber: activeBacklogWeekNumber,
      },
    }),
  ]);

  const forecastMap = new Map(forecasts.map((forecast) => [forecast.vendorId, forecast]));
  const targetMap = new Map(targets.map((target) => [target.vendorId, target]));
  const actualMap = new Map(actuals.map((actual) => [actual.vendorId, actual]));

  return vendors.map((vendor) => {
    const forecast = forecastMap.get(vendor.id);
    const target = targetMap.get(vendor.id);
    const actual = actualMap.get(vendor.id);
    const forecastRevenue = forecast ? Number(forecast.revenue) : 0;
    const forecastGp = forecast ? Number(forecast.gp) : 0;
    const targetRevenue = target ? Number(target.revenue) : 0;
    const targetGp = target ? Number(target.gp) : 0;
    const backlogRevenue = actual ? Number(actual.backlog) : 0;

    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      managerId: vendor.managerId,
      managerName: vendor.manager?.name ?? null,
      targetRevenue,
      targetGp,
      targetGpPercent: calculateGpPercent(targetRevenue, targetGp),
      revenue: forecastRevenue,
      gp: forecastGp,
      gpPercent: calculateGpPercent(forecastRevenue, forecastGp),
      revenueAchievement: targetRevenue > 0 ? (forecastRevenue / targetRevenue) * 100 : 0,
      gpAchievement: targetGp > 0 ? (forecastGp / targetGp) * 100 : 0,
      weekNumber: forecast?.weekNumber ?? null,
      submittedAt: forecast?.updatedAt?.toISOString() ?? null,
      hasForecast: Boolean(forecast),
      hasTarget: Boolean(target),
      backlogRevenue,
      backlogWeekNumber: activeBacklogWeekNumber,
      hasBacklog: Boolean(actual),
      isBelowBacklog: Boolean(forecast && actual && forecastRevenue < backlogRevenue),
      isPeriodLocked: period.isLocked,
    };
  });
}

export async function getMobileForecastVersions(
  user: MobileSessionUser,
  vendorId: string,
  fiscalYear: number,
  quarter: number
) {
  await assertVendorAccess(user, vendorId);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  const versions = await prisma.forecast.findMany({
    where: {
      vendorId,
      fiscalPeriodId: period.id,
    },
    orderBy: [{ weekNumber: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      weekNumber: true,
      revenue: true,
      gp: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      submittedBy: {
        select: {
          name: true,
        },
      },
    },
  });

  return versions.map((version) => {
    const revenue = Number(version.revenue);
    const gp = Number(version.gp);

    return {
      id: version.id,
      weekNumber: version.weekNumber,
      revenue,
      gp,
      gpPercent: calculateGpPercent(revenue, gp),
      isActive: version.isActive,
      submittedAt: version.updatedAt.toISOString(),
      createdAt: version.createdAt.toISOString(),
      submittedByName: version.submittedBy.name,
    };
  });
}

export async function submitMobileForecast(
  user: MobileSessionUser,
  input: {
    vendorId: string;
    fiscalYear: number;
    quarter: number;
    revenue: number;
    gp: number;
  }
) {
  await assertVendorAccess(user, input.vendorId);
  const weekNumber = assertCurrentFiscalPeriod(input.fiscalYear, input.quarter);
  const period = await ensureFiscalPeriod(input.fiscalYear, input.quarter);

  if (period.isLocked) {
    throw new Error("Seçilen çeyrek kilitlenmiş durumdadır. Kilitli dönemler üzerinde forecast girilemez.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const { forecast, previousActive, wasUpdate } = await writeActiveForecast(tx, {
      vendorId: input.vendorId,
      fiscalPeriodId: period.id,
      weekNumber,
      revenue: input.revenue,
      gp: input.gp,
      submittedById: user.id,
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "MOBILE_FORECAST_SUBMIT",
        entityType: "Forecast",
        entityId: forecast.id,
        oldValue: previousActive
          ? {
              id: previousActive.id,
              weekNumber: previousActive.weekNumber,
              revenue: Number(previousActive.revenue),
              gp: Number(previousActive.gp),
              isActive: previousActive.isActive,
            }
          : Prisma.JsonNull,
        newValue: {
          id: forecast.id,
          weekNumber: forecast.weekNumber,
          revenue: Number(forecast.revenue),
          gp: Number(forecast.gp),
          isActive: forecast.isActive,
        },
      },
    });

    return {
      forecast,
      wasUpdate,
    };
  });

  return {
    forecastId: result.forecast.id,
    weekNumber,
    updatedExistingWeek: result.wasUpdate,
  };
}
