# Status da Implementação - MVP Nevo

## 📋 Resumo do que foi implementado

### ✅ Estrutura Base do Projeto

1. **Configuração Next.js 14+ (App Router)**
   - TypeScript configurado
   - Tailwind CSS com dark mode
   - shadcn/ui instalado
   - Estrutura de pastas organizada

2. **Integração Supabase**
   - Cliente frontend (`src/lib/supabase/client.ts`)
   - Cliente server (`src/lib/supabase/server.ts`)
   - MCP configurado para operações no banco

3. **Schema do Banco de Dados**
   - Migrations criadas:
     - `001_initial_schema.sql` - Tabelas principais (tenant, tenant_user, channel, contact, conversation, message, flow, variable, blueprint, request, tenant_setting, tenant_ai_config)
     - `002_rls_policies.sql` - Políticas RLS para todas as tabelas
     - `003_onboarding_sessions.sql` - Tabelas de onboarding anônimo
     - `004_onboarding_rls.sql` - Políticas RLS para onboarding
     - `005_tenant_business_config.sql` - tenant_setting (when_client_asks_price_no_value, business_config)

### ✅ Componentes de UI (Mobile First)

1. **Componentes Compartilhados**
   - `ChatShell` - Layout completo do chat (estilo ChatGPT)
   - `ChatThread` - Thread de mensagens
   - `ChatMessage` - Bubble de mensagem com suporte a botões de ação
   - `ChatComposer` - Input com placeholder animado e botão de envio condicional
   - `TypingPlaceholder` - Animação de placeholder digitando

2. **Componentes de Onboarding**
   - `LandingChat` - Componente principal do onboarding na landing page

3. **Design System**
   - Tailwind configurado com dark mode
   - Font weight 400 para headlines
   - Layout centralizado estilo ChatGPT
   - Placeholder animado rotacionando exemplos

### ✅ Onboarding Inteligente e Dinâmico

1. **Tipos TypeScript**
   - `src/types/business-model.ts` - Schema completo do Business Model
   - `src/types/onboarding.ts` - Tipos do onboarding

2. **Edge Function: `onboarding-chat`**
   - **Versão atual**: 10
   - **Funcionalidades implementadas**:
     - ✅ Extração inteligente usando OpenAI (múltiplos campos de uma vez)
     - ✅ Fluxo adaptativo (pergunta apenas o que falta)
     - ✅ Coleta de serviços (lista por vírgula)
     - ✅ Coleta de FAQ dinâmica
     - ✅ Variáveis dinâmicas contextuais (para orçamentos)
     - ✅ Processamento de steps específicos
     - ✅ Geração de resumo

3. **Funcionalidades de Extração**
   - `extractBusinessModelWithAI()` - Extrai tipo de negócio, serviços, agenda, região, políticas, contexto, tom de voz
   - `identifyMissingFields()` - Identifica campos faltantes baseado no contexto
   - `parseServicesList()` - Processa lista de serviços separada por vírgula
   - `extractQuoteVariables()` - Extrai variáveis necessárias para orçamentos

4. **Gerenciador de Fluxo Adaptativo**
   - `determineNextStep()` - Decide próximo passo baseado no que falta
   - Prioriza campos obrigatórios
   - Adapta-se ao contexto (agendamento/orçamento/ambos)
   - Pergunta apenas o necessário

### ✅ Fluxo de Onboarding Implementado

**Ordem aproximada dos steps** (adaptativa conforme contexto agendamento/orçamento/ambos):

| # | Step | Descrição |
|---|------|-----------|
| 1 | `welcome` | Primeira mensagem; detecta tutorial ou extração |
| 2 | `collect_free_text` | Coleta inicial livre; IA extrai múltiplos campos de uma mensagem |
| 3 | `business_type` | Tipo do negócio (ramo de atividade) |
| 4 | `business_name` | Nome da empresa |
| 5 | `context` | Contexto: Agendamento, Orçamento ou Ambos |
| 6 | `services_list` | Lista de serviços (checkboxes ou texto); só se booking/both |
| 7 | `services_add` | Adicionar serviços extras via texto |
| 8 | `schedule_days` | Dias da semana que atende (checkboxes); só se booking/both |
| 9 | `schedule_time` | Faixa de horário (ex.: 08:00 às 18:00) |
| 10 | `schedule_breaks` | Pausas no horário (opcional) |
| 11 | `schedule_interval` | Intervalo entre atendimentos (15, 30, 45, 60 min) |
| 12 | `schedule_interval_custom` | Intervalo personalizado |
| 13 | `services_duration` | Duração de cada serviço (opcional) |
| 14 | `services_pricing` | Valores (R$) de cada serviço ou pular |
| 15 | `sequence_booking_offer` | Permite vários serviços na mesma visita? (sim/não); só se booking/both |
| 16 | `sequence_services_select` | Quais serviços podem ser combinados em sequência (checkboxes); só se allow_sequence_booking |
| 17 | `staff_mode` | Só eu atendo ou eu e outros colaboradores |
| 18 | `owner_attends` | Dono também atende ou só colaboradores |
| 19 | `staff_list` | Nome(s) dos colaboradores |
| 20 | `staff_list_more` / `staff_list_one_more` | Adicionar mais colaboradores |
| 21 | `staff_schedule_mode` | Agenda do colaborador: mesmo do estabelecimento ou horário próprio |
| 22 | `staff_schedule_days` | Dias em que o colaborador atende |
| 23 | `staff_schedule_time` | Faixa de horário do colaborador |
| 24 | `staff_schedule_interval` | Intervalo entre atendimentos do colaborador |
| 25 | `staff_schedule_interval_custom` | Intervalo personalizado do colaborador |
| 26 | `quote_variables` | Variáveis para orçamento (ex.: medidas, quantidade); só se quote/both |
| 27 | `location_mode` | Endereço fixo ou atende no local do cliente |
| 28 | `address` | Endereço do estabelecimento (CEP, logradouro, etc.); só se fixed |
| 29 | `service_area` | Região de atendimento; só se mobile |
| 30 | `policies` | Política de cancelamento ou sinal |
| 31 | `tone_of_voice` | Tom: Formal, Amigável, Profissional ou Engraçado |
| 32 | `handoff_mode` | Quando passar para humano: Sempre, Condicional ou Automático |
| 33 | `holidays_offer` | Atende em feriados? (opcional); só se booking/both |
| 34 | `holidays_select` | Quais feriados atende |
| 35 | `closure_offer` | Período de férias/fechamento planejado? (opcional) |
| 36 | `closure_dates` | Datas do fechamento |
| 37 | `closure_more` | Adicionar mais períodos de fechamento |
| 38 | `faq_offer` | Cadastrar perguntas frequentes? (opcional) |
| 39 | `faq_question` | Pergunta e resposta FAQ |
| 40 | `faq_more` | Adicionar mais FAQs |
| 41 | `summary` | Resumo completo e confirmação |
| 42 | `summary_edit` | Edição inline de itens do resumo |
| 43 | `signup_request` | Solicitar cadastro (email/senha) |
| 44 | `signup_email` | Coletar email |
| 45 | `signup_password` | Coletar senha |
| 46 | `signup_confirm_password` | Confirmar senha |
| 47 | `completed` | Onboarding completo; migração para tenant |

### ✅ Funcionalidades Especiais

1. **Placeholder Animado**
   - Rotaciona entre exemplos de negócios
   - Para quando o usuário começa a digitar
   - Estilo ChatGPT

2. **Botões de Ação Clicáveis**
   - Opções aparecem como botões abaixo das mensagens do assistente
   - Implementado em `ChatMessage` e `ChatThread`

3. **Extração Inteligente**
   - IA analisa mensagens longas e extrai múltiplos campos
   - Fallback quando OpenAI não está disponível
   - Identifica contexto automaticamente

## ⚠️ Problemas Conhecidos

### ✅ CORS Error (RESOLVIDO)

**Erro original:**
```
Access to fetch at 'https://cwqguqkhwtcuwhkzsqvz.supabase.co/functions/v1/onboarding-chat' 
from origin 'http://localhost:3001' has been blocked by CORS policy: 
Response to preflight request doesn't pass access control check: 
It does not have HTTP ok status.
```

**Solução implementada:**
- ✅ Criada API route no Next.js (`src/app/api/onboarding/route.ts`)
- ✅ Frontend agora chama `/api/onboarding` (mesmo domínio, sem CORS)
- ✅ API route faz proxy para Edge Function do Supabase
- ✅ CORS resolvido porque requisição é server-side

**Arquivos criados:**
- `src/app/api/onboarding/route.ts` - API route proxy
- `src/lib/onboarding/api.ts` - Atualizado para usar API route

## 📝 Próximos Passos

### ✅ CORS Resolvido
- API route criada como proxy
- Frontend atualizado para usar API route
- Testar se está funcionando corretamente

### ✅ Implementações Concluídas

1. **Migração de Dados após Cadastro** ✅
   - ✅ Função `migrateOnboardingToTenant()` implementada
   - ✅ Cria usuário no Supabase Auth usando Admin API
   - ✅ Cria `tenant` com slug único
   - ✅ Cria `tenant_user` com role 'owner'
   - ✅ Cria `tenant_settings` com dados coletados
   - ✅ Busca `blueprint` baseado no domínio ou cria flow padrão
   - ✅ Cria `flow` baseado em blueprint ou dados coletados
   - ✅ Cria `variables` baseadas em `dynamic_variables`
   - ✅ Rollback automático em caso de erro

2. **Processamento de Steps Específicos** ✅
   - ✅ `collect_free_text` - Extração com IA de múltiplos campos
   - ✅ `business_type`, `business_name` - Identificação do negócio
   - ✅ `context` - Processa seleção de contexto (agendamento/orçamento/ambos)
   - ✅ `services_list`, `services_add` - Lista e adição de serviços
   - ✅ `schedule_days` - Seleção de dias da semana (checkboxes ou personalizado)
   - ✅ `schedule_time` - Extrai horários (ex.: "9h às 18h")
   - ✅ `schedule_breaks` - Pausas no horário
   - ✅ `schedule_interval`, `schedule_interval_custom` - Intervalo entre atendimentos
   - ✅ `services_duration` - Duração por serviço
   - ✅ `services_pricing` - Valores por serviço ou pular
   - ✅ `sequence_booking_offer` - Permite sequência de serviços
   - ✅ `sequence_services_select` - Serviços que podem ser combinados (checkboxes)
   - ✅ `staff_mode`, `owner_attends` - Modo de equipe
   - ✅ `staff_list`, `staff_list_more`, `staff_list_one_more` - Cadastro de colaboradores
   - ✅ `staff_schedule_*` - Agenda individual de cada colaborador
   - ✅ `location_mode`, `address`, `service_area` - Localização
   - ✅ `policies` - Políticas de cancelamento/sinal
   - ✅ `tone_of_voice` - Tom (formal/friendly/professional/funny)
   - ✅ `handoff_mode` - Modo de decisão (always/conditional/never)
   - ✅ `holidays_offer`, `holidays_select` - Feriados
   - ✅ `closure_offer`, `closure_dates`, `closure_more` - Períodos de fechamento
   - ✅ `faq_offer`, `faq_question`, `faq_more` - FAQ
   - ✅ `quote_variables` - Variáveis para orçamento
   - ✅ `summary`, `summary_edit` - Resumo e edição
   - ✅ `signup_request`, `signup_email`, `signup_password`, `signup_confirm_password` - Cadastro

### 🟡 Implementações Pendentes

1. **Autenticação Google OAuth**
   - Integrar Google OAuth no fluxo de signup
   - Permitir cadastro via Google durante onboarding

4. **Validação e Refinamento**
   - Melhorar prompts da OpenAI para extração mais precisa
   - Adicionar validação de dados coletados
   - Melhorar fallback quando OpenAI não está disponível

5. **Redirecionamento após Cadastro**
   - Implementar redirecionamento para `/app/flow-editor`
   - Criar página de flow editor (básica)

### 🟢 Melhorias Futuras

1. **Editor Visual de Fluxos**
   - Implementar React Flow
   - Drag and drop de nós
   - Conexões entre nós
   - Editor de propriedades
   - Simulador de fluxo

2. **Integração WhatsApp**
   - Configurar Twilio sandbox
   - Implementar webhook handler
   - Integrar com flow engine

3. **Chat Próprio**
   - Criar componente `PublicChat`
   - Implementar geração de links únicos
   - Página de compartilhamento com QR Code

4. **Configuração de IA pelo Cliente**
   - Interface para configurar API keys
   - Criptografia de chaves
   - Links para obter keys
   - Cliente unificado de IA

## 📁 Arquivos Criados/Modificados

### Frontend
- `src/app/page.tsx` - Landing page com onboarding
- `src/app/layout.tsx` - Root layout com ThemeProvider
- `src/app/api/onboarding/route.ts` - API route proxy para Edge Function (resolve CORS)
- `src/components/shared/ChatShell.tsx` - Layout do chat
- `src/components/shared/ChatThread.tsx` - Thread de mensagens
- `src/components/shared/ChatMessage.tsx` - Bubble de mensagem
- `src/components/shared/ChatComposer.tsx` - Input do chat
- `src/components/shared/TypingPlaceholder.tsx` - Placeholder animado
- `src/components/onboarding/LandingChat.tsx` - Componente principal
- `src/lib/onboarding/session.ts` - Gerenciamento de sessão
- `src/lib/onboarding/api.ts` - Cliente API para Edge Function
- `src/types/business-model.ts` - Tipos do Business Model
- `src/types/onboarding.ts` - Tipos do onboarding
- `src/hooks/useTypingPlaceholder.ts` - Hook para placeholder animado

### Backend
- `supabase/functions/onboarding-chat/index.ts` - Edge Function principal (versão 11 - com migração e steps específicos)
- `supabase/functions/onboarding-chat/extractors.ts` - Funções de extração
- `supabase/functions/onboarding-chat/flow-manager.ts` - Gerenciador de fluxo
- `supabase/functions/onboarding-chat/migrate.ts` - Função de migração de dados (referência)
- `supabase/migrations/001_initial_schema.sql` - Schema inicial
- `supabase/migrations/002_rls_policies.sql` - Políticas RLS
- `supabase/migrations/003_onboarding_sessions.sql` - Tabelas de onboarding
- `supabase/migrations/004_onboarding_rls.sql` - RLS para onboarding

### Configuração
- `package.json` - Dependências do projeto
- `tsconfig.json` - Configuração TypeScript
- `tailwind.config.js` - Configuração Tailwind
- `src/styles/globals.css` - Estilos globais
- `.env.local` - Variáveis de ambiente

## 🔧 Configurações Necessárias

### Variáveis de Ambiente
- `NEXT_PUBLIC_SUPABASE_URL` - URL do projeto Supabase
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Chave anônima do Supabase
- `OPENAI_API_KEY` - Chave da OpenAI (configurada como secret no Supabase)

### Secrets do Supabase
- `OPENAI_API_KEY` - Chave da API OpenAI para extração inteligente

## 📊 Status Geral

- ✅ **Estrutura base**: 100% completo
- ✅ **Componentes UI**: 100% completo
- ✅ **Onboarding inteligente**: 100% completo (todos os steps implementados)
- ✅ **CORS**: 100% resolvido (API route proxy implementada)
- ✅ **Migração de dados**: 100% implementado
- ✅ **Processamento de steps específicos**: 100% implementado
- 🔴 **Google OAuth**: 0% implementado
- 🔴 **Flow Editor**: 0% implementado
- 🔴 **Integração WhatsApp**: 0% implementado

## 🎯 Prioridades

1. ✅ **ALTA**: Testar se API route proxy está funcionando
2. ✅ **ALTA**: Implementar migração de dados após cadastro
3. ✅ **ALTA**: Processar steps específicos (schedule, context, tone, etc.)
4. **ALTA**: Criar página básica de flow editor e redirecionamento após cadastro
5. **MÉDIA**: Google OAuth
6. **BAIXA**: Melhorias e refinamentos
