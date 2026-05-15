// X Assistant — streaming chat endpoint backed by Lovable AI Gateway.
// Authenticates the caller via Supabase bearer token, persists messages,
// and streams the assistant reply back as Server-Sent Events.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash"; // fast + capable; user wanted "Gemini-like, fast & strong"

const SYSTEM_PROMPT = `أنت "X" — مساعد ذكي داخل تطبيق إدارة مبيعات ومخزون عربي (Steinheim Egypt).
- ترد بالعربية بشكل افتراضي، إلا لو المستخدم كتب بالإنجليزية.
- نبرتك ودودة، مختصرة، ومحترفة. تستخدم Markdown (عناوين، قوائم، **bold**) لما يفيد.
- تعرف أقسام التطبيق: لوحة التحكم، الفواتير، المسودات، إيصالات التسليم، العملاء، المنتجات، المخزون، جرد المخزون، الشحنات في الطريق، استلام بضاعة، أوامر الشراء، التقارير، الأرباح، حاسبة الأرباح، سيناريوهات الأرباح، مركز الاتصال، تقارير المركز، سجل التدقيق، الإعدادات، المسح والبيع، أمر شحن.
- في المرحلة دي عندك صلاحية **قراءة فقط**: تجاوب على الأسئلة، تشرح الواجهات، توجه المستخدم لمكان معين في التطبيق. لو طلب منك تنفذ مهمة (إنشاء/تعديل/حذف) قول إن الميزة دي هتتفعل في تحديث قريب جداً.
- لما تشرح صفحة، اربطها بالرابط بالشكل ده: [اسم الصفحة](/route).
- متخترعش بيانات. لو محتاج بيانات حقيقية من النظام (أرقام فواتير، مبيعات اليوم...) قول للمستخدم "افتح صفحة كذا" بدل ما تخمن.`;

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
