import type { Prisma } from "@prisma/client";
import { getFiscalContext } from "@/lib/fiscal";

/**
 * `Forecast` tablosuna yazmanın tek primitifi.
 *
 * ⚠ Bu dosya bilinçli olarak `"use server"` DEĞİL: o tür dosyalardaki her
 * export ağdan çağrılabilir bir uç haline gelir. Buradaki fonksiyonlar
 * yalnızca sunucu içi çağrılar içindir.
 *
 * Semantik: aynı (vendor, çeyrek) için tek bir hafta "aktif"tir. Yazılan hafta
 * aktif olur, diğerlerinin hepsi pasife düşer. `isActive` "en son yazılan"
 * demektir, "en son hafta" değil — geçmiş bir haftaya yazmak aktif satırı
 * geriye alır, bu yüzden çağıranlar hafta kilidi uygulamalıdır.
 */
export async function writeActiveForecast(
  tx: Prisma.TransactionClient,
  input: {
    vendorId: string;
    fiscalPeriodId: string;
    weekNumber: number;
    revenue: number;
    gp: number;
    note?: string | null;
    submittedById: string;
  },
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
          note: input.note !== undefined ? input.note : existingWeekForecast.note,
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
          note: input.note ?? null,
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

/**
 * Forecast yalnızca içinde bulunulan çeyrek için girilebilir.
 * Dönüş değeri o anki hafta numarasıdır — yazma her zaman gerçek haftayla
 * damgalanır, geçmişe dönük giriş yapılamaz.
 */
export function assertCurrentFiscalPeriod(fiscalYear: number, quarter: number) {
  const currentContext = getFiscalContext(new Date());

  if (currentContext.fiscalYear !== fiscalYear || currentContext.quarter !== quarter) {
    throw new Error(
      `Forecast yalnızca aktif çeyrek için girilebilir. Aktif dönem FY${currentContext.fiscalYear} - Q${currentContext.quarter}, aktif hafta ${currentContext.weekInQuarter}. hafta.`,
    );
  }

  return currentContext.weekInQuarter;
}
