"use server";

import { z } from "zod";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { assertVendorAccess, getAccessibleVendorIds } from "@/lib/scope";
import { ensureFiscalPeriod } from "@/lib/fiscal-db";
import { writeAuditLog } from "@/lib/audit";
import {
  cellUpdateSchema,
  emptyInputs,
  forecastInputsSchema,
  monthIndexOfPath,
  readPath,
  stripActualBackedInputs,
  writePath,
} from "@/lib/weekly-forecast/schema";
import { getClosedMonths, getQuarterMonthLabels } from "@/lib/fiscal";
import { getCrmBucketMatrix } from "@/lib/crm/weekly-crosscheck";
import {
  applyActualToInputs,
  buildForecastContext,
  getWeeklyForecastReport,
  TOTAL_TAB_ID,
  type WeeklyForecastReport,
} from "@/lib/weekly-forecast/service";
import { computeForecast } from "@/lib/weekly-forecast/calc";
import { round2 } from "@/lib/monthly";
import {
  assertCurrentFiscalPeriod,
  writeActiveForecast,
} from "@/lib/forecast/write-active-forecast";
import { revalidatePath } from "next/cache";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Oturum bulunamadı.");
  return { id: session.user.id, role: session.user.role ?? "SATIS_MUDURU" };
}

const periodSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  quarter: z.number().int().min(1).max(4),
  weekNumber: z.number().int().min(1).max(13),
});

export async function getReportAction(
  fiscalYear: number,
  quarter: number,
  weekNumber: number,
): Promise<{ success: true; report: WeeklyForecastReport } | { success: false; error: string }> {
  try {
    const user = await requireUser();
    const parsed = periodSchema.parse({ fiscalYear, quarter, weekNumber });
    const report = await getWeeklyForecastReport(
      user,
      parsed.fiscalYear,
      parsed.quarter,
      parsed.weekNumber,
    );
    return { success: true, report };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error, "Form verileri yüklenemedi.") };
  }
}

const saveSchema = periodSchema.extend({
  vendorId: z.string().min(1),
  updates: z.array(cellUpdateSchema).min(1).max(200),
});

export async function saveCellsAction(input: {
  vendorId: string;
  fiscalYear: number;
  quarter: number;
  weekNumber: number;
  updates: { path: string; value: number }[];
}) {
  try {
    const user = await requireUser();
    const parsed = saveSchema.parse(input);

    if (parsed.vendorId === TOTAL_TAB_ID) {
      throw new Error("Total sekmesi hesaplanandır, düzenlenemez.");
    }

    await assertVendorAccess(user, parsed.vendorId);

    const period = await ensureFiscalPeriod(parsed.fiscalYear, parsed.quarter);
    if (period.isLocked) {
      throw new Error("Seçilen çeyrek kilitli olduğu için form girişi kapalıdır.");
    }

    // Ay kilidi — istemci kilitli hücreyi düzenletmiyor ama sunucu da
    // reddetmeli, aksi halde doğrudan istekle kapanmış aya yazılabilirdi.
    const closedMonths = getClosedMonths(period.fiscalYear, period.quarter);
    const monthLabels = getQuarterMonthLabels(period.fiscalYear, period.quarter);
    for (const update of parsed.updates) {
      const m = monthIndexOfPath(update.path);
      if (m !== null && closedMonths[m]) {
        throw new Error(`${monthLabels[m]} kapandığı için bu ay üzerinde değişiklik yapılamaz.`);
      }
    }

    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.weeklyForecastSheet.findUnique({
        where: {
          vendorId_fiscalPeriodId_weekNumber: {
            vendorId: parsed.vendorId,
            fiscalPeriodId: period.id,
            weekNumber: parsed.weekNumber,
          },
        },
      });

      const before = existing
        ? (forecastInputsSchema.safeParse(existing.inputs).data ?? emptyInputs())
        : emptyInputs();

      let after = before;
      for (const update of parsed.updates) {
        after = writePath(after, update.path, update.value);
      }
      after = stripActualBackedInputs(after);

      // Yazılan hafta aktif olur, aynı (vendor, çeyrek) diğer haftalar pasife
      // düşer — Forecast tablosuyla aynı semantik. Sıralama önemli: önce
      // hepsini pasife çek, sonra bu haftayı aktif yaz.
      await tx.weeklyForecastSheet.updateMany({
        where: {
          vendorId: parsed.vendorId,
          fiscalPeriodId: period.id,
          weekNumber: { not: parsed.weekNumber },
        },
        data: { isActive: false },
      });

      return tx.weeklyForecastSheet.upsert({
        where: {
          vendorId_fiscalPeriodId_weekNumber: {
            vendorId: parsed.vendorId,
            fiscalPeriodId: period.id,
            weekNumber: parsed.weekNumber,
          },
        },
        update: { inputs: after, updatedById: user.id, isActive: true },
        create: {
          vendorId: parsed.vendorId,
          fiscalPeriodId: period.id,
          weekNumber: parsed.weekNumber,
          inputs: after,
          updatedById: user.id,
          isActive: true,
        },
        select: { id: true, inputs: true },
      });
    });

    const storedInputs = forecastInputsSchema.safeParse(saved.inputs).data ?? emptyInputs();

    const latestActual = await prisma.actual.findFirst({
      where: {
        vendorId: parsed.vendorId,
        fiscalPeriodId: period.id,
        weekNumber: { lte: parsed.weekNumber },
      },
      orderBy: [{ weekNumber: "desc" }, { updatedAt: "desc" }],
    });

    // DB'de actual satırları saklanmaz; istemciye her zaman Actual'dan birleşik döner.
    const inputs = applyActualToInputs(storedInputs, latestActual ?? undefined);

    // Denetim izi: yalnızca bu kaydetmede değişen hücreler yazılır.
    await writeAuditLog({
      userId: user.id,
      action: "UPDATE",
      entityType: "WeeklyForecastSheet",
      entityId: saved.id,
      oldValue: null,
      newValue: Object.fromEntries(
        parsed.updates.map((update) => [update.path, readPath(inputs, update.path)]),
      ),
    });

    return { success: true as const, inputs };
  } catch (error: unknown) {
    return { success: false as const, error: getErrorMessage(error, "Form kaydedilemedi.") };
  }
}

/**
 * CRM çapraz kontrol verisi.
 *
 * `getReportAction`'dan AYRI tutuluyor çünkü: form yüklemesini yavaşlatmamalı,
 * CRM verisi yoksa form yine açılmalı, ve CRM yüklemesinden sonra bağımsız
 * tazelenebilmeli.
 */
export async function getCrmCrossCheckAction(
  fiscalYear: number,
  quarter: number,
  weekNumber: number,
) {
  try {
    const user = await requireUser();
    const parsed = periodSchema.parse({ fiscalYear, quarter, weekNumber });

    const period = await ensureFiscalPeriod(parsed.fiscalYear, parsed.quarter);
    const vendorIds = await getAccessibleVendorIds(user);

    const data = await getCrmBucketMatrix(
      period.id,
      parsed.fiscalYear,
      parsed.quarter,
      parsed.weekNumber,
      vendorIds,
    );

    return { success: true as const, data };
  } catch (error: unknown) {
    return { success: false as const, error: getErrorMessage(error, "CRM verisi yüklenemedi.") };
  }
}

const submitSchema = periodSchema.extend({ vendorId: z.string().min(1) });

/**
 * Formun ürettiği çeyrek toplamını `Forecast` tablosuna yazar.
 *
 * Hücre düzenlemeleri zaten `WeeklyForecastSheet`'e taslak olarak kaydediliyor;
 * bu aksiyon "yayınlama" adımıdır — dashboard, scorecard ve raporların okuduğu
 * `Forecast` satırını günceller.
 *
 * ⚠ İstemci bunu çağırmadan ÖNCE bekleyen hücre kayıtlarını flush etmeli,
 * aksi halde bir önceki durum yayınlanır.
 */
export async function submitWeeklyForecastAction(input: {
  vendorId: string;
  fiscalYear: number;
  quarter: number;
  weekNumber: number;
}) {
  try {
    const user = await requireUser();
    const parsed = submitSchema.parse(input);

    if (parsed.vendorId === TOTAL_TAB_ID) {
      throw new Error("Total sekmesi hesaplanandır, kaydedilemez.");
    }
    await assertVendorAccess(user, parsed.vendorId);

    const period = await ensureFiscalPeriod(parsed.fiscalYear, parsed.quarter);
    if (period.isLocked) {
      throw new Error("Seçilen çeyrek kilitli olduğu için kayıt yapılamaz.");
    }

    // Hafta kilidi: writeActiveForecast yazdığı haftayı aktif, diğerlerini
    // pasif yapıyor. Geçmiş bir haftaya kayıt, dashboard/scorecard/raporun
    // okuduğu aktif satırı sessizce geriye alırdı.
    const currentWeek = assertCurrentFiscalPeriod(parsed.fiscalYear, parsed.quarter);
    if (parsed.weekNumber !== currentWeek) {
      throw new Error(
        `Yalnızca içinde bulunulan hafta kaydedilebilir (${currentWeek}. hafta). Seçili hafta: ${parsed.weekNumber}.`,
      );
    }

    const sheet = await prisma.weeklyForecastSheet.findUnique({
      where: {
        vendorId_fiscalPeriodId_weekNumber: {
          vendorId: parsed.vendorId,
          fiscalPeriodId: period.id,
          weekNumber: parsed.weekNumber,
        },
      },
    });
    if (!sheet) {
      throw new Error("Bu hafta için form doldurulmamış. Önce hücreleri doldurun.");
    }

    // Katı ayrıştırma: bozuk veride emptyInputs()'a düşmek sessizce sıfır
    // yayınlamak demek olurdu — mümkün olan en kötü sonuç.
    const parsedInputs = forecastInputsSchema.safeParse(sheet.inputs);
    if (!parsedInputs.success) {
      throw new Error("Form verisi okunamadı; lütfen bir hücreyi düzenleyip tekrar deneyin.");
    }

    const latestActual = await prisma.actual.findFirst({
      where: {
        vendorId: parsed.vendorId,
        fiscalPeriodId: period.id,
        weekNumber: { lte: parsed.weekNumber },
      },
      orderBy: { weekNumber: "desc" },
    });

    const context = await buildForecastContext(period.id, parsed.vendorId);
    const inputsWithActual = applyActualToInputs(parsedInputs.data, latestActual ?? undefined);
    const computed = computeForecast(inputsWithActual, context);

    // Float toplamı Decimal(18,2)'ye yazılıyor — toast, DB ve formun gördüğü
    // rakam aynı olsun diye önce yuvarla.
    const revenue = round2(computed.qNsbTotal);
    const gp = round2(computed.qNgpTotal);

    if (!Number.isFinite(revenue) || !Number.isFinite(gp)) {
      throw new Error("Hesaplanan toplam geçerli bir sayı değil.");
    }
    // Not: negatif değere İZİN VERİLİR — FX ve stok karşılığı kalemleri
    // negatif olabildiği için GP toplamı eksiye düşebilir.

    const result = await prisma.$transaction(async (tx) => {
      const written = await writeActiveForecast(tx, {
        vendorId: parsed.vendorId,
        fiscalPeriodId: period.id,
        weekNumber: parsed.weekNumber,
        revenue,
        gp,
        // undefined geçmek eski sayfada yazılmış notu korur
        note: undefined,
        submittedById: user.id,
      });

      // Denetim kaydı transaction İÇİNDE yazılmalı; writeAuditLog modül
      // seviyesindeki client'ı kullanıyor ve transaction'dan kaçar.
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "FORECAST_SUBMIT_WEEKLY_FORM",
          entityType: "Forecast",
          entityId: written.forecast.id,
          oldValue: written.previousActive
            ? {
                weekNumber: written.previousActive.weekNumber,
                revenue: Number(written.previousActive.revenue),
                gp: Number(written.previousActive.gp),
              }
            : undefined,
          newValue: {
            weekNumber: parsed.weekNumber,
            revenue,
            gp,
            source: "WEEKLY_FORM",
            sheetId: sheet.id,
            // Formu dolduran ile gönderen farklı olabilir
            sheetUpdatedById: sheet.updatedById,
          },
        },
      });

      return written;
    });

    revalidatePath("/forecast-input");
    revalidatePath("/dashboard");
    revalidatePath("/reports");

    return {
      success: true as const,
      revenue,
      gp,
      weekNumber: parsed.weekNumber,
      previous: result.previousActive
        ? {
            weekNumber: result.previousActive.weekNumber,
            revenue: Number(result.previousActive.revenue),
            gp: Number(result.previousActive.gp),
          }
        : null,
    };
  } catch (error: unknown) {
    return { success: false as const, error: getErrorMessage(error, "Forecast kaydedilemedi.") };
  }
}
