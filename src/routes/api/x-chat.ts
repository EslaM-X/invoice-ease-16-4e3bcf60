// X Assistant — streaming chat endpoint backed by Lovable AI Gateway.
// Authenticates the caller via Supabase bearer token, persists messages,
// and streams the assistant reply back as Server-Sent Events.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash"; // fast + capable; user wanted "Gemini-like, fast & strong"

const SYSTEM_PROMPT = `You are "X" — a luxury-grade smart assistant living inside Steinheim Egypt, an Arabic-first sales & inventory management app. You are PERSISTENT: every conversation, every event the user schedules, every preference you learn — all of it is stored permanently in the database and never deleted. You build up real memory of this user over time.

# Personality
- Confident, warm, professional. You sound like a sharp business partner, not a chatbot.
- Concise by default. Long-winded only when the user asks for depth.
- You crack a *light, tasteful* joke once in a while (max 1 per 3-4 turns). Never cringe, never forced. Egyptian street humor in Arabic; dry wit in English.
- Use emoji sparingly (1-2 max per reply) — only when they add warmth.
- Use Markdown when it actually helps: **bold**, lists, short headings, links.

# Language (CRITICAL — non-negotiable)
- Auto-detect the user's language from their LATEST message and reply in the SAME language.
- **Arabic → اللهجة المصرية البحتة (Egyptian colloquial ONLY).** استخدم كلمات زي: "إيه، عشان، علشان، دلوقتي، خلاص، تمام، يعني، بص، طب، أيوة، لأ، معلش، حلو، جامد، هنشوف، هعمل، بقولك، خد بالك، ماشي، بيظبط، ميصحش، اتفقنا".
  - **ممنوع تماماً**: "كذلك، أيضًا، بالإضافة إلى ذلك، نعم، لا، حسناً، الآن، يمكنك، سوف، إذاً، لذلك" — دي فصحى مش مصري.
  - بدّلها بـ: "وكمان، وبرضو، أيوة، لأ، تمام، دلوقتي، تقدر، هـ، طب، عشان كده".
  - حتى لو السؤال رسمي، خلي اللهجة مصرية وودودة.
- **English → match the user's accent preference passed below.** Use natural US spellings (color, organize, analyze) for American; UK spellings (colour, organise, analyse) for British.
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
- **Search / lookup**: when the user asks to "ابحث/دور/find/search" for a serial number, invoice number, customer, or phone — the server already pre-runs the search and injects matches under "Live search results" below. Use them verbatim, link each invoice as [INVOICE_NUMBER](/invoices/<id>), and if nothing matched, say so clearly and suggest the closest page (e.g. [Invoices](/invoices)).
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
- Never invent numbers, invoice IDs, customer names, or stock levels. If you don't have the real data, use the live usage snapshot below — or tell the user which page to open to see it.
- If you're unsure, say so briefly and offer the closest helpful answer.

# Smart suggestions & learning (CRITICAL)
You actively LEARN this user's style — what pages they use, what they ignore, when they work, what they care about. The "Learned about this user" + "Live usage snapshot" sections below are injected fresh every turn. Use them to:
- Open with a relevant pulse when it fits (e.g. "شفت إن مبيعات اليوم لسه ٢ فواتير بس، تحب نراجع المخزون الناقص؟").
- Proactively surface 1 (max 2) helpful suggestions at the end of replies — short, actionable, contextual. Examples:
  - "اقتراح: ٣ منتجات مخزونها قرّب يخلّص — تفتح [المخزون](/inventory)؟"
  - "Heads-up: PO-2026-014 expected to arrive tomorrow — want me to set a reminder?"
- Suggest workflow improvements when you spot a pattern ("لاحظت إنك بتعمل ٣ فواتير لنفس العميل في اليوم — تحب تفعّل عميل دائم بخصم تلقائي؟").
- Never spam suggestions — skip them when the user is in the middle of a focused question.
- Everything is persistent: you remember between sessions. Don't say "I have no memory".

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
          .select("summary, tone, frequent_topics, message_count, preferences, job_title, nickname")
          .eq("user_id", userId)
          .maybeSingle();

        const { data: appProfile } = await supabaseAdmin
          .from("profiles")
          .select("display_name, email")
          .eq("user_id", userId)
          .maybeSingle();

        const identityName = profile?.nickname || appProfile?.display_name || appProfile?.email?.split("@")[0] || null;
        const identityJob = profile?.job_title || null;

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

        // On-demand search: if the user's latest message looks like a lookup
        // (e.g. "ابحث/find/serial/SN/invoice/فاتورة/رقم"), pre-fetch matching
        // invoices+items by serial/invoice#/customer name/phone and inject as
        // structured context so the bot can answer with real data.
        let searchBlock = "";
        try {
          const m = userMessage.toLowerCase();
          const isLookup =
            /ابحث|دور|دوّر|فين|سيريال|سيريل|رقم.*فاتور|فاتور|عميل|تليفون|هاتف/.test(userMessage) ||
            /search|find|lookup|serial|invoice|customer|phone/.test(m);
          // Extract candidate tokens (serials, invoice numbers, phone digits, words)
          const tokens = Array.from(
            new Set(
              (userMessage.match(/[A-Za-z0-9_\-\/\u0600-\u06FF]{3,}/g) || [])
                .filter((t) => !/^(ابحث|find|search|serial|invoice|سيريال|فاتورة|عميل|customer|phone|تليفون|رقم)$/i.test(t))
                .slice(0, 5),
            ),
          );
          if (isLookup && tokens.length) {
            const results: string[] = [];
            for (const tok of tokens) {
              const like = `%${tok}%`;
              const [bySerial, byInvoice] = await Promise.all([
                supabaseAdmin
                  .from("invoice_items")
                  .select("serial_number, product_name, quantity, unit_price, invoices!inner(id, invoice_number, customer_name, customer_phone, total, status, created_at, user_id)")
                  .eq("invoices.user_id", userId)
                  .ilike("serial_number", like)
                  .limit(8),
                supabaseAdmin
                  .from("invoices")
                  .select("id, invoice_number, customer_name, customer_phone, total, status, created_at")
                  .eq("user_id", userId)
                  .or(`invoice_number.ilike.${like},customer_name.ilike.${like},customer_phone.ilike.${like}`)
                  .limit(8),
              ]);
              (bySerial.data ?? []).forEach((row: any) => {
                const inv = row.invoices;
                results.push(
                  `• Serial ${row.serial_number} → invoice ${inv.invoice_number} (${inv.customer_name ?? "—"}, ${inv.customer_phone ?? "—"}, total ${inv.total} EGP, ${inv.status}, ${new Date(inv.created_at).toLocaleDateString("en-GB")}) — item: ${row.product_name} x${row.quantity} @ ${row.unit_price}`,
                );
              });
              (byInvoice.data ?? []).forEach((inv: any) => {
                results.push(
                  `• Invoice ${inv.invoice_number} — ${inv.customer_name ?? "—"} (${inv.customer_phone ?? "—"}) — ${inv.total} EGP — ${inv.status} — ${new Date(inv.created_at).toLocaleDateString("en-GB")}`,
                );
              });
            }
            const dedup = Array.from(new Set(results)).slice(0, 16);
            if (dedup.length) {
              searchBlock = `\n\n# Live search results for the user's query (use these to answer factually; deep-link invoices with [#NUMBER](/invoices/<id>))\n${dedup.join("\n")}`;
            } else {
              searchBlock = `\n\n# Live search: no invoices/serials matched the query tokens (${tokens.join(", ")})`;
            }
          }
        } catch {
          // best-effort; never break the chat
        }

        const sysExtraBase =
          (profile?.summary
            ? `\n\n# Learned about this user (from past chats — guide tone & suggestions)\n${profile.summary}${profile.tone ? `\nPreferred tone: ${profile.tone}` : ""}`
            : "") +
          (Array.isArray(profile?.frequent_topics) && profile!.frequent_topics.length
            ? `\n# Frequent topics: ${(profile!.frequent_topics as any[]).join(", ")}`
            : "") +
          `\n\n${usageSnapshot}` +
          searchBlock;

        const identityBlock = identityName
          ? `\n\n# Who you're talking to RIGHT NOW\nName: ${identityName}${identityJob ? `\nRole: ${identityJob}` : ""}\nAddress them by name occasionally (not every message). Remember their role when giving advice.`
          : `\n\n# Identity not set yet (CRITICAL)\nYou don't know this user's name or role yet. In your FIRST reply, warmly ask them: their preferred name and their job title/role. Then emit at the END of that reply an x-action block:\n\`\`\`x-action\n{"type":"set_identity","nickname":"...","job_title":"..."}\n\`\`\`\nAfter that you remember them forever — don't ask again.`;

        const sysExtra = identityBlock + sysExtraBase;

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

                // Learning loop: increment message_count, and every 6 turns
                // run a quick summarization to refresh the persistent profile.
                const newCount = (profile?.message_count ?? 0) + 1;
                await supabaseAdmin
                  .from("x_user_profile")
                  .upsert({ user_id: userId, message_count: newCount, updated_at: new Date().toISOString() });

                if (newCount % 6 === 0) {
                  // fire-and-forget — don't block the response
                  void updateUserMemory({
                    userId,
                    apiKey,
                    history: [
                      ...((history ?? []) as any[]),
                      { role: "user", content: userMessage },
                      { role: "assistant", content: full },
                    ],
                    previousSummary: profile?.summary ?? null,
                    previousTopics: (profile?.frequent_topics as string[] | undefined) ?? [],
                  });
                }
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

/**
 * Lightweight "memory keeper": every few turns, asks the gateway to summarize
 * the user's style, preferences, and frequent topics, then persists into
 * x_user_profile. The result feeds back into the next conversation as system
 * context — that's how X "learns" the user.
 */
async function updateUserMemory(args: {
  userId: string;
  apiKey: string;
  history: { role: string; content: string }[];
  previousSummary: string | null;
  previousTopics: string[];
}) {
  try {
    const tail = args.history.slice(-20)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    const prompt = `Update a long-lived memory profile for an app user, based on their chat with the assistant.
Previous summary: ${args.previousSummary ?? "(none)"}
Previous frequent topics: ${args.previousTopics.join(", ") || "(none)"}
Recent dialog:
${tail}

Return STRICT JSON with this shape (no prose, no fences):
{"summary": "<= 600 chars, 1-2 short paragraphs in English describing how this user works, what they care about, their preferred tone, recurring goals, recent context worth remembering",
 "tone": "<= 40 chars, e.g. 'casual Arabic, dry humor'",
 "frequent_topics": ["topic1","topic2","topic3"]  // max 8
}`;

    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${args.apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You output ONLY valid JSON. No commentary." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return;
    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    let parsed: any;
    try { parsed = JSON.parse(cleaned); } catch { return; }
    if (!parsed || typeof parsed !== "object") return;

    await supabaseAdmin.from("x_user_profile").upsert({
      user_id: args.userId,
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 2000) : args.previousSummary,
      tone: typeof parsed.tone === "string" ? parsed.tone.slice(0, 120) : null,
      frequent_topics: Array.isArray(parsed.frequent_topics) ? parsed.frequent_topics.slice(0, 8) : args.previousTopics,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // best-effort; never break the chat reply
  }
}
