
CREATE TABLE public.x_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'محادثة جديدة',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_x_conversations_user ON public.x_conversations(user_id, last_message_at DESC);

CREATE TABLE public.x_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.x_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL DEFAULT '',
  tool_calls JSONB,
  tool_call_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_x_messages_conv ON public.x_messages(conversation_id, created_at);

CREATE TABLE public.x_user_profile (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  summary TEXT,
  tone TEXT,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  frequent_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  message_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.x_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.x_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.x_user_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own conversations" ON public.x_conversations FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own messages" ON public.x_messages FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "own x profile" ON public.x_user_profile FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER x_conv_updated BEFORE UPDATE ON public.x_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
