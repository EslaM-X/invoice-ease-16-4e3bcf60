import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { runTool, toolError, toolOk } from "../runtime";
import { supabaseForUser } from "../supabase";

const STATUSES = ["pending", "in_progress", "done", "cancelled"] as const;

export default defineTool({
  name: "update_task_status",
  title: "Update task status",
  description:
    "Update the status of a task the signed-in user can modify (assignee or task manager). Sets started_at/completed_at automatically when moving into in_progress or done/cancelled.",
  inputSchema: {
    task_id: z.string().uuid().describe("Task id (uuid)."),
    status: z.enum(STATUSES).describe("New status."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: runTool<{ task_id: string; status: typeof STATUSES[number] }>(
    "update_task_status",
    async ({ task_id, status }, ctx) => {
      const patch: Record<string, unknown> = { status };
      if (status === "in_progress") patch.started_at = new Date().toISOString();
      if (status === "done" || status === "cancelled") patch.completed_at = new Date().toISOString();

      const { data, error } = await supabaseForUser(ctx)
        .from("tasks")
        .update(patch)
        .eq("id", task_id)
        .select("id,title,status,started_at,completed_at")
        .maybeSingle();
      if (error) return toolError(error.message, { code: error.code });
      if (!data) return toolError("Task not found or you do not have permission to update it.", { task_id });
      return toolOk({ task: data }, `Task ${data.id} is now ${data.status}.`);
    },
  ),
});
