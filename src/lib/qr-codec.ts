// Compact QR payload codec: encodes only product_id + a short checksum.
// Format: "S1:<short-id>:<chk>"
//  - "S1" = Steinheim v1 prefix (so we can detect and version)
//  - short-id = full UUID (lowercased, hyphens kept) OR base32 hex (kept simple = UUID)
//  - chk = first 4 hex chars of FNV-1a 32-bit hash of the id
//
// Backward compatible: decode also accepts:
//  - bare UUID
//  - JSON payloads with { product_id }
//  - legacy { kind: "scanlink", ... } returns null

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 4);
}

export function encodeProductQR(productId: string): string {
  const id = productId.toLowerCase();
  return `S1:${id}:${fnv1a(id)}`;
}

export type DecodedQR =
  | { ok: true; productId: string; format: "v1" | "uuid" | "json" }
  | { ok: false; reason: "empty" | "invalid" | "checksum" | "scanlink" };

export function decodeProductQR(text: string): DecodedQR {
  const raw = (text ?? "").trim();
  if (!raw) return { ok: false, reason: "empty" };

  // V1 compact format
  if (raw.startsWith("S1:")) {
    const parts = raw.split(":");
    if (parts.length !== 3) return { ok: false, reason: "invalid" };
    const [, id, chk] = parts;
    const lower = id.toLowerCase();
    if (!UUID_RE.test(lower)) return { ok: false, reason: "invalid" };
    if (fnv1a(lower) !== chk.toLowerCase()) return { ok: false, reason: "checksum" };
    return { ok: true, productId: lower, format: "v1" };
  }

  // Bare UUID
  if (UUID_RE.test(raw)) {
    return { ok: true, productId: raw.toLowerCase(), format: "uuid" };
  }

  // JSON legacy
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.kind === "scanlink") return { ok: false, reason: "scanlink" };
    if (parsed && typeof parsed.product_id === "string" && UUID_RE.test(parsed.product_id)) {
      return { ok: true, productId: parsed.product_id.toLowerCase(), format: "json" };
    }
  } catch {}

  return { ok: false, reason: "invalid" };
}
