-- FASE 6 — Log de auditoria e rate limit para ações internas (owner/admin)

CREATE TABLE internal_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES tenant_user(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_internal_action_log_tenant_created ON internal_action_log(tenant_id, created_at DESC);
CREATE INDEX idx_internal_action_log_actor_created ON internal_action_log(actor_id, created_at DESC) WHERE actor_id IS NOT NULL;

ALTER TABLE internal_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view internal_action_log of their tenants"
  ON internal_action_log FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

-- INSERT: apenas via service role (Edge Function); RLS é bypassed para service_role.

COMMENT ON TABLE internal_action_log IS 'Log de auditoria de ações internas (agenda, orçamento). Usado para rate limit e auditoria.';
