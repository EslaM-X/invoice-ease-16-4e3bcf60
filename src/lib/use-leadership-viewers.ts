import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/lib/realtime";

const COO_SELF_EMAIL = "e.hesham@steinheim-eg.com";
const FALLBACK = new Set([
  "esraa@steinheim-eg.com",
  "f.hesham@steinheim-eg.com",
  "cfo@steinheim-eg.com",
  COO_SELF_EMAIL,
]);

export type LeadershipViewer = {
  id: string;
  email: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Live-loaded ALLOWED_VIEWERS list from `public.leadership_card_viewers`.
 * Falls back to hard-coded seed list if the DB read fails.
 */
export function useLeadershipViewers() {
  const [emails, setEmails] = useState<Set<string>>(FALLBACK);
  const [rows, setRows] = useState<LeadershipViewer[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("leadership_card_viewers")
      .select("id,email,note,created_at,updated_at")
      .order("created_at", { ascending: true });
    if (error) {
      setLoaded(true);
      return;
    }
    const list = (data ?? []) as LeadershipViewer[];
    setRows(list);
    setEmails(new Set(list.map((r) => r.email.trim().toLowerCase())));
    setLoaded(true);
  };

  useEffect(() => { load(); }, []);
  useRealtimeTable("leadership_card_viewers", load);

  return { emails, rows, loaded, reload: load };
}
