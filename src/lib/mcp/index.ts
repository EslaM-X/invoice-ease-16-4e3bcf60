import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listMyTasksTool from "./tools/list-my-tasks";
import updateTaskStatusTool from "./tools/update-task-status";
import addTaskCommentTool from "./tools/add-task-comment";
import closeTaskTool from "./tools/close-task";

// The OAuth issuer must be the direct Supabase host, not the .lovable.cloud proxy
// (mcp-js verifies the issuer against the discovery document).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "steinheim-suite-mcp",
  title: "Steinheim Suite",
  version: "0.2.0",
  instructions:
    "Tools for the Steinheim Suite management app. Read: `whoami`, `list_my_tasks`. Write: `update_task_status`, `add_task_comment`, `close_task`. All calls run as the authenticated user (Supabase RLS enforced). Errors return `isError: true` with a human-readable message; see /mcp-docs in the app for payload examples.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listMyTasksTool, updateTaskStatusTool, addTaskCommentTool, closeTaskTool],
});

