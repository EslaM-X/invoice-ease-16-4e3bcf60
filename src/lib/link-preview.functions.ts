// Link preview (Open Graph / Twitter Card / oEmbed) — server function
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type LinkPreview = {
  url: string;
  finalUrl: string;
  siteName?: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  themeColor?: string;
  domain: string;
};

function absolutize(u: string | undefined, base: string): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u, base).toString();
  } catch {
    return undefined;
  }
}

function decode(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function pickMeta(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    // property="og:title" content="..." OR reversed
    const re1 = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`,
      "i"
    );
    const re2 = new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`,
      "i"
    );
    const m = html.match(re1) || html.match(re2);
    if (m && m[1]) return decode(m[1].trim());
  }
  return undefined;
}

function pickTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1].trim()).slice(0, 220) : undefined;
}

function pickFavicon(html: string, base: string): string | undefined {
  const re = /<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  let best: string | undefined;
  while ((match = re.exec(html))) {
    const tag = match[0];
    const hrefM = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (hrefM) best = absolutize(hrefM[1], base) ?? best;
  }
  return best ?? absolutize("/favicon.ico", base);
}

export const getLinkPreview = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ url: z.string().url() }).parse(data))
  .handler(async ({ data }): Promise<LinkPreview | null> => {
    const target = data.url;
    let host = "";
    try {
      host = new URL(target).hostname;
    } catch {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(target, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; SteinheimBot/1.0; +https://steinheim-eg.com)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en,ar;q=0.8",
        },
      });
      const ctype = res.headers.get("content-type") ?? "";
      const finalUrl = res.url || target;
      if (!res.ok || !/text\/html|application\/xhtml/i.test(ctype)) {
        return {
          url: target,
          finalUrl,
          domain: host,
          title: host,
        };
      }
      // Only read first ~256KB — meta tags always live in <head>
      const reader = res.body?.getReader();
      let buf = "";
      let total = 0;
      const MAX = 256 * 1024;
      if (reader) {
        const decoder = new TextDecoder("utf-8", { fatal: false });
        while (total < MAX) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          buf += decoder.decode(value, { stream: true });
          if (/<\/head>/i.test(buf)) break;
        }
        try { await reader.cancel(); } catch { /* noop */ }
      } else {
        buf = await res.text();
      }

      const head = buf.split(/<\/head>/i)[0] ?? buf;

      const title =
        pickMeta(head, ["og:title", "twitter:title"]) ?? pickTitle(head);
      const description = pickMeta(head, [
        "og:description",
        "twitter:description",
        "description",
      ]);
      const imageRaw = pickMeta(head, [
        "og:image:secure_url",
        "og:image:url",
        "og:image",
        "twitter:image",
        "twitter:image:src",
      ]);
      const siteName = pickMeta(head, ["og:site_name", "application-name"]);
      const themeColor = pickMeta(head, ["theme-color"]);

      return {
        url: target,
        finalUrl,
        domain: host,
        title: title?.slice(0, 220),
        description: description?.slice(0, 320),
        image: absolutize(imageRaw, finalUrl),
        favicon: pickFavicon(head, finalUrl),
        siteName: siteName?.slice(0, 120),
        themeColor,
      };
    } catch {
      return {
        url: target,
        finalUrl: target,
        domain: host,
        title: host,
      };
    } finally {
      clearTimeout(timeout);
    }
  });
