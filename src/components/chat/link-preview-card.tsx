import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLinkPreview, type LinkPreview } from "@/lib/link-preview.functions";
import { cn } from "@/lib/utils";
import { ExternalLink, Link2 } from "lucide-react";

/**
 * Rich Open-Graph link preview card — Noir & Gold styling.
 * Shows favicon, site name, title, description, and cover image
 * (when the target page exposes og:image / twitter:image).
 */
export function LinkPreviewCard({
  href,
  mine,
  rtl,
}: {
  href: string;
  mine: boolean;
  rtl: boolean;
}) {
  const fn = useServerFn(getLinkPreview);
  const { data, isLoading } = useQuery<LinkPreview | null>({
    queryKey: ["link-preview", href],
    queryFn: () => fn({ data: { url: href } }),
    staleTime: 1000 * 60 * 60 * 6, // 6h
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  if (isLoading) {
    return (
      <div
        className={cn(
          "mt-2 w-full max-w-[360px] overflow-hidden rounded-xl border animate-pulse",
          mine
            ? "border-white/20 bg-white/5"
            : "border-[color:var(--brand-gold,#d4af37)]/25 bg-black/20"
        )}
      >
        <div className="h-28 w-full bg-[linear-gradient(110deg,rgba(255,255,255,0.04)_8%,rgba(212,175,55,0.12)_18%,rgba(255,255,255,0.04)_33%)] bg-[length:200%_100%]" />
        <div className="p-2.5 space-y-1.5">
          <div className="h-2.5 w-1/3 rounded bg-white/10" />
          <div className="h-3 w-3/4 rounded bg-white/10" />
          <div className="h-2.5 w-full rounded bg-white/10" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const hasCover = !!data.image;
  const title = data.title || data.finalUrl;
  const site = data.siteName || data.domain;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      dir={rtl ? "rtl" : "ltr"}
      className={cn(
        "group/lp mt-2 block w-full max-w-[380px] overflow-hidden rounded-xl border transition-all",
        "shadow-[0_6px_20px_-8px_rgba(0,0,0,0.45)] hover:shadow-[0_10px_28px_-6px_rgba(0,0,0,0.65),0_0_0_1px_rgba(212,175,55,0.35)]",
        "backdrop-blur-sm",
        mine
          ? "border-white/25 bg-white/10 hover:border-white/40"
          : "border-[color:var(--brand-gold,#d4af37)]/30 bg-[linear-gradient(135deg,rgba(20,20,22,0.55),rgba(35,30,20,0.55))] hover:border-[color:var(--brand-gold,#d4af37)]/60"
      )}
    >
      {hasCover && (
        <div className="relative w-full overflow-hidden bg-black/40" style={{ aspectRatio: "1.91 / 1" }}>
          <img
            src={data.image}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover/lp:scale-[1.03]"
            onError={(e) => {
              (e.currentTarget.parentElement as HTMLElement | null)?.remove();
            }}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/60 to-transparent" />
        </div>
      )}

      <div className="p-2.5">
        <div className="flex items-center gap-1.5 mb-1 min-w-0">
          {data.favicon ? (
            <img
              src={data.favicon}
              alt=""
              width={14}
              height={14}
              className="h-3.5 w-3.5 rounded-sm object-contain shrink-0"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <Link2 className="h-3 w-3 shrink-0 opacity-70" />
          )}
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wider truncate",
              mine ? "text-white/80" : "text-[color:var(--brand-gold,#d4af37)]/90"
            )}
            title={site}
          >
            {site}
          </span>
          <ExternalLink className={cn("ms-auto h-3 w-3 shrink-0 opacity-60 transition-opacity group-hover/lp:opacity-100", mine ? "text-white" : "text-[color:var(--brand-gold,#d4af37)]")} />
        </div>

        <div
          className={cn(
            "text-[13px] font-semibold leading-snug line-clamp-2",
            mine ? "text-white" : "text-white/95"
          )}
        >
          {title}
        </div>

        {data.description && (
          <div
            className={cn(
              "mt-1 text-[11.5px] leading-snug line-clamp-2",
              mine ? "text-white/80" : "text-white/70"
            )}
          >
            {data.description}
          </div>
        )}
      </div>
    </a>
  );
}
