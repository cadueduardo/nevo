-- Sessões de onboarding anônimas (antes do cadastro)
CREATE TABLE onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL, -- ID gerado no frontend (localStorage/cookie)
  collected_data JSONB DEFAULT '{}', -- Dados coletados durante o onboarding
  current_step_key TEXT DEFAULT 'welcome',
  domain_suggested TEXT,
  domain_confirmed TEXT,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mensagens do chat de onboarding (histórico)
CREATE TABLE onboarding_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES onboarding_sessions(session_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}', -- Extracted data, step info, etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_onboarding_sessions_session_id ON onboarding_sessions(session_id);
CREATE INDEX idx_onboarding_sessions_expires_at ON onboarding_sessions(expires_at);
CREATE INDEX idx_onboarding_messages_session_id ON onboarding_messages(session_id);
CREATE INDEX idx_onboarding_messages_created_at ON onboarding_messages(created_at);

-- Função para limpar sessões expiradas (pode ser chamada por cron)
CREATE OR REPLACE FUNCTION cleanup_expired_onboarding_sessions()
RETURNS void AS $$
  DELETE FROM onboarding_sessions
  WHERE expires_at < NOW();
$$ LANGUAGE sql;
