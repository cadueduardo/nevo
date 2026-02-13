-- Adiciona suporte a Evolution API como provider WhatsApp (conexão via Baileys, não oficial)
-- Permite: twilio | custom | evolution

ALTER TABLE agent_channel_whatsapp
  DROP CONSTRAINT IF EXISTS agent_channel_whatsapp_provider_check;

ALTER TABLE agent_channel_whatsapp
  ADD CONSTRAINT agent_channel_whatsapp_provider_check
  CHECK (provider IN ('twilio', 'custom', 'evolution'));

-- Colunas para Evolution API (provider = 'evolution')
ALTER TABLE agent_channel_whatsapp
  ADD COLUMN IF NOT EXISTS evolution_base_url TEXT,
  ADD COLUMN IF NOT EXISTS evolution_instance TEXT,
  ADD COLUMN IF NOT EXISTS evolution_api_key_encrypted TEXT;

COMMENT ON COLUMN agent_channel_whatsapp.evolution_base_url IS 'URL base da Evolution API (ex: https://evolution.exemplo.com)';
COMMENT ON COLUMN agent_channel_whatsapp.evolution_instance IS 'Nome da instância Evolution conectada ao WhatsApp';
COMMENT ON COLUMN agent_channel_whatsapp.evolution_api_key_encrypted IS 'API key para autenticação na Evolution API (armazenada criptografada)';
