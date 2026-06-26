// Admin-only server functions for distributor account management.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Only these admin emails can create distributor accounts directly (no email confirmation).
const ALLOWED_ADMINS = new Set([
  "e.hesham@steinheim-eg.com",
  "k.elsharbatly@steinheim-eg.com",
]);

type CreateInput = {
  email: string;
  password: string;
  name: string;
  showroom_name?: string | null;
  location?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  branches_count?: number;
  notes?: string | null;
  is_active?: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateInput(raw: unknown): CreateInput {
  if (!isPlainObject(raw)) throw new Error("Invalid payload");
  const email = String(raw.email ?? "").trim().toLowerCase();
  const password = String(raw.password ?? "");
  const name = String(raw.name ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  if (!name) throw new Error("Name is required");
  const branches = Number(raw.branches_count ?? 1);
  return {
    email,
    password,
    name,
    showroom_name: raw.showroom_name ? String(raw.showroom_name) : null,
    location: raw.location ? String(raw.location) : null,
    city: raw.city ? String(raw.city) : null,
    address: raw.address ? String(raw.address) : null,
    phone: raw.phone ? String(raw.phone) : null,
    branches_count: Number.isFinite(branches) && branches > 0 ? branches : 1,
    notes: raw.notes ? String(raw.notes) : null,
    is_active: raw.is_active !== false,
  };
}

export const adminCreateDistributorAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateInput)
  .handler(async ({ data, context }) => {
    const callerEmail = (context.claims?.email ?? "").toLowerCase();
    if (!ALLOWED_ADMINS.has(callerEmail)) {
      throw new Error("Only e.hesham@steinheim-eg.com or k.elsharbatly@steinheim-eg.com can create distributor accounts");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Create the auth user with confirmed email + password (no email sent)
    const { data: userData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.name,
        account_type: "distributor",
        showroom_name: data.showroom_name,
        location: data.location,
        city: data.city,
        phone: data.phone,
        branches_count: String(data.branches_count ?? 1),
      },
    });
    if (createErr || !userData?.user) throw new Error(createErr?.message ?? "Failed to create user");

    const userId = userData.user.id;

    // 2) Insert the distributor row, active by default
    const { data: dist, error: distErr } = await supabaseAdmin.from("distributors").insert({
      user_id: userId,
      name: data.name,
      showroom_name: data.showroom_name,
      location: data.location,
      city: data.city,
      address: data.address,
      phone: data.phone,
      email: data.email,
      branches_count: data.branches_count ?? 1,
      notes: data.notes,
      is_active: data.is_active !== false,
      created_by: context.userId,
    }).select().single();
    if (distErr) {
      // best-effort cleanup
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      throw new Error(distErr.message);
    }

    return { distributor: dist, user_id: userId, email: data.email };
  });

type ResetInput = { user_id: string; password: string };
export const adminResetDistributorPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown): ResetInput => {
    if (!isPlainObject(raw)) throw new Error("Invalid payload");
    const user_id = String(raw.user_id ?? "");
    const password = String(raw.password ?? "");
    if (!user_id) throw new Error("user_id required");
    if (password.length < 8) throw new Error("Password must be at least 8 characters");
    return { user_id, password };
  })
  .handler(async ({ data, context }) => {
    const callerEmail = (context.claims?.email ?? "").toLowerCase();
    if (!ALLOWED_ADMINS.has(callerEmail)) {
      throw new Error("Forbidden");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
