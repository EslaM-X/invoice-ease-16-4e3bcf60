import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, FlaskConical, ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  computeSuggestions,
  type DeliveryMode,
  type FInvoice, type FInvItem, type FDeliveredRow,
  type FProductRow, type FPOItemRow, type FPORow,
  type Suggestion,
} from "@/lib/fulfillment-engine";
import { buildNoteWithPart } from "@/lib/product-parts";

export const Route = createFileRoute("/fulfillment-tests")({
  component: () => (
    <AppShell>
      <FulfillmentTestsPage />
    </AppShell>
  ),
});

// ---------- helpers to build synthetic input ----------
const baseInv = (id: string, num: string, total = 1000): FInvoice => ({
  id, invoice_number: num, customer_name: "Test", customer_phone: null,
  total, created_at: "2026-01-01T00:00:00Z", delivery_status: null,
});
const item = (id: string, invoice_id: string, product_id: string | null, product_name: string, quantity: number): FInvItem => ({
  id, invoice_id, product_id, product_name, serial_number: null, color: null, quantity, unit_price: 100,
});
const prod = (id: string, name: string, stock: number): FProductRow => ({
  id, name, stock_quantity: stock, serial_number: null, color: null,
});
const drRow = (invoice_item_id: string, quantity: number, note: string | null = null): FDeliveredRow => ({ invoice_item_id, quantity, note });

type TestCase = {
  name: string;
  mode: DeliveryMode;
  input: Parameters<typeof computeSuggestions>[0];
  expect: (out: Suggestion[]) => { pass: boolean; detail: string };
};

const MIXER_NAME = "WALL MOUNTED TWO HOLE BASIN MIXER chrome";

function makeCases(): TestCase[] {
  const products = new Map<string, FProductRow>();
  const noPO: FPOItemRow[] = [];
  const noPOs = new Map<string, FPORow>();

  return [
    {
      name: "Simple invoice fully coverable from stock → now_full",
      mode: "any",
      input: {
        invoices: [baseInv("i1", "INV-1")],
        items: [item("it1", "i1", "p1", "Tap A", 2)],
        deliveredRows: [],
        products: new Map([["p1", prod("p1", "Tap A", 5)]]),
        poItems: noPO, pos: noPOs, mode: "any",
      },
      expect: (out) => {
        const s = out.find((x) => x.invoice.id === "i1")!;
        return { pass: !!s && s.tier === "now_full" && s.totalFromStock === 2, detail: `tier=${s?.tier} stock=${s?.totalFromStock}` };
      },
    },
    {
      name: "Manual line (no product_id) never blocks closure",
      mode: "any",
      input: {
        invoices: [baseInv("i2", "INV-2")],
        items: [item("it2a", "i2", null, "Shipping fee", 1), item("it2b", "i2", "p2", "Tap B", 1)],
        deliveredRows: [],
        products: new Map([["p2", prod("p2", "Tap B", 1)]]),
        poItems: noPO, pos: noPOs, mode: "any",
      },
      expect: (out) => {
        const s = out.find((x) => x.invoice.id === "i2")!;
        return { pass: s?.tier === "now_full" && s.manualCount === 1, detail: `tier=${s?.tier} manual=${s?.manualCount}` };
      },
    },
    {
      name: "Mixer-only delivered, mode=any → remaining decremented",
      mode: "any",
      input: {
        invoices: [baseInv("i3", "INV-3")],
        items: [item("it3", "i3", "p3", MIXER_NAME, 1)],
        deliveredRows: [drRow("it3", 1, buildNoteWithPart("mixer", ""))],
        products: new Map([["p3", prod("p3", MIXER_NAME, 0)]]),
        poItems: noPO, pos: noPOs, mode: "any",
      },
      expect: (out) => {
        const s = out.find((x) => x.invoice.id === "i3")!;
        // delivered=1, qty=1 → remaining=0, considered fully delivered
        return { pass: s?.tier === "now_full" && s.totalNeeded === 0, detail: `tier=${s?.tier} need=${s?.totalNeeded}` };
      },
    },
    {
      name: "Mixer-only delivered, mode=strict_full → still blocked (no stock)",
      mode: "strict_full",
      input: {
        invoices: [baseInv("i4", "INV-4")],
        items: [item("it4", "i4", "p4", MIXER_NAME, 1)],
        deliveredRows: [drRow("it4", 1, buildNoteWithPart("mixer", ""))],
        products: new Map([["p4", prod("p4", MIXER_NAME, 0)]]),
        poItems: noPO, pos: noPOs, mode: "strict_full",
      },
      expect: (out) => {
        const s = out.find((x) => x.invoice.id === "i4")!;
        return { pass: s?.tier === "blocked" && s.totalNeeded === 1, detail: `tier=${s?.tier} need=${s?.totalNeeded}` };
      },
    },
    {
      name: "Both mixer + trim delivered, mode=strict_full → fully closed",
      mode: "strict_full",
      input: {
        invoices: [baseInv("i5", "INV-5")],
        items: [item("it5", "i5", "p5", MIXER_NAME, 1)],
        deliveredRows: [
          drRow("it5", 1, buildNoteWithPart("mixer", "")),
          drRow("it5", 1, buildNoteWithPart("trim", "")),
        ],
        products: new Map([["p5", prod("p5", MIXER_NAME, 0)]]),
        poItems: noPO, pos: noPOs, mode: "strict_full",
      },
      expect: (out) => {
        const s = out.find((x) => x.invoice.id === "i5")!;
        return { pass: s?.tier === "now_full" && s.totalNeeded === 0, detail: `tier=${s?.tier} need=${s?.totalNeeded}` };
      },
    },
    {
      name: "Mixer delivered, mode=mixer_ok → counts as full",
      mode: "mixer_ok",
      input: {
        invoices: [baseInv("i6", "INV-6")],
        items: [item("it6", "i6", "p6", MIXER_NAME, 1)],
        deliveredRows: [drRow("it6", 1, buildNoteWithPart("mixer", ""))],
        products: new Map([["p6", prod("p6", MIXER_NAME, 0)]]),
        poItems: noPO, pos: noPOs, mode: "mixer_ok",
      },
      expect: (out) => {
        const s = out.find((x) => x.invoice.id === "i6")!;
        return { pass: s?.tier === "now_full" && s.totalNeeded === 0, detail: `tier=${s?.tier} need=${s?.totalNeeded}` };
      },
    },
    {
      name: "Mixer delivered, mode=trim_ok → still blocked",
      mode: "trim_ok",
      input: {
        invoices: [baseInv("i7", "INV-7")],
        items: [item("it7", "i7", "p7", MIXER_NAME, 1)],
        deliveredRows: [drRow("it7", 1, buildNoteWithPart("mixer", ""))],
        products: new Map([["p7", prod("p7", MIXER_NAME, 0)]]),
        poItems: noPO, pos: noPOs, mode: "trim_ok",
      },
      expect: (out) => {
        const s = out.find((x) => x.invoice.id === "i7")!;
        return { pass: s?.tier === "blocked" && s.totalNeeded === 1, detail: `tier=${s?.tier} need=${s?.totalNeeded}` };
      },
    },
    {
      name: "No double-allocation: 1 stock, 2 invoices wanting 1 each → only one now_full",
      mode: "any",
      input: {
        invoices: [baseInv("i8a", "INV-8A"), baseInv("i8b", "INV-8B", 500)],
        items: [item("it8a", "i8a", "p8", "Tap C", 1), item("it8b", "i8b", "p8", "Tap C", 1)],
        deliveredRows: [],
        products: new Map([["p8", prod("p8", "Tap C", 1)]]),
        poItems: noPO, pos: noPOs, mode: "any",
      },
      expect: (out) => {
        const a = out.find((x) => x.invoice.id === "i8a")!;
        const b = out.find((x) => x.invoice.id === "i8b")!;
        const fulls = [a, b].filter((x) => x.tier === "now_full").length;
        return { pass: fulls === 1, detail: `now_full count=${fulls} (a=${a?.tier} b=${b?.tier})` };
      },
    },
    {
      name: "Incoming PO covers shortfall → incoming_full",
      mode: "any",
      input: {
        invoices: [baseInv("i9", "INV-9")],
        items: [item("it9", "i9", "p9", "Tap D", 3)],
        deliveredRows: [],
        products: new Map([["p9", prod("p9", "Tap D", 1)]]),
        poItems: [{ po_id: "po1", product_id: "p9", quantity: 5, received_qty: 0 }],
        pos: new Map([["po1", { id: "po1", po_number: "PO-1", status: "ordered", expected_arrival_at: "2026-02-01" }]]),
        mode: "any",
      },
      expect: (out) => {
        const s = out.find((x) => x.invoice.id === "i9")!;
        return { pass: s?.tier === "incoming_full" && s.totalFromIncoming === 2, detail: `tier=${s?.tier} inc=${s?.totalFromIncoming}` };
      },
    },
    {
      name: "received_qty reduces incoming pool (no double-count)",
      mode: "any",
      input: {
        invoices: [baseInv("i10", "INV-10")],
        items: [item("it10", "i10", "p10", "Tap E", 5)],
        deliveredRows: [],
        products: new Map([["p10", prod("p10", "Tap E", 0)]]),
        // PO has 5 ordered, 5 already received → 0 remaining in incoming pool
        poItems: [{ po_id: "po2", product_id: "p10", quantity: 5, received_qty: 5 }],
        pos: new Map([["po2", { id: "po2", po_number: "PO-2", status: "in_warehouse", expected_arrival_at: null }]]),
        mode: "any",
      },
      expect: (out) => {
        const s = out.find((x) => x.invoice.id === "i10")!;
        return { pass: s?.tier === "blocked", detail: `tier=${s?.tier} inc=${s?.totalFromIncoming}` };
      },
    },
  ];
}

function FulfillmentTestsPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  const results = useMemo(() => {
    return makeCases().map((c) => {
      let pass = false; let detail = ""; let error: string | null = null;
      try {
        const out = computeSuggestions(c.input);
        const r = c.expect(out);
        pass = r.pass; detail = r.detail;
      } catch (e: any) {
        error = e?.message ?? String(e);
      }
      return { name: c.name, mode: c.mode, pass, detail, error };
    });
  }, []);

  const passCount = results.filter((r) => r.pass && !r.error).length;
  const total = results.length;

  return (
    <div className="space-y-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FlaskConical className="h-6 w-6 text-primary" />
            {isAr ? "اختبارات فلتر الإقفال الذكي" : "Smart Fulfillment Tests"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAr
              ? "حالات حافة على وضعيات التسليم (مكسر/ظاهر/كامل) والبنود اليدوية والمخزون والشحنات."
              : "Edge cases for delivery modes (mixer/trim/full), manual items, stock and incoming POs."}
          </p>
        </div>
        <Link to="/fulfillment">
          <Button variant="outline" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {isAr ? "رجوع" : "Back"}
          </Button>
        </Link>
      </div>

      <Card className={`p-4 ${passCount === total ? "border-emerald-500/40 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/5"}`}>
        <div className="flex items-center justify-between">
          <div className="font-semibold">
            {isAr ? "النتيجة" : "Result"}: {passCount} / {total} {isAr ? "نجاح" : "passing"}
          </div>
          {passCount === total
            ? <Badge className="bg-emerald-600 text-white">{isAr ? "كل الاختبارات ناجحة" : "All tests passing"}</Badge>
            : <Badge variant="destructive">{isAr ? "يوجد فشل" : "Failures present"}</Badge>}
        </div>
      </Card>

      <div className="space-y-2">
        {results.map((r, i) => (
          <Card key={i} className={`p-3 ${r.pass && !r.error ? "border-emerald-500/30" : "border-rose-500/40 bg-rose-500/5"}`}>
            <div className="flex items-start gap-3">
              {r.pass && !r.error
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{r.name}</span>
                  <Badge variant="outline" className="text-[10px]">mode={r.mode}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{r.error ? `error: ${r.error}` : r.detail}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
