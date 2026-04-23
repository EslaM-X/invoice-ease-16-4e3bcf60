import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, ScanLine, X } from "lucide-react";
import { toast } from "sonner";
import type { Customer, Product } from "@/lib/data";
import { fmtMoney } from "@/lib/utils-money";
import { QrScanner } from "@/components/qr-scanner";

export const Route = createFileRoute("/invoices/new")({ component: () => <AppShell><NewInvoice /></AppShell> });

type Item = {
  product_id: string | null;
  product_name: string;
  serial_number: string;
  color: string;
  quantity: number;
  unit_price: number;
  discount: number;
};

const DRAFT_KEY = "invoice_draft_v1";

function NewInvoice() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [items, setItems] = useState<Item[]>([]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [scanning, setScanning] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const draftLoaded = useRef(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: c }, { data: p }] = await Promise.all([
        supabase.from("customers").select("*").eq("user_id", user.id).order("name"),
        supabase.from("products").select("*").eq("user_id", user.id).order("name"),
      ]);
      setCustomers((c ?? []) as Customer[]);
      setProducts((p ?? []) as Product[]);
    })();
  }, [user]);

  // load draft
  useEffect(() => {
    if (draftLoaded.current) return;
    draftLoaded.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.items?.length) {
          setItems(d.items);
          setCustomerId(d.customerId || "");
          setDiscount(d.discount || 0);
          setNotes(d.notes || "");
        }
      }
    } catch {}
  }, []);

  // auto-save draft
  useEffect(() => {
    const id = setTimeout(() => {
      if (items.length || customerId || notes) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ customerId, items, discount, notes }));
      }
    }, 500);
    return () => clearTimeout(id);
  }, [customerId, items, discount, notes]);

  const customer = customers.find((c) => c.id === customerId);

  const addProduct = (p: Product) => {
    setItems((prev) => [
      ...prev,
      {
        product_id: p.id, product_name: p.name,
        serial_number: p.serial_number ?? "", color: p.color ?? "",
        quantity: 1, unit_price: Number(p.price), discount: 0,
      },
    ]);
    setShowPicker(false);
    setProductSearch("");
  };

  const handleScan = async (text: string) => {
    const raw = (text ?? "").trim();
    // Accept either a raw UUID or a JSON payload like {"product_id":"..."}
    let productId: string | null = null;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRe.test(raw)) {
      productId = raw;
    } else {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.product_id === "string" && uuidRe.test(parsed.product_id)) {
          productId = parsed.product_id;
        }
      } catch {}
    }
    if (!productId) {
      toast.error(lang === "ar" ? "رمز QR غير صالح" : "Invalid QR Code");
      return;
    }
    // Strict: always read fresh from DB
    const { data: p, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (error || !p) {
      toast.error(lang === "ar" ? "رمز QR غير صالح" : "Invalid QR Code");
      return;
    }
    addProduct(p as Product);
    setScanning(false);
    toast.success(p.name);
  };

  const updateItem = (idx: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price - it.discount, 0);
  const total = Math.max(0, subtotal - discount);

  const filteredProducts = useMemo(() => {
    const s = productSearch.trim().toLowerCase();
    if (!s) return products.slice(0, 50);
    return products.filter((p) =>
      p.name.toLowerCase().includes(s) || (p.serial_number ?? "").toLowerCase().includes(s)
    ).slice(0, 50);
  }, [products, productSearch]);

  const save = async () => {
    if (!user) return;
    if (items.length === 0) return toast.error(t("no_items"));

    // All business logic runs server-side via RPC (atomic, row-locking, server price snapshot)
    const payload = items.map((it) => ({
      product_id: it.product_id,
      product_name: it.product_name,
      serial_number: it.serial_number || null,
      color: it.color || null,
      quantity: it.quantity,
      unit_price: it.unit_price, // only used for free-form items; ignored for linked products
      discount: it.discount,
    }));

    const { data: invoiceId, error } = await supabase.rpc("create_invoice", {
      _customer_id: customer?.id ?? null,
      _discount: discount,
      _notes: notes || null,
      _language: lang,
      _items: payload as any,
    });

    if (error || !invoiceId) {
      const msg = error?.message ?? "";
      if (msg.includes("OUT_OF_STOCK")) {
        const name = msg.split("OUT_OF_STOCK:")[1]?.split("\n")[0]?.trim() ?? "";
        toast.error(`${t("not_enough_stock")}${name ? `: ${name}` : ""}`);
      } else if (msg.includes("INVALID_PRODUCT")) {
        toast.error(lang === "ar" ? "منتج غير صالح" : "Invalid product");
      } else if (msg.includes("INVALID_CUSTOMER")) {
        toast.error(lang === "ar" ? "عميل غير صالح" : "Invalid customer");
      } else if (msg.includes("NO_ITEMS")) {
        toast.error(t("no_items"));
      } else {
        toast.error(lang === "ar" ? "فشل إنشاء الفاتورة" : "Failed to create invoice");
      }
      return;
    }

    localStorage.removeItem(DRAFT_KEY);
    toast.success(t("invoice_saved"));
    navigate({ to: "/invoices/$id", params: { id: invoiceId as string } });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("new_invoice")}</h1>
        <Button onClick={save} className="gap-2 shadow-glow">{t("save_invoice")}</Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <Label>{t("customer")}</Label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">— {t("select_customer")} —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>
              ))}
            </select>
            {customer && (
              <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <div>{t("phone")}: {customer.phone || "—"}</div>
                <div>{t("address")}: {customer.address || "—"}</div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{t("products")}</h3>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2" onClick={() => setScanning(true)}><ScanLine className="h-4 w-4" />{t("scan_qr")}</Button>
                <Button className="gap-2" onClick={() => setShowPicker(true)}><Plus className="h-4 w-4" />{t("add_item")}</Button>
              </div>
            </div>

            {items.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("no_items")}</div>
            ) : (
              <div className="space-y-3">
                {items.map((it, idx) => (
                  <div key={idx} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{it.product_name}</div>
                      <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <div>
                        <Label className="text-xs">{t("serial_number")}</Label>
                        <Input value={it.serial_number} onChange={(e) => updateItem(idx, { serial_number: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">{t("color")}</Label>
                        <Input value={it.color} onChange={(e) => updateItem(idx, { color: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">{t("quantity")}</Label>
                        <Input type="number" min={1} value={it.quantity} onChange={(e) => updateItem(idx, { quantity: Math.max(1, parseInt(e.target.value || "1", 10)) })} />
                      </div>
                      <div>
                        <Label className="text-xs">{t("unit_price")}</Label>
                        <Input type="number" step="0.01" value={it.unit_price} onChange={(e) => updateItem(idx, { unit_price: Number(e.target.value) || 0 })} />
                      </div>
                      <div>
                        <Label className="text-xs">{t("discount")}</Label>
                        <Input type="number" step="0.01" value={it.discount} onChange={(e) => updateItem(idx, { discount: Number(e.target.value) || 0 })} />
                      </div>
                    </div>
                    <div className="mt-2 text-end text-sm font-semibold">
                      {fmtMoney(it.quantity * it.unit_price - it.discount, "SAR", lang)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <Label>{t("notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1.5" />
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t("subtotal")}</span><span>{fmtMoney(subtotal, "SAR", lang)}</span></div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("discount")}</span>
                <Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} className="w-32 text-end" />
              </div>
              <div className="border-t pt-2 flex justify-between text-lg font-bold">
                <span>{t("total")}</span><span>{fmtMoney(total, "SAR", lang)}</span>
              </div>
            </div>
            <Button onClick={save} className="mt-4 w-full shadow-glow">{t("save_invoice")}</Button>
          </div>
        </aside>
      </div>

      <Dialog open={showPicker} onOpenChange={setShowPicker}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("select_product")}</DialogTitle></DialogHeader>
          <Input placeholder={t("search")} value={productSearch} onChange={(e) => setProductSearch(e.target.value)} autoFocus />
          <div className="max-h-80 overflow-y-auto divide-y">
            {filteredProducts.map((p) => (
              <button key={p.id} onClick={() => addProduct(p)} className="flex w-full items-center justify-between py-2 text-start hover:bg-muted/50 rounded px-2">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.serial_number || ""} {p.color ? `· ${p.color}` : ""} · {t("stock")}: {p.stock_quantity}</div>
                </div>
                <div className="font-semibold">{fmtMoney(Number(p.price), "SAR", lang)}</div>
              </button>
            ))}
            {filteredProducts.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">{t("no_products")}</div>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={scanning} onOpenChange={setScanning}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("scan_qr")}</DialogTitle></DialogHeader>
          {scanning && <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
