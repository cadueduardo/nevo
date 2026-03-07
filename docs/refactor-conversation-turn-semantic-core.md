# Refatoracao do `conversation-turn` para nucleo semantico

## Objetivo

Substituir o motor atual de conversa por uma arquitetura em que:

- o onboarding alimente um contexto operacional consolidado do negocio
- a IA interprete cada turno em um snapshot semantico unico
- a decisao da proxima acao seja centralizada
- os executores apenas validem, persistam e respondam
- onboarding, painel e WhatsApp usem a mesma regra de negocio

O foco e eliminar perda de contexto, caminhos duplicados e sobrescrita de intencao.

## Problema atual

O sistema ja possui boa parte da inteligencia necessaria, mas a interpretacao correta nao se sustenta ate a resposta final porque ha muitas camadas concorrentes.

### Sintomas observados

- uma pequena variacao na escrita do cliente muda o fluxo inteiro
- o bot entende uma intencao no inicio e depois age como se fosse outra
- multiagendamento perde contexto e volta para fluxo simples
- saudacao, FAQ, booking e fallback competem entre si
- simulador, painel e WhatsApp divergem apesar de compartilharem parte do motor

### Causa estrutural

Hoje a arquitetura mistura:

- interpretacao semantica por IA
- heuristicas locais
- orquestrador paralelo
- regras early e post
- preenchimento direto de slots em multiplos pontos
- renderizacao e decisao no mesmo nivel

Resultado: a mesma mensagem pode ser reinterpretada em varios lugares, com precedencia inconsistente.

## Achados do pente fino inicial

### 1. O turno ainda tem varias portas de decisao concorrentes

Arquivos principais:

- `supabase/functions/conversations-turn/lib/turn-handler.ts`
- `supabase/functions/conversations-turn/lib/turn/early/reject-and-first.ts`
- `supabase/functions/conversations-turn/lib/orchestrator-actions.ts`
- `supabase/functions/conversations-turn/lib/qualification.ts`
- `supabase/functions/conversations-turn/lib/resolve-booking.ts`

Pontos de conflito:

- `interpretFlowWithAI(...)`
- `interpretBookingRequestWithAI(...)`
- pre-resolucao numerica local
- hard-guards de nome da pessoa
- `applyConversationRules(...)`
- preenchimento direto de `slots.service`
- interceptores de preco/lista/detalhe dentro de booking

### 2. Booking nao tem uma fonte soberana de intencao

O fluxo depende de varios flags espalhados:

- `pending_additional_booking`
- `pending_additional_count`
- `expected_additional_count`
- `pending_attendee_name`
- `pending_attendee_queue`
- `pending_template_choice`
- `pending_second_service_choice`
- `service_selection_multi`

Esses flags sao necessarios, mas hoje substituem a semantica em vez de apenas representar o estado da execucao.

### 3. O motor ainda recompila a mesma mensagem em varios lugares

Exemplos:

- early steps tentam inferir booking
- orquestrador tenta inferir booking
- qualification tenta inferir booking
- booking service tenta inferir novamente o que o cliente quis dizer

### 4. Existem camadas de UX misturadas com regra de negocio

O que deveria ser apenas diferenca de canal hoje interfere na decisao:

- WhatsApp aceita texto livre
- simulador usa opcoes numeradas e multiselect visual
- parte da logica de interpretacao depende desse formato em vez de depender da intencao

## Arquitetura alvo

## 1. `business_brain`

Responsavel por consolidar o conhecimento do negocio a partir do onboarding/config.

Deve conter:

- identidade do negocio
- tipo de negocio
- endereco
- FAQ
- tom
- publico atendido
- servicos
- duracoes
- precos
- agenda
- pausas
- equipe
- regras de sequencia
- regras de confirmacao
- politicas de contato
- restricoes e recusas

Regra:

- onboarding, painel e WhatsApp devem usar o mesmo `business_brain`

## 2. `turn_semantic_snapshot`

Objeto unico gerado por turno via IA + validacoes.

Campos previstos:

- `primary_intent`
- `secondary_intents`
- `booking_intent`
- `faq_intent`
- `pricing_intent`
- `identity_intent`
- `people`
- `includes_self`
- `attendee_names`
- `additional_count`
- `service_candidates`
- `date_candidate`
- `time_candidate`
- `sequence_request`
- `audience_risk`
- `ambiguities`
- `next_question_hint`
- `confidence`

Regra:

- nenhum modulo paralelo deve redefinir a intencao principal depois que o snapshot estiver pronto

## 3. `conversation_state`

Estado persistido da execucao, nao da interpretacao.

Responsavel por guardar:

- slots ja confirmados
- pendencias reais
- bookings concluidos
- fila de pessoas
- contexto de template/confirmacao
- metadados de entrega

Regra:

- o estado nao deve ter a responsabilidade de adivinhar a intencao do cliente

## 4. `decision_engine`

Recebe:

- `business_brain`
- `turn_semantic_snapshot`
- `conversation_state`
- runtime do canal

Retorna:

- `decision_result`

Campos previstos:

- `action`
- `reason`
- `required_executor`
- `slots_to_apply`
- `question_to_ask`
- `options`
- `channel_hints`

Regra:

- somente essa camada decide a proxima acao do turno

## 5. `executors`

Executores pequenos por responsabilidade:

- greeting
- faq
- identity
- booking_attendee
- booking_service
- booking_date
- booking_time
- booking_contact
- booking_sequence
- booking_finalization
- cancellation
- quote

Regra:

- executores nao reinterpretam a intencao principal
- executores apenas aplicam a decisao do motor

## 6. `renderers`

Renderizam a mesma decisao para:

- onboarding simulator
- painel simulator
- WhatsApp

Regra:

- a logica de negocio deve ser a mesma
- muda apenas a forma de apresentar

## Plano de migracao

## Fase 0 - Seguranca

- [x] criar branch dedicada: `refactor/conversation-turn-semantic-core`
- [ ] manter o motor atual utilizavel durante a migracao
- [ ] definir flag de fallback entre legado e semantic core

### Implementacao inicial desta fase

Arquivo:

- `supabase/functions/conversations-turn/lib/semantic-core/runtime.ts`

Ja existe:

- `runSemanticCoreTurn(...)`
- `shouldUseSemanticCore(...)`

Comportamento atual:

- o runtime novo ja executa internamente:
  1. `BusinessBrain`
  2. `TurnSemanticSnapshot`
  3. `DecisionEngine`
  4. executores
- a ativacao por padrao continua desligada
- a flag prevista e:
  - `CONVERSATION_TURN_ENGINE=semantic_core`
  - `CONVERSATION_TURN_ENGINE=legacy`

Objetivo desta etapa:

- permitir integracao gradual sem remover o legado
- comparar comportamento do motor novo contra o antigo
- reduzir risco de regressao durante a migracao

## Fase 1 - Auditoria completa do legado

- [ ] mapear todos os entrypoints reais do turno
- [ ] mapear todos os pontos que interpretam intencao
- [ ] mapear todos os pontos que escrevem slots
- [ ] mapear todos os atalhos de fallback
- [ ] mapear diferencas entre onboarding, painel e WhatsApp
- [ ] marcar funcoes reaproveitaveis
- [ ] marcar funcoes candidatas a descarte

### Checklist tecnico da Fase 1

- [ ] tabela com arquivo, responsabilidade e precedencia
- [ ] lista de funcoes duplicadas
- [ ] lista de flags de estado com origem e uso
- [ ] lista de regex/heuristicas que dominam a semantica

## Fase 2 - Contratos novos

- [ ] criar tipo `BusinessBrain`
- [ ] criar tipo `TurnSemanticSnapshot`
- [ ] criar tipo `DecisionResult`
- [ ] criar tipo `ConversationStateV2` ou adaptar o atual com compatibilidade
- [ ] documentar cada campo e sua fonte

## Fase 3 - Business Brain

- [ ] criar builder unico a partir do onboarding/config
- [ ] incluir FAQ
- [ ] incluir publico atendido
- [ ] incluir duracao e preco dos servicos
- [ ] incluir equipe e agenda
- [ ] incluir politicas de sequencia e contato
- [ ] garantir mesmo builder nos 3 canais

## Fase 4 - Semantic Interpreter

- [ ] criar interpretador unico por turno
- [ ] incluir saudacao, FAQ, booking, preco, identidade, cancelamento e quote
- [ ] suportar linguagem natural caotica
- [ ] suportar multiplas pessoas com ou sem nomes
- [ ] suportar servicos ja citados na primeira frase
- [ ] suportar pedido de sequencia por linguagem livre
- [ ] reduzir regex a fallback puro

### Checks reais da Fase 4

- [ ] `quero agendar pra mim e meu primo`
- [ ] `quero cortar meu cabelo e do meu amigo`
- [ ] `nós 3 queremos ir ai cortar o cabelo`
- [ ] `quero agendar pro Gustavo`
- [ ] `quero agendar pro Elisa e o Malaquias`
- [ ] `tenta encaixar um depois do outro`
- [ ] `se der hoje vai, senao amanha`

### Implementacao inicial desta fase

Arquivo:

- `supabase/functions/conversations-turn/lib/semantic-core/turn-semantics.ts`

Escopo atual:

- constroi `TurnSemanticSnapshot` a partir de:
  - mensagem atual
  - historico curto
  - `SimulatorState`
  - `BusinessBrain`
- reaproveita os helpers legados:
  - `interpretFlowWithAI(...)`
  - `interpretBookingRequestWithAI(...)`
  - `interpretSlotsFromMessageWithAI(...)`
- consolida em um unico objeto:
  - `primary_intent`
  - `secondary_intents`
  - `people`
  - `service_candidates`
  - `date_candidate`
  - `time_candidate`
  - `sequence_request`
  - `audience_risk`
  - `ambiguities`
  - `next_question_hint`

Regra importante desta etapa:

- a IA legada continua sendo usada como insumo
- mas o resultado agora e normalizado em um snapshot unico
- nenhum modulo novo deve consumir diretamente os helpers legados fora do snapshot builder

### O que ja esta decidido no snapshot inicial

- saudacao vs preco vs FAQ/lista vs booking
- pedido de multiagendamento
- nomes ja citados
- servicos ja citados
- data/hora quando a mensagem ja trouxe isso
- pedido de sequencia em linguagem natural
- risco de publico quando houver restricao configurada

### O que ainda nao foi feito nesta fase

- integrar o snapshot ao runtime principal
- substituir o decision flow legado
- migrar FAQ/quote/cancelamento para o novo `decision_engine`

## Fase 5 - Decision Engine

- [ ] criar funcao unica de decisao do turno
- [ ] remover competencia de intencao dos executores
- [ ] garantir precedencia centralizada entre FAQ, saudacao e booking
- [ ] garantir uso do risco de publico antes de entrar no booking

### Checks reais da Fase 5

- [ ] saudacao informal nao derruba booking posterior
- [ ] pergunta de preco nao vira agendamento sem pedido
- [ ] pedido de agendamento ambiguu com publico restrito pede confirmacao antes de seguir
- [ ] multiagendamento nao colapsa para fluxo simples

### Implementacao inicial desta fase

Arquivo:

- `supabase/functions/conversations-turn/lib/semantic-core/decision-engine.ts`

Escopo atual:

- traduz `TurnSemanticSnapshot` + `SemanticTurnContext` em `SemanticDecisionResult`
- define uma unica proxima acao sem reinterpretar a mensagem
- centraliza a precedencia entre:
  - saudacao
  - identidade
  - preco
  - detalhe de servico
  - lista de servicos
  - booking
  - confirmacao de publico
  - sequencia
  - fallback

### Ordem de precedencia inicial

1. `greeting`
2. `identity`
3. `price`
4. `service_detail`
5. `service_list`
6. `booking` / `booking_sequence`
   - confirma publico se necessario
   - pede nome se faltar
   - pede servico se faltar
   - oferece template de sequencia se detectado
   - pede data
   - pede hora
   - pede contato
   - confirma booking
7. `closing`
8. `handoff_fallback`

### Principio importante

- o `decision_engine` nao chama IA
- ele confia no snapshot semantico pronto
- se o runtime precisar de algo a mais, isso deve virar campo do snapshot e nao logica paralela

### O que ainda nao foi feito nesta fase

- integrar o `decision_engine` no runtime do legado
- ligar cada `action` a executores novos
- remover os branches equivalentes do `turn-handler.ts`

## Fase 6 - Booking Core novo

- [ ] reimplementar booking por executores pequenos
- [ ] separar claramente pessoa, servico, data, hora, contato e finalizacao
- [ ] preservar contexto de multiagendamento e sequencia
- [ ] impedir perda de contexto em resposta invalida
- [ ] usar duracao real dos servicos para sequencia

### Implementacao inicial desta fase

Arquivos:

- `supabase/functions/conversations-turn/lib/semantic-core/executors/booking-attendee.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/executors/booking-service.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/executors/booking-date.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/executors/booking-time.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/executors/booking-contact.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/executors/booking-sequence.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/executors/booking-finalization.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/executors/index.ts`

Contrato novo:

- `SemanticExecutorResult`

Responsabilidade:

- cada executor recebe:
  - `SemanticDecisionResult`
  - `TurnSemanticSnapshot`
  - `SemanticTurnContext`
- e devolve:
  - `state_patch`
  - `slot_updates`
  - `action_options`
  - `prompt_key`
  - `metadata`

Principio importante:

- o executor nao decide intencao
- o executor nao chama IA
- o executor so aplica a decisao central

### O que esta coberto nesta implementacao inicial

- nome do atendido
- servico
- data
- horario
- contato
- template de sequencia
- confirmacao final

### O que ainda nao foi feito nesta fase

- integrar a execucao com o runtime legado
- usar duracao real do servico dentro do executor de sequencia
- conectar renderizacao real por canal
- cobrir FAQ, quote e cancelamento com executores proprios

### Checks reais da Fase 6

- [ ] `1,2`
- [ ] `1.2`
- [ ] `1 e 2`
- [ ] `corte e barba`
- [ ] `sim, pode ser o proximo`
- [ ] `o outro vai depois desse`
- [ ] `usa meu contato para os dois`

## Fase 7 - Renderers por canal

- [ ] renderer do onboarding
- [ ] renderer do painel
- [ ] renderer do WhatsApp
- [ ] garantir equivalencia de regra entre canais
- [ ] manter diferenca apenas de UX

## Fase 8 - Observabilidade

- [ ] logar snapshot semantico por turno
- [ ] logar decisao tomada
- [ ] logar executor acionado
- [ ] logar motivo de fallback
- [ ] logar porque uma sequencia nao foi seguida

## Fase 9 - Matriz de aceite

### Saudacao
- [ ] informal: `opa e ai tudo bem`
- [ ] formal: `boa tarde, gostaria de um agendamento`
- [ ] pergunta de identidade: `quem esta falando?`

### Informacional
- [ ] endereco
- [ ] horario de funcionamento
- [ ] FAQ configurado
- [ ] detalhes de servico
- [ ] preco de servico

### Booking simples
- [ ] fluxo limpo
- [ ] fluxo caotico
- [ ] servico ja dito na primeira frase
- [ ] data ambigua
- [ ] horario em linguagem livre

### Booking multiplo
- [ ] pra mim e meu filho
- [ ] pra mim e meu irmao
- [ ] pra mim e meu primo
- [ ] pro Gustavo
- [ ] pro Elisa e o Malaquias
- [ ] nos 3 queremos ir ai
- [ ] nomes todos citados de uma vez

### Sequencia
- [ ] mesmo colaborador proximo horario
- [ ] mesmo horario com outro colaborador
- [ ] outro horario no mesmo dia
- [ ] outro dia
- [ ] considerar duracao total dos servicos

### Finalizacao
- [ ] contato proprio da segunda pessoa
- [ ] pular contato e usar titular
- [ ] calendario
- [ ] endereco na confirmacao
- [ ] envio WhatsApp para contato secundario

## Regras de implementacao

- arquivos pequenos e por responsabilidade
- nenhuma funcao principal com responsabilidade misturada
- nenhuma reinterpretação da mesma mensagem em varios lugares
- regex apenas como fallback
- IA como interpretadora principal do turno
- motor como executor disciplinado
- compatibilidade progressiva com rollback facil

## O que sera preservado do legado

Candidatos a reaproveitamento:

- utilitarios de data/hora
- calculo de disponibilidade
- calendario
- parte de builders de resposta
- integracao com DB
- integracao com Evolution/WhatsApp
- partes da finalizacao e notificacoes

## O que tende a ser removido ou esvaziado

- competicao entre `interpretFlowWithAI` e `interpretBookingRequestWithAI`
- preenchimento direto de slots fora do decision engine
- duplicidade entre early/orchestrator/booking para decidir a mesma intencao
- forks de canal que mudam regra de negocio

## Ordem recomendada de execucao

1. concluir auditoria do legado
2. criar contratos novos
3. implementar `BusinessBrain`
4. implementar `TurnSemanticSnapshot`
5. implementar `DecisionEngine`
6. migrar booking simples
7. migrar multiagendamento
8. migrar sequencia
9. migrar FAQ/saudacao/preco
10. conectar renderers por canal
11. rodar matriz de aceite
12. ativar via flag

## Status atual desta branch

- [x] branch criada
- [x] documento base criado
- [x] auditoria inicial do legado documentada
- [x] contratos do semantic core criados
- [x] `BusinessBrain` implementado
- [x] `TurnSemanticSnapshot` implementado
- [x] `DecisionEngine` implementado
- [x] executores iniciais de booking implementados
- [x] `runtime` unificado do semantic core implementado
- [x] integracao controlada com `index.ts` via flag
- [x] integracao controlada com `turn-handler.ts`
- [ ] renderizacao real por canal

### Integracao controlada atual

Arquivos:

- `supabase/functions/conversations-turn/index.ts`
- `supabase/functions/conversations-turn/lib/turn-handler.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/renderers/index.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/renderers/greeting.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/renderers/informational.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/renderers/booking.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/renderers/shared.ts`

Comportamento:

- se `CONVERSATION_TURN_ENGINE=semantic_core`, o `index.ts` executa:
  - `runSemanticCoreTurn(...)`
  - `renderSemanticSimulatorResult(...)`
- `processSimulatorMessage(...)` e `handleBookingModeMessage(...)` tambem respeitam a mesma flag
- se a flag nao estiver ativa, continua no legado

Observacao importante:

- o semantic core ja tem renderers separados por dominio:
  - saudacao
  - informacional
  - booking
- ainda nao existe renderer final especifico por canal
- serve para testar o pipeline novo sem misturar com o legado

## Auditoria do legado - mapa inicial do fluxo atual

### Ordem real do turno hoje

1. `processSimulatorMessage(...)` em `lib/turn-handler.ts`
2. pre-resolucao local:
   - `tryResolveNumericMultipleServiceSelection(...)`
   - `tryResolveNumericServiceSelection(...)`
   - `numericActionResolved`
3. hard-guard de nome da pessoa em multiagendamento
4. `runEarlySteps(...)`
   - `runBypassSteps(...)`
   - `runAnytimeSteps(...)`
   - `runFinalizedStep(...)`
   - `runRejectAndFirstSteps(...)`
5. preenchimento direto de `slots.service` em `turn-handler.ts`
6. `applyConversationRules(postServiceResolutionRules, ...)`
7. pipeline de fases / qualification / fallback
8. `handleBookingModeMessage(...)`
9. `resolveBooking(...)`
10. cadeia de handlers em `BOOKING_HANDLERS`

### Consequencia pratica

A mesma mensagem pode ser transformada ou reinterpretada em varios pontos antes de chegar ao booking core.

### Modulos concorrentes por responsabilidade

#### Intencao principal

- `interpretFlowWithAI(...)`
- `interpretBookingRequestWithAI(...)`
- regex de `isExplicitBookingIntent(...)`
- hard-guards do `turn-handler.ts`
- regras do `conversation-rules.ts`
- handlers do `orchestrator-actions.ts`

#### Servico

- `findServiceFromText(...)` em varios lugares
- `tryResolveNumericServiceSelection(...)`
- `tryResolveNumericMultipleServiceSelection(...)`
- `interpretSlotsFromMessageWithAI(...)`
- preenchimento direto em `turn-handler.ts`
- preenchimento dentro de `booking/service.ts`

#### Multiagendamento

- `interpretAdditionalBookingsWithAI(...)`
- `interpretBookingRequestWithAI(...)`
- flags manuais em `qualification.ts`
- flags manuais em `turn-handler.ts`
- decremento e continuidade em `booking/finalization.ts`

#### FAQ / informacional

- `tryAnswerInformationalQuestion(...)`
- `answerWithContextualAI(...)`
- `runAnytimeSteps(...)`
- `runFinalizedStep(...)`
- fallback do orquestrador

### Pontos de sobrescrita identificados

1. `turn-handler.ts` faz preenchimento de servico antes e depois dos early steps.
2. `handleBookingModeMessage(...)` ainda age como mini-orquestrador, interceptando preco/lista/detalhe antes do booking core.
3. `orchestrator-actions.ts` replica entrada em booking e tambem injeta estado de multiagendamento.
4. `qualification.ts` interpreta booking de novo mesmo quando a intencao ja poderia vir pronta do turno.
5. `resolveBooking.ts` ainda roda interpretadores adicionais por turno, em vez de consumir uma semantica unica precomputada.
6. `booking/service.ts` precisa reconstruir contexto porque a semantica nao chega como fonte soberana.

### Arquivos com maior acoplamento hoje

- `supabase/functions/conversations-turn/lib/turn-handler.ts`
- `supabase/functions/conversations-turn/lib/orchestrator-actions.ts`
- `supabase/functions/conversations-turn/lib/qualification.ts`
- `supabase/functions/conversations-turn/lib/resolve-booking.ts`
- `supabase/functions/conversations-turn/lib/booking/service.ts`
- `supabase/functions/conversations-turn/lib/booking/finalization.ts`

### Diretriz para a desmontagem do legado

Ao migrar para o semantic core, cada responsabilidade abaixo deve existir em apenas um lugar:

- interpretar intencao principal
- interpretar pessoas envolvidas
- interpretar servicos citados
- interpretar risco de publico
- decidir proxima acao
- executar booking
- renderizar resposta

### Criterio de aceite desta auditoria

- [x] ordem real do turno mapeada
- [x] modulos concorrentes identificados
- [x] pontos de sobrescrita listados
- [x] arquivos de maior acoplamento identificados
- [ ] classificar o que sera reaproveitado vs descartado
- [ ] definir o primeiro corte do semantic core no codigo

## Classificacao inicial do legado

### Reaproveitar com poucas mudancas

- `lib/utils.ts`
- `lib/services.ts`
- `lib/staff.ts`
- `lib/calendar.ts`
- `lib/http.ts`
- `lib/db.ts`
- `lib/holidays.ts`
- `lib/generatePdf.ts`
- `lib/booking/time-and-availability.ts`
- `lib/booking/contact.ts`
- `lib/booking/confirmation.ts`

### Adaptar para o semantic core

- `lib/ai.ts`
- `lib/informational.ts`
- `lib/builders.ts`
- `lib/policies.ts`
- `lib/state.ts`
- `lib/cancellation.ts`
- `lib/booking/finalization.ts`
- `lib/booking/staff-and-date.ts`

### Candidatos a esvaziamento ou substituicao

- `lib/turn-handler.ts`
- `lib/orchestrator-actions.ts`
- `lib/qualification.ts`
- `lib/resolve-booking.ts`
- `lib/conversation-rules.ts`
- `lib/flow-pipeline.ts`
- `lib/booking/service.ts`
- `lib/turn/early/*`

### Observacao

Substituicao nao significa apagar de imediato. Esses arquivos devem ficar funcionando atras de uma flag de fallback ate a matriz de aceite ficar verde.

## Contratos iniciais do semantic core

Arquivo criado:

- `supabase/functions/conversations-turn/lib/semantic-core/types.ts`

Tipos definidos nesta etapa:

- `BusinessBrain`
- `TurnSemanticSnapshot`
- `SemanticDecisionResult`
- `SemanticTurnContext`

### Criterio de aceite desta etapa

- [x] classificacao inicial do legado registrada
- [x] contratos centrais iniciais criados
- [ ] revisar contratos apos o primeiro builder do business brain
- [ ] revisar contratos apos o primeiro interpreter semantico

## Mapeamento inicial `SimulatorConfig` -> `BusinessBrain`

Arquivo:

- `supabase/functions/conversations-turn/lib/semantic-core/business-brain.ts`

### Campos consolidados

#### Identidade do negocio

- `business_name`
- `business_type`
- `tone`
- `establishment_address`

#### FAQ e conhecimento informativo

- `faq[]`
  - entram somente itens com pergunta e resposta validas

#### Servicos operacionais

Fonte:

- prioriza `booking_services`
- fallback para `services`

Campos consolidados por servico:

- `name`
- `normalized_name`
- `description`
- `duration_minutes`
- `base_price`
- `sequence_eligible`

#### Equipe

Fonte:

- `staff[]`

Campos consolidados por colaborador:

- `name`
- `normalized_name`
- `use_business_schedule`
- `schedule`

#### Agenda do negocio

Fonte:

- `schedule`

Campos consolidados:

- `days_of_week`
- `start_time`
- `end_time`
- `breaks`
- `interval_minutes`
- `min_booking_lead_minutes`

#### Publico atendido

Fonte:

- `target_audience.mode`
- `target_audience.modes`
- `target_audience.note`
- `target_audience.kids_age_min`

Campos consolidados:

- `modes`
- `note`
- `kids_age_min`

#### Politicas operacionais

Fonte:

- `lead_policy.reject_unlisted_services`
- `allow_sequence_booking`
- `interaction_style`

Campos consolidados:

- `reject_unlisted_services`
- `sequence_enabled`
- `interaction_style`

#### Calendario especial

Fonte:

- `holidays_attend`
- `closure_periods`

### Criterio de aceite do builder inicial

- [x] dados do onboarding consolidados em um contexto operacional unico
- [x] normalizacao de nomes de servico e equipe
- [x] prioridade de `booking_services` sobre `services`
- [x] elegibilidade de sequencia derivada no proprio builder
- [ ] integrar esse builder ao runtime do novo semantic core
- [ ] validar se ha campos adicionais do onboarding que ainda nao entraram no brain
