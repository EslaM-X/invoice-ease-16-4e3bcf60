// X Assistant — streaming chat endpoint backed by Lovable AI Gateway.
// Authenticates the caller via Supabase bearer token, persists messages,
// and streams the assistant reply back as Server-Sent Events.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash"; // fast + capable; user wanted "Gemini-like, fast & strong"

const SYSTEM_PROMPT = `You are "X" — a luxury-grade smart assistant living inside Steinheim Egypt, an Arabic-first sales & inventory management app.

# Personality
- Confident, warm, professional. You sound like a sharp business partner, not a chatbot.
- Concise by default. Long-winded only when the user asks for depth.
- You crack a *light, tasteful* joke once in a while (max 1 per 3-4 turns). Never cringe, never forced. Egyptian street humor in Arabic; dry wit in English.
- Use emoji sparingly (1-2 max per reply) — only when they add warmth.
- Use Markdown when it actually helps: **bold**, lists, short headings, links.

# Language (CRITICAL)
- Auto-detect the user's language from their LATEST message and reply in the SAME language.
  - Arabic message → reply in Arabic (Egyptian colloquial preferred, MSA when formal).
  - English message → reply in English.
  - Mixed (code-switching) → match their mix.
- Never lecture about language. Just switch.

# Product knowledge
You know every section of the app and can deep-link to it:
- Dashboard [/dashboard], Invoices [/invoices], Drafts [/invoices/drafts], Archive [/invoices/archive]
- Delivery receipts [/delivery-receipts], New receipt [/delivery-receipts/new]
- Customers [/customers], Products [/products], Inventory [/inventory], Inventory audit [/inventory-audit]
- In-transit [/in-transit], Stock intake [/stock-intake], Purchase orders [/purchase-orders], PO tracking [/po-tracking]
- Reports [/reports], Profits [/profits], Profit calculator [/profit-calculator], Profit scenarios [/profit-scenarios]
- Sales today [/sales-today], Sales range [/sales-range], Sales audit [/sales-audit]
- Call center [/call-center], Call center reports [/call-center-reports]
- Audit log [/audit-log], Settings [/settings], Scan & sell [/scan-and-sell], Shipping order [/shipping-order]

When you mention a page, link it with markdown: [Page name](/route) — same in Arabic.

# Capability scope (current phase)
- You have **read-only access** for most business data: answer questions, explain UI, guide the user to the right page, recommend next actions.
- **Calendar & reminders (NEW)**: You CAN schedule events, reminders, shipment arrivals, and special dates for the user. To create one, append a fenced code block tagged \`x-action\` at the very END of your reply, containing JSON of shape:
  \`\`\`x-action
  {"type":"create_event","title":"...","starts_at":"YYYY-MM-DDTHH:mm:ss+02:00","notes":"...","kind":"event|shipment|reminder|milestone","remind_before_minutes":[60,1440]}
  \`\`\`
  Rules:
  - Always confirm the parsed details in natural language BEFORE the JSON block (e.g. "تمام، سجّلت لك وصول الشحنة الخميس ٢٠ مايو الساعة ١٠ صباحاً وهفكّرك قبلها بساعة وبيوم 👌").
  - Use Egypt timezone (+02:00) unless the user specifies another.
  - Use ISO 8601 with seconds and tz offset for \`starts_at\`.
  - Default \`remind_before_minutes\` to \`[60, 1440]\` (1 hour + 1 day before) unless the user specifies.
  - If the user says "ذكّرني قبلها بربع ساعة" use \`[15]\`. "قبلها بساعة" → \`[60]\`. "قبلها بيوم" → \`[1440]\`. Combine when they say multiple.
  - The user will see "اتسجّل في الكلندر ✨" toast. Don't repeat that in text.
  - Calendar lives at Settings → الكلندر الذكي. Link to it: [الكلندر](/settings).
- For other write actions (create/edit/delete invoice/product/customer/PO): say warmly that hands-on execution is landing in the next update, point to the right page + button.
- Voice chat is also coming next.

# Current time
The user's local time is approximately: {{NOW_ISO}} (Africa/Cairo). Use this to resolve relative phrases like "بكرة", "tomorrow", "الخميس الجاي".

# Honesty
- Never invent numbers, invoice IDs, customer names, or stock levels. If you don't have the real data, tell the user which page to open to see it.
- If you're unsure, say so briefly and offer the closest helpful answer.

# Tone examples
AR (light humor): "تمام، أنا تحت أمرك. تفتح الفواتير ولا أفتحلك التقارير الأول؟ 😉 (بس أنا مش بقترح حاجة غلط، عشان سمعتي)"
EN (dry wit): "Got it. Want me to walk you to invoices, or shall we look at profits first? (I promise the numbers don't bite.)"`;

const enc = new TextEncoder();
const sse = (data: any) => enc.encode(`data: ${JSON.stringify(data)}\n\n`);

export const Route = createFileRoute("/api/x-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = auth.slice(7);

        const SUPABASE_URL = process.env.SUPABASE_URL!;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: claimsData, error: authErr } = await userClient.auth.getClaims(token);
        if (authErr || !claimsData?.claims?.sub) {
          return new Response("Unauthorized", { status: 401 });
        }
        const userId = claimsData.claims.sub as string;

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        }

        let body: any;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const userMessage: string = String(body?.message ?? "").slice(0, 8000).trim();
        let conversationId: string | null = body?.conversationId ?? null;
        if (!userMessage) return new Response("Empty message", { status: 400 });

        // Ensure conversation exists
        if (!conversationId) {
          const { data: conv, error } = await supabaseAdmin
            .from("x_conversations")
            .insert({ user_id: userId, title: userMessage.slice(0, 60) })
            .select("id")
            .single();
          if (error || !conv) return new Response("DB error", { status: 500 });
          conversationId = conv.id;
        } else {
          // Verify ownership
          const { data: own } = await supabaseAdmin
            .from("x_conversations")
            .select("id")
            .eq("id", conversationId)
            .eq("user_id", userId)
            .maybeSingle();
          if (!own) return new Response("Forbidden", { status: 403 });
        }

        // Persist user message
        await supabaseAdmin.from("x_messages").insert({
          conversation_id: conversationId,
          user_id: userId,
          role: "user",
          content: userMessage,
        });

        // Load history (last 30 msgs) + user profile summary
        const { data: history } = await supabaseAdmin
          .from("x_messages")
          .select("role, content")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(30);

        const { data: profile } = await supabaseAdmin
          .from("x_user_profile")
          .select("summary, tone, frequent_topics, message_count, preferences")
          .eq("user_id", userId)
          .maybeSingle();

        // Build a live usage snapshot so the bot can give SMART, contextual
        // suggestions. Everything below respects the user_id scope already.
        const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
        const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const upcomingEnd = new Date(Date.now() + 14 * 24 * 3600_000).toISOString();

        const [
          invToday, invWeek, lowStock, customersWeek, upcomingEvents, recentPOs,
        ] = await Promise.all([
          supabaseAdmin.from("invoices").select("id,total", { count: "exact" })
            .eq("user_id", userId).gte("created_at", todayStart.toISOString()),
          supabaseAdmin.from("invoices").select("id,total", { count: "exact", head: false })
            .eq("user_id", userId).gte("created_at", weekAgo),
          supabaseAdmin.from("products").select("name,stock_quantity,low_stock_threshold")
            .eq("user_id", userId).limit(500),
          supabaseAdmin.from("customers").select("id", { count: "exact", head: true })
            .eq("user_id", userId).gte("created_at", weekAgo),
          supabaseAdmin.from("x_calendar_events").select("title,starts_at,kind")
            .eq("user_id", userId).gte("starts_at", new Date().toISOString())
            .lte("starts_at", upcomingEnd).order("starts_at").limit(8),
          supabaseAdmin.from("purchase_orders").select("po_number,status,expected_arrival_at")
            .eq("user_id", userId).gte("created_at", weekAgo).limit(10),
        ]);

        const todayCount = invToday.count ?? (invToday.data?.length ?? 0);
        const todayTotal = (invToday.data ?? []).reduce((s: number, r: any) => s + Number(r.total || 0), 0);
        const weekCount = invWeek.count ?? (invWeek.data?.length ?? 0);
        const weekTotal = (invWeek.data ?? []).reduce((s: number, r: any) => s + Number(r.total || 0), 0);
        const lowStockList = (lowStock.data ?? [])
          .filter((p: any) => Number(p.stock_quantity) <= Number(p.low_stock_threshold ?? 5))
          .slice(0, 8)
          .map((p: any) => `${p.name} (${p.stock_quantity})`);

        const usageSnapshot = [
          `# Live usage snapshot for THIS user (do not share these raw numbers unless asked; use them to give smart, contextual suggestions)`,
          `- Invoices today: ${todayCount} (total ≈ ${todayTotal.toFixed(2)} EGP)`,
          `- Invoices last 7 days: ${weekCount} (total ≈ ${weekTotal.toFixed(2)} EGP)`,
          `- New customers last 7 days: ${customersWeek.count ?? 0}`,
          `- Low-stock products (≤ threshold): ${lowStockList.length ? lowStockList.join(", ") : "none 🎉"}`,
          `- Upcoming calendar (next 14 days): ${(upcomingEvents.data ?? []).length
            ? (upcomingEvents.data ?? []).map((e: any) => `${e.title} @ ${new Date(e.starts_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}`).join("; ")
            : "nothing scheduled"}`,
          `- Recent POs: ${(recentPOs.data ?? []).length
            ? (recentPOs.data ?? []).map((p: any) => `${p.po_number}(${p.status}${p.expected_arrival_at ? `, arr ${new Date(p.expected_arrival_at).toLocaleDateString("en-GB")}` : ""})`).join("; ")
            : "none recent"}`,
        ].join("\n");

        const sysExtra =
          (profile?.summary
            ? `\n\n# Learned about this user (from past chats — guide tone & suggestions)\n${profile.summary}${profile.tone ? `\nPreferred tone: ${profile.tone}` : ""}`
            : "") +
          (Array.isArray(profile?.frequent_topics) && profile!.frequent_topics.length
            ? `\n# Frequent topics: ${(profile!.frequent_topics as any[]).join(", ")}`
            : "") +
          `\n\n${usageSnapshot}`;

        const nowIso = new Date().toLocaleString("sv-SE", { timeZone: "Africa/Cairo" });
        const messages = [
          { role: "system", content: (SYSTEM_PROMPT + sysExtra).replace("{{NOW_ISO}}", nowIso) },
          ...(history ?? []).map((m: any) => ({ role: m.role, content: m.content })),
        ];

        // Call Lovable AI Gateway with streaming
        const upstream = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model: MODEL, messages, stream: true }),
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          if (upstream.status === 429) {
            return new Response("rate_limited", { status: 429 });
          }
          if (upstream.status === 402) {
            return new Response("payment_required", { status: 402 });
          }
          return new Response(`AI error: ${text || upstream.status}`, { status: 500 });
        }

        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(sse({ type: "meta", conversationId }));
            const reader = upstream.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let full = "";
            try {
              while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split("\n");
                buffer = parts.pop() ?? "";
                for (const line of parts) {
                  const trimmed = line.trim();
                  if (!trimmed.startsWith("data:")) continue;
                  const payload = trimmed.slice(5).trim();
                  if (payload === "[DONE]") continue;
                  try {
                    const json = JSON.parse(payload);
                    const delta = json?.choices?.[0]?.delta?.content;
                    if (delta) {
                      full += delta;
                      controller.enqueue(sse({ type: "delta", content: delta }));
                    }
                  } catch {
                    // ignore
                  }
                }
              }
              // Persist assistant message
              if (full) {
                await supabaseAdmin.from("x_messages").insert({
                  conversation_id: conversationId,
                  user_id: userId,
                  role: "assistant",
                  content: full,
                });
                await supabaseAdmin
                  .from("x_conversations")
                  .update({ last_message_at: new Date().toISOString() })
                  .eq("id", conversationId);
              }
              controller.enqueue(sse({ type: "done" }));
            } catch (e: any) {
              controller.enqueue(sse({ type: "error", error: String(e?.message ?? e) }));
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
