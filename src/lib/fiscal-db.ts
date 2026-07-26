import prisma from "./prisma";
import { getQuarterDateRange, getFiscalContext } from "./fiscal";

/**
 * Finds or creates a FiscalPeriod record in the database for the given fiscal year and quarter.
 * Resolves appropriate start and end dates from the fiscal date range helper.
 * Idempotent.
 */
export async function ensureFiscalPeriod(fiscalYearInput: number, quarterInput: number) {
  const currentContext = getFiscalContext(new Date());
  const fiscalYear = Number.isInteger(Number(fiscalYearInput)) && Number(fiscalYearInput) > 2000 ? Number(fiscalYearInput) : currentContext.fiscalYear;
  const quarter = Number.isInteger(Number(quarterInput)) && Number(quarterInput) >= 1 && Number(quarterInput) <= 4 ? Number(quarterInput) : currentContext.quarter;

  const { startDate, endDate } = getQuarterDateRange(fiscalYear, quarter);

  // Attempt to locate an existing record
  const existing = await prisma.fiscalPeriod.findFirst({
    where: {
      fiscalYear,
      quarter,
    },
  });

  if (existing) {
    return existing;
  }

  // Record doesn't exist, create it
  return prisma.fiscalPeriod.create({
    data: {
      fiscalYear,
      quarter,
      startDate,
      endDate,
      isLocked: false,
    },
  });
}
