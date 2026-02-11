-- business_config: serviços e demais dados do negócio (preço, descrição) para uso no atendimento
-- when_client_asks_price_no_value: quando o cliente pergunta preço e não há valor cadastrado
ALTER TABLE tenant_setting
  ADD COLUMN IF NOT EXISTS business_config JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS when_client_asks_price_no_value TEXT
    CHECK (when_client_asks_price_no_value IN ('handoff', 'offer_handoff_or_booking'))
    DEFAULT 'offer_handoff_or_booking';

COMMENT ON COLUMN tenant_setting.business_config IS 'Config do negócio: services (name, duration_minutes, base_price, description), etc.';
COMMENT ON COLUMN tenant_setting.when_client_asks_price_no_value IS 'handoff = passar para humano; offer_handoff_or_booking = oferecer avisar equipe ou agendar';
