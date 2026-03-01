# NEVO — IMPLEMENTAÇÃO DO ASSISTENTE PESSOAL + SISTEMA DE ORÇAMENTO
## Branch: feature/assistente-pessoal-orcamento (ou feature/connect-whatsapp)

**Estratégia para não comprometer o MVP atual e permitir rollback:** ver **docs/estrategia-implementacao-roadmap-sem-comprometer-mvp.md** (feature flag, migrações só aditivas, código isolado, procedimento de rollback).

---

# 🎯 OBJETIVO

Expandir o Nevo para suportar:

1) Assistente pessoal via WhatsApp (modo internal)
   - Consulta de agenda
   - Consulta de contatos
   - Criação e cancelamento de agendamento
   - Consulta e geração de orçamento
   - Geração de PDF

2) Sistema de orçamento completo (modo internal)
   - Motor determinístico por serviço
   - Coleta via mensagem livre
   - Validação de slots
   - Cálculo estruturado
   - Geração de PDF
   - Persistência em request

3) Sistema de orçamento simplificado (modo external)
   - Baixa fricção
   - Estimativa por faixa
   - Conversão para agendamento
   - Persistência básica

---

# 🔐 PRINCÍPIO FUNDAMENTAL

O modo INTERNAL NUNCA pode ser ativado por comando textual.

O modo é determinado exclusivamente por:

phone_number ∈ tenant_user(role in ["owner", "admin"])

Sem exceções.

**Modelo de uso no WhatsApp:** dono e cliente **ambos** falam com o **mesmo número da empresa** (instância do agente). O dono usa o **número pessoal dele** (cadastrado em tenant_user.phone_number); o cliente usa o número dele. O webhook identifica quem enviou (from) e aplica internal ou external. Não é necessário número global do Nevo.

---

# 🏗️ ARQUITETURA GERAL

Novo conceito:

actor_type:
- owner
- admin
- agent
- client

mode:
- internal
- external

---

# 📋 VARIÁVEIS, ONBOARDING E CONVERSATION (REFERÊNCIA)

Esta seção deixa explícito: origem das variáveis de orçamento, o que é configurado no onboarding vs no app, e o que a conversation usa em runtime.

## Variáveis: orçamento interno vs externo

- **Orçamento interno (modo internal):** usa o **variables_schema** completo do `quote_service` (todas as variáveis técnicas: largura, altura, modelo, tecido, instalação, etc.). IA extrai da mensagem livre; validateSlots e calculateQuote usam esse schema.
- **Orçamento externo (modo external):** usa o **mesmo** `quote_service`, mas apenas um **subconjunto** de variáveis para baixa fricção (ex.: só largura e altura). Esse subconjunto deve estar definido no blueprint (ex.: campo `external_variable_keys` em `quote_service` ou equivalente). calculateRange usa essas variáveis; a resposta é em faixa e CTA para agendamento.
- Não existem “variáveis gerais” separadas: a fonte é sempre o `quote_service` do agente; internal = schema completo, external = subconjunto definido por serviço.

## O que vai para o onboarding

- **Já existente:** business_type, business_name, context (agendamento / orçamento / ambos), services (agendamento), schedule, staff, localização, tom, handoff, etc.
- **Para orçamento (incluir nesta entrega ou em evolução do onboarding):**
  - Lista de **serviços de orçamento** (ex.: Cortina, Persiana).
  - **Tipo de preço** por serviço (m², linear, unidade, fixo, sob consulta).
  - **Variáveis para orçamento completo** (internal): lista ou schema mínimo (ex.: quote_variables em texto ou estrutura que derive variables_schema).
  - **Variáveis para estimativa rápida** (external): poucas (ex.: largura e altura), para o cliente pedir faixa sem fricção.
- **Onde persiste:** o onboarding cria em **quote_service** apenas o **básico** por serviço: name, pricing_type, variables_schema (ou lista de variáveis que derive o schema), external_variable_keys, keywords. A **configuração detalhada de pricing_rules** (tabelas de preço, fórmulas) **não** deve ser coletada no onboarding (evita onboarding técnico demais); fica na **área logada** (/app), onde o dono edita serviços de orçamento e regras de cálculo. Documento de simulação: `docs/simulacao-onboarding-e-conversation-fabi-cortinas.md`.

**Proteção do onboarding — o que NÃO coletar:**

O onboarding **não** deve coletar como obrigatório:

- CNPJ obrigatório
- Dados fiscais obrigatórios
- Tabelas complexas de preço (pricing_rules detalhadas)
- Staff avançado (além do básico: quem atende)
- Políticas detalhadas (cancelamento, sinal, etc.)

Esses itens pertencem à **área logada** (/app). O objetivo é ativar funcionamento básico com o mínimo de fricção.

## O que vai para a conversation (turn)

- **conversation.context (JSONB):** após resolveActorByPhone, sempre salvar `mode` (internal | external) e `actor_type` (owner | admin | agent | client | unknown). O restante do context (business_name, schedule, services, etc.) segue vindo do tenant/agent como hoje.
- **Runtime de orçamento:** a Edge Function **carrega** os `quote_service` do `agent_id` quando for tratar intenção de orçamento (internal ou external). Não é obrigatório injetar o variables_schema completo no context da requisição; basta que o backend tenha os quote_services em memória para: detectar serviço (keywords/IA), validar slots (validateSlots), calcular (calculateQuote ou calculateRange), formatar resposta. Opcional: enviar no context um resumo (ex.: nomes dos serviços e keys das variáveis externas) para a IA extrair slots.

---

## Onboarding e simulador (fluxo único)

**Onboarding:** Um único fluxo linear. Não há "parte de configuração do dono" separada. Agenda e orçamento são configurados na mesma sequência conforme o `context` (agendamento / orçamento / ambos).

**Configuração do dono (phone_number):** O número do dono para ativar modo internal **não** é coletado no onboarding. Fica `tenant_user.phone_number = NULL` até o dono vincular na **área logada** (/app) após o signup.

**Simulador:** Após o onboarding, o usuário pode clicar "Simular atendimento" para testar. O simulador é um único chat que chama a mesma Edge Function do turn. Para que as intents internas (agenda, contatos) funcionem no simulador, o **payload deve incluir** `mode: "internal"` e `actor_type: "owner"` — pois quem está testando é o dono que acabou de configurar. Sem isso, o simulador roda como external (cliente) por padrão.

- [x] Landing: payload inclui mode=internal, actor_type=owner; tenant_id/agent_id após migrate
- [x] Área logada (/app/simulator): payload inclui mode=internal, actor_type=owner (quem testa é dono)
- [x] Migrate automático após signup (não espera "Acessar minha área")
- [x] deploy.ps1 lê .env.qa (além de .env, .env.local)

*(Futuro: toggle "Testar como dono" / "Testar como cliente" para alternar entre internal e external.)*

---

# FASE 1 — BASE DE SEGURANÇA E CONTEXTO

## 1.1 — Atualizar tabela tenant_user

Adicionar campos:

- phone_number (string, único por tenant)
- whatsapp_authorized (boolean, default true)

Criar índice por phone_number.

---

## 1.2 — Resolver actor no webhook

Nos arquivos:
- /api/webhooks/twilio/[agentId]
- /api/webhooks/evolution/[agentId]

Antes da IA:

resolveActorByPhone(fromNumber)

Se role in (owner, admin)
→ mode = internal

Senão
→ mode = external

Salvar em conversation.context:

{
  "mode": "internal" | "external",
  "actor_type": "owner" | "admin" | "agent" | "client" | "unknown"
}

(Usar actor_type, não actor_role. Regras: owner/admin → internal; agent/client/unknown → external.)

---

## ✅ CHECK FASE 1

- [x] phone_number adicionado (migração 20260224000000; coluna + índice único por tenant)
- [x] resolveActor implementado (src/lib/actor.ts: normalizePhoneNumber + resolveActorByPhone)
- [x] mode e actor_type salvos na conversation (Edge Function persiste em context quando recebidos no body)
- [ ] cliente não ativa modo internal (validar em teste: número não cadastrado → mode=external)
- [ ] owner ativa automaticamente (validar em teste: tenant_user.phone_number cadastrado → mode=internal)
- [x] Feature flag FEATURE_ASSISTENTE_ORCAMENTO (false = comportamento MVP; true = resolveActor + mode no payload)

---

# FASE 2 — ASSISTENTE PESSOAL (AGENDA)

## 2.1 — Intents internas (agenda)

Adicionar no conversations-turn:

- query_appointments_today
- query_appointments_tomorrow
- query_appointments_by_date
- query_appointment_by_time
- cancel_appointment
- create_appointment_internal

IA apenas classifica intenção e extrai:
- data
- horário
- nome
- serviço

---

## 2.2 — Implementações determinísticas

### query_appointments_today

Filtrar appointment por:
- tenant_id
- agent_id
- start_at >= hoje 00:00
- start_at <= hoje 23:59
Ordenar por start_at.

Resposta padrão:

📅 Hoje:
09:00 – Ana (Corte)
14:00 – Carlos (Progressiva)

---

### query_appointment_by_time

Localizar por hora aproximada.
Retornar:
- nome
- telefone
- serviço

---

### cancel_appointment

Validar existência.
Atualizar status = cancelled.
Salvar cancellation_reason.

**Implementado em:** `supabase/functions/conversations-turn/lib/internal-intents.ts`

---

## ✅ CHECK FASE 2

- [x] listar hoje
- [x] listar amanhã
- [x] buscar por horário
- [x] cancelar agendamento
- [x] buscar contato por horário (query_contact_by_appointment_time)
- [x] buscar contato por nome (query_contact_by_name)
- [x] conversation.state_json (migração 20260225000000) para simulador
- [x] simulador envia mode=internal e actor_type=owner (quem testa é o dono)
- [ ] testes no simulador
- [x] CTA "Conectar agora" / "Depois" no signup_request; fluxo completo FASE 6.5 pendente “Quer colocar o Nevo no seu WhatsApp agora?” (Conectar agora / Depois) — ver FASE 6.5

---

# FASE 3 — ESTRUTURA DO MOTOR DE ORÇAMENTO

Criar diretório:

src/lib/quote-engine/

Arquivos:

- types.ts
- validateSlots.ts
- calculateQuote.ts
- calculateRange.ts
- formatInternalQuote.ts
- formatExternalQuote.ts
- generatePdf.ts

---

## 3.1 — Estrutura do Blueprint

Criar tabela: quote_service

Campos:

- id
- agent_id
- name
- pricing_type
- variables_schema (JSONB) — variáveis para orçamento interno (completo)
- pricing_rules (JSONB)
- external_variable_keys (text[] ou JSONB, opcional) — keys do variables_schema usadas no external para estimativa em faixa (ex.: ["largura_cm", "altura_cm"])
- keywords (text[], opcional) — para detecção determinística de serviço no external
- active

pricing_type possíveis:

- fixed
- unit
- linear
- area
- area_with_minimum
- formula
- custom_manual

**Implementado em:** migração `20260225100000_quote_service_and_request.sql`; motor em `src/lib/quote-engine/`

---

## 3.2 — Atualizar tabela request

Adicionar campos:

- blueprint_id
- total_value
- currency
- calculation_result (JSONB)
- is_estimated (boolean)

**Implementado em:** migração `20260225100000_quote_service_and_request.sql`

---

## ✅ CHECK FASE 3

- [x] tabela quote_service criada (migração 20260225100000)
- [x] request atualizado (blueprint_id, total_value, currency, calculation_result, is_estimated)
- [x] pasta quote-engine criada (src/lib/quote-engine/)
- [x] interfaces tipadas (types, validateSlots, calculateQuote, calculateRange, formatInternal/External, generatePdf stub)

---

# Estratégia de Ativação Progressiva

Definir claramente as fases de valor para o dono:

- **Fase 1 — Ativar funcionamento:** booking + quote simples (estimativa em faixa) operando; PDF funcional mesmo sem timbrado.
- **Fase 2 — Profissionalizar:** branding (logo, timbrado), regras de preço avançadas na área logada.
- **Fase 3 — Otimizar:** analytics, ajustes finos, métricas de conversão.

Isso orienta decisões: não bloquear ativação por dados opcionais; oferecer upgrade no momento certo (ex.: ao gerar o primeiro PDF).

---

# FASE 4 — ORÇAMENTO INTERNAL (COMPLETO)

## 4.1 — Fluxo Internal

Mensagem livre:

"Faz orçamento de cortina 2.80 x 2.60 blackout wave instalação"

Pipeline:

1. IA extrai slots
2. validateSlots()
3. Se faltar algo → perguntar apenas o necessário
4. calculateQuote()
5. formatInternalQuote()
6. Perguntar confirmação
7. generatePdf()
8. Persistir request

**Implementado em:** `supabase/functions/conversations-turn/lib/internal-intents.ts` (intents `request_quote_internal` e `confirm_quote_pdf`), `lib/quote-engine.ts`. Motor determinístico (extractQuoteSlotsFromText); state.quote_pending para confirmação; persistência em `request` ao confirmar.

---

## 4.2 — Resposta padrão internal

📄 Orçamento — Cortina Wave
Medidas: 2.80 x 2.60
Material: Blackout
Instalação: Sim

Materiais: R$ X
Mão de obra: R$ Y

Total: R$ Z

Deseja gerar PDF?

---

## 4.3 — PDF

generatePdf.ts deve:

- **Verificar `branding.enabled`** (business_config.branding).
- Se **false** → usar **template padrão Nevo** (sem logo/timbrado; breakdown, total, validade).
- Se **true** → usar **template timbrado** (logo, razão social, CNPJ, endereço, telefone/e-mail, breakdown, total, validade).
- Salvar PDF no Supabase Storage; gerar Signed URL (7 dias, bucket privado).

**ENV (opcional):**

- `QUOTE_PDF_TEMPLATE_DEFAULT` — identificador ou path do template padrão (sem branding).
- `QUOTE_PDF_TEMPLATE_BRANDED` — identificador ou path do template com timbrado.

**Pseudo-lógica:**

```
if (business_config.branding?.enabled === true) {
  render branded template (logo_url, company_legal_name, cnpj, address, phone, email);
} else {
  render default template (apenas breakdown, total, validade, nome do negócio básico);
}
```

**Primeiro PDF sem branding:** após enviar o link, se `branding.enabled === false`, incluir mensagem de upgrade: "Quer deixar esse orçamento mais profissional com seu logo e dados da empresa? Posso configurar agora." (não bloqueia; segunda oportunidade de ativar branding.)

---

## 4.3.1 — Dados para o PDF (logo e timbrado) — opcional

Logo e timbrado são **opcionais**. Estrutura em **business_config.branding**:

- `enabled` (boolean) — se o dono escolheu personalizar (no onboarding ou depois).
- `logo_url`, `company_legal_name`, `cnpj`, `company_phone`, `company_email` — preenchidos quando enabled = true.

Coleta: **bloco condicional no onboarding** ("Quer que o PDF saia com seu logo e dados da empresa?" → Sim / Depois) ou **área logada**. Se "Depois", onboarding não coleta; branding pode ser configurado depois no app ou na oferta ao gerar o primeiro PDF.

---

## 4.4 — Branding opcional (onboarding)

- Pergunta **condicional** após configurar orçamento: "Quando eu gerar o PDF do orçamento, você quer que ele saia com seu logo e dados da empresa?" → **Sim, quero personalizar agora** / **Depois eu configuro**.
- Se "Sim": mini-fluxo com `requires_action: 'logo_upload'`, razão social, CNPJ, telefone, e-mail; persistir em **business_config.branding** (enabled: true + campos).
- Se "Depois": `branding.enabled = false`; não coletar; **não bloquear** conclusão do onboarding.

**Checklist branding opcional:**

- [x] Implementar pergunta condicional no onboarding
- [x] Persistir branding.enabled (true/false)
- [ ] Criar upload de logo (requires_action: logo_upload)
- [x] Ajustar generatePdf para suportar dois templates (default e branded)
- [x] Criar prompt de upgrade no primeiro PDF quando branding.enabled = false

---

## ✅ CHECK FASE 4

- [x] coleta livre funcionando (extractQuoteSlotsFromText em quote-engine.ts)
- [x] validação funcionando (validateQuoteSlots)
- [x] cálculo correto (calculateQuote)
- [x] PDF gerado (lib/generatePdf.ts: pdf-lib + bucket "quotes" + Signed URL 7 dias)
- [x] request persistido (tenant_id, conversation_id, slots, blueprint_id, total_value, calculation_result)
- [x] PDF funciona sem branding configurado (template padrão Nevo)
- [x] Primeiro PDF oferece upgrade de timbrado quando branding = false (mensagem na resposta)

---

# FASE 5 — ORÇAMENTO EXTERNAL (SIMPLIFICADO)

## 5.1 — Estratégia

- poucas variáveis
- retorno em faixa
- conversão para agendamento

---

## 5.2 — Fluxo

Cliente:
"Quanto fica uma cortina 2.80 x 2.60?"

Pipeline:

1. detectar serviço
2. coletar largura/altura
3. calculateRange()
4. formatExternalQuote()

Resposta:

Para esse tamanho, o investimento costuma ficar entre R$ X e R$ Y.

Posso agendar uma visita para confirmar?

---

## 5.3 — Persistência

Criar request com:

- is_estimated = true
- total_value = média da faixa

---

## ✅ CHECK FASE 5

- [x] faixa calculada (calculateRange em quote-engine.ts)
- [x] resposta curta (formatExternalQuote)
- [x] CTA funcionando ("Sim, quero agendar" / "Depois")
- [x] request salvo (is_estimated=true, total_value=média da faixa)

**Implementado em:** `lib/external-quote-handler.ts`; chamado quando mode !== internal (cliente). Detecção por isPriceQuestion + keywords do quote_service; slots por extractQuoteSlotsFromText.

**Como testar:** Enviar mensagem como cliente (mode=external) — ex.: via WhatsApp com número não cadastrado como owner, ou simulador com toggle "Testar como cliente" (futuro).

---

# FASE 6 — PROTEÇÕES E RATE LIMIT

Implementar:

- rate limit por actor internal
- máximo X comandos/minuto
- log de auditoria de ações internas

Criar tabela: internal_action_log

Campos:

- tenant_id
- actor_id
- action
- payload
- created_at

---

## ✅ CHECK FASE 6

- [x] rate limit ativo (30 comandos/minuto por tenant; resposta "Você enviou muitos comandos. Tenta em 30 segundos.")
- [x] log funcionando (internal_action_log; migração 20260226000000)
- [ ] testes de abuso (owner disparar muitos comandos em 1 minuto → bloqueado)

**Implementado em:** `index.ts` (check antes de handleInternalIntent); tabela `internal_action_log` (tenant_id, action, payload, created_at).

---

# IMPLEMENTAÇÃO — Conectar WhatsApp no chat via Evolution API (SEM QR) usando Pairing Code (MVP)

Objetivo: Após o usuário finalizar o onboarding + testar no simulador, permitir que ele conecte o WhatsApp real diretamente no chat usando **Evolution API** com **pareamento por código (pairingCode)**, sem exibir QR Code.

⚠️ **Nota (produto):** este método continua sendo **não-oficial** (sessão WhatsApp Web/Baileys). A diferença é só a UX: **código** em vez de QR.

Referências Evolution API:
- Create Instance (Basic): https://doc.evolution-api.com/v2/api-reference/instance-controller/create-instance-basic
- Instance Connect (retorna pairingCode / code): https://doc.evolution-api.com/v1/api-reference/instance-controller/instance-connect
- (Opcional) Evolution Channel: https://doc.evolution-api.com/v2/pt/integrations/evolution-channel

---

## 1) UX / FLOW NO CHAT (após simulador)

### Pergunta (momento de ativação)

Após o usuário testar o simulador e aprovar:

Nevo:
> Quer colocar o Nevo para funcionar no seu WhatsApp agora?

Opções:
- ✅ Conectar agora (por código)
- ⏭️ Depois

Se “Depois”:
- não trava
- salvar status “pending” no channel
- responder: “Quando quiser, diga: conectar whatsapp”

### Guardrails

- Somente `context.mode === "internal"` e `actor_type in ("owner","admin")` pode iniciar.
- Se client tentar:
  “Essa opção só está disponível para o administrador.”

### Fluxo de conexão (por código)

1) “Vou preparar a conexão do seu WhatsApp.”
2) “Me confirme o número com DDI/DDD (ex.: 5511999999999).”
3) Backend cria instância (Evolution) e solicita pairingCode.
4) Nevo mostra o código e instruções curtas.
5) Nevo acompanha status até “connected”.
6) Nevo confirma conexão e ativa o canal.

---

## 2) BANCO / MODELO DE DADOS (sem duplicar)

Reaproveitar tabela existente de canal WhatsApp (ex.: `agent_channel_whatsapp`). Se não existir, criar minimal.

Campos necessários (MVP):
- provider: "evolution"
- connection_type: "pairing_code" | "qr" | "cloud"
- instance_key: string (único por tenant+agent)
- status: "disconnected" | "connecting" | "connected" | "error"
- connected_phone: string (somente dígitos, com DDI)
- connected_at: timestamp null
- last_error: text null
- provider_config: jsonb null (opcional)

Regras:
- `instance_key = "nevo_<tenantId>_<agentId>"` (determinístico)
- `connected_phone` sempre normalizado (somente dígitos)

---

## 3) NORMALIZAÇÃO DE TELEFONE (obrigatório)

Util único: `normalizePhoneNumber(input: string): string` (já em `src/lib/actor.ts`).

Remove: `whatsapp:`, `+`, espaços, `-`, `(`, `)`; mantém só dígitos.

Usar:
- no input do chat (número informado)
- nos webhooks
- em lookups de `tenant_user.phone_number` e `contact.phone`

---

## 4) BACKEND — ENDPOINTS INTERNOS DO NEVO

### 4.1 POST /api/whatsapp/connect/start

Entrada:
- tenant_id (resolve por session, nunca via client)
- agent_id
- phone (string) — já normalizado

Ações:
1) criar (ou garantir) instância no Evolution (Create Instance Basic; integration: "WHATSAPP-BAILEYS"; qrcode: false; instanceName = instance_key)
2) salvar channel status: status="connecting", provider="evolution", connection_type="pairing_code", instance_key, connected_phone
3) chamar Instance Connect: GET /instance/connect/{instance_key}?number={phone}; parse e retornar pairingCode (e code se vier)

Saída: pairingCode, instance_key, status.

### 4.2 GET /api/whatsapp/connect/status?agent_id=...

Consultar status da instância na Evolution; fallback polling via instance info. Mapear para connected / connecting / error. Se connected: atualizar DB (status="connected", connected_at = now()).

### 4.3 POST /api/whatsapp/connect/retry

Reexecuta connect e gera novo pairingCode; manter instance_key.

### 4.4 POST /api/whatsapp/disconnect (opcional MVP)

Derrubar instância / deslogar; set status="disconnected".

---

## 5) CHAMADAS PARA EVOLUTION API (MVP)

### 5.1 Create Instance (Basic)

POST /instance/create — instanceName: instance_key, integration: "WHATSAPP-BAILEYS", qrcode: false.

### 5.2 Instance Connect (Pairing Code)

GET /instance/connect/{instance_key}?number={phone}. Retorno: pairingCode, code. Se erro, persistir em last_error e exibir fallback.

---

## 6) UX — INSTRUÇÕES NO CHAT (curtas e claras)

**Coleta do número:** “Me confirme o número do WhatsApp que você quer conectar (só números, com DDI). Ex: 5511999999999”. Validação: mínimo 12 dígitos; se inválido → pedir novamente.

**Entrega do Pairing Code:** “Pronto. Use este código para vincular: **{PAIRING_CODE}**. No WhatsApp: Configurações → Aparelhos conectados → Vincular dispositivo → Vincular com código. Assim que conectar, me avise com ‘ok’ (ou eu detecto automaticamente).”

**Polling:** enquanto connecting → “Aguardando conexão…”; quando connected → “Conectado ✅ A partir de agora o Nevo atende por esse número.”

**Fallback:** se usuário não encontrar “vincular com código”: “Se preferir, posso gerar um QR Code para você escanear.” (implementar depois ou deixar o texto.)

---

## 7) ROTEAMENTO: ONDE ISSO ENTRA NO CONVERSATIONS-TURN

- Se `context.mode === "internal"` e intenção “connect_whatsapp”: entrar no mini-flow internal (state machine só para conectar).
- Não misturar com FlowOrchestrator (external). Esse flow é “admin/internal tool”.

Estados sugeridos (conversation.state_json.internal_connect): idle, awaiting_phone, connecting, connected, error.

Persistir `actor_type` e `mode` em `conversation.context` (já feito na Fase 1).

---

## 8) FASE 6.5 — Conectar WhatsApp (MVP Pairing Code via Evolution)

### Checklist

- [x] CTA aparece após simulador (“Conectar agora” / “Depois”)
- [x] Apenas owner/admin consegue iniciar
- [x] Coleta número (normalizado) no chat
- [x] Create Instance (WHATSAPP-BAILEYS, qrcode=false)
- [x] Instance Connect retorna pairingCode
- [x] Pairing Code exibido ao usuário com instruções
- [x] Status polling + persistência no DB
- [x] Tratamento de erro + retry
- [x] Não trava onboarding se pular

Observação: manter `connection_type` extensível (“cloud” no futuro).

---

## 9) PONTOS DE ATENÇÃO (para evitar bugs reais)

1) **Formato do número:** padronizar somente dígitos com DDI; usar normalizePhoneNumber em tudo.
2) **Conexão após conectar:** garantir que webhooks da Evolution apontem para o endpoint; garantir que `agent_channel_whatsapp` correto seja usado pelo runtime.
3) **Conflito de instâncias:** instance_key único por tenant+agent; se usuário tentar conectar de novo → oferecer “Regerar código” em vez de criar outra instância.
4) **Mensagem clara:** evitar termos técnicos; um passo por vez.

---

# FASE 7 — TESTES OBRIGATÓRIOS

Criar cenários:

1. Cliente tenta acessar agenda → bloqueado
2. Owner consulta agenda → permitido
3. Owner gera orçamento → OK
4. Cliente gera estimativa → OK
5. Cliente tenta cancelar agendamento → bloqueado

**Implementado:**
- Documento de cenários: `docs/test-scenarios-fase7.md`
- Bloqueio cliente agenda: resposta genérica quando `isExternalActor` e texto indica consulta de agenda
- Bloqueio cliente cancelar: `tryHandleCancellationAnytime` retorna mensagem de contato quando `isExternalActor`
- `ConversationRuntimeContext.isExternalActor` passado como `true` no path external (simulador)

---

# REFERÊNCIA: SIMULAÇÃO COMPLETA

Ver documento **docs/simulacao-onboarding-e-conversation-fabi-cortinas.md** para:
- Onboarding passo a passo (agendamento + orçamento interno e externo) para uma loja de cortinas.
- O que é persistido (business_config, quote_service).
- Simulação da conversation na prática: dono (internal) consultando agenda, contato, orçamento e PDF; cliente (external) pedindo estimativa em faixa e agendando.

---

# FASE 8 — MÉTRICAS FUTURAS (NÃO IMPLEMENTAR AGORA)

- total de orçamentos internal
- total de estimativas external
- conversão para agendamento
- taxa de confirmação de PDF

---

# 📦 RESUMO ESTRATÉGICO

O Nevo passa a ter:

- Atendimento automático
- Assistente operacional via WhatsApp
- Motor de orçamento interno completo
- Motor de estimativa externo simplificado
- Segurança total baseada em telefone

Sem app.
Sem número global compartilhado.
Sem risco de cliente acessar modo admin.

---

# ⚠️ REGRAS OBRIGATÓRIAS

1. Nunca ativar internal por comando textual.
2. Nunca expor dados internos para client.
3. IA apenas classifica e extrai.
4. Toda regra de negócio é determinística.
5. Cada fase deve ser validada antes de avançar.

---

# 🚀 ORDEM DE EXECUÇÃO

1 → FASE 1
2 → FASE 2
3 → FASE 3
4 → FASE 4
5 → FASE 5
6 → FASE 6
6.5 → Conectar WhatsApp (MVP Pairing Code via Evolution) — ver seção “IMPLEMENTAÇÃO — Conectar WhatsApp…”
7 → FASE 7

NÃO PULAR FASE.

Após concluir cada fase, o agente deve:

- Marcar CHECKLIST
- Rodar testes manuais
- Confirmar integridade multi-tenant
- Confirmar RLS ativo

---

# FIM DO DOCUMENTO


# Respostas às dúvidas do agente (Cursor) — Assistente Pessoal + Orçamento

Este documento responde os pontos levantados pelo agente e define decisões para seguir com a implementação no branch `feature/assistente-pessoal-orcamento`.

---

## 1) Fase 1.2 — `actor_role` no `conversation.context`

**Pergunta:** Para números que não batem com nenhum `tenant_user` (ou que batem com agent), qual valor usar? Só "client" ou existe "agent"/"unknown"?

**Decisão recomendada (objetiva e segura):**
- Persistir **sempre** um `actor_type` mais completo e derivar `mode` a partir disso.
- Usar estes valores:

```ts
actor_type: "owner" | "admin" | "agent" | "client" | "unknown"
mode: "internal" | "external"
```

**Regras:**
1. Se `fromNumber` casar com `tenant_user.phone_number`:
   - role=owner → `actor_type="owner"`, `mode="internal"`
   - role=admin → `actor_type="admin"`, `mode="internal"`
   - role=agent/viewer → `actor_type="agent"`, `mode="external"` (ou "internal" somente se você quiser liberar futuramente; por agora manter external por segurança)
2. Se não casar com nenhum `tenant_user`:
   - se houver `contact` (pelo `external_id`/telefone) → `actor_type="client"`, `mode="external"`
   - se não houver `contact` ainda → `actor_type="unknown"`, `mode="external"` (o fluxo vai criar o `contact` conforme já ocorre hoje)
3. O sistema NUNCA deve inferir `internal` por texto.

**O que salvar em `conversation.context`:**

```json
{
  "mode": "internal" | "external",
  "actor_type": "owner" | "admin" | "agent" | "client" | "unknown"
}
```

> Observação: o doc original usava `actor_role`. Substituir por `actor_type` para evitar ambiguidade e para suportar “agent/unknown” com clareza.

---

## 2) Fase 2.1 — Intent `create_appointment_internal`

**Pergunta:** Deve criar de fato o registro no banco (qual tabela?) e seguir validação de slots/horário?

**Decisão: SIM, cria no banco.**  
Tabela: `appointment` (já existe no projeto).

**Comportamento esperado (determinístico):**
- IA extrai dados iniciais (data, hora, serviço, nome/telefone do cliente se vierem).
- O código valida (sem IA):
  1) se data/hora estão presentes  
  2) se horário está dentro da agenda disponível do agente (se você já tem essa regra no agendamento atual, reutilizar)  
  3) conflito: se já existe appointment no intervalo (start_at/end_at) → negar e sugerir alternativas
  4) normalizar timezone (America/Sao_Paulo)

**Persistência:**
- Criar `contact` se necessário.
- Criar `appointment` com:
  - tenant_id, agent_id, contact_id
  - start_at, end_at (end_at pode ser start_at + duração padrão do serviço; se não houver duração, usar default configurável)
  - service_name (texto ou id se existir no futuro)
  - status = "confirmed" (ou "scheduled" conforme padrão atual)

**Resposta:**
- Mostrar resumo e pedir confirmação final antes de gravar (recomendado), OU gravar e oferecer “desfazer” (mais complexo).
- MVP recomendado: **pedir confirmação**.

**Subseção a adicionar no doc (para o agente implementar):**
- Incluir em Fase 2.2 uma implementação determinística equivalente às outras intents.

---

## 3) Fase 2.2 — `query_appointment_by_time` (“hora aproximada”)

**Pergunta:** Existe tolerância definida (±15 min)?

**Decisão recomendada:**
- Tolerância padrão: **±20 minutos**.
- Se houver mais de 1 match no range, responder com lista de opções (máx 3) pedindo para escolher.

**Regra:**
- Interpretar horário “14” como “14:00”.
- Montar janela:
  - `start_at` entre `13:40` e `14:20`.

**Fallback:**
- Se não achar nenhum, responder:
  - “Não encontrei exatamente às 14h. Quer que eu procure por 13h–15h?” (sem travar)

---

## 4) Fase 3.1 — `quote_service` com `agent_id` (serviço por agente ou por tenant?)

**Pergunta:** Cada agente tem seu próprio conjunto de serviços ou existe global por tenant? Blueprint é sempre por agente?

**Decisão recomendada (alinhada com arquitetura atual do Nevo):**
- `quote_service` é **por agent** no MVP (inclui `agent_id` obrigatório).
- Motivo: o Nevo já segmenta fluxo e canal por `agent`, então manter consistência reduz edge cases.
- Futuro (não agora): permitir catálogo por tenant e herança por agente.

**Regra prática:**
- Um tenant com 3 agentes pode ter 3 catálogos diferentes.
- Se quiser “global”, o app pode copiar serviços entre agentes (feature futura).

---

## 5) Fase 4.1 — “Slots” (orçamento vs agendamento)

**Pergunta:** Slots são variáveis do orçamento conforme `variables_schema` ou inclui slot de horário do agendamento?

**Decisão:**
- Neste documento, “slots” em orçamento significa **apenas variáveis do serviço de orçamento** conforme `variables_schema` do `quote_service`.
- Agendamento continua usando seus próprios campos/contexto (data/hora/service).
- Não misturar para evitar colisões semânticas.

**Sugestão de tipagem:**
- `quote_slots` (JSON)
- `booking_slots` (JSON) se necessário no contexto da conversa

---

## 6) Fase 5.2 — “detectar serviço” no external

**Pergunta:** Detecção só por IA ou também determinística (palavras-chave → quote_service)?

**Decisão recomendada: HÍBRIDO (mais robusto).**
1) Determinístico primeiro:
   - Criar em `quote_service` um campo opcional:
     - `keywords` (text[]) ou `match_rules` (JSONB)
   - Fazer match por palavras-chave simples (lowercase, contains).
2) Se não bater:
   - IA classifica e sugere serviço (retorna `service_name` ou `service_id` candidato).
3) Se ainda não tiver confiança:
   - Perguntar ao usuário: “É para qual serviço? (opções: X, Y, Z)”

**Por quê híbrido?**
- IA pode errar ou variar; keywords dá previsibilidade e reduz custo.

---

## 7) Fase 6 — Rate limit “máximo X comandos/minuto”

**Pergunta:** X definido? Onde definir?

**Decisão (MVP seguro):**
- Definir agora:
  - **X = 20 comandos/minuto por actor (owner/admin)**
  - burst curto permitido (ex.: 10 em 10s) se quiser, mas não é obrigatório.

**Onde armazenar:**
- Por simplicidade: ENV + fallback default.
  - `INTERNAL_RATE_LIMIT_PER_MINUTE=20`
- Implementar em memória (Edge Function) não é confiável; preferível:
  - tabela `rate_limit_bucket` (ou Redis/Upstash se existir).
- MVP recomendado (Supabase):
  - criar tabela `internal_rate_limit` com:
    - tenant_id
    - actor_phone
    - window_start (timestamp)
    - count (int)

**Regra:**
- Se estourar:
  - responder “Você enviou muitos comandos em pouco tempo. Tenta novamente em 30 segundos.”

---

## 8) Contatos — “Consulta de contatos” não aparece nas fases

**Pergunta:** Ficou para depois ou existe outro spec?

**Decisão: incluir nesta entrega (mínimo) como Fase 2.3.**

Adicionar intents internas:

- query_contact_by_appointment_time
- query_contact_by_name

Implementações:
1) query_contact_by_appointment_time
   - usa a mesma lógica de `query_appointment_by_time`
   - retorna o telefone e nome do contact

2) query_contact_by_name
   - busca por `display_name ILIKE %...%` dentro do tenant
   - se múltiplos → lista e pede escolha

**CHECK FASE 2 (atualizar):**
- [x] listar hoje
- [x] listar amanhã
- [x] buscar por horário
- [x] cancelar agendamento
- [x] buscar contato por horário
- [x] buscar contato por nome
- [x] simulador envia mode=internal e actor_type=owner
- [ ] testes no simulador

---

## 9) Tabela `request` já existe — o que alterar?

**Pergunta:** A tabela request já existe com outros campos? Só adicionar os campos listados?

**Decisão:**
- Sim: **apenas adicionar** os campos listados, sem remover/renomear o que já existe.
- Campos novos (MVP):
  - `blueprint_id` (FK para quote_service.id ou opcional)
  - `total_value` (numeric)
  - `currency` (text, default 'BRL')
  - `calculation_result` (jsonb)
  - `is_estimated` (boolean default false)

**Observação:**
- Se `request` já tiver `slots`, manter e usar como `quote_slots`.
- Se `request` já tiver `preco_estimado`, alinhar com `total_value`:
  - pode manter ambos temporariamente, mas preferível convergir e padronizar.

---

## 10) PDF — “URL pública temporária” tem expiração?

**Pergunta:** Expira em 24h/7d ou “temporária” só como não-permanente?

**Decisão recomendada (MVP):**
- “Temporária” = **link não deve ser publicamente indexável e deve exigir assinatura**.
- Implementar com **Signed URL do Supabase Storage** com expiração.

**Expiração padrão:**
- 7 dias (604800s) para o dono baixar/reencaminhar.
- Valor configurável via ENV:
  - `QUOTE_PDF_SIGNED_URL_TTL_SECONDS=604800`

**Fluxo:**
- Armazena PDF em bucket privado.
- Gera Signed URL quando solicitado/confirmado.
- Envia ao owner.
- (Opcional futuro) gerar novamente se expirar.

---

# Ajuste a fazer no documento principal (roadmap)

O agente deve atualizar o roadmap com as decisões acima:

1) Substituir `actor_role` por `actor_type` e incluir `unknown/agent`.
2) Adicionar subseção determinística para `create_appointment_internal` (cria appointment).
3) Definir tolerância ±20min em `query_appointment_by_time`.
4) Fixar `quote_service` por agent no MVP.
5) Clarificar “slots” somente orçamento.
6) Implementar detecção de serviço híbrida (keywords -> IA -> pergunta).
7) Definir X=20/min via ENV + tabela de rate limit.
8) Incluir Fase 2.3 (contatos).
9) Confirmar request: apenas adicionar campos.
10) PDF via Signed URL (7 dias) + ENV.

---

# ✅ CHECKLIST DE DECISÕES APROVADAS

- [x] actor_type definido (owner/admin/agent/client/unknown)
- [x] internal só por phone_number autorizado
- [x] create_appointment_internal cria appointment e pede confirmação
- [x] tolerância query_appointment_by_time = ±20min
- [x] quote_service por agent (MVP)
- [x] slots (orçamento) separados de agendamento
- [x] detecção de serviço híbrida (keywords + IA) — integrado em external-quote-handler
- [x] rate limit 20/min configurável via ENV (INTERNAL_RATE_LIMIT_PER_MINUTE)
- [x] intents de contatos incluídas na Fase 2
- [x] request: apenas adicionar campos
- [ ] PDF: bucket privado + Signed URL 7 dias (stub em generatePdf.ts; FASE 4)

FIM
```
::contentReference[oaicite:0]{index=0}








# Respostas finais (para o agente do Cursor) — validação e decisões

A seguir estão as respostas finais aos pontos do agente, com decisões fechadas para implementação no branch `feature/assistente-pessoal-orcamento`.

---

## ✅ Validação geral

O entendimento do agente está correto e alinhado com a arquitetura atual do Nevo, especialmente:

- Separação clara entre:
  - `conversation.context.mode = internal | external` (quem está falando)
  - `conversation.state_json.mode = booking | quote` (qual fluxo/intenção do cliente)
- Reuso de tabelas existentes (`appointment`, `request`, `contact`, `conversation.context`) sem duplicação.
- Intents internas (agenda/contato/orçamento) como conjunto novo, executadas **somente** quando `context.mode === "internal"`.
- Manter `detectModeFromText` apenas para “booking vs quote” (fluxo), e derivar `internal vs external` exclusivamente via `resolveActorByPhone`.

Nenhuma correção adicional é necessária nessa parte.

---

## 🔐 Decisão 1 — `actor_type` no `conversation.context`

**Decisão final:**
- Não usar `actor_role`.
- Salvar:

```ts
actor_type: "owner" | "admin" | "agent" | "client" | "unknown"
mode: "internal" | "external"

Regras determinísticas:

Se fromNumber casar com tenant_user.phone_number:

role=owner → actor_type="owner", mode="internal"

role=admin → actor_type="admin", mode="internal"

role=agent/viewer → actor_type="agent", mode="external" (MVP: manter external por segurança)

Se não casar com tenant_user:

se já existir contact (telefone/external_id) → actor_type="client", mode="external"

se não existir contact ainda → actor_type="unknown", mode="external" (o fluxo de atendimento cria contact quando necessário)

Persistência:
Salvar em conversation.context (JSONB) sempre no início do turno:

{
  "mode": "internal" | "external",
  "actor_type": "owner" | "admin" | "agent" | "client" | "unknown"
}

📅 Decisão 2 — create_appointment_internal

Decisão final:

Deve criar de fato um registro em appointment (tabela já existente).

Deve seguir validação determinística (sem IA para regras).

Validações obrigatórias (MVP):

data e hora presentes

timezone America/Sao_Paulo aplicado corretamente

conflito de agenda (overlap) bloqueia criação

horário fora de faixa permitida (se houver regra atual) deve bloquear

confirmação antes de gravar (recomendado para MVP)

Persistência:

Criar/obter contact se necessário

Criar appointment com:

tenant_id, agent_id, contact_id

start_at, end_at (end_at = start_at + duração padrão configurável)

service_name (ou service_names conforme schema atual)

status conforme padrão do projeto (ex.: "confirmed" / "scheduled")

Cancelamento:

usar status = 'cancelled' + cancellation_reason (já existe migration)

⏱️ Decisão 3 — query_appointment_by_time (tolerância)

Decisão final:

Tolerância padrão: ±20 minutos.

Regra:

Ex.: “agendamento das 14” → janela [13:40, 14:20]

Se houver múltiplos matches:

listar até 3 opções e pedir para escolher

🧾 Decisão 4 — quote_service é por agente (MVP)

Decisão final:

quote_service é por agent_id no MVP (obrigatório).

Não criar “serviço global por tenant” agora.

Futuro: permitir copiar catálogo entre agentes (feature posterior).

🎛️ Decisão 5 — “Slots” no orçamento

Decisão final:

“slots” de orçamento = apenas variáveis do variables_schema do quote_service.

Não misturar com slots de agendamento.

No banco:

Usar a coluna existente request.slots (JSONB).

Semanticamente, no orçamento, isso representa “quote_slots”.

Não criar coluna quote_slots.

🔎 Decisão 6 — detecção de serviço (external) é híbrida

Decisão final (ordem):

Determinístico primeiro:

adicionar keywords (text[]) ou match_rules (jsonb) em quote_service

fazer match simples (contains / normalize)

Se não bater:

IA classifica e sugere o serviço (candidato)

Se continuar incerto:

perguntar ao usuário: “É para qual serviço? (opções...)”

🚦 Decisão 7 — Rate limit (internal)

Decisão final:

Limite: 20 comandos/minuto por actor (owner/admin).

Config em ENV:

INTERNAL_RATE_LIMIT_PER_MINUTE=20

Tabela recomendada (modelo A: 1 linha por minuto):

internal_rate_limit

tenant_id

actor_phone

window_start (timestamp truncado ao minuto)

count

PRIMARY KEY (tenant_id, actor_phone, window_start)

Algoritmo:

window_start = now truncado ao minuto

upsert incrementando count

se count > limit → bloquear e responder mensagem de cooldown

👤 Decisão 8 — Contatos (Fase 2.3)

Decisão final:
Incluir na entrega (não deixar para depois), como Fase 2.3.

Intents internas:

query_contact_by_appointment_time

query_contact_by_name

Implementação:

by_time:

reusar a busca por horário (±20min) e retornar nome + telefone do contact

by_name:

buscar contact.display_name ILIKE %query% dentro do tenant

múltiplos → listar e pedir escolha

Checklist da Fase 2 deve incluir contatos.

🧱 Decisão 9 — request (tabela existente)

Decisão final:

Não duplicar tabela.

Apenas adicionar campos:

blueprint_id (FK para quote_service.id)

total_value (numeric)

currency (text, default 'BRL')

calculation_result (jsonb)

is_estimated (boolean default false)

Campos existentes:

manter slots e usar como quote slots

manter estimated_price_min/estimated_price_max

Convergência (sem quebrar agora):

External:

continuar usando estimated_price_min/max

setar total_value = média da faixa

is_estimated = true

Internal:

usar total_value e calculation_result completos

is_estimated = false

📄 Decisão 10 — PDF (Signed URL)

Decisão final:

PDF deve ir para bucket privado (Supabase Storage).

Link deve ser Signed URL (não público permanente).

TTL padrão:

7 dias (604800s)

ENV:

QUOTE_PDF_SIGNED_URL_TTL_SECONDS=604800

Comportamento:

gerar/assinar URL quando o owner confirmar o orçamento (ou solicitar reenvio)

se expirar, gerar novamente sob demanda

📞 Decisão 11 — Normalização de telefone (obrigatório)

Decisão final:

tenant_user.phone_number deve ser armazenado em formato somente dígitos com DDI.

Exemplo:

5511999999999

Criar util único:

normalizePhoneNumber(input: string): string

Regras:

remover prefixo whatsapp:

remover +, espaços, -, (, )

retornar apenas dígitos

Uso obrigatório:

no webhook (fromNumber)

no resolveActorByPhone

ao salvar/editar tenant_user.phone_number no app

NULL permitido:

tenant_user.phone_number pode ser NULL até o usuário vincular WhatsApp.

🧭 Decisão 12 — resolveActor é por tenant (não por agent)

Decisão final:

Lookup do actor deve ser por:

tenant_id (derivado do agent_id no webhook)

phone_number_normalized

Ou seja:

resolveActorByPhone(tenant_id, fromNumberNormalized)

Agent serve apenas para:

identificar tenant_id

escopar qual agenda/orçamento/serviços daquele agente serão usados no turno.

✅ Checklist final (decisões aprovadas)

 context.mode = internal/external e actor_type salvo em conversation.context

 internal somente por tenant_user.phone_number (owner/admin)

 create_appointment_internal cria appointment com validação e confirmação

 query_appointment_by_time com ±20min e disambiguation

 quote_service por agent_id (MVP)

 request.slots usado como quote slots (sem colunas duplicadas)

 detecção de serviço híbrida (keywords → IA → pergunta)

 rate limit 20/min via ENV + internal_rate_limit PK por minuto

 intents de contatos incluídas (Fase 2.3)

 PDF em bucket privado + Signed URL 7 dias via ENV

 normalização de telefone padronizada e usada em tudo

 resolveActor por tenant_id + phone_number

**Ativação progressiva e onboarding leve:**

- [ ] Onboarding < 3 minutos (simulado) para funcionamento básico
- [ ] PDF funciona sem branding configurado (template default Nevo)
- [ ] Branding pode ser configurado depois (onboarding opcional ou área logada)
- [ ] Primeiro PDF oferece upgrade de timbrado quando branding.enabled = false
- [ ] Nenhum campo fiscal é obrigatório no onboarding

FIM

::contentReference[oaicite:0]{index=0}