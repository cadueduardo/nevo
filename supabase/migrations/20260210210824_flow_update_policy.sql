-- Permite que admins do tenant atualizem flows do próprio tenant.
-- Sem esta policy, PATCH no flow falha (RLS bloqueia UPDATE).
CREATE POLICY "Admins can update flows of their tenants"
  ON flow FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tu.tenant_id
      FROM tenant_user tu
      WHERE tu.user_id = auth.uid()
      AND tu.role IN ('owner', 'admin')
    )
  );
