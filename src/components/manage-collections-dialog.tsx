import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, Palette, GripVertical } from "lucide-react";
import { useCollections, refreshCollections } from "@/lib/use-collections";
import { useI18n } from "@/lib/i18n";
import type { CollectionEntry } from "@/lib/collection-registry";
import { collectionBadgeStyle } from "@/lib/collection-styles";

const PRESETS = [
  // Reds / pinks
  "#EF4444", "#F43F5E", "#EC4899", "#D946EF",
  // Purples / indigos / blues
  "#A855F7", "#8B5CF6", "#6366F1", "#3B82F6", "#0EA5E9", "#06B6D4",
  // Teals / greens
  "#14B8A6", "#10B981", "#22C55E", "#84CC16",
  // Yellows / oranges / browns
  "#EAB308", "#F59E0B", "#F97316", "#FB7185", "#B45309", "#78350F",
  // Neutrals / luxe
  "#D4AF37", "#C0C0C0", "#0F172A", "#475569",
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
};

export function ManageCollectionsDialog({ open, onOpenChange, canEdit }: Props) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { all: items } = useCollections({ includeInactive: true });
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(PRESETS[4]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) { setCode(""); setLabel(""); setColor(PRESETS[4]); }
  }, [open]);

  const addNew = async () => {
    const c = code.trim().toUpperCase();
    if (!c) return toast.error(ar ? "أدخل رمز الكولكشن" : "Enter a code");
    if (items.some((i) => i.code.toUpperCase() === c)) {
      return toast.error(ar ? "هذا الرمز موجود بالفعل" : "Code already exists");
    }
    setBusy(true);
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0);
    const { error } = await supabase.from("collections").insert({
      code: c,
      label: label.trim() || c,
      color_hex: color,
      sort_order: maxSort + 10,
      is_active: true,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(ar ? "تمت الإضافة" : "Added");
    setCode(""); setLabel(""); setColor(PRESETS[4]);
    await refreshCollections();
  };

  const patch = async (id: string, changes: Partial<CollectionEntry>) => {
    const { error } = await supabase.from("collections").update(changes).eq("id", id);
    if (error) return toast.error(error.message);
    await refreshCollections();
  };

  const remove = async (item: CollectionEntry) => {
    if (!item.id) return;
    // Check usage first
    const { count } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("collection", item.code);
    if ((count ?? 0) > 0) {
      const proceed = window.confirm(
        ar
          ? `يوجد ${count} منتج مرتبط بهذا الكولكشن. سيتم إخفاؤه فقط (تعطيل) بدلاً من الحذف. متابعة؟`
          : `${count} products still use this collection. It will be deactivated instead of deleted. Continue?`
      );
      if (!proceed) return;
      await patch(item.id, { is_active: false });
      toast.success(ar ? "تم التعطيل" : "Deactivated");
      return;
    }
    if (!window.confirm(ar ? "حذف هذا الكولكشن؟" : "Delete this collection?")) return;
    const { error } = await supabase.from("collections").delete().eq("id", item.id);
    if (error) return toast.error(error.message);
    toast.success(ar ? "تم الحذف" : "Deleted");
    await refreshCollections();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-gradient-gold">
            <Palette className="h-5 w-5" />
            {ar ? "إدارة الكولكشنات" : "Manage collections"}
          </DialogTitle>
        </DialogHeader>

        {canEdit && (
          <div className="rounded-xl border bg-muted/30 p-3 space-y-3">
            <div className="text-sm font-semibold">{ar ? "إضافة كولكشن جديد" : "Add new collection"}</div>
            <div className="grid grid-cols-6 gap-2">
              <div className="col-span-2">
                <Label className="text-xs">{ar ? "الرمز" : "Code"}</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. LUXE"
                  className="uppercase font-mono"
                  maxLength={20}
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs">{ar ? "الاسم المعروض" : "Display label"}</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={code || (ar ? "اسم للعرض" : "shown as…")} />
              </div>
              <div className="col-span-1">
                <Label className="text-xs">{ar ? "اللون" : "Color"}</Label>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-full rounded-md border cursor-pointer bg-transparent"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">{ar ? "ألوان مقترحة:" : "Presets:"}</span>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setColor(p)}
                  className={`h-6 w-6 rounded-full border-2 transition ${color.toLowerCase() === p.toLowerCase() ? "border-foreground scale-110" : "border-transparent hover:border-foreground/40"}`}
                  style={{ backgroundColor: p }}
                  aria-label={p}
                />
              ))}
              <div className="flex-1" />
              <div
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border"
                style={{
                  backgroundColor: `${color}22`,
                  color,
                  borderColor: `${color}66`,
                }}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                {code || (ar ? "معاينة" : "preview")}
              </div>
              <Button size="sm" onClick={addNew} disabled={busy} className="gap-1"><Plus className="h-3.5 w-3.5" />{ar ? "إضافة" : "Add"}</Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-sm font-semibold">{ar ? "الكولكشنات الحالية" : "Existing collections"}</div>
          {items.length === 0 && (
            <div className="text-sm text-muted-foreground p-6 text-center">{ar ? "لا يوجد" : "None"}</div>
          )}
          {items.map((it) => (
            <div key={it.code} className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${!it.is_active ? "opacity-50" : ""}`}>
              <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              <div
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold border shrink-0"
                style={collectionBadgeStyle(it.code) ?? { backgroundColor: `${it.color_hex}22`, color: it.color_hex, borderColor: `${it.color_hex}66` }}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: it.color_hex }} />
                {it.code}
              </div>
              <Input
                value={it.label}
                onChange={(e) => patch(it.id!, { label: e.target.value })}
                disabled={!canEdit || !it.id}
                className="flex-1 min-w-[120px] h-8"
              />
              <input
                type="color"
                value={it.color_hex}
                onChange={(e) => patch(it.id!, { color_hex: e.target.value })}
                disabled={!canEdit || !it.id}
                className="h-8 w-12 rounded border cursor-pointer bg-transparent"
                title={ar ? "اللون" : "Color"}
              />
              <Input
                type="number"
                value={it.sort_order ?? 0}
                onChange={(e) => patch(it.id!, { sort_order: parseInt(e.target.value || "0", 10) })}
                disabled={!canEdit || !it.id}
                className="w-16 h-8"
                title={ar ? "الترتيب" : "Sort order"}
              />
              <label className="flex items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={it.is_active}
                  onChange={(e) => patch(it.id!, { is_active: e.target.checked })}
                  disabled={!canEdit || !it.id}
                />
                {ar ? "مفعّل" : "Active"}
              </label>
              {canEdit && it.id && (
                <Button size="icon" variant="ghost" onClick={() => remove(it)} title={ar ? "حذف" : "Delete"}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>

        {!canEdit && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
            {ar ? "يمكن للمسؤولين فقط تعديل الكولكشنات." : "Only administrators can edit collections."}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{ar ? "إغلاق" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
