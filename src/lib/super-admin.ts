import { useAuth } from "@/lib/auth";

export const SUPER_ADMIN_EMAILS = new Set([
  "e.hesham@steinheim-eg.com",
  "k.elsharbatly@steinheim-eg.com",
]);

export function useIsSuperAdmin(): boolean {
  const { user } = useAuth();
  const email = (user?.email ?? "").trim().toLowerCase();
  return !!email && SUPER_ADMIN_EMAILS.has(email);
}

export function isSuperAdminEmail(email?: string | null): boolean {
  return !!email && SUPER_ADMIN_EMAILS.has(email.trim().toLowerCase());
}
