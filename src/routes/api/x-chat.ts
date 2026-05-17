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
- You have **read-only access** for business data, but you ARE strong at **search, filter, lookup, counting, grouping, and summaries** across invoices, invoice items, customers, products, stock, and purchase orders.
- **Search / lookup / filter**: when the user asks to "ابحث/دور/find/search/filter/show/list" for a serial number, invoice number, product name, full item description, color, customer, phone, drafts, low stock, top customers, totals, or invoice counts — the server pre-runs live lookups and injects the results under "Live data" / "Live search results" below. Use them directly and confidently.
- For product-in-invoices requests, you can use product name + serial + color together. If the user asks for "كل الفواتير اللي فيها المنتج ده" or "find invoices containing this item", use the injected invoice-item matches and give a proper count/summary.
- Link each invoice as [INVOICE_NUMBER](/invoices/<id>) when results are available.
- If nothing matched, say clearly that **no results were found in the current data** — NOT that the system cannot do it.
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
- Never claim a search/filter/count request is unsupported when live data is provided below. Use the live data first.
- Never argue with the user, shame them, or respond defensively even if they are frustrated. Stay calm, helpful, and action-oriented.

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

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cleanQueryTerm(value: string): string {
  return value.replace(/[,%()]/g, " ").replace(/\s+/g, " ").trim();
}

// Detect filter/aggregation/lookup intent in the user message and return a
// markdown block of live data to inject into the system prompt. Best-effort —
// returns "" when nothing relevant is found or on any error.
async function buildLiveData(userId: string, userMessage: string): Promise<string> {
  const msg = (userMessage || "").trim();
  if (!msg) return "";
  const lower = msg.toLowerCase();

  const wantsSearch =
    /\b(search|find|lookup|show|list|where|which)\b/i.test(lower) ||
    /(ابحث|دور|دوّر|هات|اعرض|فين|وين|اظهر|اعرضلي|جيب|طلع)/.test(msg);
  const wantsAggregate =
    /\b(top|best|total|sum|count|how many|how much|stats|summary|breakdown|compare)\b/i.test(lower) ||
    /(احصر|حصر|اجمالي|إجمالي|كام|عدد|احصائيات|إحصائيات|ملخص|قارن|اعلى|أعلى|اكثر|أكثر)/.test(msg);

  if (!wantsSearch && !wantsAggregate) return "";

  const sections: string[] = [];

  const stopWords = new Set([
    "ابحث", "دور", "دوّر", "هات", "اعرض", "اعرضلي", "جيب", "طلع", "عن", "لي", "فين", "وين", "اظهر", "اظهرلي",
    "كل", "جميع", "فاتورة", "الفاتورة", "الفواتير", "منتج", "المنتج", "منتجات", "المنتجات", "اللون", "لون", "رقم",
    "سيريال", "serial", "number", "invoice", "invoices", "product", "products", "customer", "customers", "phone",
    "search", "find", "lookup", "show", "list", "filter", "for", "about", "with", "from", "the", "this", "that",
  ]);

  // Extract a free-text term (strip common verbs)
  const term = msg
    .replace(/(ابحث|دور|دوّر|هات|اعرض|اعرضلي|جيب|طلع|search|find|lookup|show|list|عن|لي|عن|about|for|the|a|an)/gi, " ")
    .replace(/[?؟.!,]/g, " ")
    .trim();
  const normalizedTerm = normalizeSearchText(term);
  const serialTerms = uniqueNonEmpty(term.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g) ?? []);
  const tokens = uniqueNonEmpty(
    normalizedTerm
      .split(/[^\p{L}\p{N}-]+/u)
      .filter((token) => token.length >= 3 && !stopWords.has(token)),
  ).slice(0, 8);
  const queryTerms = uniqueNonEmpty([normalizedTerm, ...serialTerms, ...tokens])
    .map(cleanQueryTerm)
    .filter((value) => value.length >= 2)
    .slice(0, 8);

  const scoreItemMatch = (row: { product_name?: string | null; serial_number?: string | null; color?: string | null }) => {
    const haystack = normalizeSearchText([row.product_name, row.serial_number, row.color].filter(Boolean).join(" "));
    let score = 0;
    if (normalizedTerm && haystack.includes(normalizedTerm)) score += 50;
    serialTerms.forEach((serial) => {
      if (haystack.includes(normalizeSearchText(serial))) score += 25;
    });
    tokens.forEach((token) => {
      if (haystack.includes(token)) score += token.length >= 5 ? 8 : 4;
    });
    return score;
  };

  const noResults = () => `## Live search results for "${term || msg}"
- No matching records were found in invoices, invoice items, customers, or products for this query.`;

  // 1. Invoice / serial / customer lookup
  if (wantsSearch && term.length >= 2) {
    const invoiceSearchTerms = queryTerms.length ? queryTerms : [cleanQueryTerm(term)].filter(Boolean);
    const invoiceOr = invoiceSearchTerms
      .flatMap((value) => [`invoice_number.ilike.%${value}%`, `customer_name.ilike.%${value}%`, `customer_phone.ilike.%${value}%`])
      .join(",");
    const itemOr = invoiceSearchTerms
      .flatMap((value) => [`product_name.ilike.%${value}%`, `serial_number.ilike.%${value}%`, `color.ilike.%${value}%`])
      .join(",");
    const productOr = invoiceSearchTerms
      .flatMap((value) => [`name.ilike.%${value}%`, `serial_number.ilike.%${value}%`, `color.ilike.%${value}%`])
      .join(",");

    let invoiceQuery = supabaseAdmin
      .from("invoices")
      .select("id, invoice_number, customer_name, customer_phone, total, status, created_at")
      .eq("user_id", userId)
      .limit(20);
    if (invoiceOr) invoiceQuery = invoiceQuery.or(invoiceOr);

    let itemQuery = supabaseAdmin
      .from("invoice_items")
      .select("product_name, serial_number, color, quantity, line_total, invoice_id, invoices!inner(id, invoice_number, customer_name, status, created_at, user_id)")
      .eq("invoices.user_id", userId)
      .limit(120);
    if (itemOr) itemQuery = itemQuery.or(itemOr);

    let productQuery = supabaseAdmin
      .from("products")
      .select("id, name, serial_number, color, stock_quantity, price")
      .eq("user_id", userId)
      .limit(25);
    if (productOr) productQuery = productQuery.or(productOr);

    const [invoiceMatches, invoiceItemMatches, productMatches] = await Promise.all([
      invoiceQuery,
      itemQuery,
      productQuery,
    ]);

    const lines: string[] = [];
    (invoiceMatches.data ?? []).forEach((r: any) =>
      lines.push(`- Invoice ${r.invoice_number} — ${r.customer_name ?? "—"} — ${Number(r.total).toFixed(2)} EGP — ${r.status} — id:${r.id}`),
    );

    const scoredItemMatches = (invoiceItemMatches.data ?? [])
      .map((row: any) => ({ row, score: scoreItemMatch(row) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    const matchedInvoices = new Map<string, {
      invoiceId: string;
      invoiceNumber: string;
      customerName: string | null;
      status: string;
      createdAt: string;
      quantity: number;
      total: number;
      matches: string[];
    }>();

    scoredItemMatches.forEach(({ row }: any) => {
      const inv = row.invoices;
      if (!inv?.id) return;
      const existing = matchedInvoices.get(inv.id) ?? {
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        customerName: inv.customer_name ?? null,
        status: inv.status,
        createdAt: inv.created_at,
        quantity: 0,
        total: 0,
        matches: [] as string[],
      };
      existing.quantity += Number(row.quantity || 0);
      existing.total += Number(row.line_total || 0);
      existing.matches.push(
        [row.product_name, row.serial_number ? `SN ${row.serial_number}` : "", row.color ? `color ${row.color}` : ""]
          .filter(Boolean)
          .join(" — "),
      );
      matchedInvoices.set(inv.id, existing);
    });

    if (matchedInvoices.size) {
      const invoiceList = [...matchedInvoices.values()];
      const totalQty = invoiceList.reduce((sum, row) => sum + row.quantity, 0);
      const totalSales = invoiceList.reduce((sum, row) => sum + row.total, 0);
      sections.push([
        `## Invoice-item matches for "${term}"`,
        `- Matching invoices: ${invoiceList.length}`,
        `- Total matched quantity: ${totalQty}`,
        `- Total matched line sales: ${totalSales.toFixed(2)} EGP`,
        ...invoiceList.slice(0, 15).map((row) => `- Invoice ${row.invoiceNumber} — ${row.customerName ?? "—"} — qty ${row.quantity} — ${row.status} — ${row.matches.slice(0, 2).join(" | ")} — id:${row.invoiceId}`),
      ].join("\n"));
    }

    const scoredProducts = (productMatches.data ?? [])
      .map((row: any) => ({ row, score: scoreItemMatch({ product_name: row.name, serial_number: row.serial_number, color: row.color }) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    if (scoredProducts.length) {
      sections.push(
        `## Matching products in catalog\n${scoredProducts.map(({ row }: any) => `- ${row.name} — ${row.serial_number ? `SN ${row.serial_number}` : "no serial"} — ${row.color ?? "no color"} — stock ${row.stock_quantity} — price ${Number(row.price || 0).toFixed(2)} EGP — id:${row.id}`).join("\n")}`,
      );
    }

    if (lines.length) sections.push(`## Live search results for "${term}"\n${lines.slice(0, 20).join("\n")}`);
    if (!lines.length && !matchedInvoices.size && !scoredProducts.length) {
      sections.push(noResults());
    }
  }

  // 2. Drafts / void / paid quick lists
  if (/(drafts?|مسود|درافت)/i.test(msg)) {
    const { data } = await supabaseAdmin
      .from("invoices")
      .select("id, invoice_number, customer_name, total, created_at")
      .eq("user_id", userId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(15);
    if (data?.length) {
      sections.push(
        `## Draft invoices (latest ${data.length})\n${data.map((r: any) => `- ${r.invoice_number} — ${r.customer_name ?? "—"} — ${Number(r.total).toFixed(2)} EGP — id:${r.id}`).join("\n")}`,
      );
    }
  }

  // 3. Low stock
  if (/(low stock|out of stock|مخزون|ناقص|خلص|قليل)/i.test(msg)) {
    const { data } = await supabaseAdmin
      .from("products")
      .select("name, stock_quantity, low_stock_threshold")
      .eq("user_id", userId)
      .order("stock_quantity", { ascending: true })
      .limit(20);
    const low = (data ?? []).filter((p: any) => Number(p.stock_quantity) <= Number(p.low_stock_threshold ?? 5));
    if (low.length) {
      sections.push(`## Low-stock products\n${low.map((p: any) => `- ${p.name}: ${p.stock_quantity} (threshold ${p.low_stock_threshold ?? 5})`).join("\n")}`);
    }
  }

  // 4. Top customers (by total spend, last 90 days)
  if (/(top customers?|best customers?|اعلى عملاء|أعلى عملاء|افضل عملاء|أفضل عملاء)/i.test(msg)) {
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const { data } = await supabaseAdmin
      .from("invoices")
      .select("customer_name, total")
      .eq("user_id", userId)
      .gte("created_at", since)
      .not("customer_name", "is", null);
    const agg = new Map<string, { count: number; total: number }>();
    (data ?? []).forEach((r: any) => {
      const k = r.customer_name as string;
      const cur = agg.get(k) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(r.total || 0);
      agg.set(k, cur);
    });
    const top = [...agg.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
    if (top.length) {
      sections.push(
        `## Top customers (last 90 days)\n${top.map(([name, v]) => `- ${name}: ${v.count} invoices, ${v.total.toFixed(2)} EGP`).join("\n")}`,
      );
    }
  }

  if (wantsAggregate && term.length >= 2 && /(منتج|المنتج|product|item|الصنف|الصنف ده|الفواتير اللي فيها|contains|containing)/i.test(msg) && !sections.some((section) => section.startsWith("## Invoice-item matches"))) {
    sections.push(noResults());
  }

  if (!sections.length) return "";
  return `\n\n# Live data (use this to answer the user's question accurately)\n${sections.join("\n\n")}\n`;
}

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

        // Smart live data: detect filter/aggregation intent and inject results.
        // Covers serial/invoice/customer/phone lookup PLUS sales totals by
        // period, top customers/products, drafts/voids/paid lists, low stock,
        // product stock by name, customer stats by name/phone, and PO summary.
        let searchBlock = "";
        try {
          searchBlock = await buildLiveData(userId, userMessage);
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
