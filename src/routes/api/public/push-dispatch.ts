import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const VAPID_PUBLIC =
  "BHumFqOZX7fwwzh_QV0I9Tj0ku0MdXV23IWNtrezc-MFeoD8PJhRoX8dkXbHC0b3CLKGjBOWIawo-okPLjKmBjg";

const TYPE_LABEL: Record<string, string> = {
  invoice_created: "🧾 فاتورة جديدة",
  invoice_updated: "✏️ تحديث فاتورة",
  call_logged: "📞 مكالمة جديدة",
  low_stock: "⚠️ مخزون منخفض",
  shipment_in_transit: "🚚 شحنة في الطريق",
  shipment_arrived: "📦 وصلت الشحنة",
  shipment_delayed: "⏳ تأخر في الشحنة",
  backup: "💾 نسخة احتياطية",
};

export const Route = createFileRoute("/api/public/push-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const bodyText = await request.text();
          const sigHeader = request.headers.get("x-dispatch-signature") ?? "";

          // Load shared secret from DB
          const { data: cfg } = await (supabaseAdmin as any)
            .from("notification_dispatch_config").select("hmac_secret").eq("id", 1).single();
          if (!cfg?.hmac_secret) return new Response("config", { status: 500 });

          const expected = createHmac("sha256", cfg.hmac_secret).update(bodyText).digest("hex");
          const a = Buffer.from(sigHeader, "hex");
          const b = Buffer.from(expected, "hex");
          if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return new Response("invalid signature", { status: 401 });
          }

          const { notification_id } = JSON.parse(bodyText);
          if (!notification_id) return new Response("missing id", { status: 400 });

          // Fetch the notification + recipients
          const { data: notif } = await (supabaseAdmin as any)
            .from("notifications")
            .select("id, user_id, recipient_role, type, title, body, link, meta")
            .eq("id", notification_id)
            .maybeSingle();
          if (!notif) return new Response("not found", { status: 404 });

          // Resolve recipients (user_id direct OR role)
          let recipientIds: string[] = [];
          if (notif.user_id) recipientIds = [notif.user_id];
          else if (notif.recipient_role) {
            const { data: roleUsers } = await (supabaseAdmin as any)
              .from("user_roles").select("user_id").eq("role", notif.recipient_role);
            recipientIds = (roleUsers ?? []).map((r: any) => r.user_id);
          }
          if (recipientIds.length === 0) return new Response("no recipients", { status: 200 });

          // Fetch prefs (filter disabled)
          const { data: prefsRows } = await (supabaseAdmin as any)
            .from("user_notification_preferences")
            .select("user_id, push_enabled, sound, vibration, custom_sound_url")
            .in("user_id", recipientIds);
          const prefsMap = new Map<string, any>();
          (prefsRows ?? []).forEach((r: any) => prefsMap.set(r.user_id, r));

          const enabledIds = recipientIds.filter((id) => {
            const p = prefsMap.get(id);
            return !p || p.push_enabled !== false;
          });
          if (enabledIds.length === 0) return new Response("all disabled", { status: 200 });

          // Fetch subscriptions
          const { data: subs } = await (supabaseAdmin as any)
            .from("push_subscriptions")
            .select("id, user_id, endpoint, p256dh, auth")
            .in("user_id", enabledIds);
          if (!subs?.length) return new Response("no subs", { status: 200 });

          webpush.setVapidDetails(
            process.env.VAPID_SUBJECT || "mailto:admin@example.com",
            VAPID_PUBLIC,
            process.env.VAPID_PRIVATE_KEY!,
          );

          const titlePrefix = TYPE_LABEL[notif.type] ?? "🔔";
          const expired: string[] = [];

          await Promise.all(
            subs.map(async (s: any) => {
              const p = prefsMap.get(s.user_id) ?? {};
              const payload = JSON.stringify({
                id: notif.id,
                title: notif.title || titlePrefix,
                body: notif.body ?? "",
                url: notif.link || "/",
                tag: notif.id,
                sound: p.sound || "default",
                customUrl: p.custom_sound_url || null,
                vibration: p.vibration || "default",
                meta: notif.meta ?? null,
              });
              try {
                await webpush.sendNotification(
                  { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                  payload,
                  { TTL: 60 * 60 * 24 },
                );
              } catch (err: any) {
                if (err?.statusCode === 404 || err?.statusCode === 410) expired.push(s.id);
              }
            }),
          );

          if (expired.length) {
            await (supabaseAdmin as any).from("push_subscriptions").delete().in("id", expired);
          }

          // ───── Also email each recipient via transactional send route ─────
          try {
            const { data: emailUsers } = await (supabaseAdmin as any).auth.admin.listUsers({ perPage: 200 });
            const emailById = new Map<string, string>();
            (emailUsers?.users ?? []).forEach((u: any) => { if (u?.email) emailById.set(u.id, u.email); });
            const link = notif.link?.startsWith("http") ? notif.link : `https://admin.steinheim-eg.com${notif.link || "/"}`;
            const origin = new URL(request.url).origin;
            await Promise.all(
              enabledIds.map(async (uid) => {
                const email = emailById.get(uid);
                if (!email) return;
                try {
                  await fetch(`${origin}/lovable/email/transactional/send`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                    },
                    body: JSON.stringify({
                      templateName: "notification",
                      recipientEmail: email,
                      idempotencyKey: `notif-${notif.id}-${uid}`,
                      templateData: {
                        title: notif.title || titlePrefix,
                        body: notif.body ?? "",
                        actionUrl: link,
                      },
                    }),
                  });
                } catch (e) {
                  console.error("[push-dispatch] email send failed", e);
                }
              }),
            );
          } catch (mailErr) {
            console.error("[push-dispatch] email enqueue failed", mailErr);
          }

          return new Response(JSON.stringify({ ok: true, sent: subs.length - expired.length }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[push-dispatch] error", e);
          return new Response(`error: ${e?.message ?? "unknown"}`, { status: 500 });
        }
      },
    },
  },
});
