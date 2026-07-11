import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useRealtimeTable } from "@/lib/realtime";
import { toast } from "sonner";
import { PackageX, AlertTriangle, Package, Hash, Palette, TrendingDown, CheckCheck, RotateCcw } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

type LowProduct = {
  id: string;
  name: string;
  serial_number: string | null;
  color: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  image_url: string | null;
};

export function LowStockAlerts() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const [items, setItems] = useState<LowProduct[]>([]);
  // remember last known qty per product to detect crossing-the-threshold events
  const lastQtyRef = useRef<Map<string, number>>(new Map());
  const initializedRef = useRef(false);

  const load = async () => {
    const { data } = await supabase
      .from("products")
      .select("id,name,serial_number,color,stock_quantity,low_stock_threshold,image_url");
    const all = (data ?? []) as LowProduct[];
    // seed lastQty map on first load (no toasts on initial mount)
    if (!initializedRef.current) {
      all.forEach((p) => lastQtyRef.current.set(p.id, p.stock_quantity));
      initializedRef.current = true;
    }
    const low = all
      .filter((p) => p.stock_quantity <= p.low_stock_threshold)
      .sort((a, b) => a.stock_quantity - b.stock_quantity);
    setItems(low);
  };

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fireToast = (p: LowProduct, isOut: boolean) => {
    const title = isOut
      ? lang === "ar" ? "نفد المخزون!" : "Out of stock!"
      : lang === "ar" ? "تنبيه: مخزون منخفض" : "Low stock alert";

    toast(title, {
      icon: isOut ? "🚫" : "⚠️",
      duration: 10000,
      description: (
        <div className="mt-1 space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <Package className="h-3.5 w-3.5" /> {p.name}
          </div>
          {p.serial_number && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Hash className="h-3 w-3" />
              {lang === "ar" ? "الرقم التسلسلي: " : "Serial: "}
              <span className="font-mono text-foreground">{p.serial_number}</span>
            </div>
          )}
          {p.color && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Palette className="h-3 w-3" />
              {lang === "ar" ? "اللون: " : "Color: "}
              <span className="text-foreground">{p.color}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <TrendingDown className="h-3 w-3 text-destructive" />
            <span className={isOut ? "font-bold text-destructive" : "font-bold text-warning-foreground"}>
              {lang === "ar" ? "المتبقي: " : "Remaining: "}
              {p.stock_quantity}
            </span>
            <span className="text-muted-foreground">
              / {lang === "ar" ? "الحد الأدنى: " : "min: "}{p.low_stock_threshold}
            </span>
          </div>
        </div>
      ),
    });
  };

  // Realtime: detect threshold crossings for any product change (any of the 4 accounts)
  useRealtimeTable("products", (payload) => {
    if (payload.eventType === "DELETE") {
      lastQtyRef.current.delete(payload.old?.id);
      load();
      return;
    }
    const p = payload.new as LowProduct;
    if (!p?.id) return;
    const prev = lastQtyRef.current.get(p.id);
    const isLowNow = p.stock_quantity <= p.low_stock_threshold;
    const wasLowBefore =
      prev !== undefined && prev <= p.low_stock_threshold;

    // Fire toast when crossing into low/out, OR when already low and qty decreased further
    if (isLowNow && (!wasLowBefore || (prev !== undefined && p.stock_quantity < prev))) {
      fireToast(p, p.stock_quantity <= 0);
    }
    lastQtyRef.current.set(p.id, p.stock_quantity);
    load();
  });

  const count = items.length;
  const outCount = items.filter((p) => p.stock_quantity <= 0).length;
  const hasAny = count > 0;
  const Icon = outCount > 0 ? PackageX : Package;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative rounded-full tap-scale transition-colors ${
            outCount > 0 ? "text-rose-600 dark:text-rose-400" : hasAny ? "text-emerald-600 dark:text-emerald-400" : ""
          }`}
          aria-label="stock alerts"
          title={lang === "ar" ? "تنبيهات المخزون" : "Stock alerts"}
        >
          <Icon className={`h-4 w-4 ${outCount > 0 ? "drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]" : ""}`} />
          {count > 0 && (
            <span
              className={`absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-[0_0_0_2px_hsl(var(--background))] ring-1 ring-white/30 ${
                outCount > 0
                  ? "bg-gradient-to-br from-rose-500 via-red-500 to-rose-700 animate-pulse"
                  : "bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600"
              }`}
            >
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b bg-gradient-to-r from-emerald-500/10 via-transparent to-transparent px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Icon className={`h-4 w-4 ${outCount > 0 ? "text-rose-600" : "text-emerald-600"}`} />
            {lang === "ar" ? "تنبيهات المخزون" : "Stock Alerts"}
          </div>
          <span className="text-xs text-muted-foreground">{count}</span>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {count === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              {lang === "ar" ? "كل المنتجات بمخزون كافٍ ✅" : "All products well stocked ✅"}
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((p) => {
                const isOut = p.stock_quantity <= 0;
                return (
                  <li key={p.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded border bg-muted">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                        ) : (
                          <Package className="h-full w-full p-2 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="truncate text-sm font-semibold">{p.name}</div>
                        {p.serial_number && (
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {p.serial_number}
                          </div>
                        )}
                        {p.color && (
                          <div className="text-[11px] text-muted-foreground">
                            {lang === "ar" ? "اللون: " : "Color: "}{p.color}
                          </div>
                        )}
                        <div className="flex items-center gap-1 text-[11px]">
                          <span
                            className={`font-bold ${isOut ? "text-destructive" : "text-warning-foreground"}`}
                          >
                            {p.stock_quantity}
                          </span>
                          <span className="text-muted-foreground">
                            / {p.low_stock_threshold} {lang === "ar" ? "حد أدنى" : "min"}
                          </span>
                          {isOut && (
                            <span className="ms-auto rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                              {lang === "ar" ? "نفد" : "OUT"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t p-2 grid grid-cols-2 gap-1">
          <Link
            to="/inventory"
            className="rounded-md px-3 py-2 text-center text-xs font-medium text-primary hover:bg-accent"
          >
            {lang === "ar" ? "كل المخزون" : "All inventory"}
          </Link>
          <Link
            to="/inventory-traceability"
            search={{ tab: "stock" }}
            className="rounded-md px-3 py-2 text-center text-xs font-medium text-primary hover:bg-accent"
          >
            {lang === "ar" ? "مستويات المخزون" : "Stock levels"}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
