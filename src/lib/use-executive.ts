import { useAuth } from "@/lib/auth";

/**
 * Top-tier executives who can see cost, USD pricing, profits,
 * the admin panel, and the audit log. All other accounts have these
 * surfaces hidden — including in notifications.
 */
export const EXECUTIVE_EMAILS = [
  "k.elsharbatly@steinheim-eg.com",
  "cfo@steinheim-eg.com",
  "h.elsharbatly@steinheim-eg.com",
  "e.hesham@steinheim-eg.com",
  "esraa@steinheim-eg.com",
];

export function useIsExecutive(): boolean {
  const { user } = useAuth();
  const email = (user?.email ?? "").trim().toLowerCase();
  return !!email && EXECUTIVE_EMAILS.includes(email);
}

/** Notification types that should ONLY be visible to executives. */
export const EXEC_ONLY_NOTIFICATION_TYPES = new Set([
  "backup",
  "purchase_order",
  "purchase_order_priced",
  "profit",
  "profit_alert",
  "cost_change",
  "price_change",
  "admin",
  "audit",
]);
