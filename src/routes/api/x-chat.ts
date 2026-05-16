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
- You have **read-only access** for now: answer questions, explain UI, guide the user to the right page, recommend next actions.
- If they ask you to *execute* a write action (create/edit/delete invoice/product/customer/PO), say warmly that hands-on execution is landing in the next update — and meanwhile point them to the exact page + button to do it themselves.
- Voice chat is also coming next.

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
          .select("summary, tone")
          .eq("user_id", userId)
          .maybeSingle();

        const sysExtra = profile?.summary
          ? `\n\nملخص شخصية المستخدم (يرشدك في النبرة): ${profile.summary}${profile.tone ? ` — النبرة المفضلة: ${profile.tone}` : ""}`
          : "";

        const messages = [
          { role: "system", content: SYSTEM_PROMPT + sysExtra },
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
