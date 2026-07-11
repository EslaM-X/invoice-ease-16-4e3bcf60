import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Upload, User, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getOrCreateMyProfile, updateMyAvatar } from "@/lib/team-profiles";
import { useCurrentAvatar } from "@/lib/use-avatar";

const MAX_MB = 5;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function AvatarUpload() {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const avatar = useCurrentAvatar();

  useEffect(() => {
    if (user) getOrCreateMyProfile(user.id, user.email ?? null);
  }, [user]);

  // Reset the loaded flag whenever the URL changes so we re-blur → sharp
  useEffect(() => {
    setImgLoaded(false);
  }, [avatar.url]);

  const upload = async (file: File) => {
    if (!user) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Only PNG, JPG, WEBP or GIF images are allowed");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`Max file size is ${MAX_MB}MB`);
      return;
    }
    try {
      setBusy(true);
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, cacheControl: "3600", contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      await updateMyAvatar(user.id, pub.publicUrl);
      toast.success("Avatar updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clear = async () => {
    if (!user) return;
    try {
      setBusy(true);
      await updateMyAvatar(user.id, null);
      toast.success("Avatar removed");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to remove");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#c9a84c]/60 bg-gradient-to-br from-[#1a1a1a] to-[#0a0a0a] shadow-[0_6px_20px_-6px_rgba(201,168,76,0.4)]">
        <span className="absolute inset-0 grid place-items-center text-xl font-bold text-[#f5e7b8]">
          {avatar.initial || <User className="h-8 w-8 opacity-60" />}
        </span>
        {avatar.loading && !avatar.url && (
          <span aria-hidden="true" className="absolute inset-0 animate-pulse bg-gradient-to-r from-[#161616] via-[#2a2416] to-[#161616] motion-reduce:animate-none" />
        )}
        {avatar.url && (
          <img
            src={avatar.url}
            alt={avatar.name ?? user?.email ?? "avatar"}
            width={80}
            height={80}
            loading="eager"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgLoaded(true)}
            className={`relative h-full w-full object-cover transition-[opacity,filter] duration-500 ${imgLoaded ? "opacity-100 blur-0" : "opacity-0 blur-md"}`}
          />
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED.join(",")}
        hidden
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()} className="gap-2">
            <Upload className="h-4 w-4" />
            {busy ? "Uploading..." : avatar.url ? "Change avatar" : "Upload avatar"}
          </Button>
          {avatar.url && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={clear} className="gap-1 text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{user?.email} · PNG/JPG/WEBP, max {MAX_MB}MB</p>
      </div>
    </div>
  );
}
