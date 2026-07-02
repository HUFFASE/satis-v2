import { describe, it, expect } from "vitest";
import { getFiscalContext, getQuarterDateRange, getWeekInQuarter, formatFiscalPeriod } from "../src/lib/fiscal";

describe("Fiscal Helper Functions", () => {
  describe("getFiscalContext", () => {
    it("rolls December into the next calendar year's FY Q1", () => {
      const decDate = new Date(2025, 11, 15); // Dec 15, 2025
      const context = getFiscalContext(decDate);
      expect(context.fiscalYear).toBe(2026);
      expect(context.quarter).toBe(1);
      expect(context.weekInQuarter).toBe(3); // Dec 1 to 7 = W1, Dec 8 to 14 = W2, Dec 15 = W3
    });

    it("identifies January as current calendar year's FY Q1", () => {
      const janDate = new Date(2026, 0, 10); // Jan 10, 2026
      const context = getFiscalContext(janDate);
      expect(context.fiscalYear).toBe(2026);
      expect(context.quarter).toBe(1);
      // Jan 10 is 40 days after Dec 1 (30 days in Dec + 10 in Jan)
      // Math.floor(40 / 7) + 1 = 5 + 1 = 6
      expect(context.weekInQuarter).toBe(6);
    });

    it("identifies March 1st as start of Q2", () => {
      const marDate = new Date(2026, 2, 1); // Mar 1, 2026
      const context = getFiscalContext(marDate);
      expect(context.fiscalYear).toBe(2026);
      expect(context.quarter).toBe(2);
      expect(context.weekInQuarter).toBe(1);
    });

    it("identifies November 30th as end of Q4", () => {
      const novDate = new Date(2026, 10, 30); // Nov 30, 2026
      const context = getFiscalContext(novDate);
      expect(context.fiscalYear).toBe(2026);
      expect(context.quarter).toBe(4);
      // Sept 1 to Nov 30 is 90 days (30 in Sep + 31 in Oct + 29 in Nov)
      // Math.floor(90 / 7) + 1 = 12 + 1 = 13
      expect(context.weekInQuarter).toBe(13);
    });

    it("handles leap year boundaries correctly (Feb 29, 2024)", () => {
      const leapDay = new Date(2024, 1, 29); // Feb 29, 2024
      const context = getFiscalContext(leapDay);
      expect(context.fiscalYear).toBe(2024);
      expect(context.quarter).toBe(1);
      // Dec 1, 2023 to Feb 29, 2024 is 90 days (30 in Dec + 31 in Jan + 29 in Feb)
      // Math.floor(90 / 7) + 1 = 12 + 1 = 13
      expect(context.weekInQuarter).toBe(13);
    });
  });

  describe("getQuarterDateRange", () => {
    it("returns correct start/end date range for FY2026 Q1", () => {
      const { startDate, endDate } = getQuarterDateRange(2026, 1);
      expect(startDate.getFullYear()).toBe(2025);
      expect(startDate.getMonth()).toBe(11); // December
      expect(startDate.getDate()).toBe(1);

      expect(endDate.getFullYear()).toBe(2026);
      expect(endDate.getMonth()).toBe(1); // February
      expect(endDate.getDate()).toBe(28); // Not a leap year
    });

    it("returns correct start/end date range for FY2024 Q1 (Leap Year)", () => {
      const { startDate, endDate } = getQuarterDateRange(2024, 1);
      expect(startDate.getFullYear()).toBe(2023);
      expect(startDate.getMonth()).toBe(11); // December
      expect(startDate.getDate()).toBe(1);

      expect(endDate.getFullYear()).toBe(2024);
      expect(endDate.getMonth()).toBe(1); // February
      expect(endDate.getDate()).toBe(29); // Leap year
    });
  });

  describe("formatFiscalPeriod", () => {
    it("formats periods correctly in Turkish", () => {
      expect(formatFiscalPeriod(2026, 1)).toBe("FY2026 - Q1 (Aralık 2025 - Şubat 2026)");
      expect(formatFiscalPeriod(2026, 2)).toBe("FY2026 - Q2 (Mart 2026 - Mayıs 2026)");
    });
  });
});
