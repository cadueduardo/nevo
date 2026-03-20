CREATE TABLE IF NOT EXISTS whatsapp_webhook_receipt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('evolution')),
  external_message_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_preview TEXT,
  UNIQUE(agent_id, provider, external_message_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_receipt_tenant_id
  ON whatsapp_webhook_receipt(tenant_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_receipt_agent_received_at
  ON whatsapp_webhook_receipt(agent_id, received_at DESC);

ALTER TABLE whatsapp_webhook_receipt ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE whatsapp_webhook_receipt IS
  'Recibos de eventos inbound do webhook WhatsApp para deduplicacao/idempotencia operacional.';
