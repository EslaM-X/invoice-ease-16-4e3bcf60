// Shared runtime helpers for MCP tools: structured logging and unified error handling.
// Every tool wraps its handler with `runTool()` so failures are logged once with a
// stable shape and returned to the caller as a friendly, non-leaky message.

import type { ToolContext } from "@lovable.dev/mcp-js";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type LogFields = Record<string, unknown>;

function log(level: "info" | "warn" | "error", event: string, fields: LogFields) {
  const line = {
    ts: new Date().toISOString(),
    scope: "mcp",
    level,
    event,
    ...fields,
  };
  // JSON on one line = greppable in Worker logs.
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export function toolError(message: string, extra?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message, ...(extra ?? {}) },
    isError: true,
  };
}

export function toolOk(payload: unknown, humanText?: string): ToolResult {
  const text = humanText ?? JSON.stringify(payload);
  return {
    content: [{ type: "text", text }],
    structuredContent: payload && typeof payload === "object" ? (payload as Record<string, unknown>) : { value: payload },
  };
}

/** Wrap a tool handler with structured logging + uniform error mapping. */
export function runTool<Input>(
  name: string,
  handler: (input: Input, ctx: ToolContext) => Promise<ToolResult> | ToolResult,
) {
  return async (input: Input, ctx: ToolContext): Promise<ToolResult> => {
    const started = Date.now();
    const user = ctx.isAuthenticated() ? ctx.getUserId() : null;
    log("info", "tool_start", { tool: name, user });
    if (!ctx.isAuthenticated()) {
      log("warn", "tool_unauthenticated", { tool: name });
      return toolError("Not authenticated. Sign in and reconnect the MCP client.");
    }
    try {
      const res = await handler(input, ctx);
      log(res.isError ? "warn" : "info", res.isError ? "tool_failed" : "tool_ok", {
        tool: name, user, ms: Date.now() - started,
      });
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("error", "tool_exception", { tool: name, user, ms: Date.now() - started, message: msg });
      return toolError(`Tool "${name}" failed: ${msg}`);
    }
  };
}
