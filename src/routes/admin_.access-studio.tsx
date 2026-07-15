import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { SuperAdminGate } from "@/components/super-admin-gate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Users, Search, Eye, Save, UserPlus, ShieldCheck,
  Loader2, LayoutDashboard, ListChecks, Sparkles, GripVertical, CheckCircle2, Copy,
  Undo2, Redo2, Layers, Info,
} from "lucide-react";
import {
  listCompanyMembers, loadUserPrefs, saveUserPrefs, createCompanyAccount, applyPrefsToRole,
} from "@/lib/access-studio.functions";
import {
  NAV_TOP_ORDER, NAV_GROUPS, NAV_ITEMS, NAV_GROUP_BY_KEY, navChildrenOf,
  DASHBOARD_CARDS, labelOf,
} from "@/lib/nav-catalog";
import { useI18n } from "@/lib/i18n";
import { setImpersonateId } from "@/lib/use-ui-prefs";
import { useHistoryState } from "@/lib/use-history-state";

export const Route = createFileRoute("/admin_/access-studio")({
  component: () => (
    <SuperAdminGate>
      <AppShell><AccessStudio /></AppShell>
    </SuperAdminGate>
  ),
});

type Member = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  account_type: string | null;
  approval_status: string | null;
  roles: string[];
  created_at: string;
};

const ROLE_OPTIONS = ["admin", "manager", "cashier", "call_center", "purchasing", "cfo", "user"];

function AccessStudio() {
  const { lang } = useI18n();
  const listFn = useServerFn(listCompanyMembers);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await listFn();
      setMembers(rows as Member[]);
      if (!selectedId && rows.length) setSelectedId((rows[0] as Member).user_id);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      (m.email ?? "").toLowerCase().includes(q) ||
      (m.display_name ?? "").toLowerCase().includes(q),
    );
  }, [members, query]);

  const selected = members.find((m) => m.user_id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <header className="noir-surface relative overflow-hidden rounded-3xl border border-[#c9a84c]/25 p-5 sm:p-6">
        <div className="gold-hairline-live absolute inset-x-0 top-0" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#c9a84c]">
              <Sparkles className="h-3.5 w-3.5" /> {lang === "ar" ? "استوديو الصلاحيات" : "Access Studio"}
            </div>
            <h1 className="display-xl text-foreground">
              {lang === "ar" ? (<>تخصيص <span className="text-gradient-gold">كل حساب</span></>) : (<>Customize <span className="text-gradient-gold">Every Account</span></>)}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {lang === "ar"
                ? "تحكم في التابات، الصفحات، كروت لوحة التحكم، الأدوار، والترتيب لأي مستخدم — مع معاينة كاملة بعينَي المستخدم."
                : "Control which tabs, pages, dashboard cards, roles, and order any user sees — with full preview as that user."}
            </p>
          </div>
          <CreateAccountButton onCreated={load} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Left: user list */}
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-[#c9a84c]" />
            <h2 className="text-sm font-semibold">
              {lang === "ar" ? `المستخدمون (${members.length})` : `Users (${members.length})`}
            </h2>
          </div>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute inset-y-0 start-2 my-auto h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={lang === "ar" ? "بحث..." : "Search..."}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="ps-8"
            />
          </div>
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
              {filtered.map((m) => {
                const active = m.user_id === selectedId;
                return (
                  <button
                    key={m.user_id}
                    onClick={() => setSelectedId(m.user_id)}
                    className={`group flex w-full items-start gap-2 rounded-lg border p-2.5 text-start transition ${
                      active
                        ? "border-[#c9a84c]/60 bg-[#c9a84c]/10"
                        : "border-border/60 hover:bg-muted/50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{m.display_name || m.email}</div>
                      <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.roles.slice(0, 3).map((r) => (
                          <span key={r} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{r}</span>
                        ))}
                        {m.roles.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{m.roles.length - 3}</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {lang === "ar" ? "لا يوجد" : "None"}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Right: inspector */}
        <div className="min-w-0">
          {!selected ? (
            <Card className="flex h-96 items-center justify-center p-6 text-sm text-muted-foreground">
              {lang === "ar" ? "اختر مستخدمًا للتخصيص" : "Select a user to customize"}
            </Card>
          ) : (
            <Inspector key={selected.user_id} member={selected} onReloadMembers={load} />
          )}
        </div>
      </div>
    </div>
  );
}

type Snapshot = {
  navHidden: string[];
  navOrder: string[];
  cardsHidden: string[];
  cardsOrder: string[];
};

const EMPTY_SNAPSHOT: Snapshot = { navHidden: [], navOrder: [], cardsHidden: [], cardsOrder: [] };

function Inspector({ member, onReloadMembers }: { member: Member; onReloadMembers: () => void }) {
  const { lang } = useI18n();
  const loadFn = useServerFn(loadUserPrefs);
  const saveFn = useServerFn(saveUserPrefs);
  const applyRoleFn = useServerFn(applyPrefsToRole);
  const [loaded, setLoaded] = useState(false);
  const history = useHistoryState<Snapshot>(EMPTY_SNAPSHOT);
  const { state: snap, set: setSnap, reset: resetSnap, undo, redo, canUndo, canRedo, pastCount, futureCount } = history;
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved">("idle");
  const [applyRoleOpen, setApplyRoleOpen] = useState(false);
  const [applyRole, setApplyRole] = useState<string>("cashier");
  const [applyBusy, setApplyBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setLoaded(false);
      const row = await loadFn({ data: { user_id: member.user_id } } as any);
      const nh = Array.isArray((row as any).nav_hidden) ? (row as any).nav_hidden : [];
      const no = Array.isArray((row as any).nav_order) ? (row as any).nav_order : [];
      const ch = Array.isArray((row as any).cards_hidden) ? (row as any).cards_hidden : [];
      const co = Array.isArray((row as any).cards_order) ? (row as any).cards_order : [];
      // resetSnap clears undo/redo history when switching users or reloading.
      resetSnap({
        navHidden: nh,
        navOrder: no.length ? mergeOrder(no, NAV_TOP_ORDER) : NAV_TOP_ORDER,
        cardsHidden: ch,
        cardsOrder: co.length ? mergeOrder(co, DASHBOARD_CARDS.map((c) => c.key)) : DASHBOARD_CARDS.map((c) => c.key),
      });
      setLoaded(true);
      setSavingState("idle");
    })();
    // eslint-disable-next-line
  }, [member.user_id]);

  // Debounced auto-save — fires 700ms after the last change.
  useEffect(() => {
    if (!loaded) return;
    setSavingState("saving");
    const t = setTimeout(async () => {
      try {
        await saveFn({ data: {
          user_id: member.user_id,
          nav_hidden: snap.navHidden,
          nav_order: snap.navOrder,
          cards_hidden: snap.cardsHidden,
          cards_order: snap.cardsOrder,
          mobile_tabs: [],
        } } as any);
        setSavingState("saved");
        setTimeout(() => setSavingState((s) => (s === "saved" ? "idle" : s)), 1600);
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to save");
        setSavingState("idle");
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [snap]);

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (e.target as HTMLElement | null)?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const toggleNav = (key: string) => {
    setSnap((s) => {
      const has = s.navHidden.includes(key);
      return { ...s, navHidden: has ? s.navHidden.filter((k) => k !== key) : [...s.navHidden, key] };
    });
  };
  const toggleCard = (key: string) => {
    setSnap((s) => {
      const has = s.cardsHidden.includes(key);
      return { ...s, cardsHidden: has ? s.cardsHidden.filter((k) => k !== key) : [...s.cardsHidden, key] };
    });
  };
  const setNavOrder = (next: string[]) => setSnap((s) => ({ ...s, navOrder: next }));
  const setCardsOrder = (next: string[]) => setSnap((s) => ({ ...s, cardsOrder: next }));

  const applyToRole = async () => {
    setApplyBusy(true);
    try {
      const res: any = await applyRoleFn({ data: {
        role: applyRole,
        nav_hidden: snap.navHidden,
        nav_order: snap.navOrder,
        cards_hidden: snap.cardsHidden,
        cards_order: snap.cardsOrder,
        overwrite: true,
      } } as any);
      toast.success(
        lang === "ar"
          ? `تم تطبيق القالب على ${res?.applied ?? 0} مستخدم`
          : `Applied template to ${res?.applied ?? 0} users`,
      );
      setApplyRoleOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setApplyBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-bold">{member.display_name || member.email}</div>
          <div className="truncate text-xs text-muted-foreground">{member.email}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveIndicator state={savingState} lang={lang} />
          <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 p-0.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={undo}
              disabled={!canUndo}
              title={lang === "ar" ? `تراجع (Ctrl+Z) — ${pastCount}` : `Undo (Ctrl+Z) — ${pastCount}`}
              className="h-7 px-2"
            >
              <Undo2 className="h-4 w-4" />
              {pastCount > 0 && <span className="ms-1 text-[10px] tabular-nums">{pastCount}</span>}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={redo}
              disabled={!canRedo}
              title={lang === "ar" ? `إعادة (Ctrl+Shift+Z) — ${futureCount}` : `Redo (Ctrl+Shift+Z) — ${futureCount}`}
              className="h-7 px-2"
            >
              <Redo2 className="h-4 w-4" />
              {futureCount > 0 && <span className="ms-1 text-[10px] tabular-nums">{futureCount}</span>}
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImpersonateId(member.user_id)}
            className="border-[#c9a84c]/50 text-[#c9a84c] hover:bg-[#c9a84c]/10"
          >
            <Eye className="me-1 h-4 w-4" />
            {lang === "ar" ? "شاهد بعينَيه" : "Preview as user"}
          </Button>
          <Dialog open={applyRoleOpen} onOpenChange={setApplyRoleOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Copy className="me-1 h-4 w-4" />
                {lang === "ar" ? "طبّق على Role" : "Apply to role"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{lang === "ar" ? "تطبيق القالب على كل المستخدمين بدور محدد" : "Apply template to all users with role"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {lang === "ar"
                    ? "ستُحفظ نفس إعدادات الإظهار/الإخفاء والترتيب لكل المستخدمين الذين يمتلكون هذا الدور. سيتم استبدال إعداداتهم السابقة."
                    : "The same visibility and order settings will be saved for every user holding this role, overwriting their previous settings."}
                </p>
                <div>
                  <label className="text-xs font-medium">{lang === "ar" ? "الدور" : "Role"}</label>
                  <Select value={applyRole} onValueChange={setApplyRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setApplyRoleOpen(false)}>{lang === "ar" ? "إلغاء" : "Cancel"}</Button>
                <Button onClick={applyToRole} disabled={applyBusy}>
                  {applyBusy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <Save className="me-1 h-4 w-4" />}
                  {lang === "ar" ? "تطبيق" : "Apply"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <PrecedencePanel lang={lang} />

      <Tabs defaultValue="nav" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="nav"><ListChecks className="me-1 h-4 w-4" />{lang === "ar" ? "التنقل" : "Navigation"}</TabsTrigger>
          <TabsTrigger value="cards"><LayoutDashboard className="me-1 h-4 w-4" />{lang === "ar" ? "كروت اللوحة" : "Dashboard Cards"}</TabsTrigger>
          <TabsTrigger value="roles"><ShieldCheck className="me-1 h-4 w-4" />{lang === "ar" ? "الأدوار" : "Roles"}</TabsTrigger>
        </TabsList>

        <TabsContent value="nav" className="mt-4 space-y-4">
          {!loaded ? <SkeletonBlock /> : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {lang === "ar"
                  ? "اسحب لإعادة الترتيب، وبدّل مفتاح الإظهار/الإخفاء — يُحفظ كل تغيير تلقائيًا. استخدم Ctrl+Z للتراجع."
                  : "Drag to reorder, toggle to hide/show — changes save automatically. Use Ctrl+Z to undo."}
              </p>

              {/* Top-level order + toggles */}
              <DragList
                items={snap.navOrder}
                onReorder={setNavOrder}
                renderRow={(key) => {
                  const grp = NAV_GROUP_BY_KEY[key];
                  const solo = NAV_ITEMS.find((n) => n.key === key && !n.group);
                  const label = grp ? labelOf(grp, lang) : solo ? labelOf(solo, lang) : key;
                  const hidden = snap.navHidden.includes(key);
                  return (
                    <>
                      <div className="flex-1 truncate text-sm font-medium">
                        {label}
                        {grp && <span className="ms-2 text-[10px] uppercase text-muted-foreground">group</span>}
                      </div>
                      <Switch checked={!hidden} onCheckedChange={() => toggleNav(key)} />
                    </>
                  );
                }}
                title={lang === "ar" ? "الترتيب والإخفاء" : "Order & visibility"}
              />

              {/* Per-group children */}
              {NAV_GROUPS.map((g) => {
                const children = navChildrenOf(g.key);
                if (children.length === 0) return null;
                return (
                  <div key={g.key} className="space-y-1 rounded-lg border border-border/60 p-3">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {labelOf(g, lang)}
                    </div>
                    {children.map((c) => {
                      const hidden = snap.navHidden.includes(c.key);
                      return (
                        <label key={c.key} className="flex items-center justify-between rounded-md border border-transparent p-2 hover:bg-muted/40">
                          <span className="text-sm">{labelOf(c, lang)}</span>
                          <Switch checked={!hidden} onCheckedChange={() => toggleNav(c.key)} />
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="cards" className="mt-4 space-y-4">
          {!loaded ? <SkeletonBlock /> : (
            <DragList
              items={snap.cardsOrder}
              onReorder={setCardsOrder}
              renderRow={(key) => {
                const def = DASHBOARD_CARDS.find((c) => c.key === key);
                if (!def) return null;
                const hidden = snap.cardsHidden.includes(key);
                return (
                  <>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{labelOf(def, lang)}</div>
                      <div className="text-[10px] uppercase text-muted-foreground">{def.group}</div>
                    </div>
                    <Switch checked={!hidden} onCheckedChange={() => toggleCard(key)} />
                  </>
                );
              }}
              title={lang === "ar" ? "كروت لوحة التحكم — الترتيب والإخفاء" : "Dashboard cards — order & visibility"}
            />
          )}
        </TabsContent>

        <TabsContent value="roles" className="mt-4">
          <RolesEditor member={member} onChanged={onReloadMembers} />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

/** Explains the exact rule precedence used across the app. */
function PrecedencePanel({ lang }: { lang: "ar" | "en" }) {
  const rows = lang === "ar"
    ? [
        { tier: "1", name: "Super Admin", detail: "يتخطى كل القيود ويرى كل شيء دائمًا.", tone: "gold" as const },
        { tier: "2", name: "تفضيلات المستخدم", detail: "الإظهار/الإخفاء والترتيب المحفوظ لهذا الحساب — أعلى أولوية بعد Super Admin.", tone: "user" as const },
        { tier: "3", name: "قالب الدور (Apply to Role)", detail: "يُنسخ إلى تفضيلات كل مستخدم بنفس الدور. لا يوجد قالب حي — التطبيق يكتب فوق تفضيلات المستخدمين.", tone: "role" as const },
        { tier: "4", name: "الافتراضي", detail: "كامل الكاتالوج (كل التابات والكروت) بالترتيب الأصلي عند غياب أي تفضيل.", tone: "default" as const },
      ]
    : [
        { tier: "1", name: "Super Admin", detail: "Bypasses every restriction and always sees everything.", tone: "gold" as const },
        { tier: "2", name: "User preferences", detail: "Per-account visibility & order saved here — highest priority after Super Admin.", tone: "user" as const },
        { tier: "3", name: "Role template (Apply to Role)", detail: "Copied into each matching user's preferences. There is no live role rule — applying overwrites their preferences.", tone: "role" as const },
        { tier: "4", name: "Default", detail: "Full catalog (all tabs & cards) in original order when no preference is set.", tone: "default" as const },
      ];

  const tone = {
    gold: "border-[#c9a84c]/60 bg-[#c9a84c]/10 text-[#c9a84c]",
    user: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
    role: "border-sky-500/40 bg-sky-500/10 text-sky-600",
    default: "border-border/60 bg-muted/40 text-muted-foreground",
  };

  return (
    <div className="mb-4 rounded-xl border border-[#c9a84c]/25 bg-gradient-to-b from-[#c9a84c]/5 to-transparent p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#c9a84c]">
        <Layers className="h-3.5 w-3.5" />
        {lang === "ar" ? "ترتيب الأولوية" : "Rule precedence"}
        <span className="ms-auto inline-flex items-center gap-1 text-[10px] font-normal normal-case text-muted-foreground">
          <Info className="h-3 w-3" />
          {lang === "ar" ? "يُطبَّق الأول الذي يوجد له قاعدة" : "First tier with a rule wins"}
        </span>
      </div>
      <ol className="grid gap-1.5 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.tier} className="flex items-start gap-2 rounded-lg border border-border/50 bg-background/40 p-2">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold ${tone[r.tone]}`}>
              {r.tier}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold">{r.name}</div>
              <div className="text-[11px] leading-snug text-muted-foreground">{r.detail}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}


function SaveIndicator({ state, lang }: { state: "idle" | "saving" | "saved"; lang: "ar" | "en" }) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {lang === "ar" ? "جارٍ الحفظ..." : "Saving..."}
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        {lang === "ar" ? "تم الحفظ" : "Saved"}
      </span>
    );
  }
  return null;
}

/** Reusable drag-and-drop list — HTML5 native, no deps. */
function DragList({
  items,
  onReorder,
  renderRow,
  title,
}: {
  items: string[];
  onReorder: (next: string[]) => void;
  renderRow: (key: string, idx: number) => React.ReactNode;
  title?: string;
}) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const onDrop = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) { setDragKey(null); setOverKey(null); return; }
    const from = items.indexOf(dragKey);
    const to = items.indexOf(targetKey);
    if (from < 0 || to < 0) { setDragKey(null); setOverKey(null); return; }
    const next = [...items];
    next.splice(from, 1);
    next.splice(to, 0, dragKey);
    onReorder(next);
    setDragKey(null);
    setOverKey(null);
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      {title && (
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      )}
      {items.map((key, idx) => {
        const isDragging = dragKey === key;
        const isOver = overKey === key && dragKey !== key;
        return (
          <div
            key={key}
            draggable
            onDragStart={() => setDragKey(key)}
            onDragEnd={() => { setDragKey(null); setOverKey(null); }}
            onDragOver={(e) => { e.preventDefault(); if (overKey !== key) setOverKey(key); }}
            onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
            onDrop={(e) => { e.preventDefault(); onDrop(key); }}
            className={`flex items-center gap-2 rounded-md border p-2 transition ${
              isDragging ? "border-[#c9a84c]/60 bg-[#c9a84c]/10 opacity-60"
              : isOver ? "border-[#c9a84c] bg-[#c9a84c]/5"
              : "border-border/50 bg-muted/20 hover:bg-muted/40"
            }`}
          >
            <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" />
            {renderRow(key, idx)}
          </div>
        );
      })}
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function mergeOrder(saved: string[], full: string[]): string[] {
  const set = new Set(saved);
  const known = saved.filter((k) => full.includes(k));
  const missing = full.filter((k) => !set.has(k));
  return [...known, ...missing];
}

function RolesEditor({ member, onChanged }: { member: Member; onChanged: () => void }) {
  const { lang } = useI18n();
  const [roles, setRoles] = useState<string[]>(member.roles);
  const [adding, setAdding] = useState<string>("cashier");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setRoles(member.roles); }, [member.user_id, member.roles]);

  const addRole = async () => {
    setBusy(true);
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await supabase.from("user_roles").insert({ user_id: member.user_id, role: adding as any });
    setBusy(false);
    if (error && !error.message.includes("duplicate")) { toast.error(error.message); return; }
    setRoles((r) => Array.from(new Set([...r, adding])));
    toast.success(lang === "ar" ? "تمت الإضافة" : "Added");
    onChanged();
  };
  const removeRole = async (r: string) => {
    if (!confirm(lang === "ar" ? `حذف دور ${r}؟` : `Remove role ${r}?`)) return;
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await supabase.from("user_roles").delete().eq("user_id", member.user_id).eq("role", r as any);
    if (error) { toast.error(error.message); return; }
    setRoles((cur) => cur.filter((x) => x !== r));
    toast.success(lang === "ar" ? "تم الحذف" : "Removed");
    onChanged();
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3">
      <div className="flex flex-wrap gap-2">
        {roles.length === 0 && (
          <span className="text-sm text-muted-foreground">{lang === "ar" ? "بدون أدوار" : "No roles"}</span>
        )}
        {roles.map((r) => (
          <Badge
            key={r}
            variant="outline"
            className="cursor-pointer gap-1"
            onClick={() => removeRole(r)}
            title={lang === "ar" ? "اضغط للحذف" : "Click to remove"}
          >
            {r} ✕
          </Badge>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Select value={adding} onValueChange={setAdding}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r} value={r} disabled={roles.includes(r)}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={addRole} disabled={busy || roles.includes(adding)}>
          {lang === "ar" ? "إضافة دور" : "Add role"}
        </Button>
      </div>
    </div>
  );
}

function CreateAccountButton({ onCreated }: { onCreated: () => void }) {
  const { lang } = useI18n();
  const createFn = useServerFn(createCompanyAccount);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<"employee" | "distributor">("employee");
  const [preset, setPreset] = useState<string>("cashier");
  const [busy, setBusy] = useState(false);

  const PRESETS: Record<string, string[]> = {
    cashier: ["cashier"],
    manager: ["manager"],
    call_center: ["call_center"],
    purchasing: ["purchasing"],
    cfo: ["cfo"],
    admin: ["admin"],
    none: [],
  };

  const submit = async () => {
    setBusy(true);
    try {
      await createFn({ data: {
        email, password, name,
        account_type: accountType,
        roles: PRESETS[preset] ?? [],
      } } as any);
      toast.success(lang === "ar" ? "تم إنشاء الحساب" : "Account created");
      setOpen(false);
      setEmail(""); setPassword(""); setName("");
      onCreated();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-to-r from-[#c9a84c] to-[#a8842f] text-[#0a0a0a] shadow-lg hover:opacity-90">
          <UserPlus className="me-1 h-4 w-4" />
          {lang === "ar" ? "إنشاء حساب جديد" : "Create account"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{lang === "ar" ? "إنشاء حساب للشركة" : "Create company account"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">{lang === "ar" ? "الاسم" : "Name"}</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium">{lang === "ar" ? "البريد" : "Email"}</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium">{lang === "ar" ? "كلمة السر المؤقتة" : "Temporary password"}</label>
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">{lang === "ar" ? "نوع الحساب" : "Account type"}</label>
              <Select value={accountType} onValueChange={(v) => setAccountType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">{lang === "ar" ? "موظف" : "Employee"}</SelectItem>
                  <SelectItem value="distributor">{lang === "ar" ? "موزّع" : "Distributor"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">{lang === "ar" ? "قالب الصلاحيات" : "Role preset"}</label>
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(PRESETS).map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{lang === "ar" ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={submit} disabled={busy || !email || !password || !name}>
            {busy ? <Loader2 className="me-1 h-4 w-4 animate-spin" /> : <UserPlus className="me-1 h-4 w-4" />}
            {lang === "ar" ? "إنشاء" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
