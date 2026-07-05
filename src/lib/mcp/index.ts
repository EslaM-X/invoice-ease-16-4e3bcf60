import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listMyTasksTool from "./tools/list-my-tasks";

// The OAuth issuer must be the direct Supabase host, not the .lovable.cloud proxy
// (mcp-js verifies the issuer against the discovery document).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "steinheim-suite-mcp",
  title: "Steinheim Suite",
  version: "0.1.0",
  instructions:
    "Tools for the Steinheim Suite management app. Use `whoami` to confirm the connected account, and `list_my_tasks` to read tasks assigned to the signed-in user. All calls run as the authenticated user (RLS enforced).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listMyTasksTool],
});
