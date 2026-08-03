import { describe, it, expect } from "vitest";
import {
  getQuarterMonths,
  getQuarterMonthLabels,
  getClosedMonths,
  getMonthIndexInQuarter,
} from "../src/lib/fiscal";
import {
  ALL_INPUT_PATHS,
  EDITABLE_INPUT_PATHS,
  monthIndexOfPath,
} from "../src/lib/weekly-forecast/schema";
import {
  hasMonthlyBreakdown,
  monthlyTriples,
  sumTriple,
  monthlySumMatches,
  round2,
} from "../src/lib/monthly";

describe("Çeyrek ay yardımcıları", () => {
  it("Q3'ü Haziran/Temmuz/Ağustos olarak çözer", () => {
    expect(getQuarterMonthLabels(2026, 3)).toEqual(["Haziran 2026", "Temmuz 2026", "Ağustos 2026"]);
  });

  it("Q1'in aralık yıl-dönüşünü doğru çözer", () => {
    // FY2026 Q1 = Aralık 2025 - Şubat 2026
    expect(getQuarterMonthLabels(2026, 1)).toEqual(["Aralık 2025", "Ocak 2026", "Şubat 2026"]);
    const months = getQuarterMonths(2026, 1);
    expect(months[0].calendarYear).toBe(2025);
    expect(months[1].calendarYear).toBe(2026);
  });

  it("her çeyrek için üç ay döndürür ve aralar bitişiktir", () => {
    for (const q of [1, 2, 3, 4]) {
      const months = getQuarterMonths(2026, q);
      expect(months).toHaveLength(3);
      expect(months[0].endExclusive.getTime()).toBe(months[1].startDate.getTime());
      expect(months[1].endExclusive.getTime()).toBe(months[2].startDate.getTime());
    }
  });

  describe("getClosedMonths — ay kilidi", () => {
    it("çeyrek ortasında yalnızca geçmiş ayları kapatır", () => {
      // 15 Temmuz 2026: Haziran bitti, Temmuz sürüyor
      expect(getClosedMonths(2026, 3, new Date(2026, 6, 15))).toEqual([true, false, false]);
    });

    it("ayın son günü henüz kapatmaz", () => {
      // 30 Haziran 23:00 — Haziran hâlâ açık
      expect(getClosedMonths(2026, 3, new Date(2026, 5, 30, 23, 0))).toEqual([false, false, false]);
    });

    it("ertesi ayın ilk anında kapatır", () => {
      expect(getClosedMonths(2026, 3, new Date(2026, 6, 1, 0, 0))).toEqual([true, false, false]);
    });

    it("çeyrek bittiğinde üçünü de kapatır", () => {
      expect(getClosedMonths(2026, 3, new Date(2026, 8, 1))).toEqual([true, true, true]);
    });

    it("çeyrek başlamadan hiçbirini kapatmaz", () => {
      expect(getClosedMonths(2026, 4, new Date(2026, 7, 15))).toEqual([false, false, false]);
    });
  });

  describe("getMonthIndexInQuarter — CRM tarih eşlemesi", () => {
    it("çeyrek içindeki tarihleri M1/M2/M3'e eşler", () => {
      expect(getMonthIndexInQuarter(new Date(2026, 5, 18), 2026, 3)).toBe(0);
      expect(getMonthIndexInQuarter(new Date(2026, 6, 3), 2026, 3)).toBe(1);
      expect(getMonthIndexInQuarter(new Date(2026, 7, 31), 2026, 3)).toBe(2);
    });

    it("çeyrek dışındaki tarihler için null döner", () => {
      expect(getMonthIndexInQuarter(new Date(2026, 8, 1), 2026, 3)).toBeNull();
      expect(getMonthIndexInQuarter(new Date(2026, 4, 31), 2026, 3)).toBeNull();
    });

    it("Q1'in yıl dönüşünde de doğru çalışır", () => {
      expect(getMonthIndexInQuarter(new Date(2025, 11, 15), 2026, 1)).toBe(0);
      expect(getMonthIndexInQuarter(new Date(2026, 1, 10), 2026, 1)).toBe(2);
    });
  });
});

describe("Aylık kırılım yardımcıları", () => {
  const dolu = {
    revenue: 300, gp: 30,
    revenueM1: 100, revenueM2: 100, revenueM3: 100,
    gpM1: 10, gpM2: 10, gpM3: 10,
  };
  const bos = {
    revenue: 300, gp: 30,
    revenueM1: null, revenueM2: null, revenueM3: null,
    gpM1: null, gpM2: null, gpM3: null,
  };
  const kismi = { ...dolu, gpM3: null };

  it("altı alan doluysa kırılım var sayar", () => {
    expect(hasMonthlyBreakdown(dolu)).toBe(true);
  });

  it("hiçbiri yoksa kırılım yok sayar", () => {
    expect(hasMonthlyBreakdown(bos)).toBe(false);
    expect(monthlyTriples(bos)).toBeNull();
  });

  it("kısmi giriş kırılım sayılmaz — sıfır olarak yorumlanmamalı", () => {
    expect(hasMonthlyBreakdown(kismi)).toBe(false);
    expect(monthlyTriples(kismi)).toBeNull();
  });

  it("null/undefined kayıtta çökmez", () => {
    expect(hasMonthlyBreakdown(null)).toBe(false);
    expect(monthlyTriples(undefined)).toBeNull();
  });

  it("üçlüleri doğru çıkarır", () => {
    expect(monthlyTriples(dolu)).toEqual({ revenue: [100, 100, 100], gp: [10, 10, 10] });
  });

  it("float toplamını kuruşa yuvarlar", () => {
    expect(sumTriple([0.1, 0.2, 0.3])).toBe(0.6);
    expect(round2(2920571.514)).toBe(2920571.51);
  });

  it("kuruş toleransıyla eşleşme kontrolü yapar", () => {
    expect(monthlySumMatches([100, 100, 100], 300)).toBe(true);
    expect(monthlySumMatches([100, 100, 100.005], 300)).toBe(true);
    expect(monthlySumMatches([100, 100, 101], 300)).toBe(false);
  });
});

describe("Hücre yolu → ay eşlemesi (ay kilidi için)", () => {
  it("aylık hücrelerin ay indeksini çıkarır", () => {
    expect(monthIndexOfPath("invoicedNsb.0")).toBe(0);
    expect(monthIndexOfPath("backlogGp.2")).toBe(2);
    expect(monthIndexOfPath("crm.w75i100.1")).toBe(1);
    expect(monthIndexOfPath("gpWeighted.2")).toBe(2);
  });

  it("aylık olmayan hücrelerde null döner", () => {
    expect(monthIndexOfPath("olkNsb")).toBeNull();
    expect(monthIndexOfPath("olkNgp")).toBeNull();
  });
});

describe("Girilebilir yol listesi", () => {
  it("hedef satırları düzenlenebilir yollardan çıkarılmış", () => {
    for (const p of ["targetNsb.0", "targetNsb.1", "targetNsb.2", "targetNgp.0", "targetNgp.1", "targetNgp.2"]) {
      expect(ALL_INPUT_PATHS).toContain(p);
      expect(EDITABLE_INPUT_PATHS).not.toContain(p);
    }
  });

  it("actual (invoiced/backlog) satırları düzenlenebilir yollardan çıkarılmış", () => {
    for (const p of ["invoicedNsb.0", "backlogGp.2"]) {
      expect(ALL_INPUT_PATHS).toContain(p);
      expect(EDITABLE_INPUT_PATHS).not.toContain(p);
    }
  });

  it("diğer hücreler düzenlenebilir kalır", () => {
    expect(EDITABLE_INPUT_PATHS).toContain("olkNsb");
    expect(EDITABLE_INPUT_PATHS).not.toContain("invoicedNsb.0");
    expect(EDITABLE_INPUT_PATHS).toContain("crm.w25.2");
    expect(EDITABLE_INPUT_PATHS.length).toBe(ALL_INPUT_PATHS.length - 18);
  });
});
