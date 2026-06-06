/**
 * Generic, scale-safe Excel + PDF exporters for critical lists.
 * Handles 10,000+ rows without truncation by writing every row.
 */
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ExportColumn<T> = {
  header: string;
  /** Raw cell value (number/string/Date). Use formatter for display in PDF. */
  value: (row: T) => string | number | null | undefined;
  /** Excel column width in chars (default 18). */
  width?: number;
  /** Optional PDF-only formatter (e.g. money). Defaults to String(value). */
  pdf?: (row: T) => string;
};

function safeFileBase(name: string) {
  return name.replace(/[^a-zA-Z0-9_\-]+/g, "_").slice(0, 80);
}

export function exportRowsToExcel<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  opts: { fileName: string; sheetName?: string; title?: string },
) {
  const sheetName = (opts.sheetName ?? "Data").slice(0, 31);
  const aoa: any[][] = [];
  if (opts.title) {
    aoa.push([opts.title]);
    aoa.push([`Exported ${new Date().toISOString()}`, `Rows: ${rows.length}`]);
    aoa.push([]);
  }
  aoa.push(columns.map((c) => c.header));
  for (const r of rows) {
    aoa.push(columns.map((c) => {
      const v = c.value(r);
      return v == null ? "" : v;
    }));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((c) => ({ wch: c.width ?? 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${safeFileBase(opts.fileName)}_${date}.xlsx`);
}

export function exportRowsToPDF<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  opts: { fileName: string; title?: string; orientation?: "p" | "l" },
) {
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: opts.orientation ?? "l" });
  const pageW = pdf.internal.pageSize.getWidth();
  if (opts.title) {
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "bold");
    pdf.text(opts.title, 40, 40);
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(120);
    pdf.text(`Exported ${new Date().toISOString()}  •  ${rows.length} rows`, 40, 56);
    pdf.setTextColor(0);
  }
  const head = [columns.map((c) => c.header)];
  const body = rows.map((r) =>
    columns.map((c) => (c.pdf ? c.pdf(r) : String(c.value(r) ?? ""))),
  );
  autoTable(pdf, {
    head,
    body,
    startY: opts.title ? 70 : 40,
    styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 24, right: 24 },
    didDrawPage: (data) => {
      const str = `Page ${(pdf as any).internal.getNumberOfPages()}`;
      pdf.setFontSize(8);
      pdf.setTextColor(150);
      pdf.text(str, pageW - 60, pdf.internal.pageSize.getHeight() - 16);
      pdf.setTextColor(0);
    },
  });
  const date = new Date().toISOString().slice(0, 10);
  pdf.save(`${safeFileBase(opts.fileName)}_${date}.pdf`);
}
