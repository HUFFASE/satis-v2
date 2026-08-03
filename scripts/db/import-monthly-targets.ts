/**
 * Aylık hedef yükleme (hedefler.xlsx → Target tablosu).
 *
 * Kuru çalıştırma (hiçbir şey yazmaz):
 *   node --env-file=.env node_modules/.bin/tsx scripts/db/import-monthly-targets.ts
 * Gerçek yazma:
 *   node --env-file=.env node_modules/.bin/tsx scripts/db/import-monthly-targets.ts --apply
 *
 * Dosya formatı: Number | Vendor | Month | Revenue | GP   (değerler BİN USD)
 * Mali yıl Aralık'ta başlar: Q1=Ara/Oca/Şub, Q2=Mar/Nis/May, Q3=Haz/Tem/Ağu, Q4=Eyl/Eki/Kas
 *
 * Kararlar:
 *  - Dosya esas alınır; çeyrek toplamı aylık değerlerin toplamıdır.
 *  - Sistemde vendor kaydı olmayan markalar ATLANIR ve raporlanır.
 *  - Bir çeyreğin üç ayından biri bile "--" ise o çeyrek atlanır (kısmi yazılmaz).
 *  - Her değişiklik AuditLog'a eski değeriyle birlikte yazılır.
 */
import * as XLSX from "xlsx";
import prisma from "@/lib/prisma";
import { getQuarterMonths } from "@/lib/fiscal";
import { round2, monthlyTriples, type MonthlyTriple } from "@/lib/monthly";

const FILE = process.env.TARGET_FILE ?? "/Users/huffase/Documents/hedefler.xlsx";
const APPLY = process.argv.includes("--apply");
const FISCAL_YEAR = 2026;
/** Dosya bin USD cinsinden. */
const SCALE = 1000;

const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseAmount(value: unknown): number | null {
  const s = String(value ?? "").trim();
  if (s === "" || s === "--" || s === "-") return null;
  const n = Number(s.replace(/,/g, "").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

interface Cell {
  revenue: number | null;
  gp: number | null;
}

async function main() {
  // ---- 1. Dosyayı oku: (marka, takvim ayı) → tutar
  const wb = XLSX.readFile(FILE);
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
    defval: "",
    raw: false,
  });

  const cells = new Map<string, Cell>();
  const fileVendors = new Set<string>();
  for (const r of raw) {
    const vendor = String(r.Vendor ?? "").trim().toUpperCase();
    const monthName = String(r.Month ?? "").trim();
    const monthIndex = EN_MONTHS.indexOf(monthName);
    if (!vendor) continue;
    if (monthIndex < 0) throw new Error(`Tanınmayan ay: "${monthName}"`);
    fileVendors.add(vendor);
    cells.set(`${vendor}:${monthIndex}`, {
      revenue: parseAmount(r.Revenue),
      gp: parseAmount(r.GP),
    });
  }

  // ---- 2. Vendor eşleştir (ad / kod / alias)
  const dbVendors = await prisma.vendor.findMany({ include: { aliases: true } });
  const lookup = new Map<string, { id: string; name: string; isActive: boolean }>();
  for (const v of dbVendors) {
    const val = { id: v.id, name: v.name, isActive: v.isActive };
    lookup.set(v.name.toUpperCase(), val);
    if (v.code) lookup.set(v.code.toUpperCase(), val);
    for (const a of v.aliases) lookup.set(a.alias.toUpperCase(), val);
  }

  const atlananMarkalar: string[] = [];
  for (const fv of fileVendors) {
    if (!lookup.get(fv)) {
      const dolu = [...Array(12).keys()].filter((m) => {
        const c = cells.get(`${fv}:${m}`);
        return c && c.revenue !== null;
      });
      const yillik = dolu.reduce((a, m) => a + (cells.get(`${fv}:${m}`)!.revenue ?? 0), 0) * SCALE;
      atlananMarkalar.push(`${fv} (${dolu.length}/12 ay, yıllık ${money(yillik)})`);
    }
  }

  // ---- 3. Yazılacak kayıtları hazırla
  interface Plan {
    vendorId: string;
    vendorName: string;
    quarter: number;
    periodId: string;
    revenueM: MonthlyTriple;
    gpM: MonthlyTriple;
    revenue: number;
    gp: number;
    oncekiRevenue: number | null;
    oncekiGp: number | null;
    oncekiAylik: { revenue: MonthlyTriple; gp: MonthlyTriple } | null;
    yeni: boolean;
  }

  const plan: Plan[] = [];
  const atlananCeyrek: string[] = [];

  for (const q of [1, 2, 3, 4]) {
    const period = await prisma.fiscalPeriod.findFirst({
      where: { fiscalYear: FISCAL_YEAR, quarter: q },
    });
    if (!period) {
      atlananCeyrek.push(`FY${FISCAL_YEAR} Q${q}: dönem kaydı yok`);
      continue;
    }
    if (period.isLocked) {
      atlananCeyrek.push(`FY${FISCAL_YEAR} Q${q}: dönem KİLİTLİ`);
      continue;
    }

    const monthIdx = getQuarterMonths(FISCAL_YEAR, q).map((m) => m.monthIndex);

    for (const [fileName, dbv] of lookup) {
      if (!fileVendors.has(fileName)) continue;
      if (!dbv.isActive) continue;
      // Aynı vendor'a birden fazla alias eşleşebilir; ada göre tekilleştir
      if (plan.some((p) => p.vendorId === dbv.id && p.quarter === q)) continue;

      const trio = monthIdx.map((mi) => cells.get(`${fileName}:${mi}`));
      if (trio.some((c) => !c || c.revenue === null || c.gp === null)) {
        atlananCeyrek.push(`${dbv.name} Q${q}: dosyada eksik ("--")`);
        continue;
      }

      const revenueM = trio.map((c) => round2(c!.revenue! * SCALE)) as MonthlyTriple;
      const gpM = trio.map((c) => round2(c!.gp! * SCALE)) as MonthlyTriple;
      const revenue = round2(revenueM[0] + revenueM[1] + revenueM[2]);
      const gp = round2(gpM[0] + gpM[1] + gpM[2]);

      const existing = await prisma.target.findUnique({
        where: { vendorId_fiscalPeriodId: { vendorId: dbv.id, fiscalPeriodId: period.id } },
      });

      // Hem çeyrek hem aylık sıfırsa ve kayıt da yoksa boşuna satır açma
      if (!existing && revenue === 0 && gp === 0) {
        atlananCeyrek.push(`${dbv.name} Q${q}: dosyada sıfır, kayıt açılmadı`);
        continue;
      }

      plan.push({
        vendorId: dbv.id,
        vendorName: dbv.name,
        quarter: q,
        periodId: period.id,
        revenueM,
        gpM,
        revenue,
        gp,
        oncekiRevenue: existing ? Number(existing.revenue) : null,
        oncekiGp: existing ? Number(existing.gp) : null,
        oncekiAylik: monthlyTriples(existing),
        yeni: !existing,
      });
    }
  }

  // ---- 4. Rapor
  console.log(`\n${"=".repeat(70)}`);
  console.log(APPLY ? "YÜKLEME (--apply)" : "KURU ÇALIŞTIRMA — hiçbir şey yazılmayacak");
  console.log(`Dosya: ${FILE}`);
  console.log("=".repeat(70));

  if (atlananMarkalar.length) {
    console.log(`\n⚠ SİSTEMDE OLMAYAN MARKALAR (${atlananMarkalar.length}) — atlanıyor:`);
    atlananMarkalar.sort().forEach((s) => console.log(`   ${s}`));
  }
  if (atlananCeyrek.length) {
    console.log(`\nAtlanan marka-çeyrek (${atlananCeyrek.length}):`);
    atlananCeyrek.forEach((s) => console.log(`   ${s}`));
  }

  const yeniler = plan.filter((p) => p.yeni);
  const degisenler = plan.filter(
    (p) => !p.yeni && (Math.abs(p.revenue - (p.oncekiRevenue ?? 0)) > 0.01 || Math.abs(p.gp - (p.oncekiGp ?? 0)) > 0.01),
  );

  console.log(`\nYazılacak kayıt : ${plan.length}`);
  console.log(`   yeni         : ${yeniler.length}`);
  console.log(`   çeyrek değişen: ${degisenler.length}`);
  console.log(`   çeyrek aynı   : ${plan.length - yeniler.length - degisenler.length}`);

  if (yeniler.length) {
    console.log(`\nYENİ KAYITLAR:`);
    yeniler.forEach((p) => console.log(`   ${p.vendorName} Q${p.quarter} → ${money(p.revenue)} / GP ${money(p.gp)}`));
  }

  const buyukFark = degisenler
    .map((p) => ({ p, d: p.revenue - (p.oncekiRevenue ?? 0) }))
    .filter((x) => Math.abs(x.d) > 2000)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (buyukFark.length) {
    console.log(`\n⚠ $2.000 ÜZERİ ÇEYREK DEĞİŞİMİ (${buyukFark.length}):`);
    buyukFark.forEach(({ p, d }) =>
      console.log(`   ${p.vendorName} Q${p.quarter}: ${money(p.oncekiRevenue!)} → ${money(p.revenue)} (${d > 0 ? "+" : ""}${money(d)})`),
    );
  }

  const toplamOnce = plan.reduce((a, p) => a + (p.oncekiRevenue ?? 0), 0);
  const toplamSonra = plan.reduce((a, p) => a + p.revenue, 0);
  console.log(`\nEtkilenen kayıtların NSB toplamı: ${money(toplamOnce)} → ${money(toplamSonra)}`);

  if (!APPLY) {
    console.log(`\nKuru çalıştırma bitti. Yazmak için: --apply`);
    return;
  }

  // ---- 5. Yaz
  const direktor = await prisma.user.findFirst({ where: { role: "DIREKTOR" }, orderBy: { createdAt: "asc" } });

  await prisma.$transaction(async (tx) => {
    for (const p of plan) {
      const target = await tx.target.upsert({
        where: { vendorId_fiscalPeriodId: { vendorId: p.vendorId, fiscalPeriodId: p.periodId } },
        update: {
          revenue: p.revenue, gp: p.gp,
          revenueM1: p.revenueM[0], revenueM2: p.revenueM[1], revenueM3: p.revenueM[2],
          gpM1: p.gpM[0], gpM2: p.gpM[1], gpM3: p.gpM[2],
        },
        create: {
          vendorId: p.vendorId, fiscalPeriodId: p.periodId,
          revenue: p.revenue, gp: p.gp,
          revenueM1: p.revenueM[0], revenueM2: p.revenueM[1], revenueM3: p.revenueM[2],
          gpM1: p.gpM[0], gpM2: p.gpM[1], gpM3: p.gpM[2],
        },
      });

      // Target'ın tek geçmiş kaydı AuditLog — eski değer buraya yazılmazsa geri alınamaz.
      await tx.auditLog.create({
        data: {
          userId: direktor?.id ?? null,
          action: p.yeni ? "CREATE_TARGET" : "UPDATE_TARGET",
          entityType: "Target",
          entityId: target.id,
          oldValue: p.yeni
            ? undefined
            : {
                revenue: p.oncekiRevenue,
                gp: p.oncekiGp,
                revenueM: p.oncekiAylik?.revenue ?? null,
                gpM: p.oncekiAylik?.gp ?? null,
              },
          newValue: {
            revenue: p.revenue,
            gp: p.gp,
            revenueM: p.revenueM,
            gpM: p.gpM,
            source: "hedefler.xlsx",
          },
        },
      });
    }
  }, { timeout: 120_000 });

  console.log(`\n✓ ${plan.length} kayıt yazıldı, ${plan.length} denetim kaydı oluşturuldu.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
