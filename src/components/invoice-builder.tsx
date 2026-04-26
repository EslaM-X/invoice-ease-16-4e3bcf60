import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import type { Customer, Product } from "@/lib/data";
import { fmtMoney } from "@/lib/utils-money";
import { QrScanner } from "@/components/qr-scanner";
import { useRealtimeTable } from "@/lib/realtime";

export type BuilderItem = {
  product_id: string | null;
  product_name: string;
  serial_number: string;
  color: string;
  quantity: number;
  unit_price: number;
  discount: number;
  /** UI-only: how the user entered the discount. Persisted EGP value lives in `discount`. */
  discount_mode?: "amount" | "percent";
  /** UI-only: raw percent value when mode === "percent" */
  discount_percent?: number;
};

type Props = {
  mode: "new" | "edit";
  invoiceId?: string;
  initial?: {
    customerId: string;
    items: BuilderItem[];
    discount: number;
    notes: string;
  } | null;
  /** open scanner immediately on mount */
  autoScan?: boolean;
  /** persist drafts under this key (only for new mode) */
  draftKey?: string;
};

export function InvoiceBuilder({ mode, invoiceId, initial, autoScan, draftKey }: Props) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customerId, setCustomerId] = useState<string>(initial?.customerId ?? "");
  const [items, setItems] = useState<BuilderItem[]>(initial?.items ?? []);
  const [discount, setDiscount] = useState<number>(initial?.discount ?? 0);
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("percent");
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [notes, setNotes] = useState<string>(initial?.notes ?? "");
  const [scanning, setScanning] = useState(false);
  const [continuous, setContinuous] = useState(true);
  const [productSearch, setProductSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftRecovered, setDraftRecovered] = useState<{ savedAt: string } | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", address: "" });
  const [savingCustomer, setSavingCustomer] = useState(false);
  const draftLoaded = useRef(false);
  const beepCtx = useRef<AudioContext | null>(null);

  // Load customers/products (RLS handles company-wide visibility)
  const loadLists = async () => {
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("products").select("*").order("name"),
    ]);
    setCustomers((c ?? []) as Customer[]);
    setProducts((p ?? []) as Product[]);
  };
  useEffect(() => {
    if (!user) return;
    loadLists();
  }, [user]);
  useRealtimeTable("customers", () => { loadLists(); });
  useRealtimeTable("products", () => { loadLists(); });

  // Hydrate draft only in new mode
  useEffect(() => {
    if (mode !== "new" || !draftKey || draftLoaded.current) return;
    draftLoaded.current = true;
    if (initial) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.items?.length) {
          setItems(d.items);
          setCustomerId(d.customerId || "");
          setDiscount(d.discount || 0);
          setNotes(d.notes || "");
          setDraftRecovered({ savedAt: d.savedAt || new Date().toISOString() });
        }
      }
    } catch {}
  }, [mode, draftKey, initial]);

  useEffect(() => {
    if (mode !== "new" || !draftKey) return;
    const id = setTimeout(() => {
      if (items.length || customerId || notes) {
        localStorage.setItem(draftKey, JSON.stringify({ customerId, items, discount, notes, savedAt: new Date().toISOString() }));
      }
    }, 500);
    return () => clearTimeout(id);
  }, [mode, draftKey, customerId, items, discount, notes]);

  // Auto-open scanner
  useEffect(() => {
    if (autoScan) setScanning(true);
  }, [autoScan]);

  // Keyboard shortcut: S to scan, Ctrl/Cmd+Enter to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (!inField && (e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setScanning(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, customerId, discount, notes]);

  const customer = customers.find((c) => c.id === customerId);

  const beep = () => {
    try {
      if (!beepCtx.current) beepCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = beepCtx.current!;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.13);
    } catch {}
  };

  const addProduct = (p: Product) => {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.product_id === p.id);
      if (idx >= 0) {
        const next = prev.slice();
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          product_id: p.id,
          product_name: p.name,
          serial_number: p.serial_number ?? "",
          color: p.color ?? "",
          quantity: 1,
          unit_price: Number(p.price),
          discount: 0,
          discount_mode: "percent",
          discount_percent: 0,
        },
      ];
    });
    setShowPicker(false);
    setProductSearch("");
  };

  const handleScan = async (text: string) => {
    const raw = (text ?? "").trim();
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
    const { data: p, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .maybeSingle();
    if (error || !p) {
      toast.error(lang === "ar" ? "رمز QR غير صالح" : "Invalid QR Code");
      return;
    }
    beep();
    addProduct(p as Product);
    toast.success(p.name);
    if (!continuous) setScanning(false);
  };

  const updateItem = (idx: number, patch: Partial<BuilderItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  /** Set item discount as a percentage of (qty * unit_price). */
  const setItemDiscountPercent = (idx: number, pct: number) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const clamped = Math.max(0, Math.min(100, pct || 0));
        const base = it.quantity * it.unit_price;
        return { ...it, discount_mode: "percent", discount_percent: clamped, discount: +((base * clamped) / 100).toFixed(2) };
      }),
    );
  };

  /** Switch an item between amount and percent discount modes. */
  const setItemDiscountMode = (idx: number, mode: "amount" | "percent") => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        if (mode === "percent") {
          const base = it.quantity * it.unit_price;
          const pct = base > 0 ? +((it.discount / base) * 100).toFixed(2) : 0;
          return { ...it, discount_mode: "percent", discount_percent: Math.min(100, pct) };
        }
        return { ...it, discount_mode: "amount", discount_percent: undefined };
      }),
    );
  };

  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price - it.discount, 0);

  // Keep global discount EGP in sync when in percent mode
  useEffect(() => {
    if (discountMode === "percent") {
      const v = Math.max(0, Math.min(100, discountPercent || 0));
      setDiscount(+((subtotal * v) / 100).toFixed(2));
    }
  }, [discountMode, discountPercent, subtotal]);

  // Recompute item EGP discount when qty / unit price change while in percent mode
  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const next = prev.map((it) => {
        if (it.discount_mode === "percent" && typeof it.discount_percent === "number") {
          const base = it.quantity * it.unit_price;
          const newDisc = +((base * it.discount_percent) / 100).toFixed(2);
          if (Math.abs(newDisc - it.discount) > 0.001) {
            changed = true;
            return { ...it, discount: newDisc };
          }
        }
        return it;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => `${i.quantity}-${i.unit_price}`).join("|")]);

  const total = Math.max(0, subtotal - discount);

  const saveNewCustomer = async () => {
    if (!user || savingCustomer) return;
    const name = newCustomer.name.trim();
    if (!name) return toast.error(t("name"));
    setSavingCustomer(true);
    try {
      const { data, error } = await supabase
        .from("customers")
        .insert({
          user_id: user.id,
          name,
          phone: newCustomer.phone.trim() || null,
          address: newCustomer.address.trim() || null,
        })
        .select()
        .single();
      if (error || !data) {
        toast.error(error?.message ?? "");
        return;
      }
      const created = data as Customer;
      setCustomers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCustomerId(created.id);
      setShowNewCustomer(false);
      setNewCustomer({ name: "", phone: "", address: "" });
      toast.success(t("customer_added"));
    } finally {
      setSavingCustomer(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const s = productSearch.trim().toLowerCase();
    if (!s) return products.slice(0, 50);
    return products
      .filter((p) => p.name.toLowerCase().includes(s) || (p.serial_number ?? "").toLowerCase().includes(s))
      .slice(0, 50);
  }, [products, productSearch]);

  const handleRpcError = (msg: string) => {
    if (msg.includes("OUT_OF_STOCK")) {
      const name = msg.split("OUT_OF_STOCK:")[1]?.split("\n")[0]?.trim() ?? "";
      toast.error(`${t("not_enough_stock")}${name ? `: ${name}` : ""}`);
    } else if (msg.includes("INVALID_PRODUCT")) {
      toast.error(lang === "ar" ? "منتج غير صالح" : "Invalid product");
    } else if (msg.includes("INVALID_CUSTOMER")) {
      toast.error(lang === "ar" ? "عميل غير صالح" : "Invalid customer");
    } else if (msg.includes("NO_ITEMS")) {
      toast.error(t("no_items"));
    } else if (msg.includes("INVOICE_VOIDED")) {
      toast.error(lang === "ar" ? "الفاتورة ملغاة" : "Invoice voided");
    } else if (msg.includes("INVOICE_NOT_FOUND")) {
      toast.error(lang === "ar" ? "الفاتورة غير موجودة" : "Invoice not found");
    } else {
      toast.error(lang === "ar" ? "فشل حفظ الفاتورة" : "Failed to save invoice");
    }
  };

  const save = async () => {
    if (!user || saving) return;
    if (items.length === 0) return toast.error(t("no_items"));

    const payload = items.map((it) => ({
      product_id: it.product_id,
      product_name: it.product_name,
      serial_number: it.serial_number || null,
      color: it.color || null,
      quantity: it.quantity,
      unit_price: it.unit_price,
      discount: it.discount,
    }));

    setSaving(true);
    try {
      if (mode === "edit" && invoiceId) {
        const { data, error } = await supabase.rpc("update_invoice", {
          _invoice_id: invoiceId,
          _customer_id: customer?.id ?? null,
          _discount: discount,
          _notes: notes || null,
          _language: lang,
          _items: payload as any,
        } as any);
        if (error || !data) {
          handleRpcError(error?.message ?? "");
          return;
        }
        toast.success(t("invoice_saved"));
        navigate({ to: "/invoices/$id", params: { id: invoiceId } });
      } else {
        const { data: invoiceIdRet, error } = await supabase.rpc("create_invoice", {
          _customer_id: customer?.id ?? null,
          _discount: discount,
          _notes: notes || null,
          _language: lang,
          _items: payload as any,
        } as any);
        if (error || !invoiceIdRet) {
          handleRpcError(error?.message ?? "");
          return;
        }
        if (draftKey) localStorage.removeItem(draftKey);
        toast.success(t("invoice_saved"));
        navigate({ to: "/invoices/$id", params: { id: invoiceIdRet as string } });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {mode === "edit" ? t("edit_invoice") : t("new_invoice")}
        </h1>
        <Button onClick={save} disabled={saving} className="gap-2 shadow-glow">
          {t("save_invoice")}
        </Button>
      </div>

      {draftRecovered && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <div>
            <span className="font-semibold">{t("draft_recovered")}</span>
            <span className="ms-2 text-muted-foreground tabular-nums">
              {new Date(draftRecovered.savedAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB")}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (draftKey) localStorage.removeItem(draftKey);
              setItems([]); setCustomerId(""); setDiscount(0); setNotes("");
              setDraftRecovered(null);
            }}
          >
            {t("discard_draft")}
          </Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <Label>{t("customer")}</Label>
            <div className="mt-1.5 flex gap-2">
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— {t("select_customer")} —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" className="gap-1 shrink-0" onClick={() => setShowNewCustomer(true)}>
                <Plus className="h-4 w-4" />
                {t("new_customer")}
              </Button>
            </div>
            {customer && (
              <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <div>
                  {t("phone")}: {customer.phone || "—"}
                </div>
                <div>
                  {t("address")}: {customer.address || "—"}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{t("products")}</h3>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-2" onClick={() => setScanning(true)}>
                  <ScanLine className="h-4 w-4" />
                  {t("scan_qr")}
                </Button>
                <Button className="gap-2" onClick={() => setShowPicker(true)}>
                  <Plus className="h-4 w-4" />
                  {t("add_item")}
                </Button>
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
                      <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
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
                         <Input
                           type="number"
                           inputMode="numeric"
                           min={1}
                           value={it.quantity === 0 ? "" : it.quantity}
                           onFocus={(e) => e.target.select()}
                           onChange={(e) => {
                             const v = e.target.value;
                             updateItem(idx, { quantity: v === "" ? 0 : Math.max(1, parseInt(v, 10) || 1) });
                           }}
                         />
                       </div>
                       <div>
                         <Label className="text-xs">{t("unit_price")}</Label>
                         <Input
                           type="number"
                           inputMode="decimal"
                           step="0.01"
                           value={it.unit_price === 0 ? "" : it.unit_price}
                           onFocus={(e) => e.target.select()}
                           onChange={(e) => {
                             const v = e.target.value;
                             updateItem(idx, { unit_price: v === "" ? 0 : Number(v) || 0 });
                           }}
                         />
                       </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">{t("discount")}</Label>
                          <button
                            type="button"
                            onClick={() => setItemDiscountMode(idx, it.discount_mode === "percent" ? "amount" : "percent")}
                            className="text-[10px] font-semibold rounded border px-1.5 py-0.5 hover:bg-muted"
                            title={it.discount_mode === "percent" ? t("discount_amount") : t("discount_percent")}
                          >
                            {it.discount_mode === "percent" ? "%" : "EGP"}
                          </button>
                        </div>
                         {it.discount_mode === "percent" ? (
                           <Input
                             type="number"
                             inputMode="decimal"
                             step="0.01"
                             min={0}
                             max={100}
                             value={!it.discount_percent ? "" : it.discount_percent}
                             onFocus={(e) => e.target.select()}
                             onChange={(e) => {
                               const v = e.target.value;
                               setItemDiscountPercent(idx, v === "" ? 0 : Number(v) || 0);
                             }}
                           />
                         ) : (
                           <Input
                             type="number"
                             inputMode="decimal"
                             step="0.01"
                             value={it.discount === 0 ? "" : it.discount}
                             onFocus={(e) => e.target.select()}
                             onChange={(e) => {
                               const v = e.target.value;
                               updateItem(idx, { discount: v === "" ? 0 : Number(v) || 0, discount_mode: "amount", discount_percent: undefined });
                             }}
                           />
                         )}
                      </div>
                    </div>
                    <div className="mt-2 text-end text-sm font-semibold">
                      {fmtMoney(it.quantity * it.unit_price - it.discount, "EGP", lang)}
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
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("subtotal")}</span>
                <span>{fmtMoney(subtotal, "EGP", lang)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("discount")}</span>
                <div className="flex items-center gap-1">
                  {discountMode === "percent" ? (
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min={0}
                      max={100}
                      value={discountPercent === 0 ? "" : discountPercent}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDiscountPercent(v === "" ? 0 : Number(v) || 0);
                      }}
                      className="w-24 text-end"
                    />
                  ) : (
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={discount === 0 ? "" : discount}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDiscount(v === "" ? 0 : Number(v) || 0);
                      }}
                      className="w-24 text-end"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (discountMode === "amount") {
                        const pct = subtotal > 0 ? +((discount / subtotal) * 100).toFixed(2) : 0;
                        setDiscountPercent(Math.min(100, pct));
                        setDiscountMode("percent");
                      } else {
                        setDiscountMode("amount");
                      }
                    }}
                    className="text-[10px] font-semibold rounded border px-1.5 py-1 hover:bg-muted"
                    title={discountMode === "percent" ? t("discount_amount") : t("discount_percent")}
                  >
                    {discountMode === "percent" ? "%" : "EGP"}
                  </button>
                </div>
              </div>
              {discountMode === "percent" && (
                <div className="text-end text-[11px] text-muted-foreground">
                  = {fmtMoney(discount, "EGP", lang)}
                </div>
              )}
              <div className="border-t pt-2 flex justify-between text-lg font-bold">
                <span>{t("total")}</span>
                <span>{fmtMoney(total, "EGP", lang)}</span>
              </div>
            </div>
            <Button onClick={save} disabled={saving} className="mt-4 w-full shadow-glow">
              {t("save_invoice")}
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {lang === "ar" ? "اختصار: S للماسح، Ctrl/⌘+Enter للحفظ" : "Shortcuts: S = scan, Ctrl/⌘+Enter = save"}
            </p>
          </div>
        </aside>
      </div>

      <Dialog open={showPicker} onOpenChange={setShowPicker}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("select_product")}</DialogTitle>
          </DialogHeader>
          <Input placeholder={t("search")} value={productSearch} onChange={(e) => setProductSearch(e.target.value)} autoFocus />
          <div className="max-h-80 overflow-y-auto divide-y">
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => addProduct(p)}
                className="flex w-full items-center justify-between py-2 text-start hover:bg-muted/50 rounded px-2"
              >
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.serial_number || ""} {p.color ? `· ${p.color}` : ""} · {t("stock")}: {p.stock_quantity}
                  </div>
                </div>
                <div className="font-semibold">{fmtMoney(Number(p.price), "EGP", lang)}</div>
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("no_products")}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={scanning} onOpenChange={setScanning}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("scan_qr")}</DialogTitle>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} />
            <span>{t("continuous_scan")}</span>
          </label>
          {scanning && <QrScanner onScan={handleScan} onClose={() => setScanning(false)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={showNewCustomer} onOpenChange={setShowNewCustomer}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("new_customer")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t("name")}</Label>
              <Input value={newCustomer.name} onChange={(e) => setNewCustomer((s) => ({ ...s, name: e.target.value }))} autoFocus />
            </div>
            <div>
              <Label className="text-xs">{t("phone")}</Label>
              <Input value={newCustomer.phone} onChange={(e) => setNewCustomer((s) => ({ ...s, phone: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">{t("address")}</Label>
              <Input value={newCustomer.address} onChange={(e) => setNewCustomer((s) => ({ ...s, address: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowNewCustomer(false)}>{t("cancel")}</Button>
              <Button onClick={saveNewCustomer} disabled={savingCustomer}>{t("save")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
