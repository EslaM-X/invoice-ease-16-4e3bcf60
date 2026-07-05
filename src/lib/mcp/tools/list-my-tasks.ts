import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { runTool, toolError, toolOk } from "../runtime";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_tasks",
  title: "List my tasks",
  description: "List tasks assigned to the signed-in user, newest first. Filter by status if provided.",
  inputSchema: {
    status: z.enum(["pending", "in_progress", "done", "cancelled"]).optional().describe("Optional status filter."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows to return (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: runTool<{ status?: "pending" | "in_progress" | "done" | "cancelled"; limit?: number }>(
    "list_my_tasks",
    async ({ status, limit }, ctx) => {
      let q = supabaseForUser(ctx)
        .from("tasks")
        .select("id,title,description,status,priority,due_date,created_at,assignee_id,assigned_by")
        .eq("assignee_id", ctx.getUserId())
        .order("created_at", { ascending: false })
        .limit(limit ?? 20);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return toolError(error.message, { code: error.code });
      return toolOk({ tasks: data ?? [] });
    },
  ),
});
