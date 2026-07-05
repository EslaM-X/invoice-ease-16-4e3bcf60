import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { runTool, toolError, toolOk } from "../runtime";
import { supabaseForUser } from "../supabase";

/**
 * Close a task = mark it done. Tasks do not touch stock or reservations
 * directly — inventory movement is driven by delivery receipts and PO
 * receipts on their own pages. This tool is safe to call multiple times;
 * re-closing an already-done task is a no-op that returns the current row.
 */
export default defineTool({
  name: "close_task",
  title: "Close task",
  description:
    "Close (mark as done) a task the signed-in user can modify. Stamps completed_at with the current time. Idempotent: closing an already-closed task just returns it. Does not modify inventory or reservations.",
  inputSchema: {
    task_id: z.string().uuid().describe("Task id (uuid)."),
    resolution_note: z.string().trim().min(1).max(4000).optional()
      .describe("Optional closing note. When provided, also posted as a task comment."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: runTool<{ task_id: string; resolution_note?: string }>(
    "close_task",
    async ({ task_id, resolution_note }, ctx) => {
      const sb = supabaseForUser(ctx);
      const { data, error } = await sb
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", task_id)
        .select("id,title,status,completed_at,assignee_id,assigned_by")
        .maybeSingle();
      if (error) return toolError(error.message, { code: error.code });
      if (!data) return toolError("Task not found or you do not have permission to close it.", { task_id });

      let comment_id: string | null = null;
      if (resolution_note) {
        const { data: c, error: cErr } = await sb
          .from("task_comments")
          .insert({ task_id, author_id: ctx.getUserId(), body: resolution_note })
          .select("id")
          .single();
        if (cErr) {
          // Task is already closed; surface a warning but do not roll back.
          return toolOk({ task: data, comment_error: cErr.message },
            `Closed task ${data.id}, but failed to add the resolution note.`);
        }
        comment_id = c.id;
      }

      return toolOk({ task: data, comment_id },
        `Closed task ${data.id}${comment_id ? " with resolution note" : ""}.`);
    },
  ),
});
