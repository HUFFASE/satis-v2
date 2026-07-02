import prisma from "./prisma";
import { getQuarterDateRange } from "./fiscal";

/**
 * Finds or creates a FiscalPeriod record in the database for the given fiscal year and quarter.
 * Resolves appropriate start and end dates from the fiscal date range helper.
 * Idempotent.
 */
export async function ensureFiscalPeriod(fiscalYear: number, quarter: number) {
  const { startDate, endDate } = getQuarterDateRange(fiscalYear, quarter);

  // Attempt to locate an existing record using the compound unique index
  const existing = await prisma.fiscalPeriod.findUnique({
    where: {
      fiscalYear_quarter: {
        fiscalYear,
        quarter,
      },
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
