import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CollectionEntry,
  listCollectionsSync,
  setCollectionsRegistry,
  subscribeCollections,
} from "@/lib/collection-registry";

/** Reactive list of active collections (synced with `public.collections`). */
export function useCollections(opts: { includeInactive?: boolean } = {}) {
  const items = useSyncExternalStore(subscribeCollections, listCollectionsSync, listCollectionsSync);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("collections")
        .select("*")
        .order("sort_order", { ascending: true });
      if (cancel) return;
      if (!error && data) setCollectionsRegistry(data as CollectionEntry[]);
      setLoading(false);
    })();

    const channel = supabase
      .channel(`collections-live-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "collections" }, async () => {
        const { data } = await supabase
          .from("collections")
          .select("*")
          .order("sort_order", { ascending: true });
        if (data) setCollectionsRegistry(data as CollectionEntry[]);
      })
      .subscribe();

    return () => {
      cancel = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = opts.includeInactive ? items : items.filter((c) => c.is_active);
  return { items: filtered, all: items, loading };
}

export async function refreshCollections() {
  const { data } = await supabase
    .from("collections")
    .select("*")
    .order("sort_order", { ascending: true });
  if (data) setCollectionsRegistry(data as CollectionEntry[]);
}
