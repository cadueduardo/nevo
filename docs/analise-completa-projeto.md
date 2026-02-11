# Análise Completa do Projeto Nevo

Documento de referência para planejar os próximos passos da área do cliente.

---

## 1. Visão Geral

O Nevo é uma plataforma que configura assistentes virtuais para negócios (agendamento, orçamento, atendimento). O projeto tem:

- **Landing + Onboarding**: coleta de dados via chat inteligente
- **Simulador**: teste do atendimento durante o onboarding
- **Backend**: Edge Functions no Supabase
- **Migração**: após cadastro, dados vão para tenant + flow

**O que NÃO existe ainda**: área do cliente autenticada (dashboard, agenda, configurações, etc.).

---

## 2. Estrutura de Pastas

```
nevo/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Landing = LandingChat
│   │   ├── layout.tsx
│   │   └── api/
│   │       ├── onboarding/route.ts     # Proxy para onboarding-chat
│   │       ├── onboarding/migrate/route.ts
│   │       └── conversations-turn/route.ts  # Proxy para conversations-turn
│   ├── components/
│   │   ├── shared/                     # ChatShell, ChatThread, ChatMessage, ChatComposer, TypingPlaceholder
│   │   ├── onboarding/                 # LandingChat, SignupCard, LoginCard, AddressForm
│   │   ├── layout/                     # ThemeToggle
│   │   ├── providers/                  # ThemeProvider
│   │   └── ui/                         # button, card, input, select, textarea (shadcn)
│   ├── features/simulator/
│   │   └── components/SimulatorPanel.tsx
│   ├── lib/
│   │   ├── onboarding/                 # api, session, restore
│   │   ├── simulator/                  # api (sendSimulatorMessage)
│   │   ├── supabase/                   # client, server
│   │   ├── viacep.ts
│   │   └── utils/
│   ├── hooks/                          # useTheme, useTypingPlaceholder
│   ├── types/                          # business-model, onboarding
│   └── styles/globals.css
├── supabase/
│   ├── functions/
│   │   ├── onboarding-chat/            # Edge Function do onboarding
│   │   └── conversations-turn/         # Edge Function do simulador/atendimento
│   ├── migrations/
│   └── deploy.ps1
└── docs/
```

---

## 3. Banco de Dados

### 3.1 Tabelas Principais (001_initial_schema.sql)

| Tabela | Descrição |
|--------|-----------|
| `tenant` | Empresa (id, name, slug) |
| `tenant_user` | Usuários do tenant (role: owner, admin, agent, viewer) |
| `tenant_setting` | Configurações: tone, language, handoff_mode, business_config, when_client_asks_price_no_value |
| `tenant_ai_config` | Configuração de IA (provider, api_key, model) — **não usada no fluxo atual** |
| `channel` | Canais (whatsapp, web_chat) — **estrutura pronta, não integrada** |
| `contact` | Contatos por canal |
| `conversation` | Conversas (status: open, awaiting_human, closed) |
| `message` | Mensagens das conversas |
| `flow` | Fluxos (definition JSONB, layout JSONB) |
| `variable` | Variáveis dinâmicas |
| `blueprint` | Templates de fluxo por domínio |
| `request` | Pedidos/leads (status: pending, approved, rejected, completed), slots JSONB |

### 3.2 Onboarding (003_onboarding_sessions.sql)

| Tabela | Descrição |
|--------|-----------|
| `onboarding_sessions` | Sessão anônima, collected_data JSONB, current_step_key, expires_at 7 dias |
| `onboarding_messages` | Histórico do chat (role, content, metadata) |

### 3.3 Configurações do Tenant (005_tenant_business_config.sql)

- `tenant_setting.business_config` (JSONB): services, location_mode, establishment_address, service_area, holidays_attend, closure_periods
- `tenant_setting.when_client_asks_price_no_value`: handoff | offer_handoff_or_booking

**Observação**: `staff` e `schedule` são coletados no onboarding mas **não estão em business_config** na migração. O simulador usa esses dados porque o frontend passa o contexto completo do onboarding. Na área do cliente, será preciso carregar de outra fonte ou estender business_config.

---

## 4. APIs e Edge Functions

### 4.1 Onboarding Chat (`/api/onboarding` → `onboarding-chat`)

**Entrada**: `session_id`, `message`, `current_step`, etc.

**Saída**: `assistant_message`, `next_step`, `extracted_data`, `action_options`, `selectable_options`, `editable_items`, `requires_action`

**Principais módulos**:
- `index.ts` — handlers por step, processMessage, parseEditCommand
- `flow-manager.ts` — determineNextStep, generateSummary, buildServiceSelectableOptions
- `extractors.ts` — extractBusinessModelWithAI, identifyMissingFields, parseServicesList
- `migrate.ts` — migrateOnboardingToTenant, createDefaultFlowDefinition

### 4.2 Conversations Turn (`/api/conversations-turn` → `conversations-turn`)

**Entrada**: `session_id`, `message`, `conversation_id?`, `context` (business_name, services, schedule, staff, etc.)

**Saída**: `conversation_id`, `messages` (content, action_options)

**Principais módulos**:
- `index.ts` — resolveBooking, resolveQuote, estado do simulador
- `lib/` — ai, builders, calendar, detection, holidays, services, staff, state, types, utils

**Contexto do simulador** (SimulatorRequest.context): business_name, business_type, context_mode, establishment_address, tone, services, schedule, staff, dynamic_variables, holidays_attend, closure_periods, allow_sequence_booking, sequence_eligible_services, when_client_asks_price_no_value.

### 4.3 Migrate (`/api/onboarding/migrate`)

Usada internamente pelo onboarding-chat ao confirmar senha. Cria:
- Usuário Supabase Auth
- tenant
- tenant_user (owner)
- tenant_setting (tone, handoff_mode, business_config)
- flow (definition + layout)
- variable (se dynamic_variables)

---

## 5. Fluxo do Onboarding (47 steps)

1. welcome → collect_free_text
2. business_type, business_name, context
3. services_list, services_add
4. schedule_days, schedule_time, schedule_breaks, schedule_interval, schedule_interval_custom
5. services_duration, services_pricing
6. sequence_booking_offer, sequence_services_select (se permitir sequência)
7. staff_mode, owner_attends, staff_list, staff_list_more, staff_schedule_*
8. quote_variables (se orçamento)
9. location_mode, address, service_area
10. policies, tone_of_voice, handoff_mode
11. holidays_offer, holidays_select, closure_offer, closure_dates, closure_more
12. faq_offer, faq_question, faq_more
13. summary, summary_edit
14. signup_request, signup_email, signup_password, signup_confirm_password
15. completed → migrateOnboardingToTenant

**Resumo editável**: todos os itens coletados aparecem na lista de edição (nome, serviços com duração/preço, feriados, períodos de fechamento, sequência de serviços, etc.).

---

## 6. Simulador de Atendimento

- **Onde**: dentro do `LandingChat`, painel lateral "Simular atendimento"
- **Quando**: habilitado após coletar dados mínimos (context, services, schedule)
- **Contexto**: passado do `onboardingData` (LandingChat)
- **Backend**: conversations-turn
- **Estado**: em memória (booked_slots, slots, etc.)
- **Calendar**: gera .ics e faz upload no bucket `calendar`; envia link "Adicionar ao calendário" ao cliente

**Importante**: agendamentos do simulador **não são persistidos**. Ao fechar, tudo é perdido.

---

## 7. Pós-Cadastro (Hoje)

Após `signup_confirm_password`:

1. `migrateOnboardingToTenant` roda
2. Retorna `next_step: 'completed'`, `user_id`, `tenant_id`
3. Frontend faz `console.log('Onboarding completo! Redirecionar para dashboard em breve.')`
4. **Não há redirecionamento** para área autenticada
5. **Não existe** rota `/app` ou dashboard

---

## 8. O Que NÃO Existe (Gaps)

| Item | Status |
|------|--------|
| Layout /app protegido | ❌ Não implementado |
| Dashboard inicial | ❌ Não implementado |
| Redirecionamento pós-cadastro | ❌ Apenas console.log |
| Editor de fluxo (/app/flow-editor) | ❌ Não implementado |
| Área de agenda/calendário | ❌ Não mapeada |
| Tabela de agendamentos | ❌ Não existe (booked_slots é em memória) |
| Tela de configurações | ❌ Não implementada |
| Lista de conversas | ❌ Tabelas existem, UI não |
| Lista de requests/pedidos | ❌ Tabela existe, UI não |
| Integração WhatsApp | ❌ Não implementada |
| Chat próprio (link público) | ❌ Não implementado |
| Google OAuth no signup | ❌ Não implementado |
| staff/schedule em business_config | ⚠️ Coletados no onboarding, não migrados para tenant_setting |

---

## 9. O Que Já Funciona

- Landing page com chat de onboarding
- Coleta completa de dados (47 steps)
- Extração com IA (OpenAI)
- Resumo editável (todos os campos)
- Signup inline (email/senha)
- Migração para tenant (user, tenant, settings, flow, variables)
- Simulador durante onboarding
- Geração de .ics para "Adicionar ao calendário"
- Sequência de serviços (ex.: banho + tosa)
- Tom de voz, handoff_mode, feriados, períodos de fechamento
- API proxy para CORS

---

## 10. Sugestão de Próximos Passos (Área do Cliente)

### Fase 1 — Fundação
1. Criar layout `/app` com proteção de rota (Supabase Auth)
2. Página de login (`/login`) e redirecionamento pós-cadastro para `/app`
3. Dashboard básico (`/app`) com boas-vindas e resumo do negócio

### Fase 2 — Uso Imediato
4. Reutilizar SimulatorPanel em `/app/simulator` para teste do atendimento
5. Carregar contexto do tenant (tenant_setting.business_config + staff/schedule — ver se estender business_config ou flow.definition)

### Fase 3 — Agenda
6. Definir modelo de dados para agendamentos (tabela `appointment` ou uso de `request`)
7. Persistir agendamentos quando o bot confirmar (integrar conversations-turn)
8. Tela `/app/agenda` com calendário ou lista de agendamentos

### Fase 4 — Configurações e Fluxo
9. Tela `/app/settings` com dados editáveis (equivalente ao resumo do onboarding)
10. Editor de fluxo (`/app/flow-editor`) — visualização/edição do flow.definition

### Fase 5 — Canais e Conversas
11. Lista de conversas (`/app/conversations`)
12. Integração WhatsApp ou chat próprio

---

## 11. Dependências e Configurações

- **Next.js 14+** (App Router)
- **Tailwind CSS**, shadcn/ui
- **Supabase** (Auth, Postgres, Storage, Edge Functions)
- **Variáveis de ambiente**: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
- **Secrets Supabase**: OPENAI_API_KEY (onboarding-chat, conversations-turn)
- **Storage**: bucket `calendar` para arquivos .ics

---

## 12. Arquivos Chave para Extensão

| Objetivo | Arquivos relevantes |
|----------|---------------------|
| Redirecionar pós-cadastro | `LandingChat.tsx` (handleSignupSubmit, setTimeout) |
| Layout /app | Criar `src/app/(dashboard)/layout.tsx` |
| Carregar dados do tenant | `tenant_setting.business_config`, `flow.definition` |
| Persistir agendamentos | `conversations-turn/index.ts`, nova migration |
| Tela de agenda | Novo componente + rota `/app/agenda` |
| Configurações | Reaproveitar lógica de buildEditableItems, novo endpoint ou ler tenant_setting |

---

*Documento gerado para planejamento da área do cliente. Última atualização: análise do estado atual do repositório.*
