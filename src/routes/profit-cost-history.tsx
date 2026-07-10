import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ExecutiveGate } from "@/components/executive-gate";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { useRole } from "@/lib/use-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtMoney, fmtDateTime } from "@/lib/utils-money";
import { toast } from "sonner";
import {
  Download,
  Filter,
  History as HistoryIcon,
  Undo2,
  ArrowLeft,
  Search,
} from "lucide-react";

type HistoryRow = {
  id: string;
  product_id: string;
  action: "insert" | "update" | "delete";
  old_cost_egp: number | null;
  new_cost_egp: number | null;
  old_note: string | null;
  new_note: string | null;
  changed_by: string | null;
  changed_by_email: string | null;
  changed_at: string;
};

type ProductLite = { id: string; name: string; serial_number: string | null; color: string | null };

function ProfitCostHistoryPage() {
  const { lang } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const { role } = useRole();
  const isAdmin = role === "admin";

  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [products, setProducts] = useState<Record<string, ProductLite>>({});
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<"all" | "insert" | "update" | "delete">("all");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async () => {
    setLoading(true);
    const { data: hist, error } = await supabase
      .from("profit_cost_overrides_history" as any)
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(1000);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const list = (hist ?? []) as unknown as HistoryRow[];
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.product_id)));
    if (ids.length) {
      const { data: prods } = await supabase
        .from("products")
        .select("id,name,serial_number,color")
        .in("id", ids);
      const map: Record<string, ProductLite> = {};
      for (const p of (prods ?? []) as ProductLite[]) map[p.id] = p;
      setProducts(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useRealtimeTable("profit_cost_overrides_history", () => load());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromISO = from ? new Date(from + "T00:00:00").toISOString() : null;
    const toISO = to ? new Date(to + "T23:59:59.999").toISOString() : null;
    const actorQ = actor.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      if (fromISO && r.changed_at < fromISO) return false;
      if (toISO && r.changed_at > toISO) return false;
      if (actorQ && !(r.changed_by_email ?? "").toLowerCase().includes(actorQ)) return false;
      if (q) {
        const p = products[r.product_id];
        const hay = [
          p?.name ?? "",
          p?.serial_number ?? "",
          p?.color ?? "",
          r.old_note ?? "",
          r.new_note ?? "",
          r.product_id,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, products, search, actionFilter, actor, from, to]);

  const stats = useMemo(() => {
    let ins = 0, upd = 0, del = 0;
    for (const r of filtered) {
      if (r.action === "insert") ins++;
      else if (r.action === "update") upd++;
      else del++;
    }
    return { total: filtered.length, ins, upd, del };
  }, [filtered]);

  const exportCsv = () => {
    const header = [
      "changed_at",
      "action",
      "product_id",
      "product_name",
      "serial",
      "color",
      "old_cost_egp",
      "new_cost_egp",
      "delta_egp",
      "old_note",
      "new_note",
      "changed_by_email",
    ];
    const escape = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of filtered) {
      const p = products[r.product_id];
      const delta =
        r.new_cost_egp != null && r.old_cost_egp != null
          ? Number(r.new_cost_egp) - Number(r.old_cost_egp)
          : "";
      lines.push(
        [
          r.changed_at,
          r.action,
          r.product_id,
          p?.name ?? "",
          p?.serial_number ?? "",
          p?.color ?? "",
          r.old_cost_egp ?? "",
          r.new_cost_egp ?? "",
          delta,
          r.old_note ?? "",
          r.new_note ?? "",
          r.changed_by_email ?? "",
        ]
          .map(escape)
          .join(","),
      );
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `profit-cost-overrides-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t("تم تصدير CSV", "CSV exported"));
  };

  const revert = async (h: HistoryRow) => {
    if (!isAdmin) return;
    setReverting(h.id);
    const { error } = await supabase.rpc("revert_profit_cost_override" as any, {
      p_history_id: h.id,
    });
    setReverting(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("تم الرجوع للقيمة السابقة", "Reverted"));
    await load();
  };

  const actionBadge = (a: HistoryRow["action"]) => {
    const cls =
      a === "insert"
        ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
        : a === "update"
          ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
          : "bg-rose-500/15 text-rose-600 border-rose-500/30";
    const label =
      a === "insert" ? t("إضافة", "Insert") : a === "update" ? t("تعديل", "Update") : t("حذف", "Delete");
    return (
      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>
        {label}
      </span>
    );
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link to="/profits">
              <Button variant="ghost" size="sm" className="gap-1">
                <ArrowLeft className="h-4 w-4" />
                {t("العودة لصافي الأرباح", "Back to Profits")}
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <HistoryIcon className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold sm:text-2xl">
                {t("سجل تعديلات تكلفة الأرباح", "Profit Cost Overrides — Audit Log")}
              </h1>
            </div>
          </div>
          <Button onClick={exportCsv} className="gap-2" size="sm">
            <Download className="h-4 w-4" />
            {t("تصدير CSV", "Export CSV")}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: t("الإجمالي", "Total"), value: stats.total, cls: "text-foreground" },
            { label: t("إضافة", "Insert"), value: stats.ins, cls: "text-emerald-600" },
            { label: t("تعديل", "Update"), value: stats.upd, cls: "text-amber-600" },
            { label: t("حذف", "Delete"), value: stats.del, cls: "text-rose-600" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border bg-card p-3">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className={`text-2xl font-semibold ${s.cls}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Filter className="h-4 w-4" />
            {t("الفلاتر", "Filters")}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <Label className="text-xs">{t("بحث", "Search")}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="ps-7"
                  placeholder={t("منتج، سيريال، لون، ملاحظة...", "Product, serial, color, note...")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("النوع", "Action")}</Label>
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value as any)}
              >
                <option value="all">{t("الكل", "All")}</option>
                <option value="insert">{t("إضافة", "Insert")}</option>
                <option value="update">{t("تعديل", "Update")}</option>
                <option value="delete">{t("حذف", "Delete")}</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">{t("المستخدم", "Actor email")}</Label>
              <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="admin@..." />
            </div>
            <div>
              <Label className="text-xs">{t("من", "From")}</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t("إلى", "To")}</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          {(search || actionFilter !== "all" || actor || from || to) && (
            <div className="mt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setActionFilter("all");
                  setActor("");
                  setFrom("");
                  setTo("");
                }}
              >
                {t("مسح الفلاتر", "Clear filters")}
              </Button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 text-start">{t("التاريخ", "When")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-start">{t("النوع", "Action")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-start">{t("المنتج", "Product")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-end">{t("قبل (EGP)", "Old (EGP)")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-end">{t("بعد (EGP)", "New (EGP)")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-end">{t("الفرق", "Δ")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-start">{t("ملاحظة", "Note")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-start">{t("المستخدم", "By")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-end">{t("إجراء", "Action")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                    {t("...جارِ التحميل", "Loading…")}
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                    {t("لا توجد سجلات مطابقة.", "No matching history entries.")}
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const p = products[r.product_id];
                const delta =
                  r.new_cost_egp != null && r.old_cost_egp != null
                    ? Number(r.new_cost_egp) - Number(r.old_cost_egp)
                    : null;
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/20">
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{fmtDateTime(r.changed_at, lang)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{actionBadge(r.action)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{p?.name ?? r.product_id.slice(0, 8)}</div>
                      <div className="text-xs text-muted-foreground">
                        {p?.serial_number ?? "—"}
                        {p?.color ? ` · ${p.color}` : ""}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums">
                      {r.old_cost_egp != null ? fmtMoney(Number(r.old_cost_egp), "EGP", lang) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums">
                      {r.new_cost_egp != null ? fmtMoney(Number(r.new_cost_egp), "EGP", lang) : "—"}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-end tabular-nums ${
                        delta == null ? "" : delta > 0 ? "text-rose-600" : delta < 0 ? "text-emerald-600" : ""
                      }`}
                    >
                      {delta == null ? "—" : (delta > 0 ? "+" : "") + fmtMoney(delta, "EGP", lang)}
                    </td>
                    <td className="max-w-[280px] px-3 py-2 text-xs text-muted-foreground">
                      {r.new_note || r.old_note || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {r.changed_by_email ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-end">
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                          onClick={() => revert(r)}
                          disabled={reverting === r.id}
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          {reverting === r.id ? t("...", "…") : t("تراجع", "Revert")}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-muted-foreground">
          {t(
            "يعرض آخر 1000 سجل. استخدم الفلاتر ثم صدّر CSV لسجلات أقدم.",
            "Showing latest 1000 rows. Use filters, then export CSV for archival.",
          )}
        </div>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/profit-cost-history")({
  head: () => ({
    meta: [
      { title: "سجل تعديلات تكلفة الأرباح — Profit Cost Overrides Audit" },
      {
        name: "description",
        content:
          "Admin audit log of every manual profit-cost override change, with filtering, revert, and CSV export.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ExecutiveGate>
      <ProfitCostHistoryPage />
    </ExecutiveGate>
  ),
});
