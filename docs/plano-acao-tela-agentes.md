# Plano de ação: Tela de Agentes (dados reais)

Objetivo: implementar toda a funcionalidade descrita em `docs/tela-agentes.md` por etapas, **sem dados mockados** — persistência em banco (Supabase) desde o início.

**Premissa de dados:** 1 tenant = 1 cliente; N agentes por tenant. Agente = unidade de atendimento (fluxo + config + canal WhatsApp). Tudo operacional (agenda, conversas, config) escopado por agente.

---

## Decisões consolidadas (arquitetura e produto)

Estas decisões foram fechadas antes da implementação; o plano e as fases seguem-nas.

| # | Tema | Decisão |
|---|------|--------|
| 1 | **tenant_setting vs agent_setting** | `tenant_setting` vira apenas defaults/conta (billing, owner prefs). **Tudo** operacional (tone, handoff_mode, business_config) fica em `agent_setting`. Na migração: copiar campos operacionais de `tenant_setting` → `agent_setting` do agente default do tenant. APIs param de ler `tenant_setting` para coisas operacionais. |
| 2 | **Rota WhatsApp** | Unificar no detalhe do agente: `/app/agentes/[agentId]` com aba **Canais** (e sub-rota ou query para WhatsApp, ex. `?tab=canais&channel=whatsapp` ou `/app/agentes/[agentId]/canais/whatsapp`). Sidebar: "Agente" → `/app/agentes/{activeAgentId}`; "Agentes" (hub) → `/app/agentes`. |
| 3 | **Variáveis de fluxo** | Variáveis são por **flow_id** (não por tenant nem só por agente). Tabela `variable` ganha `flow_id` (FK) + índice por `(flow_id, key)`. Migração: associar variables existentes ao flow do agent default. |
| 4 | **Runtime (Edge Function)** | Runtime recebe `agent_id` (ou `flow_id`) e **carrega flow + agent_setting + channels do banco** no backend. O app **não** envia context montado. Inbound WhatsApp e simulador chamam a mesma Edge Function; ela resolve agente e carrega tudo do DB. |
| 5 | **Deploy e migrations** | **Aplicar migrations e deploy de Edge Functions: somente via Supabase CLI.** MCP do Supabase: uso para consultas, leitura de estado, gerar tipos, checagens e ajudar a escrever migration — **não** para aplicar em produção. |
| 6 | **conversation e channel** | Adicionar `agent_id` em `conversation`, `channel` (e onde fizer sentido: messages, etc.). Manter `tenant_id` para relatórios globais. Migração: criar agent default e setar `agent_id` nos registros existentes. |
| 7 | **Ordem Fase 0** | Dentro da Fase 0, prioridade: (1) agent + RLS, (2) migrar flow (agent default + flow.agent_id), (3) agent_setting (mover operacional), (4) agent_channel_whatsapp, (5) variable por flow_id, (6) conversation/channel/appointment com agent_id. |

---

## Fase 0 — Modelo de dados e migrações

Garantir que o banco reflita o conceito "agente" e que o app atual (que hoje assume 1 tenant por usuário) possa evoluir para "agente ativo".

| # | Etapa | Descrição | Critério de aceite |
|---|--------|-----------|--------------------|
| 0.1 | **Criar tabela `agent`** | `id` (uuid), `tenant_id` (FK), `name`, `business_type`, `channel_primary` ('whatsapp'\|'web'), `status` ('draft'\|'active'), `created_at`, `updated_at`. RLS: usuário só acessa agentes do(s) tenant(s) que pertence. | Migration aplicada; RLS testado. |
| 0.2 | **Migrar fluxo para agente** | **Regra única:** sempre 1 agent inicial por tenant; migrar o flow existente para esse agent. Criar um `agent` por tenant a partir dos dados atuais (tenant + flow), associar `flow.agent_id` ao novo agent e tornar `flow.agent_id` obrigatório. Não manter flow “solto” por tenant — tudo sempre é agente. Simplifica runtime e evita `if (agent_id ?? tenant_id)` em todo o código. | Cada tenant tem ao menos um agent; todo flow tem agent_id; nenhum flow órfão por tenant. |
| 0.3 | **Configuração por agente** | Criar `agent_setting` (agent_id, tone, handoff_mode, business_config JSON). **Regra:** `tenant_setting` fica só para conta/defaults; tudo operacional (tone, handoff, business_config) em `agent_setting`. Na migração: copiar campos operacionais de `tenant_setting` → `agent_setting` do agent default. | Tom, handoff e business_config leitura/escrita por agent_id; APIs não usam tenant_setting para runtime. |
| 0.4 | **Canal WhatsApp por agente** | Criar tabela `agent_channel_whatsapp` (agent_id, provider 'twilio'\|'custom', status, phone_number, twilio_account_sid_encrypted, twilio_auth_token_encrypted, messaging_service_sid, webhook_url, last_healthcheck_at, last_error, custom_note_accepted_risk). Credenciais sensíveis apenas server-side e criptografadas. | Dados de conexão WhatsApp persistidos por agente; nunca enviar token em claro ao client. |
| 0.5 | **Escopar por agente: variable, conversation, channel, appointment** | **variable:** adicionar `flow_id` (FK); variáveis passam a ser por fluxo. Migração: associar variables existentes ao flow do agent default. **conversation, channel:** adicionar `agent_id` (obrigatório para operação); manter `tenant_id` para relatórios. **appointment:** adicionar `agent_id`. Migração: agent default por tenant e setar agent_id nos registros existentes. | Agenda, simulador e runtime filtram por agent_id; variable por flow_id; sem dados órfãos. |

**Entregável Fase 0:** Schema pronto para múltiplos agentes por tenant; migração dos dados atuais (1 flow/tenant → 1 agent + flow.agent_id).

**✅ Fase 0 concluída.** Migration `006_agent_model.sql` criada. **É obrigatório aplicar no banco:** sem isso a página de agentes e o dashboard falham com "Could not find the table 'public.agent' in the schema cache".

**Como aplicar a migração (Supabase CLI):**
```bash
supabase db push
```
Ou, em ambiente linkado: `supabase migration up`. Depois de aplicar, o tenant passa a ter ao menos um agente (criado pela migração) e o agente ativo é carregado automaticamente.

---

## Fase 1 — Infraestrutura “Agente ativo” (contexto + header)

| # | Etapa | Descrição | Critério de aceite |
|---|--------|-----------|--------------------|
| 1.1 | **API: listar agentes do tenant** | `GET /api/app/agents`: retorna lista de agentes do tenant do usuário (id, name, business_type, status, channel_primary, updated_at, servicesCount, upcomingBookingsCount, whatsapp status). Sem mock; ler de `agent` + contagens reais. | Resposta com array de agentes; 401/404 quando não autenticado ou sem tenant. |
| 1.2 | **Persistência do agente ativo (client)** | `src/lib/agents/active-agent.ts`: get/set/clear do `agent_id` ativo em `localStorage` (chave única definida). | Funções SSR-safe; leitura/escrita apenas no client. |
| 1.3 | **AgentContext com dados reais** | `AgentProvider`: busca agentes via `GET /api/app/agents`; `activeAgentId` inicializado a partir de localStorage ou primeiro agente da lista; `setActiveAgentId` persiste em localStorage; `notifyAgentConfigUpdated(reason?)` e estado `lastConfigUpdateAt` / `lastConfigUpdateReason`. Sem referência a mock. | Contexto disponível em /app; troca de agente atualiza header e persistência. |
| 1.4 | **AgentSwitcher no header** | Dropdown no AppShell: nome do agente ativo, badge Ativo/Rascunho, lista de agentes (nome, businessType, status), item “Gerenciar agentes” → `/app/agentes`, botão “+ Novo agente” → `/onboarding?newAgent=1`. Usar `useAgentContext()`. | Header mostra agente ativo e permite trocar; “Novo agente” leva ao onboarding. |
| 1.5 | **Layout /app com AgentProvider e SimulatorDock** | Envolver o conteúdo do layout da área cliente com `AgentProvider`. Incluir `AgentSwitcher` no header (AppShell) e **SimulatorDock fixo no canto inferior direito da tela** (flutuante), fora do fluxo da página. O simulador fica sempre disponível como pill/drawer flutuante; não substituir o AppShell existente. | Todas as rotas /app têm agente ativo e simulador flutuante visível; dock não desmonta ao navegar. |

**Entregável Fase 1:** Usuário vê e troca o agente ativo no header; simulador em dock sempre presente; dados vindos da API.

**✅ Fase 1 concluída.** API `GET /api/app/agents`, `src/lib/agents/active-agent.ts`, `AgentProvider`, `AgentSwitcher` no header, `SimulatorDock` (estrutura), layout com `AgentProvider` e dock. Rota `/app/agentes` será implementada na Fase 4.

---

## Fase 2 — SimulatorDock e “alterações prontas”

| # | Etapa | Descrição | Critério de aceite |
|---|--------|-----------|--------------------|
| 2.1 | **SimulatorDock: UI e estado de alterações** | **Pill flutuante no canto inferior direito da tela** (“Simulador”) + badge “Alterações” quando `lastConfigUpdateAt > lastAppliedAt`. Drawer com título “Simulador • {nome do agente ativo}”, botão “Recarregar” (marca lastAppliedAt), texto “Alterações prontas” com reason quando houver. | Simulador sempre acessível como dock flutuante; badge e “Recarregar” conforme alterações. |
| 2.2 | **Integrar simulador existente no dock** | Substituir o placeholder do drawer pelo componente de simulador já usado em `/app/simulator`, alimentado pelo `activeAgentId` (ou activeAgent). Chamadas a `POST /api/app/simulator` usam o agente ativo. | Ao abrir o dock, o usuário consegue conversar no simulador com o agente ativo; ao “Recarregar”, reaplica config se necessário. |

**Entregável Fase 2:**  
**✅ Fase 2 concluída.** SimulatorDock com badge, "Alterações prontas", Recarregar e simulador real (SimulatorAppClient em features com onClose opcional).

**Entregável Fase 2 (original):** Dock funcional com simulador real e fluxo “alterações → Recarregar”.

---

## Fase 3 — Páginas existentes escopadas ao agente ativo

| # | Etapa | Descrição | Critério de aceite |
|---|--------|-----------|--------------------|
| 3.1 | **Bootstrap / APIs por agente** | **Frontend:** envia apenas `agent_id` (query ou header); nunca envia `tenant_id`. **Backend:** resolve tenant pelo auth e valida que `agent_id` pertence ao tenant; retorna dados do agente (tenant + agent + agent_setting + flow). **Runtime (Edge Function):** recebe `agent_id` (ou `flow_id`) e carrega flow + agent_setting + channels do banco; app não envia context montado (decisão consolidada #4). APIs de agenda, settings e simulador: recebem `agent_id`, validam e filtram por agente. | Dashboard, Agenda, Config e Simulador operam sobre agente ativo; runtime carrega tudo do DB. |
| 3.2 | **Dashboard/Agenda/Config leem activeAgent** | Garantir que as páginas usem `useAgentContext().activeAgent` (ou activeAgentId) para título, métricas e chamadas de API. Se não houver agente ativo, exibir estado “Selecione um agente” ou redirecionar para /app/agentes. | Conteúdo contextual ao agente selecionado; sem dados de outro agente. |

**Entregável Fase 3:** Toda a área /app opera sobre o agente ativo.

**✅ Fase 3 concluída.** Bootstrap e APIs aceitam `agent_id` (query ou body); simulador, settings e appointments filtram por agente. Dashboard, Agenda e Config usam `useAgentContext().activeAgentId`; estado "Selecione um agente" quando não há agente ativo. Dashboard virou client (`DashboardClient`) que busca bootstrap e appointments por agente.

---

## Fase 4 — Listagem de agentes e criação

| # | Etapa | Descrição | Critério de aceite |
|---|--------|-----------|--------------------|
| 4.1 | **Página `/app/agentes`** | Listagem em cards (nome, businessType, status, canal, servicesCount, upcomingBookingsCount); busca por nome/tipo (client-side ou API); botão “Criar agente” abre Dialog com: (1) “Criar com onboarding (recomendado)” → `/onboarding?newAgent=1`, (2) “Criar em branco (avançado)” → chama API para criar agent draft e redireciona para `/app/agentes/[id]?tab=fluxo`. Dados da lista via `GET /api/app/agents`. | Lista só agentes do tenant; criar em branco persiste novo agent no banco e redireciona. |
| 4.2 | **API: criar agente (draft)** | `POST /api/app/agents`: body opcional (name, business_type); cria `agent` com status draft, `agent_setting` padrão e flow vazio ou template. Retorna agent (id, name, …). | Novo agente aparece na listagem e pode ser escolhido como ativo. |
| 4.3 | **Onboarding criando agente** | Ao concluir onboarding com `newAgent=1`, criar um novo `agent` (e flow + agent_setting) em vez de apenas atualizar o tenant. Associar o flow e config gerados ao novo agent; redirecionar para /app com o novo agente como ativo (ou para /app/agentes). | Um agente novo é criado e vinculado ao tenant; fluxo e config pertencem ao agente. |

**Entregável Fase 4:** Hub de agentes com lista real e dois caminhos de criação (onboarding e em branco).

**✅ Fase 4 concluída (4.1 e 4.2).** Header: AgentSwitcher sempre visível (Carregando… / Agentes / Nenhum agente / nome do ativo). Sidebar: link "Agentes" → `/app/agentes`. Página `/app/agentes`: listagem em cards (nome, status, serviços, agendamentos), busca client-side, botão "Criar agente" abre Sheet com "Criar com onboarding" e "Criar em branco". `POST /api/app/agents` cria agent draft + agent_setting + flow mínimo; `GET /api/app/agents/[id]` para detalhe. Página `/app/agentes/[agentId]` criada (placeholder para Fase 5). **4.3 (onboarding criando agente)** fica para implementação ao ajustar o fluxo de conclusão do onboarding.

---

## Fase 5 — Detalhe do agente (abas Básico / Fluxo / Simulador / Config)

| # | Etapa | Descrição | Critério de aceite |
|---|--------|-----------|--------------------|
| 5.1 | **Rota e layout do detalhe** | `src/app/(dashboard)/app/agentes/[agentId]/page.tsx`: carregar agente por id (API `GET /api/app/agents/[id]` ou incluir na listagem). Se não existir ou não pertencer ao tenant, exibir “Agente não encontrado”. Header: nome, badge status, botões “Abrir simulador” e “Publicar”. **Tabs:** Básico | Fluxo (Avançado) | Simulador | **Canais** | Configurações. WhatsApp fica na aba Canais (ou sub-rota `[agentId]/canais/whatsapp`). | Acesso por URL; abas navegáveis; dados do agente reais. |
| 5.2 | **Aba Básico: AgentBasicEditor** | Aba “Básico” com componente que edita nome e lista de serviços (e futuramente agenda e mensagens). Dados iniciais do `agent` + `agent_setting.business_config` (serviços). Salvar via `PATCH /api/app/agents/[id]` ou endpoint específico de “basic config”; ao salvar, chamar `notifyAgentConfigUpdated`. Sem mock: serviços vêm e vão para business_config (ou estrutura definida no schema). | Edição de nome e serviços persiste no banco e dispara “alterações prontas” no dock. |
| 5.3 | **Aba Agenda e Mensagens (básico)** | Na mesma aba Básico, sub-abas ou seções Agenda e Mensagens: Agenda = CRUD de dias/horário/intervalo (espelho do onboarding), persistido em agent_setting.business_config; Mensagens = textos básicos (saudação, fallback) com preview WhatsApp (placeholder ou real). | Dados lidos/gravados em agent_setting; sem mock. |
| 5.4 | **Aba Simulador** | Conteúdo: embed ou link para o simulador usando o agente atual (agentId da URL). Pode ser iframe da rota de simulador com query `?agentId=…` ou o mesmo componente do SimulatorDock. | Simulador na aba usa o agente da página. |
| 5.5 | **Aba Configurações** | Tom e handoff do agente (agent_setting). Reutilizar UI existente de tom/handoff; salvar em agent_setting; `notifyAgentConfigUpdated` ao salvar. | Tom e handoff por agente persistidos e refletidos no fluxo/simulador. |

**Entregável Fase 5:** Detalhe do agente com quatro abas funcionando com dados reais.

**✅ Fase 5 em progresso.** 5.1: Layout do detalhe com header (nome, badge, Abrir simulador, Publicar) e abas (Básico, Fluxo, Simulador, Canais, Configurações) via `Tabs` + query `?tab=`. **Simulador:** além do botão “Abrir simulador” na página, o **simulador fica sempre disponível como dock flutuante no canto inferior direito** em todas as páginas /app (SimulatorDock no layout). 5.2 e 5.3: Aba Básico com `AgentBasicEditor` completo: **Nome**, **Serviços**, **Agenda** (dias, horário início/fim, intervalo) e **Mensagens** (saudação, fallback); todas as seções exibidas (incl. opcionais vazias) para manutenção; salvamento via PATCH agents/[id] e PATCH settings (business_config); `notifyAgentConfigUpdated` ao salvar. 5.4: Aba Simulador com embed do SimulatorAppClient e `agentIdOverride`. 5.5: Aba Configurações com tom e handoff.

---

## Fase 6 — Canal WhatsApp (página e backend)

WhatsApp fica **dentro do detalhe do agente** (aba Canais ou sub-rota), não em página separada. Ver decisão consolidada #2.

| # | Etapa | Descrição | Critério de aceite |
|---|--------|-----------|--------------------|
| 6.1 | **Aba Canais no detalhe do agente** | No detalhe `/app/agentes/[agentId]`: aba **Canais** (ou sub-rota `[agentId]/canais/whatsapp`) com configuração WhatsApp **desse agente**. Status (Desconectado/Conectado/…), abas Twilio e “Meu número (avançado)”. Twilio: Account SID, Auth Token, Messaging Service SID (opcional); “Salvar credenciais” persiste criptografado em `agent_channel_whatsapp`; webhook URL (read-only) e “Copiar”; Validar/Enviar teste (placeholder ok). Custom: alerta de risco e placeholder. Ao salvar, `notifyAgentConfigUpdated`. | UI no contexto do agente; credenciais nunca em claro no client. |
| 6.2 | **API: salvar/ler config WhatsApp** | `GET /api/app/agents/[id]/channel/whatsapp`: retorna status, provider, webhook_url, phone_number, last_healthcheck (sem tokens). `PATCH` ou `POST`: recebe credenciais Twilio no body; backend criptografa e grava em `agent_channel_whatsapp`; gera webhook_url se necessário. | Leitura e escrita seguras; resposta sem dados sensíveis. |
| 6.3 | **Navegação: Agente e Agentes** | Sidebar: “Agente” → `/app/agentes/{activeAgentId}` (detalhe do agente ativo); “Agentes” → `/app/agentes` (hub). Canais/WhatsApp acessados pela aba Canais do detalhe. “Configurações” = apenas sistema/conta. | Usuário acessa agente ativo e, no detalhe, aba Canais para WhatsApp. |

**Entregável Fase 6:** Configuração WhatsApp por agente persistida e acessível pela navegação.

**✅ Fase 6 em progresso.** 6.2: `GET /api/app/agents/[id]/channel/whatsapp` (status, provider, phone_number, webhook_url, last_healthcheck_at, last_error; sem tokens). `PATCH` grava credenciais Twilio em `agent_channel_whatsapp`; gera webhook_url quando NEXT_PUBLIC_APP_URL ou VERCEL_URL está definido. 6.1: Aba Canais no detalhe do agente com `AgentChannelWhatsApp` (status, formulário Twilio, webhook read-only + Copiar, Salvar credenciais, `notifyAgentConfigUpdated` ao salvar). Validar/Enviar teste e opção "Meu número (avançado)" ficam como placeholder. 6.3 (Sidebar Agente/Agentes) pode ser feita na Fase 8.

---

## Fase 7 — Construtor de fluxo (Canvas + Inspector + Preview)

**Salvamento granular (recomendado):** Evitar salvar o fluxo inteiro a cada edição. Preferir **PATCH por nó** (ex.: `PATCH /api/app/agents/[id]/flow/nodes/[nodeId]`) ou **autosave com debounce**. Facilita versionamento, rollback e logs futuros. Não é obrigatório implementar na primeira versão; deixar a API e o front preparados para isso.

| # | Etapa | Descrição | Critério de aceite |
|---|--------|-----------|--------------------|
| 7.1 | **API: ler/gravar definição do fluxo** | `GET /api/app/agents/[id]/flow`: retorna nós do fluxo a partir de `flow.definition`/`flow.layout`. Gravação: preferir endpoint por nó (`PATCH …/flow/nodes/[nodeId]`) ou payload parcial; se for “fluxo inteiro”, usar debounce no client. Escopo por agent_id. | Fluxo do agente carregado e salvo; sem mock; desenho não impede salvamento granular depois. |
| 7.2 | **Componente WhatsAppPreview** | `WhatsAppPreview`: recebe message e ui (kind, options, optionsFrom); exibe preview estilo balão WhatsApp. Reutilizável nos nós e no editor. | Usado em nós message/question e no inspector. |
| 7.3 | **AgentFlowBuilder com dados reais** | Canvas: lista de nós vinda da API (flow do agente). Layout com cards posicionados (position); biblioteca de blocos à esquerda (opcional); inspector à direita (desktop) ou em Sheet (mobile). Nós message/question exibem WhatsAppPreview. Ao editar e “Salvar” no inspector, chamar API de atualização (por nó ou debounced) e `notifyAgentConfigUpdated`. | Fluxo carregado do banco; edição persiste e dispara aviso no dock. |
| 7.4 | **FlowInspector** | Por tipo de nó: message/question = editar texto e tipo de UI (buttons/list/text) + preview WhatsApp; ai = editor de prompt (textarea) e preview; condition = editar branches/labels. Bloco “Compatibilidade WhatsApp” sempre visível. Botão Salvar envia alteração do nó para a API (idealmente PATCH do nó) e atualiza o fluxo. | Inspector funcional para os tipos descritos no doc. |
| 7.5 | **Aviso “Modo avançado”** | Na aba “Fluxo (Avançado)”, Alert fixo informando que alterações ali afetam o atendimento e que é recomendado testar no simulador. | Aviso sempre visível na aba Fluxo. |

**Entregável Fase 7:** Construtor de fluxo operando sobre flow persistido; preview WhatsApp e inspector sem mock.

**✅ Fase 7 concluída.** 7.1: API `GET/PATCH /api/app/agents/[id]/flow`. 7.2: `WhatsAppPreview` em `src/features/flow/components/WhatsAppPreview.tsx` (message + ui kind/options, estilo balão). 7.3: `AgentFlowBuilder` em `src/features/flow/components/AgentFlowBuilder.tsx` — canvas com nós arrastáveis, linhas SVG, Salvar posições ao soltar; inspector à direita (desktop) ou Sheet (mobile); `notifyAgentConfigUpdated` ao persistir. 7.4: `FlowInspector` em `src/features/flow/components/FlowInspector.tsx` — por tipo: message/send/question = texto, tipo de UI (buttons/list/text), opções, preview WhatsApp; ai = prompt (textarea); condition = placeholder; bloco "Compatibilidade WhatsApp"; Botão Salvar chama PATCH flow. 7.5: Aviso "Modo avançado" na aba Fluxo. Tipos em `src/features/flow/types.ts`; exports em `src/features/flow/index.ts`.

---

## Fase 8 — Ajustes finais e consistência

| # | Etapa | Descrição | Critério de aceite |
|---|--------|-----------|--------------------|
| 8.1 | **Sidebar: link Agentes e Agente** | Sidebar: “Agentes” → `/app/agentes`; “Agente” → `/app/agentes/{activeAgentId}` (detalhe com tabs Básico/Fluxo/Simulador/Canais/Config). Configurações = só conta/sistema. | Navegação alinhada às decisões consolidadas. |
| 8.2 | **Estado vazio e erros** | Sem inventar dados: listagem vazia = “Nenhum agente”; agente sem fluxo = “Nenhum nó” ou convite a criar; canal WhatsApp sem config = “Desconectado”. Tratamento de 404/500 nas APIs com mensagens claras. | Nenhum dado fictício; mensagens consistentes. |
| 8.3 | **Publicar agente** | Botão “Publicar” no detalhe: altera status do agent para `active`. API `PATCH /api/app/agents/[id]` com `status: 'active'`. **Regra de produto:** **draft** = simulador funciona; WhatsApp real não recebe mensagens. **active** = WhatsApp pode receber mensagens reais. Backend (webhook/integração) deve respeitar esse status para evitar acidentes e deixar a comunicação com o cliente clara. | Status draft → active persistido; comportamento draft vs active documentado e aplicado no canal real. |

**Entregável Fase 8:** Navegação completa, estados vazios tratados e publicação de agente.

**✅ Fase 8 concluída.** 8.1: Sidebar com "Agente" → `/app/agentes/{activeAgentId}` (detalhe do ativo) e "Agentes" → `/app/agentes` (hub). 8.2: Listagem já exibe "Nenhum agente" quando vazia; detalhe exibe "Agente não encontrado" em 404. 8.3: Botão Publicar já existia (PATCH status active).

---

## Ordem sugerida de execução

1. **Fase 0** — Base de dados (obrigatória antes de tirar mocks).
2. **Fase 1** — Contexto, header e dock (usuário consegue escolher agente e ver o dock).
3. **Fase 2** — SimulatorDock com simulador real e “Recarregar”.
4. **Fase 3** — Escopar APIs e páginas ao agente ativo.
5. **Fase 4** — Listagem e criação de agentes (onboarding + em branco).
6. **Fase 5** — Detalhe do agente (abas Básico, Simulador, Config; opcionalmente Fluxo já aqui).
7. **Fase 6** — Página e API de WhatsApp por agente.
8. **Fase 7** — Canvas, inspector e persistência do fluxo.
9. **Fase 8** — Navegação, estados vazios e “Publicar”.

---

## Dependências entre fases

- **Fase 1** depende de **Fase 0** (tabela `agent` e ao menos um agent por tenant para listar).
- **Fase 2** depende de **Fase 1** (contexto e dock no layout).
- **Fase 3** depende de **Fase 0** e **1** (APIs e contexto por agente).
- **Fase 4** depende de **Fase 0** e **1** (API de listagem e criação).
- **Fase 5** depende de **Fase 4** (rota e API de detalhe).
- **Fase 6** depende de **Fase 0** (tabela WhatsApp) e **1** (agente ativo).
- **Fase 7** depende de **Fase 0** (flow por agent) e **5** (aba Fluxo).
- **Fase 8** pode ser feita em paralelo ou ao final.

---

## Referências

- Especificação completa: `docs/tela-agentes.md`
- Modelo de dados acordado: 1 tenant = cliente; N agentes por tenant; fluxo e config por agente.
- Sem mock: todos os dados vêm de APIs que leem/escrevem no Supabase.
