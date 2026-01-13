# MVP Nevo - Plano Completo

## 1. Stack Tecnológico

### Frontend

- **Framework**: Next.js 14+ (App Router)
- **Linguagem**: TypeScript
- **Styling**: Tailwind CSS (sem CSS hardcoded)
- **UI Components**: shadcn/ui (baseado em Tailwind)
- **State Management**: Zustand ou React Context
- **Forms**: React Hook Form + Zod
- **Icons**: Lucide React
- **Design**: Mobile First (obrigatório para todas as telas)

### Backend

- **Database**: Supabase PostgreSQL
- **Auth**: Supabase Auth
- **Edge Functions**: Supabase Edge Functions (Deno)
- **Storage**: Supabase Storage (se necessário)

### Integrações

- **WhatsApp**: Twilio API (sandbox inicial) - Opcional
- **Chat Próprio**: Chat dedicado (cliente.nevo.app) - Alternativa ao WhatsApp
- **IA**: Configurável pelo cliente (OpenAI, Anthropic Claude, Google Gemini)
- **Editor Visual**: Editor de fluxos estilo N8N (drag-and-drop, nós conectáveis) - NO MVP

### Ferramentas

- **Package Manager**: pnpm ou npm
- **Linting**: ESLint
- **Formatting**: Prettier
- **Testing**: Vitest + Testing Library

## 2. Estrutura de Pastas

```
nevo/
├── .env.local                    # Variáveis de ambiente
├── .env.example                  # Exemplo de variáveis
├── next.config.js
├── tailwind.config.js            # Config Tailwind com dark mode
├── tsconfig.json
├── package.json
│
├── public/                       # Assets estáticos
│   ├── images/
│   └── icons/
│
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── layout.tsx            # Root layout com theme provider
│   │   ├── page.tsx              # Home/Login
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   └── signup/
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx        # Dashboard layout
│   │   │   ├── onboarding/       # Onboarding estilo ChatGPT
│   │   │   ├── conversations/     # Lista de conversas
│   │   │   ├── requests/         # Requests pendentes
│   │   │   ├── flows/            # Gestão de fluxos
│   │   │   ├── settings/         # Configurações tenant
│   │   │   │   ├── ai/           # Configuração de IA
│   │   │   │   └── channels/     # Configuração de canais
│   │   │   └── users/             # Gestão de usuários
│   │   ├── [slug]/               # Chat público do cliente
│   │   │   └── chat/
│   │   │       └── page.tsx
│   │   └── api/                  # API routes (se necessário)
│   │
│   ├── components/               # Componentes React
│   │   ├── ui/                   # Componentes base (shadcn/ui)
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── card.tsx
│   │   │   ├── table.tsx
│   │   │   ├── dialog.tsx
│   │   │   └── ...
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── ThemeToggle.tsx   # Dark mode toggle
│   │   │   └── TenantSelector.tsx
│   │   ├── conversations/
│   │   │   ├── ConversationList.tsx
│   │   │   ├── ConversationView.tsx
│   │   │   └── MessageBubble.tsx
│   │   ├── onboarding/
│   │   │   ├── OnboardingChat.tsx  # Interface estilo ChatGPT
│   │   │   ├── OnboardingMessage.tsx
│   │   │   └── OnboardingInput.tsx
│   │   ├── chat/
│   │   │   ├── PublicChat.tsx      # Chat público do cliente
│   │   │   ├── ChatMessage.tsx
│   │   │   └── ChatInput.tsx
│   │   ├── requests/
│   │   │   ├── RequestList.tsx
│   │   │   ├── RequestCard.tsx
│   │   │   └── RequestApproval.tsx
│   │   └── flows/
│   │       ├── FlowEditor.tsx        # Editor visual estilo N8N
│   │       ├── FlowCanvas.tsx         # Canvas com drag-and-drop
│   │       ├── FlowNode.tsx           # Componente de nó
│   │       ├── FlowConnection.tsx      # Conexões entre nós
│   │       ├── NodeEditor.tsx         # Editor de propriedades do nó
│   │       ├── FlowSimulator.tsx      # Simulador de fluxo
│   │       └── FlowVisualizer.tsx     # Visualização do fluxo
│   │
│   ├── lib/                      # Bibliotecas e utilitários
│   │   ├── supabase/
│   │   │   ├── client.ts         # Client para frontend
│   │   │   ├── server.ts        # Server client (RSC)
│   │   │   └── middleware.ts     # Middleware de auth
│   │   ├── whatsapp/
│   │   │   ├── providers/
│   │   │   │   ├── twilio-provider.ts
│   │   │   │   └── provider.interface.ts
│   │   │   └── types.ts
│   │   ├── chat/
│   │   │   ├── channel-adapter.ts
│   │   │   ├── websocket.ts
│   │   │   └── types.ts
│   │   ├── ai/
│   │   │   ├── client.ts         # Cliente unificado para múltiplas IAs
│   │   │   ├── providers/
│   │   │   │   ├── openai.ts
│   │   │   │   ├── claude.ts
│   │   │   │   └── gemini.ts
│   │   │   └── prompts.ts        # Prompts seguros
│   │   ├── utils/
│   │   │   ├── cn.ts             # className utility
│   │   │   └── format.ts
│   │   └── constants/
│   │       └── config.ts
│   │
│   ├── hooks/                    # React Hooks customizados
│   │   ├── useTheme.ts
│   │   ├── useTenant.ts
│   │   └── useConversation.ts
│   │
│   ├── store/                    # Estado global (Zustand)
│   │   ├── themeStore.ts
│   │   └── tenantStore.ts
│   │
│   ├── types/                    # TypeScript types
│   │   ├── database.ts           # Tipos do Supabase
│   │   ├── whatsapp.ts
│   │   ├── flow.ts
│   │   └── ai.ts
│   │
│   └── styles/
│       └── globals.css            # Apenas imports do Tailwind
│
├── supabase/
│   ├── migrations/               # Migrations SQL
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_rls_policies.sql
│   │   └── ...
│   ├── functions/                # Edge Functions
│   │   ├── whatsapp-webhook/
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   ├── whatsapp-send/
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   ├── flow-orchestrator/
│   │   │   ├── index.ts
│   │   │   └── engine.ts
│   │   └── ai-extractor/
│   │       ├── index.ts
│   │       └── prompts.ts
│   └── seed.sql                   # Dados iniciais (blueprints)
│
├── docs/                         # Documentação do projeto
│   ├── mvp_nevo_plano_completo.md
│   ├── onboarding.md             # Especificação completa do onboarding chat-first
│   ├── arquitetura.md
│   ├── api.md
│   ├── design-system.md
│   └── ...
│
└── tests/                        # Testes
    ├── unit/
    │   ├── flow-engine.test.ts
    │   └── validators.test.ts
    └── integration/
        └── webhook.test.ts
```

## 3. Design System com Tailwind CSS

### 3.0 Regra Mobile First (OBRIGATÓRIO)

**TODAS as telas e formulários DEVEM ser desenvolvidos Mobile First:**

1. **Desenvolvimento**:

   - Começar sempre pelo mobile (classes sem prefixo)
   - Adicionar breakpoints apenas para desktop (`sm:`, `md:`, `lg:`)
   - Testar em mobile antes de desktop

2. **Breakpoints Tailwind**:

   - Base: Mobile (< 640px) - sem prefixo
   - `sm:`: ≥ 640px (tablet pequeno)
   - `md:`: ≥ 768px (tablet)
   - `lg:`: ≥ 1024px (desktop)
   - `xl:`: ≥ 1280px (desktop grande)

3. **Formulários**:

   - Inputs em tela cheia no mobile
   - Botões com tamanho mínimo de 44x44px (touch target)
   - Espaçamento adequado entre elementos
   - Labels acima dos inputs no mobile

4. **Navegação**:

   - Menu hamburger no mobile
   - Sidebar colapsável
   - Bottom navigation para ações principais (se aplicável)

5. **Testes Obrigatórios**:

   - Testar em dispositivos móveis reais
   - Testar em diferentes tamanhos de tela
   - Verificar touch targets
   - Verificar scroll e navegação

### 3.1 Configuração Tailwind

```javascript
// tailwind.config.js
module.exports = {
  darkMode: 'class', // Usar class strategy para dark mode
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Cores do tema (sem hardcode, tudo via Tailwind)
        primary: {
          50: '...',
          100: '...',
          // ... até 950
        },
        // Cores para dark mode automáticas
      },
      screens: {
        // Mobile first: base é mobile, breakpoints para desktop
        // sm: '640px',   // Tablet pequeno
        // md: '768px',   // Tablet
        // lg: '1024px',  // Desktop
        // xl: '1280px',  // Desktop grande
      },
      spacing: {
        // Garantir touch targets mínimos
        'touch': '44px', // Tamanho mínimo para botões
      },
    },
  },
  plugins: [],
}
```

### 3.2 Theme Provider

```typescript
// src/components/providers/ThemeProvider.tsx
'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const ThemeContext = createContext<{
  theme: Theme
  toggleTheme: () => void
}>({
  theme: 'light',
  toggleTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const savedTheme = localStorage.getItem('theme') as Theme | null
    if (savedTheme) {
      setTheme(savedTheme)
      document.documentElement.classList.toggle('dark', savedTheme === 'dark')
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const initialTheme = prefersDark ? 'dark' : 'light'
      setTheme(initialTheme)
      document.documentElement.classList.toggle('dark', initialTheme === 'dark')
    }
  }, [])

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    document.documentElement.classList.toggle('dark', newTheme === 'dark')
  }

  if (!mounted) return null

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
```

### 3.3 Componente Theme Toggle

```typescript
// src/components/layout/ThemeToggle.tsx
'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className="h-9 w-9"
      aria-label="Toggle theme"
    >
      {theme === 'light' ? (
        <Moon className="h-5 w-5" />
      ) : (
        <Sun className="h-5 w-5" />
      )}
    </Button>
  )
}
```

### 3.4 Regras de Estilização

**PROIBIÇÕES ABSOLUTAS:**

- ❌ Nenhum CSS hardcoded em arquivos `.css` ou `<style>`
- ❌ Nenhum `style={{}}` inline (exceto valores dinâmicos como `width: ${value}px`)
- ❌ Nenhum uso de `!important` (usar variantes do Tailwind)
- ✅ Tudo via classes Tailwind
- ✅ Cores via theme do Tailwind
- ✅ Dark mode via classes `dark:`

**MOBILE FIRST (OBRIGATÓRIO):**

- ✅ TODAS as telas devem ser desenvolvidas mobile first
- ✅ Começar com classes mobile (sem prefixo)
- ✅ Usar breakpoints `sm:`, `md:`, `lg:` apenas para desktop
- ✅ Testar em mobile antes de desktop
- ✅ Formulários devem ser otimizados para mobile
- ✅ Navegação deve funcionar perfeitamente em mobile

**Exemplo Correto (Mobile First):**

```tsx
// Mobile first: base é mobile, depois adiciona desktop
<div className="
  flex flex-col gap-2 p-4
  sm:flex-row sm:gap-4 sm:p-6
  lg:gap-6 lg:p-8
">
```

**Exemplo INCORRETO:**

```tsx
// Desktop first: base é desktop, depois tenta adaptar mobile
<div className="
  flex-row gap-6 p-8
  mobile:flex-col mobile:gap-2 mobile:p-4
">
```

**Exemplo Correto (Sem CSS hardcoded):**

```tsx
<div className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 rounded-lg">
```

**Exemplo INCORRETO:**

```tsx
<div style={{ backgroundColor: '#fff', padding: '16px' }}>
```

## 4. Schema Supabase

### 4.1 Tabelas Principais

```sql
-- 001_initial_schema.sql

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
  provider TEXT, -- 'twilio', 'whapi', etc. (NULL para web_chat)
  provider_config JSONB, -- Credenciais criptografadas (NULL para web_chat)
  chat_slug TEXT UNIQUE, -- Slug para chat próprio (ex: cliente.nevo.app/chat-slug)
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
  external_id TEXT NOT NULL, -- wa_id do WhatsApp
  phone TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, channel_id, external_id)
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
  context JSONB DEFAULT '{}', -- Slots, flags, progresso
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
  content_raw JSONB, -- Payload completo do provedor
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fluxos
CREATE TABLE flow (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenant(id) ON DELETE CASCADE, -- NULL = template global
  name TEXT NOT NULL,
  domain TEXT, -- 'personal_chef', 'advocacy', etc.
  version INT DEFAULT 1,
  definition JSONB NOT NULL, -- State machine definition (nós, conexões, condições)
  layout JSONB, -- Posições x/y e estilo dos nós (apenas UI, separado do definition)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Variáveis/Slots
CREATE TABLE variable (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key TEXT NOT NULL, -- snake_case
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'number', 'enum', 'boolean', 'date', 'location')),
  required BOOLEAN DEFAULT false,
  options JSONB, -- Para enum
  validation JSONB, -- min/max/regex
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
  slots JSONB NOT NULL, -- Dados coletados
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
  api_key_encrypted TEXT NOT NULL, -- Chave criptografada
  model TEXT NOT NULL, -- Ex: 'gpt-4', 'claude-3-opus', 'gemini-pro'
  max_tokens INT DEFAULT 1000,
  temperature DECIMAL(3,2) DEFAULT 0.7,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.2 RLS Policies (CRÍTICO)

```sql
-- 002_rls_policies.sql

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
    OR tenant_id IS NULL -- Templates globais
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

-- IMPORTANTE: Edge Functions usam service_role e bypassam RLS
-- Mas DEVEM validar tenant_id manualmente em TODAS as queries
```

## 5. Regras de Segurança (CRÍTICO)

### 5.1 Regras Obrigatórias

**RLS (Row Level Security):**

- ✅ RLS ativo em TODAS as tabelas
- ✅ Policies baseadas em tenant_id do usuário
- ✅ Função helper `get_user_tenant_ids()` para isolamento
- ✅ Nenhuma policy que permita acesso cruzado entre tenants

**Tenant Isolation:**

- ✅ TODAS as queries devem filtrar por tenant_id
- ✅ Edge Functions DEVEM validar tenant_id manualmente
- ✅ Frontend NUNCA acessa service_role
- ✅ Validação de tenant_id em TODOS os endpoints

**Edge Functions:**

- ✅ Usam service_role para acesso ao banco
- ✅ VALIDAM tenant_id em TODAS as operações
- ✅ NUNCA executam código dinâmico
- ✅ NUNCA usam eval/exec
- ✅ NUNCA concatenam SQL (sempre parametrizado)

**Frontend:**

- ✅ Usa apenas client Supabase (anônimo)
- ✅ NUNCA acessa service_role
- ✅ Todas as queries respeitam RLS automaticamente
- ✅ Validações de formulário no cliente

### 5.2 Proibições Absolutas

**❌ PROIBIDO - Acesso Cruzado entre Tenants:**

```typescript
// ERRADO
const conversations = await supabase
  .from('conversation')
  .select('*')
  // ❌ Sem filtro de tenant_id

// CORRETO
const conversations = await supabase
  .from('conversation')
  .select('*')
  .eq('tenant_id', currentTenantId) // ✅ Sempre filtrar
```

**❌ PROIBIDO - SQL Concatenado:**

```typescript
// ERRADO
const query = `SELECT * FROM conversation WHERE id = '${id}'`
// ❌ Vulnerável a SQL injection

// CORRETO
const { data } = await supabase
  .from('conversation')
  .select('*')
  .eq('id', id) // ✅ Parametrizado
  .single()
```

**❌ PROIBIDO - eval/exec:**

```typescript
// ERRADO
eval(userInput) // ❌ NUNCA
exec(userInput) // ❌ NUNCA
new Function(userInput) // ❌ NUNCA

// CORRETO
// Usar validação de schema (Zod) e processamento seguro
```

**❌ PROIBIDO - Código Dinâmico:**

```typescript
// ERRADO
const action = userInput.action
eval(`handle${action}()`) // ❌ NUNCA

// CORRETO
const actionHandlers = {
  approve: handleApprove,
  reject: handleReject,
}
const handler = actionHandlers[action]
if (handler) handler() // ✅ Whitelist de ações
```

**❌ PROIBIDO - Bypass de RLS:**

```typescript
// ERRADO (em Edge Function)
const { data } = await supabaseAdmin
  .from('conversation')
  .select('*')
  // ❌ Sem validar tenant_id

// CORRETO
const tenantId = await validateTenantAccess(conversationId, userId)
const { data } = await supabaseAdmin
  .from('conversation')
  .select('*')
  .eq('id', conversationId)
  .eq('tenant_id', tenantId) // ✅ Sempre validar
  .single()
```

**❌ PROIBIDO - Expor Prompts:**

```typescript
// ERRADO
const prompt = userInput.prompt // ❌ NUNCA aceitar prompt do usuário
await ai.generate(prompt)

// CORRETO
const prompt = buildExtractionPrompt(slots, context) // ✅ Prompt interno
await ai.generate(prompt)
```

**❌ PROIBIDO - Logar Dados Sensíveis:**

```typescript
// ERRADO
console.log('Message:', message.content_text) // ❌ Pode conter dados sensíveis

// CORRETO
console.log('Message received:', {
  id: message.id,
  direction: message.direction,
  // ✅ Não logar conteúdo sensível
})
```

## 6. Regras de IA (USO RESTRITO)

### 6.1 IA PODE Fazer

**✅ Extrair Intenção e Slots:**

```typescript
// Edge Function: ai-extractor
const extracted = await extractSlots(messageText, schema)
// Retorna: { intent: 'quote', slots: { people_count: 4, city: 'SP' } }
```

**✅ Reescrever Mensagens:**

```typescript
const rewritten = await rewriteMessage(template, context, tone)
// Retorna mensagem reescrita com variação
```

**✅ Sugerir Melhorias:**

```typescript
const suggestion = await suggestImprovement(conversation)
// Retorna sugestão (não executa)
```

### 6.2 IA NÃO PODE Fazer

**❌ Executar Ações:**

```typescript
// ERRADO
if (aiSuggestsApprove) {
  await approveRequest(requestId) // ❌ IA não executa
}

// CORRETO
const suggestion = await aiSuggestAction(requestId)
// ✅ Apenas sugere, humano decide
```

**❌ Decidir Preço:**

```typescript
// ERRADO
const price = await aiCalculatePrice(slots) // ❌ IA não calcula preço

// CORRETO
const price = calculatePrice(slots, rules) // ✅ Regras determinísticas
```

**❌ Decidir Aprovação:**

```typescript
// ERRADO
if (aiSuggestsApprove) {
  await updateRequestStatus(requestId, 'approved') // ❌ IA não aprova
}

// CORRETO
const suggestion = await aiSuggestApproval(requestId)
// ✅ Apenas sugere, admin aprova
```

**❌ Alterar Banco Diretamente:**

```typescript
// ERRADO
await ai.updateDatabase(query) // ❌ IA não escreve no banco

// CORRETO
const extracted = await ai.extractSlots(message)
await updateConversationContext(conversationId, extracted) // ✅ Código controlado
```

**❌ Criar Regras de Negócio:**

```typescript
// ERRADO
const rule = await ai.createBusinessRule(userInput) // ❌ IA não cria regras

// CORRETO
const rule = validateAndCreateRule(userInput, schema) // ✅ Validação determinística
```

## 7. Integração Twilio

### 7.1 Provider Interface

```typescript
// src/lib/whatsapp/provider.interface.ts
export interface WhatsAppProvider {
  sendText(to: string, message: string): Promise<string>
  sendButtons(to: string, buttons: ButtonMessage): Promise<string>
  sendFlow(to: string, flowDefinition: FlowDefinition): Promise<string>
  sendTemplate(to: string, template: TemplateMessage): Promise<string>
  validateWebhook(payload: unknown): boolean
  parseWebhook(payload: unknown): WebhookMessage
}
```

### 7.2 Twilio Provider

```typescript
// src/lib/whatsapp/providers/twilio-provider.ts
import { Twilio } from 'twilio'
import type { WhatsAppProvider } from '../provider.interface'

export class TwilioProvider implements WhatsAppProvider {
  private client: Twilio
  private fromNumber: string

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    this.client = new Twilio(accountSid, authToken)
    this.fromNumber = fromNumber
  }

  async sendText(to: string, message: string): Promise<string> {
    const result = await this.client.messages.create({
      from: `whatsapp:${this.fromNumber}`,
      to: `whatsapp:${to}`,
      body: message,
    })
    return result.sid
  }

  async sendFlow(to: string, flowDefinition: FlowDefinition): Promise<string> {
    // Implementar envio de WhatsApp Flow via Twilio
    // ...
  }

  validateWebhook(payload: unknown): boolean {
    // Validar assinatura do webhook Twilio
    // ...
  }

  parseWebhook(payload: unknown): WebhookMessage {
    // Parsear payload do Twilio
    // ...
  }
}
```

### 7.3 Edge Function: Webhook

```typescript
// supabase/functions/whatsapp-webhook/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')! // ✅ service_role
)

serve(async (req) => {
  // 1. Validar webhook
  const payload = await req.json()
  const isValid = validateTwilioWebhook(payload, req.headers)
  if (!isValid) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. Parsear mensagem
  const message = parseTwilioWebhook(payload)
  
  // 3. Identificar tenant e conversation
  const channel = await getChannelByPhone(message.from)
  if (!channel) {
    return new Response('Channel not found', { status: 404 })
  }

  // ✅ VALIDAR tenant_id
  const tenantId = channel.tenant_id

  // 4. Criar/atualizar contact
  const contact = await getOrCreateContact(
    tenantId,
    channel.id,
    message.from,
    message.contactName
  )

  // 5. Criar/atualizar conversation
  const conversation = await getOrCreateConversation(
    tenantId,
    channel.id,
    contact.id
  )

  // 6. Salvar mensagem
  await supabaseAdmin
    .from('message')
    .insert({
      tenant_id: tenantId, // ✅ Sempre incluir tenant_id
      conversation_id: conversation.id,
      direction: 'in',
      content_type: 'text',
      content_text: message.body,
      content_raw: payload,
    })

  // 7. Processar com flow engine
  await processMessage(tenantId, conversation.id, message.body)

  return new Response('OK', { status: 200 })
})
```

## 8. Flow Engine

### 8.1 Engine Puro (TypeScript)

```typescript
// src/lib/flow/engine.ts
export class FlowEngine {
  private flow: FlowDefinition
  private context: FlowContext

  constructor(flow: FlowDefinition, context: FlowContext) {
    this.flow = flow
    this.context = context
  }

  getCurrentStep(): Step | null {
    const stepKey = this.context.currentStepKey
    return this.flow.steps[stepKey] || null
  }

  async executeStep(step: Step, input: unknown): Promise<StepResult> {
    switch (step.type) {
      case 'message':
        return { type: 'message', content: step.content }
      
      case 'ask':
        return { type: 'ask', question: step.question, options: step.options }
      
      case 'extract':
        // ✅ IA apenas extrai, não executa
        const extracted = await extractSlots(input, step.schema)
        this.context.slots = { ...this.context.slots, ...extracted }
        return { type: 'extracted', slots: extracted }
      
      case 'validate':
        // ✅ Validação determinística, não IA
        const isValid = validateSlots(this.context.slots, step.rules)
        return { type: 'validation', isValid, errors: step.errors }
      
      case 'calculate':
        // ✅ Cálculo determinístico, não IA
        const result = calculatePrice(this.context.slots, step.rules)
        return { type: 'calculated', result }
      
      case 'route':
        // ✅ Roteamento determinístico
        const nextStep = determineNextStep(this.context, step.conditions)
        return { type: 'routed', nextStep }
      
      case 'handoff':
        return { type: 'handoff', message: step.message }
      
      case 'close':
        return { type: 'close', message: step.message }
    }
  }

  async processInput(input: string): Promise<FlowResponse> {
    const currentStep = this.getCurrentStep()
    if (!currentStep) {
      return { type: 'error', message: 'No current step' }
    }

    const result = await this.executeStep(currentStep, input)
    
    // Determinar próximo passo
    if (result.type === 'routed') {
      this.context.currentStepKey = result.nextStep
    }

    return {
      step: currentStep,
      result,
      nextStep: this.context.currentStepKey,
    }
  }
}
```

### 8.2 Validações (Sem IA)

```typescript
// src/lib/flow/validators.ts
export function validateSlots(
  slots: Record<string, unknown>,
  rules: ValidationRule[]
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  for (const rule of rules) {
    const value = slots[rule.key]
    
    if (rule.required && !value) {
      errors.push(`${rule.key} is required`)
      continue
    }

    if (rule.type === 'number') {
      const num = Number(value)
      if (isNaN(num)) {
        errors.push(`${rule.key} must be a number`)
      } else {
        if (rule.min !== undefined && num < rule.min) {
          errors.push(`${rule.key} must be at least ${rule.min}`)
        }
        if (rule.max !== undefined && num > rule.max) {
          errors.push(`${rule.key} must be at most ${rule.max}`)
        }
      }
    }

    if (rule.type === 'enum' && rule.options) {
      if (!rule.options.includes(value as string)) {
        errors.push(`${rule.key} must be one of: ${rule.options.join(', ')}`)
      }
    }

    if (rule.regex && typeof value === 'string') {
      const regex = new RegExp(rule.regex)
      if (!regex.test(value)) {
        errors.push(`${rule.key} format is invalid`)
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
```

## 9. Edge Functions - Segurança

### 9.1 Template Seguro

```typescript
// supabase/functions/_shared/security.ts
export async function validateTenantAccess(
  supabaseAdmin: SupabaseClient,
  userId: string,
  tenantId: string
): Promise<boolean> {
  // ✅ Validar que usuário pertence ao tenant
  const { data, error } = await supabaseAdmin
    .from('tenant_user')
    .select('id')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !data) {
    return false
  }

  return true
}

export function validateInput<T>(
  input: unknown,
  schema: ZodSchema<T>
): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`)
  }
  return result.data
}

// ✅ NUNCA executar código dinâmico
export function isSafeAction(action: string): boolean {
  const allowedActions = [
    'approve',
    'reject',
    'update',
    'send_message',
  ]
  return allowedActions.includes(action)
}
```

### 9.2 Exemplo: Flow Orchestrator

```typescript
// supabase/functions/flow-orchestrator/index.ts
import { validateTenantAccess, validateInput } from '../_shared/security.ts'
import { FlowEngine } from '../_shared/flow-engine.ts'

serve(async (req) => {
  // 1. Validar autenticação
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. Validar input
  const body = await req.json()
  const validated = validateInput(body, flowOrchestratorSchema)

  // 3. ✅ Validar tenant access
  const hasAccess = await validateTenantAccess(
    supabaseAdmin,
    validated.user_id,
    validated.tenant_id
  )
  if (!hasAccess) {
    return new Response('Forbidden', { status: 403 })
  }

  // 4. Carregar flow
  const { data: flow } = await supabaseAdmin
    .from('flow')
    .select('*')
    .eq('id', validated.flow_id)
    .eq('tenant_id', validated.tenant_id) // ✅ Sempre filtrar
    .single()

  if (!flow) {
    return new Response('Flow not found', { status: 404 })
  }

  // 5. Carregar conversation
  const { data: conversation } = await supabaseAdmin
    .from('conversation')
    .select('*')
    .eq('id', validated.conversation_id)
    .eq('tenant_id', validated.tenant_id) // ✅ Sempre filtrar
    .single()

  // 6. Processar com engine
  const engine = new FlowEngine(flow.definition, conversation.context)
  const result = await engine.processInput(validated.input)

  // 7. Atualizar conversation
  await supabaseAdmin
    .from('conversation')
    .update({
      context: result.context,
      current_step_key: result.nextStep,
    })
    .eq('id', validated.conversation_id)
    .eq('tenant_id', validated.tenant_id) // ✅ Sempre filtrar

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

## 10. Configuração de IA pelo Cliente

### 10.1 Interface de Configuração

**Localização**: `/settings/ai` na área admin

**Funcionalidades**:

- Seleção de provedor (OpenAI, Claude, Gemini)
- Campo para inserir API Key (criptografada no banco)
- Seleção de modelo
- Configurações avançadas (temperature, max_tokens)
- Links para obter keys e contratar serviços

### 10.2 Componente de Configuração

```typescript
// src/components/settings/AIConfigForm.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { ExternalLink } from 'lucide-react'

const AI_PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    getKeyUrl: 'https://platform.openai.com/api-keys',
    pricingUrl: 'https://openai.com/pricing',
    docsUrl: 'https://platform.openai.com/docs',
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
    pricingUrl: 'https://www.anthropic.com/pricing',
    docsUrl: 'https://docs.anthropic.com',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    models: ['gemini-pro', 'gemini-pro-vision'],
    getKeyUrl: 'https://makersuite.google.com/app/apikey',
    pricingUrl: 'https://ai.google.dev/pricing',
    docsUrl: 'https://ai.google.dev/docs',
  },
]

export function AIConfigForm({ tenantId }: { tenantId: string }) {
  const [provider, setProvider] = useState('openai')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  
  const selectedProvider = AI_PROVIDERS.find(p => p.id === provider)

  return (
    <Card className="p-6">
      <h2 className="text-2xl font-bold mb-4">Configuração de IA</h2>
      <p className="text-muted-foreground mb-6">
        Configure sua chave de IA. O custo das chamadas será cobrado diretamente pela
        provedora escolhida.
      </p>

      <div className="space-y-4">
        {/* Seleção de Provedor */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Provedor de IA
          </label>
          <Select value={provider} onValueChange={setProvider}>
            {AI_PROVIDERS.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </div>

        {/* Links úteis */}
        {selectedProvider && (
          <div className="bg-muted p-4 rounded-lg space-y-2">
            <p className="text-sm font-medium">Links úteis:</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={selectedProvider.getKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                Obter API Key <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={selectedProvider.pricingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                Ver Preços <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={selectedProvider.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                Documentação <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        )}

        {/* Campo API Key */}
        <div>
          <label className="block text-sm font-medium mb-2">
            API Key
          </label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
          <p className="text-xs text-muted-foreground mt-1">
            Sua chave será criptografada e armazenada com segurança
          </p>
        </div>

        {/* Seleção de Modelo */}
        {selectedProvider && (
          <div>
            <label className="block text-sm font-medium mb-2">
              Modelo
            </label>
            <Select value={model} onValueChange={setModel}>
              {selectedProvider.models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </div>
        )}

        <Button>Salvar Configuração</Button>
      </div>
    </Card>
  )
}
```

### 10.3 Criptografia de API Keys

```typescript
// supabase/functions/_shared/encryption.ts
// Usar Supabase Vault ou criptografia AES-256
export async function encryptApiKey(apiKey: string): Promise<string> {
  // Implementar criptografia segura
  // Usar variável de ambiente para chave de criptografia
}

export async function decryptApiKey(encryptedKey: string): Promise<string> {
  // Implementar descriptografia
}
```

### 10.4 Cliente Unificado de IA

```typescript
// src/lib/ai/client.ts
import { OpenAIProvider } from './providers/openai'
import { ClaudeProvider } from './providers/claude'
import { GeminiProvider } from './providers/gemini'

export interface AIConfig {
  provider: 'openai' | 'claude' | 'gemini'
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
}

export class AIClient {
  private config: AIConfig

  constructor(config: AIConfig) {
    this.config = config
  }

  async extractSlots(text: string, schema: SlotSchema): Promise<ExtractedSlots> {
    switch (this.config.provider) {
      case 'openai':
        return OpenAIProvider.extractSlots(text, schema, this.config)
      case 'claude':
        return ClaudeProvider.extractSlots(text, schema, this.config)
      case 'gemini':
        return GeminiProvider.extractSlots(text, schema, this.config)
    }
  }

  async rewriteMessage(template: string, context: MessageContext): Promise<string> {
    switch (this.config.provider) {
      case 'openai':
        return OpenAIProvider.rewriteMessage(template, context, this.config)
      case 'claude':
        return ClaudeProvider.rewriteMessage(template, context, this.config)
      case 'gemini':
        return GeminiProvider.rewriteMessage(template, context, this.config)
    }
  }
}
```

## 11. Onboarding Estilo ChatGPT (Mobile First)

**📄 Documentação Detalhada**: Veja `/docs/onboarding.md` para especificação completa do fluxo de onboarding.

### 11.0 Conceito Principal

**A landing page DO Nevo É o onboarding**. O usuário chega e vê apenas um campo de texto central (estilo home do ChatGPT). Ao enviar a primeira mensagem, inicia-se um chat guiado que coleta dados do negócio. O cadastro (email/senha ou Google OAuth) acontece **no meio** da conversa, somente depois de gerar valor.

### 11.1 Regras Mobile First para Onboarding

- ✅ Tela cheia no mobile
- ✅ Input fixo na parte inferior
- ✅ Mensagens com padding adequado para mobile
- ✅ Botões com tamanho mínimo de 44px
- ✅ Scroll suave
- ✅ Animações otimizadas para mobile

### 11.2 Design e UX

**Inspiração**: Interface do ChatGPT com:

- Chat em tela cheia
- Mensagens em formato de chat
- Input fixo na parte inferior
- Animações suaves
- Design limpo e minimalista
- Logo Nevo simples no topo
- Headline central: "Como posso ajudar?"
- Exemplos clicáveis (opcional)

### 11.2 Componente de Onboarding

```typescript
// src/components/onboarding/OnboardingChat.tsx
'use client'

import { useState } from 'react'
import { OnboardingMessage } from './OnboardingMessage'
import { OnboardingInput } from './OnboardingInput'

interface Message {
  id: string
  role: 'assistant' | 'user'
  content: string
  timestamp: Date
}

export function OnboardingChat({ tenantId }: { tenantId: string }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Olá! Bem-vindo ao Nevo. Vamos configurar seu atendimento inteligente. Qual é o nome da sua empresa?',
      timestamp: new Date(),
    },
  ])
  const [isLoading, setIsLoading] = useState(false)

  const handleSend = async (content: string) => {
    // Adicionar mensagem do usuário
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])
    setIsLoading(true)

    // Processar resposta
    // ... lógica de onboarding

    setIsLoading(false)
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b p-4">
        <h1 className="text-xl font-semibold">Configuração Inicial</h1>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(message => (
          <OnboardingMessage key={message.id} message={message} />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="animate-pulse">●</div>
            <div className="animate-pulse delay-75">●</div>
            <div className="animate-pulse delay-150">●</div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-4">
        <OnboardingInput onSend={handleSend} disabled={isLoading} />
      </div>
    </div>
  )
}
```

### 11.3 Fluxo de Onboarding (Detalhado em `/docs/onboarding.md`)

**Estado Inicial**: Usuário anônimo (sem auth), cria `onboarding_session` anônima

1. **PASSO 1 - Boas-vindas**: Após primeira mensagem do usuário, Nevo se apresenta
2. **PASSO 2 - Detectar ramo**: IA sugere domínio, usuário confirma
3. **PASSO 3 - Coleta de dados**: Nome do negócio, o que atende, o que não atende, modo de decisão, tom de voz
4. **PASSO 4 - Momento de cadastro**: Após gerar valor ("já consigo montar seu fluxo")
5. **PASSO 5 - Cadastro inline**:
   - Opção 1: Email + Senha
   - Opção 2: **Google OAuth** (novo)
   - Opção 3: Continuar depois (opcional)
6. **Após cadastro**: Migrar session → tenant + flow + variables, redirecionar para `/app/flow-editor`

**Tabelas necessárias**:
- `onboarding_sessions` (anônimas, expiram em 7 dias)
- `onboarding_messages` (histórico do chat)

## 12. Chat Próprio (Alternativa ao WhatsApp)

### 12.1 Funcionalidade

**Objetivo**: Permitir que clientes usem o Nevo sem custos de WhatsApp, oferecendo um chat próprio com link gerado.

**Como funciona**:

1. Cliente escolhe "Chat Próprio" no onboarding ou configurações
2. Sistema gera um `chat_slug` único
3. Link gerado: `https://nevo.app/chat/[chat-slug]` ou `https://[tenant-slug].nevo.app/chat`
4. Cliente divulga o link nas redes sociais, site, etc.
5. Quando usuário acessa o link, abre chat estilo ChatGPT (tela cheia, design limpo)

**Design**: Inspirado no ChatGPT quando você entra pela primeira vez

- Tela cheia
- Fundo limpo
- Input centralizado na parte inferior
- Mensagens em formato de chat
- Mobile first

### 12.2 Schema de Canal

```sql
-- Já atualizado na seção 4.1
-- Canal pode ser 'whatsapp' ou 'web_chat'
-- web_chat tem chat_slug único
-- Link gerado: nevo.app/chat/[chat-slug]
```

### 12.3 Geração de Link

```typescript
// src/lib/chat/link-generator.ts
export function generateChatLink(chatSlug: string): string {
  // Opção 1: Subdomínio do tenant
  // return `https://${tenantSlug}.nevo.app/chat`
  
  // Opção 2: Path único
  return `https://nevo.app/chat/${chatSlug}`
}

export function generateShareableLink(chatSlug: string, tenantName: string): {
  link: string
  qrCode: string
  embedCode?: string // Para futuro, se quiserem widget
} {
  const link = generateChatLink(chatSlug)
  return {
    link,
    qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`,
  }
}
```

### 12.4 Componente de Chat Público (Mobile First)

```typescript
// src/app/chat/[slug]/page.tsx
'use client'

import { PublicChat } from '@/components/chat/PublicChat'
import { getChannelBySlug } from '@/lib/supabase/server'

export default async function ChatPage({ params }: { params: { slug: string } }) {
  const channel = await getChannelBySlug(params.slug)
  
  if (!channel || channel.type !== 'web_chat') {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Chat não encontrado</h1>
          <p className="text-muted-foreground">O link que você acessou não é válido.</p>
        </div>
      </div>
    )
  }

  return <PublicChat channelId={channel.id} tenantId={channel.tenant_id} />
}
```

### 12.5 Componente PublicChat (Design ChatGPT - Mobile First)

```typescript
// src/components/chat/PublicChat.tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { Send } from 'lucide-react'

interface Message {
  id: string
  role: 'assistant' | 'user'
  content: string
  timestamp: Date
}

export function PublicChat({ channelId, tenantId }: { channelId: string; tenantId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll para última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (content: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])
    setIsLoading(true)

    // Processar mensagem via flow engine
    // ...

    setIsLoading(false)
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header - Mobile First */}
      <div className="border-b p-3 sm:p-4 flex-shrink-0">
        <h1 className="text-lg sm:text-xl font-semibold text-center">
          Chat de Atendimento
        </h1>
      </div>

      {/* Messages Area - Mobile First */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4">
        {messages.length === 0 ? (
          // Tela inicial estilo ChatGPT
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="mb-6 sm:mb-8">
              <h2 className="text-2xl sm:text-3xl font-semibold mb-2">
                Como posso ajudar?
              </h2>
              <p className="text-muted-foreground text-sm sm:text-base">
                Comece uma conversa para obter informações
              </p>
            </div>
          </div>
        ) : (
          messages.map(message => (
            <ChatMessage key={message.id} message={message} />
          ))
        )}
        
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground px-3 sm:px-4">
            <div className="w-2 h-2 bg-current rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-current rounded-full animate-pulse delay-75" />
            <div className="w-2 h-2 bg-current rounded-full animate-pulse delay-150" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area - Mobile First */}
      <div className="border-t p-3 sm:p-4 flex-shrink-0 bg-background">
        <ChatInput onSend={handleSend} disabled={isLoading} />
      </div>
    </div>
  )
}
```

### 12.6 Componente ChatInput (Mobile First)

```typescript
// src/components/chat/ChatInput.tsx
'use client'

import { useState, KeyboardEvent } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export function ChatInput({ 
  onSend, 
  disabled 
}: { 
  onSend: (message: string) => void
  disabled?: boolean 
}) {
  const [message, setMessage] = useState('')

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSend(message.trim())
      setMessage('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex gap-2 items-end">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Digite sua mensagem..."
        disabled={disabled}
        className="
          min-h-[44px] max-h-[120px] 
          resize-none
          text-base
          sm:text-sm
          flex-1
        "
        rows={1}
      />
      <Button
        onClick={handleSend}
        disabled={disabled || !message.trim()}
        size="icon"
        className="
          h-[44px] w-[44px] 
          flex-shrink-0
          sm:h-10 sm:w-10
        "
      >
        <Send className="h-4 w-4 sm:h-5 sm:w-5" />
      </Button>
    </div>
  )
}
```

### 12.7 Página de Configuração de Canal

```typescript
// src/app/(dashboard)/settings/channels/page.tsx
'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Copy, ExternalLink } from 'lucide-react'

export default function ChannelsPage() {
  const [chatSlug, setChatSlug] = useState('')
  const chatLink = chatSlug ? `https://nevo.app/chat/${chatSlug}` : ''

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <h1 className="text-2xl sm:text-3xl font-bold">Canais de Atendimento</h1>

      {/* WhatsApp */}
      <Card className="p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold mb-2">WhatsApp</h2>
        <p className="text-sm sm:text-base text-muted-foreground mb-4">
          Configure integração com WhatsApp via Twilio
        </p>
        <Button>Configurar WhatsApp</Button>
      </Card>

      {/* Chat Próprio */}
      <Card className="p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold mb-2">Chat Próprio</h2>
        <p className="text-sm sm:text-base text-muted-foreground mb-4">
          Gere um link para compartilhar nas suas redes sociais ou site
        </p>
        
        {chatLink ? (
          <div className="space-y-3 sm:space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={chatLink}
                readOnly
                className="flex-1 text-sm"
              />
              <Button
                variant="outline"
                onClick={() => navigator.clipboard.writeText(chatLink)}
                className="sm:w-auto"
              >
                <Copy className="h-4 w-4 mr-2" />
                Copiar Link
              </Button>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={chatLink} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Abrir Chat
                </a>
              </Button>
              <Button variant="outline" size="sm">
                Gerar QR Code
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => generateChatSlug()}>
            Gerar Link do Chat
          </Button>
        )}
      </Card>
    </div>
  )
}
```

### 12.5 Integração com Flow Engine

O mesmo flow engine funciona para ambos os canais:

- **WhatsApp**: Mensagens via Twilio
- **Web Chat**: Mensagens via WebSocket ou polling
```typescript
// src/lib/chat/channel-adapter.ts
export interface ChannelAdapter {
  sendMessage(conversationId: string, message: string): Promise<void>
  onMessage(callback: (message: Message) => void): void
}

export class WhatsAppAdapter implements ChannelAdapter {
  // Implementação via Twilio
}

export class WebChatAdapter implements ChannelAdapter {
  // Implementação via WebSocket/SSE
}
```


## 13. Editor Visual de Fluxos (Estilo N8N) - NO MVP

### 13.1 Arquitetura: Flow DSL como Single Source of Truth

**Conceito Fundamental:**

- Flow DSL (JSON) é a fonte de verdade única
- `flow.definition` = JSON do fluxo (nós, conexões, condições, mensagens)
- `flow.layout` = JSON com posições x/y e estilo (apenas UI, separado)
- Editor Visual e Chat do Nevo editam o mesmo DSL
- Isso evita conflitos e garante consistência

**Por que isso importa:**

> "Se você deixar o editor visual ser a fonte de verdade, vira bagunça. Se deixar o chat ser a fonte de verdade, vira imprevisível. Com o DSL como base, os dois conseguem editar com segurança."

### 13.2 Funcionalidades do Editor Visual (MVP)

**Ações MVP (Todas obrigatórias):**

1. ✅ **Mover nó (drag and drop)**

   - Arrastar nós pelo canvas
   - Atualizar `flow.layout` com novas posições

2. ✅ **Conectar nó (seta)**

   - Criar conexões entre nós
   - Visualizar fluxo do diálogo
   - Atualizar `flow.definition` com conexões

3. ✅ **Editar texto do nó (pergunta/mensagem)**

   - Editar conteúdo de cada nó
   - Validação em tempo real
   - Atualizar `flow.definition`

4. ✅ **Editar opções (botões/lista)**

   - Configurar opções de resposta
   - Adicionar/remover opções
   - Validação de opções

5. ✅ **Editar condições simples (if/else)**

   - Configurar roteamento condicional
   - Condições baseadas em slots/variáveis
   - Visualização de branches

6. ✅ **Ativar/Desativar um nó**

   - Toggle de ativação sem deletar
   - Visual diferenciado para nós desativados
   - Útil para testes e iterações

7. ✅ **Testar fluxo (simulador)** - **MUITO IMPORTANTE**

   - Simulador integrado
   - Testar fluxo sem enviar mensagens reais
   - Debug visual do caminho percorrido

### 13.3 Tipos de Nós Padronizados (Universais)

**Não criar nós específicos por segmento. Criar nós universais:**

1. **Trigger**: "Mensagem recebida"

   - Ponto de entrada do fluxo
   - Pode ter condições (palavras-chave, intenções)

2. **Extract (IA)**: Extrair intenção e slots do texto

   - Usa IA configurada pelo cliente
   - Schema de extração definido
   - Validação de slots extraídos

3. **Ask**: Perguntar uma variável (com validação)

   - Coleta de dados estruturados
   - Validação em tempo real
   - Opções de resposta (botões/lista)

4. **Route**: Condição (if/else)

   - Roteamento baseado em slots/condições
   - Múltiplos branches
   - Condições simples (não loops complexos no MVP)

5. **Compute**: Calcular estimativa (faixa/preço/pontuação)

   - Cálculos determinísticos
   - Baseado em regras de negócio
   - Não usa IA para cálculo

6. **Handoff**: Mandar para humano (admin)

   - Escalar conversa
   - Notificar admin
   - Manter contexto

7. **Send**: Enviar mensagem/resumo

   - Enviar resposta ao usuário
   - Templates de mensagem
   - Suporte a variáveis

8. **Close**: Encerrar

   - Finalizar conversa
   - Mensagem de encerramento
   - Atualizar status

### 13.4 Implementação Técnica

**Biblioteca Recomendada: React Flow**

```typescript
// src/components/flows/FlowEditor.tsx
'use client'

import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { FlowNode } from './FlowNode'
import { NodeEditor } from './NodeEditor'

const nodeTypes = {
  trigger: FlowNode,
  extract: FlowNode,
  ask: FlowNode,
  route: FlowNode,
  compute: FlowNode,
  handoff: FlowNode,
  send: FlowNode,
  close: FlowNode,
}

export function FlowEditor({ flowId }: { flowId: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)

  // Carregar flow do banco
  useEffect(() => {
    loadFlow(flowId).then((flow) => {
      // Converter flow.definition para nodes e edges
      const { nodes: flowNodes, edges: flowEdges } = parseFlowDefinition(flow.definition)
      setNodes(flowNodes)
      setEdges(flowEdges)
    })
  }, [flowId])

  // Salvar alterações
  const handleSave = async () => {
    const definition = convertToFlowDefinition(nodes, edges)
    const layout = extractLayout(nodes)
    
    await updateFlow(flowId, {
      definition,
      layout,
    })
  }

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  )

  return (
    <div className="h-screen w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => setSelectedNode(node)}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      
      {selectedNode && (
        <NodeEditor
          node={selectedNode}
          onUpdate={(updates) => {
            setNodes((nds) =>
              nds.map((node) =>
                node.id === selectedNode.id ? { ...node, ...updates } : node
              )
            )
          }}
        />
      )}
    </div>
  )
}
```

### 13.5 Simulador de Fluxo

```typescript
// src/components/flows/FlowSimulator.tsx
'use client'

export function FlowSimulator({ flowId }: { flowId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [currentNode, setCurrentNode] = useState<string | null>(null)
  const [context, setContext] = useState<FlowContext>({})

  const simulateStep = async (input: string) => {
    // Executar flow engine com dados simulados
    const result = await simulateFlowExecution(flowId, input, context)
    
    // Atualizar contexto
    setContext(result.context)
    
    // Destacar nó atual no canvas
    setCurrentNode(result.currentNodeId)
    
    // Adicionar mensagem
    setMessages((prev) => [...prev, result.message])
  }

  return (
    <div className="flex flex-col h-full">
      {/* Canvas com highlight do nó atual */}
      <FlowEditor flowId={flowId} highlightedNode={currentNode} />
      
      {/* Simulador de chat */}
      <div className="border-t p-4">
        <div className="space-y-2 mb-4">
          {messages.map((msg) => (
            <div key={msg.id}>{msg.content}</div>
          ))}
        </div>
        <input
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              simulateStep(e.currentTarget.value)
              e.currentTarget.value = ''
            }
          }}
        />
      </div>
    </div>
  )
}
```

### 13.6 Integração com Chat do Nevo

**Edição por Intenção via Chat:**

O cliente pode editar fluxos via chat:

- "Não quero perguntar X"
- "Quero aprovar sempre"
- "Adicione variável Y"

O sistema:

1. Processa intenção via IA
2. Atualiza `flow.definition`
3. Reconstrói visualização no editor
4. Sincroniza ambos (chat e visual)

### 13.7 O que Fica para V2 (Fora do MVP)

- ❌ Loops complexos
- ❌ Subflows reutilizáveis
- ❌ Versões com diff visual
- ❌ A/B testing

### 13.8 Mobile First no Editor

**Desafio**: Editor visual é complexo para mobile

**Solução**:

- Desktop: Editor visual completo
- Mobile: Visualização simplificada + edição via chat do Nevo
- Tablet: Editor adaptado com gestos touch

## 14. Checklist de Segurança

### ✅ Antes de Commitar Código

- [ ] RLS ativo em todas as tabelas?
- [ ] Todas as queries filtram por tenant_id?
- [ ] Edge Functions validam tenant_id manualmente?
- [ ] Nenhum SQL concatenado (sempre parametrizado)?
- [ ] Nenhum eval/exec/new Function?
- [ ] Nenhum código dinâmico executado?
- [ ] Validação de input com Zod/schema?
- [ ] Logs não contêm dados sensíveis?
- [ ] Prompts não são expostos ao usuário?
- [ ] IA não executa ações (apenas extrai/sugere)?
- [ ] Cálculos de preço são determinísticos?
- [ ] Aprovações são feitas por humanos?
- [ ] Frontend nunca acessa service_role?
- [ ] Dark mode implementado corretamente?
- [ ] Nenhum CSS hardcoded (tudo Tailwind)?
- [ ] Mobile first aplicado em TODAS as telas?
- [ ] Formulários testados em mobile?
- [ ] Navegação funciona perfeitamente em mobile?

## 11. Próximos Passos

1. **Setup Inicial**

   - Criar projeto Next.js
   - Configurar Tailwind com dark mode
   - Configurar Supabase
   - Criar estrutura de pastas
   - Criar pasta `/docs` e mover documentação

2. **Database**

   - Criar migrations
   - Implementar RLS policies
   - Seed de blueprints

3. **Autenticação**

   - Setup Supabase Auth
   - Implementar middleware
   - Criar páginas de login

4. **Twilio Integration**

   - Criar conta sandbox
   - Implementar provider
   - Configurar webhooks

5. **Flow Engine**

   - Implementar engine puro
   - Criar validadores
   - Testes unitários

5.5. **Editor Visual de Fluxos**

   - Implementar React Flow
   - Criar componentes de nós
   - Implementar drag-and-drop
   - Sistema de conexões
   - Editor de propriedades
   - Simulador de fluxo
   - Sincronização DSL ↔ Visual

6. **Frontend (Mobile First)**

   - Componentes base (shadcn/ui) - mobile first
   - Theme toggle
   - Dashboard layout - mobile first
   - Páginas principais - mobile first
   - Formulários otimizados para mobile
   - Navegação mobile-friendly

7. **Edge Functions**

   - Webhook handler
   - Flow orchestrator
   - AI extractor (com regras restritas)

8. **Configuração de IA**

   - Criar interface de configuração
   - Implementar criptografia de API keys
   - Criar clientes para cada provedor (OpenAI, Claude, Gemini)
   - Adicionar links para obter keys

9. **Onboarding Estilo ChatGPT**

   - Criar componente de chat
   - Implementar fluxo de onboarding
   - Design inspirado no ChatGPT
   - Integração com blueprints

10. **Chat Próprio**

    - Criar schema para web_chat
    - Implementar chat público (design ChatGPT)
    - Geração de link único
    - Página de compartilhamento com QR Code
    - Chat mobile first
    - Integração com flow engine

11. **Security Audit**

    - Revisar todas as queries
    - Validar RLS policies
    - Testar tenant isolation
    - Verificar proibições absolutas
    - Validar criptografia de API keys