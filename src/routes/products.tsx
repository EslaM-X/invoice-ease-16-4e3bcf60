import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, AlertDialogDescription } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Search, Upload, Download, QrCode } from "lucide-react";
import { toast } from "sonner";
import type { Product } from "@/lib/data";
import { fmtMoney } from "@/lib/utils-money";
import Papa from "papaparse";
import QRCode from "qrcode";

export const Route = createFileRoute("/products")({ component: () => <AppShell><Products /></AppShell> });

function Products() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [list, setList] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ name: "", serial_number: "", color: "", price: "0", stock_quantity: "0", low_stock_threshold: "5" });
  const [qrPreview, setQrPreview] = useState<{ name: string; data: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("products").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setList((data ?? []) as Product[]);
  };
  useEffect(() => { load(); }, [user]);

  const filtered = list.filter((p) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return p.name.toLowerCase().includes(s) || (p.serial_number ?? "").toLowerCase().includes(s);
  });

  const openAdd = () => { setEditing(null); setForm({ name: "", serial_number: "", color: "", price: "0", stock_quantity: "0", low_stock_threshold: "5" }); setOpen(true); };
  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({ name: p.name, serial_number: p.serial_number ?? "", color: p.color ?? "", price: String(p.price), stock_quantity: String(p.stock_quantity), low_stock_threshold: String(p.low_stock_threshold) });
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
      stock_quantity: parseInt(form.stock_quantity || "0", 10),
      low_stock_threshold: parseInt(form.low_stock_threshold || "5", 10),
    };
    if (editing) {
      const { error } = await supabase.from("products").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      // qr_code = product id (set after insert)
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
    const data = await QRCode.toDataURL(p.qr_code || p.id, { width: 320, margin: 2 });
    setQrPreview({ name: p.name, data });
  };

  const exportCsv = () => {
    const rows = list.map((p) => ({
      name: p.name, serial_number: p.serial_number ?? "", color: p.color ?? "",
      price: p.price, stock_quantity: p.stock_quantity, low_stock_threshold: p.low_stock_threshold,
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
        const rows = (res.data as any[]).map((r) => ({
          user_id: user.id,
          name: String(r.name ?? "").trim(),
          serial_number: r.serial_number ? String(r.serial_number) : null,
          color: r.color ? String(r.color) : null,
          price: Number(r.price) || 0,
          stock_quantity: parseInt(r.stock_quantity ?? "0", 10) || 0,
          low_stock_threshold: parseInt(r.low_stock_threshold ?? "5", 10) || 5,
        })).filter((r) => r.name);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("products")}</h1>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2"><Upload className="h-4 w-4" />{t("import_csv")}</Button>
          <Button variant="outline" onClick={exportCsv} className="gap-2"><Download className="h-4 w-4" />{t("export_csv")}</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openAdd} className="gap-2"><Plus className="h-4 w-4" />{t("add_product")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? t("edit_product") : t("add_product")}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Label>{t("product_name")}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>{t("serial_number")}</Label><Input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} /></div>
                <div><Label>{t("color")}</Label><Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
                <div><Label>{t("price")}</Label><Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
                <div><Label>{t("stock")}</Label><Input type="number" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })} /></div>
                <div className="col-span-2"><Label>{t("low_stock_threshold")}</Label><Input type="number" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>{t("cancel")}</Button>
                <Button onClick={save}>{t("save")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-9" />
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{t("no_products")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">{t("product_name")}</th>
                  <th className="px-4 py-3 text-start font-medium hidden sm:table-cell">{t("serial_number")}</th>
                  <th className="px-4 py-3 text-start font-medium hidden md:table-cell">{t("color")}</th>
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
                      <td className="px-4 py-3 font-medium">{p.name}</td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">{p.serial_number || "—"}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{p.color || "—"}</td>
                      <td className="px-4 py-3">{fmtMoney(Number(p.price), "SAR", lang)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${low ? "bg-warning/20 text-warning-foreground" : "bg-success/15 text-success"}`}>
                          {p.stock_quantity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => showQr(p)} title="QR"><QrCode className="h-4 w-4" /></Button>
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
    </div>
  );
}
