import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, AlertDialogDescription } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Search, Upload, Download, QrCode, Printer, Sliders, ImagePlus, PackagePlus, Truck } from "lucide-react";
import { collectionPillClass, collectionBadgeClass, collectionDotClass } from "@/lib/collection-styles";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import type { Product } from "@/lib/data";
import { COLLECTIONS } from "@/lib/data";
import { fmtMoney } from "@/lib/utils-money";
import Papa from "papaparse";
import QRCode from "qrcode";
import { encodeProductQR } from "@/lib/qr-codec";
import { cachedListFetch } from "@/lib/list-cache";
import { useRealtimeTable } from "@/lib/realtime";
import { AuthorBadge } from "@/components/author-badge";
import { ProductImageUpload } from "@/components/product-image-upload";

export const Route = createFileRoute("/products")({ component: () => <AppShell><Products /></AppShell> });

function Products() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [list, setList] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [collectionFilter, setCollectionFilter] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ name: "", serial_number: "", color: "", price: "0", cost_price_usd: "0", stock_quantity: "0", low_stock_threshold: "5", image_url: "" as string | null | "", collection: "" });
  const [qrPreview, setQrPreview] = useState<{ name: string; data: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelData, setLabelData] = useState<{ p: Product; data: string }[] | null>(null);
  const [adjustFor, setAdjustFor] = useState<Product | null>(null);
  const [adjustAmt, setAdjustAmt] = useState("0");
  const [adjustReason, setAdjustReason] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAmt, setBulkAmt] = useState("0");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkScope, setBulkScope] = useState<"filtered" | "all">("filtered");
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!user) return;
    const { data, fromCache } = await cachedListFetch<Product>("products", async () => {
      const { data } = await supabase.from("products").select("*").order("created_at", { ascending: false });
      return (data ?? []) as Product[];
    });
    setList(data);
    setLoading(false);
    if (fromCache) {
      // Background revalidate already runs in cachedListFetch; refresh again on focus
    }
  };
  useEffect(() => { load(); }, [user]);

  // Realtime sync — refresh when any team member changes products
  useRealtimeTable("products", () => { load(); });

  const filtered = useMemo(() => list.filter((p) => {
    if (collectionFilter) {
      if (collectionFilter === "__none__") {
        if (p.collection) return false;
      } else if (p.collection !== collectionFilter) {
        return false;
      }
    }
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      p.name.toLowerCase().includes(s) ||
      (p.serial_number ?? "").toLowerCase().includes(s) ||
      (p.color ?? "").toLowerCase().includes(s) ||
      (p.collection ?? "").toLowerCase().includes(s)
    );
  }), [list, q, collectionFilter]);

  const collectionCounts = useMemo(() => {
    const counts: Record<string, number> = { __all__: list.length, __none__: 0 };
    for (const c of COLLECTIONS) counts[c] = 0;
    for (const p of list) {
      if (p.collection && counts[p.collection] !== undefined) counts[p.collection]++;
      else if (!p.collection) counts.__none__++;
    }
    return counts;
  }, [list]);

  const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const openAdd = () => { setEditing(null); setForm({ name: "", serial_number: "", color: "", price: "0", cost_price_usd: "0", stock_quantity: "0", low_stock_threshold: "5", image_url: "", collection: "" }); setOpen(true); };
  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({ name: p.name, serial_number: p.serial_number ?? "", color: p.color ?? "", price: String(p.price), cost_price_usd: String((p as any).cost_price_usd ?? 0), stock_quantity: String(p.stock_quantity), low_stock_threshold: String(p.low_stock_threshold), image_url: p.image_url ?? "", collection: p.collection ?? "" });
    setOpen(true);
  };

  const save = async () => {
    if (!user) return;
    if (!form.name.trim()) return toast.error(t("required"));
    const payload = {
      name: form.name,
      serial_number: form.serial_number || null,
      color: form.color || null,
      price: Number(form.price) || 0,
      cost_price_usd: Number(form.cost_price_usd) || 0,
      stock_quantity: parseInt(form.stock_quantity || "0", 10),
      low_stock_threshold: parseInt(form.low_stock_threshold || "5", 10),
      image_url: form.image_url || null,
      collection: form.collection ? form.collection.toUpperCase() : null,
    };
    if (editing) {
      const { error } = await supabase.from("products").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { data, error } = await supabase.from("products").insert({ ...payload, user_id: user.id }).select("id").single();
      if (error) return toast.error(error.message);
      await supabase.from("products").update({ qr_code: data.id }).eq("id", data.id);
    }
    toast.success(t("product_saved"));
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("product_deleted"));
    load();
  };

  const showQr = async (p: Product) => {
    // Use compact v1 payload (id + checksum) — smaller, more reliable
    const payload = encodeProductQR(p.qr_code || p.id);
    const data = await QRCode.toDataURL(payload, { width: 320, margin: 2, errorCorrectionLevel: "M" });
    setQrPreview({ name: p.name, data });
  };

  const printLabels = async () => {
    if (!user || selected.size === 0) return;
    const targets = filtered.filter((p) => selected.has(p.id));
    const out: { p: Product; data: string }[] = [];
    for (const p of targets) {
      const payload = encodeProductQR(p.qr_code || p.id);
      const data = await QRCode.toDataURL(payload, { width: 200, margin: 1, errorCorrectionLevel: "M" });
      out.push({ p, data });
    }
    setLabelData(out);
    // Allow render then print
    setTimeout(() => window.print(), 200);
  };

  const adjustStock = async () => {
    if (!user || !adjustFor) return;
    const amt = parseInt(adjustAmt || "0", 10);
    if (!amt) return toast.error(lang === "ar" ? "أدخل قيمة غير صفرية" : "Enter non-zero amount");
    const reason = adjustReason.trim();
    if (reason.length < 3) {
      return toast.error(lang === "ar" ? "السبب مطلوب (3 أحرف على الأقل)" : "Reason required (min 3 chars)");
    }
    const { error } = await supabase.rpc("adjust_stock", {
      _product_id: adjustFor.id,
      _change: amt,
      _reason: reason,
    });
    if (error) {
      const msg = error.message || "";
      if (msg.includes("WOULD_GO_NEGATIVE")) {
        return toast.error(lang === "ar" ? "الكمية ستصبح سالبة" : "Stock would go negative");
      }
      if (msg.includes("REASON_REQUIRED")) {
        return toast.error(lang === "ar" ? "السبب مطلوب" : "Reason required");
      }
      return toast.error(msg);
    }
    toast.success(t("stock_adjusted"));
    setAdjustFor(null);
    setAdjustAmt("0");
    setAdjustReason("");
    load();
  };

  const runBulkAdjust = async () => {
    if (!user) return;
    const amt = parseInt(bulkAmt || "0", 10);
    if (!amt) return toast.error(lang === "ar" ? "أدخل قيمة غير صفرية" : "Enter non-zero amount");
    const reason = bulkReason.trim();
    if (reason.length < 3) {
      return toast.error(lang === "ar" ? "السبب مطلوب (3 أحرف على الأقل)" : "Reason required (min 3 chars)");
    }
    const targets = bulkScope === "filtered" ? filtered : list;
    if (!targets.length) return toast.error(lang === "ar" ? "لا توجد منتجات" : "No products");
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const p of targets) {
      const { error } = await supabase.rpc("adjust_stock", {
        _product_id: p.id,
        _change: amt,
        _reason: reason,
      });
      if (error) fail++; else ok++;
    }
    setBulkBusy(false);
    if (fail === 0) toast.success(`${ok} ✓`);
    else toast.warning(`${ok} ✓ · ${fail} ✗`);
    setBulkOpen(false);
    setBulkAmt("0");
    setBulkReason("");
    load();
  };

  const exportCsv = () => {
    const rows = list.map((p) => ({
      name: p.name, serial_number: p.serial_number ?? "", color: p.color ?? "",
      price: p.price, stock_quantity: p.stock_quantity, low_stock_threshold: p.low_stock_threshold,
      collection: p.collection ?? "",
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "products.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const importCsv = (file: File) => {
    if (!user) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (res) => {
        const rows = (res.data as any[]).map((r) => {
          const collRaw = String(r.collection ?? "").trim().toUpperCase();
          const collection = (COLLECTIONS as readonly string[]).includes(collRaw) ? collRaw : null;
          return {
            user_id: user.id,
            name: String(r.name ?? "").trim(),
            serial_number: r.serial_number ? String(r.serial_number) : null,
            color: r.color ? String(r.color) : null,
            price: Number(r.price) || 0,
            stock_quantity: parseInt(r.stock_quantity ?? "0", 10) || 0,
            low_stock_threshold: parseInt(r.low_stock_threshold ?? "5", 10) || 5,
            collection,
          };
        }).filter((r) => r.name);
        if (!rows.length) return toast.error(t("no_data"));
        const { data, error } = await supabase.from("products").insert(rows).select("id");
        if (error) return toast.error(error.message);
        if (data) for (const d of data) await supabase.from("products").update({ qr_code: d.id }).eq("id", d.id);
        toast.success(`${data?.length ?? 0} ✓`);
        load();
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <h1 className="text-2xl font-bold tracking-tight text-gradient-gold">{t("products")}</h1>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2"><Upload className="h-4 w-4" />{t("import_csv")}</Button>
          <Button variant="outline" onClick={exportCsv} className="gap-2"><Download className="h-4 w-4" />{t("export_csv")}</Button>
          <Button variant="outline" disabled={selected.size === 0} onClick={printLabels} className="gap-2">
            <Printer className="h-4 w-4" />{t("print_qr_labels")} {selected.size > 0 && `(${selected.size})`}
          </Button>
          <Button variant="outline" onClick={() => { setBulkOpen(true); setBulkAmt("0"); setBulkReason(""); setBulkScope("filtered"); }} className="gap-2">
            <PackagePlus className="h-4 w-4" />{lang === "ar" ? "إضافة مخزون جماعية" : "Bulk add stock"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openAdd} className="gap-2"><Plus className="h-4 w-4" />{t("add_product")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? t("edit_product") : t("add_product")}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Image</Label>
                  <ProductImageUpload value={form.image_url || null} onChange={(url) => setForm({ ...form, image_url: url ?? "" })} />
                </div>
                <div className="col-span-2"><Label>{t("product_name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>{t("serial_number")}</Label><Input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} /></div>
                <div><Label>{t("color")}</Label><Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
                <div><Label>{t("price")}</Label><Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
                <div><Label>{lang === "ar" ? "تكلفة الوحدة (USD)" : "Unit cost (USD)"}</Label><Input type="number" step="0.01" value={form.cost_price_usd} onChange={(e) => setForm({ ...form, cost_price_usd: e.target.value })} /></div>
                <div><Label>{t("stock")}</Label><Input type="number" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} /></div>
                <div><Label>{t("low_stock_threshold")}</Label><Input type="number" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} /></div>
                <div>
                  <Label>{t("collection")}</Label>
                  <select
                    value={form.collection}
                    onChange={(e) => setForm({ ...form, collection: e.target.value })}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm h-9"
                  >
                    <option value="">— {t("no_collection")} —</option>
                    {COLLECTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
                <Button onClick={save}>{t("save")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-col gap-3 no-print sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search") + " — " + (lang === "ar" ? "اسم / تسلسلي / لون / كولكشن" : "name / serial / color / collection")} className="ps-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCollectionFilter("")}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${collectionFilter === "" ? "bg-primary text-primary-foreground shadow" : "bg-muted hover:bg-muted/70"}`}
          >
            {t("all_collections")} ({collectionCounts.__all__})
          </button>
          {COLLECTIONS.map((c) => (
            <button
              key={c}
              onClick={() => setCollectionFilter(c)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${collectionPillClass(c, collectionFilter === c)}`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${collectionDotClass(c)}`} aria-hidden />
              {c} ({collectionCounts[c] ?? 0})
            </button>
          ))}
          {collectionCounts.__none__ > 0 && (
            <button
              onClick={() => setCollectionFilter("__none__")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${collectionFilter === "__none__" ? "bg-primary text-primary-foreground shadow" : "bg-muted hover:bg-muted/70"}`}
            >
              {t("no_collection")} ({collectionCounts.__none__})
            </button>
          )}
        </div>
      </div>

      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card no-print">
        {loading ? (
          <TableSkeleton rows={6} cols={6} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("no_products")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label={t("select_all")} />
                  </th>
                  <th className="px-4 py-3 text-start font-medium">{t("product_name")}</th>
                  <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t("serial_number")}</th>
                  <th className="px-4 py-3 text-start font-medium hidden md:table-cell">{t("color")}</th>
                  <th className="px-4 py-3 text-start font-medium hidden lg:table-cell">{t("collection")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("price")}</th>
                  <th className="px-4 py-3 text-start font-medium">{t("stock")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((p) => {
                  const low = p.stock_quantity <= p.low_stock_threshold;
                  return (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={p.name} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border bg-muted">
                            {p.image_url ? (
                              <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                            ) : (
                              <ImagePlus className="h-4 w-4 text-muted-foreground/40" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium">{p.name}</div>
                            <AuthorBadge email={p.created_by_email} label="created by" className="mt-0.5" />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{p.serial_number || "—"}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{p.color || "—"}</td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {p.collection ? (
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold ${collectionBadgeClass(p.collection)}`}><span className={`inline-block h-1.5 w-1.5 rounded-full ${collectionDotClass(p.collection)}`} aria-hidden />{p.collection}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{fmtMoney(Number(p.price), "EGP", lang)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${low ? "bg-warning/20 text-warning-foreground" : "bg-success/15 text-success"}`}>
                          {p.stock_quantity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => showQr(p)} title="QR"><QrCode className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => { setAdjustFor(p); setAdjustAmt("0"); setAdjustReason(""); }} title={t("adjust_stock")}>
                            <Sliders className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("confirm_delete")}</AlertDialogTitle>
                                <AlertDialogDescription>{p.name}</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => remove(p.id)}>{t("confirm")}</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* QR preview dialog */}
      <Dialog open={!!qrPreview} onOpenChange={(v) => !v && setQrPreview(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{qrPreview?.name}</DialogTitle></DialogHeader>
          {qrPreview && (
            <div className="flex flex-col items-center gap-4">
              <img src={qrPreview.data} alt="QR" className="h-64 w-64" />
              <a href={qrPreview.data} download={`${qrPreview.name}-qr.png`}>
                <Button variant="outline" className="gap-2"><Download className="h-4 w-4" /> PNG</Button>
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Adjust stock dialog */}
      <Dialog open={!!adjustFor} onOpenChange={(v) => !v && setAdjustFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("adjust_stock")} — {adjustFor?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <div className="mb-1 font-semibold">
                {lang === "ar" ? "المخزون الحالي" : "Current stock"}: <span className="text-base">{adjustFor?.stock_quantity}</span>
              </div>
              <div className="text-muted-foreground">
                {lang === "ar"
                  ? "استخدم + لإضافة كمية و − لخصم. يتم تسجيل العملية في سجل المخزون باسمك والسبب لضمان التتبع الدقيق."
                  : "Use + to add and − to subtract. The action is logged with your name and reason for accurate tracking."}
              </div>
            </div>
            <div>
              <Label>{t("adjust_stock_amount")}</Label>
              <Input type="number" value={adjustAmt} onChange={(e) => setAdjustAmt(e.target.value)} placeholder="+5 / -2" />
              {adjustAmt && parseInt(adjustAmt, 10) !== 0 && adjustFor && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {lang === "ar" ? "المخزون بعد التصحيح: " : "Stock after: "}
                  <span className="font-bold">{adjustFor.stock_quantity + (parseInt(adjustAmt, 10) || 0)}</span>
                </div>
              )}
            </div>
            <div>
              <Label>
                {t("adjust_stock_reason")} <span className="text-destructive">*</span>
              </Label>
              <Input
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder={lang === "ar" ? "مثال: جرد فعلي / تالف / إرجاع مورد" : "e.g. physical count / damaged / supplier return"}
                maxLength={500}
              />
              <div className="mt-1 text-[11px] text-muted-foreground">
                {lang === "ar" ? "إجباري — 3 أحرف على الأقل" : "Required — at least 3 characters"}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdjustFor(null)}>{t("cancel")}</Button>
            <Button onClick={adjustStock}>{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk add stock dialog */}
      <Dialog open={bulkOpen} onOpenChange={(v) => !v && !bulkBusy && setBulkOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5" />
              {lang === "ar" ? "إضافة مخزون لعدة منتجات" : "Bulk add stock"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              {lang === "ar"
                ? "ستُطبَّق نفس الكمية على كل المنتجات المختارة. القيمة الموجبة تضيف، السالبة تخصم. تُسجَّل العملية في سجل المخزون."
                : "The same amount will be applied to every selected product. Positive adds, negative subtracts. Each change is logged."}
            </div>
            <div>
              <Label>{lang === "ar" ? "النطاق" : "Scope"}</Label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setBulkScope("filtered")}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-semibold transition ${bulkScope === "filtered" ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted/50"}`}
                >
                  {lang === "ar" ? `المعروضة فقط (${filtered.length})` : `Filtered only (${filtered.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => setBulkScope("all")}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-semibold transition ${bulkScope === "all" ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted/50"}`}
                >
                  {lang === "ar" ? `كل المنتجات (${list.length})` : `All products (${list.length})`}
                </button>
              </div>
            </div>
            <div>
              <Label>{t("adjust_stock_amount")}</Label>
              <Input type="number" value={bulkAmt} onChange={(e) => setBulkAmt(e.target.value)} placeholder="+10 / -5" />
            </div>
            <div>
              <Label>{t("adjust_stock_reason")} <span className="text-destructive">*</span></Label>
              <Input
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                placeholder={lang === "ar" ? "مثال: استلام شحنة / جرد عام" : "e.g. shipment received / global count"}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>{t("cancel")}</Button>
            <Button onClick={runBulkAdjust} disabled={bulkBusy}>
              {bulkBusy ? (lang === "ar" ? "جارٍ التنفيذ..." : "Processing...") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print sheet — only visible when printing */}
      {labelData && (
        <div className="print-only fixed inset-0 z-50 bg-white p-6 text-black">
          <div className="grid grid-cols-3 gap-3">
            {labelData.map(({ p, data }) => (
              <div key={p.id} className="flex flex-col items-center justify-center rounded border border-gray-300 p-3 text-center" style={{ minHeight: "3.4cm" }}>
                <img src={data} alt="qr" className="h-20 w-20" />
                <div className="mt-1 text-[11px] font-bold leading-tight line-clamp-2">{p.name}</div>
                <div className="text-[9px] text-gray-600">{p.serial_number || ""}{p.color ? ` · ${p.color}` : ""}</div>
                <div className="text-[10px] font-semibold">{fmtMoney(Number(p.price), "EGP", lang)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
