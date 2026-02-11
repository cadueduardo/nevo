-- Fase 0: Modelo de dados "agente" (1 tenant = N agentes; flow/config por agente)
-- Ordem: agent + RLS → flow.agent_id + agent default → agent_setting → agent_channel_whatsapp → variable.flow_id → conversation/channel/appointment.agent_id

-- ---------------------------------------------------------------------------
-- 0.1 Tabela agent
-- ---------------------------------------------------------------------------
CREATE TABLE agent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  business_type TEXT,
  channel_primary TEXT NOT NULL CHECK (channel_primary IN ('whatsapp', 'web')) DEFAULT 'whatsapp',
  status TEXT NOT NULL CHECK (status IN ('draft', 'active')) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_tenant_id ON agent(tenant_id);

ALTER TABLE agent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view agents of their tenants"
  ON agent FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

CREATE POLICY "Admins can insert agents in their tenants"
  ON agent FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tu.tenant_id FROM tenant_user tu
      WHERE tu.user_id = auth.uid() AND tu.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can update agents of their tenants"
  ON agent FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tu.tenant_id FROM tenant_user tu
      WHERE tu.user_id = auth.uid() AND tu.role IN ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 0.2 flow.agent_id + criar 1 agent default por tenant e associar flows
-- ---------------------------------------------------------------------------
ALTER TABLE flow
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agent(id) ON DELETE CASCADE;

-- Criar 1 agent por tenant (nome = nome do tenant, status = active para ter fluxo)
INSERT INTO agent (tenant_id, name, business_type, channel_primary, status)
SELECT t.id, t.name, NULL, 'whatsapp', 'active'
FROM tenant t
WHERE NOT EXISTS (SELECT 1 FROM agent a WHERE a.tenant_id = t.id);

-- Associar cada flow ao agent do seu tenant (um agent por tenant acabamos de criar)
UPDATE flow f
SET agent_id = (
  SELECT a.id FROM agent a
  WHERE a.tenant_id = f.tenant_id
  ORDER BY a.created_at
  LIMIT 1
)
WHERE f.tenant_id IS NOT NULL;

-- Regra: flow com tenant_id preenchido deve ter agent_id (flows de tenant sempre vinculados a um agent)
ALTER TABLE flow
  ADD CONSTRAINT flow_tenant_requires_agent CHECK (
    (tenant_id IS NULL) OR (agent_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_flow_agent_id ON flow(agent_id);

-- ---------------------------------------------------------------------------
-- 0.3 agent_setting (copiar operacional de tenant_setting para agent default)
-- ---------------------------------------------------------------------------
CREATE TABLE agent_setting (
  agent_id UUID PRIMARY KEY REFERENCES agent(id) ON DELETE CASCADE,
  tone TEXT CHECK (tone IN ('friendly', 'professional', 'formal')) DEFAULT 'professional',
  language TEXT DEFAULT 'pt-BR',
  handoff_mode TEXT CHECK (handoff_mode IN ('always', 'conditional', 'never')) DEFAULT 'conditional',
  business_config JSONB DEFAULT '{}',
  when_client_asks_price_no_value TEXT CHECK (when_client_asks_price_no_value IN ('handoff', 'offer_handoff_or_booking')) DEFAULT 'offer_handoff_or_booking',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN agent_setting.business_config IS 'Config do negócio por agente: services, schedule, staff, etc.';

INSERT INTO agent_setting (agent_id, tone, language, handoff_mode, business_config, when_client_asks_price_no_value)
SELECT a.id, COALESCE(ts.tone, 'professional'), COALESCE(ts.language, 'pt-BR'), COALESCE(ts.handoff_mode, 'conditional'),
       COALESCE(ts.business_config, '{}'), COALESCE(ts.when_client_asks_price_no_value, 'offer_handoff_or_booking')
FROM agent a
JOIN tenant_setting ts ON ts.tenant_id = a.tenant_id
ON CONFLICT (agent_id) DO NOTHING;

ALTER TABLE agent_setting ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view agent_settings of their tenants"
  ON agent_setting FOR SELECT
  USING (
    agent_id IN (SELECT id FROM agent WHERE tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()))
  );

CREATE POLICY "Admins can update agent_settings of their tenants"
  ON agent_setting FOR ALL
  USING (
    agent_id IN (
      SELECT a.id FROM agent a
      JOIN tenant_user tu ON tu.tenant_id = a.tenant_id
      WHERE tu.user_id = auth.uid() AND tu.role IN ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 0.4 agent_channel_whatsapp
-- ---------------------------------------------------------------------------
CREATE TABLE agent_channel_whatsapp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('twilio', 'custom')),
  status TEXT NOT NULL CHECK (status IN ('disconnected', 'connecting', 'connected', 'error')) DEFAULT 'disconnected',
  phone_number TEXT,
  twilio_account_sid_encrypted TEXT,
  twilio_auth_token_encrypted TEXT,
  messaging_service_sid TEXT,
  webhook_url TEXT,
  last_healthcheck_at TIMESTAMPTZ,
  last_error TEXT,
  custom_note_accepted_risk BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_channel_whatsapp_agent_id ON agent_channel_whatsapp(agent_id);

ALTER TABLE agent_channel_whatsapp ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view agent_channel_whatsapp of their tenants"
  ON agent_channel_whatsapp FOR SELECT
  USING (
    agent_id IN (SELECT id FROM agent WHERE tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()))
  );

CREATE POLICY "Admins can manage agent_channel_whatsapp of their tenants"
  ON agent_channel_whatsapp FOR ALL
  USING (
    agent_id IN (
      SELECT a.id FROM agent a
      JOIN tenant_user tu ON tu.tenant_id = a.tenant_id
      WHERE tu.user_id = auth.uid() AND tu.role IN ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 0.5 variable.flow_id (variáveis por fluxo)
-- ---------------------------------------------------------------------------
ALTER TABLE variable
  ADD COLUMN IF NOT EXISTS flow_id UUID REFERENCES flow(id) ON DELETE CASCADE;

-- Associar variables existentes ao flow do agent default do tenant
UPDATE variable v
SET flow_id = (
  SELECT f.id FROM flow f
  JOIN agent a ON a.id = f.agent_id
  WHERE a.tenant_id = v.tenant_id
  ORDER BY f.is_active DESC NULLS LAST, f.created_at
  LIMIT 1
)
WHERE v.flow_id IS NULL AND v.tenant_id IS NOT NULL;

-- Remover constraint antiga (tenant_id, key); unicidade passa a ser por (flow_id, key)
ALTER TABLE variable DROP CONSTRAINT IF EXISTS variable_tenant_id_key_key;
ALTER TABLE variable DROP CONSTRAINT IF EXISTS variable_tenant_id_key_unique;

CREATE UNIQUE INDEX idx_variable_flow_id_key ON variable(flow_id, key) WHERE flow_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 0.5 (cont.) conversation, channel, appointment: agent_id
-- ---------------------------------------------------------------------------
ALTER TABLE conversation
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agent(id) ON DELETE CASCADE;

ALTER TABLE channel
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agent(id) ON DELETE CASCADE;

ALTER TABLE appointment
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agent(id) ON DELETE CASCADE;

-- Backfill: um agent por tenant (o default que criamos)
UPDATE conversation c
SET agent_id = (SELECT a.id FROM agent a WHERE a.tenant_id = c.tenant_id ORDER BY a.created_at LIMIT 1)
WHERE c.agent_id IS NULL;

UPDATE channel ch
SET agent_id = (SELECT a.id FROM agent a WHERE a.tenant_id = ch.tenant_id ORDER BY a.created_at LIMIT 1)
WHERE ch.agent_id IS NULL;

UPDATE appointment ap
SET agent_id = (SELECT a.id FROM agent a WHERE a.tenant_id = ap.tenant_id ORDER BY a.created_at LIMIT 1)
WHERE ap.agent_id IS NULL;

-- Opcional: tornar NOT NULL após backfill (pode falhar se houver conversation/channel sem tenant)
ALTER TABLE conversation ALTER COLUMN agent_id SET NOT NULL;
ALTER TABLE channel ALTER COLUMN agent_id SET NOT NULL;
ALTER TABLE appointment ALTER COLUMN agent_id SET NOT NULL;

CREATE INDEX idx_conversation_agent_id ON conversation(agent_id);
CREATE INDEX idx_channel_agent_id ON channel(agent_id);
CREATE INDEX idx_appointment_agent_id ON appointment(agent_id);
