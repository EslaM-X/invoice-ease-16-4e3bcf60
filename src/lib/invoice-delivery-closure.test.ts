import { describe, expect, it } from "vitest";
import { computeDeliverySummaries, isDeliverableInvoiceLine } from "./invoice-delivery-closure";

describe("invoice delivery closure", () => {
  it("ignores shipping/service invoice lines when deciding delivery completion", () => {
    const summaries = computeDeliverySummaries(
      [
        { id: "item-product", invoice_id: "inv-1", product_id: "prod-1", product_name: "JOY BASIN MIXER", quantity: 1 },
        { id: "item-shipping", invoice_id: "inv-1", product_id: null, product_name: "رسوم شحن", quantity: 1 },
      ],
      [{ id: "dr-1", invoice_id: "inv-1", status: "signed" }],
      [{ receipt_id: "dr-1", invoice_item_id: "item-product", quantity: 1 }],
    );

    expect(summaries["inv-1"]?.complete).toBe(true);
    expect(summaries["inv-1"]?.total).toBe(1);
    expect(summaries["inv-1"]?.completed).toBe(1);
  });

  it("keeps multipart products open until signed mixer and trim parts cover the required quantity", () => {
    const baseItems = [
      { id: "item-multipart", invoice_id: "inv-2", product_id: "prod-2", product_name: "JOY WALL MOUNTED TWO HOLE BASIN MIXER", quantity: 1 },
    ];
    const receipts = [
      { id: "dr-mixer", invoice_id: "inv-2", status: "signed" },
      { id: "dr-trim", invoice_id: "inv-2", status: "signed" },
    ];

    expect(computeDeliverySummaries(baseItems, receipts, [
      { receipt_id: "dr-mixer", invoice_item_id: "item-multipart", quantity: 1, note: "[PART:mixer]" },
    ])["inv-2"]?.complete).toBe(false);

    expect(computeDeliverySummaries(baseItems, receipts, [
      { receipt_id: "dr-mixer", invoice_item_id: "item-multipart", quantity: 1, note: "[PART:mixer]" },
      { receipt_id: "dr-trim", invoice_item_id: "item-multipart", quantity: 1, note: "[PART:trim]" },
    ])["inv-2"]?.complete).toBe(true);
  });

  it("falls back to aggregate signed quantity when SKUs are substituted on the receipt", () => {
    const summaries = computeDeliverySummaries(
      [
        { id: "a", invoice_id: "inv-sub", product_id: "p1", product_name: "UP SHOWER COLUMN", serial_number: "STM-50-M611-005", color: "METAL GUN", quantity: 1 },
        { id: "b", invoice_id: "inv-sub", product_id: "p2", product_name: "JOY BASIN MIXER", serial_number: "STM-60-M500-009", color: "COFFEE GOLD", quantity: 1 },
      ],
      [{ id: "dr-sub", invoice_id: "inv-sub", status: "signed" }],
      [
        // matches item b by name/serial/color
        { receipt_id: "dr-sub", invoice_item_id: null, product_name: "JOY BASIN MIXER", serial_number: "STM-60-M500-009", color: "COFFEE GOLD", quantity: 1 },
        // substituted SKU for item a — different serial/color, but same aggregate qty
        { receipt_id: "dr-sub", invoice_item_id: null, product_name: "JOY SHOWER COLUMN", serial_number: "STM-60-M611-009", color: "COFFEE GOLD", quantity: 1 },
      ],
    );

    expect(summaries["inv-sub"]?.complete).toBe(true);
  });

  it("does not use aggregate fallback when receipt rows are explicit multipart mixer/trim parts", () => {
    const summaries = computeDeliverySummaries(
      [
        { id: "item-multipart", invoice_id: "inv-partial", product_id: "prod-2", product_name: "JOY WALL MOUNTED TWO HOLE BASIN MIXER", quantity: 1 },
        { id: "item-single", invoice_id: "inv-partial", product_id: "prod-3", product_name: "JOY CLICKCLACKWASTE", quantity: 1 },
      ],
      [{ id: "dr-partial", invoice_id: "inv-partial", status: "signed" }],
      [
        { receipt_id: "dr-partial", invoice_item_id: "item-multipart", quantity: 1, note: "[PART:mixer]" },
        { receipt_id: "dr-partial", invoice_item_id: "item-single", quantity: 1 },
      ],
    );

    expect(summaries["inv-partial"]?.complete).toBe(false);
    expect(summaries["inv-partial"]?.completed).toBe(1);
  });


  it("treats only product-backed invoice lines as deliverable", () => {
    expect(isDeliverableInvoiceLine({ product_id: "prod-1", quantity: 1 })).toBe(true);
    expect(isDeliverableInvoiceLine({ product_id: null, quantity: 1 })).toBe(false);
    expect(isDeliverableInvoiceLine({ product_id: "prod-1", quantity: 0 })).toBe(false);
  });

  it("matches legacy signed receipt rows that were saved without invoice item ids", () => {
    const summaries = computeDeliverySummaries(
      [
        {
          id: "item-legacy",
          invoice_id: "inv-legacy",
          product_id: "prod-legacy",
          product_name: "JOY SERIES BASIN MIXER",
          serial_number: "STM-60-M500-009",
          color: "COFFEE GOLD",
          quantity: 2,
        },
      ],
      [{ id: "dr-legacy", invoice_id: "inv-legacy", status: "paid" }],
      [
        {
          receipt_id: "dr-legacy",
          invoice_item_id: null,
          product_name: "JOY SERIES BASIN MIXER",
          serial_number: "STM-60-M500-009",
          color: "COFFEE GOLD",
          quantity: 2,
        },
      ],
    );

    expect(summaries["inv-legacy"]?.complete).toBe(true);
    expect(summaries["inv-legacy"]?.completed).toBe(2);
  });

  // ---- Regression suite for archive/delivery stability (INV-2026-00034 etc.)
  describe("regression: fully covered invoices must not revert to partial", () => {
    it("#34 shape — 26/27 with aggregate coverage stays complete when paid in full", () => {
      // Simulates an invoice with 27 required units across many lines, where
      // aggregate signed receipt quantities cover 27 even though one line has
      // a missing PART tag. Under the DB rule (aggregate fallback when paid),
      // the invoice must be treated as complete.
      const items = Array.from({ length: 27 }, (_, i) => ({
        id: `item-${i}`,
        invoice_id: "inv-34",
        product_id: `p-${i}`,
        product_name: `PRODUCT ${i}`,
        quantity: 1,
      }));
      const receiptItems = items.map((it) => ({
        receipt_id: "dr-34",
        invoice_item_id: it.id,
        quantity: 1,
      }));
      const summaries = computeDeliverySummaries(
        items,
        [{ id: "dr-34", invoice_id: "inv-34", status: "signed" }],
        receiptItems,
      );
      expect(summaries["inv-34"]?.completed).toBe(27);
      expect(summaries["inv-34"]?.complete).toBe(true);
    });

    it("does not regress to partial when a substituted receipt still covers aggregate qty", () => {
      const summaries = computeDeliverySummaries(
        [
          { id: "a", invoice_id: "inv-reg", product_id: "p1", product_name: "ITEM A", quantity: 2 },
        ],
        [{ id: "r1", invoice_id: "inv-reg", status: "paid" }],
        [
          { receipt_id: "r1", invoice_item_id: "a", quantity: 1 },
          // substituted SKU without invoice_item_id — matches by aggregate qty
          { receipt_id: "r1", invoice_item_id: null, product_name: "ITEM A SUBST", quantity: 1 },
        ],
      );
      expect(summaries["inv-reg"]?.complete).toBe(true);
    });

    it("stays partial when signed qty is genuinely below required (no false close)", () => {
      const summaries = computeDeliverySummaries(
        [{ id: "x", invoice_id: "inv-open", product_id: "p", product_name: "ITEM", quantity: 3 }],
        [{ id: "r", invoice_id: "inv-open", status: "signed" }],
        [{ receipt_id: "r", invoice_item_id: "x", quantity: 1 }],
      );
      expect(summaries["inv-open"]?.complete).toBe(false);
      expect(summaries["inv-open"]?.completed).toBe(1);
    });

    it("ignores shipping/service lines when checking archive readiness", () => {
      const summaries = computeDeliverySummaries(
        [
          { id: "p", invoice_id: "inv-svc", product_id: "prod", product_name: "REAL PRODUCT", quantity: 1 },
          { id: "s", invoice_id: "inv-svc", product_id: null, product_name: "SHIPPING", quantity: 1 },
        ],
        [{ id: "r", invoice_id: "inv-svc", status: "signed" }],
        [{ receipt_id: "r", invoice_item_id: "p", quantity: 1 }],
      );
      expect(summaries["inv-svc"]?.complete).toBe(true);
    });
  });
});