import { describe, it, expect } from "vitest";
import { parseLinks, renderLinkifiedText } from "./chat-links";

describe("parseLinks", () => {
  it("detects a full https URL", () => {
    const parts = parseLinks("Check this site: https://steinheim-eg.vercel.app/en");
    expect(parts).toEqual([
      { type: "text", value: "Check this site: " },
      { type: "link", href: "https://steinheim-eg.vercel.app/en", label: "https://steinheim-eg.vercel.app/en" },
    ]);
  });

  it("detects http URLs and www shorthand", () => {
    const parts = parseLinks("Visit http://old.example.com or www.new.example.com/path");
    expect(parts).toEqual([
      { type: "text", value: "Visit " },
      { type: "link", href: "http://old.example.com", label: "http://old.example.com" },
      { type: "text", value: " or " },
      { type: "link", href: "https://www.new.example.com/path", label: "www.new.example.com/path" },
    ]);
  });

  it("keeps plain text without false positives", () => {
    const parts = parseLinks("Just plain text with no links here.");
    expect(parts).toEqual([{ type: "text", value: "Just plain text with no links here." }]);
  });

  it("strips trailing punctuation from a link", () => {
    const parts = parseLinks("Open https://example.com.");
    expect(parts).toEqual([
      { type: "text", value: "Open " },
      { type: "link", href: "https://example.com", label: "https://example.com." },
    ]);
  });
});

describe("renderLinkifiedText", () => {
  it("renders a link as an anchor element and text as plain", () => {
    const nodes = renderLinkifiedText(
      "See https://steinheim-eg.vercel.app/en for details",
      "k",
      (t, key) => ({ t, key }),
      ({ href, label, key }) => ({ href, label, key }),
    );
    expect(nodes).toEqual([
      { t: "See ", key: "k-t-0" },
      { href: "https://steinheim-eg.vercel.app/en", label: "https://steinheim-eg.vercel.app/en", key: "k-l-1" },
      { t: " for details", key: "k-t-2" },
    ]);
  });
});
