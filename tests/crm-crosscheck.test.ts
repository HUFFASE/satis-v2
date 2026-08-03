import { describe, it, expect } from "vitest";
import {
  bucketKeyFromRates,
  calculateOpportunityMultiplier,
  isInvalidRateCombo,
  isTryCurrency,
  type CrmBucketKey,
} from "../src/lib/crm/tdsynnex-parser";
import { compareCell } from "../src/lib/crm/crosscheck-core";
import { WIN_RATE_BUCKETS } from "../src/lib/weekly-forecast/schema";

/** Formdaki kova ağırlıkları — CRM multiplier ile aynı olmak ZORUNDA. */
const WEIGHT_BY_KEY = Object.fromEntries(
  WIN_RATE_BUCKETS.map((b) => [b.key, b.weight]),
) as Record<CrmBucketKey, number | null>;

describe("CRM kovası ↔ multiplier eşdeğerliği", () => {
  // Canlı veride görülen tüm kombinasyonlar + kenar durumlar
  const winRates = ["%100", "%75", "%50", "%25", "%0", "", "100", "belirsiz"];
  const invoicings = [
    "100 (Faturalanma ihtimali kesin)",
    "50 (Faturalanma ihtimali orta)",
    "0 (Faturalanmaz)",
    "",
    "belirsiz",
  ];

  it("kova varsa CRM de o fırsatı sayar (multiplier > 0)", () => {
    for (const w of winRates) {
      for (const i of invoicings) {
        const bucket = bucketKeyFromRates(w, i);
        if (!bucket) continue;
        const mult = calculateOpportunityMultiplier(w, i);
        expect(mult, `winRate="${w}" invoicing="${i}" → ${bucket}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Bilinen tek asimetri: `calculateOpportunityMultiplier` %100 win-rate'i
   * faturalanma oranına BAKMADAN 1.0 sayar (Rule 1 erken döner). Formda ise
   * yalnızca %100/%100 ve %100/%50 kovaları var — %100 + "0 faturalanma"nın
   * karşılığı yok. Bu durumda kova üretmeyip "kovasız" saymak doğrudur;
   * tahmin edip yanlış kovaya atmaktansa görünür kılınır.
   *
   * Canlı FY26Q3 verisinde bu kombinasyon HİÇ geçmiyor (kontrol edildi).
   */
  it("bilinen asimetri: %100 + faturalanma yok → CRM sayar, formda kova yok", () => {
    expect(calculateOpportunityMultiplier("%100", "0 (Faturalanmaz)")).toBe(1.0);
    expect(bucketKeyFromRates("%100", "0 (Faturalanmaz)")).toBeNull();
    // ...ve bu bir veri hatasıdır, meşru bir "kovasız" fırsat değil
    expect(isInvalidRateCombo("%100", "0 (Faturalanmaz)")).toBe(true);
  });

  it("bunun dışında kovasız olmak ile multiplier 0 aynı şeydir", () => {
    for (const w of winRates) {
      for (const i of invoicings) {
        // yukarıda belgelenen asimetriyi atla
        if (w === "%100" && !i.startsWith("100") && !i.startsWith("50")) continue;
        const bucket = bucketKeyFromRates(w, i);
        const mult = calculateOpportunityMultiplier(w, i);
        expect(
          bucket === null,
          `winRate="${w}" invoicing="${i}" → kova=${bucket} multiplier=${mult}`,
        ).toBe(mult === 0);
      }
    }
  });

  it("ağırlıklı kovalarda kova ağırlığı = multiplier", () => {
    for (const w of winRates) {
      for (const i of invoicings) {
        const bucket = bucketKeyFromRates(w, i);
        if (!bucket) continue;
        const weight = WEIGHT_BY_KEY[bucket];
        if (weight === null) continue; // w100* kovaları formda N/A
        expect(weight, `${w} / ${i} → ${bucket}`).toBe(calculateOpportunityMultiplier(w, i));
      }
    }
  });

  it("%100 kovaları multiplier 1.0'a karşılık gelir", () => {
    // Form bu ikisini ayırır (w100i100 / w100i50), multiplier ayıramaz — ikisi de 1.0
    expect(bucketKeyFromRates("%100", "100 (kesin)")).toBe("w100i100");
    expect(bucketKeyFromRates("%100", "50 (orta)")).toBe("w100i50");
    expect(calculateOpportunityMultiplier("%100", "100 (kesin)")).toBe(1.0);
    expect(calculateOpportunityMultiplier("%100", "50 (orta)")).toBe(1.0);
  });

  it("bilinen eşlemeleri doğrular", () => {
    expect(bucketKeyFromRates("%75", "100 (kesin)")).toBe("w75i100");
    expect(bucketKeyFromRates("%75", "50 (orta)")).toBe("w75i50");
    expect(bucketKeyFromRates("%50", "50 (orta)")).toBe("w50i50");
    expect(bucketKeyFromRates("%50", "100 (kesin)")).toBe("w50i50");
    expect(bucketKeyFromRates("%25", "her şey")).toBe("w25");
  });

  it("eşleşmeyen oranlarda tahmin etmez", () => {
    expect(bucketKeyFromRates("%100", "0 (faturalanmaz)")).toBeNull();
    expect(bucketKeyFromRates("%75", "0 (faturalanmaz)")).toBeNull();
    expect(bucketKeyFromRates("%50", "0 (faturalanmaz)")).toBeNull();
    expect(bucketKeyFromRates("", "")).toBeNull();
  });
});

describe("isTryCurrency", () => {
  it("TL/TRY'yi yakalar, USD'yi yakalamaz", () => {
    expect(isTryCurrency("TRY")).toBe(true);
    expect(isTryCurrency("TL")).toBe(true);
    expect(isTryCurrency("USD")).toBe(false);
    expect(isTryCurrency("EUR")).toBe(false);
  });

  it("partner para birimine de bakar", () => {
    expect(isTryCurrency("USD", "TRY")).toBe(true);
    expect(isTryCurrency("USD", "USD")).toBe(false);
    expect(isTryCurrency("USD", undefined)).toBe(false);
  });
});

describe("compareCell — tolerans", () => {
  it("birebir aynıysa eşleşir", () => {
    expect(compareCell(100000, 100000)).toBe("match");
  });

  it("%0,5 içindeki farkı yuvarlama sayar", () => {
    expect(compareCell(1000000, 1004000)).toBe("match");
    expect(compareCell(100, 100.4)).toBe("match");
  });

  it("küçük tutarlarda $1 tabanı uygular", () => {
    expect(compareCell(10, 10.5)).toBe("match");
  });

  it("%5'e kadar uyarı, üstü kritik", () => {
    expect(compareCell(1000000, 1030000)).toBe("warn");
    expect(compareCell(1000000, 1200000)).toBe("crit");
  });

  it("tek taraflı fark her zaman kritiktir", () => {
    expect(compareCell(0, 500000)).toBe("crit");
    expect(compareCell(500000, 0)).toBe("crit");
  });

  it("iki taraf da sıfırsa eşleşir", () => {
    expect(compareCell(0, 0)).toBe("match");
  });
});

describe("isInvalidRateCombo — çelişkili giriş tespiti", () => {
  it("%100 kazanma + %0 faturalanma hatalıdır", () => {
    expect(isInvalidRateCombo("%100", "0 (Faturalanma ihtimali yok)")).toBe(true);
    expect(isInvalidRateCombo("%100", "")).toBe(true);
  });

  it("%100 + geçerli faturalanma hata değildir", () => {
    expect(isInvalidRateCombo("%100", "100 (kesin)")).toBe(false);
    expect(isInvalidRateCombo("%100", "50 (orta)")).toBe(false);
  });

  it("%75+0 ve %50+0 HATA DEĞİL — gerçekten sıfır olasılıklı fırsatlar", () => {
    expect(isInvalidRateCombo("%75", "0 (Faturalanma ihtimali yok)")).toBe(false);
    expect(isInvalidRateCombo("%50", "0 (Faturalanma ihtimali yok)")).toBe(false);
    expect(isInvalidRateCombo("%25", "0 (Faturalanma ihtimali yok)")).toBe(false);
  });
});
