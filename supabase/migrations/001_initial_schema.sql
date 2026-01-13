-- Tenant (empresa)
CREATE TABLE tenant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usuários do tenant
CREATE TABLE tenant_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'agent', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

-- Canais (WhatsApp ou Chat Próprio)
CREATE TABLE channel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('whatsapp', 'web_chat')),
  provider TEXT,
  provider_config JSONB,
  chat_slug TEXT UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (
    (type = 'whatsapp' AND provider IS NOT NULL AND provider_config IS NOT NULL) OR
    (type = 'web_chat' AND chat_slug IS NOT NULL)
  )
);

-- Contatos
CREATE TABLE contact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, channel_id, external_id)
);

-- Fluxos (precisa existir antes de conversation)
CREATE TABLE flow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenant(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  version INT DEFAULT 1,
  definition JSONB NOT NULL,
  layout JSONB,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversas
CREATE TABLE conversation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('open', 'awaiting_human', 'closed')) DEFAULT 'open',
  current_flow_id UUID REFERENCES flow(id),
  current_step_key TEXT,
  context JSONB DEFAULT '{}',
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mensagens
CREATE TABLE message (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  provider_message_id TEXT,
  content_type TEXT NOT NULL CHECK (content_type IN ('text', 'image', 'audio', 'file', 'flow')),
  content_text TEXT,
  content_raw JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Variáveis/Slots
CREATE TABLE variable (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'number', 'enum', 'boolean', 'date', 'location')),
  required BOOLEAN DEFAULT false,
  options JSONB,
  validation JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, key)
);

-- Blueprints (templates)
CREATE TABLE blueprint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  default_flow_definition JSONB NOT NULL,
  default_variables JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Requests (pedidos/leads)
CREATE TABLE request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'completed')) DEFAULT 'pending',
  slots JSONB NOT NULL,
  estimated_price_min DECIMAL(10,2),
  estimated_price_max DECIMAL(10,2),
  notes TEXT,
  approved_by UUID REFERENCES tenant_user(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configurações do tenant
CREATE TABLE tenant_setting (
  tenant_id UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  tone TEXT CHECK (tone IN ('friendly', 'professional', 'formal')) DEFAULT 'professional',
  language TEXT DEFAULT 'pt-BR',
  handoff_mode TEXT CHECK (handoff_mode IN ('always', 'conditional', 'never')) DEFAULT 'conditional',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configuração de IA do tenant (custo do cliente)
CREATE TABLE tenant_ai_config (
  tenant_id UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'claude', 'gemini')),
  api_key_encrypted TEXT NOT NULL,
  model TEXT NOT NULL,
  max_tokens INT DEFAULT 1000,
  temperature DECIMAL(3,2) DEFAULT 0.7,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
