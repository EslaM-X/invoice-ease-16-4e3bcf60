import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { uniqueRealtimeTopic } from "@/lib/realtime";

export type DistributorProfile = {
  id: string;
  user_id: string;
  name: string;
  showroom_name: string | null;
  location: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  branches_count: number;
  notes: string | null;
  is_active: boolean;
};

export function useDistributor() {
  const { user } = useAuth();
  const [distributor, setDistributor] = useState<DistributorProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setDistributor(null); setLoading(false); return; }
    let cancel = false;
    setLoading(true);
    (supabase.from as any)("distributors")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }: any) => {
        if (cancel) return;
        setDistributor(data ?? null);
        setLoading(false);
      });
    const ch = supabase.channel(uniqueRealtimeTopic(`dist-${user.id}`))
      .on("postgres_changes", { event: "*", schema: "public", table: "distributors", filter: `user_id=eq.${user.id}` },
        () => {
          (supabase.from as any)("distributors").select("*").eq("user_id", user.id).maybeSingle()
            .then(({ data }: any) => { if (!cancel) setDistributor(data ?? null); });
        })
      .subscribe();
    return () => { cancel = true; supabase.removeChannel(ch); };
  }, [user?.id]);

  return { distributor, loading, isDistributor: !!distributor && distributor.is_active };
}
