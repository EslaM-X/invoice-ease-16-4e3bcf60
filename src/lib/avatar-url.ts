/**
 * High-DPI avatar URL helper.
 *
 * Given a source avatar URL and the desired CSS pixel size, returns an
 * intentionally over-sampled URL for the device pixel ratio so avatars render
 * crisp on retina and do not look soft inside luxury rings.
 * Also returns a `srcSet` string covering 1x/2x/3x for browsers that support it.
 *
 * Supported providers:
 *  - Google user content: rewrites `=sNN-c` → `=s{size*dpr}-c-no`.
 *  - Gravatar: sets `?s=NN&d=identicon`.
 *  - Supabase storage: rewrites object URLs (public, signed, authenticated)
 *    and existing render URLs to `/storage/v1/render/image/...` while keeping
 *    signed tokens and forcing cover resize + quality=100.
 *  - Anything else: returned unchanged.
 */

const MIN_TRANSFORM_PX = 384;
const MAX_TRANSFORM_PX = 1024;

function getDpr(): number {
  if (typeof window === "undefined") return 2;
  const d = window.devicePixelRatio || 1;
  if (d >= 2.5) return 3.5;
  if (d >= 1.5) return 2.75;
  return 1;
}

function transformSize(px: number): number {
  return Math.min(MAX_TRANSFORM_PX, Math.max(MIN_TRANSFORM_PX, Math.round(px)));
}

function withStorageTransform(url: string, px: number): string | null {
  try {
    const u = new URL(url);
    const objectPrefix = "/storage/v1/object/";
    const renderPrefix = "/storage/v1/render/image/";
    let rest: string | null = null;

    if (u.pathname.startsWith(objectPrefix)) {
      rest = u.pathname.slice(objectPrefix.length);
    } else if (u.pathname.startsWith(renderPrefix)) {
      rest = u.pathname.slice(renderPrefix.length);
    }
    if (!rest) return null;

    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    const access = rest.slice(0, slash);
    const path = rest.slice(slash + 1);
    if (!["public", "sign", "authenticated"].includes(access)) return null;

    const out = new URL(`${u.origin}/storage/v1/render/image/${access}/${path}`);
    u.searchParams.forEach((value, key) => out.searchParams.set(key, value));
    const size = transformSize(px);
    out.searchParams.set("width", String(size));
    out.searchParams.set("height", String(size));
    out.searchParams.set("resize", "cover");
    out.searchParams.set("quality", "100");
    return out.toString();
  } catch {
    return null;
  }
}

function sizeFor(url: string, px: number): string {
  if (!url) return url;
  const target = transformSize(px);

  // Google user content (photos from OAuth)
  //   ...=s96-c  →  ...=s{px}-c-no  (`-no` = no square crop artifacts)
  const gm = url.match(/=s(\d+)(?:-c)?(?:-no)?(?=($|[&?]))/);
  if (gm) {
    return url.replace(gm[0], `=s${target}-c-no`);
  }

  // Gravatar
  if (/gravatar\.com\/avatar\//i.test(url)) {
    const u = new URL(url);
    u.searchParams.set("s", String(target));
    if (!u.searchParams.has("d")) u.searchParams.set("d", "identicon");
    return u.toString();
  }

  const transformed = withStorageTransform(url, target);
  if (transformed) return transformed;

  return url;
}

/**
 * Returns the best `src` for the given CSS pixel size and current DPR.
 */
export function getAvatarSrc(url: string | null | undefined, sizePx: number): string | undefined {
  if (!url) return undefined;
  return sizeFor(url, Math.round(sizePx * getDpr()));
}

/**
 * Returns a `srcSet` covering 1x/2x/3x variants for the given CSS pixel size.
 */
export function getAvatarSrcSet(url: string | null | undefined, sizePx: number): string | undefined {
  if (!url) return undefined;
  const a = sizeFor(url, sizePx);
  const b = sizeFor(url, sizePx * 2);
  const c = sizeFor(url, sizePx * 3);
  return `${a} 1x, ${b} 2x, ${c} 3x`;
}
