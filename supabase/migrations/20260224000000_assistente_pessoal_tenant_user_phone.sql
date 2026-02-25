-- FASE 1 — Base de segurança e contexto (roadmap assistente pessoal + orçamento)
-- Aditivo: apenas adiciona colunas em tenant_user. Não altera colunas existentes.

ALTER TABLE tenant_user
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_authorized BOOLEAN DEFAULT true;

-- Índice para lookup por telefone (por tenant)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_user_phone_number
  ON tenant_user (tenant_id, phone_number)
  WHERE phone_number IS NOT NULL;

COMMENT ON COLUMN tenant_user.phone_number IS 'Telefone normalizado (só dígitos com DDI). Único por tenant. Usado para identificar owner/admin no WhatsApp (modo internal).';
COMMENT ON COLUMN tenant_user.whatsapp_authorized IS 'Se o usuário está autorizado a usar o assistente via WhatsApp (modo internal).';
