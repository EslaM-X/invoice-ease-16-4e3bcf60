import { describe, it, expect } from "vitest";
import {
  serializeComposerMentions,
  sanitizePastedMentions,
  parseMentionBody,
  extractMentionTargets,
  mentionsToPlain,
} from "./mentions";

const uidA = "11111111-1111-1111-1111-111111111111";
const uidB = "22222222-2222-2222-2222-222222222222";
const uidC = "33333333-3333-3333-3333-333333333333";

describe("serializeComposerMentions — visible @Name → storage token", () => {
  it("returns raw text unchanged when no pending mentions", () => {
    expect(serializeComposerMentions("hi @Ali", new Map())).toBe("hi @Ali");
  });

  it("serializes a single mention with trailing text", () => {
    const pending = new Map([["Ali", uidA]]);
    expect(serializeComposerMentions("@Ali please check", pending)).toBe(
      `@[Ali](${uidA}) please check`,
    );
  });

  it("serializes a mention followed immediately by punctuation", () => {
    const pending = new Map([["Ali", uidA]]);
    expect(serializeComposerMentions("@Ali, ok?", pending)).toBe(
      `@[Ali](${uidA}), ok?`,
    );
  });

  it("does NOT emit brackets or ids in the intermediate text", () => {
    const pending = new Map([["Ali", uidA]]);
    const out = serializeComposerMentions("hey @Ali extra words", pending);
    // No stray `[` or `(` other than the serialized token itself.
    const tokenMatches = out.match(/@\[[^\]]+\]\([^)]+\)/g) ?? [];
    expect(tokenMatches).toHaveLength(1);
    expect(out).not.toMatch(/@Ali(?!\])/); // no bare @Ali left
  });

  it("supports multiple distinct mentions in one message", () => {
    const pending = new Map([
      ["Ali", uidA],
      ["Sara", uidB],
    ]);
    const out = serializeComposerMentions("@Ali and @Sara review", pending);
    expect(out).toBe(`@[Ali](${uidA}) and @[Sara](${uidB}) review`);
  });

  it("replaces the longest name first (Ali Ahmed before Ali)", () => {
    const pending = new Map([
      ["Ali", uidA],
      ["Ali Ahmed", uidB],
    ]);
    const out = serializeComposerMentions("@Ali Ahmed", pending);
    expect(out).toBe(`@[Ali Ahmed](${uidB})`);
  });

  it("keeps existing @[Name](uid) tokens intact (idempotent)", () => {
    const pending = new Map([["Ali", uidA]]);
    const alreadyTokenized = `hi @[Ali](${uidA})`;
    expect(serializeComposerMentions(alreadyTokenized, pending)).toBe(alreadyTokenized);
  });

  it("handles RTL Arabic names inside RTL text", () => {
    const pending = new Map([["إسراء", uidA]]);
    const out = serializeComposerMentions("مرحبا @إسراء كيف حالك", pending);
    expect(out).toBe(`مرحبا @[إسراء](${uidA}) كيف حالك`);
  });

  it("does not partial-match names inside longer identifiers", () => {
    const pending = new Map([["Ali", uidA]]);
    // @Ali followed by a letter should NOT be treated as a mention.
    const out = serializeComposerMentions("email @Alison@x.com", pending);
    expect(out).toBe("email @Alison@x.com");
  });

  it("serializes three mentions with a caption for an image message", () => {
    const pending = new Map([
      ["Ali", uidA],
      ["Sara", uidB],
      ["Omar", uidC],
    ]);
    const caption = "check this @Ali @Sara @Omar";
    const out = serializeComposerMentions(caption, pending);
    expect(out).toBe(
      `check this @[Ali](${uidA}) @[Sara](${uidB}) @[Omar](${uidC})`,
    );
    // All three tokens produce distinct mention pills on receipt.
    expect(extractMentionTargets(out).sort()).toEqual([uidA, uidB, uidC].sort());
  });

  it("supports @everyone / all target", () => {
    const pending = new Map([["everyone", "all"]]);
    expect(serializeComposerMentions("hi @everyone", pending)).toBe(
      "hi @[everyone](all)",
    );
  });
});

describe("sanitizePastedMentions — clipboard paste hygiene", () => {
  it("returns null for plain text without tokens", () => {
    expect(sanitizePastedMentions("just plain text")).toBeNull();
    expect(sanitizePastedMentions("")).toBeNull();
  });

  it("rewrites a single pasted token to @Name and records the uid", () => {
    const r = sanitizePastedMentions(`hello @[Ali](${uidA}) there`);
    expect(r).not.toBeNull();
    expect(r!.cleaned).toBe("hello @Ali there");
    expect(r!.pairs).toEqual([["Ali", uidA]]);
  });

  it("captures multiple tokens in a pasted quote", () => {
    const r = sanitizePastedMentions(
      `> @[Ali](${uidA}) and @[Sara](${uidB}) reviewed it`,
    );
    expect(r!.cleaned).toBe("> @Ali and @Sara reviewed it");
    expect(r!.pairs).toEqual([
      ["Ali", uidA],
      ["Sara", uidB],
    ]);
  });

  it("preserves RTL surrounding text when sanitizing", () => {
    const r = sanitizePastedMentions(`مرحبا @[إسراء](${uidA}) كيف الحال`);
    expect(r!.cleaned).toBe("مرحبا @إسراء كيف الحال");
    expect(r!.pairs).toEqual([["إسراء", uidA]]);
  });

  it("round-trip: paste → sanitize → serialize produces identical storage form", () => {
    const original = `note @[Ali](${uidA}) fyi`;
    const sanitized = sanitizePastedMentions(original)!;
    const pending = new Map(sanitized.pairs);
    const roundTripped = serializeComposerMentions(sanitized.cleaned, pending);
    expect(roundTripped).toBe(original);
  });
});

describe("parseMentionBody — recipient side renders pills, not raw tokens", () => {
  it("produces alternating text and mention parts", () => {
    const parts = parseMentionBody(
      `hi @[Ali](${uidA}) and @[Sara](${uidB}) done`,
    );
    expect(parts).toEqual([
      { type: "text", value: "hi " },
      { type: "mention", name: "Ali", target: uidA },
      { type: "text", value: " and " },
      { type: "mention", name: "Sara", target: uidB },
      { type: "text", value: " done" },
    ]);
  });

  it("parses mentions mixed with an image caption", () => {
    const body = `📷 @[Ali](${uidA}) check this shot @[Sara](${uidB})`;
    const parts = parseMentionBody(body);
    const mentions = parts.filter((p) => p.type === "mention");
    expect(mentions).toHaveLength(2);
    // No raw bracket text should leak into the text parts.
    for (const p of parts) {
      if (p.type === "text") expect(p.value).not.toMatch(/@\[[^\]]+\]\([^)]+\)/);
    }
  });

  it("mentionsToPlain strips tokens for notification previews", () => {
    expect(
      mentionsToPlain(`hi @[Ali](${uidA}) and @[Sara](${uidB})`),
    ).toBe("hi @Ali and @Sara");
  });
});
