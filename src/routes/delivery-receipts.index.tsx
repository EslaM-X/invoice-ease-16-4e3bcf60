import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Eye, Trash2, Pencil, ClipboardCheck, FileDown, Archive, X } from "lucide-react";
import { fmtDate, fmtDateTime } from "@/lib/utils-money";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useRealtimeTable } from "@/lib/realtime";
import { TableSkeleton } from "@/components/skeletons";
import { elementToPdf } from "@/lib/delivery-receipts";
import steinheimLogo from "@/assets/steinheim-logo.png";
import { getSettings } from "@/lib/data";

export const Route = createFileRoute("/delivery-receipts/")({
  component: () => <AppShell><ReceiptsList /></AppShell>,
});

function ReceiptsList() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [rows, setRows] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<"" | "pdf" | "zip">("");
  const navigate = useNavigate();
  const stagingRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("delivery_receipts" as any)
      .select("*")
      .order("created_at", { ascending: false });
    const list = (data ?? []) as any[];
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.invoice_id)));
    if (ids.length > 0) {
      const { data: invs } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, customer_phone, customer_address, total, delivery_status")
        .in("id", ids);
      const map: Record<string, any> = {};
      (invs ?? []).forEach((i: any) => (map[i.id] = i));
      setInvoices(map);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [user]);
  useRealtimeTable("delivery_receipts" as any, () => load());

  const filtered = rows.filter((r) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    const inv = invoices[r.invoice_id];
    return (
      r.receipt_number?.toLowerCase().includes(s) ||
      r.delivered_to_name?.toLowerCase().includes(s) ||
      inv?.invoice_number?.toLowerCase().includes(s) ||
      inv?.customer_name?.toLowerCase().includes(s)
    );
  });

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const deleteOne = async (id: string) => {
    const { error } = await supabase.from("delivery_receipts" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(isAr ? "تم الحذف" : "Deleted");
    load();
  };

  const renderReceiptToElement = async (receiptId: string): Promise<HTMLDivElement> => {
    const { data: rec } = await supabase.from("delivery_receipts" as any).select("*").eq("id", receiptId).single();
    const { data: items } = await supabase.from("delivery_receipt_items" as any).select("*").eq("receipt_id", receiptId);
    const r: any = rec;
    const inv = invoices[r.invoice_id] || (await supabase.from("invoices").select("*").eq("id", r.invoice_id).single()).data;
    let logoUrl: string | null = null;
    if (user) {
      const s = await getSettings(user.id);
      if (s?.logo_url) {
        const { data: signed } = await supabase.storage.from("logos").createSignedUrl(s.logo_url, 3600);
        if (signed?.signedUrl) logoUrl = signed.signedUrl;
      }
    }
    const wrap = document.createElement("div");
    wrap.style.width = "800px";
    wrap.style.background = "#fff";
    document.body.appendChild(wrap);
    const root = createRoot(wrap);
    await new Promise<void>((resolve) => {
      root.render(<PrintableReceipt r={r} items={items || []} invoice={inv} logoUrl={logoUrl} isAr={isAr} />);
      setTimeout(resolve, 600);
    });
    return wrap;
  };

  const exportSelectedCombined = async () => {
    if (selected.size === 0) return;
    setExporting("pdf");
    try {
      const { default: jsPDF } = await import("jspdf");
      const ids = filtered.filter((r) => selected.has(r.id)).map((r) => r.id);
      const finalPdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      let first = true;
      for (const id of ids) {
        const el = await renderReceiptToElement(id);
        const pdf = await elementToPdf(el);
        const pages = pdf.getNumberOfPages();
        for (let p = 1; p <= pages; p++) {
          if (!first) finalPdf.addPage();
          first = false;
          const dataUrl = (pdf as any).internal.pages[p];
          // simpler: re-render by adding image from canvas of page – use built-in page copy
          const blob = pdf.output("arraybuffer");
          // fallback: convert each page via dataURL not trivial. Use single image per receipt.
          void dataUrl; void blob;
          break;
        }
        // simpler approach: render the element again as one image and add as one (or more) pages
        const { default: html2canvas } = await import("html2canvas");
        const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
        const imgData = canvas.toDataURL("image/jpeg", 0.92);
        const pageW = finalPdf.internal.pageSize.getWidth();
        const pageH = finalPdf.internal.pageSize.getHeight();
        const imgW = pageW;
        const imgH = (canvas.height * imgW) / canvas.width;
        let heightLeft = imgH;
        let position = 0;
        finalPdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
        heightLeft -= pageH;
        while (heightLeft > 0) {
          position = heightLeft - imgH;
          finalPdf.addPage();
          finalPdf.addImage(imgData, "JPEG", 0, position, imgW, imgH);
          heightLeft -= pageH;
        }
        document.body.removeChild(el);
      }
      finalPdf.save(`delivery-receipts-${ids.length}.pdf`);
      toast.success(isAr ? "تم التصدير" : "Exported");
    } catch (e: any) {
      toast.error(e?.message || "PDF error");
    } finally {
      setExporting("");
    }
  };

  const exportSelectedZip = async () => {
    if (selected.size === 0) return;
    setExporting("zip");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const ids = filtered.filter((r) => selected.has(r.id));
      for (const row of ids) {
        const el = await renderReceiptToElement(row.id);
        const pdf = await elementToPdf(el);
        const blob = pdf.output("blob");
        zip.file(`${row.receipt_number}.pdf`, blob);
        document.body.removeChild(el);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `delivery-receipts-${ids.length}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(isAr ? "تم التصدير" : "Exported");
    } catch (e: any) {
      toast.error(e?.message || "ZIP error");
    } finally {
      setExporting("");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient-gold">
            {isAr ? "محاضر الاستلام" : "Delivery Receipts"}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {isAr
              ? "أنشئ محاضر استلام للفواتير. حدّد عدة محاضر لتصديرها معاً."
              : "Create delivery receipts. Select multiple to export together."}
          </p>
        </div>
        <Button onClick={() => navigate({ to: "/delivery-receipts/new" })} className="gap-2 shadow-glow">
          <Plus className="h-4 w-4" /> {isAr ? "محضر جديد" : "New receipt"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={isAr ? "ابحث برقم المحضر، الفاتورة أو اسم العميل…" : "Search…"}
            className="ps-9"
          />
        </div>
        {selected.size > 0 && (
          <>
            <span className="text-xs text-muted-foreground">{isAr ? `محدد: ${selected.size}` : `${selected.size} selected`}</span>
            <Button size="sm" variant="outline" onClick={exportSelectedCombined} disabled={!!exporting} className="gap-2">
              <FileDown className="h-4 w-4" />{exporting === "pdf" ? "..." : (isAr ? "PDF موحد" : "Combined PDF")}
            </Button>
            <Button size="sm" variant="outline" onClick={exportSelectedZip} disabled={!!exporting} className="gap-2">
              <Archive className="h-4 w-4" />{exporting === "zip" ? "..." : (isAr ? "ZIP منفصل" : "ZIP")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="gap-1">
              <X className="h-3 w-3" />{isAr ? "إلغاء" : "Clear"}
            </Button>
          </>
        )}
      </div>

      <div className="surface-elevated overflow-hidden rounded-2xl border bg-card">
        {loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <ClipboardCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />
            {isAr ? "لا يوجد محاضر بعد" : "No receipts yet"}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <Checkbox
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                  <th className="px-3 py-3 text-start">{isAr ? "رقم المحضر" : "Receipt #"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "الفاتورة" : "Invoice"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "المستلم" : "Recipient"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "التاريخ" : "Date"}</th>
                  <th className="px-3 py-3 text-start">{isAr ? "الحالة" : "Status"}</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => {
                  const inv = invoices[r.invoice_id];
                  return (
                    <tr key={r.id} className={`hover:bg-muted/30 ${selected.has(r.id) ? "bg-primary/5" : ""}`}>
                      <td className="px-3 py-3">
                        <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} />
                      </td>
                      <td className="px-3 py-3 font-mono font-medium">{r.receipt_number}</td>
                      <td className="px-3 py-3">
                        {inv ? (
                          <Link to="/invoices/$id" params={{ id: r.invoice_id }} className="text-primary hover:underline">
                            {inv.invoice_number}
                          </Link>
                        ) : ("—")}
                        <div className="text-[11px] text-muted-foreground">{inv?.customer_name}</div>
                      </td>
                      <td className="px-3 py-3">{r.delivered_to_name || "—"}</td>
                      <td className="px-3 py-3 text-muted-foreground">{fmtDate(r.delivered_at, lang)}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          r.status === "signed"
                            ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        }`}>
                          {r.status === "signed" ? (isAr ? "موقّع" : "Signed") : (isAr ? "مسودة" : "Draft")}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <Link to="/delivery-receipts/$id" params={{ id: r.id }}>
                            <Button variant="ghost" size="icon" title={isAr ? "عرض" : "View"}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Link to="/delivery-receipts/$id/edit" params={{ id: r.id }}>
                            <Button variant="ghost" size="icon" title={isAr ? "تعديل" : "Edit"}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" title={isAr ? "حذف" : "Delete"}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{isAr ? "حذف المحضر" : "Delete receipt"}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {r.receipt_number} — {isAr ? "هل أنت متأكد؟" : "Are you sure?"}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{isAr ? "إلغاء" : "Cancel"}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteOne(r.id)}>
                                  {isAr ? "تأكيد" : "Confirm"}
                                </AlertDialogAction>
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
      <div ref={stagingRef} style={{ position: "fixed", left: -99999, top: 0, opacity: 0 }} />
    </div>
  );
}

function PrintableReceipt({ r, items, invoice, logoUrl, isAr }: { r: any; items: any[]; invoice: any; logoUrl: string | null; isAr: boolean }) {
  const { lang } = useI18n();
  const shipping = r.shipping_fees != null ? Number(r.shipping_fees) : null;
  return (
    <div className="bg-white text-black" style={{ padding: "32px 48px" }} dir="ltr">
      <header style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: 8 }}>
        <div style={{ position: "absolute", top: 0, left: 0, fontSize: 11, lineHeight: 1.3 }}>
          <div>السجل التجاري: <span style={{ fontWeight: 600 }}>68689</span></div>
          <div>البطاقة الضريبية: <span style={{ fontWeight: 600 }}>450374114</span></div>
        </div>
        <div style={{ position: "absolute", top: 0, right: 0, fontSize: 11, textAlign: "right", lineHeight: 1.3 }}>
          <div>{fmtDateTime(r.delivered_at, lang)}</div>
          {r.created_by_email && <div style={{ fontSize: 10, color: "#444" }}>{r.created_by_email}</div>}
        </div>
        <img src={logoUrl || steinheimLogo} alt="" style={{ height: 96, width: "auto", objectFit: "contain", filter: "brightness(0)" }} crossOrigin="anonymous" />
      </header>
      <div style={{ marginTop: 16, textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{isAr ? "محضر استلام" : "DELIVERY RECEIPT"}</div>
        <div style={{ marginTop: 4, fontSize: 13 }}>
          {isAr ? "رقم المحضر:" : "Receipt #:"} <b>{r.receipt_number}</b>
          {invoice && <span style={{ marginInlineStart: 12 }}>{isAr ? "للفاتورة:" : "Invoice:"} <b>{invoice.invoice_number}</b></span>}
        </div>
      </div>
      <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 13 }} dir={isAr ? "rtl" : "ltr"}>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#555" }}>{isAr ? "العميل" : "Customer"}</div>
          <div style={{ fontWeight: 600 }}>{invoice?.customer_name || "—"}</div>
          {invoice?.customer_phone && <div style={{ fontSize: 11 }}>{invoice.customer_phone}</div>}
        </div>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "#555" }}>{isAr ? "المستلم" : "Recipient"}</div>
          <div style={{ fontWeight: 600 }}>{r.delivered_to_name || (isAr ? "(يوقّع المستلم أدناه)" : "(see signature)")}</div>
          {r.delivered_to_phone && <div style={{ fontSize: 11 }}>{r.delivered_to_phone}</div>}
        </div>
      </div>
      <table style={{ marginTop: 20, width: "100%", borderCollapse: "collapse", fontSize: 13 }} dir={isAr ? "rtl" : "ltr"}>
        <thead>
          <tr>
            <th style={{ border: "1px solid #888", padding: 8, width: "12%" }}>{isAr ? "الكود" : "Code"}</th>
            <th style={{ border: "1px solid #888", padding: 8 }}>{isAr ? "المنتج" : "Product"}</th>
            <th style={{ border: "1px solid #888", padding: 8, width: "12%" }}>{isAr ? "الكمية" : "Qty"}</th>
            <th style={{ border: "1px solid #888", padding: 8, width: "35%" }}>{isAr ? "ملاحظة" : "Note"}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td style={{ border: "1px solid #888", padding: 8, textAlign: "center", fontSize: 11 }}>{it.serial_number || "—"}</td>
              <td style={{ border: "1px solid #888", padding: 8 }}>
                <div style={{ fontWeight: 500 }}>{it.product_name}</div>
                {it.color && <div style={{ fontSize: 11, color: "#555" }}>{isAr ? "اللون:" : "Color:"} {it.color}</div>}
              </td>
              <td style={{ border: "1px solid #888", padding: 8, textAlign: "center", fontWeight: 600 }}>{it.quantity}</td>
              <td style={{ border: "1px solid #888", padding: 8, fontSize: 11 }}>{it.note || ""}</td>
            </tr>
          ))}
          {shipping != null && shipping > 0 && (
            <tr style={{ background: "#f7f7f7" }}>
              <td style={{ border: "1px solid #888", padding: 8, textAlign: "center", fontSize: 11 }}>—</td>
              <td style={{ border: "1px solid #888", padding: 8, fontWeight: 600 }}>{isAr ? "رسوم الشحن" : "Shipping fees"}</td>
              <td style={{ border: "1px solid #888", padding: 8, textAlign: "center", fontWeight: 600 }}>{shipping.toLocaleString()}</td>
              <td style={{ border: "1px solid #888", padding: 8 }}></td>
            </tr>
          )}
        </tbody>
      </table>
      {r.notes && (
        <div style={{ marginTop: 20, fontSize: 12 }} dir={isAr ? "rtl" : "ltr"}>
          <b>{isAr ? "ملاحظات:" : "Notes:"}</b>
          <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{r.notes}</p>
        </div>
      )}
      <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, fontSize: 12 }} dir={isAr ? "rtl" : "ltr"}>
        {[
          { title: isAr ? "توقيع المستلم" : "Recipient", name: r.delivered_to_name, sig: r.signature_customer },
          { title: isAr ? "مدير الحسابات" : "Accountant", name: r.accountant_name, sig: r.signature_accountant },
        ].map((b, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "#555" }}>{b.title}</div>
            <div style={{ height: 80, border: "1px solid #ccc", display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", marginTop: 4 }}>
              {b.sig ? <img src={b.sig} alt="" style={{ maxHeight: "100%", maxWidth: "100%" }} /> : <span style={{ fontSize: 10, color: "#aaa" }}>—</span>}
            </div>
            <div style={{ marginTop: 4, borderTop: "1px solid #888", paddingTop: 4, fontSize: 11, fontWeight: 500 }}>{b.name || ""}</div>
          </div>
        ))}
      </div>
      <footer style={{ marginTop: 24, borderTop: "1px solid #ccc", paddingTop: 8, textAlign: "center", fontSize: 10.5, lineHeight: 1.5 }}>
        <div>403 - Fourth Floor - Unit 238 - 5th Settlement Urban Center - Cairo – Egypt</div>
        <div>Tel: (+20) 12 23998124 / Email: inquiries@steinheim-eg.com / Web Site: www.steinheim-eg.com</div>
      </footer>
    </div>
  );
}
