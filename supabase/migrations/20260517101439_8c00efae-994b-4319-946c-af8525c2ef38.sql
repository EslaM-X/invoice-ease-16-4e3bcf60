
-- =============================================
-- WHATSAPP TABLES
-- =============================================

CREATE TABLE public.whatsapp_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | closed | bot
  assigned_to UUID,
  assigned_to_email TEXT,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_preview TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  bot_enabled BOOLEAN NOT NULL DEFAULT true,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_phone)
);

CREATE INDEX idx_wa_conv_last_msg ON public.whatsapp_conversations(last_message_at DESC);
CREATE INDEX idx_wa_conv_status ON public.whatsapp_conversations(status);

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members view wa conversations"
ON public.whatsapp_conversations FOR SELECT TO authenticated
USING (is_company_member());

CREATE POLICY "company members insert wa conversations"
ON public.whatsapp_conversations FOR INSERT TO authenticated
WITH CHECK (is_company_member());

CREATE POLICY "company members update wa conversations"
ON public.whatsapp_conversations FOR UPDATE TO authenticated
USING (is_company_member());

CREATE POLICY "admins delete wa conversations"
ON public.whatsapp_conversations FOR DELETE TO authenticated
USING (is_admin());


CREATE TABLE public.whatsapp_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  wa_message_id TEXT UNIQUE, -- Meta's message id (for dedupe)
  direction TEXT NOT NULL, -- inbound | outbound
  message_type TEXT NOT NULL DEFAULT 'text', -- text | image | document | audio | video | interactive | template | system
  body TEXT,
  media_url TEXT,
  media_mime TEXT,
  media_filename TEXT,
  status TEXT NOT NULL DEFAULT 'sent', -- queued | sent | delivered | read | failed
  error_message TEXT,
  sent_by UUID, -- staff user, NULL for bot/customer
  sent_by_email TEXT,
  is_bot BOOLEAN NOT NULL DEFAULT false,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_msg_conv ON public.whatsapp_messages(conversation_id, created_at DESC);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members view wa messages"
ON public.whatsapp_messages FOR SELECT TO authenticated
USING (is_company_member());

CREATE POLICY "company members insert wa messages"
ON public.whatsapp_messages FOR INSERT TO authenticated
WITH CHECK (is_company_member());

CREATE POLICY "company members update wa messages"
ON public.whatsapp_messages FOR UPDATE TO authenticated
USING (is_company_member());


CREATE TABLE public.whatsapp_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  language TEXT NOT NULL DEFAULT 'ar',
  category TEXT NOT NULL DEFAULT 'UTILITY',
  body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members view wa templates"
ON public.whatsapp_templates FOR SELECT TO authenticated
USING (is_company_member());

CREATE POLICY "admins manage wa templates"
ON public.whatsapp_templates FOR ALL TO authenticated
USING (is_admin()) WITH CHECK (is_admin());


-- =============================================
-- SUPPORT TICKETS (queues for maintenance/warranty/hotline)
-- =============================================

CREATE TABLE public.support_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_number TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL, -- maintenance | warranty | hotline | sales
  priority TEXT NOT NULL DEFAULT 'normal', -- low | normal | high | urgent
  status TEXT NOT NULL DEFAULT 'open', -- open | in_progress | waiting | resolved | closed
  subject TEXT NOT NULL,
  description TEXT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_phone TEXT,
  customer_name TEXT,
  conversation_id UUID REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  invoice_id UUID,
  assigned_to UUID,
  assigned_to_email TEXT,
  assigned_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_by UUID,
  created_by_email TEXT,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | whatsapp | call | email
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_status ON public.support_tickets(status, category, priority);
CREATE INDEX idx_tickets_assigned ON public.support_tickets(assigned_to);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members view tickets"
ON public.support_tickets FOR SELECT TO authenticated
USING (is_company_member());

CREATE POLICY "company members insert tickets"
ON public.support_tickets FOR INSERT TO authenticated
WITH CHECK (is_company_member());

CREATE POLICY "company members update tickets"
ON public.support_tickets FOR UPDATE TO authenticated
USING (is_company_member());

CREATE POLICY "admins delete tickets"
ON public.support_tickets FOR DELETE TO authenticated
USING (is_admin());


-- Sequence for ticket numbering
CREATE SEQUENCE IF NOT EXISTS public.support_ticket_seq START 1000;

CREATE OR REPLACE FUNCTION public.generate_ticket_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := 'TKT-' || to_char(now(), 'YYMM') || '-' || nextval('public.support_ticket_seq');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_tickets_number
BEFORE INSERT ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.generate_ticket_number();

CREATE TRIGGER trg_support_tickets_updated
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =============================================
-- INTERNAL CHAT
-- =============================================

CREATE TABLE public.chat_rooms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'direct', -- direct | group
  name TEXT,
  avatar_url TEXT,
  description TEXT,
  created_by UUID NOT NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_rooms_last_msg ON public.chat_rooms(last_message_at DESC);

ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;


CREATE TABLE public.chat_room_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  user_email TEXT,
  role TEXT NOT NULL DEFAULT 'member', -- owner | admin | member
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  muted BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

CREATE INDEX idx_chat_members_user ON public.chat_room_members(user_id);
CREATE INDEX idx_chat_members_room ON public.chat_room_members(room_id);

ALTER TABLE public.chat_room_members ENABLE ROW LEVEL SECURITY;


-- Security definer helper to avoid recursive RLS
CREATE OR REPLACE FUNCTION public.is_chat_room_member(_room_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_room_members
    WHERE room_id = _room_id AND user_id = _user_id
  );
$$;


-- chat_rooms policies (use helper to avoid recursion)
CREATE POLICY "members view their rooms"
ON public.chat_rooms FOR SELECT TO authenticated
USING (public.is_chat_room_member(id, auth.uid()) OR created_by = auth.uid());

CREATE POLICY "company members create rooms"
ON public.chat_rooms FOR INSERT TO authenticated
WITH CHECK (is_company_member() AND created_by = auth.uid());

CREATE POLICY "owner or admin update room"
ON public.chat_rooms FOR UPDATE TO authenticated
USING (created_by = auth.uid() OR is_admin());

CREATE POLICY "owner or admin delete room"
ON public.chat_rooms FOR DELETE TO authenticated
USING (created_by = auth.uid() OR is_admin());


-- chat_room_members policies
CREATE POLICY "members view room members"
ON public.chat_room_members FOR SELECT TO authenticated
USING (public.is_chat_room_member(room_id, auth.uid()));

CREATE POLICY "creator or admin adds members"
ON public.chat_room_members FOR INSERT TO authenticated
WITH CHECK (
  is_company_member() AND (
    user_id = auth.uid() -- joining yourself
    OR EXISTS (SELECT 1 FROM public.chat_rooms r WHERE r.id = room_id AND r.created_by = auth.uid())
    OR is_admin()
  )
);

CREATE POLICY "members update own membership"
ON public.chat_room_members FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.chat_rooms r WHERE r.id = room_id AND r.created_by = auth.uid()) OR is_admin());

CREATE POLICY "owner or admin remove members"
ON public.chat_room_members FOR DELETE TO authenticated
USING (
  user_id = auth.uid() -- leave
  OR EXISTS (SELECT 1 FROM public.chat_rooms r WHERE r.id = room_id AND r.created_by = auth.uid())
  OR is_admin()
);


CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_email TEXT,
  body TEXT,
  message_type TEXT NOT NULL DEFAULT 'text', -- text | image | file | voice | system
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{url, mime, name, size}]
  voice_note_url TEXT,
  voice_duration_seconds INTEGER,
  reply_to_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_msgs_room ON public.chat_messages(room_id, created_at DESC);
CREATE INDEX idx_chat_msgs_search ON public.chat_messages USING GIN (to_tsvector('simple', coalesce(body, '')));

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read messages"
ON public.chat_messages FOR SELECT TO authenticated
USING (public.is_chat_room_member(room_id, auth.uid()));

CREATE POLICY "members send messages"
ON public.chat_messages FOR INSERT TO authenticated
WITH CHECK (public.is_chat_room_member(room_id, auth.uid()) AND sender_id = auth.uid());

CREATE POLICY "sender edit own messages"
ON public.chat_messages FOR UPDATE TO authenticated
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

CREATE POLICY "sender or admin delete messages"
ON public.chat_messages FOR DELETE TO authenticated
USING (sender_id = auth.uid() OR is_admin());


CREATE TABLE public.chat_reactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view reactions"
ON public.chat_reactions FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.chat_messages m
  WHERE m.id = chat_reactions.message_id
  AND public.is_chat_room_member(m.room_id, auth.uid())
));

CREATE POLICY "members add own reactions"
ON public.chat_reactions FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.chat_messages m
    WHERE m.id = message_id AND public.is_chat_room_member(m.room_id, auth.uid())
  )
);

CREATE POLICY "members remove own reactions"
ON public.chat_reactions FOR DELETE TO authenticated
USING (user_id = auth.uid());


CREATE TABLE public.chat_presence (
  user_id UUID NOT NULL PRIMARY KEY,
  user_email TEXT,
  status TEXT NOT NULL DEFAULT 'offline', -- online | away | offline
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company members view presence"
ON public.chat_presence FOR SELECT TO authenticated
USING (is_company_member());

CREATE POLICY "users update own presence"
ON public.chat_presence FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "users upsert own presence"
ON public.chat_presence FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());


-- Trigger: update room last_message_at when a message is sent
CREATE OR REPLACE FUNCTION public.bump_chat_room_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_rooms
  SET last_message_at = NEW.created_at,
      last_message_preview = LEFT(coalesce(NEW.body, '[ملف]'), 100),
      updated_at = now()
  WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_chat_room
AFTER INSERT ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.bump_chat_room_last_message();


-- Trigger: update wa conversation last_message_at
CREATE OR REPLACE FUNCTION public.bump_wa_conversation_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = LEFT(coalesce(NEW.body, '[' || NEW.message_type || ']'), 100),
      unread_count = CASE WHEN NEW.direction = 'inbound' THEN unread_count + 1 ELSE unread_count END,
      updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_wa_conversation
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW EXECUTE FUNCTION public.bump_wa_conversation_last_message();


CREATE TRIGGER trg_chat_rooms_updated
BEFORE UPDATE ON public.chat_rooms
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_wa_conv_updated
BEFORE UPDATE ON public.whatsapp_conversations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_wa_templates_updated
BEFORE UPDATE ON public.whatsapp_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =============================================
-- REALTIME
-- =============================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_presence;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_tickets;

ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.chat_rooms REPLICA IDENTITY FULL;
ALTER TABLE public.chat_room_members REPLICA IDENTITY FULL;
ALTER TABLE public.chat_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.chat_presence REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.support_tickets REPLICA IDENTITY FULL;


-- =============================================
-- STORAGE BUCKETS
-- =============================================

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('chat-attachments', 'chat-attachments', false),
  ('chat-voice-notes', 'chat-voice-notes', false),
  ('invoices-pdf', 'invoices-pdf', false),
  ('whatsapp-media', 'whatsapp-media', false)
ON CONFLICT (id) DO NOTHING;

-- chat-attachments policies (path: {room_id}/{filename})
CREATE POLICY "chat attachments room members read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND public.is_chat_room_member((storage.foldername(name))[1]::uuid, auth.uid())
);

CREATE POLICY "chat attachments room members upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND public.is_chat_room_member((storage.foldername(name))[1]::uuid, auth.uid())
);

CREATE POLICY "chat attachments owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND owner = auth.uid()
);

-- chat-voice-notes policies (same pattern)
CREATE POLICY "voice notes room members read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-voice-notes'
  AND public.is_chat_room_member((storage.foldername(name))[1]::uuid, auth.uid())
);

CREATE POLICY "voice notes room members upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-voice-notes'
  AND public.is_chat_room_member((storage.foldername(name))[1]::uuid, auth.uid())
);

CREATE POLICY "voice notes owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-voice-notes'
  AND owner = auth.uid()
);

-- invoices-pdf policies — only company members; writes via service role only
CREATE POLICY "invoices pdf company read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'invoices-pdf'
  AND is_company_member()
);

-- whatsapp-media policies
CREATE POLICY "wa media company read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'whatsapp-media'
  AND is_company_member()
);
