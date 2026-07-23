import { useEffect, useRef, type ReactNode } from "react";
import twemoji from "twemoji";

/**
 * Wraps children and post-renders emojis as Twemoji SVG images so they
 * display consistently on every OS/browser (Windows, Linux, older Android)
 * even when the system emoji font is missing or renders "tofu" boxes.
 * Skips URLs and code-like tokens by only parsing text nodes.
 */
export function TwemojiBody({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "span";
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      twemoji.parse(el, {
        folder: "svg",
        ext: ".svg",
        base: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/",
        className: "twemoji",
      });
    } catch {
      // ignore — falls back to native rendering
    }
  });

  return (
    <Tag ref={ref as any} className={className}>
      {children}
    </Tag>
  );
}
