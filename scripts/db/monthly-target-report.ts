/**
 * Aylık hedef/kapanış kapsam ve sapma raporu (SALT-OKUNUR).
 *
 * Çalıştır: node --env-file=.env node_modules/.bin/tsx scripts/db/monthly-target-report.ts
 *
 * Üç şeyi gösterir:
 *  1. Hangi dönemlerde aylık kırılım eksik
 *  2. Aylık toplamı çeyrek değeriyle tutmayan kayıtlar (sapma dedektörü)
 *  3. Kısmi giriş (bazı aylar dolu bazıları boş) — yalnızca doğrudan SQL ile oluşabilir
 */
import prisma from "@/lib/prisma";
import { hasMonthlyBreakdown, monthlyTriples, sumTriple, MONTHLY_SUM_TOLERANCE, toNumber } from "@/lib/monthly";

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

async function rapor(tablo: "target" | "closing") {
  const rows =
    tablo === "target"
      ? await prisma.target.findMany({ include: { vendor: true, fiscalPeriod: true } })
      : await prisma.closing.findMany({ include: { vendor: true, fiscalPeriod: true } });

  const eksik: string[] = [];
  const sapma: string[] = [];
  const kismi: string[] = [];

  for (const row of rows) {
    const etiket = `FY${row.fiscalPeriod.fiscalYear} Q${row.fiscalPeriod.quarter} · ${row.vendor.name}`;
    const alanlar = [row.revenueM1, row.revenueM2, row.revenueM3, row.gpM1, row.gpM2, row.gpM3];
    const doluSayisi = alanlar.filter((v) => v !== null).length;

    if (doluSayisi === 0) {
      eksik.push(etiket);
      continue;
    }
    if (doluSayisi < 6) {
      kismi.push(`${etiket} (${doluSayisi}/6 alan dolu)`);
      continue;
    }
    if (!hasMonthlyBreakdown(row)) continue;

    const t = monthlyTriples(row)!;
    const revToplam = sumTriple(t.revenue);
    const gpToplam = sumTriple(t.gp);
    const revCeyrek = toNumber(row.revenue);
    const gpCeyrek = toNumber(row.gp);

    if (Math.abs(revToplam - revCeyrek) > MONTHLY_SUM_TOLERANCE) {
      sapma.push(`${etiket} · NSB aylık ${money(revToplam)} ≠ çeyrek ${money(revCeyrek)} (fark ${money(revToplam - revCeyrek)})`);
    }
    if (Math.abs(gpToplam - gpCeyrek) > MONTHLY_SUM_TOLERANCE) {
      sapma.push(`${etiket} · GP aylık ${money(gpToplam)} ≠ çeyrek ${money(gpCeyrek)} (fark ${money(gpToplam - gpCeyrek)})`);
    }
  }

  const baslik = tablo === "target" ? "HEDEF (Target)" : "KAPANIŞ (Closing)";
  console.log(`\n${"=".repeat(60)}\n${baslik} — ${rows.length} kayıt\n${"=".repeat(60)}`);
  console.log(`Aylık kırılımı olan : ${rows.length - eksik.length - kismi.length}`);
  console.log(`Kırılımı olmayan    : ${eksik.length}`);
  if (kismi.length) {
    console.log(`\n⚠ KISMİ GİRİŞ (${kismi.length}) — düzeltilmeli:`);
    kismi.forEach((s) => console.log(`   ${s}`));
  }
  if (sapma.length) {
    console.log(`\n⚠ SAPMA (${sapma.length}) — aylık toplam çeyrekle tutmuyor:`);
    sapma.forEach((s) => console.log(`   ${s}`));
  } else if (rows.length - eksik.length - kismi.length > 0) {
    console.log("\n✓ Kırılımı olan tüm kayıtlarda aylık toplam çeyrekle tutuyor");
  }
  if (eksik.length && eksik.length <= 30) {
    console.log(`\nKırılımı olmayanlar:`);
    eksik.forEach((s) => console.log(`   ${s}`));
  }
  return { sapma: sapma.length, kismi: kismi.length };
}

async function main() {
  const t = await rapor("target");
  const c = await rapor("closing");
  const sorun = t.sapma + t.kismi + c.sapma + c.kismi;
  console.log(`\n${sorun === 0 ? "✓ Sorun yok" : `⚠ Toplam ${sorun} sorunlu kayıt`}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
