import type { ReactNode } from "react";

export type LinkPart =
  | { type: "text"; value: string }
  | { type: "link"; href: string; label: string };

/**
 * Detect http/https/ftp URLs and `www.` shorthand in a text fragment.
 * We intentionally avoid matching bare domains (e.g. "example.com") to
 * reduce false positives with ordinary words/punctuation.
 */
const URL_RE = /(\b(?:https?|ftp):\/\/[^\s<>"{}|\[\]^`]+|\bwww\.[^\s<>"{}|\[\]^`]+)/gi;

function normalizeHref(raw: string): string {
  const trimmed = raw.replace(/[.,;!?]+$/, ""); // strip trailing punctuation
  if (/^www\./i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function parseLinks(text: string): LinkPart[] {
  const out: LinkPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", value: text.slice(last, idx) });
    const raw = m[0];
    out.push({ type: "link", href: normalizeHref(raw), label: raw });
    last = idx + raw.length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

/** Render a text fragment into links + highlighted plain text. */
export function renderLinkifiedText(
  text: string,
  keyPrefix: string,
  renderText: (t: string, key: string) => ReactNode,
  renderLink: (l: { href: string; label: string; key: string }) => ReactNode,
): ReactNode[] {
  return parseLinks(text).map((p, i) =>
    p.type === "text"
      ? renderText(p.value, `${keyPrefix}-t-${i}`)
      : renderLink({ href: p.href, label: p.label, key: `${keyPrefix}-l-${i}` }),
  );
}
