import { getQuarterMonths } from "@/lib/fiscal";
import { round2 } from "@/lib/monthly";

export type MonthlyTriple = [number, number, number];

export type BacklogMetricKey = "invoicedNsb" | "invoicedGp" | "backlogNsb" | "backlogGp";

export interface ParsedBacklogVendorRow {
  rowNumber: number;
  managerName: string;
  vendor: string;
  invoicedNsb: MonthlyTriple;
  invoicedGp: MonthlyTriple;
  backlogNsb: MonthlyTriple;
  backlogGp: MonthlyTriple;
  /** Çeyrek Invoiced NSB toplamı */
  invoicedNsbQuarter: number;
  /** Çeyrek Backlog NSB toplamı */
  backlogNsbQuarter: number;
}

const MONTH_ABBREVS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

const EMPTY_TRIPLE: MonthlyTriple = [0, 0, 0];

function zeros(): Record<BacklogMetricKey, MonthlyTriple> {
  return {
    invoicedNsb: [0, 0, 0],
    invoicedGp: [0, 0, 0],
    backlogNsb: [0, 0, 0],
    backlogGp: [0, 0, 0],
  };
}

function getCellText(row: unknown[], columnIndex: number) {
  const value = row[columnIndex];
  return value === undefined || value === null ? "" : String(value).trim();
}

export function parseImportNumber(value: string, fieldName: string, rowNumber: number) {
  const trimmed = value.trim();

  if (!trimmed || /^[-—–]+$/.test(trimmed)) {
    return 0;
  }

  const withoutCurrency = trimmed
    .replace(/\((.*)\)/, "-$1")
    .replace(/[$€£₺]/g, "")
    .replace(/\s/g, "");
  const lastComma = withoutCurrency.lastIndexOf(",");
  const lastDot = withoutCurrency.lastIndexOf(".");
  let normalized = withoutCurrency;

  if (lastComma > -1 && lastDot > -1) {
    normalized =
      lastComma > lastDot
        ? withoutCurrency.replace(/\./g, "").replace(",", ".")
        : withoutCurrency.replace(/,/g, "");
  } else if (lastComma > -1) {
    const fractionLength = withoutCurrency.length - lastComma - 1;
    normalized =
      fractionLength === 3
        ? withoutCurrency.replace(/,/g, "")
        : withoutCurrency.replace(",", ".");
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${rowNumber}. satırda ${fieldName} değeri geçerli değil: "${value}".`);
  }

  return parsed;
}

function normalizeHeader(value: string) {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function monthIndexFromHeader(header: string, fiscalYear: number, quarter: number): 0 | 1 | 2 | null {
  const normalized = normalizeHeader(header);
  const quarterMonths = getQuarterMonths(fiscalYear, quarter);

  for (let i = 0; i < quarterMonths.length; i++) {
    const abbrev = MONTH_ABBREVS[quarterMonths[i].monthIndex];
    if (normalized.includes(abbrev)) {
      return i as 0 | 1 | 2;
    }
  }

  return null;
}

export function classifyBacklogColumn(header: string): BacklogMetricKey | null {
  const h = normalizeHeader(header);
  const isInvoiced = h.includes("invoiced") || h.includes("inv.");
  const isBacklog = h.includes("backlog") || h.includes("backl");

  // U/V gibi birleşik toplam kolonları
  if (isInvoiced && isBacklog) return null;
  if (h.includes(" vs ") || h.includes("prev")) return null;

  const isNsb = h.includes("nsb");
  const isGp = /\bgp\b/.test(h) || h.includes(" ngp");

  if (isInvoiced && isNsb) return "invoicedNsb";
  if (isInvoiced && isGp) return "invoicedGp";
  if (isBacklog && isNsb) return "backlogNsb";
  if (isBacklog && isGp) return "backlogGp";
  return null;
}

export interface BacklogColumnMapping {
  columnIndex: number;
  metric: BacklogMetricKey;
  monthIndex: 0 | 1 | 2;
}

export function buildBacklogColumnMappings(
  headerRow: unknown[],
  fiscalYear: number,
  quarter: number,
  startColumnIndex = 7,
): BacklogColumnMapping[] {
  const mappings: BacklogColumnMapping[] = [];

  for (let columnIndex = startColumnIndex; columnIndex < headerRow.length; columnIndex++) {
    const header = getCellText(headerRow, columnIndex);
    if (!header) continue;

    const metric = classifyBacklogColumn(header);
    const monthIndex = monthIndexFromHeader(header, fiscalYear, quarter);
    if (!metric || monthIndex === null) continue;

    mappings.push({ columnIndex, metric, monthIndex });
  }

  return mappings;
}

function isDataHeaderRow(row: unknown[]) {
  const manager = getCellText(row, 3).toLowerCase();
  const vendor = getCellText(row, 4).toLowerCase();
  return manager.includes("sales manager") && vendor.includes("vendor");
}

function isSkippableRow(managerName: string, vendor: string) {
  if (!managerName && !vendor) return true;

  const normalizedManager = managerName.toUpperCase();
  const normalizedVendor = vendor.toUpperCase();
  return (
    normalizedManager.includes("SALES MANAGER") ||
    normalizedManager.includes("SATIS") ||
    normalizedVendor.includes("VENDOR")
  );
}

function sumTriple(triple: MonthlyTriple) {
  return round2(triple[0] + triple[1] + triple[2]);
}

/**
 * "Monthly Details" sheet satırlarını vendor başına aylık invoiced/backlog
 * kırılımına çevirir. U/V toplam kolonları okunmaz.
 */
export function parseMonthlyDetailsRows(
  rows: unknown[][],
  fiscalYear: number,
  quarter: number,
): ParsedBacklogVendorRow[] {
  const headerRowIndex = rows.findIndex((row) => isDataHeaderRow(row));
  if (headerRowIndex === -1) {
    throw new Error("Monthly Details sheet'inde başlık satırı bulunamadı.");
  }

  const columnMappings = buildBacklogColumnMappings(rows[headerRowIndex], fiscalYear, quarter);
  if (columnMappings.length === 0) {
    throw new Error("Monthly Details sheet'inde okunabilir aylık backlog kolonu bulunamadı.");
  }

  const parsedRows: ParsedBacklogVendorRow[] = [];

  for (let index = headerRowIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = index + 1;
    const managerName = getCellText(row, 3);
    const vendor = getCellText(row, 4);

    if (isSkippableRow(managerName, vendor)) continue;
    if (!managerName || !vendor) continue;

    const metrics = zeros();
    for (const mapping of columnMappings) {
      const raw = getCellText(row, mapping.columnIndex);
      const value = parseImportNumber(raw, mapping.metric, rowNumber);
      metrics[mapping.metric][mapping.monthIndex] = round2(
        metrics[mapping.metric][mapping.monthIndex] + value,
      );
    }

    parsedRows.push({
      rowNumber,
      managerName,
      vendor,
      invoicedNsb: [...metrics.invoicedNsb] as MonthlyTriple,
      invoicedGp: [...metrics.invoicedGp] as MonthlyTriple,
      backlogNsb: [...metrics.backlogNsb] as MonthlyTriple,
      backlogGp: [...metrics.backlogGp] as MonthlyTriple,
      invoicedNsbQuarter: sumTriple(metrics.invoicedNsb),
      backlogNsbQuarter: sumTriple(metrics.backlogNsb),
    });
  }

  return parsedRows;
}
