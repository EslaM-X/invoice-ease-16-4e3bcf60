import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { runTool, toolError, toolOk } from "../runtime";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "add_task_comment",
  title: "Add task comment",
  description:
    "Post a comment on a task the signed-in user can access (assignee, creator, or task manager). The comment appears immediately in the Tasks UI via realtime updates.",
  inputSchema: {
    task_id: z.string().uuid().describe("Task id (uuid)."),
    body: z.string().trim().min(1).max(4000).describe("Comment text (1-4000 chars)."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: runTool<{ task_id: string; body: string }>(
    "add_task_comment",
    async ({ task_id, body }, ctx) => {
      const sb = supabaseForUser(ctx);
      const { data, error } = await sb
        .from("task_comments")
        .insert({ task_id, author_id: ctx.getUserId(), body })
        .select("id,task_id,author_id,body,created_at")
        .single();
      if (error) return toolError(error.message, { code: error.code });
      return toolOk({ comment: data }, `Added comment ${data.id} to task ${task_id}.`);
    },
  ),
});
