import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, Plus, Trash2, Bell, ChevronLeft, ChevronRight, Package, Sparkles } from "lucide-react";
import { toast } from "sonner";

type Ev = {
  id: string;
  title: string;
  notes: string | null;
  kind: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  remind_before_minutes: number[];
};

const KIND_OPTS = [
  { value: "event", labelAr: "مناسبة", labelEn: "Event", icon: Sparkles },
  { value: "shipment", labelAr: "وصول شحنة", labelEn: "Shipment arrival", icon: Package },
  { value: "reminder", labelAr: "تذكير", labelEn: "Reminder", icon: Bell },
  { value: "milestone", labelAr: "محطّة", labelEn: "Milestone", icon: CalendarDays },
];

const REMIND_PRESETS = [
  { mins: 15, ar: "ربع ساعة قبل", en: "15 min before" },
  { mins: 60, ar: "ساعة قبل", en: "1 hour before" },
  { mins: 1440, ar: "يوم قبل", en: "1 day before" },
  { mins: 4320, ar: "٣ أيام قبل", en: "3 days before" },
];

function localInputToISO(v: string) {
  // v is "YYYY-MM-DDTHH:mm" in local time
  return new Date(v).toISOString();
}
function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function XCalendar() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [events, setEvents] = useState<Ev[]>([]);
  const [openForm, setOpenForm] = useState(false);
  const [form, setForm] = useState(() => ({
    title: "",
    notes: "",
    kind: "event",
    starts_at: isoToLocalInput(new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    remind: [60, 1440] as number[],
  }));

  const load = async () => {
    if (!user) return;
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setMonth(end.getMonth() + 1);
    const { data } = await supabase
      .from("x_calendar_events")
      .select("id,title,notes,kind,starts_at,ends_at,all_day,remind_before_minutes")
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString())
      .order("starts_at");
    setEvents((data ?? []) as Ev[]);
  };
  useEffect(() => {
    load();
    // Listen for cross-component refresh (e.g. assistant created an event)
    const onRefresh = () => load();
    window.addEventListener("x:calendar:refresh", onRefresh);
    return () => window.removeEventListener("x:calendar:refresh", onRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, cursor]);

  const grid = useMemo(() => {
    const first = new Date(cursor);
    const start = new Date(first);
    start.setDate(1 - first.getDay()); // start week from Sunday
    const cells: { date: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push({ date: d, inMonth: d.getMonth() === cursor.getMonth() });
    }
    return cells;
  }, [cursor]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of events) {
      const d = new Date(e.starts_at);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [events]);

  const save = async () => {
    if (!user) return;
    if (!form.title.trim()) return toast.error(ar ? "اكتب عنوان" : "Title required");
    const { error } = await supabase.from("x_calendar_events").insert({
      user_id: user.id,
      title: form.title.trim(),
      notes: form.notes.trim() || null,
      kind: form.kind,
      starts_at: localInputToISO(form.starts_at),
      remind_before_minutes: form.remind,
    });
    if (error) return toast.error(error.message);
    toast.success(ar ? "اتسجّلت في الكلندر ✨" : "Saved to calendar ✨");
    setOpenForm(false);
    setForm({ ...form, title: "", notes: "" });
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("x_calendar_events").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setEvents((es) => es.filter((e) => e.id !== id));
  };

  const monthLabel = cursor.toLocaleDateString(ar ? "ar-EG" : "en-US", { month: "long", year: "numeric" });
  const weekdays = ar
    ? ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">{ar ? "الكلندر الذكي" : "Smart Calendar"}</h3>
        </div>
        <Button size="sm" className="gap-2 rounded-full" onClick={() => setOpenForm((s) => !s)}>
          <Plus className="h-4 w-4" />
          {ar ? "إضافة" : "Add"}
        </Button>
      </div>

      {openForm && (
        <div className="mb-4 space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{ar ? "العنوان" : "Title"}</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={ar ? "مثال: وصول شحنة الخلاطات" : "e.g. Mixers shipment"} />
            </div>
            <div>
              <Label>{ar ? "النوع" : "Type"}</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KIND_OPTS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>{ar ? k.labelAr : k.labelEn}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{ar ? "التاريخ والوقت" : "Date & time"}</Label>
              <Input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
            </div>
            <div>
              <Label>{ar ? "التذكيرات قبل الميعاد" : "Reminders"}</Label>
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                {REMIND_PRESETS.map((p) => {
                  const on = form.remind.includes(p.mins);
                  return (
                    <button
                      key={p.mins}
                      type="button"
                      onClick={() => setForm({ ...form, remind: on ? form.remind.filter((x) => x !== p.mins) : [...form.remind, p.mins] })}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
                    >
                      {ar ? p.ar : p.en}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div>
            <Label>{ar ? "ملاحظات" : "Notes"}</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpenForm(false)}>{ar ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={save}>{ar ? "حفظ" : "Save"}</Button>
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => setCursor((d) => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; })}>
          {ar ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
        <p className="font-medium">{monthLabel}</p>
        <Button variant="ghost" size="icon" onClick={() => setCursor((d) => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; })}>
          {ar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {weekdays.map((w) => (<div key={w} className="py-1">{w}</div>))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.map(({ date, inMonth }) => {
          const k = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
          const dayEvents = eventsByDay.get(k) ?? [];
          const isToday = new Date().toDateString() === date.toDateString();
          return (
            <div
              key={k}
              className={`min-h-20 rounded-lg border p-1.5 text-xs ${inMonth ? "bg-background" : "bg-muted/30 text-muted-foreground/60"} ${isToday ? "border-primary" : "border-border"}`}
            >
              <div className={`mb-1 text-[10px] font-semibold ${isToday ? "text-primary" : ""}`}>{date.getDate()}</div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <div key={e.id} className="group flex items-center justify-between gap-1 truncate rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                    <span className="truncate">{e.title}</span>
                    <button
                      onClick={() => remove(e.id)}
                      className="hidden group-hover:block"
                      title={ar ? "حذف" : "Delete"}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {dayEvents.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayEvents.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {events.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">{ar ? "كل مناسبات الشهر" : "All this month"}</p>
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(e.starts_at).toLocaleString(ar ? "ar-EG" : "en-US")}
                    {e.notes ? ` · ${e.notes}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(e.id)} title={ar ? "حذف" : "Delete"}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
