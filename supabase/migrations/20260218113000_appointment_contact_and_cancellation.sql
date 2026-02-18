-- Persistência de cancelamento e vínculo de appointment com contato para melhorar lookup.
ALTER TABLE appointment
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contact(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_appointment_contact_id ON appointment(contact_id);
CREATE INDEX IF NOT EXISTS idx_appointment_contact_status_start ON appointment(contact_id, status, start_at);
