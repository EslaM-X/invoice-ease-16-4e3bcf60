import { defineTool } from "@lovable.dev/mcp-js";
import { runTool, toolOk } from "../runtime";

export default defineTool({
  name: "whoami",
  title: "Who am I",
  description: "Return the signed-in Steinheim Suite user's id and email (from the verified OAuth token).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: runTool("whoami", (_input, ctx) => {
    const payload = { user_id: ctx.getUserId(), email: ctx.getUserEmail() };
    return toolOk(payload);
  }),
});
