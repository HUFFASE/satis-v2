/**
 * hedefler.xlsx ANALİZ (SALT-OKUNUR — hiçbir şey yazmaz).
 *
 * Çalıştır:
 *   node --env-file=.env node_modules/.bin/tsx scripts/db/analyze-target-file.ts <dosya>
 *
 * Dosya formatı: Number | Vendor | Month | Revenue | GP  (değerler BİN USD)
 * Aylar İngilizce; mali yıl Aralık–Kasım.
 */
import * as XLSX from "xlsx";
import prisma from "@/lib/prisma";
import { getQuarterMonths } from "@/lib/fiscal";

const FILE = process.argv[2] ?? "/Users/huffase/Documents/hedefler.xlsx";
/** Dosya bin USD cinsinden; DB tam USD tutuyor. */
const SCALE = 1000;
const FISCAL_YEAR = 2026;

const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface FileRow {
  vendor: string;
  monthIndex: number; // 0-11 takvim ayı
  revenue: number | null;
  gp: number | null;
}

function parseAmount(value: unknown): number | null {
  const s = String(value ?? "").trim();
  if (s === "" || s === "--" || s === "-") return null;
  const n = Number(s.replace(/,/g, "").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

function readFile(): FileRow[] {
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
  return raw.map((r) => {
    const monthName = String(r.Month ?? "").trim();
    const monthIndex = EN_MONTHS.indexOf(monthName);
    if (monthIndex < 0) throw new Error(`Tanınmayan ay: "${monthName}"`);
    return {
      vendor: String(r.Vendor ?? "").trim().toUpperCase(),
      monthIndex,
      revenue: parseAmount(r.Revenue),
      gp: parseAmount(r.GP),
    };
  });
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

async function main() {
  const rows = readFile();
  const fileVendors = [...new Set(rows.map((r) => r.vendor))].sort();

  const dbVendors = await prisma.vendor.findMany({
    include: { aliases: true },
  });
  const lookup = new Map<string, { id: string; name: string; isActive: boolean }>();
  for (const v of dbVendors) {
    const val = { id: v.id, name: v.name, isActive: v.isActive };
    lookup.set(v.name.toUpperCase(), val);
    if (v.code) lookup.set(v.code.toUpperCase(), val);
    for (const a of v.aliases) lookup.set(a.alias.toUpperCase(), val);
  }

  const eslesen: string[] = [];
  const eslesmeyen: string[] = [];
  const pasif: string[] = [];
  for (const fv of fileVendors) {
    const hit = lookup.get(fv);
    if (!hit) eslesmeyen.push(fv);
    else if (!hit.isActive) pasif.push(`${fv} → ${hit.name} (PASİF)`);
    else eslesen.push(fv);
  }

  console.log(`\n${"=".repeat(64)}\nMARKA EŞLEŞMESİ\n${"=".repeat(64)}`);
  console.log(`Dosyadaki marka : ${fileVendors.length}`);
  console.log(`Eşleşen         : ${eslesen.length}`);
  if (pasif.length) console.log(`Pasif vendor    : ${pasif.length}\n   ${pasif.join("\n   ")}`);
  if (eslesmeyen.length) {
    console.log(`\n⚠ EŞLEŞMEYEN (${eslesmeyen.length}) — bunlar için karar gerekiyor:`);
    for (const v of eslesmeyen) {
      const dolu = rows.filter((r) => r.vendor === v && (r.revenue !== null || r.gp !== null));
      const toplam = dolu.reduce((a, r) => a + (r.revenue ?? 0), 0);
      console.log(`   ${v.padEnd(16)} ${dolu.length}/12 ay dolu, yıllık ${money(toplam * SCALE)}`);
    }
  }

  // Dosyadaki markaları DB'de olmayanlar dışında çeyreklere böl
  console.log(`\n${"=".repeat(64)}\nÇEYREK KARŞILAŞTIRMASI (FY${FISCAL_YEAR})\n${"=".repeat(64)}`);

  const periods = await prisma.fiscalPeriod.findMany({ where: { fiscalYear: FISCAL_YEAR } });
  let toplamFark = 0;
  let farkliKayit = 0;
  let eksikAy = 0;

  for (const q of [1, 2, 3, 4]) {
    const period = periods.find((p) => p.quarter === q);
    if (!period) {
      console.log(`\nQ${q}: dönem kaydı yok, atlanır`);
      continue;
    }
    const months = getQuarterMonths(FISCAL_YEAR, q).map((m) => m.monthIndex);
    const targets = await prisma.target.findMany({
      where: { fiscalPeriodId: period.id },
      include: { vendor: true },
    });

    const satirlar: string[] = [];
    for (const t of targets) {
      const vRows = months.map((mi) => rows.find((r) => r.vendor === t.vendor.name.toUpperCase() && r.monthIndex === mi));
      const eksik = vRows.filter((r) => !r || r.revenue === null || r.gp === null).length;
      if (eksik > 0) {
        eksikAy += eksik;
        satirlar.push(`   ${t.vendor.name.padEnd(14)} ⚠ ${eksik}/3 ay dosyada boş ("--")`);
        continue;
      }
      const dosyaRev = vRows.reduce((a, r) => a + r!.revenue! * SCALE, 0);
      const dosyaGp = vRows.reduce((a, r) => a + r!.gp! * SCALE, 0);
      const dbRev = Number(t.revenue);
      const dbGp = Number(t.gp);
      const farkRev = dosyaRev - dbRev;
      const farkGp = dosyaGp - dbGp;
      if (Math.abs(farkRev) > 0.01 || Math.abs(farkGp) > 0.01) {
        farkliKayit++;
        toplamFark += Math.abs(farkRev);
        satirlar.push(
          `   ${t.vendor.name.padEnd(14)} NSB ${money(dbRev)} → ${money(dosyaRev)} (${farkRev >= 0 ? "+" : ""}${money(farkRev)})`,
        );
      }
    }
    console.log(`\nQ${q} — ${targets.length} DB hedefi`);
    if (satirlar.length === 0) console.log("   ✓ hepsi birebir tutuyor");
    else satirlar.forEach((s) => console.log(s));
  }

  console.log(`\n${"=".repeat(64)}\nÖZET\n${"=".repeat(64)}`);
  console.log(`Çeyrek toplamı değişecek kayıt : ${farkliKayit}`);
  console.log(`Toplam mutlak NSB farkı        : ${money(toplamFark)}`);
  console.log(`Dosyada "--" olan ay-marka     : ${eksikAy}`);
  console.log(`\nHiçbir şey yazılmadı — bu yalnızca analizdir.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
