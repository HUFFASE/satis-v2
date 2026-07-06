"use server";

import { auth } from "@/auth";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { getFiscalContext } from "@/lib/fiscal";
import prisma from "@/lib/prisma";
import { getAccessibleVendorIds } from "@/lib/scope";

type NotificationSeverity = "high" | "medium" | "low";
type NotificationType =
  | "GP_PERCENT_RISK"
  | "BACKLOG_FORECAST_RISK"
  | "FORECAST_MISSING"
  | "ACHIEVEMENT_RISK"
  | "CLOSING_MISSING"
  | "FORECAST_CHANGE"
  | "UPLOAD_RESULT";

interface NotificationItem {
  label: string;
  detail: string;
  value?: string;
}

interface NotificationGroup {
  type: NotificationType;
  title: string;
  summary: string;
  count: number;
  severity: NotificationSeverity;
  targetUrl: string;
  items: NotificationItem[];
}

const GP_PERCENT_THRESHOLD = 10;
const ACHIEVEMENT_THRESHOLD = 75;
const CHANGE_THRESHOLD = 20;

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatUSD(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function calculatePercent(value: number, target: number) {
  return target > 0 ? (value / target) * 100 : 0;
}

function calculateGpPercent(revenue: number, gp: number) {
  return revenue > 0 ? (gp / revenue) * 100 : 0;
}

function groupUrl(path: string, current: ReturnType<typeof getFiscalContext>) {
  return `${path}?fy=${current.fiscalYear}&q=${current.quarter}&week=${current.weekInQuarter}`;
}

export async function getNotificationGroups(): Promise<NotificationGroup[]> {
  const session = await auth();
  if (!session?.user) throw new Error("Oturum açık değil.");

  const current = getFiscalContext(new Date());
  const period = await ensureFiscalPeriod(current.fiscalYear, current.quarter);
  const accessibleVendorIds = await getAccessibleVendorIds(session.user);
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const [vendors, forecasts, targets, actuals, closings, recentImports] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: accessibleVendorIds }, isActive: true },
      select: {
        id: true,
        name: true,
        managerId: true,
        manager: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.forecast.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: period.id,
      },
      select: {
        vendorId: true,
        weekNumber: true,
        revenue: true,
        gp: true,
        isActive: true,
        updatedAt: true,
      },
      orderBy: [{ vendorId: "asc" }, { weekNumber: "asc" }],
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
    prisma.actual.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: period.id,
        weekNumber: current.weekInQuarter,
      },
      select: {
        vendorId: true,
        weekNumber: true,
        backlog: true,
      },
    }),
    prisma.closing.findMany({
      where: {
        vendorId: { in: accessibleVendorIds },
        fiscalPeriodId: period.id,
      },
      select: { vendorId: true },
    }),
    prisma.importLog.findMany({
      where: {
        uploadedById: session.user.id,
        createdAt: { gte: oneWeekAgo },
      },
      select: {
        dataType: true,
        fileName: true,
        rowCount: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const activeForecastByVendor = new Map(forecasts.filter((forecast) => forecast.isActive).map((forecast) => [forecast.vendorId, forecast]));
  const targetByVendor = new Map(targets.map((target) => [target.vendorId, target]));
  const activeActualByVendor = new Map(actuals.map((actual) => [actual.vendorId, actual]));
  const closingVendorIds = new Set(closings.map((closing) => closing.vendorId));
  const groups: NotificationGroup[] = [];

  const forecastMissingItems = vendors
    .filter((vendor) => !activeForecastByVendor.has(vendor.id))
    .map((vendor) => ({
      label: vendor.name,
      detail: vendor.manager?.name ?? "Atanmamış",
      value: `FY${current.fiscalYear} Q${current.quarter}`,
    }));

  if (forecastMissingItems.length > 0) {
    groups.push({
      type: "FORECAST_MISSING",
      title: "Forecast Eksik",
      summary: `${forecastMissingItems.length} vendor için forecast girilmemiş.`,
      count: forecastMissingItems.length,
      severity: "high",
      targetUrl: groupUrl("/forecast-input", current),
      items: forecastMissingItems,
    });
  }

  const gpRiskItems = forecasts
    .filter((forecast) => forecast.isActive)
    .map((forecast) => {
      const revenue = Number(forecast.revenue);
      const gp = Number(forecast.gp);
      const gpPercent = calculateGpPercent(revenue, gp);
      const vendor = vendorById.get(forecast.vendorId);
      return { forecast, vendor, gpPercent };
    })
    .filter((row) => row.vendor && row.gpPercent > 0 && row.gpPercent < GP_PERCENT_THRESHOLD)
    .map((row) => ({
      label: row.vendor?.name ?? "Bilinmeyen Vendor",
      detail: row.vendor?.manager?.name ?? "Atanmamış",
      value: formatPercent(row.gpPercent),
    }));

  if (gpRiskItems.length > 0) {
    groups.push({
      type: "GP_PERCENT_RISK",
      title: "GP% Uyarısı",
      summary: `${gpRiskItems.length} vendor GP% eşiğinin altında.`,
      count: gpRiskItems.length,
      severity: "high",
      targetUrl: groupUrl("/dashboard", current),
      items: gpRiskItems,
    });
  }

  const backlogRiskItems = forecasts
    .filter((forecast) => forecast.isActive)
    .flatMap((forecast) => {
      const actual = activeActualByVendor.get(forecast.vendorId);
      const vendor = vendorById.get(forecast.vendorId);
      if (!actual || !vendor) return [];

      const forecastRevenue = Number(forecast.revenue);
      const backlogRevenue = Number(actual.backlog);
      if (forecastRevenue >= backlogRevenue) return [];

      return [
        {
          label: vendor.name,
          detail: vendor.manager?.name ?? "Atanmamış",
          value: `Forecast ${formatUSD(forecastRevenue)} / Backlog ${formatUSD(backlogRevenue)}`,
        },
      ];
    });

  if (backlogRiskItems.length > 0) {
    groups.push({
      type: "BACKLOG_FORECAST_RISK",
      title: "Backlog > Forecast",
      summary: `${backlogRiskItems.length} vendor forecast değeri backlog altında.`,
      count: backlogRiskItems.length,
      severity: "high",
      targetUrl: groupUrl("/forecast-input", current),
      items: backlogRiskItems,
    });
  }

  const achievementItems = forecasts
    .filter((forecast) => forecast.isActive)
    .flatMap((forecast) => {
      const target = targetByVendor.get(forecast.vendorId);
      const vendor = vendorById.get(forecast.vendorId);
      if (!target || !vendor) return [];

      const gpAchievement = calculatePercent(Number(forecast.gp), Number(target.gp));
      const revenueAchievement = calculatePercent(Number(forecast.revenue), Number(target.revenue));
      const riskValue = gpAchievement > 0 ? gpAchievement : revenueAchievement;
      const riskLabel = gpAchievement > 0 ? "GP Achv" : "NSB Achv";

      if (riskValue <= 0 || riskValue >= ACHIEVEMENT_THRESHOLD) return [];

      return [
        {
          label: vendor.name,
          detail: vendor.manager?.name ?? "Atanmamış",
          value: `${riskLabel} ${formatPercent(riskValue)}`,
        },
      ];
    });

  if (achievementItems.length > 0) {
    groups.push({
      type: "ACHIEVEMENT_RISK",
      title: "Achievement Riski",
      summary: `${achievementItems.length} vendor hedef seviyesinin altında.`,
      count: achievementItems.length,
      severity: "medium",
      targetUrl: groupUrl("/dashboard", current),
      items: achievementItems,
    });
  }

  const closingMissingItems = vendors
    .filter((vendor) => !closingVendorIds.has(vendor.id))
    .map((vendor) => ({
      label: vendor.name,
      detail: vendor.manager?.name ?? "Atanmamış",
      value: `FY${current.fiscalYear} Q${current.quarter}`,
    }));

  if (closingMissingItems.length > 0) {
    groups.push({
      type: "CLOSING_MISSING",
      title: "Kapanış Girilmedi",
      summary: `${closingMissingItems.length} vendor için kapanış verisi yok.`,
      count: closingMissingItems.length,
      severity: "medium",
      targetUrl: groupUrl("/closing", current),
      items: closingMissingItems,
    });
  }

  const forecastsByVendor = new Map<string, typeof forecasts>();
  for (const forecast of forecasts) {
    const rows = forecastsByVendor.get(forecast.vendorId) ?? [];
    rows.push(forecast);
    forecastsByVendor.set(forecast.vendorId, rows);
  }

  const forecastChangeItems = Array.from(forecastsByVendor.entries()).flatMap(([vendorId, rows]) => {
    const activeForecast = rows.find((row) => row.isActive);
    if (!activeForecast) return [];
    const previousForecast = rows
      .filter((row) => !row.isActive && row.weekNumber < activeForecast.weekNumber)
      .sort((a, b) => b.weekNumber - a.weekNumber)[0];
    if (!previousForecast) return [];

    const activeGp = Number(activeForecast.gp);
    const previousGp = Number(previousForecast.gp);
    const activeRevenue = Number(activeForecast.revenue);
    const previousRevenue = Number(previousForecast.revenue);
    const gpChange = previousGp > 0 ? ((activeGp - previousGp) / previousGp) * 100 : 0;
    const revenueChange = previousRevenue > 0 ? ((activeRevenue - previousRevenue) / previousRevenue) * 100 : 0;
    const maxChange = Math.abs(gpChange) >= Math.abs(revenueChange) ? gpChange : revenueChange;

    if (Math.abs(maxChange) < CHANGE_THRESHOLD) return [];

    const vendor = vendorById.get(vendorId);
    const metric = Math.abs(gpChange) >= Math.abs(revenueChange) ? "GP" : "NSB";
    return [
      {
        label: vendor?.name ?? "Bilinmeyen Vendor",
        detail: vendor?.manager?.name ?? "Atanmamış",
        value: `${metric} ${maxChange > 0 ? "+" : ""}${formatPercent(maxChange)}`,
      },
    ];
  });

  if (forecastChangeItems.length > 0) {
    groups.push({
      type: "FORECAST_CHANGE",
      title: "Forecast Değişimi",
      summary: `${forecastChangeItems.length} ciddi haftalık değişim var.`,
      count: forecastChangeItems.length,
      severity: "low",
      targetUrl: groupUrl("/forecast-history", current),
      items: forecastChangeItems,
    });
  }

  if (recentImports.length > 0) {
    const uploadItems = recentImports.map((log) => ({
      label: log.fileName,
      detail: `${log.dataType} - ${log.status}`,
      value: `${log.rowCount} satır`,
    }));

    groups.push({
      type: "UPLOAD_RESULT",
      title: "Upload Sonuçları",
      summary: `Son 7 günde ${recentImports.length} upload işlemi var.`,
      count: recentImports.length,
      severity: recentImports.some((log) => log.status === "FAILED") ? "medium" : "low",
      targetUrl: groupUrl("/reports", current),
      items: uploadItems,
    });
  }

  const severityRank: Record<NotificationSeverity, number> = { high: 0, medium: 1, low: 2 };
  return groups.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.count - a.count);
}
