// WhatsApp Cloud API webhook - receives messages from Meta
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GRAPH_API = "https://graph.facebook.com/v21.0";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

function verifySignature(body: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false; // refuse unsigned in production
  if (!signatureHeader) return false;
  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(body, "utf8").digest("hex");
  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function getOrCreateConversation(phone: string, name?: string) {
  // Find existing
  const { data: existing } = await supabaseAdmin
    .from("whatsapp_conversations")
    .select("*")
    .eq("customer_phone", phone)
    .maybeSingle();
  if (existing) return existing;

  // Try link to customer by phone
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id, name")
    .eq("phone", phone)
    .maybeSingle();

  const { data: created } = await supabaseAdmin
    .from("whatsapp_conversations")
    .insert({
      customer_phone: phone,
      customer_id: customer?.id ?? null,
      customer_name: name ?? customer?.name ?? null,
      status: "open",
      bot_enabled: true,
    })
    .select()
    .single();
  return created;
}

async function sendToMeta(payload: any) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return null;
  const res = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function botReply(conversationId: string, customerPhone: string, userMsg: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return;

  // Load recent context
  const { data: history } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("direction, body, message_type")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(10);

  const msgs = (history ?? [])
    .reverse()
    .filter((m: any) => m.body)
    .map((m: any) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.body,
    }));

  const systemPrompt = `أنت بوت خدمة عملاء لشركة Steinheim Egypt للخلاطات الفاخرة.
- ردك دايماً بالعربي المصري (لو العميل كلمك إنجليزي، رد إنجليزي).
- ودود ومحترف ومختصر.
- لو العميل سأل عن منتج أو سعر، قوله إن موظف هيتواصل معاه فوراً.
- لو طلب صيانة أو ضمان، اعمله ticket وقوله إن فريق الدعم هيتواصل.
- لو طلب فاتورة أو شراء، قوله إن موظف المبيعات هيتواصل لتأكيد الطلب.
- متستخدمش رموز كتير، رد طبيعي زي اللي بيتكلم في واتس اب.`;

  try {
    const res = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: systemPrompt }, ...msgs],
        max_tokens: 400,
      }),
    });
    const json: any = await res.json();
    const reply = json?.choices?.[0]?.message?.content;
    if (!reply) return;

    const sendResult = await sendToMeta({
      messaging_product: "whatsapp",
      to: customerPhone,
      type: "text",
      text: { body: reply },
    });

    await supabaseAdmin.from("whatsapp_messages").insert({
      conversation_id: conversationId,
      wa_message_id: sendResult?.messages?.[0]?.id ?? null,
      direction: "outbound",
      message_type: "text",
      body: reply,
      status: "sent",
      is_bot: true,
      raw: sendResult,
    });
  } catch (err) {
    console.error("Bot reply failed:", err);
  }
}

async function processInboundMessage(value: any) {
  const messages: any[] = value?.messages ?? [];
  const contacts: any[] = value?.contacts ?? [];
  const profileName = contacts?.[0]?.profile?.name;

  for (const msg of messages) {
    const from: string = msg.from;
    const wa_message_id: string = msg.id;
    const conv = await getOrCreateConversation(from, profileName);
    if (!conv) continue;

    // Dedupe
    const { data: dupe } = await supabaseAdmin
      .from("whatsapp_messages")
      .select("id")
      .eq("wa_message_id", wa_message_id)
      .maybeSingle();
    if (dupe) continue;

    let body: string | null = null;
    let mediaUrl: string | null = null;
    let mediaMime: string | null = null;
    let messageType = msg.type ?? "text";

    if (msg.type === "text") body = msg.text?.body ?? null;
    else if (msg.type === "image") body = msg.image?.caption ?? null;
    else if (msg.type === "document")
      body = msg.document?.caption ?? msg.document?.filename ?? null;
    else if (msg.type === "audio") body = "[رسالة صوتية]";
    else if (msg.type === "interactive") {
      body =
        msg.interactive?.button_reply?.title ??
        msg.interactive?.list_reply?.title ??
        null;
    }

    await supabaseAdmin.from("whatsapp_messages").insert({
      conversation_id: conv.id,
      wa_message_id,
      direction: "inbound",
      message_type: messageType,
      body,
      media_url: mediaUrl,
      media_mime: mediaMime,
      status: "delivered",
      raw: msg,
    });

    // Notify staff in-app
    await supabaseAdmin.from("notifications").insert({
      type: "whatsapp_message",
      title: `رسالة واتس اب من ${profileName ?? from}`,
      body: body?.slice(0, 100) ?? `[${messageType}]`,
      link: `/whatsapp?c=${conv.id}`,
      recipient_role: "admin",
    });

    // Bot reply if enabled and message has text
    if (conv.bot_enabled && body) {
      await botReply(conv.id, from, body);
    }
  }
}

async function processStatusUpdates(value: any) {
  const statuses: any[] = value?.statuses ?? [];
  for (const s of statuses) {
    if (!s.id) continue;
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({ status: s.status })
      .eq("wa_message_id", s.id);
  }
}

export const Route = createFileRoute("/api/public/whatsapp/webhook")({
  server: {
    handlers: {
      // Webhook verification (Meta calls this with a challenge)
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
        if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
          return new Response(challenge ?? "", { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        const bodyText = await request.text();
        const sig = request.headers.get("x-hub-signature-256");
        if (!verifySignature(bodyText, sig)) {
          return new Response("Invalid signature", { status: 401 });
        }
        let body: any;
        try {
          body = JSON.parse(bodyText);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        try {
          const entries = body?.entry ?? [];
          for (const entry of entries) {
            const changes = entry?.changes ?? [];
            for (const change of changes) {
              const value = change?.value;
              if (!value) continue;
              if (value.messages) await processInboundMessage(value);
              if (value.statuses) await processStatusUpdates(value);
            }
          }
        } catch (err) {
          console.error("Webhook processing error:", err);
        }
        // Always 200 to Meta to avoid retries on partial failures
        return new Response("ok", { status: 200 });
      },
    },
  },
});
