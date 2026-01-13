-- RLS para onboarding_sessions (público, mas com validação de session_id)
ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_messages ENABLE ROW LEVEL SECURITY;

-- Policies para onboarding_sessions
-- Permite leitura/escrita apenas com session_id correto (sem auth)
CREATE POLICY "Anyone can create onboarding sessions"
  ON onboarding_sessions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can read their own session by session_id"
  ON onboarding_sessions FOR SELECT
  USING (true); -- Validação de session_id será feita na aplicação

CREATE POLICY "Anyone can update their own session by session_id"
  ON onboarding_sessions FOR UPDATE
  USING (true); -- Validação de session_id será feita na aplicação

-- Policies para onboarding_messages
CREATE POLICY "Anyone can create messages for their session"
  ON onboarding_messages FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can read messages from their session"
  ON onboarding_messages FOR SELECT
  USING (true); -- Validação de session_id será feita na aplicação

-- IMPORTANTE: Validação de session_id deve ser feita na aplicação/Edge Function
-- para garantir que apenas o dono da session acesse seus dados
