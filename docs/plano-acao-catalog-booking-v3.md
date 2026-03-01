# Plano de Ação – Catalog vs Booking + V3 Concierge (versão consolidada)

**Objetivo:** aplicar todas as mudanças (onboarding → UI → migration → conversations-turn → V3) de forma incremental, segura e observável.

**Princípio:** IA conduz (interpretação), código decide (validação/persistência).  
**Regra de ouro:** booking é 100% determinístico e **sempre** valida contra `getBookingServices()`.

---

## Documentos de referência
- `docs/servicos agendados e catalogos.md` – modelagem catalog vs booking
- `docs/analise protagonismo ia.md` – V3 Concierge: Decision JSON, multi-intenção, repair loop
- `docs/conversations-turn-services-refactor-map.md` – mapa/ordem do refactor `config.services`

> **Fase 4:** seguir a **ordem e os blocos** do refactor-map (não refatorar por intuição).

---

## Visão geral das fases

| Fase | Escopo | Risco | Dependências |
|------|--------|-------|--------------|
| 0 | Infraestrutura (helpers, migration, types) | Baixo | Nenhuma |
| 1 | Onboarding (catalog + booking steps + descrições IA opcionais) | Médio | 0 |
| 2 | Migração de dados (tenants existentes) + fallback runtime | Médio | 0 |
| 3 | UI área cliente (AgentBasicEditor) | Médio | 0 |
| 4 | Refatoração conversations-turn (catalog vs booking) | Médio | 0,2 |
| 5 | V3 Concierge (Decision JSON, fast-path, multi-intenção, repair loop, integração) | Alto | 4 |
| 6 | Webhooks e context (payload v2 consistente) | Baixo | 0,2,4 |
| 7 | Depreciação e limpeza (`services`) | Baixo | 1–6 |

> **Ajuste importante:** a Fase 4.7 (substituição em massa no `index.ts`) deve ser tratada como “mini-sprint isolado”, não misturar com V3.

---

# FASE 0 – Infraestrutura

## 0.1 Helpers de acesso (fonte única)
**Arquivo:** `supabase/functions/conversations-turn/lib/config-helpers.ts` (ou `lib/services.ts`)

Assinaturas:
- `getCatalogServices(config): Array<{ name: string; description?: string }>`
- `getBookingServices(config): Array<{ name: string; duration_minutes?: number; base_price?: number; description?: string }>`

Regras:
- Retornar `catalog_services`/`booking_services` se existir.
- **Fallback temporário**: `config.services` durante a janela de depreciação.
- **LOG OBRIGATÓRIO** quando fallback for usado:
  - `log.warn("Using legacy services fallback")`

Checklist:
- [ ] Implementar os 2 getters
- [ ] Unit: getters com config v2
- [ ] Unit: getters com config legado (fallback)
- [ ] Unit: fallback dispara log.warn

## 0.2 Tipos e modelagem (v2)
**Arquivos:** `lib/types.ts`, tipos de onboarding, `SimulatorConfig`

Checklist:
- [ ] Adicionar `catalog_services`, `booking_services`
- [ ] Adicionar `business_config_version?: number`
- [ ] Manter `services?: ...` como deprecado

## 0.3 Migration SQL (v2)
**Arquivo:** `supabase/migrations/YYYYMMDD_catalog_booking.sql`

Regra:
- Se `business_config.services` existir e `catalog_services/booking_services` não existirem:
  - `booking_services := services`
  - `catalog_services := services`
  - `business_config_version := 2`
  - manter `services` por compatibilidade (janela de depreciação)

Checklist:
- [ ] Migration para `agent_setting.business_config`
- [ ] Migration para `tenant_setting.business_config`
- [ ] (Se aplicável) `onboarding_sessions.collected_data`
- [ ] Rodar em staging com amostra real

---

# FASE 1 – Onboarding

## 1.1 Step: catalog_services_list (obrigatório)
**Arquivos:** `onboarding-chat/flow-manager.ts`, `onboarding-chat/index.ts`

- Inserir após `context_mode`
- Pergunta: “Quais serviços/produtos vocês oferecem no geral?”
- Persistir em `collected_data.catalog_services = [{ name }]`
- Obrigatório para qualquer `context_mode` (booking/quote/both)

Checklist:
- [ ] `determineNextStep` inclui catalog em todos os modos
- [ ] Handler `catalog_services_list` persiste corretamente
- [ ] Frontend `requires_action === 'catalog_services_list'`

## 1.2 Step: catalog_services_descriptions_offer (opcional)
Pergunta:
“Quer que eu sugira descrições curtas para cada serviço? Você pode editar tudo antes de continuar.”
Opções:
- Gerar descrições
- Pular por enquanto

Checklist:
- [ ] Step opcional (não bloqueia)
- [ ] Pular mantém descriptions undefined

## 1.3 Step: catalog_services_descriptions_bulk (inline, uma chamada IA)
**Regras finais (bulk IA):**
- IA gera todas as descrições numa única chamada
- UI mostra lista editável inline (textarea por item)
- Estados por item: `ai | manual | empty` (estado de UI)
- Botões: `Continuar | Regenerar todas | Pular por enquanto`

Comportamentos:
- **Continuar:** persiste `description` não vazia em `catalog_services`
- **Pular por enquanto:** descarta tudo (não persiste nada)
- **Regenerar todas:** sobrescreve apenas itens `source="ai"` (preserva manual/empty)
- Se todos forem manual/empty: desabilitar “Regenerar todas” (ou mensagem “Nada para regenerar”)

Checklist:
- [ ] Implementar estado `ai/manual/empty`
- [ ] Uma chamada IA + aplicação seletiva
- [ ] Tratamento de erro IA: “Tentar novamente” / “Pular por enquanto” (nunca bloquear)

## 1.4 booking_services_list (renomeado de services_list)
- Para booking/both: coletar `booking_services`
- `services_duration` -> `booking_services[i].duration_minutes`
- `services_pricing` -> `booking_services[i].base_price`
- `sequence_services_select` usa nomes de `booking_services`

Checklist:
- [ ] `determineNextStep` usa booking_services no lugar de services
- [ ] Frontend `requires_action === 'booking_services_list'`

## 1.5 quote-only (fluxo explícito)
Quando `context_mode === 'quote'`:
- Ordem: `catalog_services_list` → (opcional) descrições → `quote_services_list` → `quote_service_pricing` → ...
- **Garantia:** `determineNextStep` não exige `booking_services` em quote-only.

Checklist:
- [ ] quote-only não passa por booking_services_list
- [ ] quote-only não roda steps de schedule/duration/pricing de booking
- [ ] quote-only persiste catalog + quote corretamente

## 1.6 Persistência do onboarding (business_config)
**Arquivo:** `onboarding-chat/index.ts` (save/merge agent_setting/tenant_setting)

Ao finalizar:
- `business_config.catalog_services = collected_data.catalog_services`
- `business_config.booking_services = collected_data.booking_services`
- `business_config_version = 2`
- manter `services = booking_services` temporariamente

Checklist:
- [ ] Save/merge grava catalog + booking
- [ ] Summary exibe separado
- [ ] Edição no summary respeita regras

---

# FASE 2 – Migração de dados (tenants)

## 2.1 Execução
- Rodar migration em staging → validar → rodar em produção
- Auditar tenants migrados

Checklist:
- [ ] Migration em staging
- [ ] Migration em produção
- [ ] Plano de rollback (SQL revert / backup)
- [ ] Validação pós (amostra)

## 2.2 Fallback runtime
- Fallback garantido via getters
- Simulador e webhooks devem funcionar em legado e v2

Checklist:
- [ ] Simulador com legado
- [ ] Simulador com v2
- [ ] Log de fallback ativo

---

# FASE 3 – UI área cliente (AgentBasicEditor)

**Meta:** lista única com toggle “Disponível para agendamento”.

Regras:
- Sempre salva em `catalog_services`
- Se `is_bookable=true`: também em `booking_services` (com duração + preço)
- Ao desmarcar: remover de `booking_services`
- Botões para description: “Gerar com IA”, “Refazer”, “Editar” (reusa lógica do onboarding)

Checklist:
- [ ] Toggle is_bookable
- [ ] Campos: name, description, duration_minutes, base_price
- [ ] Validação: catalog >= 1; se booking/both, booking >= 1

---

# FASE 4 – Refatoração conversations-turn (catalog vs booking)

**Objetivo:** substituir todos os usos de `config.services` pelos getters corretos.

> **Ajuste obrigatório:** seguir o mapa `docs/conversations-turn-services-refactor-map.md` e dividir em blocos para reduzir risco.

## 4.1 Loaders / Context
**Arquivo:** `conversations-turn/index.ts`

- Atualizar loaders para incluir `catalog_services` e `booking_services`
- `body.context` deve carregar **ambos**
- fallback para `services` quando necessário

Checklist:
- [ ] context inclui catalog/booking
- [ ] fallback logado quando usado

## 4.2 Builders e informational
**Arquivos:** `lib/informational.ts`, `lib/builders.ts`

- Informativo “quais serviços?” → `getCatalogServices` (sem preço, pode usar description)
- Agendamento/prompt/opções → `getBookingServices`
- reject_unlisted → valida contra catalog

Checklist:
- [ ] `buildCatalogListMessage` (novo)
- [ ] `informational.ts` migrado
- [ ] `builders.ts` migrado

## 4.3 services.ts
**Arquivo:** `lib/services.ts`

Regra:
- Funções não devem “escolher” catálogo/booking sozinhas.
- Ou recebem array `services` já correto, ou usam getter explicitamente conforme função (preço/duração sempre booking).

Checklist:
- [ ] `getServiceWithPrice` usa booking
- [ ] totais de preço/duração usam booking

## 4.4 classifyServiceMatch (contrato)
Refatorar para:
- `classifyServiceMatch(text, services)`

Chamador decide:
- Catalog (existência)
- Booking (agendamento)

Checklist:
- [ ] Não acessar config internamente

## 4.5–4.6 Refatoração incremental no index.ts (por domínio)
- Preço (booking)
- Informativo (catalog)
- Agendamento (booking)

Checklist:
- [ ] Validar fluxos essenciais a cada bloco

## 4.7 Refatoração massiva final (~80 usos) – “mini-sprint isolado”
**Regra de execução:**
- Não iniciar Fase 5 (V3) até 4.7 estabilizar em staging.

### Regressão “serviço único”
- Se `getBookingServices(config).length === 1`, **não perguntar** “qual serviço” no agendamento.
- Checklist: [ ] 1 serviço → assume automaticamente; [ ] 2+ serviços → oferece opções

### Smoke tests (antes de fechar 4.7)
- [ ] “quais serviços?” (catalog)
- [ ] “quero agendar” + 1 serviço (auto)
- [ ] “quero agendar” + multi-serviços (lista)
- [ ] Persistência ok no fluxo simples

Checklist:
- [ ] Roteiro manual completo rodado após 4.7
- [ ] Nenhum branch ficou usando `config.services`
- [ ] fallback logado apenas onde esperado

---

# FASE 5 – V3 Concierge (incremental com feature flag)

**Feature flag:** `concierge_v3_enabled`

> **Ajuste obrigatório:** ativar por estado (finalized → qualification → booking). Booking por último.

## 5.1 Fast-path (determinístico)
- Respostas numéricas
- Confirmações simples
- Parsing básico (hora/data/telefone)
- Evita IA quando é óbvio

## 5.2 Decision JSON (schema + validação)
- IA retorna JSON estruturado
- Sistema valida schema
- Fallback para comportamento atual se inválido

## 5.3 Shadow Mode (não aplica, só loga)
- Gerar Decision JSON
- **Não aplicar** no fluxo
- Logar divergência IA vs fluxo atual

**Observabilidade desde o Shadow Mode (obrigatório):** o formato estruturado deve existir aqui, não só na ativação:
`state_before`, `decision_json`, `slots_provisional`, `slots_confirmed`, `conflicts_detected`, `validation_result`, `availability_check`, `persistence_result`, `fallback_used`

**Gate:**
- divergência < 15% antes de avançar

## 5.4 Ativar em finalized (baixo risco)
- FAQ pós-finalização
- Multi-intenção leve (ex: endereço + thanks)
- Não mexe em persistência

## 5.5 Ativar em qualification (médio risco)
- Disambiguation (“algo rápido”)
- Repair loop (mudança de titular/data/hora)
- Multi-intenção moderada

> **Reforço explícito:** Se Decision JSON sugerir ação que altere estado crítico (ex: mudança de serviço durante confirmação), validar se `awaiting_confirmation` está ativo antes de aplicar. Evita interpretação criativa do agente.

## 5.6–5.7 Ativar em booking (alto risco) + Repair loop completo
### 🔴 FASE CRÍTICA CONSOLIDADA – Booking + V3 Concierge (Versão Final Refinada)
Combinação:
- Fase 4.7 – Refatoração de `conversations-turn/index.ts` (~80 usos de `config.services`)
- Fase 5.6–5.7 – Repair loop + integração do V3 Concierge no estado booking

Riscos e Mitigações (resumo):
1) Aceitação indevida de slot → validar sempre contra `getBookingServices()`, duração, preço, disponibilidade  
2) Slot conflict silencioso → comparar com state, registrar, substituir explicitamente  
3) Multi-intenção no booking → se `awaiting_confirmation===true` bloquear mudança de intenção principal  
4) Shadow divergente → ativar só se < 15%  
5) Confidence mal calibrada → constantes (0.85/0.60) + logs  
6) buildConfigSummary excessivo → booking completo, catalog só nomes, limite 20  
7) Fallback mascarando erro → `log.warn` + monitorar 2 semanas  
8) Race condition → revalidar disponibilidade imediatamente antes de persistir  
9) Persistência parcial → `slots_provisional` vs `slots_confirmed`  
10) Persistência não atômica → transacional; `finalized` só após `persistence_result === success`

**Transição para finalized** somente quando:
- service/date/time confirmados
- disponibilidade revalidada pré-commit
- persistência bem-sucedida

**Checklist obrigatório antes de ativar booking (8 itens):**
- [ ] Validar slots exclusivamente via `getBookingServices()`
- [ ] Revalidar disponibilidade antes de persistir
- [ ] `slots_provisional` vs `slots_confirmed`
- [ ] Persistência transacional
- [ ] Bloqueio multi-intenção em `awaiting_confirmation`
- [ ] Thresholds centralizados (0.85/0.60) + log
- [ ] Log estruturado completo
- [ ] `log.warn` no fallback legacy

**Go/No-Go (gate):**
- Se qualquer critério falhar → manter V3 apenas em qualification/finalized.

---

# FASE 6 – Webhooks e Context (definitivo)

**Objetivo:** garantir que todo o ecossistema envie/consuma v2 corretamente.

Checklist:
- [ ] Webhooks (Evolution/Twilio) passam `catalog_services` e `booking_services` no context
- [ ] Simulator passa ambos
- [ ] Remover dependência “implícita” de `services` no payload
- [ ] Monitorar fallback usado via logs

---

# FASE 7 – Depreciação e limpeza

## 7.1 Janela de depreciação
- 2 sprints (sugestão) mantendo `services` aceito
- monitorar logs de fallback

## 7.2 Remoção
- remover `services` do config, tipos e persistência
- remover fallback dos helpers
- atualizar docs/migrations

Checklist:
- [ ] fallback removido
- [ ] `services` removido dos tipos
- [ ] documentação atualizada

---

# Cronograma sugerido (mantido, com observação de estabilidade)
| Sprint | Fases | Entregas |
|-------|-------|----------|
| 1 | 0, 1.1, 1.4 | Infra, catalog_services_list, booking_services_list |
| 2 | 1.2–1.3, 1.5, 1.6, 2 | Descrições IA bulk, quote-only, persistência, migração |
| 3 | 3, 4.1–4.4 | UI, loaders/builders/services.ts/classifyServiceMatch |
| 4 | 4.5–4.7, 6 | index.ts completo + webhooks/context + estabilização |
| 5 | 5.1–5.4 | V3: flag, fast-path, Decision JSON, shadow mode |
| 6 | 5.5–5.7 | V3: multi-intenção, repair loop, integração booking (gateado) |
| 7 | 7 | Depreciação e limpeza |

> **Ajuste recomendado:** após Sprint 4 (Fase 4.7), rodar alguns dias com logs antes de ativar V3 em booking.

---

# Critérios de sucesso
- [ ] Onboarding coleta catalog e booking separados (quote-only funciona)
- [ ] Tenants migrados sem quebra
- [ ] “Quais serviços?” usa catalog (sem preço, com description quando houver)
- [ ] Agendamento usa apenas booking
- [ ] Preço de item só no catalog → “sob consulta”
- [ ] Serviço único não pergunta “qual serviço”
- [ ] reject_unlisted valida contra catalog
- [ ] V3: menos loops, mais conversão, zero regressão em validação/persistência
- [ ] Fallback removido após janela

---

# Riscos e mitigações (geral)
| Risco | Mitigação |
|------|-----------|
| Quebra em tenants antigos | Migration + fallback; staging + amostra real |
| IA retorna JSON inválido | Validação schema + fallback para fluxo atual |
| Regressão no agendamento | Rollout por estado + gates + testes manuais + logs |
| Custo IA nas descrições | Step opcional + bulk 1 chamada + “Pular por enquanto” |
| Prompt grande no V3 | buildConfigSummary limitado: booking completo + nomes catalog (<=20) |

---

## Ajustes finais para execução pelo agente (regras operacionais)
- Trabalhar por PRs pequenos (principalmente Fase 4 e 5).
- Após cada subfase (4.2, 4.3, 4.4...), rodar smoke tests + roteiro manual mínimo.
- Antes de 4.7 e antes de 5.6–5.7, rodar roteiro completo (persistência + race condition).
- Nunca ativar V3 em booking sem: Shadow mode + gate (<15%) + persistência transacional + logs estruturados desde Shadow mode + checklist de 8 itens.
