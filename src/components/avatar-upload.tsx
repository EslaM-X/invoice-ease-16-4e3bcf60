import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Upload, User } from "lucide-react";
import { toast } from "sonner";
import { getOrCreateMyProfile, updateMyAvatar, useTeamProfiles } from "@/lib/team-profiles";

export function AvatarUpload() {
  const { user } = useAuth();
  const team = useTeamProfiles();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const me = user ? team.byId(user.id) : null;
  const url = me?.avatar_url ?? null;

  useEffect(() => {
    if (user) getOrCreateMyProfile(user.id, user.email ?? null);
  }, [user]);

  const upload = async (file: File) => {
    if (!user) return;
    try {
      setBusy(true);
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, cacheControl: "3600" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      await updateMyAvatar(user.id, pub.publicUrl);
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border bg-muted">
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <User className="h-8 w-8 text-muted-foreground" />
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <div className="space-y-1">
        <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()} className="gap-2">
          <Upload className="h-4 w-4" />
          {busy ? "Uploading..." : "Upload avatar"}
        </Button>
        <p className="text-xs text-muted-foreground">{user?.email}</p>
      </div>
    </div>
  );
}
