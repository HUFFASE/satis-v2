import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildBacklogColumnMappings,
  classifyBacklogColumn,
  parseMonthlyDetailsRows,
} from "../src/lib/backlog/parse-monthly-details";

// Synthetic workbook: no dependency on a private sales export on disk.
function loadMonthlyDetailsRows() {
  const rows = [
    ["Synthetic backlog fixture"],
    ["", "", "", "Sales Manager", "Vendor", "", "",
      "Jun NSB Invoiced", "Jun GP Invoiced", "Jun NSB Backlog", "Jun GP Backlog",
      "Jul NSB Invoiced", "Jul GP Invoiced", "Jul NSB\r\nBacklog", "Jul GP Backlog",
      "Aug NSB Invoiced", "Aug GP Invoiced", "Aug NSB Backlog", "Aug GP Backlog",
      "", "Q3 NSB Inv. + Backl."],
    ["", "", "", "Test Manager", "ADOBE", "", "",
      719488, 100, 0, 0, 17054, 20, 91899, 30, 0, 0, 538, 10, "", 828979],
    ["", "", "", "Test Manager", "ACRONIS", "", "",
      30056, 500, 0, 0, 0, 0, 25310, 600, 0, 0, 0, 0, "", 55366],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Monthly Details");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const reloaded = XLSX.read(buffer, { type: "buffer" });
  return XLSX.utils.sheet_to_json<unknown[]>(reloaded.Sheets["Monthly Details"], {
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
