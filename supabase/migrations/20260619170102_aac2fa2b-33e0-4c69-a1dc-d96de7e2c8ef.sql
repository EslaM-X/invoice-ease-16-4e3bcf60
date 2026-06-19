DROP POLICY IF EXISTS "scan_sessions realtime owner only" ON realtime.messages;

CREATE POLICY "postgres_changes only, no broadcast/presence"
  ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.messages.extension = 'postgres_changes');