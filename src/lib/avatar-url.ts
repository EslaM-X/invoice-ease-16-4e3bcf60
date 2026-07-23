/**
 * High-DPI avatar URL helper.
 *
 * Given a source avatar URL and the desired CSS pixel size, returns a URL sized
 * for the device pixel ratio (up to 3x) so avatars render crisp on retina.
 * Also returns a `srcSet` string covering 1x/2x/3x for browsers that support it.
 *
 * Supported providers:
 *  - Google user content: rewrites `=sNN-c` → `=s{size*dpr}-c-no`.
 *  - Gravatar: sets `?s=NN&d=identicon`.
 *  - Supabase public storage: rewrites `/storage/v1/object/public/...`
 *    → `/storage/v1/render/image/public/...?width=NN&resize=cover&quality=90`.
 *  - Anything else: returned unchanged.
 */

function getDpr(): number {
  if (typeof window === "undefined") return 2;
  const d = window.devicePixelRatio || 1;
  if (d >= 2.5) return 3;
  if (d >= 1.5) return 2;
  return 1;
}

function sizeFor(url: string, px: number): string {
  if (!url) return url;

  // Google user content (photos from OAuth)
  //   ...=s96-c  →  ...=s{px}-c-no  (`-no` = no square crop artifacts)
  const gm = url.match(/=s(\d+)(?:-c)?(?:-no)?(?=($|[&?]))/);
  if (gm) {
    return url.replace(gm[0], `=s${px}-c-no`);
  }

  // Gravatar
  if (/gravatar\.com\/avatar\//i.test(url)) {
    const u = new URL(url);
    u.searchParams.set("s", String(px));
    if (!u.searchParams.has("d")) u.searchParams.set("d", "identicon");
    return u.toString();
  }

  // Supabase public storage → render endpoint with resize
  const sm = url.match(/^(https?:\/\/[^/]+)\/storage\/v1\/object\/public\/(.+?)(\?.*)?$/i);
  if (sm) {
    const base = sm[1];
    const path = sm[2].replace(/\?.*$/, "");
    return `${base}/storage/v1/render/image/public/${path}?width=${px}&height=${px}&resize=cover&quality=90`;
  }

  // Supabase signed URLs already contain the render endpoint or a token; leave them
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
