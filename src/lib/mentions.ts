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
