import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDateTime } from "@/lib/utils-money";
import { StickyNote, Phone, PhoneIncoming, PhoneOutgoing, ExternalLink, History, Search } from "lucide-react";

type NoteRow = {
  id: string;
  invoice_id: string;
  old_value: string | null;
  new_value: string | null;
  changed_by_email: string | null;
  changed_at: string;
};

type CallRow = {
  id: string;
  call_type: "incoming" | "outgoing";
  customer_name: string | null;
  customer_phone: string | null;
  summary: string | null;
  outcome: string | null;
  agent_email: string | null;
  called_at: string;
  duration_seconds: number;
};

const PAGE_SIZE = 10;

export function InvoiceActivityPanel({ invoiceId, compact = false }: { invoiceId: string; compact?: boolean }) {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [currentNote, setCurrentNote] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [callsLimit, setCallsLimit] = useState(PAGE_SIZE);
  const [notesLimit, setNotesLimit] = useState(PAGE_SIZE);

  const load = async () => {
    const [{ data: n }, { data: c }, { data: inv }] = await Promise.all([
      supabase.from("invoice_system_notes_history" as any).select("*").eq("invoice_id", invoiceId).order("changed_at", { ascending: false }).limit(500),
      supabase.from("call_logs").select("id,call_type,customer_name,customer_phone,summary,outcome,agent_email,called_at,duration_seconds").eq("invoice_id", invoiceId).order("called_at", { ascending: false }).limit(500),
      supabase.from("invoices").select("system_notes" as any).eq("id", invoiceId).maybeSingle(),
    ]);
    setNotes((n as any) ?? []);
    setCalls((c as any) ?? []);
    setCurrentNote((inv as any)?.system_notes ?? null);
  };

  useEffect(() => { load(); }, [invoiceId]);
  useRealtimeTable("invoice_system_notes_history" as any, (p) => { if (p.new?.invoice_id === invoiceId) load(); }, [invoiceId]);
  useRealtimeTable("call_logs", (p) => { if (p.new?.invoice_id === invoiceId || p.old?.invoice_id === invoiceId) load(); }, [invoiceId]);

  const q = search.trim().toLowerCase();
  const filteredCalls = useMemo(() => {
    if (!q) return calls;
    return calls.filter((c) =>
      (c.customer_name ?? "").toLowerCase().includes(q) ||
      (c.customer_phone ?? "").toLowerCase().includes(q) ||
      (c.summary ?? "").toLowerCase().includes(q) ||
      (c.outcome ?? "").toLowerCase().includes(q) ||
      (c.agent_email ?? "").toLowerCase().includes(q)
    );
  }, [calls, q]);
  const filteredNotes = useMemo(() => {
    if (!q) return notes;
    return notes.filter((n) =>
      (n.old_value ?? "").toLowerCase().includes(q) ||
      (n.new_value ?? "").toLowerCase().includes(q) ||
      (n.changed_by_email ?? "").toLowerCase().includes(q)
    );
  }, [notes, q]);

  // Reset paging when filter changes
  useEffect(() => { setCallsLimit(PAGE_SIZE); setNotesLimit(PAGE_SIZE); }, [q]);

  const fmtDur = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <Card className={`p-4 ${compact ? "" : "space-y-4"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-violet-600" />
          {isAr ? "الملاحظات الداخلية وسجل المكالمات" : "Internal notes & call log"}
        </div>
        <div className="relative ms-auto flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? "ابحث في الملاحظات والمكالمات…" : "Search notes & calls…"}
            className="h-8 ps-7 text-xs"
          />
        </div>
      </div>

      {currentNote && (
        <div className="mt-3 rounded-md border bg-amber-50/50 dark:bg-amber-500/5 border-amber-500/30 p-3">
          <div className="flex items-center gap-1.5 mb-1 text-xs font-medium text-amber-700 dark:text-amber-400">
            <StickyNote className="h-3.5 w-3.5" />
            {isAr ? "الملاحظة الداخلية الحالية" : "Current internal note"}
          </div>
          <div className="text-sm whitespace-pre-wrap">{currentNote}</div>
        </div>
      )}

      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>
            {isAr ? `سجل المكالمات (${filteredCalls.length}${q ? ` / ${calls.length}` : ""})` : `Call log (${filteredCalls.length}${q ? ` / ${calls.length}` : ""})`}
          </span>
          <Link to="/call-center"><Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]"><ExternalLink className="h-3 w-3" />{isAr ? "مركز الاتصال" : "Call center"}</Button></Link>
        </div>
        {filteredCalls.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            <Phone className="mx-auto h-4 w-4 mb-1 opacity-50" />
            {q ? (isAr ? "لا توجد نتائج للبحث" : "No matches") : (isAr ? "لا توجد مكالمات مرتبطة." : "No calls linked.")}
          </div>
        ) : (
          <>
            <ol className="space-y-2">
              {filteredCalls.slice(0, callsLimit).map((c) => (
                <li key={c.id} className="rounded-md border bg-muted/20 p-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.call_type === "incoming" ? (
                      <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700"><PhoneIncoming className="h-3 w-3" />{isAr ? "وارد" : "Incoming"}</Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 border-blue-500/40 bg-blue-500/10 text-blue-700"><PhoneOutgoing className="h-3 w-3" />{isAr ? "صادر" : "Outgoing"}</Badge>
                    )}
                    <span className="font-medium">{c.customer_name || c.customer_phone || "—"}</span>
                    {c.outcome && <Badge variant="outline" className="text-[10px]">{c.outcome}</Badge>}
                    <span className="ms-auto tabular-nums text-muted-foreground">{fmtDur(c.duration_seconds)}</span>
                  </div>
                  {c.summary && <div className="mt-1 text-foreground">{c.summary}</div>}
                  <div className="mt-1 text-[10px] text-muted-foreground">{fmtDateTime(c.called_at, lang)}{c.agent_email ? ` · ${c.agent_email}` : ""}</div>
                </li>
              ))}
            </ol>
            {filteredCalls.length > callsLimit && (
              <Button variant="ghost" size="sm" className="mt-2 h-7 w-full text-[11px]" onClick={() => setCallsLimit((l) => l + PAGE_SIZE)}>
                {isAr ? `عرض المزيد (${filteredCalls.length - callsLimit})` : `Show more (${filteredCalls.length - callsLimit})`}
              </Button>
            )}
          </>
        )}
      </div>

      <div className="mt-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          {isAr ? `تعديلات الملاحظات (${filteredNotes.length}${q ? ` / ${notes.length}` : ""})` : `Notes changes (${filteredNotes.length}${q ? ` / ${notes.length}` : ""})`}
        </div>
        {filteredNotes.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
            {q ? (isAr ? "لا توجد نتائج للبحث" : "No matches") : (isAr ? "لا توجد تعديلات." : "No note changes yet.")}
          </div>
        ) : (
          <>
            <ol className="space-y-1.5">
              {filteredNotes.slice(0, notesLimit).map((n) => (
                <li key={n.id} className="rounded-md border bg-muted/10 px-2.5 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>{fmtDateTime(n.changed_at, lang)}</span>
                    {n.changed_by_email && <span>{n.changed_by_email}</span>}
                  </div>
                  {n.old_value && <div className="mt-1 line-through opacity-60">{n.old_value}</div>}
                  {n.new_value && <div className="mt-0.5 text-foreground">{n.new_value}</div>}
                </li>
              ))}
            </ol>
            {filteredNotes.length > notesLimit && (
              <Button variant="ghost" size="sm" className="mt-2 h-7 w-full text-[11px]" onClick={() => setNotesLimit((l) => l + PAGE_SIZE)}>
                {isAr ? `عرض المزيد (${filteredNotes.length - notesLimit})` : `Show more (${filteredNotes.length - notesLimit})`}
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
