import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getAvatarSrc, getAvatarSrcSet } from "@/lib/avatar-url";
import { useAvatarBust } from "@/lib/avatar-bust";

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
  /**
   * Optional cache-bust token appended as `?v=`. Change this to force a fresh
   * fetch, bypassing both the browser and Supabase CDN caches.
   */
  bust?: string | number | null;
};

/**
 * Module-level "already loaded" cache. Because the same avatar URL is shown in
 * many places (people list, chat headers, message bubbles), tracking success at
 * the module level guarantees that filter/sort/re-mount cycles NEVER show the
 * blur-up transition again for an image the browser has already decoded.
 */
const LOADED_URLS = new Set<string>();
const ERRORED_URLS = new Set<string>();

function keyFor(src: string | undefined, srcSet: string | undefined): string {
  return `${src ?? ""}||${srcSet ?? ""}`;
}

/**
 * Luxury chat avatar with high-DPR image transforms, an always-visible monogram
 * fallback underneath the image, and a persistent loaded-cache so avatars never
 * flicker or disappear when the parent list re-renders (filters, sorts, virtual
 * scroll). The monogram is rendered unconditionally so there is always SOMETHING
 * on screen — the image simply fades in over it.
 */
export function LuxuryAvatar({
  url,
  name,
  size = 44,
  ring = "soft",
  className,
  showSkeleton = true,
  bust,
}: Props) {
  const globalBust = useAvatarBust();
  const effectiveBust = bust ?? (globalBust || null);

  const src = getAvatarSrc(url, size, effectiveBust);
  const srcSet = getAvatarSrcSet(url, size, effectiveBust);
  const cacheKey = keyFor(src, srcSet);

  // Seed state from the module cache so a re-render (filter/sort) for a URL
  // that already succeeded stays "loaded" and never flashes the skeleton.
  const [loaded, setLoaded] = useState<boolean>(() => LOADED_URLS.has(cacheKey));
  const [errored, setErrored] = useState<boolean>(() => ERRORED_URLS.has(cacheKey));
  const lastKeyRef = useRef<string>(cacheKey);

  // Only reset when the URL/bust actually changes — NOT on every parent render.
  useEffect(() => {
    if (lastKeyRef.current === cacheKey) return;
    lastKeyRef.current = cacheKey;
    setLoaded(LOADED_URLS.has(cacheKey));
    setErrored(ERRORED_URLS.has(cacheKey));
  }, [cacheKey]);

  const markLoaded = useCallback(() => {
    LOADED_URLS.add(cacheKey);
    ERRORED_URLS.delete(cacheKey);
    setLoaded(true);
  }, [cacheKey]);

  const markErrored = useCallback(() => {
    ERRORED_URLS.add(cacheKey);
    LOADED_URLS.delete(cacheKey);
    setErrored(true);
  }, [cacheKey]);

  // Cached images may finish loading before React attaches onLoad on remount.
  // A ref callback that checks `img.complete` guarantees `loaded` flips true
  // even when the browser served the image straight from cache.
  const imgRefCb = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node) return;
      if (node.complete && node.naturalWidth > 0) {
        markLoaded();
      }
    },
    [markLoaded],
  );

  const ringClass =
    ring === "gold"
      ? "ring-2 ring-[color:var(--brand-gold,#d4af37)]/70 ring-offset-2 ring-offset-transparent"
      : ring === "soft"
        ? "ring-2 ring-white/15"
        : "";

  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const showImage = !!src && !errored;
  const showSkeletonNow = showSkeleton && showImage && !loaded;

  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {ring === "gold" && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-[conic-gradient(from_140deg,rgba(212,175,55,0.9),rgba(240,215,140,0.35),rgba(212,175,55,0.9))] blur-[1px] opacity-80"
        />
      )}
      <span
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-full shadow-[0_10px_28px_-8px_rgba(0,0,0,0.68)]",
          ringClass,
        )}
        style={{ width: size, height: size }}
      >
        {/* Always-visible monogram — the image fades in ON TOP of this so
            there is never a blank frame during filters/sorts/virtual scroll. */}
        <span
          aria-hidden={showImage && loaded}
          className="absolute inset-0 flex items-center justify-center rounded-full font-bold bg-gradient-to-br from-[#2a2a2e] via-[#1a1a1c] to-black text-[color:var(--brand-gold,#d4af37)] select-none"
          style={{ fontSize: Math.max(11, Math.round(size * 0.36)) }}
        >
          {initial}
        </span>

        {showImage && (
          <img
            ref={imgRefCb}
            src={src}
            srcSet={srcSet}
            sizes={`${size}px`}
            alt={name ?? "avatar"}
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            className={cn(
              "absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-200 [image-rendering:auto]",
              loaded ? "opacity-100" : "opacity-0",
            )}
            style={{ transform: "translateZ(0)", backfaceVisibility: "hidden" }}
            onLoad={markLoaded}
            onError={markErrored}
          />
        )}

        {showSkeletonNow && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-[linear-gradient(110deg,rgba(255,255,255,0.04),rgba(255,255,255,0.14),rgba(255,255,255,0.04))] bg-[length:200%_100%]"
            style={{ animation: "pulse 1.4s ease-in-out infinite" }}
          />
        )}
      </span>
    </span>
  );
}
