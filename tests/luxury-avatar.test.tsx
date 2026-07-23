import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { LuxuryAvatar } from "@/components/chat/luxury-avatar";

// jsdom doesn't decode images; simulate cache-hit by setting complete/naturalWidth
function markImgComplete(container: HTMLElement) {
  const img = container.querySelector("img") as HTMLImageElement | null;
  if (!img) return;
  Object.defineProperty(img, "complete", { value: true, configurable: true });
  Object.defineProperty(img, "naturalWidth", { value: 128, configurable: true });
  img.dispatchEvent(new Event("load"));
}

describe("LuxuryAvatar filter stability", () => {
  beforeEach(() => {
    // reset module cache between tests via fresh URLs
  });

  it("keeps loaded state across rapid re-renders (filter churn)", () => {
    const url = "https://example.com/img-a.png";
    const { container, rerender } = render(<LuxuryAvatar url={url} name="Ali" />);
    act(() => markImgComplete(container));
    const img1 = container.querySelector("img")!;
    expect(img1.className).toContain("opacity-100");

    // Simulate 20 rapid filter re-renders with identical props
    for (let i = 0; i < 20; i++) {
      rerender(<LuxuryAvatar url={url} name="Ali" />);
    }
    const img2 = container.querySelector("img")!;
    expect(img2.className).toContain("opacity-100");
    expect(img2.className).not.toContain("opacity-0");
  });

  it("always renders an initial fallback beneath the image", () => {
    const { container } = render(<LuxuryAvatar url={"https://example.com/x.png"} name="Sara" />);
    expect(container.textContent).toContain("S");
  });

  it("remembers a URL's loaded status across separate mounts", () => {
    const url = "https://example.com/img-b.png";
    const first = render(<LuxuryAvatar url={url} name="Omar" size={40} />);
    act(() => markImgComplete(first.container));
    first.unmount();

    // Re-mount for the same URL — should start already-loaded (no opacity-0)
    const second = render(<LuxuryAvatar url={url} name="Omar" size={40} />);
    const img = second.container.querySelector("img")!;
    expect(img.className).toContain("opacity-100");
  });

  it("resets when the URL changes but keeps the fallback visible", () => {
    const { container, rerender } = render(
      <LuxuryAvatar url={"https://example.com/img-c.png"} name="Nour" />,
    );
    act(() => markImgComplete(container));
    rerender(<LuxuryAvatar url={"https://example.com/img-c-2.png"} name="Nour" />);
    // Fallback initial must remain on screen even before the new image loads
    expect(container.textContent).toContain("N");
  });
});
