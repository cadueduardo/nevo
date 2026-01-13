-- Habilitar RLS em TODAS as tabelas
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE message ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow ENABLE ROW LEVEL SECURITY;
ALTER TABLE variable ENABLE ROW LEVEL SECURITY;
ALTER TABLE request ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_ai_config ENABLE ROW LEVEL SECURITY;

-- Função helper para obter tenant_id do usuário atual
CREATE OR REPLACE FUNCTION get_user_tenant_ids()
RETURNS TABLE(tenant_id UUID) AS $$
  SELECT tu.tenant_id
  FROM tenant_user tu
  WHERE tu.user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER;

-- Policies para tenant_user
CREATE POLICY "Users can view their own tenant_user records"
  ON tenant_user FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can view tenant_user of their tenants"
  ON tenant_user FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

-- Policies para tenant
CREATE POLICY "Users can view their tenants"
  ON tenant FOR SELECT
  USING (id IN (SELECT tenant_id FROM get_user_tenant_ids()));

-- Policies para channel
CREATE POLICY "Users can view channels of their tenants"
  ON channel FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

-- Policies para contact
CREATE POLICY "Users can view contacts of their tenants"
  ON contact FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

-- Policies para conversation
CREATE POLICY "Users can view conversations of their tenants"
  ON conversation FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

-- Policies para message
CREATE POLICY "Users can view messages of their tenants"
  ON message FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

-- Policies para flow
CREATE POLICY "Users can view flows of their tenants or global templates"
  ON flow FOR SELECT
  USING (
    tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids())
    OR tenant_id IS NULL
  );

-- Policies para variable
CREATE POLICY "Users can view variables of their tenants"
  ON variable FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

-- Policies para request
CREATE POLICY "Users can view requests of their tenants"
  ON request FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

CREATE POLICY "Admins can update requests"
  ON request FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tu.tenant_id
      FROM tenant_user tu
      WHERE tu.user_id = auth.uid()
      AND tu.role IN ('owner', 'admin')
    )
  );

-- Policies para tenant_setting
CREATE POLICY "Users can view settings of their tenants"
  ON tenant_setting FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

CREATE POLICY "Admins can update settings of their tenants"
  ON tenant_setting FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tu.tenant_id
      FROM tenant_user tu
      WHERE tu.user_id = auth.uid()
      AND tu.role IN ('owner', 'admin')
    )
  );

-- Policies para tenant_ai_config
CREATE POLICY "Users can view AI config of their tenants"
  ON tenant_ai_config FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

CREATE POLICY "Admins can manage AI config of their tenants"
  ON tenant_ai_config FOR ALL
  USING (
    tenant_id IN (
      SELECT tu.tenant_id
      FROM tenant_user tu
      WHERE tu.user_id = auth.uid()
      AND tu.role IN ('owner', 'admin')
    )
  );
