# ALTERAÇÃO ESTRUTURAL – SEPARAÇÃO ENTRE CATÁLOGO E SERVIÇOS AGENDÁVEIS

## 🎯 OBJETIVO

Hoje o sistema trata `services_list` como serviços agendáveis.
Precisamos separar claramente:

1. CATÁLOGO DE SERVIÇOS (tudo que a empresa faz)
2. SERVIÇOS AGENDÁVEIS (o que realmente vira compromisso na agenda)

Exemplo real:
Loja de cortinas:
- Catálogo: Cortinas sob medida, Persianas, Instalação, Manutenção
- Agendável: Visita técnica

O cliente pode perguntar "quais serviços vocês fazem?"
Mas só pode agendar "visita técnica".

Essa separação precisa existir:
- No onboarding
- No simulador
- No atendimento
- Na persistência
- Na UI

---

# 1️⃣ ALTERAÇÃO NA MODELAGEM DE DADOS

## Atual
business_config.services (mistura conceito)

## Novo modelo proposto

```json
{
  "business_config": {
    "catalog_services": [
      { "name": "Cortinas sob medida" },
      { "name": "Persianas" },
      { "name": "Instalação" },
      { "name": "Manutenção" }
    ],
    "booking_services": [
      {
        "name": "Visita técnica",
        "duration_minutes": 60
      }
    ]
  }
}

Regras:

catalog_services → usado apenas para resposta informativa

booking_services → usado exclusivamente pelo fluxo de agendamento

O simulador NÃO pode misturar os dois

2️⃣ ALTERAÇÃO NO ONBOARDING
Novo Step: catalog_services_list

Após definir business_type e context_mode (booking ou both):

Pergunta:
"Quais serviços ou produtos vocês oferecem no geral? (ex: cortinas sob medida, persianas, instalação...)"

Aceita múltiplos

Não pergunta duração

Salva em catalog_services

Depois disso, manter o step já existente para agendamento:

booking_services_list (antigo services_list)

Pergunta:
"Agora, pensando em agendamento, o que o cliente pode marcar pelo WhatsApp? (ex: visita técnica)"

Para cada item:

Perguntar duração

Salvar em booking_services

⚠️ Se houver apenas 1 serviço agendável, marcar flag:
single_booking_service = true

3️⃣ ALTERAÇÃO NO SIMULADOR
Quando o cliente perguntar:

"Quais serviços vocês fazem?"

→ Responder usando catalog_services

Exemplo:
"Trabalhamos com cortinas sob medida, persianas, instalação e manutenção."

Se houver booking_services:
"Se quiser, posso agendar uma visita técnica para você."

Quando entrar no fluxo de agendamento:

Regra:

IF booking_services.length == 1
NÃO perguntar qual serviço
assumir automaticamente
ELSE
perguntar qual deseja agendar

Nunca usar catalog_services no fluxo de agenda.

4️⃣ ALTERAÇÃO NA ÁREA DO CLIENTE (UI)

Na tela de serviços:

Separar visualmente:

Aba 1: Catálogo

Lista simples:

Nome

Editar

Excluir

Aba 2: Agendáveis

Lista com:

Nome

Duração

Editar

Excluir

OU

Alternativa:
Lista única com toggle:
[ ] Disponível para agendamento

Se marcado:

Abrir campo de duração

⚠️ Garantir que a persistência continue separada internamente.

5️⃣ MIGRAÇÃO DE DADOS

Se já existir services no banco:

Regra temporária:

Migrar todos para booking_services

Criar catalog_services igual ao booking_services (para manter compatibilidade)

Depois permitir edição manual

Validar se existe algum risco de quebra no simulador atual.

6️⃣ REGRAS IMPORTANTES

Atendimento nunca pode inferir serviços não cadastrados

Simulador só usa dados persistidos

Onboarding não pode mostrar resumo sem booking_services

Não assumir valores default

7️⃣ VERIFICAÇÃO NECESSÁRIA (IMPORTANTE)

Antes de implementar, revisar:

Existe alguma dependência atual de services no código?

Alguma edge function usa services para classificação?

O fluxo determinístico de agendamento depende da estrutura antiga?

Precisamos versionar business_config?

Há risco de tenants antigos quebrarem?

Se houver qualquer ponto ambíguo, inconsistente ou tecnicamente arriscado,
listar claramente antes de implementar.

Se identificar melhorias estruturais melhores que esta proposta,
sugerir alternativa justificada.

Não implementar diretamente sem validar todos os impactos.


---

Se você quiser, posso agora montar uma **versão ainda mais técnica**, com pseudo-código de fluxo determinístico para o motor do Nevo.


# IMPLEMENTAÇÃO – Separação Catálogo vs Serviços Agendáveis + Descrição sugerida por IA no Onboarding

## OBJETIVO
Separar claramente dois conceitos que hoje estão misturados em `business_config.services`:

1) **CATÁLOGO (catalog_services)**: tudo que a empresa faz/oferece (para perguntas informativas “quais serviços vocês fazem?”).
2) **AGENDÁVEIS (booking_services)**: apenas o que vira compromisso na agenda (ex.: “visita técnica”), usado exclusivamente no fluxo de agendamento.

Além disso, incluir no onboarding um step opcional para **gerar descrições por IA** para cada item do catálogo, com revisão humana (aprovar/editar/refazer/pular).

---

## DECISÕES (CONSOLIDADAS)
- `catalog_services` é **obrigatório no onboarding** (para qualquer `context_mode`, inclusive `quote`).
- `booking_services` existe apenas quando `context_mode` for `booking` ou `both`.
- `base_price` **permanece em booking_services** (pois o fluxo de agendamento usa preço em várias mensagens).
- `sequence_eligible_services` passa a ser **subconjunto de booking_services** (nunca do catálogo).
- Não criar flag `single_booking_service`. Usar apenas `booking_services.length === 1` (já existe lógica similar).
- UI recomendada: **lista única com toggle “Disponível para agendamento”** (mais simples), mas persistir internamente separado.
- `lead_policy.reject_unlisted_services` deve validar contra **catalog_services**.
- `description`:
  - principal em `catalog_services.description` (para respostas informativas)
  - opcional também em `booking_services.description` (se quiser texto específico para agendamento)
- Versionar business_config: adicionar `business_config_version: 2`.
- Migração: fazer via migration SQL + fallback temporário em runtime (deprecando `services`).

---

## MODELAGEM (NOVO business_config v2)

```json
{
  "business_config_version": 2,
  "catalog_services": [
    { "name": "Cortinas sob medida", "description": "..." },
    { "name": "Persianas", "description": "..." }
  ],
  "booking_services": [
    { "name": "Visita técnica", "duration_minutes": 60, "base_price": 150, "description": "..." }
  ],
  "sequence_eligible_services": ["Visita técnica"]
}


Regras:

Atendimento informativo usa catalog_services.

Fluxo de agendamento usa somente booking_services.

Quote continua usando quote_services separado (não conflita).

FUNÇÕES DE ACESSO (OBRIGATÓRIO PARA REFATORAÇÃO)

Criar helpers centralizados com fallback temporário:

getCatalogServices(config): Service[]

retorna config.catalog_services se existir

senão fallback: config.services (temporário durante deprecation)

getBookingServices(config): Service[]

retorna config.booking_services se existir

senão fallback: config.services (temporário)

getLegacyServices(config) (opcional) para compatibilidade interna durante migração

Objetivo: substituir todos os usos diretos de config.services por getCatalogServices() ou getBookingServices() conforme contexto.

ONBOARDING (NOVA ORDEM DE STEPS)
Após context_mode:

catalog_services_list (sempre)

catalog_services_descriptions_suggestion (opcional, com IA) ✅ NOVO

Se context_mode in (booking, both):

booking_services_list (renomear/repaginar antigo services_list)

services_duration

services_pricing

sequence_eligible_services (subconjunto de booking_services)

Se context_mode in (quote, both):

quote_services_list

quote_service_pricing

Demais steps existentes (schedule etc.) permanecem no ramo booking/both (ajustar determineNextStep)

STEP: catalog_services_list (NOVO)

Pergunta (1 coisa por vez):

“Quais serviços/produtos vocês oferecem no geral? (ex.: cortinas sob medida, persianas, instalação...)”

Persistir em business_config.catalog_services = [{name}] (description undefined inicialmente).

STEP: catalog_services_descriptions_suggestion (NOVO – IA)
Pergunta inicial:

“Pra você não perder tempo, eu posso sugerir uma descrição curta pra cada serviço. Você revisa e edita. Quer que eu gere agora?”
Opções determinísticas:

“Gerar descrições”

“Pular por enquanto”

Se “Gerar descrições”

Chamar IA (uso permitido: reescrita/geração de texto), gerando 1–2 frases por serviço.

Regras de geração:

curto (1–2 frases), neutro, sem preço, sem promessas absolutas.

linguagem simples, adequada a WhatsApp.

Persistir sugestões em catalog_services[i].description.

Fluxo de revisão (um serviço por vez, sem travar):

Para cada serviço do catálogo, mostrar:

[Nome do serviço]
Sugestão: “...”
Ação:

Aprovar → salva como está

Editar → usuário envia texto, salvar

Refazer → chamar IA de novo para esse serviço e substituir sugestão

Pular → manter description undefined

IMPORTANTE:

Sempre permitir “Pular por enquanto” a qualquer momento (não bloquear onboarding).

Se o usuário editar, não chamar IA novamente sem ele pedir.

booking_services_list (ANTIGO services_list – RENOMEAR/CLAREAR)

Pergunta:

“Agora pensando em agendamento: o que o cliente pode marcar pelo WhatsApp? (ex.: visita técnica)”

Persistir em business_config.booking_services = [{name}].

Depois manter steps existentes:

services_duration escreve duration_minutes em booking_services

services_pricing escreve base_price em booking_services

Regra serviço único:

Se getBookingServices().length === 1, no agendamento não perguntar qual serviço, assumir automaticamente.

sequence_eligible_services

Hoje é subconjunto de services (nomes).
Alterar para subconjunto de booking_services (nomes).
Nunca usar catálogo.

ATENDIMENTO (RESPOSTAS / BUILDERS / INFORMATIONAL)
“Quais serviços vocês fazem?”

Usar getCatalogServices(config)

Preferir description se existir:

responder com lista curta (3–5) com 1 frase cada; se mais serviços, resumir e oferecer “posso te mandar a lista completa”

Se catálogo estiver vazio mas booking existir:

fallback temporário: responder usando booking_services (compatibilidade)

mas no onboarding exigir catálogo.

Ao final, se houver booking_services:

“Se quiser, posso agendar uma [serviço agendável principal] pra você.”

Agendamento

Todas as escolhas e prompts de seleção usam getBookingServices(config).

Preço/duração vêm de booking_services.

lead_policy.reject_unlisted_services

Validação contra getCatalogServices(config) (não booking), pois o cliente pode mencionar serviço não agendável.

UI (/app) – AgentBasicEditor

Recomendação: lista única com toggle “Disponível para agendamento”.

Campos por serviço:

name

description (com ações: “Gerar com IA”, “Refazer”, “Editar”)

toggle is_bookable

se marcado: duration_minutes, base_price (e opcional booking description)

Persistência:

Sempre manter entrada em catalog_services.

Se is_bookable, também garantir entrada correspondente em booking_services (com duração/preço).

Se desmarcar, remover de booking_services (ou marcar inactive), mas manter no catálogo.

WEBHOOKS / SIMULATOR CONTEXT

Atual: bc.services vai no context.
Novo:

Passar bc.catalog_services e bc.booking_services no context.

Manter bc.services apenas enquanto compatibilidade existir (deprecation window).

MIGRAÇÃO (TENANTS EXISTENTES)
Migration SQL (preferido)

Aplicar em:

agent_setting.business_config

tenant_setting.business_config

onboarding_sessions.collected_data (se aplicável)

Regra:

Se business_config.services existir e catalog/booking não existirem:

booking_services = services

catalog_services = services (para manter compatibilidade)

set business_config_version = 2

manter services por 1 versão como fallback (deprecation)

Fallback runtime (temporário)

Enquanto services existir:

getCatalogServices / getBookingServices usam fallback para services.

Depois remover services e fallback.

REFATORAÇÃO (IMPACTO E PLANO)

Substituir todos os usos de config.services (~80+ refs) por:

getCatalogServices quando for informativo (builders/informational “quais serviços?”)

getBookingServices quando for fluxo de agendamento (flow-manager, prompts, seleção, duração/preço)

manter quote separado como já existe

CHECKLIST OBRIGATÓRIO ANTES DE IMPLEMENTAR

Mapear todas as referências a config.services e classificar (informativo vs booking).

Verificar se alguma edge function/classificação depende do formato antigo (findServiceFromText, classifyServiceMatch, getServiceWithPrice).

Confirmar que sequence_eligible_services será sempre derivado de booking_services.

Definir comportamento de quote-only (catálogo obrigatório + quote_services subset).

Garantir compatibilidade no simulator/webhooks durante a janela de deprecation.

Listar qualquer ponto em aberto/ambiguidade técnica antes de codar; se existir risco, levantar para alinhamento.

Se houver QUALQUER ponto em aberto, inconsistência, ou risco de quebra em tenants antigos,
listar claramente os questionamentos para conversarmos antes de finalizar.


# IMPLEMENTAÇÃO – Separação Catálogo vs Serviços Agendáveis + Descrição sugerida por IA no Onboarding (v2 – refinado com pontos de atenção)

## OBJETIVO
Separar claramente dois conceitos que hoje estão misturados em `business_config.services`:

1) **CATÁLOGO (catalog_services)**: tudo que a empresa faz/oferece (para perguntas informativas “quais serviços vocês fazem?”).
2) **AGENDÁVEIS (booking_services)**: apenas o que vira compromisso na agenda (ex.: “visita técnica”), usado exclusivamente no fluxo de agendamento.

Além disso, incluir no onboarding um step opcional para **gerar descrições por IA** para cada item do catálogo, com revisão humana (aprovar/editar/refazer/pular).

---

## DECISÕES (CONSOLIDADAS)
- `catalog_services` é **obrigatório no onboarding** (para qualquer `context_mode`, inclusive `quote`).
- `booking_services` existe apenas quando `context_mode` for `booking` ou `both`.
- `base_price` **permanece em booking_services** (pois o fluxo de agendamento usa preço em várias mensagens).
- `sequence_eligible_services` passa a ser **subconjunto de booking_services** (nunca do catálogo).
- Não criar flag `single_booking_service`. Usar apenas `booking_services.length === 1`.
- UI recomendada: **lista única com toggle “Disponível para agendamento”** (mais simples), mas persistir internamente separado.
- `lead_policy.reject_unlisted_services` deve validar contra **catalog_services**.
- `description`:
  - principal em `catalog_services.description` (para respostas informativas)
  - opcional também em `booking_services.description` (se quiser texto específico para agendamento)
- Versionar business_config: adicionar `business_config_version: 2`.
- Migração: **migration SQL + fallback runtime temporário** (deprecando `services`).

---

## PONTOS DE ATENÇÃO (REFINAMENTOS OBRIGATÓRIOS NO DOC)
### 1) Perguntas de preço sobre itens só do catálogo
Cenário: serviço existe em `catalog_services` mas NÃO existe em `booking_services`, então não haverá `base_price`.
Comportamento determinístico esperado:
- Responder **“preço sob consulta”** e/ou encaminhar para **handoff** (política/config).
Documentar explicitamente:
- “Preço fixo” só é garantido para itens em `booking_services` (ou `quote_services`).
- Itens apenas no catálogo → “sob consulta” (ou handoff).

### 2) UI: remover vs inactive
Primeira versão:
- Ao desmarcar “Disponível para agendamento”, **remover** do `booking_services`.
Evolução futura (não implementar agora):
- `is_active`/inactive em booking.

### 3) Tratamento de erros no step de IA
No step `catalog_services_descriptions_suggestion`, definir:
- Timeout/erro → oferecer “Tentar novamente” e “Pular por enquanto”.
- Se falhar novamente → sugerir pular e deixar para editar no /app.
- Limite de chamadas: gerar em batch quando possível e/ou limitar a N serviços por execução; se exceder, gerar em partes.

---

## MODELAGEM (NOVO business_config v2)

```json
{
  "business_config_version": 2,
  "catalog_services": [
    { "name": "Cortinas sob medida", "description": "..." },
    { "name": "Persianas", "description": "..." }
  ],
  "booking_services": [
    { "name": "Visita técnica", "duration_minutes": 60, "base_price": 150, "description": "..." }
  ],
  "sequence_eligible_services": ["Visita técnica"]
}


Regras:

Atendimento informativo usa catalog_services.

Fluxo de agendamento usa somente booking_services.

Quote continua usando quote_services separado (não conflita).

HELPERS (ASSINATURAS EXPLÍCITAS – OBRIGATÓRIO)

Criar helpers centralizados com fallback temporário:

getCatalogServices(config): Array<{ name: string; description?: string }>

retorna config.catalog_services se existir

senão fallback temporário: config.services

getBookingServices(config): Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>

retorna config.booking_services se existir

senão fallback temporário: config.services

Objetivo: substituir todos os usos diretos de config.services por getCatalogServices() ou getBookingServices() conforme o contexto.

ONBOARDING (ORDEM FINAL DE STEPS)
Após context_mode:

catalog_services_list (sempre)

catalog_services_descriptions_suggestion (opcional, com IA) ✅ NOVO

Se context_mode in (booking, both):

booking_services_list (renomear/repaginar antigo services_list)

schedule

services_duration

services_pricing

sequence_eligible_services (subconjunto de booking_services)

Se context_mode in (quote, both):

quote_services_list

quote_service_pricing

Quote-only (explicitar):

catalog_services_list → catalog_services_descriptions_suggestion (opcional) → quote_services_list → quote_service_pricing → ...

STEP: catalog_services_list (NOVO)

Pergunta (1 coisa por vez):

“Quais serviços/produtos vocês oferecem no geral? (ex.: cortinas sob medida, persianas, instalação...)”

Persistir em business_config.catalog_services = [{name}] (description undefined inicialmente).

STEP: catalog_services_descriptions_suggestion (NOVO – IA)
Pergunta inicial:

“Pra você não perder tempo, eu posso sugerir uma descrição curta pra cada serviço. Você revisa e edita. Quer que eu gere agora?”
Opções determinísticas:

“Gerar descrições”

“Pular por enquanto”

Se “Gerar descrições”

Chamar IA (uso permitido: geração/rewrite de texto), gerando 1–2 frases por serviço.

Regras de geração:

curto (1–2 frases), neutro, sem preço, sem promessas absolutas.

linguagem simples, adequada a WhatsApp.

sem termos técnicos desnecessários.

Persistir sugestões em catalog_services[i].description.

Fluxo de revisão (um serviço por vez, sem travar):

Para cada serviço do catálogo, mostrar:

[Nome do serviço]
Sugestão: “...”
Ação:

Aprovar → salva como está

Editar → usuário envia texto, salvar

Refazer → chamar IA de novo para esse serviço e substituir sugestão

Pular → manter description undefined

Tratamento de erro (OBRIGATÓRIO):

Se IA falhar/timeout:

Mensagem: “Não consegui gerar agora. Quer tentar novamente ou pular por enquanto?”

Ações: “Tentar novamente” | “Pular por enquanto”

Se muitos serviços:

Gerar em lote/batch (quando possível) ou processar por blocos (ex.: 5 por vez) mantendo UX determinística.

IMPORTANTE:

Sempre permitir “Pular por enquanto” a qualquer momento (não bloquear onboarding).

Se o usuário editar, não chamar IA novamente sem ele pedir.

booking_services_list (ANTIGO services_list – RENOMEAR/CLAREAR)

Pergunta:

“Agora pensando em agendamento: o que o cliente pode marcar pelo WhatsApp? (ex.: visita técnica)”

Persistir em business_config.booking_services = [{name}].

Depois manter steps existentes:

services_duration escreve duration_minutes em booking_services

services_pricing escreve base_price em booking_services

Regra serviço único:

Se getBookingServices().length === 1, no agendamento não perguntar qual serviço, assumir automaticamente.

sequence_eligible_services

Hoje é subconjunto de services (nomes).
Alterar para subconjunto de booking_services (nomes).
Nunca usar catálogo.

ATENDIMENTO (RESPOSTAS / BUILDERS / INFORMATIONAL)
“Quais serviços vocês fazem?”

Usar getCatalogServices(config)

Preferir description se existir:

responder com lista curta (3–5) com 1 frase cada; se mais serviços, resumir e oferecer “posso te mandar a lista completa”

Se catálogo estiver vazio mas booking existir:

fallback temporário: responder usando booking_services (compatibilidade), porém no onboarding exigir catálogo.

Ao final, se houver booking_services:

“Se quiser, posso agendar uma [serviço agendável principal] pra você.”

Pergunta de PREÇO (ponto de atenção explicitado)

Se o usuário perguntar preço de item que está:

em booking_services com base_price → responder com preço

apenas em catalog_services (sem base_price) → responder “Preço sob consulta” e/ou handoff conforme política

Agendamento

Todas as escolhas e prompts de seleção usam getBookingServices(config).

Preço/duração vêm de booking_services.

lead_policy.reject_unlisted_services

Validação contra getCatalogServices(config) (não booking), pois o cliente pode mencionar serviço não agendável.

findServiceFromText / getServiceWithPrice (AJUSTE)

Em contexto informativo → findServiceFromText(getCatalogServices(config))

Em contexto de agendamento → findServiceFromText(getBookingServices(config))

getServiceWithPrice deve operar sobre booking_services (pois depende de base_price).

UI (/app) – AgentBasicEditor

Recomendação: lista única com toggle “Disponível para agendamento”.

Campos por serviço:

name

description (com ações: “Gerar com IA”, “Refazer”, “Editar”)

toggle is_bookable

se marcado: duration_minutes, base_price (e opcional booking description)

Persistência:

Sempre manter entrada em catalog_services.

Se is_bookable, também garantir entrada correspondente em booking_services.

Se desmarcar:

remover do booking_services (primeira versão).

WEBHOOKS / SIMULATOR CONTEXT

Atual: bc.services vai no context.
Novo:

Passar bc.catalog_services e bc.booking_services no context.

Manter bc.services apenas enquanto compatibilidade existir (deprecation window).

MIGRAÇÃO (TENANTS EXISTENTES)
Migration SQL (preferido)

Aplicar em:

agent_setting.business_config

tenant_setting.business_config

onboarding_sessions.collected_data (se aplicável)

Regra:

Se business_config.services existir e catalog/booking não existirem:

booking_services = services

catalog_services = services

set business_config_version = 2

manter services por 1 versão como fallback (deprecation)

Fallback runtime (temporário)

Enquanto services existir:

getCatalogServices / getBookingServices usam fallback para services.

Depois remover services e fallback.

REFATORAÇÃO (IMPACTO E PLANO)

Substituir todos os usos de config.services (~80+ refs) por:

getCatalogServices quando for informativo (builders/informational “quais serviços?” e validação reject_unlisted)

getBookingServices quando for fluxo de agendamento (flow-manager, prompts, seleção, duração/preço)

quote continua separado como já existe

CHECKLIST OBRIGATÓRIO ANTES DE IMPLEMENTAR

Mapear todas as referências a config.services e classificar (informativo vs booking).

Ajustar edge functions que dependem do formato antigo:

findServiceFromText, classifyServiceMatch, getServiceWithPrice para usar getters e contexto correto.

Confirmar que sequence_eligible_services é sempre derivado de booking_services.

Confirmar comportamento de quote-only (catálogo obrigatório + quote_services separado).

Garantir compatibilidade no simulator/webhooks durante a janela de deprecation (enviar catalog/booking e manter services temporariamente).

Implementar e testar step de IA:

geração, aprovar, editar, refazer, pular

tratamento de erro (retry/pular)

limites (muitos serviços)

Se houver QUALQUER ponto em aberto, inconsistência, custo/limite de IA, ou risco de quebra em tenants antigos,
listar claramente os questionamentos para alinharmos antes de finalizar.


# IMPLEMENTAÇÃO – Catálogo + Agendáveis + Descrição opcional com IA (versão otimizada)

## OBJETIVO
Separar claramente:
- catalog_services → tudo que a empresa faz
- booking_services → apenas o que vira agendamento

E permitir geração opcional de descrições por IA no onboarding, com edição inline em bloco único.

---

# 1️⃣ MODELAGEM (business_config v2)

```json
{
  "business_config_version": 2,
  "catalog_services": [
    { "name": "Cortinas", "description": "..." }
  ],
  "booking_services": [
    { "name": "Visita técnica", "duration_minutes": 60, "base_price": 150 }
  ],
  "sequence_eligible_services": ["Visita técnica"]
}

Regras:

Atendimento informativo usa catalog_services.

Agendamento usa exclusivamente booking_services.

base_price permanece em booking_services.

sequence_eligible_services é subconjunto de booking_services.

Não criar flag single_booking_service (usar length === 1).

getCatalogServices(config): Array<{ name: string; description?: string }>

getBookingServices(config): Array<{
  name: string;
  duration_minutes?: number;
  base_price?: number;
  description?: string;
}>

Fallback temporário:

Se não existir catalog_services/booking_services,
usar config.services (durante janela de depreciação).

ONBOARDING – ORDEM DE STEPS

Após context_mode:

catalog_services_list (sempre)

catalog_services_descriptions_offer (opcional) ✅ NOVO

Se booking ou both:

booking_services_list

schedule

services_duration

services_pricing

sequence_eligible_services

Se quote ou both:

quote_services_list

quote_service_pricing

4️⃣ STEP – catalog_services_list

Pergunta:
"Quais serviços ou produtos vocês oferecem no geral? (ex: cortinas sob medida, persianas, instalação...)"

Persistir:
business_config.catalog_services = [{ name }]

description inicia undefined.

5️⃣ STEP – catalog_services_descriptions_offer (OPCIONAL)

Pergunta:
"Você quer que eu sugira uma descrição curta para cada serviço?
Você pode editar tudo antes de continuar."

Opções:

Gerar descrições

Pular por enquanto

Se "Pular por enquanto":
→ continuar fluxo normalmente
→ descriptions permanecem undefined
→ poderão ser editadas depois no painel

6️⃣ STEP – catalog_services_descriptions_bulk (INLINE)

Se usuário escolher gerar:

IA gera TODAS as descrições de uma vez

Retorna array:
[{ name, description }]

Regras da IA:

1–2 frases

Sem preço

Linguagem simples

Sem promessas absolutas

Tom neutro

Renderizar no onboarding como lista editável inline:

Serviço: Cortinas
[ textarea com descrição gerada ]

Serviço: Persianas
[ textarea com descrição gerada ]

Serviço: Instalação
[ textarea ]

Ações abaixo do bloco:

Continuar

Regenerar todas

Pular por enquanto

Comportamento:

Continuar:
→ salvar cada description editada
→ seguir onboarding

Regenerar todas:
→ chamar IA novamente
→ sobrescrever todas

Pular por enquanto:
→ limpar descriptions
→ seguir onboarding

7️⃣ TRATAMENTO DE ERRO IA

Se IA falhar:
Mensagem:
"Não consegui gerar agora. Quer tentar novamente ou pular por enquanto?"

Opções:

Tentar novamente

Pular por enquanto

Nunca bloquear onboarding.

8️⃣ ATENDIMENTO

Pergunta:
"Quais serviços vocês fazem?"

→ usar getCatalogServices()
→ se description existir, responder com nome + frase
→ se não existir, responder apenas lista simples

Pergunta de preço:

Se item estiver em booking_services com base_price:
→ responder preço

Se item estiver apenas em catalog_services:
→ responder:
"Esse serviço é sob consulta. Posso verificar para você ou agendar uma visita?"

9️⃣ UI (/app)

Lista única com toggle:

Serviço

name

description (campo editável)

 Disponível para agendamento

Se marcado:

duration_minutes

base_price

Persistência:

Sempre salvar no catalog_services

Se marcado, também salvar em booking_services

Se desmarcar, remover de booking_services

🔟 MIGRAÇÃO

Migration SQL:

services → booking_services

catalog_services = services

set business_config_version = 2

Manter fallback runtime temporário.

CHECKLIST ANTES DE IMPLEMENTAR

Substituir todos os usos de config.services por getters.

Ajustar findServiceFromText e getServiceWithPrice para usar contexto correto.

Garantir que sequence_eligible_services usa booking_services.

Garantir compatibilidade no simulator/webhooks durante deprecation.

Implementar step de IA opcional com edição inline.

Garantir que onboarding nunca bloqueie se IA falhar.

Se houver qualquer risco estrutural, conflito com edge functions ou impacto em tenants antigos, listar antes de implementar.


---

Agora sim está:

- Estruturalmente correto
- Alinhado com sua visão
- UX rápida
- Sem fricção
- IA opcional
- Inline edit
- Determinístico

Se você quiser, o próximo passo pode ser:  
🔎 revisar impacto no conversations-turn antes de mexer.




# AJUSTES FINAIS – Fluxo de descrições por IA (bulk inline) + regras explícitas de “Pular” e “Regenerar”

## CONTEXTO
A versão otimizada troca revisão serviço-a-serviço por um fluxo rápido:
- Offer (gerar ou pular)
- Bulk (gera tudo de uma vez e permite edição inline)

Este documento adiciona regras explícitas para evitar ambiguidades:
- O que acontece ao clicar “Pular por enquanto” dentro do bulk
- O que “Regenerar todas” deve fazer quando há edições manuais

---

# 1) DEFINIÇÃO DE ESTADOS (NÃO DEPENDER DE SUPOSIÇÃO)
No step bulk, cada item de descrição deve ter estado de origem:

- `source = "ai"`: texto gerado pela IA e ainda não editado manualmente
- `source = "manual"`: texto editado pelo usuário (considerar “manual” se houve qualquer alteração)
- `source = "empty"`: usuário apagou tudo (intencional)

Isso pode ser só estado de UI no onboarding (não precisa persistir no banco).

---

# 2) REGRA – “PULAR POR ENQUANTO” NO BULK
Objetivo: permitir seguir o onboarding sem travar, sem surpresa de perda de trabalho.

### Comportamento (DECISÃO):
Ao clicar “Pular por enquanto” no bulk:
- **NÃO persistir nenhuma description** (nem AI, nem manual)
- **DESCARTAR tudo que está no editor do bulk** (efeito equivalente a “não quero configurar descrições agora”)
- seguir o fluxo

Mensagem sugerida (1 coisa só, clara):
- “Ok — vou deixar as descrições para depois. Você pode completar isso no painel.”

Observação:
- Isto é consistente com o rótulo “pular por enquanto”.
- Se o usuário editou bastante e clicou “pular”, entende-se que ele desistiu dessa etapa.

(Se quiser reduzir risco de perda acidental no futuro, pode-se adicionar confirmação UI “Tem certeza?” — mas NÃO é obrigatório nesta fase.)

---

# 3) REGRA – “CONTINUAR”
Ao clicar “Continuar”:
- persistir em `catalog_services[i].description` o conteúdo de cada textarea:
  - se vazio → manter description undefined (ou remover campo)
  - se não vazio → salvar texto
- seguir onboarding

---

# 4) REGRA – “REGENERAR TODAS”
Há 2 políticas possíveis. Definir uma agora para evitar ambiguidade.

### Política escolhida (RECOMENDADA):
“Regenerar todas” **somente regenera as descrições que NÃO foram editadas manualmente**.

Regras:
- Para itens com `source = "ai"` → sobrescrever com novo texto da IA
- Para itens com `source = "manual"` → **preservar** o texto do usuário
- Para itens `source = "empty"` → manter vazio (ou tratar como manual vazio)

Motivo:
- Evita apagar trabalho do usuário (experiência ruim).
- Mantém a ação “regenerar” útil sem surpresa.

### Alternativa (não recomendada agora):
“Regenerar todas” sobrescreve tudo, inclusive manual.
Se implementar isso, precisa avisar explicitamente antes (“isso vai substituir suas edições”).

Nesta fase, seguir a política recomendada acima.

---

# 5) AÇÃO EXTRA (OPCIONAL, MAS MUITO ÚTIL)
Adicionar botão/ação por item:
- “Refazer este” (regenera só um serviço)
Comportamento:
- Se item estiver manual, confirmar:
  - “Isso vai substituir seu texto. Continuar?”
Isso evita confusão e dá controle fino.

(Se não quiser agora, manter apenas “Regenerar todas” com política preservando manual.)

---

# 6) TRATAMENTO DE ERRO (MANTER)
Se IA falhar/timeout:
- “Não consegui gerar agora. Quer tentar novamente ou pular por enquanto?”
Ações:
- Tentar novamente
- Pular por enquanto
Regra:
- Nunca bloquear onboarding

---

# 7) RESUMO DAS DECISÕES DE UX
- Bulk inline edit com textarea por serviço ✅
- Pular por enquanto no bulk = descartar tudo e não persistir ✅
- Regenerar todas = regenera apenas itens não editados (preserva manual) ✅
- Continuar = persiste textos não vazios ✅
- Erro IA = retry ou pular ✅

---

# 8) NOTA DE IMPLEMENTAÇÃO (UI STATE)
Durante o bulk:
- Inicializar todos como `source="ai"` com o texto gerado
- Ao detectar mudança pelo usuário (onChange):
  - marcar `source="manual"`
- Ao “Regenerar todas”:
  - enviar para IA apenas os serviços com `source="ai"` (ou gerar tudo e aplicar só nos ai)
- Ao “Pular por enquanto”:
  - não persistir; sair do step

---

# 9) DOCUMENTAR COMPATIBILIDADE COM O RESTO
Essas regras se encaixam no documento otimizado sem alterar:
- modelagem (catalog_services / booking_services)
- migração e fallback
- regras de preço sob consulta para itens só do catálogo
- helpers getCatalogServices / getBookingServices






Perfeito.
Está consistente, coerente e pronto para implementação.

Vou apenas formalizar os dois últimos microajustes técnicos que você levantou (chamada única de IA e botão desabilitado), já em formato definitivo para o time aplicar sem interpretação.

# COMPLEMENTO FINAL – Regras Técnicas do Bulk IA (implementação fechada)

## 1️⃣ Estratégia de chamada da IA (otimização)

Decisão final:

- A chamada para geração de descrições deve ser **única**, enviando todos os serviços.
- A IA retorna descrições para todos.
- Na aplicação do resultado:
  - sobrescrever apenas os itens com `source = "ai"`
  - preservar `source = "manual"`
  - manter `source = "empty"`

Isso garante:
- apenas 1 chamada de IA
- custo controlado
- comportamento previsível
- preservação de edição manual

Pseudo-regra:
for each service in catalog_services:
if source === "ai":
apply aiResult[service.name]
else:
preserve current text


---

## 2️⃣ Caso extremo – todos os itens manual

Se todos os serviços estiverem com:
- source = "manual"
ou
- source = "empty"

Então:

- O botão “Regenerar todas” deve:
  - ficar desabilitado
  OU
  - exibir mensagem: "Nenhuma descrição disponível para regenerar."

Recomendação:
Desabilitar visualmente o botão (melhor UX).

---

## 3️⃣ Estados finais possíveis por item

| source  | description         | Persistência ao Continuar |
|----------|--------------------|----------------------------|
| ai       | texto IA            | salva                      |
| manual   | texto editado       | salva                      |
| empty    | ""                  | remover/undefined          |

---

## 4️⃣ Garantias de UX

- “Pular por enquanto” → descarta tudo e não persiste nada.
- “Continuar” → salva apenas o que estiver preenchido.
- “Regenerar todas” → nunca apaga edição manual.
- IA falhar → nunca bloqueia o onboarding.
- Nenhuma ação cria estado oculto ou ambíguo.

---

## 5️⃣ Conclusão

Fluxo:
✔ Determinístico  
✔ Rápido  
✔ Sem micro-etapas  
✔ IA opcional  
✔ Inline edit  
✔ Sem risco de perda silenciosa de trabalho  
✔ Compatível com modelagem v2  

Pronto para implementação.

Agora sim:
Arquitetura ✔
UX ✔
Regras claras ✔
Ambiguidade eliminada ✔

Se você quiser, o próximo passo ideal é revisar o impacto específico em conversations-turn antes de começar a refatorar os ~80 usos de config.services.