const CANONICAL_APP_ORIGIN = "https://admin.steinheim-eg.com";

export function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isPreviewHost(hostname?: string) {
  const currentHostname = hostname ?? (typeof window !== "undefined" ? window.location.hostname : "");
  return (
    currentHostname.startsWith("id-preview--") ||
    currentHostname.startsWith("preview--") ||
    currentHostname === "lovableproject.com" ||
    currentHostname.endsWith(".lovableproject.com") ||
    currentHostname === "lovableproject-dev.com" ||
    currentHostname.endsWith(".lovableproject-dev.com") ||
    currentHostname === "beta.lovable.dev" ||
    currentHostname.endsWith(".beta.lovable.dev") ||
    currentHostname.endsWith(".lovable.dev") ||
    (currentHostname.startsWith("project--") && currentHostname.endsWith("-dev.lovable.app"))
  );
}

export function isTopLevelWindow() {
  if (typeof window === "undefined") return false;
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

export function shouldDisablePwaFeatures() {
  if (typeof window === "undefined") return true;
  const params = new URLSearchParams(window.location.search);
  return isPreviewHost() || !isTopLevelWindow() || params.get("sw") === "off";
}

export function getStableAppUrl(path = "/dashboard") {
  if (typeof window === "undefined") {
    return new URL(path, CANONICAL_APP_ORIGIN).toString();
  }

  if (isPreviewHost()) {
    return new URL(path, CANONICAL_APP_ORIGIN).toString();
  }

  return new URL(path, window.location.origin).toString();
}

export function getCanonicalAppUrl() {
  if (typeof window === "undefined") {
    return new URL("/dashboard", CANONICAL_APP_ORIGIN).toString();
  }

  const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return new URL(path || "/dashboard", CANONICAL_APP_ORIGIN).toString();
}