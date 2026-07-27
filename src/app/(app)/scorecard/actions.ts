"use server";

import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { getAccessibleVendorIds } from "@/lib/scope";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";

export type ManagerProfileCard = {
  /** Satış müdürünün kullanıcı kimliği; kart seçiminde anahtar olarak kullanılır. */
  userId: string;
  managerName: string;
  imageUrl: string | null;

  forecastRevenue: number;
  forecastGp: number;
  forecastGpPercent: number;

  targetRevenue: number;
  targetGp: number;
  targetGpPercent: number;

  /** Forecast GP / Target GP. */
  gpAchievement: number;
  /** Forecast NSB / Target NSB. */
  revenueAchievement: number;

  vendorCount: number;
  forecastedVendorCount: number;

  /** CRM karnesinden gelenler; o hafta karne yüklenmemişse null. */
  crmHealthScore: number | null;
  overdueCount: number | null;
  weightedCrmPipeline: number | null;
  managerComment: string | null;
};

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

/**
 * Satış müdürü kimlik kartlarının verisi.
 *
 * Not: SalesManagerScorecard tablosundaki `forecastAccuracy`, `revenueAch` ve
 * `gpAch` kolonlarına hiçbir kod yazmıyor; şema varsayılanlarında (100 / 0 / 0)
 * sabit kalıyorlar. Bu yüzden başarım değerleri o kolonlardan değil, dönemin
 * forecast ve hedef kayıtlarından hesaplanır.
 *
 * Forecast doğruluğu (haftalık revizyon istikrarı + kapanışa göre sapma) şimdilik
 * kapsam dışı; hesaplanabilmesi için haftalık forecast serisi ve kapanmış çeyrek
 * gerekiyor.
 */
export async function getManagerProfileCards(
  fiscalYear: number,
  quarter: number,
  weekNumber: number
): Promise<ManagerProfileCard[]> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Oturum açık değil.");
  }

  const accessibleVendorIds = await getAccessibleVendorIds(session.user);
  const period = await ensureFiscalPeriod(fiscalYear, quarter);

  const [vendors, forecasts, targets, scorecards] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: accessibleVendorIds }, isActive: true },
      select: {
        id: true,
        managerId: true,
        manager: { select: { id: true, name: true, imageUrl: true } },
      },
    }),
    prisma.forecast.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: period.id, isActive: true },
      select: { vendorId: true, revenue: true, gp: true },
    }),
    prisma.target.findMany({
      where: { vendorId: { in: accessibleVendorIds }, fiscalPeriodId: period.id },
      select: { vendorId: true, revenue: true, gp: true },
    }),
    prisma.salesManagerScorecard.findMany({
      where: { fiscalPeriodId: period.id, weekNumber, user: { role: "SATIS_MUDURU" } },
      select: {
        userId: true,
        crmHealthScore: true,
        overdueCount: true,
        weightedCrmPipeline: true,
        managerComment: true,
      },
    }),
  ]);

  const forecastByVendor = new Map(forecasts.map((row) => [row.vendorId, row]));
  const targetByVendor = new Map(targets.map((row) => [row.vendorId, row]));
  const scorecardByUser = new Map(
    scorecards.filter((row) => row.userId).map((row) => [row.userId as string, row])
  );

  const grouped = new Map<
    string,
    {
      userId: string;
      managerName: string;
      imageUrl: string | null;
      forecastRevenue: number;
      forecastGp: number;
      targetRevenue: number;
      targetGp: number;
      vendorCount: number;
      forecastedVendorCount: number;
    }
  >();

  for (const vendor of vendors) {
    // Yöneticisi atanmamış markalar bir kimlik kartına ait olamaz.
    if (!vendor.managerId || !vendor.manager) continue;

    const entry =
      grouped.get(vendor.managerId) ??
      {
        userId: vendor.managerId,
        managerName: vendor.manager.name,
        imageUrl: vendor.manager.imageUrl,
        forecastRevenue: 0,
        forecastGp: 0,
        targetRevenue: 0,
        targetGp: 0,
        vendorCount: 0,
        forecastedVendorCount: 0,
      };

    const forecast = forecastByVendor.get(vendor.id);
    const target = targetByVendor.get(vendor.id);

    entry.vendorCount += 1;
    if (forecast) {
      entry.forecastedVendorCount += 1;
      entry.forecastRevenue += Number(forecast.revenue);
      entry.forecastGp += Number(forecast.gp);
    }
    if (target) {
      entry.targetRevenue += Number(target.revenue);
      entry.targetGp += Number(target.gp);
    }

    grouped.set(vendor.managerId, entry);
  }

  return Array.from(grouped.values())
    .map((entry) => {
      const scorecard = scorecardByUser.get(entry.userId);

      return {
        ...entry,
        forecastGpPercent: percent(entry.forecastGp, entry.forecastRevenue),
        targetGpPercent: percent(entry.targetGp, entry.targetRevenue),
        gpAchievement: percent(entry.forecastGp, entry.targetGp),
        revenueAchievement: percent(entry.forecastRevenue, entry.targetRevenue),
        crmHealthScore: scorecard?.crmHealthScore ?? null,
        overdueCount: scorecard?.overdueCount ?? null,
        weightedCrmPipeline: scorecard ? Number(scorecard.weightedCrmPipeline) : null,
        managerComment: scorecard?.managerComment ?? null,
      };
    })
    .sort((a, b) => a.managerName.localeCompare(b.managerName, "tr"));
}
