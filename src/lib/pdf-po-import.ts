// Client-side PDF parser for supplier invoices.
// Extracts { sku, quantity } pairs from invoice line items.
// Tested against Zoho-style tax invoices (SKU : STM-XX-XXXX-XXX + "N.NN pcs").

import * as pdfjsLib from "pdfjs-dist";
// Bundle worker through Vite so it works in production
// @ts-ignore - ?url import is a Vite feature
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Configure worker once
(pdfjsLib as any).GlobalWorkerOptions.workerSrc = workerUrl;

export type ParsedPdfLine = {
  sku: string;
  quantity: number;
};

export type ParsedPdf = {
  lines: ParsedPdfLine[];
  rawText: string;
};

// Matches SKU lines like "SKU : STM-50-M605-001" or "SKU: STM-60-M-500-004"
const SKU_RE = /SKU\s*:\s*(STM-[A-Z0-9\-]+?)(?=\s|$)/gi;
// Matches qty lines like "10.00" right next to "pcs" or as the first numeric column.
// Sample rows: "  1    NAME...   10.00   118.35   1,183.50   1,183.50"
// We use the "pcs" marker (present in every Zoho invoice we tested) as anchor.
const QTY_PCS_RE = /(\d+(?:\.\d+)?)\s*pcs/gi;

/**
 * Parse a supplier invoice PDF into { sku, quantity } pairs.
 * Returns one entry per item line in the order they appear in the PDF.
 */
export async function parseSupplierInvoicePdf(file: File): Promise<ParsedPdf> {
  const buf = await file.arrayBuffer();
  const pdf = await (pdfjsLib as any).getDocument({ data: buf }).promise;

  // Collect text PER ITEM-BLOCK by joining strings with newlines preserving
  // vertical ordering. pdf.js gives us items in roughly visual order.
  let rawText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let lastY: number | null = null;
    for (const it of tc.items as any[]) {
      const y = it.transform?.[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) rawText += "\n";
      else rawText += " ";
      rawText += it.str;
      lastY = y;
    }
    rawText += "\n\n";
  }

  // Strategy: split rawText into blocks separated by SKU occurrences.
  // For each block, find the FIRST "N.NN pcs" before the next SKU.
  // If no "pcs" anchor is found, fall back to the first stand-alone number
  // immediately following the row index.
  const skuMatches: { sku: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  const skuRe = new RegExp(SKU_RE.source, "gi");
  while ((m = skuRe.exec(rawText)) !== null) {
    skuMatches.push({ sku: m[1].toUpperCase(), idx: m.index });
  }

  // For each SKU, look for the CLOSEST "N pcs" occurrence in a window
  // that spans from the previous SKU to AFTER this SKU (some PDFs put qty
  // before the SKU, others after — depending on extraction order).
  const lines: ParsedPdfLine[] = [];
  for (let i = 0; i < skuMatches.length; i++) {
    const prevEnd = i === 0 ? 0 : skuMatches[i - 1].idx + 20;
    const nextStart = i + 1 < skuMatches.length ? skuMatches[i + 1].idx : rawText.length;
    const here = skuMatches[i].idx;
    const window = rawText.slice(prevEnd, nextStart);
    const qtyRe = new RegExp(QTY_PCS_RE.source, "gi");
    let bestQty: number | null = null;
    let bestDist = Infinity;
    let qm: RegExpExecArray | null;
    while ((qm = qtyRe.exec(window)) !== null) {
      const absIdx = prevEnd + qm.index;
      const dist = Math.abs(absIdx - here);
      if (dist < bestDist) {
        bestDist = dist;
        bestQty = parseFloat(qm[1]);
      }
    }
    if (bestQty === null || !Number.isFinite(bestQty) || bestQty <= 0) continue;
    const sku = skuMatches[i].sku;
    const existing = lines.find((l) => l.sku === sku);
    if (existing) existing.quantity += Math.round(bestQty);
    else lines.push({ sku, quantity: Math.round(bestQty) });
  }


  return { lines, rawText };
}
