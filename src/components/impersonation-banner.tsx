import { Eye, X } from "lucide-react";
import { getImpersonateId, setImpersonateId } from "@/lib/use-ui-prefs";
import { useIsSuperAdmin } from "@/lib/super-admin";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function ImpersonationBanner() {
  const isSuper = useIsSuperAdmin();
  const [id, setId] = useState<string | null>(null);
  const [label, setLabel] = useState<string>("");

  useEffect(() => {
    setId(getImpersonateId());
  }, []);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("email, display_name")
        .eq("user_id", id)
        .maybeSingle();
      setLabel((data?.display_name || data?.email || id) as string);
    })();
  }, [id]);

  if (!isSuper || !id) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-30 flex items-center justify-center gap-3 border-b border-[#c9a84c]/40 bg-gradient-to-r from-[#1a1408] via-[#0f0a05] to-[#1a1408] px-4 py-2 text-xs font-semibold text-[#f5e7b8] shadow-lg shadow-black/40"
    >
      <Eye className="h-3.5 w-3.5 text-[#c9a84c]" />
      <span className="truncate">
        Preview mode — viewing as <span className="text-[#c9a84c]">{label}</span>
      </span>
      <button
        type="button"
        onClick={() => setImpersonateId(null)}
        className="ms-2 inline-flex items-center gap-1 rounded-full border border-[#c9a84c]/50 bg-[#c9a84c]/10 px-2.5 py-1 text-[11px] text-[#f5e7b8] transition hover:bg-[#c9a84c]/25"
      >
        <X className="h-3 w-3" /> Exit preview
      </button>
    </div>
  );
}
