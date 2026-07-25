import { describe, expect, it } from "vitest";
import { calculateOpportunityMultiplier } from "../src/lib/crm/tdsynnex-parser";

describe("TDSYNNEX CRM Multiplier Rules", () => {
  it("should return 1.0 for 100% win rate", () => {
    expect(calculateOpportunityMultiplier("%100", "100 (Faturalanma ihtimali kesin)")).toBe(1.0);
  });

  it("should return 1.0 for 75% win rate with 100% invoicing", () => {
    expect(calculateOpportunityMultiplier("%75", "100 (Faturalanma ihtimali kesin)")).toBe(1.0);
  });

  it("should return 0.5 for 75% win rate with 50% invoicing", () => {
    expect(calculateOpportunityMultiplier("%75", "50 (Faturalanma ihtimali yüksek)")).toBe(0.5);
  });

  it("should return 0.25 for 50% win rate with 50% or 100% invoicing", () => {
    expect(calculateOpportunityMultiplier("%50", "50 (Faturalanma ihtimali yüksek)")).toBe(0.25);
    expect(calculateOpportunityMultiplier("%50", "100 (Faturalanma ihtimali kesin)")).toBe(0.25);
  });

  it("should return 0.05 for 25% win rate", () => {
    expect(calculateOpportunityMultiplier("%25", "0 (Faturalanma ihtimali yok)")).toBe(0.05);
  });

  it("should return 0.0 for 0% invoicing probability or unmapped stage", () => {
    expect(calculateOpportunityMultiplier("%75", "0 (Faturalanma ihtimali yok)")).toBe(0.0);
    expect(calculateOpportunityMultiplier("%50", "0 (Faturalanma ihtimali yok)")).toBe(0.0);
  });
});
