CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('evolution')),
  target_phone TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_status_created_at
  ON whatsapp_outbox(status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbox_agent_status
  ON whatsapp_outbox(agent_id, status, created_at ASC);

ALTER TABLE whatsapp_outbox ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE whatsapp_outbox IS
  'Fila persistente de mensagens outbound do WhatsApp para envio assíncrono e retry controlado.';
