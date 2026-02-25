-- Tabela appointment (agendamentos) e RLS.
-- Em bancos já existentes este arquivo pode ter sido aplicado como stub; aqui está o conteúdo
-- completo para novos ambientes (ex.: QA) que partem do zero.

CREATE TABLE IF NOT EXISTS appointment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  attendee_name TEXT,
  staff_name TEXT,
  service_names TEXT[] DEFAULT '{}',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'confirmed', 'cancelled', 'rescheduled', 'completed')) DEFAULT 'scheduled',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_tenant_id ON appointment(tenant_id);
CREATE INDEX IF NOT EXISTS idx_appointment_start_at ON appointment(start_at);

ALTER TABLE appointment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view appointments of their tenants"
  ON appointment FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM get_user_tenant_ids()));

CREATE POLICY "Admins can insert appointments in their tenants"
  ON appointment FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tu.tenant_id FROM tenant_user tu
      WHERE tu.user_id = auth.uid() AND tu.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can update appointments of their tenants"
  ON appointment FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tu.tenant_id FROM tenant_user tu
      WHERE tu.user_id = auth.uid() AND tu.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Admins can delete appointments of their tenants"
  ON appointment FOR DELETE
  USING (
    tenant_id IN (
      SELECT tu.tenant_id FROM tenant_user tu
      WHERE tu.user_id = auth.uid() AND tu.role IN ('owner', 'admin')
    )
  );
