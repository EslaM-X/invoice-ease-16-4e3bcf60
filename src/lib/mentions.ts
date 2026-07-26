/**
 * Mention tokens are stored inline in message bodies as:
 *
 *     @[Display Name](user_id_or_all)
 *
 * `user_id_or_all` is either a UUID (specific user) or the literal string
 * `all` for @everyone / @all group pings. This lets us render, notify, and
 * export mentions without changing the message schema.
 */
import type { ReactNode } from "react";

export type ParsedPart =
  | { type: "text"; value: string }
  | { type: "mention"; name: string; target: string /* uuid | "all" */ };

// Accept any non-paren target so malformed/legacy tokens still render as @Name
// instead of leaking raw `@[Name](id)` text into the bubble.
const MENTION_RE = /@\[([^\]]{1,80})\]\(([^)\s]{1,80})\)/g;

export function parseMentionBody(body: string): ParsedPart[] {
  const out: ParsedPart[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", value: body.slice(last, idx) });
    out.push({ type: "mention", name: m[1], target: m[2] });
    last = idx + m[0].length;
  }
  if (last < body.length) out.push({ type: "text", value: body.slice(last) });
  return out;
}

/** Extract unique mention targets from a message body. */
export function extractMentionTargets(body: string): string[] {
  const set = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) set.add(m[2]);
  return [...set];
}

/** Return a plain-text version of the body (for previews/notifications). */
export function mentionsToPlain(body: string): string {
  return body.replace(MENTION_RE, (_all, name) => `@${name}`);
}

/**
 * Render a body into React nodes with mentions replaced by a pill.
 * `renderText` is called with plain-text fragments and may itself return
 * highlighted nodes (search highlighting).
 */
export function renderMentionBody(
  body: string,
  currentUserId: string | null,
  renderText: (text: string, key: string) => ReactNode,
  renderMention: (m: { name: string; target: string; isSelf: boolean; key: string }) => ReactNode,
): ReactNode[] {
  const parts = parseMentionBody(body);
  return parts.map((p, i) => {
    if (p.type === "text") return renderText(p.value, `t-${i}`);
    const isSelf = p.target === "all" || (currentUserId != null && p.target === currentUserId);
    return renderMention({ name: p.name, target: p.target, isSelf, key: `m-${i}` });
  });
}

/**
 * Convert visible `@Name` occurrences in a composer draft back to the
 * storage token `@[Name](uid)`. Pure so it's easy to unit-test with the
 * many edge-cases (RTL, punctuation, multiple mentions, existing tokens).
 *
 * - Longest names are replaced first so "Ali" doesn't shadow "Ali Ahmed".
 * - Skips `@Name` occurrences that are already inside a `@[Name](...)` token.
 * - Only matches when the next char is not a letter/number/underscore, so
 *   free-form text after the mention is preserved verbatim.
 */
export function serializeComposerMentions(
  raw: string,
  pending: ReadonlyMap<string, string>,
): string {
  if (pending.size === 0) return raw;
  const entries = [...pending.entries()].sort((a, b) => b[0].length - a[0].length);
  let out = raw;
  for (const [name, uid] of entries) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<!\\[)@${escaped}(?![\\p{L}\\p{N}_])`, "gu");
    out = out.replace(re, `@[${name}](${uid})`);
  }
  return out;
}

/**
 * Detect raw storage tokens (`@[Name](uid)`) inside pasted clipboard text
 * and rewrite them to visible `@Name`, capturing each name→uid so the
 * message can be re-serialized on send. Returns null when the payload has
 * no tokens and the paste should be handled by the browser as usual.
 */
export function sanitizePastedMentions(
  raw: string,
): { cleaned: string; pairs: Array<[string, string]> } | null {
  if (!raw || !/@\[[^\]]+\]\([^)\s]+\)/.test(raw)) return null;
  const pairs: Array<[string, string]> = [];
  const cleaned = raw.replace(/@\[([^\]]{1,80})\]\(([^)\s]{1,80})\)/g, (_all, name, uid) => {
    pairs.push([name, uid]);
    return `@${name}`;
  });
  return { cleaned, pairs };
}
