import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import path from "node:path";
import {
  buildBacklogColumnMappings,
  classifyBacklogColumn,
  parseMonthlyDetailsRows,
} from "../src/lib/backlog/parse-monthly-details";

const SAMPLE_FILE = path.join(process.cwd(), "FY26_Q3-Backlog_17072026_ALL_V3.xlsx");

function loadMonthlyDetailsRows() {
  const workbook = XLSX.readFile(SAMPLE_FILE);
  const sheet = workbook.Sheets["Monthly Details"];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
}

describe("Backlog Monthly Details parser", () => {
  it("kolon başlıklarını invoiced/backlog × NSB/GP olarak sınıflandırır", () => {
    expect(classifyBacklogColumn("Jun NSB Invoiced")).toBe("invoicedNsb");
    expect(classifyBacklogColumn("Jun GP Invoiced")).toBe("invoicedGp");
    expect(classifyBacklogColumn("Jul NSB\r\nBacklog")).toBe("backlogNsb");
    expect(classifyBacklogColumn("Aug GP\r\nBacklog")).toBe("backlogGp");
    expect(classifyBacklogColumn("Q3 NSB Inv. + Backl.")).toBeNull();
  });

  it("Q3 için Jun/Jul/Aug kolonlarını M1/M2/M3'e eşler", () => {
    const rows = loadMonthlyDetailsRows();
    const headerRow = rows.find((row) => String(row[4]).toLowerCase().includes("vendor"));
    expect(headerRow).toBeTruthy();

    const mappings = buildBacklogColumnMappings(headerRow!, 2026, 3);
    const junInvoicedNsb = mappings.find(
      (m) => m.metric === "invoicedNsb" && m.monthIndex === 0,
    );
    const julBacklogNsb = mappings.find(
      (m) => m.metric === "backlogNsb" && m.monthIndex === 1,
    );
    expect(junInvoicedNsb?.columnIndex).toBe(7);
    expect(julBacklogNsb?.columnIndex).toBe(13);
  });

  it("ADOBE satırını ayrıştırır ve U kolonu toplamıyla tutarlıdır", () => {
    const rows = loadMonthlyDetailsRows();
    const parsed = parseMonthlyDetailsRows(rows, 2026, 3);
    const adobe = parsed.find((row) => row.vendor === "ADOBE");
    expect(adobe).toBeTruthy();

    expect(adobe!.invoicedNsbQuarter).toBe(736542);
    expect(adobe!.backlogNsbQuarter).toBe(92437);
    expect(adobe!.invoicedNsb[0]).toBe(719488);
    expect(adobe!.backlogNsb[1]).toBe(91899);
    expect(adobe!.invoicedNsbQuarter + adobe!.backlogNsbQuarter).toBe(828979);
  });

  it("ACRONIS satırında yalnızca invoiced ve backlog NSB kırılımını okur", () => {
    const rows = loadMonthlyDetailsRows();
    const parsed = parseMonthlyDetailsRows(rows, 2026, 3);
    const acronis = parsed.find((row) => row.vendor === "ACRONIS");
    expect(acronis).toBeTruthy();
    expect(acronis!.invoicedNsb).toEqual([30056, 0, 0]);
    expect(acronis!.backlogNsb).toEqual([0, 25310, 0]);
    expect(acronis!.invoicedNsbQuarter).toBe(30056);
    expect(acronis!.backlogNsbQuarter).toBe(25310);
  });
});
