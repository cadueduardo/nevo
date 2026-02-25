-- FASE 3 — Motor de orçamento: quote_service + campos em request
-- quote_service: serviços de orçamento por agente (MVP)
-- request: campos para orçamento completo e estimativa

-- Tabela quote_service (por agent_id)
CREATE TABLE quote_service (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pricing_type TEXT NOT NULL CHECK (pricing_type IN (
    'fixed', 'unit', 'linear', 'area', 'area_with_minimum', 'formula', 'custom_manual'
  )),
  variables_schema JSONB DEFAULT '[]',
  pricing_rules JSONB DEFAULT '{}',
  external_variable_keys TEXT[] DEFAULT '{}',
  keywords TEXT[] DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quote_service_agent_id ON quote_service(agent_id);
ALTER TABLE quote_service ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view quote_services of their tenants"
  ON quote_service FOR SELECT
  USING (
    agent_id IN (SELECT id FROM agent WHERE tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()))
  );

CREATE POLICY "Admins can manage quote_services of their tenants"
  ON quote_service FOR ALL
  USING (
    agent_id IN (
      SELECT a.id FROM agent a
      JOIN tenant_user tu ON tu.tenant_id = a.tenant_id
      WHERE tu.user_id = auth.uid() AND tu.role IN ('owner', 'admin')
    )
  );

COMMENT ON TABLE quote_service IS 'Serviços de orçamento por agente. variables_schema: variáveis para orçamento interno. external_variable_keys: subconjunto para estimativa rápida.';
COMMENT ON COLUMN quote_service.keywords IS 'Palavras-chave para detecção determinística de serviço (external).';

-- Campos adicionais em request (orçamento)
ALTER TABLE request
  ADD COLUMN IF NOT EXISTS blueprint_id UUID REFERENCES quote_service(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS total_value DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS calculation_result JSONB,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

COMMENT ON COLUMN request.blueprint_id IS 'FK para quote_service quando orçamento.';
COMMENT ON COLUMN request.total_value IS 'Valor total calculado (internal) ou média da faixa (external).';
COMMENT ON COLUMN request.calculation_result IS 'Detalhamento do cálculo (breakdown, fórmulas).';
COMMENT ON COLUMN request.is_estimated IS 'true = estimativa em faixa (external); false = orçamento completo (internal).';
