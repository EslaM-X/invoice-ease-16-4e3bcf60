// Access Studio server functions — super-admin only.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SUPER_ADMINS = new Set([
  "e.hesham@steinheim-eg.com",
  "k.elsharbatly@steinheim-eg.com",
]);

function ensureSuper(ctx: any) {
  const email = String(ctx?.claims?.email ?? "").toLowerCase();
  if (!SUPER_ADMINS.has(email)) throw new Error("Forbidden: super admins only");
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** List all company members with basic profile fields. */
export const listCompanyMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    ensureSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabaseAdmin.from("profiles").select("user_id, email, display_name, account_type, approval_status, created_at").order("created_at", { ascending: false }),
      supabaseAdmin.from("user_roles").select("user_id, role"),
    ]);
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });
    return (profiles ?? []).map((p: any) => ({
      user_id: p.user_id,
      email: p.email,
      display_name: p.display_name,
      account_type: p.account_type,
      approval_status: p.approval_status,
      created_at: p.created_at,
      roles: roleMap.get(p.user_id) ?? [],
    }));
  });

/** Load prefs for any user (super-admin). Falls back to empty. */
export const loadUserPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown): { user_id: string } => {
    if (!isObj(raw) || !raw.user_id) throw new Error("user_id required");
    return { user_id: String(raw.user_id) };
  })
  .handler(async ({ data, context }) => {
    ensureSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("user_ui_preferences")
      .select("*")
      .eq("user_id", data.user_id)
      .maybeSingle();
    return row ?? {
      user_id: data.user_id,
      nav_hidden: [], nav_order: [],
      cards_hidden: [], cards_order: [],
      mobile_tabs: [],
    };
  });

type SaveInput = {
  user_id: string;
  nav_hidden: string[];
  nav_order: string[];
  cards_hidden: string[];
  cards_order: string[];
  mobile_tabs: string[];
};

/** Upsert prefs for a user. */
export const saveUserPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown): SaveInput => {
    if (!isObj(raw) || !raw.user_id) throw new Error("user_id required");
    const arr = (k: string) => (Array.isArray((raw as any)[k]) ? (raw as any)[k].map((s: any) => String(s)) : []);
    return {
      user_id: String(raw.user_id),
      nav_hidden: arr("nav_hidden"),
      nav_order: arr("nav_order"),
      cards_hidden: arr("cards_hidden"),
      cards_order: arr("cards_order"),
      mobile_tabs: arr("mobile_tabs"),
    };
  })
  .handler(async ({ data, context }) => {
    ensureSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_ui_preferences")
      .upsert({
        user_id: data.user_id,
        nav_hidden: data.nav_hidden,
        nav_order: data.nav_order,
        cards_hidden: data.cards_hidden,
        cards_order: data.cards_order,
        mobile_tabs: data.mobile_tabs,
        updated_by: context.userId,
      }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    // audit (best-effort)
    try {
      await supabaseAdmin.from("audit_log").insert({
        actor_id: context.userId,
        action: "ui_prefs_update",
        entity_type: "user_ui_preferences",
        entity_id: data.user_id,
        details: {
          nav_hidden_count: data.nav_hidden.length,
          cards_hidden_count: data.cards_hidden.length,
        },
      } as any);
    } catch { /* ignore */ }
    return { ok: true };
  });

type CreateAccountInput = {
  email: string;
  password: string;
  name: string;
  account_type: "employee" | "distributor";
  roles: string[];
};

/** Create a new company user account (auth + profile + optional roles). */
export const createCompanyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown): CreateAccountInput => {
    if (!isObj(raw)) throw new Error("Invalid payload");
    const email = String(raw.email ?? "").trim().toLowerCase();
    const password = String(raw.password ?? "");
    const name = String(raw.name ?? "").trim();
    const at = String(raw.account_type ?? "employee");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
    if (password.length < 8) throw new Error("Password must be at least 8 characters");
    if (!name) throw new Error("Name required");
    const roles = Array.isArray(raw.roles) ? raw.roles.map((r: any) => String(r)) : [];
    return {
      email, password, name,
      account_type: at === "distributor" ? "distributor" : "employee",
      roles,
    };
  })
  .handler(async ({ data, context }) => {
    ensureSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userData, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.name, account_type: data.account_type },
    });
    if (cErr || !userData?.user) throw new Error(cErr?.message ?? "Failed to create user");
    const userId = userData.user.id;

    // Approve profile (trigger typically creates the row; update whatever exists)
    await supabaseAdmin.from("profiles").upsert({
      user_id: userId,
      email: data.email,
      display_name: data.name,
      account_type: data.account_type,
      approval_status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: context.userId,
    }, { onConflict: "user_id" });

    // Roles
    if (data.roles.length > 0) {
      const rows = data.roles.map((r) => ({ user_id: userId, role: r }));
      await supabaseAdmin.from("user_roles").upsert(rows as any, { onConflict: "user_id,role", ignoreDuplicates: true } as any);
    }

    return { user_id: userId, email: data.email };
  });

type ApplyToRoleInput = {
  role: string;
  nav_hidden: string[];
  nav_order: string[];
  cards_hidden: string[];
  cards_order: string[];
  overwrite: boolean;
};

/** Apply the current visibility template to every user that has a given role. */
export const applyPrefsToRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown): ApplyToRoleInput => {
    if (!isObj(raw) || !raw.role) throw new Error("role required");
    const arr = (k: string) => (Array.isArray((raw as any)[k]) ? (raw as any)[k].map((s: any) => String(s)) : []);
    return {
      role: String(raw.role),
      nav_hidden: arr("nav_hidden"),
      nav_order: arr("nav_order"),
      cards_hidden: arr("cards_hidden"),
      cards_order: arr("cards_order"),
      overwrite: Boolean((raw as any).overwrite ?? true),
    };
  })
  .handler(async ({ data, context }) => {
    ensureSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userRows, error: uErr } = await supabaseAdmin
      .from("user_roles").select("user_id").eq("role", data.role as any);
    if (uErr) throw new Error(uErr.message);
    const users = Array.from(new Set((userRows ?? []).map((r: any) => r.user_id))).filter(Boolean);
    if (users.length === 0) return { applied: 0 };

    const rows = users.map((uid) => ({
      user_id: uid,
      nav_hidden: data.nav_hidden,
      nav_order: data.nav_order,
      cards_hidden: data.cards_hidden,
      cards_order: data.cards_order,
      mobile_tabs: [],
      updated_by: context.userId,
    }));
    const { error } = await supabaseAdmin
      .from("user_ui_preferences")
      .upsert(rows as any, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    try {
      await supabaseAdmin.from("audit_log").insert({
        actor_id: context.userId,
        action: "ui_prefs_bulk_role",
        entity_type: "user_ui_preferences",
        entity_id: data.role,
        details: { role: data.role, users_count: users.length },
      } as any);
    } catch { /* ignore */ }
    return { applied: users.length };
  });
