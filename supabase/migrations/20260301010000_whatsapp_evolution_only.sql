-- Evolution-only: remove legado Twilio/custom do canal WhatsApp.

-- 1) Limpar registros legados para permitir restrição estrita do provider.
DELETE FROM agent_channel_whatsapp
WHERE provider <> 'evolution';

-- 2) Provider passa a aceitar somente evolution.
ALTER TABLE agent_channel_whatsapp
  DROP CONSTRAINT IF EXISTS agent_channel_whatsapp_provider_check;

ALTER TABLE agent_channel_whatsapp
  ADD CONSTRAINT agent_channel_whatsapp_provider_check
  CHECK (provider IN ('evolution'));

-- 3) Remover colunas específicas de Twilio.
ALTER TABLE agent_channel_whatsapp
  DROP COLUMN IF EXISTS twilio_account_sid_encrypted,
  DROP COLUMN IF EXISTS twilio_auth_token_encrypted,
  DROP COLUMN IF EXISTS messaging_service_sid;
