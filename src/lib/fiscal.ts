export interface FiscalContext {
  fiscalYear: number;
  quarter: number;
  weekInQuarter: number;
}

/**
 * Calculates the fiscal year, quarter, and week number within the quarter for a given date.
 * Fiscal calendar rules:
 * - December belongs to the NEXT fiscal year's Q1 (e.g., Dec 2025 -> FY2026 Q1).
 * - Q1: December (prev year), January, February
 * - Q2: March, April, May
 * - Q3: June, July, August
 * - Q4: September, October, November
 */
export function getFiscalContext(date: Date): FiscalContext {
  const month = date.getMonth(); // 0-indexed (0 = Jan, 11 = Dec)
  const calendarYear = date.getFullYear();

  let fiscalYear = calendarYear;
  let quarter = 1;

  if (month === 11) {
    // December: rolls into the next fiscal year's Q1
    fiscalYear = calendarYear + 1;
    quarter = 1;
  } else if (month === 0 || month === 1) {
    // January, February: belongs to current calendar year's Q1
    fiscalYear = calendarYear;
    quarter = 1;
  } else if (month >= 2 && month <= 4) {
    // March, April, May: Q2
    fiscalYear = calendarYear;
    quarter = 2;
  } else if (month >= 5 && month <= 7) {
    // June, July, August: Q3
    fiscalYear = calendarYear;
    quarter = 3;
  } else if (month >= 8 && month <= 10) {
    // September, October, November: Q4
    fiscalYear = calendarYear;
    quarter = 4;
  }

  // Calculate week number dynamically
  const { startDate } = getQuarterDateRange(fiscalYear, quarter);
  const weekInQuarter = getWeekInQuarter(date, startDate);

  return {
    fiscalYear,
    quarter,
    weekInQuarter,
  };
}

/**
 * Returns the start and end dates for a given fiscal year and quarter.
 */
export function getQuarterDateRange(fiscalYear: number, quarter: number): { startDate: Date; endDate: Date } {
  let startDate: Date;
  let endDate: Date;

  switch (quarter) {
    case 1:
      // Q1: Dec 1 of (fiscalYear - 1) to Feb 28/29 of (fiscalYear)
      startDate = new Date(fiscalYear - 1, 11, 1, 0, 0, 0, 0);
      endDate = new Date(fiscalYear, 2, 0, 23, 59, 59, 999); // Day 0 of March is last day of Feb
      break;
    case 2:
      // Q2: Mar 1 of (fiscalYear) to May 31 of (fiscalYear)
      startDate = new Date(fiscalYear, 2, 1, 0, 0, 0, 0);
      endDate = new Date(fiscalYear, 5, 0, 23, 59, 59, 999); // Day 0 of June is last day of May
      break;
    case 3:
      // Q3: Jun 1 of (fiscalYear) to Aug 31 of (fiscalYear)
      startDate = new Date(fiscalYear, 5, 1, 0, 0, 0, 0);
      endDate = new Date(fiscalYear, 8, 0, 23, 59, 59, 999); // Day 0 of Sept is last day of Aug
      break;
    case 4:
      // Q4: Sep 1 of (fiscalYear) to Nov 30 of (fiscalYear)
      startDate = new Date(fiscalYear, 8, 1, 0, 0, 0, 0);
      endDate = new Date(fiscalYear, 11, 0, 23, 59, 59, 999); // Day 0 of Dec is last day of Nov
      break;
    default:
      throw new Error(`Invalid quarter: ${quarter}`);
  }

  return { startDate, endDate };
}

/**
 * Computes the 1-indexed week number of a date relative to the quarter's start date.
 * Uses normalized midnight dates to ensure safety against Daylight Saving Time (DST) offsets.
 */
export function getWeekInQuarter(date: Date, quarterStartDate?: Date): number {
  let start = quarterStartDate;
  
  if (!start) {
    const context = getFiscalContext(date);
    start = getQuarterDateRange(context.fiscalYear, context.quarter).startDate;
  }

  // Normalize hours to midnight local time to avoid DST issues
  const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
  const targetMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

  const diffMs = targetMidnight.getTime() - startMidnight.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return 1; // Default fallback for dates before the start of the quarter
  }

  return Math.floor(diffDays / 7) + 1;
}

/**
 * Formats a fiscal quarter period description in Turkish.
 */
export function formatFiscalPeriod(fiscalYear: number, quarter: number): string {
  switch (quarter) {
    case 1:
      return `FY${fiscalYear} - Q1 (Aralık ${fiscalYear - 1} - Şubat ${fiscalYear})`;
    case 2:
      return `FY${fiscalYear} - Q2 (Mart ${fiscalYear} - Mayıs ${fiscalYear})`;
    case 3:
      return `FY${fiscalYear} - Q3 (Haziran ${fiscalYear} - Ağustos ${fiscalYear})`;
    case 4:
      return `FY${fiscalYear} - Q4 (Eylül ${fiscalYear} - Kasım ${fiscalYear})`;
    default:
      return `FY${fiscalYear} - Q${quarter}`;
  }
}

/**
 * Convenience wrapper returning the current date's fiscal context.
 */
export function getCurrentFiscalContext(): FiscalContext {
  return getFiscalContext(new Date());
}

const TURKISH_MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
] as const;

export interface QuarterMonth {
  /** 1, 2 veya 3 — çeyrek içindeki sıra (M1/M2/M3) */
  index: 1 | 2 | 3;
  /** Takvim ayı, 0-tabanlı (Date.getMonth() ile aynı) */
  monthIndex: number;
  /** Takvim yılı — Q1'in M1'i bir önceki yılın aralığıdır */
  calendarYear: number;
  /** "Haziran 2026" */
  label: string;
  /** Ayın ilk günü, yerel gece yarısı */
  startDate: Date;
  /** Ertesi ayın ilk günü — ay "bitti" sayılma eşiği */
  endExclusive: Date;
}

/**
 * Çeyreğin üç takvim ayını döndürür.
 *
 * Çeyrekler her zaman ayın 1'inde başlayan temiz 3 takvim ayıdır, bu yüzden
 * M(n) = başlangıç ayı + (n-1). Q1'in aralık yıl-dönüşünü `new Date(y, m+n, 1)`
 * kendiliğinden çözer (ay taşması yılı artırır).
 */
export function getQuarterMonths(fiscalYear: number, quarter: number): QuarterMonth[] {
  const { startDate } = getQuarterDateRange(fiscalYear, quarter);
  const y = startDate.getFullYear();
  const m = startDate.getMonth();

  return [1, 2, 3].map((n) => {
    const start = new Date(y, m + (n - 1), 1, 0, 0, 0, 0);
    return {
      index: n as 1 | 2 | 3,
      monthIndex: start.getMonth(),
      calendarYear: start.getFullYear(),
      label: `${TURKISH_MONTHS[start.getMonth()]} ${start.getFullYear()}`,
      startDate: start,
      endExclusive: new Date(y, m + n, 1, 0, 0, 0, 0),
    };
  });
}

/**
 * Çeyreğin üç ayı için "bu ay kapandı mı" bilgisi (M1, M2, M3 sırasıyla).
 *
 * Ay takvim olarak bittiği anda kapanır; kapanan ayın hücreleri haftalık
 * formda salt-okunur olur. Haftalar aylara hizalı olmadığı için (13 hafta /
 * 3 ay) bu bilgi hafta numarasından TÜRETİLEMEZ, takvim tarihinden hesaplanır.
 */
export function getClosedMonths(
  fiscalYear: number,
  quarter: number,
  now: Date = new Date(),
): [boolean, boolean, boolean] {
  const months = getQuarterMonths(fiscalYear, quarter);
  return months.map((m) => now.getTime() >= m.endExclusive.getTime()) as [boolean, boolean, boolean];
}

/** Ay etiketleri, ör. ["Haziran 2026", "Temmuz 2026", "Ağustos 2026"] */
export function getQuarterMonthLabels(fiscalYear: number, quarter: number): [string, string, string] {
  return getQuarterMonths(fiscalYear, quarter).map((m) => m.label) as [string, string, string];
}

/**
 * Bir tarihin çeyrek içindeki ay sırası (0/1/2). Çeyrek dışındaysa null.
 * CRM fırsatlarının fatura tarihini M1/M2/M3'e eşlemek için kullanılır.
 */
export function getMonthIndexInQuarter(
  date: Date,
  fiscalYear: number,
  quarter: number,
): 0 | 1 | 2 | null {
  const months = getQuarterMonths(fiscalYear, quarter);
  const t = date.getTime();
  for (const m of months) {
    if (t >= m.startDate.getTime() && t < m.endExclusive.getTime()) {
      return (m.index - 1) as 0 | 1 | 2;
    }
  }
  return null;
}
