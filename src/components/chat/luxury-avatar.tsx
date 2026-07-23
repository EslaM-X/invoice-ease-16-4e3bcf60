import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getAvatarSrc, getAvatarSrcSet } from "@/lib/avatar-url";

type Props = {
  url?: string | null;
  name?: string | null;
  /** Rendered CSS size in px (both width & height). Default 44. */
  size?: number;
  /** Circle tone: gold ring for creator / white for members. */
  ring?: "gold" | "soft" | "none";
  className?: string;
  /** Show a subtle skeleton pulse while the image loads. */
  showSkeleton?: boolean;
};

/**
 * Luxury chat avatar with high-DPR image transforms, blur-up skeleton and
 * a fallback monogram. Use everywhere in the chat UI.
 */
export function LuxuryAvatar({
  url,
  name,
  size = 44,
  ring = "soft",
  className,
  showSkeleton = true,
}: Props) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const src = !errored ? getAvatarSrc(url, size) : undefined;
  const srcSet = !errored ? getAvatarSrcSet(url, size) : undefined;
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";

  const ringClass =
    ring === "gold"
      ? "ring-2 ring-[color:var(--brand-gold,#d4af37)]/70 ring-offset-2 ring-offset-transparent"
      : ring === "soft"
        ? "ring-2 ring-white/15"
        : "";

  return (
    <span className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }}>
      {ring === "gold" && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-[conic-gradient(from_140deg,rgba(212,175,55,0.9),rgba(240,215,140,0.35),rgba(212,175,55,0.9))] blur-[1px] opacity-80"
        />
      )}
      <Avatar
        className={cn("relative rounded-full shadow-[0_6px_18px_-6px_rgba(0,0,0,0.55)]", ringClass)}
        style={{ width: size, height: size }}
      >
        {src && (
          <AvatarImage
            src={src}
            srcSet={srcSet}
            alt={name ?? "avatar"}
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            className={cn(
              "object-cover transition-opacity duration-300",
              loaded ? "opacity-100" : "opacity-0",
            )}
            style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
          />
        )}
        <AvatarFallback
          className="rounded-full text-sm font-bold bg-gradient-to-br from-[#2a2a2e] via-[#1a1a1c] to-black text-[color:var(--brand-gold,#d4af37)]"
          style={{ fontSize: Math.max(11, Math.round(size * 0.36)) }}
        >
          {initial}
        </AvatarFallback>
      </Avatar>
      {showSkeleton && src && !loaded && !errored && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-[linear-gradient(110deg,rgba(255,255,255,0.04),rgba(255,255,255,0.14),rgba(255,255,255,0.04))] bg-[length:200%_100%] animate-[shimmer_1.6s_linear_infinite]"
          style={{
            // Fallback keyframes injected once via styles.css already? Use a subtle pulse.
            animation: "pulse 1.4s ease-in-out infinite",
          }}
        />
      )}
    </span>
  );
}
