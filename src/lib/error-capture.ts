// Captures uncaught errors out-of-band so the SSR wrapper can recover the
// stack when h3 swallows an in-handler error into a generic 500 Response.
let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  try {
    globalThis.addEventListener("error", (event: Event) =>
      record((event as ErrorEvent).error ?? event),
    );
    globalThis.addEventListener("unhandledrejection", (event: Event) =>
      record((event as PromiseRejectionEvent).reason),
    );
  } catch {
    /* ignore */
  }
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
