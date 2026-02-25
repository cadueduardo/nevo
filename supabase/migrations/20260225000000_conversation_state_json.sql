-- Adiciona state_json em conversation para o simulador (estado do agendamento, channel, etc.)
-- Usado por conversations-turn para persistir e rehidratar SimulatorState entre turnos.

ALTER TABLE conversation
  ADD COLUMN IF NOT EXISTS state_json JSONB DEFAULT '{}';

COMMENT ON COLUMN conversation.state_json IS 'Estado do simulador: { state: SimulatorState, channel: "web_chat"|"whatsapp" }. Persistido entre turnos.';
