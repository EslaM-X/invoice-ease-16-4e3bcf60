// WhatsApp Cloud API - server functions
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GRAPH_API = "https://graph.facebook.com/v21.0";

// Internal helper: send a WhatsApp message via Meta Cloud API
async function sendToMeta(payload: any) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    throw new Error(
      "WhatsApp not configured. Add WHATSAPP_ACCESS_TOKEN & WHATSAPP_PHONE_NUMBER_ID secrets."
    );
  }
  const res = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json: any = await res.json();
  if (!res.ok) {
    throw new Error(
      `WhatsApp send failed [${res.status}]: ${JSON.stringify(json)}`
    );
  }
  return json;
}

function normalizePhone(raw: string): string {
  let p = raw.replace(/\D/g, "");
  if (p.startsWith("00")) p = p.substring(2);
  if (p.startsWith("0")) p = "20" + p.substring(1); // EG default
  return p;
}

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { conversations: data ?? [] };
  });

export const listConversationMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ conversation_id: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: msgs, error } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("conversation_id", data.conversation_id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    // Reset unread
    await supabase
      .from("whatsapp_conversations")
      .update({ unread_count: 0 })
      .eq("id", data.conversation_id);
    return { messages: msgs ?? [] };
  });

export const sendWhatsAppText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        conversation_id: z.string().uuid().optional(),
        to: z.string().min(8).max(20).optional(),
        body: z.string().min(1).max(4000),
      })
      .refine((v) => v.conversation_id || v.to, {
        message: "either conversation_id or to is required",
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    let convId = data.conversation_id;
    let phone = data.to ? normalizePhone(data.to) : "";

    if (convId) {
      const { data: c } = await supabase
        .from("whatsapp_conversations")
        .select("customer_phone")
        .eq("id", convId)
        .single();
      if (!c) throw new Error("Conversation not found");
      phone = c.customer_phone;
    } else {
      // create or fetch conversation
      const { data: existing } = await supabase
        .from("whatsapp_conversations")
        .select("id")
        .eq("customer_phone", phone)
        .maybeSingle();
      if (existing) convId = existing.id;
      else {
        const { data: created, error: insErr } = await supabase
          .from("whatsapp_conversations")
          .insert({ customer_phone: phone, status: "open", bot_enabled: false })
          .select("id")
          .single();
        if (insErr) throw new Error(insErr.message);
        convId = created.id;
      }
    }

    const result = await sendToMeta({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: data.body },
    });

    const waMsgId = result?.messages?.[0]?.id ?? null;
    await supabase.from("whatsapp_messages").insert({
      conversation_id: convId,
      wa_message_id: waMsgId,
      direction: "outbound",
      message_type: "text",
      body: data.body,
      status: "sent",
      sent_by: userId,
      sent_by_email: (claims as any)?.email ?? null,
      is_bot: false,
      raw: result,
    });

    return { ok: true, conversation_id: convId, wa_message_id: waMsgId };
  });

export const sendWhatsAppDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        conversation_id: z.string().uuid(),
        document_url: z.string().url(),
        filename: z.string().max(100),
        caption: z.string().max(1000).optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const { data: c } = await supabase
      .from("whatsapp_conversations")
      .select("customer_phone")
      .eq("id", data.conversation_id)
      .single();
    if (!c) throw new Error("Conversation not found");

    const result = await sendToMeta({
      messaging_product: "whatsapp",
      to: c.customer_phone,
      type: "document",
      document: {
        link: data.document_url,
        filename: data.filename,
        caption: data.caption,
      },
    });

    await supabase.from("whatsapp_messages").insert({
      conversation_id: data.conversation_id,
      wa_message_id: result?.messages?.[0]?.id ?? null,
      direction: "outbound",
      message_type: "document",
      body: data.caption ?? null,
      media_url: data.document_url,
      media_filename: data.filename,
      status: "sent",
      sent_by: userId,
      sent_by_email: (claims as any)?.email ?? null,
      raw: result,
    });

    return { ok: true };
  });

export const setBotEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ conversation_id: z.string().uuid(), enabled: z.boolean() })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("whatsapp_conversations")
      .update({ bot_enabled: data.enabled })
      .eq("id", data.conversation_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const checkWhatsAppStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const hasToken = !!process.env.WHATSAPP_ACCESS_TOKEN;
    const hasPhoneId = !!process.env.WHATSAPP_PHONE_NUMBER_ID;
    const hasSecret = !!process.env.WHATSAPP_APP_SECRET;
    const hasVerifyToken = !!process.env.WHATSAPP_VERIFY_TOKEN;
    return {
      configured: hasToken && hasPhoneId && hasSecret && hasVerifyToken,
      details: { hasToken, hasPhoneId, hasSecret, hasVerifyToken },
    };
  });
