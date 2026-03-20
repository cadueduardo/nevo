ALTER TABLE agent_channel_whatsapp
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

COMMENT ON COLUMN agent_channel_whatsapp.webhook_secret IS
  'Segredo compartilhado usado para validar webhooks recebidos da Evolution API.';
