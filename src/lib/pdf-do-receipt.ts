// Client-side parser for supplier Delivery Order (D.O.) PDFs.
// These are receipt documents (not invoices) — typically a table with columns:
//   S.NO | ITEM,NO | SUPPLIER NO. | ITEM | P. DESCRIPTION | DELIVERED
// where SUPPLIER NO. lists one or more serials like:
//   STM-50-M611-005
//   STM-40-M501-003 + STM-40-M501-004 + STM-40-M501-001
//   STM-70-M500-002 + STM-60-M500-009 2PCS. + STM-60-M500-001
// Quantity rule: if a SKU is followed by "NPCS." (where N is a number),
// quantity = N. Otherwise quantity = 1.
//
// We dynamic-import pdfjs to avoid SSR `DOMMatrix is not defined` failures.

export type ParsedDOLine = { sku: string; quantity: number };
export type ParsedDO = {
  fileName: string;
  lines: ParsedDOLine[];
  rawText: string;
  error?: string;
};

const SKU_QTY_RE =
  /(STM-[A-Z0-9]+-[A-Z0-9]+-[0-9]{3,4})(?:\s*(?:\(\s*)?(\d+)\s*PCS\.?)?/gi;

/** Parse a single D.O. PDF and return all { sku, quantity } entries (deduplicated). */
export async function parseDOReceiptPdf(file: File): Promise<ParsedDO> {
  try {
    const pdfjsLib: any = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url" as any))
      .default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

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

    const counts = new Map<string, number>();
    let m: RegExpExecArray | null;
    const re = new RegExp(SKU_QTY_RE.source, "gi");
    while ((m = re.exec(rawText)) !== null) {
      const sku = m[1].toUpperCase();
      const qty = m[2] ? Math.max(1, parseInt(m[2], 10)) : 1;
      counts.set(sku, (counts.get(sku) ?? 0) + qty);
    }

    const lines: ParsedDOLine[] = Array.from(counts.entries()).map(
      ([sku, quantity]) => ({ sku, quantity }),
    );
    return { fileName: file.name, lines, rawText };
  } catch (e: any) {
    return {
      fileName: file.name,
      lines: [],
      rawText: "",
      error: e?.message || "PDF parse failed",
    };
  }
}

/** Parse multiple PDFs in parallel with a small concurrency cap. */
export async function parseDOReceiptPdfs(
  files: File[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 4,
): Promise<ParsedDO[]> {
  const results: ParsedDO[] = new Array(files.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= files.length) return;
      results[idx] = await parseDOReceiptPdf(files[idx]);
      done++;
      onProgress?.(done, files.length);
    }
  });
  await Promise.all(workers);
  return results;
}
