type BacklogSnapshot = {
  vendorId: string;
  fiscalPeriodId: string;
  weekNumber: number;
};

/**
 * Backlog is a point-in-time value, not a weekly flow. Keep all weekly rows
 * for history, but use only the latest eligible row per vendor and period in
 * dashboard totals.
 */
export function getLatestBacklogSnapshots<T extends BacklogSnapshot>(
  rows: T[],
  maxWeekNumber?: number
): Map<string, T> {
  const latestRows = new Map<string, T>();

  for (const row of rows) {
    if (maxWeekNumber !== undefined && row.weekNumber > maxWeekNumber) continue;

    const key = `${row.vendorId}:${row.fiscalPeriodId}`;
    const current = latestRows.get(key);
    if (!current || row.weekNumber > current.weekNumber) {
      latestRows.set(key, row);
    }
  }

  return latestRows;
}
