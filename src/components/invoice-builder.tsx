import { swatchStyle } from "@/lib/color-swatch";
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
import type { Customer, Product, SalesEvent } from "@/lib/data";
import { COLLECTIONS } from "@/lib/data";
import { CUSTOMER_CATEGORIES, SALES_CHANNELS, labelForCustomerCategory, labelForSalesChannel } from "@/lib/sales-classification";
import { SparePartBadge } from "@/components/spare-part-badge";
import { collectionPillClass, collectionBadgeClass, collectionDotClass } from "@/lib/collection-styles";
import { fmtMoney } from "@/lib/utils-money";
import { QrScanner } from "@/components/qr-scanner";
import { useRealtimeTable } from "@/lib/realtime";
import { DesktopPairWidget } from "@/components/desktop-pair-widget";
import type { ScanEvent } from "@/lib/scan-link";
import { fetchProductCached, setCachedProduct } from "@/lib/product-cache";
import { decodeProductQR } from "@/lib/qr-codec";

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
    system_notes?: string;
    subject?: string | null;
    paid_amount?: number | null;
    delivery_status?: string | null;
    status?: string | null;
    customer_category?: string | null;
    sales_channel?: string | null;
    sales_event_id?: string | null;
    delivery_days?: number | null;
  } | null;
  /** open scanner immediately on mount */
  autoScan?: boolean;
  /** persist drafts under this key (only for new mode) */
  draftKey?: string;
  /** force draft mode for new invoices */
  defaultDraft?: boolean;
};

export function InvoiceBuilder({ mode, invoiceId, initial, autoScan, draftKey, defaultDraft }: Props) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesEvents, setSalesEvents] = useState<SalesEvent[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customerId, setCustomerId] = useState<string>(initial?.customerId ?? "");
  const SERVICE_FEE_NAME = "رسوم شحن";
  const LEGACY_FEE_NAMES = ["رسوم خدمة / Service Fee", "رسوم خدمة", "Service Fee"];
  const isServiceFee = (it: BuilderItem) =>
    it.product_id === null &&
    (it.product_name === SERVICE_FEE_NAME || LEGACY_FEE_NAMES.includes(it.product_name)) &&
    Number(it.unit_price) === 250;
  const defaultFeeItem = (): BuilderItem => ({
    product_id: null,
    product_name: SERVICE_FEE_NAME,
    serial_number: "",
    color: "",
    quantity: 1,
    unit_price: 250,
    discount: 0,
    discount_mode: "amount",
    discount_percent: undefined,
  });
  // رسوم الشحن لم تعد تُضاف تلقائياً — يقدر المستخدم يضيفها يدوياً من زر "إعادة رسوم الشحن".
  const [items, setItems] = useState<BuilderItem[]>(initial?.items ?? []);
  const [discount, setDiscount] = useState<number>(initial?.discount ?? 0);
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">(
    mode === "edit" ? "amount" : "percent",
  );
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [notes, setNotes] = useState<string>(initial?.notes ?? "");
  const [subject, setSubject] = useState<string>(initial?.subject ?? "");
  const [systemNotes, setSystemNotes] = useState<string>(initial?.system_notes ?? "");
  const DELIVERY_DAYS_OPTIONS = [7, 21, 30, 45, 60] as const;
  const [deliveryDays, setDeliveryDays] = useState<number>(
    initial?.delivery_days && DELIVERY_DAYS_OPTIONS.includes(initial.delivery_days as any)
      ? (initial.delivery_days as number)
      : 21,
  );
  // Paid amount: "auto" = always 50% of total. "custom" = user-entered EGP amount.
  const [paidMode, setPaidMode] = useState<"auto" | "custom">("auto");
  const [paidCustom, setPaidCustom] = useState<number>(initial?.paid_amount ?? 0);
  const [delivered, setDelivered] = useState<boolean>(initial?.delivery_status === "delivered");
  const [isDraft, setIsDraft] = useState<boolean>(
    mode === "edit" ? initial?.status === "draft" : !!defaultDraft,
  );
  const [scanning, setScanning] = useState(false);
  const [lastFetchMs, setLastFetchMs] = useState<number | null>(null);
  const [continuous, setContinuous] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [pickerCollection, setPickerCollection] = useState<string>("");
  const [showPicker, setShowPicker] = useState(false);
  const [invoiceCategory, setInvoiceCategory] = useState<string>((initial as any)?.customer_category ?? "");
  const [invoiceChannel, setInvoiceChannel] = useState<string>((initial as any)?.sales_channel ?? "showroom");
  const [invoiceEventId, setInvoiceEventId] = useState<string>((initial as any)?.sales_event_id ?? "");
  const [saving, setSaving] = useState(false);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [draftRecovered, setDraftRecovered] = useState<{ savedAt: string } | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", address: "", category: "", company_name: "", contact_person: "", sales_channel: "showroom", sales_event_id: "", source_notes: "" });
  const [savingCustomer, setSavingCustomer] = useState(false);
  const draftLoaded = useRef(false);
  const beepCtx = useRef<AudioContext | null>(null);

  const openScanner = async () => {
    setScanning(true);
  };

  // In-transit map: product_id -> total qty across open POs (ordered/shipped/in_warehouse)
  const [inTransitQty, setInTransitQty] = useState<Record<string, number>>({});

  // Load customers/products (RLS handles company-wide visibility)
  const loadLists = async () => {
    const [{ data: c }, { data: p }, { data: events }, { data: poItems }, { data: reservations }] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("products").select("*").order("name"),
      (supabase.from as any)("sales_events").select("*").eq("is_active", true).order("year", { ascending: false }).order("name"),
      supabase
        .from("purchase_order_items")
        .select("product_id, quantity, received_qty, purchase_orders!inner(status)")
        .in("purchase_orders.status", ["ordered", "shipped", "in_warehouse"]),
      supabase
        .from("invoice_po_reservations" as any)
        .select("product_id, quantity, invoice_id, status")
        .eq("status", "active"),
    ]);
    setCustomers((c ?? []) as Customer[]);
    setProducts((p ?? []) as Product[]);
    setSalesEvents((events ?? []) as SalesEvent[]);
    const map: Record<string, number> = {};
    for (const it of (poItems ?? []) as any[]) {
      const remaining = Math.max(0, Number(it.quantity || 0) - Number(it.received_qty || 0));
      if (!it.product_id || remaining <= 0) continue;
      map[it.product_id] = (map[it.product_id] ?? 0) + remaining;
    }
    // Subtract active reservations from OTHER invoices (exclude current invoice in edit mode)
    for (const r of (reservations ?? []) as any[]) {
      if (!r.product_id) continue;
      if (mode === "edit" && invoiceId && r.invoice_id === invoiceId) continue;
      map[r.product_id] = Math.max(0, (map[r.product_id] ?? 0) - Number(r.quantity || 0));
    }
    setInTransitQty(map);
  };
  useEffect(() => {
    if (!user) return;
    loadLists();
  }, [user]);
  useRealtimeTable("customers", () => { loadLists(); });
  useRealtimeTable("products", () => { loadLists(); });
  useRealtimeTable("purchase_orders", () => { loadLists(); });
  useRealtimeTable("purchase_order_items", () => { loadLists(); });
  useRealtimeTable("invoice_po_reservations" as any, () => { loadLists(); });

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

  // Autosave indicator state
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const dirtyRef = useRef(false);

  // Effective draft key — also for edit mode (local recovery copy)
  const effectiveDraftKey = draftKey ?? (mode === "edit" && invoiceId ? `invoice-edit-recovery:${invoiceId}` : null);

  useEffect(() => {
    if (!effectiveDraftKey) return;
    if (!(items.length || customerId || notes)) return;
    dirtyRef.current = true;
    setAutosaveState("saving");
    const id = setTimeout(() => {
      try {
        localStorage.setItem(
          effectiveDraftKey,
          JSON.stringify({ customerId, items, discount, notes, savedAt: new Date().toISOString() }),
        );
        setLastSavedAt(Date.now());
        setAutosaveState("saved");
        dirtyRef.current = false;
      } catch {
        setAutosaveState("idle");
      }
    }, 600);
    return () => clearTimeout(id);
  }, [effectiveDraftKey, customerId, items, discount, notes]);

  // Tick the "saved Xs ago" label every 15s
  useEffect(() => {
    if (autosaveState !== "saved") return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [autosaveState]);

  // Warn before closing the tab while there are unsaved changes
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);


  // Auto-open scanner
  useEffect(() => {
    if (autoScan) void openScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan]);

  // Keyboard shortcut: S to scan, Ctrl/Cmd+Enter to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (!inField && (e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void openScanner();
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

  useEffect(() => {
    if (!customer) return;
    if (!invoiceCategory && customer.category) setInvoiceCategory(customer.category);
    if ((!invoiceChannel || invoiceChannel === "showroom") && customer.sales_channel) setInvoiceChannel(customer.sales_channel);
    if (!invoiceEventId && customer.sales_event_id) setInvoiceEventId(customer.sales_event_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, customer?.category, customer?.sales_channel, customer?.sales_event_id]);

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

  /** Stock already pre-allocated to this invoice on first load (edit mode). */
  const initialQtyByProduct = useMemo(() => {
    const m = new Map<string, number>();
    if (mode === "edit" && initial?.items) {
      for (const it of initial.items) {
        if (it.product_id) m.set(it.product_id, (m.get(it.product_id) ?? 0) + (it.quantity || 0));
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /** Returns how many MORE units of this product can still be added (stock + in-transit). */
  const remainingFor = (productId: string): number => {
    const p = products.find((x) => x.id === productId);
    if (!p) return 0;
    const allocatedNow = items
      .filter((it) => it.product_id === productId)
      .reduce((s, it) => s + (it.quantity || 0), 0);
    const baseline = initialQtyByProduct.get(productId) ?? 0;
    const transit = inTransitQty[productId] ?? 0;
    return Math.max(0, (p.stock_quantity ?? 0) + transit + baseline - allocatedNow);
  };

  /** Try to add 1 unit of a product. Returns true if added, false if blocked by stock. */
  const addProduct = (p: Product): boolean => {
    const remaining = remainingFor(p.id);
    if (!isDraft && remaining <= 0) {
      const msg = remaining === 0
        ? t("out_of_stock_now")
        : t("insufficient_stock_remaining").replace("{n}", String(remaining));
      toast.error(`${p.name} — ${msg}`);
      return false;
    }
    // Notify when this unit is coming from the in-transit pool (stock fully consumed).
    const allocatedNow = items
      .filter((it) => it.product_id === p.id)
      .reduce((s, it) => s + (it.quantity || 0), 0);
    const baseline = initialQtyByProduct.get(p.id) ?? 0;
    const stockLeft = Math.max(0, (p.stock_quantity ?? 0) + baseline - allocatedNow);
    if (!isDraft && stockLeft <= 0 && (inTransitQty[p.id] ?? 0) > 0) {
      toast.info(`${p.name} — ${lang === "ar" ? "من شحنة جاية في الطريق" : "from incoming shipment"}`);
    }

    let newQty = 1;
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.product_id === p.id);
      if (idx >= 0) {
        const next = prev.slice();
        newQty = next[idx].quantity + 1;
        next[idx] = { ...next[idx], quantity: newQty };
        return next;
      }
      const newItem: BuilderItem = {
        product_id: p.id,
        product_name: p.name,
        serial_number: p.serial_number ?? "",
        color: p.color ?? "",
        quantity: 1,
        unit_price: Number(p.price),
        discount: 0,
        discount_mode: "percent",
        discount_percent: 0,
      };
      const feeIdx = prev.findIndex(isServiceFee);
      if (feeIdx >= 0) {
        const next = prev.slice();
        next.splice(feeIdx, 0, newItem);
        return next;
      }
      return [...prev, newItem];
    });
    setLastAddedId(p.id);
    setTimeout(() => setLastAddedId((cur) => (cur === p.id ? null : cur)), 900);
    toast.success(`✓ ${p.name}`, { description: `${lang === "ar" ? "الكمية" : "Qty"}: ${newQty}`, duration: 1400 });
    return true;
  };

  /** Apply a scan event coming from a paired mobile device. */
  const handleMobileScanEvent = async (ev: ScanEvent): Promise<boolean> => {
    if (!ev.product_id) return false;
    const fromList = products.find((p) => p.id === ev.product_id);
    let product: Product | null = (fromList as Product) ?? null;
    if (!product) {
      const { product: p } = await fetchProductCached(ev.product_id);
      product = (p as Product) ?? null;
    } else {
      setCachedProduct(product);
    }
    if (!product) return false;
    const ok = addProduct(product);
    if (ok) beep();
    return ok;
  };

  const handleScan = async (text: string) => {
    // Price-list QR (catalog): PL1:SKU — adds as virtual line item, no stock check.
    if (typeof text === "string" && text.startsWith("PL1:")) {
      try {
        const { findPriceItemByPayload } = await import("@/lib/price-list");
        const it = await findPriceItemByPayload(text.trim());
        if (!it) {
          toast.error(lang === "ar" ? "منتج غير موجود في كتالوج الأسعار" : "Price-list item not found");
          return;
        }
        const newItem: BuilderItem = {
          product_id: `pl::${it.sku}`,
          product_name: `${it.name_en}${it.color ? ` — ${it.color}` : ""}`,
          serial_number: it.sku,
          color: it.color ?? "",
          quantity: 1,
          unit_price: Number(it.price),
          discount: 0,
          discount_mode: "percent",
          discount_percent: 0,
        };
        setItems((prev) => {
          const idx = prev.findIndex((x) => x.product_id === newItem.product_id);
          if (idx >= 0) {
            const next = prev.slice();
            next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
            return next;
          }
          const feeIdx = prev.findIndex(isServiceFee);
          if (feeIdx >= 0) {
            const next = prev.slice();
            next.splice(feeIdx, 0, newItem);
            return next;
          }
          return [...prev, newItem];
        });
        beep();
        toast.success(`✓ ${it.sku}`, { description: `${it.price.toLocaleString()} ${it.currency}`, duration: 1400 });
        if (!continuous) setScanning(false);
        return;
      } catch (e: any) {
        toast.error(e?.message ?? "Price-list lookup failed");
        return;
      }
    }
    const decoded = decodeProductQR(text);
    if (!decoded.ok) {
      const msg = decoded.reason === "checksum"
        ? (lang === "ar" ? "رمز QR تالف (فحص فشل)" : "Corrupted QR (checksum failed)")
        : (lang === "ar" ? "رمز QR غير صالح" : "Invalid QR Code");
      toast.error(msg);
      return;
    }
    // Cache-first lookup
    const fromList = products.find((p) => p.id === decoded.productId);
    if (fromList) setCachedProduct(fromList);
    const t0 = performance.now();
    const { product: p, error } = fromList
      ? { product: fromList as Product, error: null as any }
      : await fetchProductCached(decoded.productId);
    setLastFetchMs(Math.round(performance.now() - t0));
    if (error || !p) {
      toast.error(lang === "ar" ? "رمز QR غير صالح" : "Invalid QR Code");
      return;
    }
    const ok = addProduct(p as Product);
    if (ok) {
      beep();
      toast.success(p.name);
    }
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
  // Service fee total stays OUTSIDE the discount base — discount never reduces it.
  const serviceFeeTotal = items.reduce(
    (s, it) => s + (isServiceFee(it) ? it.quantity * it.unit_price - it.discount : 0),
    0,
  );
  const discountableBase = Math.max(0, subtotal - serviceFeeTotal);

  // Keep global discount EGP in sync when in percent mode (based on discountable items only)
  useEffect(() => {
    if (discountMode === "percent") {
      const v = Math.max(0, Math.min(100, discountPercent || 0));
      setDiscount(+((discountableBase * v) / 100).toFixed(2));
    }
  }, [discountMode, discountPercent, discountableBase]);

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

  // Cap discount so it never eats into the protected service fee
  const effectiveDiscount = Math.min(discount, discountableBase);
  const total = Math.max(0, subtotal - effectiveDiscount);

  // Paid / remaining computed from total
  const paidAmount = paidMode === "auto"
    ? +(total * 0.5).toFixed(2)
    : Math.max(0, Math.min(total, +(paidCustom || 0).toFixed(2)));
  const remainingAmount = +(total - paidAmount).toFixed(2);

  // Initialize paid mode/value from existing invoice on edit
  useEffect(() => {
    if (initial?.paid_amount != null) {
      const p = Number(initial.paid_amount);
      // If it equals exactly 50% of current snapshot, treat as auto. Otherwise custom.
      // We don't know original total here reliably, so default to custom when explicit value present.
      setPaidMode("custom");
      setPaidCustom(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          category: newCustomer.category || null,
          company_name: newCustomer.company_name.trim() || null,
          contact_person: newCustomer.contact_person.trim() || null,
          sales_channel: newCustomer.sales_channel || null,
          sales_event_id: newCustomer.sales_event_id || null,
          source_notes: newCustomer.source_notes.trim() || null,
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
      setInvoiceCategory(created.category ?? newCustomer.category);
      setInvoiceChannel(created.sales_channel ?? newCustomer.sales_channel);
      setInvoiceEventId(created.sales_event_id ?? newCustomer.sales_event_id);
      setShowNewCustomer(false);
      setNewCustomer({ name: "", phone: "", address: "", category: "", company_name: "", contact_person: "", sales_channel: "showroom", sales_event_id: "", source_notes: "" });
      toast.success(t("customer_added"));
    } finally {
      setSavingCustomer(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const s = productSearch.trim().toLowerCase();
    let arr = products;
    if (pickerCollection) {
      if (pickerCollection === "__none__") arr = arr.filter((p) => !p.collection);
      else arr = arr.filter((p) => (p.collection ?? "").toUpperCase() === pickerCollection);
    }
    if (s) {
      arr = arr.filter(
        (p) =>
          p.name.toLowerCase().includes(s) ||
          (p.serial_number ?? "").toLowerCase().includes(s) ||
          (p.color ?? "").toLowerCase().includes(s) ||
          (p.collection ?? "").toLowerCase().includes(s),
      );
    }
    return arr;
  }, [products, productSearch, pickerCollection]);

  const collectionCounts = useMemo(() => {
    const counts: Record<string, number> = { __all__: products.length, __none__: 0 };
    for (const c of COLLECTIONS) counts[c] = 0;
    for (const p of products) {
      const cc = (p.collection ?? "").toUpperCase();
      if (cc && counts[cc] !== undefined) counts[cc]++;
      else if (!p.collection) counts.__none__++;
    }
    return counts;
  }, [products]);

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

  const saveDraftDirect = async (): Promise<string | null> => {
    if (!user) return null;
    const itemsPayload = items.map((it) => {
      const base = it.quantity * it.unit_price;
      const lineTotal = Math.max(0, base - (it.discount || 0));
      return {
        product_id: it.product_id,
        product_name: it.product_name,
        serial_number: it.serial_number || null,
        color: it.color || null,
        quantity: it.quantity,
        unit_price: it.unit_price,
        discount: it.discount || 0,
        line_total: lineTotal,
      };
    });
    const subtotalCalc = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
    const totalCalc = Math.max(0, subtotalCalc - effectiveDiscount);

    if (mode === "edit" && invoiceId) {
      const { error: invErr } = await supabase
        .from("invoices")
        .update({
          customer_id: customer?.id ?? null,
          customer_name: customer?.name ?? null,
          customer_phone: customer?.phone ?? null,
          customer_address: customer?.address ?? null,
          discount: effectiveDiscount,
          subtotal: subtotalCalc,
          total: totalCalc,
          notes: notes || null,
          system_notes: systemNotes || null,
          subject: subject.trim() || null,
          delivery_days: deliveryDays,
          paid_amount: paidMode === "custom" ? paidAmount : null,
          language: lang,
          customer_category: invoiceCategory || customer?.category || null,
          sales_channel: invoiceChannel || customer?.sales_channel || null,
          sales_event_id: invoiceEventId || customer?.sales_event_id || null,
          status: "draft",
          updated_at: new Date().toISOString(),
          updated_by: user.id,
          updated_by_email: user.email ?? null,
        } as any)
        .eq("id", invoiceId);
      if (invErr) {
        toast.error(invErr.message);
        return null;
      }
      await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
      const { error: itErr } = await supabase
        .from("invoice_items")
        .insert(itemsPayload.map((it) => ({ ...it, invoice_id: invoiceId })) as any);
      if (itErr) {
        toast.error(itErr.message);
        return null;
      }
      return invoiceId;
    }

    const draftNumber = `DRAFT-${Date.now().toString(36).toUpperCase()}`;
    const { data: ins, error } = await supabase
      .from("invoices")
      .insert({
        user_id: user.id,
        invoice_number: draftNumber,
        customer_id: customer?.id ?? null,
        customer_name: customer?.name ?? null,
        customer_phone: customer?.phone ?? null,
        customer_address: customer?.address ?? null,
        discount: effectiveDiscount,
        subtotal: subtotalCalc,
        total: totalCalc,
        notes: notes || null,
        system_notes: systemNotes || null,
        subject: subject.trim() || null,
        paid_amount: paidMode === "custom" ? paidAmount : null,
        language: lang,
        customer_category: invoiceCategory || customer?.category || null,
        sales_channel: invoiceChannel || customer?.sales_channel || null,
        sales_event_id: invoiceEventId || customer?.sales_event_id || null,
        status: "draft",
        created_by: user.id,
        created_by_email: user.email ?? null,
      } as any)
      .select("id")
      .single();
    if (error || !ins) {
      toast.error(error?.message ?? "Failed to save draft");
      return null;
    }
    const newId = (ins as any).id as string;
    const { error: itErr } = await supabase
      .from("invoice_items")
      .insert(itemsPayload.map((it) => ({ ...it, invoice_id: newId })) as any);
    if (itErr) {
      toast.error(itErr.message);
      return null;
    }
    return newId;
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

    // Confirm reservation from in-transit if any line exceeds physical stock
    if (!isDraft) {
      const reservedLines: string[] = [];
      for (const it of items) {
        if (!it.product_id) continue;
        const p = products.find((x) => x.id === it.product_id);
        if (!p) continue;
        const baseline = initialQtyByProduct.get(it.product_id) ?? 0;
        const stockAvail = Math.max(0, (p.stock_quantity ?? 0) + baseline);
        if (it.quantity > stockAvail) {
          const short = it.quantity - stockAvail;
          reservedLines.push(`• ${p.name} — ${lang === "ar" ? `حجز ${short} من القادم` : `reserve ${short} from incoming`}`);
        }
      }
      if (reservedLines.length > 0) {
        const msg = (lang === "ar"
          ? "المخزن غير كافٍ لبعض المنتجات. سيتم حجز الكميات التالية من شحنات قادمة:\n\n"
          : "Stock is insufficient for some products. The following quantities will be reserved from incoming shipments:\n\n")
          + reservedLines.join("\n")
          + (lang === "ar" ? "\n\nهل تريد المتابعة؟" : "\n\nProceed?");
        if (!window.confirm(msg)) return;
      }
    }

    setSaving(true);
    try {
      // DRAFT path — no stock changes, no real invoice number
      if (isDraft) {
        const id = await saveDraftDirect();
        if (!id) return;
        if (effectiveDraftKey) { localStorage.removeItem(effectiveDraftKey); dirtyRef.current = false; setAutosaveState("idle"); setLastSavedAt(null); }
        toast.success(lang === "ar" ? "تم حفظ المسودة" : "Draft saved");
        navigate({ to: "/invoices/drafts" });
        return;
      }

      // Editing an existing DRAFT and switching to REAL → create real invoice via RPC, then delete draft
      if (mode === "edit" && invoiceId && initial?.status === "draft") {
        const { data: newId, error } = await supabase.rpc("create_invoice", {
          _customer_id: customer?.id ?? null,
          _discount: effectiveDiscount,
          _notes: notes || null,
          _language: lang,
          _items: payload as any,
          _paid_amount: paidMode === "custom" ? paidAmount : null,
          _system_notes: systemNotes || null,
          _customer_category: invoiceCategory || customer?.category || null,
          _sales_channel: invoiceChannel || customer?.sales_channel || null,
          _sales_event_id: invoiceEventId || customer?.sales_event_id || null,
        } as any);
        if (error || !newId) {
          handleRpcError(error?.message ?? "");
          return;
        }
        // Best-effort delete of the draft (no stock to restore)
        await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
        await supabase.from("invoices").delete().eq("id", invoiceId);
        if (delivered) {
          await supabase
            .from("invoices")
            .update({ delivery_status: "delivered" } as any)
            .eq("id", newId as string);
        }
        // Save subject (not part of RPC signature).
        await supabase
          .from("invoices")
          .update({ subject: subject.trim() || null } as any)
          .eq("id", newId as string);
        toast.success(t("invoice_saved"));
        navigate({ to: "/invoices/$id", params: { id: newId as string } });
        return;
      }

      if (mode === "edit" && invoiceId) {
        const { data, error } = await supabase.rpc("update_invoice", {
          _invoice_id: invoiceId,
          _customer_id: customer?.id ?? null,
          _discount: effectiveDiscount,
          _notes: notes || null,
          _language: lang,
          _items: payload as any,
          _paid_amount: paidMode === "custom" ? paidAmount : null,
          _system_notes: systemNotes ?? "",
          _customer_category: invoiceCategory || customer?.category || null,
          _sales_channel: invoiceChannel || customer?.sales_channel || null,
          _sales_event_id: invoiceEventId || customer?.sales_event_id || null,
        } as any);
        if (error || !data) {
          handleRpcError(error?.message ?? "");
          return;
        }
        await supabase
          .from("invoices")
          .update({
            delivery_status: delivered ? "delivered" : "pending",
            subject: subject.trim() || null,
          } as any)
          .eq("id", invoiceId);
        toast.success(t("invoice_saved"));
        navigate({ to: "/invoices/$id", params: { id: invoiceId } });
      } else {
        const { data: invoiceIdRet, error } = await supabase.rpc("create_invoice", {
          _customer_id: customer?.id ?? null,
          _discount: effectiveDiscount,
          _notes: notes || null,
          _language: lang,
          _items: payload as any,
          _paid_amount: paidMode === "custom" ? paidAmount : null,
          _system_notes: systemNotes || null,
          _customer_category: invoiceCategory || customer?.category || null,
          _sales_channel: invoiceChannel || customer?.sales_channel || null,
          _sales_event_id: invoiceEventId || customer?.sales_event_id || null,
        } as any);
        if (error || !invoiceIdRet) {
          handleRpcError(error?.message ?? "");
          return;
        }
        if (delivered) {
          await supabase
            .from("invoices")
            .update({ delivery_status: "delivered" } as any)
            .eq("id", invoiceIdRet as string);
        }
        if (subject.trim()) {
          await supabase
            .from("invoices")
            .update({ subject: subject.trim() } as any)
            .eq("id", invoiceIdRet as string);
        }
        if (effectiveDraftKey) { localStorage.removeItem(effectiveDraftKey); dirtyRef.current = false; setAutosaveState("idle"); setLastSavedAt(null); }
        toast.success(t("invoice_saved"));
        navigate({ to: "/invoices/$id", params: { id: invoiceIdRet as string } });
      }
    } finally {
      setSaving(false);
    }
  };

  // Format "saved Xs/m ago" relative to now (re-renders via `tick`)
  const savedAgo = (() => {
    if (!lastSavedAt) return "";
    void tick;
    const s = Math.max(1, Math.floor((Date.now() - lastSavedAt) / 1000));
    if (lang === "ar") {
      if (s < 60) return `قبل ${s} ث`;
      const m = Math.floor(s / 60);
      return m < 60 ? `قبل ${m} د` : `قبل ${Math.floor(m / 60)} س`;
    }
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
  })();

  return (
    <div className="space-y-5 w-full max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            {mode === "edit" ? t("edit_invoice") : t("new_invoice")}
            {isDraft && (
              <span className="ms-2 align-middle rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700 dark:text-amber-400">
                {lang === "ar" ? "مسودة" : "Draft"}
              </span>
            )}
          </h1>
          {effectiveDraftKey && autosaveState !== "idle" && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors ${
                autosaveState === "saving"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              }`}
              aria-live="polite"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  autosaveState === "saving"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-emerald-500"
                }`}
              />
              {autosaveState === "saving"
                ? (lang === "ar" ? "جارٍ الحفظ التلقائي…" : "Autosaving…")
                : (lang === "ar" ? `حُفظت تلقائياً ${savedAgo}` : `Saved ${savedAgo}`)}
            </span>
          )}
        </div>
        <Button onClick={save} disabled={saving} className="gap-2 shadow-glow w-full sm:w-auto">
          {isDraft
            ? (lang === "ar" ? "حفظ كمسودة" : "Save draft")
            : (mode === "edit" && initial?.status === "draft"
                ? (lang === "ar" ? "تحويل إلى فاتورة حقيقية" : "Convert to real invoice")
                : t("save_invoice"))}
        </Button>
      </div>

      {/* Draft / Real toggle */}
      {(() => {
        const lockedReal = mode === "edit" && initial?.status !== "draft";
        if (lockedReal) return null;
        return (
          <div className="rounded-2xl border bg-card p-3 sm:p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-semibold">
                  {lang === "ar" ? "نوع الفاتورة" : "Invoice type"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {isDraft
                    ? (lang === "ar"
                        ? "المسودة لا تُخصم من المخزون ولا تظهر في التقارير أو الأرباح. تظهر في صفحة المسودات فقط."
                        : "Drafts do not affect stock and are excluded from analytics, reports, and profits. They live in the Drafts page.")
                    : (lang === "ar"
                        ? "فاتورة حقيقية: تُخصم من المخزون فوراً وتدخل في كل التقارير والأرباح."
                        : "Real invoice: deducts stock immediately and counts in analytics, reports and profits.")}
                </p>
              </div>
              <div className="inline-flex rounded-full border bg-muted/40 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setIsDraft(true)}
                  className={`px-3 py-1.5 rounded-full transition-all ${
                    isDraft
                      ? "bg-amber-500 text-white shadow"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lang === "ar" ? "مسودة" : "Draft"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsDraft(false)}
                  className={`px-3 py-1.5 rounded-full transition-all ${
                    !isDraft
                      ? "bg-emerald-600 text-white shadow"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lang === "ar" ? "فاتورة حقيقية" : "Real invoice"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}


      <DesktopPairWidget
        mode={mode}
        invoiceId={invoiceId ?? null}
        onScanEvent={handleMobileScanEvent}
      />

      {draftRecovered && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <div>
            <span className="font-semibold">{t("draft_recovered")}</span>
            <span className="ms-2 text-muted-foreground tabular-nums">
              {new Date(draftRecovered.savedAt).toLocaleString((lang === "ar" ? "ar-EG" : "en-GB") + "-u-nu-latn")}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (effectiveDraftKey) { localStorage.removeItem(effectiveDraftKey); dirtyRef.current = false; setAutosaveState("idle"); setLastSavedAt(null); }
              setItems([]); setCustomerId(""); setDiscount(0); setNotes(""); setSubject("");
              setDraftRecovered(null);
            }}
          >
            {t("discard_draft")}
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-2">
          <div className="rounded-2xl border bg-card p-3 sm:p-5 shadow-sm">
            <Label>{t("customer")}</Label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— {t("select_customer")} —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" className="w-full gap-1 sm:w-auto sm:shrink-0" onClick={() => setShowNewCustomer(true)}>
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
                <div>
                  {lang === "ar" ? "تصنيف العميل" : "Customer category"}: {labelForCustomerCategory(customer.category, lang as "ar" | "en")}
                </div>
                <div>
                  {lang === "ar" ? "قناة المصدر" : "Source channel"}: {labelForSalesChannel(customer.sales_channel, lang as "ar" | "en")}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-3 sm:p-5 shadow-sm">
            <div className="mb-3">
              <h3 className="font-semibold">{lang === "ar" ? "تصنيف الفاتورة والتحليل" : "Invoice classification"}</h3>
              <p className="text-xs text-muted-foreground">{lang === "ar" ? "استخدمها لمعرفة مبيعات المعارض، الأونلاين، المهندسين والموزعين بدقة." : "Track events, online, engineers and distributors accurately."}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs">{lang === "ar" ? "Catgry العميل" : "Customer category"}</Label>
                <select value={invoiceCategory} onChange={(e) => setInvoiceCategory(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">{lang === "ar" ? "غير مصنف" : "Uncategorized"}</option>
                  {CUSTOMER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{lang === "ar" ? c.ar : c.en}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">{lang === "ar" ? "Catgry الفاتورة / القناة" : "Invoice channel"}</Label>
                <select value={invoiceChannel} onChange={(e) => setInvoiceChannel(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">{lang === "ar" ? "غير مصنف" : "Uncategorized"}</option>
                  {SALES_CHANNELS.map((c) => <option key={c.value} value={c.value}>{lang === "ar" ? c.ar : c.en}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">{lang === "ar" ? "المعرض / الحدث" : "Event / exhibition"}</Label>
                <select value={invoiceEventId} onChange={(e) => setInvoiceEventId(e.target.value)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">{lang === "ar" ? "بدون معرض" : "No event"}</option>
                  {salesEvents.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{ev.year ? ` ${ev.year}` : ""}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-3 sm:p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{t("products")}</h3>
              <div className="flex flex-wrap gap-2">
                {!items.some(isServiceFee) && (
                  <Button
                    variant="outline"
                    className="gap-2 flex-1 sm:flex-none border-primary/40 text-primary hover:bg-primary/10"
                    onClick={() =>
                      setItems((prev) => (prev.some(isServiceFee) ? prev : [...prev, defaultFeeItem()]))
                    }
                    title={lang === "ar" ? "إعادة رسوم الشحن (250 ج.م)" : "Restore shipping fee (EGP 250)"}
                  >
                    <Plus className="h-4 w-4" />
                    {lang === "ar" ? "إعادة رسوم الشحن" : "Restore shipping fee"}
                  </Button>
                )}
                <Button variant="outline" className="gap-2 flex-1 sm:flex-none" onClick={() => void openScanner()}>
                  <ScanLine className="h-4 w-4" />
                  {t("scan_qr")}
                </Button>
                <Button className="gap-2 flex-1 sm:flex-none" onClick={() => setShowPicker(true)}>
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
                     <div className="flex items-start justify-between gap-2">
                       <div className="min-w-0 flex-1 text-sm font-medium break-words">
                         {it.product_name}
                         {it.product_id ? (() => {
                           const p = products.find((x) => x.id === it.product_id);
                           if (!p?.is_spare_part) return null;
                           const parent = p.parent_product_id ? products.find((x) => x.id === p.parent_product_id)?.name : null;
                           return <span className="ms-2 align-middle"><SparePartBadge product={p} parentName={parent} isAr={lang === "ar"} /></span>;
                         })() : null}
                       </div>
                      <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    {isServiceFee(it) ? (
                      <div className="mt-2 flex items-center justify-end text-sm font-semibold">
                        {fmtMoney(250, "EGP", lang)}
                      </div>
                    ) : (
                      <>
                     <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
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
                             let next = v === "" ? 0 : Math.max(1, parseInt(v, 10) || 1);
                              // Cap to available stock for catalog products (skip for drafts)
                              if (!isDraft && it.product_id) {
                                const p = products.find((x) => x.id === it.product_id);
                                if (p) {
                                  const baseline = initialQtyByProduct.get(it.product_id) ?? 0;
                                  const maxAllowed = (p.stock_quantity ?? 0) + baseline;
                                  if (next > maxAllowed) {
                                    toast.error(
                                      `${p.name} — ${t("insufficient_stock_remaining").replace("{n}", String(maxAllowed))}`,
                                    );
                                    next = Math.max(1, maxAllowed);
                                  }
                                }
                              }
                             updateItem(idx, { quantity: next });
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
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-card p-3 sm:p-5 shadow-sm">
            <Label>{lang === "ar" ? "موضوع الفاتورة" : "Invoice subject"}</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={lang === "ar" ? "مثال: توريد أدوات ديكور — عقد رقم 12" : "e.g. Supply of decor items — Contract #12"}
              className="mt-1.5"
              maxLength={200}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {lang === "ar" ? "يظهر في المعاينة والـ PDF أعلى بيانات العميل." : "Shown in the preview and PDF above the customer info."}
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-3 sm:p-5 shadow-sm">
            <Label>{t("notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1.5" />
          </div>

          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-amber-700 dark:text-amber-400">{t("system_notes")}</Label>
              <span className="text-[10px] uppercase tracking-wider text-amber-700/70 dark:text-amber-400/70">
                {lang === "ar" ? "داخلي" : "Internal"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("system_notes_hint")}</p>
            <Textarea value={systemNotes} onChange={(e) => setSystemNotes(e.target.value)} rows={3} className="mt-2" />
          </div>
        </div>

         <aside className="min-w-0 space-y-3">
          <div className="rounded-2xl border bg-card p-3 sm:p-5 shadow-sm">
              <div className="space-y-2 text-sm">
               <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                 <span className="text-muted-foreground">{t("subtotal")}</span>
                 <span className="max-w-full break-words text-start sm:text-end">{fmtMoney(subtotal, "EGP", lang)}</span>
               </div>
               <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-muted-foreground">{t("discount")}</span>
                 <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
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
                       className="min-w-0 flex-1 text-end sm:w-24 sm:flex-none"
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
                       className="min-w-0 flex-1 text-end sm:w-24 sm:flex-none"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (discountMode === "amount") {
                        const pct = discountableBase > 0 ? +((discount / discountableBase) * 100).toFixed(2) : 0;
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
               <div className="flex flex-col gap-1 border-t pt-2 text-lg font-bold sm:flex-row sm:items-center sm:justify-between">
                 <span>{t("total")}</span>
                 <span className="max-w-full break-words text-start sm:text-end">{fmtMoney(total, "EGP", lang)}</span>
              </div>

              {/* Paid / Remaining */}
              <div className="border-t pt-2 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-muted-foreground">
                    {lang === "ar" ? "المبلغ المسدد" : "Paid Amount"}
                  </span>
                  <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
                    {paidMode === "custom" ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min={0}
                        max={total}
                        value={paidCustom === 0 ? "" : paidCustom}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const v = e.target.value;
                          setPaidCustom(v === "" ? 0 : Number(v) || 0);
                        }}
                        className="min-w-0 flex-1 text-end sm:w-28 sm:flex-none"
                      />
                    ) : (
                      <span className="text-end font-semibold tabular-nums">{fmtMoney(paidAmount, "EGP", lang)}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (paidMode === "auto") {
                          setPaidCustom(+(total * 0.5).toFixed(2));
                          setPaidMode("custom");
                        } else {
                          setPaidMode("auto");
                        }
                      }}
                      className="text-[10px] font-semibold rounded border px-1.5 py-1 hover:bg-muted"
                      title={paidMode === "auto" ? (lang === "ar" ? "تخصيص" : "Custom") : (lang === "ar" ? "50% تلقائي" : "50% auto")}
                    >
                      {paidMode === "auto" ? "50%" : "EGP"}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {lang === "ar" ? "المبلغ المتبقي" : "Remaining Amount"}
                  </span>
                  <span className={`font-semibold tabular-nums ${remainingAmount <= 0 ? "text-emerald-600" : ""}`}>{fmtMoney(remainingAmount, "EGP", lang)}</span>
                </div>
                {remainingAmount > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                    onClick={() => {
                      setPaidMode("custom");
                      setPaidCustom(+total.toFixed(2));
                      toast.success(lang === "ar" ? "تم سداد المتبقي" : "Remaining marked paid");
                    }}
                  >
                    {lang === "ar" ? `سداد المتبقي (${fmtMoney(remainingAmount, "EGP", lang)})` : `Pay remaining (${fmtMoney(remainingAmount, "EGP", lang)})`}
                  </Button>
                )}
                {remainingAmount <= 0 && total > 0 && (
                  <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-center text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                    {lang === "ar" ? "✓ مدفوعة بالكامل" : "✓ Fully paid"}
                  </div>
                )}
              </div>

              {/* Delivered toggle */}
              <label className="mt-2 flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                <span className="text-sm font-medium">
                  {lang === "ar" ? "تم التسليم بالكامل" : "Marked as delivered"}
                </span>
                <input
                  type="checkbox"
                  checked={delivered}
                  onChange={(e) => setDelivered(e.target.checked)}
                  className="h-4 w-4 accent-emerald-600"
                />
              </label>
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
        <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] sm:w-full max-h-[90vh] flex flex-col gap-3 p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>{t("select_product")}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {filteredProducts.length} / {products.length}
              </span>
            </DialogTitle>
          </DialogHeader>

          <Input
            placeholder={t("search") + " — " + (lang === "ar" ? "اسم / تسلسلي / لون / كولكشن" : "name / serial / color / collection")}
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            autoFocus
          />

          <div className="flex flex-wrap gap-1.5 -mt-1">
            <button
              type="button"
              onClick={() => setPickerCollection("")}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${pickerCollection === "" ? "bg-primary text-primary-foreground shadow" : "bg-muted hover:bg-muted/70"}`}
            >
              {t("all_collections")} ({collectionCounts.__all__})
            </button>
            {COLLECTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setPickerCollection(c)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${collectionPillClass(c, pickerCollection === c)}`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${collectionDotClass(c)}`} aria-hidden />
                {c} ({collectionCounts[c] ?? 0})
              </button>
            ))}
            {collectionCounts.__none__ > 0 && (
              <button
                type="button"
                onClick={() => setPickerCollection("__none__")}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${pickerCollection === "__none__" ? "bg-primary text-primary-foreground shadow" : "bg-muted hover:bg-muted/70"}`}
              >
                {t("no_collection")} ({collectionCounts.__none__})
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border bg-card">
            {filteredProducts.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">{t("no_products")}</div>
            ) : (
              <ul className="divide-y">
                {filteredProducts.map((p) => {
                  const transit = inTransitQty[p.id] ?? 0;
                  const out = p.stock_quantity <= 0;
                  const blocked = out && transit <= 0;
                  const low = !out && p.stock_quantity <= p.low_stock_threshold;
                  const inCartQty = items
                    .filter((it) => it.product_id === p.id)
                    .reduce((s, it) => s + (it.quantity || 0), 0);
                  const justAdded = lastAddedId === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => addProduct(p)}
                        disabled={blocked}
                        className={`relative flex w-full items-center gap-3 px-2.5 py-2 text-start transition disabled:opacity-50 disabled:cursor-not-allowed ${
                          justAdded
                            ? "bg-emerald-500/15 ring-1 ring-emerald-500/40"
                            : inCartQty > 0
                              ? "bg-primary/5 hover:bg-primary/10"
                              : "hover:bg-muted/50"
                        }`}
                      >
                        <div className="h-12 w-12 sm:h-14 sm:w-14 flex-shrink-0 overflow-hidden rounded-md border bg-muted">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground/40 text-[10px]">
                              {p.collection ?? "—"}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium truncate">{p.name}</span>
                            {p.is_spare_part && (
                              <SparePartBadge
                                product={p}
                                parentName={p.parent_product_id ? products.find((x) => x.id === p.parent_product_id)?.name : null}
                                isAr={lang === "ar"}
                                size="xs"
                              />
                            )}
                            {p.collection && (
                              <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold ${collectionBadgeClass(p.collection)}`}><span className={`inline-block h-1 w-1 rounded-full ${collectionDotClass(p.collection)}`} aria-hidden />{p.collection}</span>
                            )}
                            {inCartQty > 0 && (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow ${justAdded ? "bg-emerald-500 animate-pulse" : "bg-gradient-to-r from-emerald-500 to-teal-500"}`}>
                                ✓ {inCartQty} {lang === "ar" ? "مُضاف" : "added"}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                            {p.serial_number && <span className="font-mono">{p.serial_number}</span>}
                            {p.color && (
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="inline-block h-4 w-4 rounded-[5px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.18)] ring-1 ring-black/10"
                                  style={swatchStyle(p.color)}
                                  aria-hidden
                                  title={p.color}
                                />
                                <span className="font-medium">{p.color}</span>
                              </span>
                            )}
                            <span>{t("stock")}: <span className={out ? "text-destructive font-bold" : low ? "text-warning-foreground font-bold" : ""}>{p.stock_quantity}</span></span>
                            {transit > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-600 dark:text-sky-300">
                                🚚 {lang === "ar" ? "في الطريق" : "in transit"}: {transit}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-end">
                          <div className="font-semibold tabular-nums text-sm">{fmtMoney(Number(p.price), "EGP", lang)}</div>
                          {blocked && <span className="text-[10px] font-bold text-destructive">{lang === "ar" ? "نفد" : "OUT"}</span>}
                          {out && !blocked && <span className="text-[10px] font-bold text-sky-600 dark:text-sky-300">{lang === "ar" ? "من الشحنة" : "FROM SHIPMENT"}</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
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
          {scanning && <QrScanner onScan={handleScan} onClose={() => setScanning(false)} lastFetchMs={lastFetchMs} />}
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">{lang === "ar" ? "Catgry العميل" : "Customer category"}</Label>
                <select value={newCustomer.category} onChange={(e) => setNewCustomer((s) => ({ ...s, category: e.target.value }))} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">{lang === "ar" ? "غير مصنف" : "Uncategorized"}</option>
                  {CUSTOMER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{lang === "ar" ? c.ar : c.en}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">{lang === "ar" ? "المصدر / القناة" : "Source channel"}</Label>
                <select value={newCustomer.sales_channel} onChange={(e) => setNewCustomer((s) => ({ ...s, sales_channel: e.target.value }))} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">{lang === "ar" ? "غير مصنف" : "Uncategorized"}</option>
                  {SALES_CHANNELS.map((c) => <option key={c.value} value={c.value}>{lang === "ar" ? c.ar : c.en}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">{lang === "ar" ? "اسم الشركة / المعرض" : "Company / showroom"}</Label>
                <Input value={newCustomer.company_name} onChange={(e) => setNewCustomer((s) => ({ ...s, company_name: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">{lang === "ar" ? "اسم الشخص المسؤول" : "Contact person"}</Label>
                <Input value={newCustomer.contact_person} onChange={(e) => setNewCustomer((s) => ({ ...s, contact_person: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">{lang === "ar" ? "المعرض / الحدث" : "Event / exhibition"}</Label>
              <select value={newCustomer.sales_event_id} onChange={(e) => setNewCustomer((s) => ({ ...s, sales_event_id: e.target.value }))} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm">
                <option value="">{lang === "ar" ? "بدون" : "None"}</option>
                {salesEvents.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{ev.year ? ` ${ev.year}` : ""}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">{lang === "ar" ? "ملاحظات المصدر" : "Source notes"}</Label>
              <Input value={newCustomer.source_notes} onChange={(e) => setNewCustomer((s) => ({ ...s, source_notes: e.target.value }))} />
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
