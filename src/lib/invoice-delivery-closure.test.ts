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

  it("requires both signed mixer and trim parts before closing multipart products", () => {
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
});