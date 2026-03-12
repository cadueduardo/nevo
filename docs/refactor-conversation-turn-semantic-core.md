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

## Guia Disciplinar da Fase Atual

Este bloco nao redefine a arquitetura do `semantic_core`.
Ele existe para manter disciplina de implementacao enquanto a migracao continua.

### Objetivo da fase atual

- consolidar soberania do `semantic_core`
- reduzir autoridade do legado
- fechar lacunas operacionais
- garantir previsibilidade do pipeline
- validar comportamento via testes e logs

Risco principal desta fase:

- regressao silenciosa para logica paralela

### Pipeline soberano do turno

O fluxo do turno deve continuar restrito a:

1. mensagem do usuario
2. `TurnSemanticSnapshot`
3. `PolicyLayer`
4. `DecisionEngine`
5. `Executor`
6. `Renderer`
7. resposta final

Fora desse fluxo, nenhum modulo deve:

- reinterpretar intencao
- alterar decisao
- alterar slots fora do executor
- alterar resposta final

### Disciplina do snapshot

O snapshot continua sendo a interpretacao soberana e unica do turno.

Regras obrigatorias:

- a mensagem e interpretada uma unica vez
- o snapshot e imutavel durante o turno
- executores nao reinterpretam a mensagem
- renderers nao reinterpretam intencao

Se faltar informacao para decidir:

- adicionar campo no snapshot

Evitar:

- helpers novos que reinterpretam intencao
- regex de fallback espalhadas
- heuristicas de canal alterando semantica

### Limites de responsabilidade

`DecisionEngine`:

- decide apenas qual acao deve acontecer
- nao deve absorver renderizacao, disponibilidade, persistencia, calculo de duracao ou logica de canal

`Executors`:

- aplicam patch de estado
- preparam dados para renderizacao
- executam a etapa decidida
- nao decidem intencao
- nao chamam IA
- nao alteram precedencia

`Renderers`:

- transformam decisao em resposta
- escolhem template
- injetam variaveis
- adaptam apresentacao por canal
- nao alteram estado
- nao alteram fluxo
- nao decidem intencao

### Radar permanente de recontaminacao

Mesmo com o `semantic_core` ativo, estes arquivos continuam como pontos de risco:

- `turn-handler.ts`
- `orchestrator-actions.ts`
- `qualification.ts`
- `resolve-booking.ts`

Regra operacional:

- se `semantic_core` estiver ativo para um turno, o legado nao deve influenciar a decisao desse turno

### Multiagendamento e sequencia continuam sensiveis

Casos que precisam permanecer no radar:

- perda de contexto apos respostas curtas
- sequencia de pessoas quebrando
- confirmacao parcial
- continuidade apos finalizacao
- duracao real de servicos na sequencia
- disponibilidade real do calendario
- intervalos minimos
- colaborador selecionado

Respostas curtas que continuam criticas:

- `pode ser`
- `o outro depois`
- `usa o mesmo contato`
- `sim`
- `esse mesmo`

### Observabilidade e testes sao parte do motor

Cada turno do `semantic_core` deve continuar registrando:

- snapshot gerado
- policy aplicada
- decisao tomada
- executor acionado
- patches de estado
- resposta renderizada
- motivos de fallback, ambiguidades, `slot repairs` e quebra de sequencia

A matriz de aceite precisa continuar virando fixture executavel.

Prioridades de fixture:

- saudacao seguida de booking
- pergunta de preco sem virar booking
- booking com servico citado na primeira frase
- multiagendamento com nomes
- multiagendamento sem nomes
- sequencia natural
- interrupcao informacional no meio do booking
- resposta curta no meio do fluxo
- retomada de continuidade

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

Estrutura alvo:

- `intents`
- `entities`
- `signals`
- `risks`
- `meta`

Campos atuais:

- `intents.primary`
- `intents.secondary`
- `intents.booking`
- `intents.confidence`
- `entities.people`
- `entities.attendee_names`
- `entities.services`
- `entities.date`
- `entities.time`
- `signals.includes_self`
- `signals.additional_count`
- `signals.sequence_request`
- `signals.availability_check`
- `signals.next_question_hint`
- `risks.audience`
- `risks.ambiguities`
- `meta.raw_user_message`

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
- ela deve ser modular, para nao virar o novo monolito

Estrutura alvo:

- `decision-engine/greeting.ts`
- `decision-engine/informational.ts`
- `decision-engine/booking.ts`
- `decision-engine/fallback.ts`
- `decision-engine/index.ts`

Estado atual:

- essa divisao modular ja existe no semantic core
- `decision-engine.ts` agora e apenas um re-export para o dispatcher modular

## 4.1 `policy_layer`

Camada entre:

- `turn_semantic_snapshot`
- `decision_engine`

Responsavel por:

- confidence guard
- enforcement de politicas de publico
- futuras regras de compliance e lead policy

Estado atual:

- `semantic-core/policy-layer.ts` ja existe
- hoje aplica `confidence guard`
- ja centraliza enforcement inicial de publico atendido:
  - bloqueio de publico incompatível
  - confirmacao de publico ambiguo
- quando a confianca e baixa, o runtime gera `ask_clarification` em vez de cair em `handoff_fallback`

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
- a biblioteca de prompts deve ser unica, sem adapter paralelo montando mensagens concorrentes

### Estado atual desta camada

Arquivos novos/ativos:

- `supabase/functions/conversations-turn/lib/semantic-core/renderers/prompt-library.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/renderers/greeting.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/renderers/informational.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/renderers/booking.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/renderers/index.ts`

Diretriz aplicada:

- `prompt-library.ts` passa a ser a fonte unica de texto-base do semantic core
- `greeting`, `informational` e `booking` apenas escolhem a mensagem e injetam variaveis
- o `adapter.ts` legado do semantic core fica obsoleto e deve ser removido para evitar duas fontes de renderizacao

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
- rollout controlado adicional:
  - `CONVERSATION_TURN_ENGINE_CHANNELS`
  - `CONVERSATION_TURN_ENGINE_SESSION_IDS`
  - `CONVERSATION_TURN_ENGINE_SENDER_IDS`

Semantica do rollout controlado:

- se `CONVERSATION_TURN_ENGINE=legacy`, o motor novo nao entra
- se `CONVERSATION_TURN_ENGINE=semantic_core` e nao houver allowlists, o motor novo entra globalmente
- se houver allowlists configuradas, o motor novo so entra quando todos os filtros configurados coincidirem com:
  - canal
  - sessao
  - remetente

### Playbook de ativacao controlada

1. ativar apenas no simulador:
   - `CONVERSATION_TURN_ENGINE=semantic_core`
   - `CONVERSATION_TURN_ENGINE_CHANNELS=web_simulator`

2. ativar para um remetente especifico no WhatsApp:
   - `CONVERSATION_TURN_ENGINE=semantic_core`
   - `CONVERSATION_TURN_ENGINE_CHANNELS=whatsapp`
   - `CONVERSATION_TURN_ENGINE_SENDER_IDS=whatsapp:55119...`

3. ativar para uma sessao especifica:
   - `CONVERSATION_TURN_ENGINE=semantic_core`
   - `CONVERSATION_TURN_ENGINE_SESSION_IDS=fixture-session-123`

4. rollback imediato:
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

### Implementacao inicial desta fase

Arquivos:

- `supabase/functions/conversations-turn/lib/semantic-core/renderers/shared.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/renderers/index.ts`

Regra aplicada:

- o semantic core continua produzindo a mesma decisao e os mesmos prompts
- a diferenca de canal acontece apenas na formatacao final de `action_options`

Comportamento atual:

- `web_simulator`
  - recebe opcoes cruas para a UI renderizar botoes/seletores
- `whatsapp`
  - recebe opcoes numeradas quando o canal pede resposta numerica
  - preserva opcoes em texto livre quando a decisao nao pede numeracao

Observacao:

- a logica de negocio continua em:
  - snapshot
  - policy layer
  - decision engine
  - executors
- o renderer por canal so adapta apresentacao

## Fase 8 - Observabilidade

- [ ] logar snapshot semantico por turno
- [ ] logar decisao tomada
- [ ] logar executor acionado
- [ ] logar motivo de fallback
- [ ] logar porque uma sequencia nao foi seguida

### Implementacao inicial desta fase

Arquivos:

- `supabase/functions/conversations-turn/lib/semantic-core/logging.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/runtime.ts`
- `supabase/functions/conversations-turn/lib/semantic-core/renderers/index.ts`

Cobertura atual:

- `snapshot`
- `policy`
- `decision`
- `execution`
- `render`

Variavel de controle:

- `SEMANTIC_CORE_DEBUG=true`

Campos de rastreio incluidos:

- `channel`
- `session_id`
- `sender_id`

Objetivo:

- diagnosticar por turno:
  - como a mensagem foi interpretada
  - qual politica interferiu
  - qual acao foi escolhida
  - qual executor aplicou patch
  - qual mensagem foi renderizada

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
- [x] rollout controlado por canal, sessao e remetente
- [x] observabilidade inicial por turno no semantic core
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
- `processSimulatorMessage(...)` e `handleBookingModeMessage(...)` agora tambem propagam:
  - `runtime.channel`
  - `runtime.sessionId`
  - `runtime.senderId`
  para evitar que entrypoints internos avaliem a flag sem contexto
- se a flag nao estiver ativa, continua no legado

### Primeiro corte de autoridade do legado

Quando o `semantic_core` esta ativo para a sessao corrente:

- `processSimulatorMessage(...)` sai antes das heuristicas locais e do pipeline legado
- `handleBookingModeMessage(...)` sai antes dos interceptores legados de preco/lista/detalhe
- o `turn-handler` nao deve continuar reinterpretando intencao principal nem preencher slots em paralelo

Este e o primeiro corte efetivo de soberania:

- o legado continua existindo como fallback para sessoes nao ativadas
- mas perde autoridade semantica nas sessoes em que o motor novo foi habilitado

### Segundo corte de autoridade do legado

Com o `semantic_core` ativo:

- o atalho legado de `tryHandleExternalQuote(...)` deixa de interceptar a conversa
- o pos-processamento legado de `rewriteWithTone(...)` nao reescreve a resposta do motor novo
- o ajuste legado de `interaction_style === conversational` nao reformatta opcoes do semantic core

Objetivo:

- impedir que o motor novo produza uma resposta e o legado altere semantica ou UX por fora

### Terceiro corte de autoridade do legado

Com o `semantic_core` ativo:

- a inferencia legada de `service_multi_select` no `index.ts` deixa de governar a resposta
- o payload de resposta passa a usar hint do proprio motor novo para indicar multi-selecao de servicos

Objetivo:

- impedir que a UX final do semantic core continue dependendo de heuristica de estado do legado
- reduzir mais um ponto em que a camada antiga ainda tentava "entender" a etapa atual da conversa

### Quarto corte de autoridade do legado

Com o `semantic_core` ativo:

- o `index.ts` deixa de inspecionar `decision.action` e `channel_hints` para inferir `service_multi_select`
- esse hint passa a sair do proprio renderer do semantic core via `render_hints`

Objetivo:

- impedir que o entrypoint continue lendo semantica do motor novo para decidir UX
- reforcar que:
  - semantic core decide
  - renderer adapta
  - edge function apenas entrega a resposta

### Quinto corte de autoridade do legado

- a implementacao duplicada de `handleBookingModeMessage` em `lib/turn/booking-mode.ts` foi removida
- o caminho ativo de modo booking passa a existir apenas em `lib/turn-handler.ts` enquanto o legado ainda estiver vivo

Objetivo:

- reduzir superficie duplicada de comportamento no booking legado
- evitar que uma segunda implementacao fique desatualizada e reintroduza divergencia durante a transicao

### Sexto corte de superficie duplicada do legado

- wrappers locais de `resolveQuote(...)` em `turn-handler.ts` e `turn/early/reject-and-first.ts` foram removidos
- o fluxo legado continua chamando `resolveQuote(...)`, mas sem helpers paralelos de um unico retorno

Objetivo:

- reduzir pontos redundantes de entrada em quote mode
- manter a desmontagem do legado coerente por responsabilidade unica

### Setimo corte de superficie duplicada do legado

- a bifurcacao redundante de `handleBookingModeMessage(...)` para `isFirst && !isGreeting(text)` foi removida
- o caminho legado de booking nesse ponto volta a ter uma unica saida: `resolveBooking(...)`

Objetivo:

- reduzir mais um desvio sem semantica propria no booking legado
- manter a desmontagem incremental focada em duplicacoes reais antes de cortes mais agressivos de autoridade

### Oitavo corte de superficie duplicada do legado

- a decisao legada de "entrar em booking" em `qualification` e `qualification_rejected` foi consolidada em um helper unico
- o legado continua podendo entrar em booking nesses pontos, mas sem duplicar a mesma combinacao de:
  - `hasStrongBookingIntent`
  - `booking_request.booking_intent`
  - `orchestrator.suggested_action === start_booking`
  - `confidence >= minOrchestratorConfidence`

Objetivo:

- reduzir mais um ponto de precedencia duplicada no caminho antigo
- deixar mais explicito, no proprio legado, qual e o criterio unico de entrada em booking enquanto ele ainda existir

### Nono corte parcial de superficie duplicada do legado

- o entrypoint da Edge Function agora tem um helper unico (`runMainConversationFlow`) para acionar:
  - `semantic_core`
  - ou `processSimulatorMessage(...)`
- os ramos `external` e `internal` passaram a usar esse helper unico

Objetivo:

- reduzir divergencia entre os dois caminhos principais do entrypoint
- concentrar o dispatch principal do entrypoint em uma unica funcao local antes de novos cortes de autoridade do legado

### Decimo corte de superficie duplicada do legado

- a preparacao de estado no caminho legado de `qualification` para `preco -> possivel booking` foi consolidada em um helper unico
- o fluxo antigo ainda oferece preco/lista normalmente, mas sem repetir a mesma mutacao de:
  - `mode = booking`
  - `step = undefined`
  - inferencia de booking adicional
  - preenchimento de `attendee_name` por `for_whom`

Objetivo:

- reduzir duplicidade no booking legado sem alterar a precedencia atual
- preparar cortes futuros onde o semantic core assuma de vez essa etapa

### Decimo primeiro corte de superficie duplicada do legado

- a mutacao repetida de `match.service` no caminho legado de `qualification` foi consolidada em um helper unico
- o fluxo antigo continua podendo:
  - promover o servico para booking imediato
  - ou apenas preparar `slots.service` no fallback
- mas sem repetir em mais de um ponto a mesma escrita de:
  - `slots.service`
  - `just_identified_service`
  - `step = undefined`

Objetivo:

- reduzir mais uma superficie de escrita paralela de slots no legado
- preparar o terreno para o semantic core assumir de vez a promocao de servico no fluxo de qualification

### Decimo segundo corte de superficie duplicada do legado

- o setup repetido de multiagendamento inicial no legado foi consolidado em um helper unico
- a mesma mutacao de:
  - `pending_additional_booking`
  - `pending_attendee_name`
  - `pending_additional_count`
  - `expected_additional_count`
  nao fica mais espalhada em varios pontos do `turn-handler.ts`

Objetivo:

- reduzir mais uma classe de escrita paralela de state no booking legado
- deixar mais previsivel a continuidade do multiagendamento enquanto o semantic core ainda nao substituiu 100% esse caminho

### Decimo terceiro corte de superficie duplicada do legado

- os branches legados que retomam fluxo por nome de atendido agora reutilizam o mesmo helper de setup de multiagendamento
- isso cobre:
  - retomada quando a ultima pergunta era "de quem sera o primeiro/proximo agendamento?"
  - extracao de nome no branch de recuperacao
  - retomada tardia no fallback final

Objetivo:

- reduzir divergencia de state na continuidade do multiagendamento
- aproximar os pontos de retomada do legado de um comportamento unico antes da substituicao total pelo semantic core

## Guardrails reforcados para a continuacao da refatoracao

Os pontos abaixo passam a fazer parte do plano de implementacao, nao apenas como principios gerais.

### Soberania do semantic core

- se o `semantic_core` estiver ativo para um turno, ele deve ser a unica autoridade semantica daquele turno
- qualquer necessidade nova de entendimento deve entrar no `TurnSemanticSnapshot`
- nao criar novas inferencias paralelas fora do snapshot builder

### Limites por camada

- `DecisionEngine` escolhe a proxima acao; nao renderiza, nao persiste, nao calcula disponibilidade detalhada
- executores aplicam a decisao; nao reinterpretam mensagem e nao chamam IA
- renderers adaptam apresentacao por canal; nao alteram fluxo nem regra de negocio

### Estado versus interpretacao

- interpretacao temporaria pertence ao snapshot
- execucao confirmada e continuidade pertencem ao state
- novos campos de state devem sempre responder: "isto e execucao ou interpretacao?"

### Observabilidade obrigatoria

Durante rollout do `semantic_core`, cada turno deve continuar registrando:

- snapshot final
- policy aplicada
- decisao tomada
- executor acionado
- patches de estado
- render final
- motivo de fallback, reparo, ambiguidade ou sequencia nao aplicada

### Multiagendamento como caso principal

- multiagendamento continua tratado como caminho principal de validacao
- respostas curtas e caoticas (`sim`, `pode ser`, `esse mesmo`, `usa o mesmo contato`) devem continuar preservando contexto
- sequencia deve sempre respeitar duracao real e disponibilidade real

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

### Consolidacao recente

- contexto derivado de booking extraido para semantic-core/booking-context.ts`r
- decision-engine.ts deixou de remontar fila, slots e passos faltantes em varios blocos
- objetivo: uma fonte unica para progresso de booking dentro do semantic core


- renderers e executores de booking agora consomem semantic-core/booking-context.ts como fonte unica de progresso de booking
- isso reduz leituras paralelas de state, snapshot e usiness_brain para multiagendamento e sequencia


- lifecycle de booking estruturado em semantic-core/booking-lifecycle.ts`r
- finalizacao agora produz completed_booking e post_confirmation_plan como metadados estruturados
- isso prepara a migracao da confirmacao real de multiagendamento para o semantic core


- renderer de booking agora consome completed_booking e post_confirmation_plan`r
- semantic core passa a renderizar confirmacao e continuidade de multiagendamento com base em metadados estruturados, nao em texto solto


- booking-finalization agora atualiza estado real de continuidade no semantic core`r
- passa a alimentar:
  - completed_bookings
  - booked_slots
  - last_booking
  - pending_attendee_queue
  - pending_template_choice
  - pending_calendar_offer
- isso reduz dependencia do legado na transicao entre um booking concluido e o proximo atendimento


- fila dinamica de pessoas inferidas consolidada no semantic core`r
- nomes ja informados pelo cliente entram em uma fila operacional unica
- o atendido atual e removido da fila ao ser assumido
- a continuidade do multiagendamento reaproveita essa fila sem re-perguntar nomes ja citados


- finalizacao multipla agora gera metadados estruturados de calendario e notificacoes`r
- post_confirmation_plan passa a carregar:
  - should_offer_calendar
  - outbound_notifications
  - calendar_targets
- isso prepara a migracao do pos-confirmacao real sem espalhar essa logica de novo pelo legado


- paridade informacional melhorada no semantic core`r
- FAQ, endereco, horarios e resumo do proprio agendamento agora reaproveitam a base informativa do legado
- respostas de preco e detalhe de servico passaram a usar contexto estruturado do business_brain


- harness inicial de testes do semantic core criado`r
- cobre:
  - fila dinamica de pessoas inferidas
  - promocao do atendido atual a partir da fila
  - continuidade do multiagendamento apos confirmacao
- cobertura expandida para:
  - sequencia respeitando duracao total dos servicos
  - bloqueio de publico incompatível
  - confirmacao de publico ambiguo
- execucao local depende de `deno test`, que ainda nao esta disponivel neste ambiente


- runner de fixture do pipeline semantico criado`r
- permite testar localmente, sem IA externa, a cadeia:
  - snapshot fixture
  - policy layer
  - decision engine
  - executor
  - renderer
- fixtures iniciais cobrem:
  - FAQ com endereco real
  - confirmacao com proxima pessoa ja inferida
  - oferta de template de sequencia para a proxima pessoa
- cobertura ampliada para:
  - saudacao com fallback controlado
  - preco com valor real configurado
  - detalhe de servico com descricao real
  - sequencia same_next sem slot disponivel
  - continuidade multi-turno no web_simulator
  - confirmacao seguida de proxima pessoa ja inferida
  - selecao de template de sequencia seguida de escolha de servico
  - pergunta informacional antes de booking sem perder continuidade
  - resposta curta/imprecisa sem derrubar o contexto de sequencia
  - recuperacao apos same_next indisponivel
  - confirmacao de publico no meio do booking
  - resposta curta preservando contexto de selecao de data
  - fila dinamica encadeada com varios nomes ja inferidos
  - FAQ antes de pedido multiplo caotico sem perder continuidade


- decimo quarto corte de superficie duplicada do legado`r
- a entrada em modo booking no caminho legado agora passa por um helper unico:
  - `applyLegacyBookingModeState(...)`
- o setup repetido do ramo `qualification_rejected` de preco tambem passou a reutilizar:
  - `applyLegacyPriceBookingLeadContext(...)`
- isso reduz escrita paralela de:
  - `mode = "booking"`
  - `step = undefined`
  - setup inicial de lead para preco -> booking


- decimo quinto corte de autoridade do legado`r
- o `turn-handler.ts` deixou de ter uma segunda porta de entrada para o `semantic_core`
- a avaliacao da flag e o dispatch para:
  - `runSemanticCoreTurn(...)`
  - `renderSemanticSimulatorResult(...)`
  passam a existir apenas no `index.ts`
- `processSimulatorMessage(...)` e `handleBookingModeMessage(...)` deixam de reavaliar:
  - `channel`
  - `sessionId`
  - `senderId`
  para decidir se desviam para o motor novo

Objetivo:

- remover duplicidade de dispatch entre entrypoint e legado
- reforcar que a soberania do `semantic_core` comeca no entrypoint principal
- evitar que o handoff semantico dependa de uma segunda checagem espalhada no `turn-handler`


- decimo sexto corte de autoridade do legado`r
- `handleBookingModeMessage(...)` deixou de responder por conta propria perguntas de preco
- esse caminho passa a cair no pipeline unificado de `resolveBooking(...)`
- o booking legado ja tinha tratamento equivalente mais abaixo, em seus handlers internos

Objetivo:

- reduzir o papel de mini-orquestrador no `turn-handler`
- aproximar o modo booking legado de um unico ponto de entrada operacional


- decimo setimo corte de superficie duplicada do legado`r
- perguntas de lista e detalhe de servico em modo booking passaram a ser tratadas logo no inicio de `resolveBooking(...)`
- o helper compartilhado `tryHandleServicesQuestionAnytime(...)` passa a ser reutilizado nesse ponto
- `handleBookingModeMessage(...)` fica reduzido a uma delegacao direta para `resolveBooking(...)`

Objetivo:

- concentrar mais uma responsabilidade informacional em um unico ponto do booking legado
- remover do `turn-handler` a responsabilidade de responder `lista/detalhe` em modo booking


- decimo oitavo corte de superficie duplicada do legado`r
- o ramo `qualification` passou a reutilizar `tryHandleServicesQuestionAnytime(...)` para perguntas de lista e detalhe de servico
- o ramo `qualification_rejected` tambem passou a reutilizar o mesmo helper compartilhado
- `lista/detalhe` deixam de ter respostas locais separadas por fase nesses dois pontos

Objetivo:

- reduzir mais uma classe de resposta semantica duplicada no legado
- aproximar `qualification`, `qualification_rejected` e booking de uma mesma fonte para perguntas informacionais sobre servicos

- decimo nono corte parcial de superficie duplicada do legado`r
- `orchestrator-actions.ts` passou a ter um helper local para o setup repetido de `preco -> lead de booking`:
  - `applyOrchestratorPriceBookingLeadContext(...)`
- parte dos ramos `answer_price` do orquestrador legado ja deixou de repetir manualmente:
  - `mode = "booking"`
  - `step = undefined`
  - setup de multiagendamento por `interpretAdditionalBookingsWithAI(...)`
  - reaproveitamento de `for_whom` para `attendee_name`
- esta consolidacao ainda nao cobre 100% dos blocos equivalentes em `orchestrator-actions.ts`

Objetivo:

- continuar drenando duplicidade semantica do orquestrador legado sem alterar precedencia de fluxo
- preparar cortes seguintes em `answer_price`, `list_services` e `start_booking` com menor risco

- vigesimo corte de superficie duplicada do legado`r
- os dois ramos principais de `answer_price` em `orchestrator-actions.ts` passaram a reutilizar:
  - `applyOrchestratorPriceBookingLeadContext(...)`
- isso cobre:
  - `handleQualificationRejectedOrchestratorAction(...)`
  - `handleQualificationOrchestratorAction(...)`
- o orquestrador legado deixa de repetir nesses pontos a mesma combinacao de:
  - `mode = "booking"`
  - `step = undefined`
  - leitura de `interpretAdditionalBookingsWithAI(...)`
  - promocao de `for_whom` para `attendee_name`
  - setup inicial de multiagendamento

Objetivo:

- reduzir mais uma classe de preparacao de estado semantico espalhada no orquestrador legado
- preparar os proximos cortes em `list_services`, `service_detail` e entrada em booking com menos ruido estrutural

- vigesimo primeiro corte de superficie duplicada do legado`r
- os ramos equivalentes de `list_services` em `orchestrator-actions.ts` passaram a reutilizar:
  - `buildAfterGenericServicesListResult(...)`
- isso cobre:
  - `handleQualificationRejectedOrchestratorAction(...)`
  - `handleQualificationOrchestratorAction(...)`
- o orquestrador legado deixa de repetir nesses pontos:
  - montagem de `buildListServicesMessage(config, { intro: "after_generic" })`
  - coleta de `serviceOptions`
  - escrita de `last_service_options`
  - variacao de `step` para `qualification` quando necessario

Objetivo:

- reduzir mais uma classe de resposta informacional duplicada no orquestrador legado
- preparar os proximos cortes em `service_detail` e `start_booking` com menos ruido estrutural

- vigesimo segundo corte de superficie duplicada do legado`r
- os ramos equivalentes de `start_booking` em `orchestrator-actions.ts` passaram a reutilizar:
  - `buildStartBookingOrchestratorHandler(...)`
- isso cobre:
  - `handleQualificationRejectedOrchestratorAction(...)`
  - `handleQualificationOrchestratorAction(...)`
  - `handleFirstMessageOrchestratorAction(...)`
- o orquestrador legado tambem passou a reutilizar:
  - `buildOrchestratorFallbackResult(...)`
  nos ramos `no_match_fallback` com e sem `step = "qualification"`

Objetivo:

- reduzir mais uma classe de entrada em booking repetida no orquestrador legado
- consolidar o fallback generico com IA contextual em um ponto unico antes dos proximos cortes em `service_detail` e respostas informacionais da primeira mensagem

- vigesimo terceiro corte de superficie duplicada do legado`r
- o tail compartilhado de `ask_clarification` em `orchestrator-actions.ts` passou a reutilizar:
  - `buildAiClarificationOrNull(...)`
- isso cobre:
  - `handleQualificationRejectedOrchestratorAction(...)`
  - `handleQualificationOrchestratorAction(...)`
- o ramo `qualification_rejected` preserva a sua guarda especifica de rejeicao por area antes de cair no helper compartilhado

Objetivo:

- reduzir mais uma classe de resposta de esclarecimento duplicada no orquestrador legado
- deixar os proximos cortes em `service_detail` e `list_services` da primeira mensagem mais isolados e menos ruidosos

- vigesimo quarto corte de superficie duplicada do legado`r
- os ramos informacionais da primeira mensagem em `orchestrator-actions.ts` passaram a reutilizar:
  - `buildFirstMessageServicesListResult(...)`
  - `buildFirstMessageServiceDetailResult(...)`
- isso cobre:
  - `list_services` em `handleFirstMessageOrchestratorAction(...)`
  - `service_detail` em `handleFirstMessageOrchestratorAction(...)`
- a montagem de vitrine inicial com `step = "qualification"` e a resposta de detalhe de servico deixam de ficar inline no handler principal

Objetivo:

- reduzir mais uma classe de resposta informacional espalhada no orquestrador legado
- deixar o handler da primeira mensagem mais proximo de uma tabela de dispatch, com menos interpretacao local embutida

- vigesimo quinto corte de superficie duplicada do legado`r
- `turn-handler.ts` passou a reutilizar dois helpers locais para o fluxo legado de qualification:
  - `tryEnterLegacyBookingFromSignals(...)`
  - `tryBuildLegacyDirectInquiryRejection(...)`
- isso cobre os ramos:
  - `qualification_rejected`
  - `qualification`
- a entrada em booking por sinais (`regex` forte, `booking_intent`, `suggested_action = start_booking`) e a rejeicao contextual de inquiry direto deixam de ficar duplicadas inline nesses dois blocos

Objetivo:

- reduzir mais uma classe de decisao semantica duplicada no `turn-handler`
- preparar a consolidacao seguinte da logica legada de `answer_price` em `qualification` e `qualification_rejected`

- vigesimo sexto corte de superficie duplicada do legado`r
- a logica legada de `isPriceQuestion(...)` em `turn-handler.ts` passou a reutilizar:
  - `tryHandleLegacyPriceQuestion(...)`
- isso cobre os ramos:
  - `qualification_rejected`
  - `qualification`
- o helper concentra:
  - preco conhecido com entrada em booking
  - rejeicao contextual quando nao ha servico valido
  - lista de servicos com preco
  - fallback de servico sem preco ou preco generico quando o ramo permite

Objetivo:

- reduzir uma das maiores ilhas de duplicidade semantica restantes no `turn-handler`
- deixar o legado mais proximo de um conjunto de helpers operacionais, em vez de blocos inline que reinterpretam a mesma pergunta de preco em fases diferentes

- vigesimo setimo corte de superficie duplicada do legado`r
- o fallback final de `qualification` em `turn-handler.ts` passou a reutilizar:
  - `resolveLegacyQualificationMatchFallback(...)`
- o helper concentra:
  - promocao de servico identificado
  - rejeicao contextual com ou sem `step = "qualification_rejected"`
  - fallback para `buildGuidedClarification(...)`

- vigesimo oitavo corte de superficie duplicada do legado`r
- a triagem inicial do bloco geral de fallback em `turn-handler.ts` passou a reutilizar:
  - `tryResolveLegacyQualificationEntryMatch(...)`
- esse helper concentra:
  - promocao de servico identificado para continuar o fluxo
  - rejeicao com `step = "qualification_rejected"`
  - redirecionamento para `step = "qualification"`
  - fallback inicial para `buildGuidedClarification(...)`

Objetivo:

- reduzir mais uma area grande de decisao semantica inline no `turn-handler`
- aproximar o legado de helpers operacionais pequenos antes dos proximos cortes em entrada geral, fallback e handoff para booking

- vigesimo nono corte de superficie duplicada do legado`r
- o bloco geral do fim de `processSimulatorMessage(...)` passou a reutilizar:
  - `tryEnterLegacyAnyTurnBooking(...)`
  - `tryRejectInvalidLegacyBookingEntry(...)`
- isso cobre:
  - a entrada any-turn em booking por `booking_intent`
  - a rejeicao de entrada invalida quando o legado caiu em `mode = "booking"` sem servico valido

Objetivo:

- reduzir mais uma camada de decisao local antes do handoff para `handleBookingModeMessage(...)`
- deixar o fluxo principal mais proximo de um encadeamento de helpers pequenos, em vez de condicoes inline espalhadas

- trigesimo corte de superficie duplicada do legado`r
- os desvios curtos do fim de `processSimulatorMessage(...)` passaram a reutilizar:
  - `tryHandleLegacyGreetingEntry(...)`
  - `tryResolveLegacyAskMode(...)`
- isso cobre:
  - resposta inicial de greeting com entrada em `qualification`
  - resolucao do estado `ask_mode` antes do handoff para booking/quote

Objetivo:

- reduzir mais uma camada de condicao inline no fluxo principal
- deixar o trecho final do `turn-handler` mais linear e mais proximo de uma sequencia de helpers de dispatch

- trigesimo primeiro corte de superficie duplicada do legado`r
- a triagem inicial de `qualification` em `turn-handler.ts` passou a reutilizar:
  - `tryResolveLegacyQualificationServiceGate(...)`
- o helper concentra:
  - `match.service -> booking` com `buildBookingConfirmationIntro(...)`
  - rejeicao contextual com `step = "qualification_rejected"` quando a area nao bate com servicos validos

Objetivo:

- reduzir mais uma decisao semantica relevante inline antes do booking legado
- aproximar `qualification` de um fluxo mais declarativo, com gates pequenos antes do handoff para orquestrador/booking

- trigesimo segundo corte de superficie duplicada do legado`r
- o fallback final de `qualification_rejected` em `turn-handler.ts` passou a reutilizar:
  - `resolveLegacyRejectedMatchFallback(...)`
- o helper concentra:
  - o recheck final de inquiry direto
  - a classificacao final por area
  - a montagem da rejeicao final no estado atual

Objetivo:

- reduzir mais uma ilha de rejeicao semantica inline no ramo `qualification_rejected`
- deixar esse ramo mais proximo de uma sequencia linear de helpers antes do retorno final

- trigesimo terceiro corte de superficie duplicada do legado`r
- a deteccao de resposta de attendee name no `turn-handler.ts` passou a reutilizar:
  - `getLegacyAttendeeTurnSignals(...)`
- isso cobre:
  - o hard-guard inicial de entrada direta em booking
  - a recuperacao do bloco geral antes da triagem any-turn

- trigesimo quarto corte de superficie duplicada do legado`r
- a confirmacao de publico que dispara fluxo multiplo em `qualification` passou a reutilizar:
  - `tryApplyLegacyAudienceConfirmation(...)`

Objetivo:

- reduzir mais duas classes de decisao de multiagendamento espalhadas no fluxo principal
- aproximar o legado de helpers reutilizaveis tambem nos pontos de recuperacao e resposta curta, nao so nos ramos principais

- trigesimo quinto corte de superficie duplicada do legado`r
- os handoffs de booking por sinais de attendee name no `turn-handler.ts` passaram a reutilizar:
  - `tryEnterLegacyBookingFromAttendeeSignals(...)`
- isso cobre:
  - o hard-guard inicial com handoff imediato para booking
  - a recuperacao no bloco geral, preservando apenas a preparacao de estado quando nao deve haver handoff imediato

- trigesimo sexto corte de superficie duplicada do legado`r
- o dispatch do orquestrador nas fases legadas passou a reutilizar:
  - `tryHandleLegacyPhaseOrchestrator(...)`
- isso cobre:
  - `qualification_rejected`
  - `qualification`

Objetivo:

- reduzir mais uma classe de handoff duplicado para booking no multiagendamento
- consolidar o ponto em que o legado decide se o orquestrador ainda tem autoridade para responder naquela fase

- trigesimo setimo corte de superficie duplicada do legado`r
- `qualification.ts` passou a reutilizar:
  - `buildFirstAttendeePrompt(...)`
  para o prompt de multiagendamento quando ainda falta o primeiro nome

- trigesimo oitavo corte de superficie duplicada do legado`r
- `qualification.ts` passou a reutilizar:
  - `resolveBookingWithOptionalIntro(...)`
  para os handoffs `resolveBooking(...) + intro opcional`
- isso cobre:
  - o ramo de `sequenceServices.length >= 2`
  - o ramo de `identifiedService`

Objetivo:

- reduzir duplicidade interna em `enterBookingFromIntent(...)`
- preparar esse helper para futuros cortes sem espalhar novamente a mesma montagem de resposta de booking

- trigesimo nono corte de superficie duplicada do legado`r
- `qualification.ts` passou a reutilizar:
  - `applyRequestMultiBookingState(...)`
  para a preparacao de multiagendamento a partir de `bookingRequest`

- quadragesimo corte de superficie duplicada do legado`r
- `qualification.ts` passou a reutilizar:
  - `resolveBookingIntentService(...)`
  para a resolucao final do servico identificado a partir de:
  - `orchestrator.inferred_service`
  - `nextState.slots.service`
  - `findServiceFromText(...)`

Objetivo:

- reduzir mais duas ilhas internas de interpretacao semantica em `enterBookingFromIntent(...)`
- preparar o helper de entrada em booking para cortes seguintes em identificacao de pessoa/servico e multiagendamento

- quadragesimo primeiro corte de superficie duplicada do legado`r
- `qualification.ts` passou a reutilizar:
  - `hydrateBookingIntentAttendee(...)`
  para consolidar a hidratacao de `attendee_name` e `customer_name`

- quadragesimo segundo corte de superficie duplicada do legado`r
- `qualification.ts` passou a reutilizar:
  - `buildBookingIntentServicePrompt(...)`
  para consolidar o prompt final de selecao de servico e a configuracao de `service_selection_multi`

Objetivo:

- reduzir mais dois blocos inline dentro de `enterBookingFromIntent(...)`
- aproximar esse helper de uma sequencia de etapas pequenas e testaveis, em vez de uma unica funcao grande com multiplas decisoes semanticas embutidas

- quadragesimo terceiro corte de superficie duplicada do legado`r
- `qualification.ts` passou a reutilizar:
  - `tryHandleBookingIntentAudiencePolicy(...)`
  para concentrar a politica de audiencia na entrada em booking por intencao

- quadragesimo quarto corte de superficie duplicada do legado`r
- `qualification.ts` passou a reutilizar:
  - `applyBookingIntentRequestedService(...)`
  - `tryHandleBookingIntentSequenceServices(...)`
  para consolidar:
  - a hidratacao inicial de servico a partir de `bookingRequest` e `orchestrator`
  - o handoff imediato de servicos em sequencia para `resolveBooking(...)`

Objetivo:

- reduzir mais duas ilhas internas de decisao semantica em `enterBookingFromIntent(...)`
- aproximar esse helper de um pipeline linear de etapas pequenas antes do handoff de booking

- quadragesimo quinto corte de superficie duplicada do legado`r
- `qualification.ts` passou a reutilizar:
  - `enterBookingIntentMode(...)`
  - `parseBookingIntentRequest(...)`
  - `resolveBookingIntentAdditionalState(...)`
  para consolidar:
  - a entrada em `mode = "booking"` na variante por intencao
  - o parsing estruturado de `bookingRequest`, `requestServices` e `requestNames`
  - a interpretacao de adicionais com retorno antecipado quando ainda falta `attendee_name`

Objetivo:

- reduzir o restante das etapas inline de `enterBookingFromIntent(...)`
- deixar a funcao mais proxima de uma orquestracao curta entre helpers, em vez de continuar concentrando interpretacao e transicao de estado

- quadragesimo sexto corte de superficie duplicada do legado`r
- `resolve-booking.ts` passou a reutilizar:
  - `buildBookingNextState(...)`
  - `resolveBookingContactState(...)`
  para consolidar:
  - a montagem do `nextState` de booking
  - o calculo de `contactOk`, `bookingComplete` e `hasCompletedBooking`

- quadragesimo setimo corte de superficie duplicada do legado`r
- `resolve-booking.ts` passou a reutilizar:
  - `interpretBookingAdditionalContext(...)`
  para consolidar a interpretacao de adicionais e o calculo de:
  - `interpretedAdditional`
  - `interpretedCount`
  - `interpretedHasAdditional`

- quadragesimo oitavo corte de superficie duplicada do legado`r
- `resolve-booking.ts` passou a reutilizar:
  - `resolveBookingWaitingState(...)`
  - `interpretBookingSlotsContext(...)`
  para consolidar:
  - a resolucao de `lastAssistantMsg` e `waitingFor`
  - a chamada de `interpretSlotsFromMessageWithAI(...)` no contexto de booking

Objetivo:

- reduzir a autoridade semantica concentrada na montagem do `BookingContext`
- deixar `resolveBooking(...)` mais proximo de uma funcao de orquestracao curta antes do pipeline `BOOKING_HANDLERS`

- quadragesimo nono corte de superficie duplicada do legado`r
- `turn-handler.ts` passou a reutilizar:
  - `handoffLegacyBookingIntent(...)`
  para consolidar o handoff repetido de `enterBookingFromIntent(...)` em:
  - `tryEnterLegacyBookingFromSignals(...)`
  - `tryEnterLegacyAnyTurnBooking(...)`

Objetivo:

- reduzir mais um ponto de entrada duplicado em booking no legado
- deixar os ramos de booking por sinal e booking any-turn mais proximos de uma autoridade unica de handoff

- quinquagesimo corte de superficie duplicada do legado`r
- `turn-handler.ts` passou a reutilizar:
  - `prepareLegacyAdditionalBookingMode(...)`
  - `applyLegacyAttendeeName(...)`
  para consolidar:
  - a preparacao repetida de multiagendamento em `mode = "booking"`
  - a hidratacao de `attendee_name` e `customer_name` na resposta ao prompt de attendee

Objetivo:

- reduzir repeticao curta mas frequente no fluxo legado de multiagendamento
- deixar as entradas de attendee mais proximas de helpers unicos antes do handoff para booking

- quinquagesimo primeiro corte de superficie duplicada do legado`r
- `turn-handler.ts` passou a reutilizar:
  - `runLegacyQualificationRejectedPhase(...)`
  - `runLegacyQualificationPhase(...)`
  para concentrar a autoridade dos ramos:
  - `qualification_rejected`
  - `qualification`

Objetivo:

- reduzir o peso semantico inline dentro de `processSimulatorMessage(...)`
- deixar as fases legadas mais proximas de um dispatch curto para helpers dedicados, em vez de manter blocos extensos dentro do pipeline principal

- quinquagesimo segundo corte de superficie duplicada do legado`r
- `turn-handler.ts` passou a reutilizar:
  - `runLegacyFallbackPhase(...)`
  para concentrar o fallback geral de `processSimulatorMessage(...)`, incluindo:
  - recuperacao de attendee
  - entrada any-turn em booking
  - triagem final antes de `handleBookingModeMessage(...)` e `resolveQuote(...)`

Objetivo:

- reduzir a autoridade semantica inline remanescente no final do pipeline principal
- deixar `processSimulatorMessage(...)` mais proximo de um dispatch por fases, em vez de manter blocos extensos de recuperacao e fallback no corpo principal

- quinquagesimo terceiro corte de superficie duplicada do legado`r
- `turn-handler.ts` passou a reutilizar:
  - `tryHandleLegacyAttendeePromptAnswer(...)`
  para consolidar a resposta ao prompt de attendee name no primeiro phase do pipeline principal

Objetivo:

- reduzir mais uma ilha inline dentro de `phases`
- aproximar tambem a captura de attendee de um helper dedicado, em vez de manter a extracao e o handoff de booking diretamente no array de fases

- quinquagesimo quarto corte de superficie duplicada do legado`r
- `resolve-booking.ts` passou a reutilizar:
  - `resolveBookingTurnSignals(...)`
  - `buildBookingContext(...)`
  para consolidar:
  - os sinais do turno usados pelo pipeline de booking
  - a montagem final do `BookingContext` antes de `BOOKING_HANDLERS`

Objetivo:

- reduzir o restante da autoridade semantica inline na entrada do booking legado
- deixar `resolveBooking(...)` ainda mais proximo de uma orquestracao curta entre helpers e handlers

- quinquagesimo quinto corte de superficie duplicada do legado`r
- `qualification.ts` passou a reutilizar:
  - `tryPromptBookingIntentFirstAttendee(...)`
  - `tryResolveBookingIntentIdentifiedService(...)`
  para consolidar:
  - o retorno antecipado quando a entrada em booking ainda precisa do primeiro attendee
  - o handoff final quando o servico ja foi identificado em `enterBookingFromIntent(...)`

Objetivo:

- reduzir os ultimos ramos inline mais evidentes dentro de `enterBookingFromIntent(...)`
- deixar a entrada em booking por intencao ainda mais proxima de uma sequencia curta entre helpers

- quinquagesimo sexto corte de superficie duplicada do legado`r
- `turn-handler.ts` teve o array `phases` reescrito para deixar apenas os dispatches ativos de:
  - `tryHandleLegacyAttendeePromptAnswer(...)`
  - `runLegacyQualificationRejectedPhase(...)`
  - `runLegacyQualificationPhase(...)`
  - `runLegacyFallbackPhase(...)`

Objetivo:

- remover o codigo morto que ainda ficava abaixo dos retornos antecipados dentro de `phases`
- deixar `processSimulatorMessage(...)` mais legivel e mais proximo de um dispatcher enxuto por fase

- quinquagesimo setimo corte de superficie duplicada do legado`r
- `orchestrator-actions.ts` passou a reutilizar:
  - `buildOrchestratorMatchRejectionOrNull(...)`
  para consolidar a rejeicao contextual por area/servico nao mapeado em:
  - `handleQualificationRejectedOrchestratorAction(...)`
  - `buildQualificationServicesListOrNull(...)`
- o helper concentra:
  - `classifyServiceMatch(...)`
  - `hasMatchContext(...)`
  - `generateRejectionMessageWithAI(...)`

Objetivo:

- reduzir mais uma classe de rejeicao semantica duplicada dentro do orquestrador legado
- deixar os ramos de `ask_clarification` e `list_services` menos acoplados a classificacao inline

- quinquagesimo oitavo corte de superficie duplicada do legado`r
- `orchestrator-actions.ts` passou a reutilizar:
  - `buildOrchestratorAnswerPriceResult(...)`
  - `buildOrchestratorServiceLeadResult(...)`
  para consolidar os ramos `answer_price` de:
  - `handleQualificationRejectedOrchestratorAction(...)`
  - `handleQualificationOrchestratorAction(...)`
- o helper concentra:
  - rejeicao de `inferred_service` invalido
  - rejeicao contextual adicional quando a mensagem de preco nao bate com servico valido
  - setup de lead para booking via `applyOrchestratorPriceBookingLeadContext(...)`
  - resposta de preco conhecido
  - fallback para lista de servicos com preco

Objetivo:

- reduzir uma das maiores ilhas remanescentes de duplicidade no orquestrador legado
- deixar `qualification` e `qualification_rejected` mais proximos de uma tabela de acoes com helpers operacionais pequenos

- quinquagesimo nono corte de superficie duplicada do legado`r
- `orchestrator-actions.ts` passou a reutilizar:
  - `buildQualificationServicesListOrNull(...)`
  - `buildFirstMessageAnswerPriceResult(...)`
  - `buildFirstMessageClarificationResult(...)`
- isso consolidou:
  - a resposta de `list_services` com guarda contextual em `qualification`
  - a resposta de `answer_price` da primeira mensagem
  - o `ask_clarification` da primeira mensagem com `step = "qualification"`

Objetivo:

- reduzir mais uma camada de montagem inline no orquestrador legado
- aproximar tambem a primeira mensagem de um dispatch por helpers, e nao de blocos grandes por acao

- sexagesimo corte de superficie duplicada do legado`r
- `turn-handler.ts` voltou a concentrar em `runLegacyFallbackPhase(...)` os dispatches residuais de:
  - `tryEnterLegacyAnyTurnBooking(...)`
  - `tryHandleLegacyGreetingEntry(...)`
  - `ensureConversationMode(...)`
  - `tryResolveLegacyAskMode(...)`
- com isso, o fallback legado retoma no helper central a cobertura de:
  - entrada any-turn em booking
  - resposta inicial de saudacao
  - resolucao de `ask_mode`
  - handoff final para booking/quote

Objetivo:

- evitar que a limpeza estrutural do `phases` deixe comportamento operacional disperso ou perdido
- manter o fallback legado como um bloco unico e linear antes dos proximos cortes de superficie duplicada

- sexagesimo primeiro corte de superficie duplicada do legado`r
- `orchestrator-actions.ts` passou a reutilizar handlers dedicados para as acoes residuais:
  - `buildOrchestratorFallbackHandler(...)`
  - `buildClarificationWithOptionalRejectionHandler(...)`
  - `buildFirstMessageServiceDetailHandler(...)`
  - `buildFirstMessageClarificationHandler(...)`
- isso consolidou a montagem de handlers em:
  - `handleQualificationRejectedOrchestratorAction(...)`
  - `handleQualificationOrchestratorAction(...)`
  - `handleFirstMessageOrchestratorAction(...)`
- os ramos:
  - `no_match_fallback`
  - `ask_clarification`
  - `service_detail`
  deixam de montar closures inline repetidas entre os entrypoints do orquestrador

Objetivo:

- aproximar `orchestrator-actions.ts` de uma tabela de dispatch quase pura
- reduzir mais a superficie de manutencao dos fallbacks e esclarecimentos antes dos proximos cortes estruturais

- sexagesimo segundo corte de superficie duplicada do legado`r
- `turn-handler.ts` passou a reutilizar:
  - `getLegacyServiceMatchSummary(...)`
  para consolidar a camada repetida de:
  - `classifyServiceMatch(...)`
  - `hasMatchContext(...)`
  - `generateRejectionMessageWithAI(...)`
- isso foi aplicado em:
  - `tryBuildLegacyDirectInquiryRejection(...)`
  - `tryHandleLegacyPriceQuestion(...)`
  - `resolveLegacyQualificationMatchFallback(...)`
  - `tryResolveLegacyQualificationEntryMatch(...)`
  - `tryResolveLegacyQualificationServiceGate(...)`
  - `resolveLegacyRejectedMatchFallback(...)`

Objetivo:

- reduzir mais uma classe de classificacao semantica paralela dentro do `turn-handler`
- deixar os gates e fallbacks legados mais proximos de um conjunto pequeno de helpers compartilhados

- sexagesimo terceiro corte de superficie duplicada do legado`r
- `qualification.ts` passou a reutilizar:
  - `applyIdentifiedService(...)`
  para consolidar a promocao de `servico identificado`
- o helper agora e reaproveitado em:
  - `qualification.ts`
  - `orchestrator-actions.ts`
  - `turn-handler.ts`
- isso cobre os pontos que ainda repetiam:
  - `nextState.slots.service = ...`
  - `nextState.just_identified_service = true`
  - limpeza opcional de `step`

Objetivo:

- reduzir mais uma camada de estado operacional repetido entre booking intent, orquestrador e gates legados
- aproximar a promocao de servico de uma unica primitiva operacional antes dos proximos cortes de booking entry

- sexagesimo quarto corte de superficie duplicada do legado`r
- `qualification.ts` passou a exportar:
  - `handoffBookingIntent(...)`
  como primitiva compartilhada para o handoff em booking por intencao
- o helper agora e reutilizado em:
  - `turn-handler.ts`
  - `orchestrator-actions.ts`
- isso substitui wrappers locais que ainda duplicavam a mesma chamada para:
  - `enterBookingFromIntent(...)`
  com:
  - `text`
  - `config`
  - `nextState`
  - `history`
  - `senderDisplayName`
  - `resolveBooking`
  - `orchestrator`
  - `includeIntro`

Objetivo:

- reduzir mais uma classe de handoff operacional paralelo para booking
- aproximar a entrada legada em booking de uma unica primitiva antes dos cortes finais de autoridade semantica

- sexagesimo quinto corte de superficie duplicada do legado`r
- `qualification.ts` passou a exportar:
  - `handoffIdentifiedServiceBooking(...)`
  para consolidar o caminho:
  - `servico identificado -> ativar booking -> resolver booking com intro opcional`
- o helper agora e reutilizado em:
  - `qualification.ts`
  - `turn-handler.ts`
- isso cobre:
  - servicos em sequencia ja identificados
  - handoff de `identifiedService` em booking intent
  - gate legado de `qualification` quando `classifyServiceMatch(...)` ja encontrou um servico valido

Objetivo:

- reduzir mais uma divergencia operacional entre booking intent e gates legados
- aproximar o handoff por servico identificado de uma unica primitiva compartilhada

- sexagesimo sexto corte de superficie duplicada do legado`r
- `turn-handler.ts` passou a reutilizar:
  - `tryEnterLegacyBookingIntent(...)`
  para consolidar a entrada legada em booking por:
  - sinais fortes/orquestrador
  - `booking_intent` any-turn
- o helper agora concentra a negociacao entre:
  - `getBookingRequest(...)`
  - `getOrchestrator(...)`
  - `shouldEnterLegacyBookingFromSignals(...)`
  - `handoffLegacyBookingIntent(...)`
- isso unifica os caminhos antes espalhados em:
  - `tryEnterLegacyBookingFromSignals(...)`
  - `tryEnterLegacyAnyTurnBooking(...)`

Objetivo:

- reduzir mais uma classe de entrada paralela em booking no legado
- aproximar a decisao de handoff em booking de uma unica primitiva local no `turn-handler`

- sexagesimo setimo corte de superficie duplicada do legado`r
- o entrypoint `supabase/functions/conversations-turn/index.ts` passou a explicitar melhor os preprocessadores por ator com helpers locais:
  - `isInternalOwnerActor(...)`
  - `runConversationFlowSafely(...)`
  - `tryHandleInternalActorFlow(...)`
  - `tryHandleExternalQuoteFlow(...)`
- o ramo `external` deixou de repetir inline:
  - gate de quote externo
  - `try/catch` de fallback para `runMainConversationFlow(...)`
- o ramo `internal` continua funcionalmente separado do `semantic_core`, mas agora a classificacao deterministica por owner/admin fica mais explicita como pre-processamento do entrypoint antes do fluxo principal

Objetivo:

- reduzir mais uma camada de orquestracao duplicada no entrypoint
- deixar visivel no codigo que a camada `internal` ainda nao foi migrada para a autoridade do `semantic_core`

- sexagesimo oitavo corte de superficie duplicada do legado`r
- `orchestrator-actions.ts` passou a reutilizar:
  - `getOrchestratorServiceMatchSummary(...)`
  para consolidar a classificacao residual de servico/rejeicao contextual no orquestrador legado
- isso cobre:
  - `buildOrchestratorMatchRejectionOrNull(...)`
  - a resolucao complementar de servico em `buildFirstMessageAnswerPriceResult(...)`
- com isso, o orquestrador deixa de repetir localmente a combinacao:
  - `classifyServiceMatch(...)`
  - `hasMatchContext(...)`
  - `generateRejectionMessageWithAI(...)`

Objetivo:

- reduzir mais uma fonte de classificacao semantica paralela fora do `semantic_core`
- aproximar `orchestrator-actions.ts` do mesmo padrao de helpers compartilhados que ja existe no `turn-handler`

- sexagesimo nono corte de superficie duplicada do legado`r
- `turn-handler.ts` passou a reutilizar mais explicitamente:
  - `applyLegacyMatchedServiceState(...)`
  - `getLegacyServiceMatchSummary(...)`
  nos pontos residuais que ainda escreviam ou reclassificavam inline
- isso cobre:
  - promocao de servico identificado dentro de `tryHandleLegacyPriceQuestion(...)`
  - promocao de servico identificado em `tryResolveLegacyQualificationEntryMatch(...)`
  - recheck de rejeicao em `tryRejectInvalidLegacyBookingEntry(...)`

Objetivo:

- reduzir mais uma classe de escrita operacional e reclassificacao residual no `turn-handler`
- manter o caminho legado mais consistente com os helpers ja extraidos antes de novos cortes maiores

- septuagesimo corte de superficie duplicada do legado`r
- o bootstrap inicial de servico em `turn-handler.ts` passou a reutilizar:
  - `applyLegacyInitialServiceState(...)`
- isso cobre as promocoes iniciais de:
  - `findServiceByExactMatch(...)`
  - `findServiceFromText(...)`
  - `isVisitRequest(...)`
- com isso, a entrada principal deixa de escrever `slots.service` inline antes do pipeline de fases

Objetivo:

- reduzir mais uma escrita residual de estado semantico fora dos helpers compartilhados
- deixar a promocao inicial de servico mais coerente com o restante da drenagem de autoridade do `turn-handler`

- septuagesimo primeiro corte de superficie duplicada do legado`r
- o final de `runLegacyFallbackPhase(...)` passou a delegar a continuidade de modo para:
  - `dispatchLegacyModeContinuation(...)`
- isso remove do fim da fase o branching inline entre:
  - `handleBookingModeMessage(...)`
  - `resolveQuote(...)`

Objetivo:

- reduzir mais um ponto de dispatch residual dentro do fallback legado
- aproximar `runLegacyFallbackPhase(...)` de um encadeamento puramente declarativo de helpers

- septuagesimo segundo corte de superficie duplicada do legado`r
- `orchestrator-actions.ts` passou a reutilizar:
  - `resolveOrchestratorCatalogService(...)`
  para consolidar a resolucao local de:
  - `inferred_service`
  - `findServiceFromText(...)`
  - `getServiceWithPrice(...)`
- isso cobre:
  - `buildFirstMessageServiceDetailResult(...)`
  - `buildFirstMessageAnswerPriceResult(...)`

Objetivo:

- reduzir mais uma fonte curta de lookup semantico paralelo no orquestrador legado
- aproximar os handlers da primeira mensagem de um conjunto menor de primitivas reutilizaveis

- septuagesimo terceiro corte de superficie duplicada do legado`r
- `orchestrator-actions.ts` passou a reutilizar:
  - `buildOrchestratorServiceOptionsState(...)`
  para consolidar a montagem de:
  - `serviceOptions`
  - `last_service_options`
  - `step` opcional nas vitrines de servicos
- isso cobre:
  - `buildAfterGenericServicesListResult(...)`
  - `buildFirstMessageServicesListResult(...)`

Objetivo:

- reduzir mais uma repeticao curta de estado/opcoes no orquestrador legado
- aproximar as respostas de vitrine de servicos de uma primitiva unica de estado

- septuagesimo quarto corte de superficie duplicada do legado`r
- `orchestrator-actions.ts` passou a reutilizar:
  - `buildOrchestratorClarificationResult(...)`
  para consolidar a montagem de mensagem de esclarecimento com estado opcional
- isso cobre:
  - `buildFirstMessageClarificationResult(...)`
  - o fallback sem IA em `buildAiClarificationOrNull(...)`

Objetivo:

- reduzir mais uma montagem curta de resposta no orquestrador legado
- aproximar os handlers de esclarecimento de uma primitiva unica de renderizacao/estado

- septuagesimo quinto corte de superficie duplicada do legado`r
- `orchestrator-actions.ts` passou a reutilizar:
  - `buildOrchestratorPriceCatalogListResult(...)`
  - `buildOrchestratorPriceUnavailableResult(...)`
  para consolidar o fallback de catalogo no fluxo de preco
- isso cobre:
  - `buildOrchestratorAnswerPriceResult(...)`
  - `buildFirstMessageAnswerPriceResult(...)`
- com isso, o orquestrador deixa de repetir:
  - `withPrice.length > 0`
  - escrita de `last_service_options`
  - montagem da resposta de `preco indisponivel`

Objetivo:

- reduzir mais uma classe curta de fallback repetido em `answer_price`
- aproximar a resposta de preco do orquestrador de primitivas unicas para lista e indisponibilidade

- septuagesimo sexto corte de disciplina operacional do semantic core`r
- o documento passou a registrar explicitamente um guia disciplinar da fase atual para evitar recontaminacao semantica durante a migracao
- esse guia reforca:
  - soberania do pipeline `snapshot -> policy -> decision -> executor -> renderer`
  - imutabilidade e autoridade unica do snapshot
  - limites de responsabilidade de `decision engine`, `executors` e `renderers`
  - radar permanente sobre `turn-handler.ts`, `orchestrator-actions.ts`, `qualification.ts` e `resolve-booking.ts`
  - obrigatoriedade de observabilidade e fixtures para respostas curtas, multiagendamento e continuidade
- alem disso, `semantic-runtime-fixture.test.ts` ganhou uma fixture explicita para proteger o caso de booking adicional que precisa oferecer reutilizacao do contato do titular

Objetivo:

- transformar o risco atual de regressao silenciosa em criterio operacional verificavel
- aumentar a cobertura de fixture sobre um caso sensivel de continuidade sem expandir logica paralela fora do `semantic_core`

- septuagesimo setimo corte de cobertura executavel do semantic core`r
- `semantic-runtime-fixture.test.ts` ganhou um bloco maior de cenarios prioritarios do guia disciplinar:
  - saudacao seguida de booking sem perder contexto de servico
  - booking com servico citado logo na primeira frase
  - multiagendamento sem nomes explicitos pedindo o nome da primeira pessoa
  - continuidade do passo de contato apos resposta curta (`esse mesmo`)
- isso amplia a cobertura executavel exatamente nos pontos mais sujeitos a regressao silenciosa:
  - continuidade apos saudacao
  - preservacao de servico no handoff inicial
  - multiagendamento sem nomes
  - resposta curta sem colapso de contexto

Objetivo:

- acelerar a refatoracao por fixtures de alto valor, em vez de apenas microcortes no legado
- transformar mais itens da matriz de aceite em comportamento verificavel do `semantic_core`

- septuagesimo oitavo corte de cobertura executavel do semantic core`r
- `semantic-runtime-fixture.test.ts` agora tambem cobre explicitamente:
  - pergunta de preco com valor concreto sem promover `booking mode`
  - pergunta generica de preco respondida como fluxo informacional puro
  - pos-confirmacao com `closing` oferecendo calendario no turno seguinte
- isso reforca dois pontos centrais do guia disciplinar:
  - preco informacional nao deve reabrir fluxo de booking por efeito colateral
  - o pos-confirmacao do motor novo precisa continuar previsivel e testavel

Objetivo:

- proteger o `semantic_core` contra regressao silenciosa em dois pontos soberanos do motor: informacional puro e fechamento pos-booking
- transformar mais itens da matriz critica em fixture executavel, sem depender do legado

- septuagesimo nono corte de cobertura executavel do semantic core`r
- `semantic-runtime-fixture.test.ts` passou a cobrir mais dois cenarios sensiveis de continuidade:
  - resposta curta de sequencia (`o outro depois`) ainda oferecendo `offer_sequence_template`
  - booking adicional pronto para confirmar quando o reuso do contato do titular ja foi decidido
- isso protege explicitamente:
  - continuidade curta de multiagendamento sem reinterpretação paralela
  - fechamento previsivel de booking adicional com `contact_preference = skip_primary`

Objetivo:

- aumentar a cobertura dos casos curtos e caoticos que mais tendem a recontaminar o fluxo
- transformar a etapa `ask_contact -> confirm_booking` em comportamento mais visivel e verificavel dentro do `semantic_core`

- octogesimo corte de disciplina de estado do semantic core`r
- `semantic-core/executors/booking-finalization.ts` passou a limpar `contact_preference` sempre apos confirmacao
- isso alinha o motor novo ao comportamento seguro do legado e evita vazamento de preferencia de contato para turnos posteriores
- a cobertura foi reforcada em:
  - `semantic-runtime-fixture.test.ts`
    - confirmacao final standalone limpando `contact_preference`
    - confirmacao de booking adicional com `skip_primary` limpando `contact_preference`
  - `semantic-core.test.ts`
    - `buildPostConfirmationPlan(...)` mantendo bookings com `contact_delivery = primary` fora de `outbound_notifications`

Objetivo:

- evitar que estado residual de contato contamine novos turnos ou novos bookings
- tornar verificavel a disciplina de estado no pos-confirmacao do `semantic_core`

- octogesimo primeiro corte de cobertura unitaria do semantic core`r
- `semantic-core.test.ts` ganhou mais cobertura estrutural para regras de contato e continuidade:
  - `deriveBookingContext(...)` expondo `Pular (usar contato do titular)` apenas para booking adicional
  - `deriveBookingContext(...)` marcando `contact` como `missing_step` quando o booking ja esta completo nos demais campos
  - `buildPostConfirmationPlan(...)` gerando notificacao outbound apenas quando o atendido secundario tem contato proprio

Objetivo:

- proteger invariantes do `semantic_core` em nivel unitario, sem depender apenas de fixtures de runtime
- aumentar a confianca nas regras de contato, continuidade e pos-confirmacao que ainda sao sensiveis

- octogesimo segundo corte de cobertura de renderer e canal no semantic core`r
- `semantic-core.test.ts` passou a cobrir invariantes de renderizacao e adaptacao por canal:
  - `formatSemanticActionOptions(...)` preservando opcoes brutas no `web_simulator`
  - `formatSemanticActionOptions(...)` numerando opcoes no `whatsapp` apenas quando o hint permite
  - `buildSemanticResult(...)` preservando `render_hints` sem alterar a semantica
  - `renderBooking(...)` exibindo resumo de notificacoes outbound no pos-confirmacao

Objetivo:

- reforcar na pratica que diferencas de canal permanecem apenas na UX
- proteger a pureza do renderer e a adaptacao de opcoes sem reabrir regra de negocio no canal

- octogesimo terceiro corte de cobertura do decision engine do semantic core`r
- `semantic-core.test.ts` passou a cobrir decisoes centrais de booking em nivel unitario:
  - `ask_contact` com opcao de reuso do contato do titular para booking adicional
  - `ask_service` com `prefer_multi_select` quando sequencia esta habilitada
  - `offer_sequence_template` quando a proxima pessoa ja esta pronta para continuidade

Objetivo:

- reforcar que a precedencia de booking continua centralizada no `decision_engine`
- evitar que regras de contato, sequencia e hints de UX voltem a escapar para camadas paralelas

- octogesimo quarto corte de disciplina estrutural do decision engine`r
- o `decision-engine` do `semantic_core` passou a reutilizar builders locais para reduzir repeticao na montagem de `SemanticDecisionResult`:
  - `buildBookingDecision(...)`
  - `buildBookingChannelHints(...)`
  - `buildInformationalDecision(...)`
- isso reduziu a repeticao estrutural em:
  - `semantic-core/decision-engine/booking.ts`
  - `semantic-core/decision-engine/informational.ts`
- a precedencia e os contratos nao foram alterados; o corte foi apenas estrutural

Objetivo:

- manter o `decision_engine` centralizado sem deixa-lo virar um novo monolito repetitivo
- reduzir a chance de divergencia entre acoes equivalentes ao montar hints, confidence e slot updates

- octogesimo quinto corte de disciplina do runtime semantico`r
- `semantic-core/runtime.ts` e `semantic-core/test-runtime.ts` passaram a reutilizar:
  - `buildPolicyClarificationDecision(...)`
  para montar a decisao unica de `ask_clarification` derivada da policy layer
- isso remove uma duplicacao sensivel entre:
  - runtime real
  - runner de fixtures
- `semantic-core.test.ts` ganhou cobertura explicita para esse helper

Objetivo:

- impedir divergencia silenciosa entre o pipeline real e o pipeline de fixtures
- manter a saida da `policy_layer` consistente antes de cair no `decision_engine` e nos `executors`

- octogesimo sexto corte de consolidacao do pipeline do runtime`r
- o `semantic_core` agora compartilha helpers centrais de pipeline em `semantic-core/runtime-helpers.ts`:
  - `buildSemanticTurnContext(...)`
  - `buildSemanticClarificationDecision(...)`
  - `resolveSemanticDecisionPipeline(...)`
- essa consolidacao passou a ser reutilizada por:
  - `semantic-core/runtime.ts`
  - `semantic-core/test-runtime.ts`
  - `semantic-core/decision-engine/index.ts` no ramo de clarificacao por policy/audience
- `semantic-core.test.ts` ganhou cobertura unitaria explicita para:
  - `buildSemanticTurnContext(...)`
  - `resolveSemanticDecisionPipeline(...)`
- isso remove mais uma duplicacao estrutural entre runtime real, runner de fixtures e um ramo sensivel do `decision_engine`, sem alterar precedencia

Objetivo:

- garantir que a casca operacional do pipeline semantico continue unica e previsivel
- reduzir risco de divergencia entre runtime real, fixtures e clarificacoes disparadas por policy

- octogesimo setimo corte de soberania do snapshot para preferencia de contato`r
- o `semantic_core` passou a interpretar preferencia de contato no proprio snapshot, em vez de depender de estado pre-preenchido fora do pipeline
- `semantic-core/turn-semantics.ts` agora infere `signals.contact_preference` quando o turno esta respondendo ao passo de contato, incluindo o caso de reuso do contato do titular (`skip_primary`)
- `semantic-core/booking-context.ts` agora considera `snapshot.signals.contact_preference` para fechar o passo de contato sem reinterpretacao paralela
- `semantic-core/booking-lifecycle.ts` agora usa essa preferencia do snapshot ao montar `contact_delivery`, inclusive para `skip_primary`
- a cobertura foi reforcada em:
  - `semantic-core.test.ts`
    - deteccao unitaria de `inferContactPreferenceSignal(...)`
    - `deriveBookingContext(...)` tratando `contact_preference` do snapshot como passo concluido
  - `semantic-runtime-fixture.test.ts`
    - transicao ponta a ponta `ask_contact -> usa o mesmo contato -> confirm_booking`

Objetivo:

- mover mais uma interpretacao critica para dentro da fonte soberana do turno
- proteger o caminho natural de `skip_primary` sem depender de logica paralela ou estado mutado fora do `semantic_core`

- octogesimo oitavo corte de cobertura completa das preferencias de contato no runtime`r
- a cobertura do `semantic_core` agora protege as variacoes restantes de contato decididas no snapshot:
  - `phone`
  - `email`
  - `both`
- `semantic-core.test.ts` ganhou reforco unitario para:
  - `inferContactPreferenceSignal(...)` reconhecer `phone`, `email` e `both`
  - `deriveBookingContext(...)` tratar essas preferencias do snapshot como passo de contato concluido
- `semantic-runtime-fixture.test.ts` agora cobre a transicao ponta a ponta:
  - `ask_contact -> so celular -> confirm_booking`
  - `ask_contact -> so email -> confirm_booking`
  - `ask_contact -> os dois -> confirm_booking`

Objetivo:

- fechar a matriz critica de contato dentro do pipeline soberano do turno
- reduzir o espaco para regressao silenciosa entre preferencia respondida pelo usuario e confirmacao final

- octogesimo nono corte de cobertura para respostas curtas residuais`r
- `semantic-runtime-fixture.test.ts` ganhou cobertura adicional para respostas curtas que ainda podiam degradar continuidade:
  - `sim` apos `ask_audience_confirmation`, exigindo progresso do fluxo
  - `sim` preservando o contexto de `ask_date`
  - `sim` preservando o contexto de `ask_time`
- isso complementa a cobertura anterior de:
  - `pode ser` em `ask_service`
  - `isso` em `ask_date`
  - `esse mesmo` em `ask_contact`
  - `o outro depois` em sequencia

Objetivo:

- fechar mais lacunas da matriz critica de respostas curtas no runtime real
- reduzir o risco de perda de continuidade em turnos ambiguos, curtos ou pouco informativos

- nonagesimo corte de disciplina do pos-fechamento no runtime`r
- o `semantic_core` deixou de oferecer calendario em todo `closing` genericamente:
  - `semantic-core/decision-engine/fallback.ts` agora so retorna `offer_calendar` quando `pending_calendar_offer` esta ativo
- o `semantic_core` tambem passou a limpar o estado desse pos-fechamento no proprio executor:
  - `semantic-core/executors/calendar-offer.ts`
  - limpeza de `pending_calendar_offer` e `pending_final_confirmation` ao exibir a oferta
- a cobertura foi reforcada em:
  - `semantic-core.test.ts`
    - `closing` so gera `offer_calendar` quando o flag pos-confirmacao esta ativo
  - `semantic-runtime-fixture.test.ts`
    - exibicao de calendario limpando os flags
    - fechamento posterior sem reofertar calendario novamente

Objetivo:

- tornar o pos-confirmacao previsivel e idempotente dentro do pipeline do `semantic_core`
- evitar reoferta repetida de calendario por causa de flags residuais no estado

- nonagesimo primeiro corte de UX final para respostas do calendario`r
- o `semantic_core` agora interpreta a resposta do usuario ao prompt de calendario no proprio snapshot:
  - `semantic-core/turn-semantics.ts` passou a inferir `signals.calendar_response`
- o `decision_engine` agora responde explicitamente a:
  - aceite do calendario
  - recusa do calendario
- isso entrou via `semantic-core/decision-engine/fallback.ts`, sem depender de fallback generico
- `semantic-core/renderers/informational.ts` e `semantic-core/renderers/prompt-library.ts` agora renderizam mensagens finais especificas para:
  - `reply_calendar_confirmed`
  - `reply_calendar_declined`
- a cobertura foi reforcada em:
  - `semantic-core.test.ts`
    - inferencia unitaria de `calendar_response`
    - decisao explicita para aceite/recusa do calendario
  - `semantic-runtime-fixture.test.ts`
    - resposta final para aceite do calendario
    - resposta final para recusa do calendario

Objetivo:

- impedir que a UX final do calendario caia em `handoff_fallback`
- fechar o pos-fechamento com respostas deterministicas dentro do pipeline soberano

- nonagesimo segundo corte de consolidacao semantica no legado`r
- `qualification.ts` passou a concentrar duas primitivas compartilhadas que antes ficavam duplicadas entre `qualification` e `orchestrator-actions`:
  - `resolveCatalogService(...)`
  - `applyBookingLeadContext(...)`
- `resolveCatalogService(...)` agora concentra a resolucao entre:
  - servico atual no estado
  - servico inferido pelo orquestrador
  - servico encontrado no texto
- `applyBookingLeadContext(...)` agora concentra a promocao comum para lead de booking:
  - ativacao de `mode = booking`
  - limpeza de `step`
  - interpretacao de adicional
  - promocao de `for_whom` quando nao ha multiagendamento
- `orchestrator-actions.ts` passou a reutilizar essas primitivas em vez de manter logica paralela propria, especialmente no fluxo de `answer_price` e no lookup de catalogo

Objetivo:

- reduzir autoridade semantica residual do legado em pontos onde `qualification` e `orchestrator` ainda decidiam o mesmo comportamento por caminhos separados
- aproximar o legado de um conjunto menor de primitivas compartilhadas enquanto o `semantic_core` continua virando a camada soberana

- nonagesimo terceiro corte de drenagem semantica no `turn-handler``r
- `turn-handler.ts` deixou de manter logica propria de lead de booking e lookup de catalogo dentro do fluxo de preco
- o ramo legado de preco agora reutiliza diretamente:
  - `resolveCatalogService(...)`
  - `applyBookingLeadContext(...)`
- com isso, o `turn-handler` parou de duplicar:
  - resolucao de servico por texto/catalogo
  - promocao de `mode = booking`
  - promocao de multiagendamento e `for_whom` no contexto de preco
- o helper legado `applyLegacyPriceBookingLeadContext(...)` foi removido

Objetivo:

- continuar drenando autoridade semantica residual do entrypoint legado
- fazer o `turn-handler` depender mais das primitivas compartilhadas ja extraidas em `qualification.ts`, em vez de reimplementar comportamento

- nonagesimo quarto corte de consolidacao de contato em `resolve-booking.ts``r
- `resolve-booking.ts` passou a concentrar a avaliacao de contato e booking concluido em helpers locais compartilhados:
  - `resolveLegacyContactPreference(...)`
  - `hasRequiredContactForPreference(...)`
  - `hasCompletedBookingState(...)`
- com isso, `resolveBookingContactState(...)` e `interpretBookingAdditionalContext(...)` deixaram de recalcular de forma paralela:
  - preferencia de contato efetiva
  - contato suficiente para `phone` / `email` / `both` / `skip_primary`
  - criterio de booking completo anterior

Objetivo:

- reduzir duplicacao operacional no eixo de contato e continuidade do legado
- deixar a regra de completude de booking mais previsivel enquanto o `semantic_core` segue assumindo a parte soberana

- nonagesimo quinto corte de consolidacao de roteamento por `match` no `turn-handler``r
- `turn-handler.ts` passou a concentrar a transicao local de `service/reject/context` em helpers menores:
  - `buildLegacyStepState(...)`
  - `applyLegacyMatchedServiceSummary(...)`
- isso secou repeticao entre:
  - `resolveLegacyQualificationMatchFallback(...)`
  - `tryResolveLegacyQualificationEntryMatch(...)`
  - `tryRejectInvalidLegacyBookingEntry(...)`
  - `tryResolveLegacyQualificationServiceGate(...)`
- o efeito pratico foi reduzir ramificacoes locais que ainda reimplementavam:
  - aplicacao de `match.service`
  - troca de `step`
  - limpeza de `mode` em rejeicao de booking invalido
  - reaproveitamento da mesma `rejectionMessage`

Objetivo:

- continuar comprimindo o `turn-handler` em torno de primitivas menores e mais previsiveis
- reduzir a superficie de autoridade semantica residual no legado antes do corte final para o `semantic_core`

- nonagesimo sexto corte de consolidacao do bootstrap inicial no `turn-handler``r
- o bootstrap inicial de servico agora passa por uma primitiva unica:
  - `resolveLegacyInitialServiceCandidate(...)`
- esse helper passou a concentrar:
  - `findServiceByExactMatch(...)`
  - `resolveCatalogService(...)`
  - fallback de visita (`isVisitRequest(...)`)
- o mesmo bloco tambem reaproveitou `buildLegacyStepState(...)` nos entrypoints simples de qualification:
  - mensagem muito curta
  - greeting entry

Objetivo:

- reduzir mais uma fonte de decisao local dispersa antes do pipeline legado
- aproximar o `turn-handler` de um formato em que entrypoints e bootstrap dependem de poucas primitivas previsiveis

- nonagesimo setimo corte de consolidacao dos hard-guards de atendido`r
- `turn-handler.ts` passou a concentrar o contexto de recuperacao de atendido em helpers compartilhados:
  - `getLegacyLastAssistantMessage(...)`
  - `getLegacyAttendeeGuardContext(...)`
- isso removeu a duplicacao entre:
  - hard-guard inicial antes do pipeline
  - recovery no fallback legado
- o efeito pratico foi parar de remontar manualmente:
  - ultima mensagem do assistente
  - combinacao com `last_prompt`
  - chamada para `getLegacyAttendeeTurnSignals(...)`

Objetivo:

- reduzir mais um ponto de branching e contexto repetido no `turn-handler`
- deixar a recuperacao de multiagendamento mais previsivel antes da drenagem final da autoridade legada

- nonagesimo oitavo corte de consolidacao do fallback legado`r
- `turn-handler.ts` passou a concentrar os gates pre-mode do fallback em um helper unico:
  - `dispatchLegacyFallbackPreMode(...)`
- esse helper agora centraliza, na ordem:
  - entry em qualification
  - any-turn booking
  - greeting entry
  - `ensureConversationMode(...)`
  - `ask_mode`
  - rejeicao de entrada invalida em booking
- com isso, `runLegacyFallbackPhase(...)` ficou mais proximo de:
  - recovery de atendido
  - pre-mode dispatch
  - mode continuation

Objetivo:

- reduzir o encadeamento manual dos ultimos gates do fallback legado
- aproximar o `turn-handler` de um dispatch mais declarativo, com menos autoridade espalhada em blocos inline

- nonagesimo nono corte de consolidacao do nucleo de `qualification``r
- `turn-handler.ts` passou a concentrar o miolo comum das fases:
  - `qualification`
  - `qualification_rejected`
  em um helper unico: `dispatchLegacyQualificationCore(...)`
- esse helper agora centraliza:
  - short decline
  - rejeicao de inquiry direta
  - entrada em booking por signals
  - dispatch do orquestrador
  - services question anytime
  - fluxo de preco
- com isso, `runLegacyQualificationPhase(...)` e `runLegacyQualificationRejectedPhase(...)` ficaram mais focadas apenas no que e exclusivo de cada fase

Objetivo:

- reduzir duplicacao estrutural entre as duas fases principais do legado
- deixar mais explicito o que ainda e autoridade local de `qualification` enquanto o restante vai sendo drenado

- centesimo corte de consolidacao do runtime soberano do `semantic_core`
- o runtime do `semantic_core` passou por um bloco corretivo maior para remover regressao silenciosa entre renderer, decision engine, executores e merge de estado:
  - `renderers/index.ts` voltou a tratar `reply_faq` no renderer informacional central
  - `decision-engine/booking.ts` passou a priorizar `offer_sequence_template` antes de cair em `ask_service`, quando a sequencia ainda e o proximo passo soberano
  - `booking-context.ts` agora:
    - monta `slot_updates.service` com todos os servicos selecionados, nao apenas o primeiro
    - considera `includes_self` como atendido valido para nao pedir nome em booking de si mesmo
    - reaproveita `pending_second_service_choice` para preservar o contexto implicito de `same_next`
    - nao reoferece template de sequencia quando `date/time` ja vieram preenchidos no snapshot
  - `renderers/shared.ts` passou a respeitar `state_patch.slots` como autoridade final sobre o merge de estado
  - `executors/booking-finalization.ts` passou a limpar explicitamente `service/date/time/staff_name` no reset para o proximo booking, evitando que o turno seguinte seja interpretado como booking ja completo
  - os executores de booking (`attendee`, `service`, `date`, `time`, `contact`) agora propagam de forma consistente:
    - `attendee_name`
    - `pending_attendee_queue`
    - contexto parcial do booking
    sem depender de escrita paralela em fases posteriores
  - `renderers/booking.ts` e `prompt-library.ts` ficaram alinhados com o contrato novo:
    - pergunta de atendido usa `completed_bookings` para distinguir primeiro vs proximo
    - pergunta de contato explicita melhor a ideia de `contato`
- esse bloco fechou regressões que estavam aparecendo exatamente nos cenarios mais sensiveis do guia:
  - FAQ puro
  - booking de si mesmo com servico na primeira frase
  - continuidade apos confirmacao para o proximo atendido
  - `same_next` com selecao multipla de servicos
  - fila inferida preservada em multiagendamento encadeado

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

## Auditoria de dependencia residual do legado

Estado auditado neste ponto:

- ainda nao e correto afirmar independencia total do legado
- o `semantic_core` ja esta soberano quando `shouldUseSemanticCore(...)` habilita o turno, mas ainda coexistem dependencias explicitas fora dele

Dependencias residuais confirmadas:

- o entrypoint em `index.ts` ainda preserva o branch legado:
  - quando `semanticCoreEnabled = false`, o fluxo continua indo para `processSimulatorMessage(...)`
- a camada `internal` continua fora do `semantic_core`:
  - `mode=internal` e `actor_type=owner|admin` seguem por `handleInternalIntent(...)`
- os early steps do legado continuam ativos no trilho nao-semantico:
  - `turn/early/reject-and-first.ts`
  - `turn/early/anytime.ts`
  - `turn/early/bypass.ts`
- o booking legado continua com runtime proprio fora do `semantic_core`:
  - `resolve-booking.ts`
  - `booking/*`
- ainda existe autoridade semantica residual do legado em:
  - `turn-handler.ts`
  - `qualification.ts`
  - `orchestrator-actions.ts`
  - `resolve-booking.ts`

Conclusao pratica:

- ha alta confianca de que, quando o turno entra no `semantic_core`, o legado ja nao decide aquele turno
- mas ainda nao ha base tecnica para afirmar que a funcao `conversation-turn` como um todo esta livre de dependencia do legado
- a remocao dessa dependencia total ainda exige:
  - migrar ou aposentar o branch legado de `processSimulatorMessage(...)`
  - decidir o destino arquitetural da camada `internal`
  - eliminar o runtime legado de booking/qualification/orchestrator como fallback operacional

- centesimo quadragesimo corte de isolamento operacional do `internal`
- `index.ts` agora deixa o branch `internal` isolado do runtime `external`
- quando `tryHandleInternalActorFlow(...)` nao classifica nenhum comando interno:
  - o fluxo nao cai mais em `runMainConversationFlow(...)`
  - o entrypoint responde com fallback proprio de `internal`

Objetivo:

- impedir que manutencao futura de `owner/admin` interfira no atendimento `external`
- fechar o ultimo ponto relevante em que `internal` ainda podia recair no runtime principal do cliente final

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo trigesimo nono corte de cutover padrao do `external` para `semantic_core`
- `index.ts` agora passa a preferir `semantic_core` por padrao no fluxo `external`
- a regra nova ficou explicita em:
  - `shouldDefaultExternalToSemanticCore(...)` em `semantic-core/runtime.ts`
- com isso:
  - quando `CONVERSATION_TURN_ENGINE` estiver vazio, o `external` entra no `semantic_core`
  - o trilho legado externo passa a depender de opt-in explicito via `CONVERSATION_TURN_ENGINE=legacy`
  - a camada `internal` continua fora desse cutover por enquanto

Objetivo:

- fechar de fato a etapa que estava quase concluida: tornar o `semantic_core` o caminho operacional padrao do fluxo `external`
- reduzir o risco futuro de ambiguidade por convivencia implicita entre `semantic_core` e legado no entrypoint principal

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo trigesimo oitavo corte de limpeza do `service_detail` inicial no `orchestrator-actions.ts`
- `orchestrator-actions.ts` agora concentra o prompt simples de agendamento em:
  - `buildOrchestratorBookingPromptResult(...)`
- esse helper passou a ser reutilizado por `buildFirstMessageServiceDetailResult(...)`

Objetivo:

- reduzir mais uma repeticao curta no `service_detail` da primeira mensagem
- manter mais uniforme a familia de respostas curtas de CTA para booking no orquestrador legado

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo trigesimo setimo corte de limpeza do esclarecimento simples no `turn-handler`
- `turn-handler.ts` agora concentra a resposta de esclarecimento simples em:
  - `buildLegacyClarificationResult(...)`
- esse helper passou a ser reutilizado no guard de mensagem muito curta de `processSimulatorMessage(...)`

Objetivo:

- reduzir mais uma montagem inline residual no bootstrap legado do turno
- manter mais uniforme a familia de helpers de resposta simples no `turn-handler.ts`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo trigesimo sexto corte de limpeza do fallback generico no `orchestrator-actions.ts`
- `orchestrator-actions.ts` agora concentra o fallback generico em:
  - `buildOrchestratorGenericFallbackResult(...)`
- esse helper passou a ser reutilizado por `buildOrchestratorFallbackResult(...)`

Objetivo:

- reduzir mais uma montagem inline residual no orquestrador legado
- manter uniforme a saida dos helpers de resposta direta, rejeicao e fallback generico

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo trigesimo quinto corte de limpeza da rejeicao contextual simples no `turn-handler`
- `turn-handler.ts` agora concentra a resposta de rejeicao contextual simples em:
  - `buildLegacyRejectionResult(...)`
- esse helper passou a ser reutilizado por:
  - `tryBuildLegacyDirectInquiryRejection(...)`
  - `tryHandleLegacyPriceQuestion(...)` no ramo de servico nao encontrado com contexto valido

Objetivo:

- reduzir mais uma repeticao curta no legado
- manter uniforme a saida de rejeicao contextual simples antes dos fallbacks seguintes

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo trigesimo quarto corte de limpeza da resposta de rejeicao no `orchestrator-actions.ts`
- `orchestrator-actions.ts` agora concentra a resposta de rejeicao contextual em:
  - `buildOrchestratorRejectionResult(...)`
- esse helper passou a ser reutilizado por:
  - `buildOrchestratorMatchRejectionOrNull(...)`
  - `buildOrchestratorAnswerPriceResult(...)` quando `inferred_service` nao existe no catalogo

Objetivo:

- reduzir mais uma repeticao curta no orquestrador legado
- manter uniforme a saida de rejeicao contextual antes dos fallbacks seguintes

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo trigesimo terceiro corte de limpeza da resposta direta por IA em `qualification`
- `turn-handler.ts` agora concentra a resposta direta da IA em:
  - `buildLegacyAiAnswerResult(...)`
- esse helper passou a ser reutilizado por `dispatchLegacyQualificationFallback(...)`

Objetivo:

- reduzir mais uma repeticao curta no fallback final de `qualification`
- alinhar o legado ao padrao de helpers pequenos para respostas diretas por IA

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo trigesimo segundo corte de limpeza da vitrine de preco por catalogo no `turn-handler`
- `turn-handler.ts` agora concentra a vitrine legado de preco por catalogo em:
  - `buildLegacyPriceCatalogListResult(...)`
- esse helper passou a ser reutilizado por `tryHandleLegacyPriceQuestion(...)`

Objetivo:

- reduzir mais uma escrita manual residual de `last_service_options`
- manter o fluxo legado de preco mais consistente com os cortes equivalentes do orquestrador

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo trigesimo primeiro corte de reaproveitamento de estado de vitrine no `orchestrator-actions.ts`
- `orchestrator-actions.ts` agora reaproveita `buildOrchestratorServiceOptionsState(...)` tambem no fallback de preco por catalogo:
  - `buildOrchestratorPriceCatalogListResult(...)`

Objetivo:

- reduzir mais uma escrita manual residual de `last_service_options`
- manter o orquestrador legado mais consistente no eixo de vitrines de servicos

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo trigesimo corte de limpeza da resposta direta por IA no `orchestrator-actions.ts`
- `orchestrator-actions.ts` agora concentra a resposta direta da IA em:
  - `buildOrchestratorAiAnswerResult(...)`
- esse helper passou a ser reutilizado por:
  - `buildOrchestratorFallbackResult(...)`
  - `buildOrchestratorClarificationFallbackOrNull(...)`

Objetivo:

- reduzir mais uma repeticao curta no orquestrador legado
- manter uniforme a saida de respostas diretas da IA antes do fallback generico

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo vigesimo nono corte de limpeza da resposta de preco via IA no `turn-handler`
- `turn-handler.ts` agora concentra a resposta legado de preco quando a IA retorna um valor valido em:
  - `buildLegacyPriceAiAnswerResult(...)`
- esse helper passou a ser reutilizado pelos dois ramos de `tryHandleLegacyPriceQuestion(...)` que ainda montavam a mesma resposta inline

Objetivo:

- reduzir mais uma duplicacao curta no fluxo legado de `answer_price`
- manter o trecho de preco do `turn-handler.ts` mais uniforme entre preco de catalogo, preco por IA e indisponibilidade

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo vigesimo oitavo corte de limpeza do fluxo legado de preco no `turn-handler`
- `turn-handler.ts` agora concentra a montagem de resposta de preco em helpers locais:
  - `buildLegacyPricedServiceResult(...)`
  - `buildLegacyPriceUnavailableResult(...)`
- esses helpers passaram a ser reutilizados em `tryHandleLegacyPriceQuestion(...)`

Objetivo:

- reduzir mais uma duplicacao curta no eixo legado de `answer_price`
- manter o fluxo de preco do `turn-handler.ts` mais alinhado com os cortes anteriores do orquestrador

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo vigesimo setimo corte de limpeza do `waitingFor` estrutural em `resolve-booking.ts`
- `resolve-booking.ts` agora concentra a derivacao de slot faltante estrutural em:
  - `resolveBookingMissingSlot(...)`
- `resolveBookingWaitingState(...)` passou a separar:
  - pendencia especial de escolha de servico
  - falta estrutural de `service/date/time`

Objetivo:

- reduzir mais um pouco a mistura entre pendencias especiais e slots faltantes no bootstrap do booking legado
- deixar `resolveBookingWaitingState(...)` mais proximo de um orquestrador curto sobre helpers dedicados

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo vigesimo sexto corte de limpeza do bootstrap de input no `turn-handler`
- `turn-handler.ts` agora usa de fato `resolveLegacyIncomingTurnInput(...)` como primitiva do bootstrap do turno
- esse helper passou a concentrar:
  - resolucao de selecao numerica de acao
  - resolucao de selecao numerica de servico
  - resolucao de selecao numerica multipla de servico
  - derivacao de `hasForcedBookingAction`
  - derivacao de `hasStrongBookingIntent`
  - derivacao de `isNumericOption`

Objetivo:

- remover duplicacao residual logo na entrada de `processSimulatorMessage(...)`
- eliminar o helper morto/recursivo que ainda existia nesse bootstrap
- aproximar o entrypoint legado de `input resolvido -> caches -> pipeline`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo vigesimo quinto corte de limpeza da resposta `qualification_rejected`
- `turn-handler.ts` agora concentra a montagem da resposta de rejeicao de qualification em helper proprio:
  - `buildLegacyRejectedQualificationResult(...)`
- esse helper passou a ser reutilizado por:
  - `tryResolveLegacyQualificationEntryMatch(...)`
  - `tryRejectInvalidLegacyBookingEntry(...)`
  - `buildLegacyQualificationServiceGateResult(...)`

Objetivo:

- reduzir mais uma repeticao curta de `buildResult(...) + buildLegacyRejectedQualificationState(...)`
- manter o `turn-handler.ts` consistente nos pontos que promovem o estado `qualification_rejected`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo vigesimo quarto corte de limpeza do eixo `waitingFor` no booking legado
- `resolve-booking.ts` agora concentra duas leituras auxiliares em helpers proprios:
  - `resolveBookingLastAssistantMessage(...)`
  - `hasPendingBookingServiceChoice(...)`
- esses helpers passaram a ser reutilizados por `resolveBookingWaitingState(...)`

Objetivo:

- reduzir mais um pouco o ruído local da montagem de `waitingFor`
- manter `resolve-booking.ts` coerente no bootstrap curto antes dos `BOOKING_HANDLERS`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo vigesimo terceiro corte de consolidacao da completude de booking no legado
- `resolve-booking.ts` agora concentra o criterio base de slots obrigatorios em helper proprio:
  - `hasRequiredBookingCoreSlots(...)`
- esse helper passou a ser reutilizado por:
  - `hasCompletedBookingState(...)`
  - `resolveBookingContactState(...)`

Objetivo:

- reduzir mais uma duplicacao curta no eixo de contato/completude do booking legado
- manter `resolve-booking.ts` consistente na definicao de quando um booking esta operacionalmente completo

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo vigesimo segundo corte de limpeza do tail de `ask_clarification` no orquestrador
- `orchestrator-actions.ts` agora concentra o fallback de esclarecimento em helper renomeado e mais explicito:
  - `buildOrchestratorClarificationFallbackOrNull(...)`
- o handler de `ask_clarification` passou a depender diretamente dessa primitiva, em vez do helper anterior com nome generico

Objetivo:

- reduzir mais um pouco o ruído residual do orquestrador legado
- deixar os helpers de clarificacao com nomes mais alinhados ao papel real no fluxo

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo vigesimo primeiro corte de limpeza residual do `answer_price` no orquestrador
- `orchestrator-actions.ts` deixou de manter o helper redundante:
  - `buildOrchestratorServiceLeadResult(...)`
- no mesmo bloco, o fallback de catalogo/preco da primeira mensagem passou a ficar encapsulado em:
  - `buildOrchestratorCatalogPriceFallbackResult(...)`

Objetivo:

- remover ruído residual depois da unificacao anterior de `answer_price`
- manter o orquestrador legado com superficie pequena e mais previsivel

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo vigesimo corte de unificacao da resposta de preco com servico identificado no orquestrador
- `orchestrator-actions.ts` agora concentra a resposta de servico com preco em helper proprio:
  - `buildOrchestratorPricedServiceResult(...)`
- esse helper passou a ser reutilizado por:
  - `buildOrchestratorAnswerPriceResult(...)`
  - `buildFirstMessageAnswerPriceResult(...)`

Objetivo:

- reduzir mais uma duplicacao curta no eixo `answer_price` do orquestrador legado
- manter `orchestrator-actions.ts` convergindo para um conjunto pequeno de primitivas reutilizaveis

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo decimo nono corte de compressao do bootstrap de `processSimulatorMessage(...)`
- `turn-handler.ts` agora concentra a resolucao inicial do input legado em:
  - `resolveLegacyIncomingTurnInput(...)`
- no mesmo bloco, os caches de IA/orquestrador passaram a ficar encapsulados em:
  - `buildLegacyTurnCaches(...)`
- o fechamento final de agradecimento apos estado finalizado tambem saiu do corpo principal e agora passa por:
  - `tryHandleLegacyFinalizedThanks(...)`
- com isso, `processSimulatorMessage(...)` perdeu mais uma camada de bootstrap/manual wiring antes do pipeline de fases

Objetivo:

- reduzir mais a autoridade residual concentrada no entrypoint legado do turno
- deixar `processSimulatorMessage(...)` mais proximo de um orquestrador curto sobre setup + fases

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo decimo oitavo corte de limpeza do branch `internal` no entrypoint
- `index.ts` deixou de duplicar inline o gate de rate limit do ator interno no branch principal
- o ramo `isInternalOwnerActor(...)` agora depende diretamente de:
  - `tryHandleInternalActorFlow(...)`
- com isso, o rate limit de `internal_action_log` volta a existir em um unico ponto operacional dentro do runtime `internal`

Objetivo:

- reduzir acoplamento entre o dispatch principal do entrypoint e a regra operacional da camada `internal`
- deixar `internal` mais isolado para futuras alteracoes direcionadas, sem misturar esse detalhe no branch principal

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo decimo setimo corte de compressao auxiliar do runtime `internal`
- `index.ts` agora concentra tambem a configuracao operacional do ator interno em helper proprio:
  - `buildInternalActorConfig(...)`
- no mesmo bloco, o mapeamento do retorno deterministico do handler interno passou a ficar em:
  - `buildInternalActorResult(...)`
- com isso, `tryHandleInternalActorFlow(...)` deixou de montar inline:
  - o recorte de config enviado para `handleInternalIntent(...)`
  - o `SimulatorResult` final de volta ao entrypoint

Objetivo:

- continuar isolando a camada `internal` sem desviar o foco principal do `semantic_core`
- reduzir mais uma classe de detalhe operacional dentro do entrypoint

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo decimo sexto corte de compressao final da orquestracao em `resolve-booking.ts`
- `resolve-booking.ts` agora concentra a entrada informacional do booking legado em:
  - `tryHandleBookingInformationalEntry(...)`
- no mesmo bloco, o dispatch final da cadeia de handlers passou a ficar encapsulado em:
  - `runBookingHandlers(...)`
- com isso, `resolveBooking(...)` ficou ainda mais proximo do formato:
  - bootstrap
  - informacional
  - contexto derivado
  - `BOOKING_HANDLERS`

Objetivo:

- reduzir mais uma camada de detalhe operacional no entrypoint do booking legado
- deixar `resolve-booking.ts` o mais proximo possivel de um orquestrador curto antes dos handlers reais

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo decimo quinto corte de isolamento parcial do runtime `internal`
- `index.ts` agora concentra a verificacao de rate limit do ator interno em helper proprio:
  - `resolveInternalActorRateLimit(...)`
- esse helper passou a ser reutilizado dentro de `tryHandleInternalActorFlow(...)`, reduzindo mais uma responsabilidade inline do runtime `internal`

Objetivo:

- deixar o entrypoint menos misturado entre infraestrutura comum e regra operacional do ator `internal`
- manter a camada `internal` no radar sem desviar o foco principal do `semantic_core`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo decimo quarto corte de compressao da tabela de handlers do orquestrador legado
- `orchestrator-actions.ts` agora concentra a montagem compartilhada dos handlers principais em helpers dedicados:
  - `buildDefaultOrchestratorHandlers(...)`
  - `buildOrchestratorPriceHandler(...)`
  - `buildOrchestratorServicesListHandler(...)`
  - `buildFirstMessagePriceHandler(...)`
- com isso, `handleQualificationRejectedOrchestratorAction(...)`, `handleQualificationOrchestratorAction(...)` e `handleFirstMessageOrchestratorAction(...)` ficaram mais proximos de uma tabela de dispatch pura, sem repetir inline os mesmos ramos de:
  - `no_match_fallback`
  - `start_booking`
  - `answer_price`
  - parte de `list_services`

Objetivo:

- reduzir mais uma camada de duplicacao estrutural no orquestrador legado
- aproximar `orchestrator-actions.ts` do mesmo padrao declarativo que ja foi aplicado ao `turn-handler.ts`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo decimo terceiro corte de compressao da entrada de `resolve-booking.ts`
- `resolve-booking.ts` agora concentra os helpers operacionais do runtime em:
  - `buildBookingRuntimeHelpers(...)`
- no mesmo bloco, toda a derivacao de contexto do turno de booking legado passou a ficar encapsulada em:
  - `resolveBookingDerivedContext(...)`
- esse helper passou a reunir, em ordem:
  - contato/completude
  - contexto de adicional
  - `waitingFor`
  - interpretacao de slots
  - sinais finais do turno
- com isso, `resolveBooking(...)` ficou mais proximo de um orquestrador curto: bootstrap -> informacional -> contexto derivado -> `BOOKING_HANDLERS`

Objetivo:

- reduzir a autoridade residual espalhada na entrada do booking legado
- deixar `resolve-booking.ts` mais previsivel e mais facil de comparar com o modelo soberano do `semantic_core`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo duodecimo corte de compressao do `qualification core` e do routing residual do fallback
- `turn-handler.ts` agora concentra o inicio do miolo de `qualification` em helper proprio:
  - `dispatchLegacyQualificationCoreEntry(...)`
- o fechamento desse mesmo miolo passou a ficar em helper dedicado:
  - `dispatchLegacyQualificationCoreTail(...)`
- no fallback legado, o residual de roteamento antes da rejeicao de entrada invalida agora tambem fica encapsulado em:
  - `dispatchLegacyFallbackRoutingStep(...)`
- com isso, `dispatchLegacyQualificationCore(...)` e `dispatchLegacyFallbackResidualPreMode(...)` perderam mais uma camada de sequencia manual inline

Objetivo:

- continuar comprimindo o `turn-handler.ts` ate ele ficar o mais proximo possivel de um dispatcher curto
- reduzir mais a chance de divergencia local entre gates equivalentes

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo undecimo corte de compressao do `attendee recovery` e do `qualification pre-core`
- `turn-handler.ts` agora concentra o pre-step informacional/audience de `qualification` em helper proprio:
  - `dispatchLegacyQualificationAudienceStep(...)`
- no mesmo bloco, o recovery de atendido no fallback legado passou a ficar encapsulado em helper dedicado:
  - `dispatchLegacyAttendeeRecovery(...)`
- com isso:
  - `dispatchLegacyQualificationPreCore(...)` deixou de montar inline `informational -> audience`
  - `runLegacyFallbackPhase(...)` deixou de recalcular inline o contexto de recovery de atendido antes do `pre-mode`

Objetivo:

- reduzir mais branching local antes do dispatch principal das fases
- deixar `qualification pre-core` e `fallback` mais lineares e previsiveis

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo decimo corte de unificacao da transicao por `service match summary`
- `turn-handler.ts` agora concentra a transicao de entrada em `qualification` em helper dedicado:
  - `buildLegacyQualificationEntryResult(...)`
- no mesmo bloco, o `service gate` de `qualification` passou a reutilizar helper proprio:
  - `buildLegacyQualificationServiceGateResult(...)`
- com isso, `tryResolveLegacyQualificationEntryMatch(...)` e `tryResolveLegacyQualificationServiceGate(...)` deixaram de remontar inline a interpretacao operacional do mesmo `service match summary`
- tambem foi extraido o helper curto:
  - `buildLegacyQualificationContextResult(...)`

Objetivo:

- reduzir mais uma duplicacao local do eixo `match.service / reject / hasContext` dentro de `qualification`
- aproximar o `turn-handler.ts` de um dispatcher curto sobre transicoes nomeadas

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo nono corte de centralizacao do fallback final de `qualification`
- `turn-handler.ts` agora concentra a montagem do estado de rejeicao de qualification em helper proprio:
  - `buildLegacyRejectedQualificationState(...)`
- o fallback final de `qualification` agora tambem fica encapsulado em helper dedicado:
  - `dispatchLegacyQualificationFallback(...)`
- esse helper passou a reunir, na ordem:
  - `answerWithContextualAI(...)`
  - `resolveLegacyQualificationMatchFallback(...)`
- com isso, os pontos que ainda remontavam `step = qualification_rejected` inline passaram a reaproveitar o mesmo helper, incluindo:
  - `tryResolveLegacyQualificationEntryMatch(...)`
  - `tryRejectInvalidLegacyBookingEntry(...)`
  - `tryResolveLegacyQualificationServiceGate(...)`
  - `runLegacyQualificationPhase(...)`

Objetivo:

- reduzir repeticao de estado e de fallback final no `turn-handler`
- deixar o fim de `qualification` mais declarativo e menos sujeito a pequenas divergencias locais

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo oitavo corte de compressao final do `qualification_rejected` e do residual pre-mode
- `turn-handler.ts` deixou de manter o helper separado:
  - `dispatchLegacyQualificationRejectedPostCore(...)`
- o fechamento de `qualification_rejected` agora volta direto para `resolveLegacyRejectedMatchFallback(...)` dentro da propria fase, sem uma camada extra de indirecao
- o restante do `fallback pre-mode` agora tambem fica concentrado em helper proprio:
  - `dispatchLegacyFallbackResidualPreMode(...)`
- esse helper passou a reunir, na ordem:
  - `greeting entry`
  - `ensureConversationMode(...)`
  - `ask_mode`
  - rejeicao de entrada invalida em booking

Objetivo:

- reduzir mais um nivel de indirecao em `qualification_rejected`
- deixar `dispatchLegacyFallbackPreMode(...)` mais proximo de uma tabela de dispatch linear entre `qualification entry`, `booking entry` e o residual final

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo setimo corte de consolidacao de `qualification_rejected` e do fallback pre-mode
- `turn-handler.ts` agora concentra o pos-core de `qualification_rejected` em:
  - `dispatchLegacyQualificationRejectedPostCore(...)`
- no fallback pre-mode, a entrada residual em `qualification` passou a ficar comprimida em uma unica atribuicao local antes do return, em vez de bloco `if` aberto separado

Objetivo:

- reduzir mais uma camada de branching espalhado entre `qualification_rejected` e `fallback`
- deixar o `turn-handler` progressivamente mais proximo de um dispatcher curto sobre helpers nomeados

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo sexto corte de consolidacao do pre-core de `qualification`
- `turn-handler.ts` agora concentra o pre-dispatch exclusivo de `qualification` em um helper dedicado:
  - `dispatchLegacyQualificationPreCore(...)`
- esse helper passou a reunir, na ordem:
  - resposta informacional pura
  - confirmacao de audiencia
  - service gate de qualification
- com isso, `runLegacyQualificationPhase(...)` ficou mais proxima do formato:
  - pre-core
  - core
  - fallback final

Objetivo:

- reduzir mais a quantidade de regra inline em `runLegacyQualificationPhase(...)`
- deixar o fluxo de `qualification` mais declarativo antes do dispatch principal

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quinto corte de consolidacao do bloco `match/reject` no legado
- `turn-handler.ts` agora concentra a resposta operacional do summary de `match/reject` em helpers menores:
  - `shouldRejectLegacyMatchSummary(...)`
  - `buildLegacyMatchSummaryResult(...)`
- com isso, os ramos:
  - `resolveLegacyQualificationMatchFallback(...)`
  - `tryRejectInvalidLegacyBookingEntry(...)`
  - `resolveLegacyRejectedMatchFallback(...)`
  deixaram de remontar criterios equivalentes de rejeicao/contexto em blocos separados

Objetivo:

- reduzir mais uma duplicacao de regra residual no `turn-handler`
- deixar o trecho de fallback/rejeicao mais proximo de uma unica leitura do `service match summary`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quarto corte de reducao dos wrappers finais de booking entry no `turn-handler`
- `turn-handler.ts` deixou de manter tambem os wrappers:
  - `tryEnterLegacyBookingFromSignals(...)`
  - `tryEnterLegacyAnyTurnBooking(...)`
- os call sites agora passam a despachar direto para `tryEnterLegacyBookingIntent(...)`, preservando os gates locais que ainda sao necessarios (`price`, `service_detail`, `list_services`, `mode`), mas sem abrir novas camadas de indirecao

Objetivo:

- aproximar o `turn-handler` de um conjunto menor de primitivas reais de entrada em booking
- reduzir mais a superficie de manutencao no eixo `booking entry`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo terceiro corte de reducao de wrapper no handoff legado
- `turn-handler.ts` deixou de manter o wrapper local `handoffLegacyBookingIntent(...)`
- os pontos de entrada legada em booking agora chamam `handoffBookingIntent(...)` diretamente, sempre com `includeIntro: true`, sem uma camada extra local que ja nao agregava regra propria
- no mesmo bloco, o `turn-handler.ts` tambem perdeu imports residuais que nao participavam mais do fluxo ativo de booking entry

Objetivo:

- comprimir mais a superficie do `turn-handler`
- deixar a entrada em booking mais proxima de um dispatch direto para a primitiva compartilhada real, sem wrappers ornamentais

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo segundo corte de compressao do booking lead legado
- `qualification.ts` agora reaproveita as proprias primitivas compartilhadas tambem dentro do fluxo `enterBookingFromIntent(...)`:
  - `applyRequestMultiBookingState(...)` passou a usar `applyManualAdditionalBookingState(...)` e `applyBookingAttendeeName(...)`
  - `hydrateBookingIntentAttendee(...)` passou a usar `applyBookingAttendeeName(...)`
- com isso, a hidratacao de:
  - `pending_additional_booking`
  - `pending_attendee_name`
  - `pending_additional_count`
  - `expected_additional_count`
  - `slots.attendee_name`
  deixou de ser remontada manualmente em mais de um ponto dentro do proprio `qualification.ts`
- no booking legado, `resolve-booking.ts` teve mais um corte de ruído operacional no gate de `waitingFor`, reduzindo branching inline pequeno e deixando a leitura do contexto mais direta
- em `turn-handler.ts`, a importacao residual de `buildMultiBookingIntro` deixou de ser necessaria depois da consolidacao anterior

Objetivo:

- reduzir mais uma camada de duplicacao operacional no proprio modulo que concentra `enterBookingFromIntent(...)`
- deixar o eixo `booking lead -> attendee hydration -> prompt inicial` mais linear e menos sujeito a divergencia silenciosa

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo primeiro corte de consolidacao do estado inicial de booking legado
- `qualification.ts` passou a concentrar tambem as primitivas compartilhadas de abertura do fluxo de multiagendamento inicial:
  - `enterBookingIntentMode(...)`
  - `applyManualAdditionalBookingState(...)`
  - `buildFirstAttendeePrompt(...)`
  - `applyBookingAttendeeName(...)`
- com isso, `turn-handler.ts` deixou de manter helpers paralelos para:
  - ativar `mode = booking` com limpeza de `step`
  - armar `pending_additional_booking` / `pending_attendee_name`
  - montar o prompt do primeiro atendido
  - aplicar o nome extraido do atendido no estado
- os pontos legados que agora reaproveitam essas primitivas sao:
  - confirmacao de audiencia em `qualification`
  - handoff por sinais de atendido
  - resposta ao prompt de nome do atendido

Objetivo:

- reduzir mais uma camada de autoridade operacional duplicada entre `turn-handler` e `qualification`
- empurrar a inicializacao de booking lead para o modulo que ja concentra `enterBookingFromIntent(...)`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `29 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quadragesimo primeiro corte de consolidacao da montagem dos handlers do orquestrador legado
- `orchestrator-actions.ts` agora concentra a montagem das tabelas de handlers por fase em builders compartilhados:
  - `buildQualificationLikeOrchestratorHandlers(...)`
  - `buildFirstMessageOrchestratorHandlers(...)`
- com isso, `qualification`, `qualification_rejected` e `first_message` deixaram de remontar inline a mesma combinacao estrutural de:
  - `start_booking`
  - `answer_price`
  - `list_services`
  - `ask_clarification`
- no mesmo bloco, o tail de `ask_clarification` foi corrigido para voltar a despachar apenas para `buildOrchestratorClarificationFallbackOrNull(...)`, eliminando ruído residual de compressao anterior no caminho de esclarecimento

Objetivo:

- reduzir mais uma camada de duplicacao estrutural no orquestrador legado sem reabrir precedencia paralela
- deixar a montagem de handlers por fase mais previsivel e mais facil de comparar contra o `semantic_core`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quadragesimo segundo corte de compressao dos gates pre-mode do fallback legado
- `turn-handler.ts` agora separa explicitamente os gates de pre-mode do fallback em helpers pequenos:
  - `shouldTryLegacyFallbackQualificationEntry(...)`
  - `tryResolveLegacyFallbackQualificationEntry(...)`
  - `shouldTryLegacyFallbackBookingEntry(...)`
  - `tryResolveLegacyFallbackBookingEntry(...)`
- com isso, `dispatchLegacyFallbackPreMode(...)` deixou de remontar inline:
  - elegibilidade de `qualification entry`
  - elegibilidade de `any-turn booking entry`
  - handoff operacional para `tryEnterLegacyBookingIntent(...)`

Objetivo:

- comprimir mais o miolo residual do fallback legado antes do dispatch principal
- deixar mais visivel onde ainda existe autoridade operacional no pre-mode, sem misturar regra de elegibilidade com efeito de entrada

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quadragesimo terceiro corte de consolidacao do summary de match/rejeicao de servico
- `qualification.ts` agora concentra a primitiva compartilhada `resolveServiceMatchSummary(...)`, que encapsula:
  - `classifyServiceMatch(...)`
  - `hasMatchContext(...)`
  - `generateRejectionMessageWithAI(...)`
- com isso, os seguintes pontos deixaram de remontar esse mesmo summary por conta propria:
  - `turn-handler.ts`
  - `orchestrator-actions.ts`
  - `turn/early/reject-and-first.ts`
  - `booking/staff-and-date.ts`
- no mesmo bloco, a rejeicao de servico nao listado em `staff-and-date.ts` e no early gate voltou a reaproveitar a mesma primitiva estrutural do legado principal, reduzindo risco de divergencia entre:
  - rejeicao inicial
  - rejeicao em qualification/orchestrator
  - rejeicao durante o booking legado

Objetivo:

- matar uma duplicacao real de classificacao semantica residual fora do `semantic_core`
- garantir que os fluxos legados que ainda precisam classificar servico nao listado consultem a mesma fonte operacional

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quadragesimo quarto corte de compressao dos builders de resposta no `turn-handler`
- `turn-handler.ts` agora concentra a montagem basica de resposta legada em `buildLegacyMessageResult(...)`
- com isso, deixaram de manter montagem paralela de `buildResult(...)` para a mesma familia de respostas:
  - `buildLegacyQualificationContextResult(...)`
  - `buildLegacyRejectedQualificationResult(...)`
  - `buildLegacyAiAnswerResult(...)`
  - `buildLegacyRejectionResult(...)`
  - `buildLegacyMatchSummaryResult(...)`
- o bloco reduz a duplicacao de resposta no eixo `qualification` / `qualification_rejected` / rejeicao simples, sem mudar a precedencia nem a semantica local

Objetivo:

- comprimir mais uma faixa de duplicacao puramente estrutural dentro do maior arquivo residual do legado
- deixar o `turn-handler` mais legivel para os proximos cortes sem reabrir regras paralelas

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quadragesimo quinto corte de compressao estrutural do entrypoint e da camada `internal`
- `index.ts` agora concentra a montagem basica de `SimulatorResult` em `buildSimulatorResult(...)`
- com isso, os retornos simples do entrypoint deixaram de remontar inline a mesma estrutura de:
  - erro de processamento
  - resultado de actor interno
  - fallback de actor interno
  - quote externo fora do `semantic_core`
- este bloco nao migra o `internal` para o `semantic_core`, mas reduz duplicacao operacional na casca que ainda isola:
  - `internal`
  - fallbacks do entrypoint
  - quote externo legado

Objetivo:

- reduzir mais uma faixa de repeticao fora do `semantic_core`, agora no entrypoint
- deixar a camada `internal` mais previsivel enquanto ela ainda nao foi absorvida pela arquitetura soberana

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quadragesimo sexto corte de unificacao dos retornos da camada `internal`
- `internal-intents.ts` agora concentra os retornos basicos em helpers compartilhados:
  - `buildHandledInternalResult(...)`
  - `buildUnhandledInternalResult(...)`
- com isso, os retornos triviais de:
  - intents nao classificadas
  - casos simples de agenda por dia
  - fallback final do switch interno
  deixaram de remontar inline a mesma estrutura `{ handled, message, state, action_options }`

Objetivo:

- reduzir repeticao estrutural dentro da camada `internal`, que ainda conta como debito fora do `semantic_core`
- preparar o arquivo para cortes maiores sem aumentar a superficie de resposta inline

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quadragesimo setimo corte de expansao do builder de retorno no `internal`
- `internal-intents.ts` passou a reaproveitar `buildHandledInternalResult(...)` em mais fluxos concretos da camada `internal`, incluindo:
  - consultas de agenda
  - consulta por faixa de horario
  - busca de contato
  - cancelamento
  - validacoes basicas de criacao de agendamento
  - carga de servicos de orcamento
- com isso, uma nova faixa de retornos inline `{ handled: true, message: ... }` deixou de competir estruturalmente dentro do proprio `internal`

Objetivo:

- continuar drenando repeticao operacional da camada `internal` sem misturar isso com uma migracao semantica maior
- preparar o modulo para os proximos cortes de query repetida e, depois, para eventual absorcao arquitetural

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quadragesimo oitavo corte de consolidacao das respostas de preco compartilhadas
- `qualification.ts` agora concentra helpers compartilhados para resposta de preco:
  - `buildConfiguredPriceResult(...)`
  - `buildUnavailablePriceResult(...)`
- com isso, `turn-handler.ts` e `orchestrator-actions.ts` deixaram de manter montagem paralela para:
  - servico com preco configurado
  - servico sem preco disponivel
- o bloco reduz duplicacao estrutural entre o legado principal e o orquestrador no mesmo eixo de resposta comercial

Objetivo:

- eliminar mais uma faixa de repeticao entre modulos que ainda respondiam a mesma intencao com builders diferentes
- aproximar o legado de um conjunto menor de primitivas compartilhadas antes do corte final do motor antigo

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quadragesimo nono corte de expansao da consolidacao do eixo de preco
- `qualification.ts` agora tambem concentra:
  - `buildPriceAiAnswerResult(...)`
  - `buildCatalogPriceListResult(...)`
- com isso, `turn-handler.ts` e `orchestrator-actions.ts` deixaram de manter montagem paralela tambem para:
  - resposta de preco baseada em IA com CTA de booking
  - vitrine/lista de servicos com preco
- o eixo comercial de preco no legado externo fica agora mais concentrado em primitivas compartilhadas, em vez de espalhado entre modulos

Objetivo:

- continuar reduzindo duplicacao entre `turn-handler` e `orchestrator-actions.ts` no mesmo dominio funcional
- encolher a superficie do legado antes da retirada definitiva do motor antigo

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quinquagesimo corte de compressao dos builders triviais do orquestrador legado
- `orchestrator-actions.ts` agora concentra a montagem basica de resposta em `buildOrchestratorMessageResult(...)`
- com isso, deixaram de manter montagem paralela direta com `buildResult(...)` para:
  - resposta de IA
  - rejeicao
  - fallback generico
  - prompt de booking com CTA
  - esclarecimento com `step` opcional

Objetivo:

- reduzir mais uma faixa de repeticao estrutural dentro do orquestrador legado
- alinhar esse modulo ao mesmo padrao de compressao que ja foi aplicado no `turn-handler`

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quinquagesimo primeiro corte de alinhamento final do miolo residual do `turn-handler`
- `turn-handler.ts` agora tambem reaproveita `buildLegacyMessageResult(...)` em pontos residuais que ainda montavam resposta simples fora do padrao central:
  - `buildLegacyQualificationGuidanceResult(...)`
  - `buildLegacyClarificationResult(...)`
  - `tryHandleLegacyGreetingEntry(...)`
  - `tryResolveLegacyAskMode(...)`
  - `dispatchLegacyQualificationAudienceStep(...)`
- com isso, o miolo de `qualification` e do fallback legado fica mais uniforme e com menos montagem inline de mensagem/estado

Objetivo:

- comprimir os ultimos pontos triviais de resposta do `turn-handler`
- deixar o maior arquivo residual do legado mais previsivel antes dos cortes finais de branch

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

- centesimo quinquagesimo segundo corte de fechamento do helper base do `turn-handler`
- `buildLegacyMessageResult(...)` agora tambem aceita `action_options`
- com isso, o `turn-handler.ts` passou a reaproveitar o mesmo helper tambem em:
  - resposta ao recovery de atendido via `resolveBooking(...)`
  - agradecimento final apos conversa finalizada
- esse bloco fecha mais dois pontos residuais que ainda escapavam do padrao central de montagem de resposta no principal arquivo legado

Objetivo:

- esgotar a superficie residual de `buildResult(...)` inline no `turn-handler`
- deixar esse modulo pronto para cortes maiores de branch, e nao mais de micro-builder

Validacao executada neste bloco:

- `cmd /c npx tsc --noEmit`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
- `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Resultado:

- `semantic-core.test.ts`: `31 passed | 0 failed`
- `semantic-runtime-fixture.test.ts`: `35 passed | 0 failed`

## Handoff operacional para o proximo agente

Estado atual:

- `semantic_core` continua entrando so pelo entrypoint; o legado nao reabre esse dispatch
- o fluxo `external` agora tambem passa a preferir `semantic_core` por padrao quando o engine nao esta explicitamente fixado em `legacy`
- a camada `internal` (owner/admin, agenda/orcamento interno) ainda nao foi absorvida pelo `semantic_core`, mas agora ja esta isolada do runtime `external` no entrypoint via `handleInternalIntent(...)`
- `index.ts` agora tambem concentra a montagem basica de `SimulatorResult` do proprio entrypoint, reduzindo repeticao estrutural na casca que ainda envolve `internal`, quote externo legado e fallback operacional
- `internal-intents.ts` agora tambem concentra a montagem basica de retornos `handled/unhandled`, reduzindo mais uma faixa de repeticao estrutural enquanto essa camada ainda nao foi migrada para o pipeline soberano
- `internal-intents.ts` agora tambem reaproveita esse builder de retorno em uma faixa maior de intents concretas; o proximo corte util nessa camada continua sendo reduzir as queries repetidas de agenda por dia e por faixa
- `turn-handler.ts` ja drena a maior parte da autoridade semantica para helpers dedicados:
  - `runLegacyQualificationRejectedPhase(...)`
  - `runLegacyQualificationPhase(...)`
  - `runLegacyFallbackPhase(...)`
  - `tryHandleLegacyAttendeePromptAnswer(...)`
- `turn-handler.ts` tambem consolidou em `getLegacyServiceMatchSummary(...)` a maior parte da classificacao residual de area/servico e rejeicao contextual
- `turn-handler.ts` agora tambem reaproveita esse summary no gate de entrada invalida em booking, sem reabrir classificacao inline
- a promocao de `servico identificado` agora tambem passa por `applyIdentifiedService(...)` entre `qualification`, `orchestrator` e `turn-handler`
- o bootstrap inicial de servico em `turn-handler.ts` agora tambem passa por helper proprio, em vez de escrever `slots.service` inline
- `runLegacyFallbackPhase(...)` agora tambem fecha em um dispatch unico para continuidade de modo (`booking`/`quote`)
- o handoff em booking por intencao agora tambem passa por `handoffBookingIntent(...)` entre `qualification`, `orchestrator` e `turn-handler`
- o handoff por `servico identificado` agora tambem passa por `handoffIdentifiedServiceBooking(...)` entre `qualification` e `turn-handler`
- a entrada legada em booking agora tambem passa por `tryEnterLegacyBookingIntent(...)` antes dos wrappers de `signals` e `any-turn`
- o array `phases` em `turn-handler.ts` ja foi limpo e agora ficou reduzido aos dispatches ativos
- `runLegacyFallbackPhase(...)` voltou a concentrar tambem:
  - `any-turn booking`
  - `greeting entry`
  - `ensureConversationMode(...)`
  - `ask_mode`
- `orchestrator-actions.ts` reduziu boa parte dos blocos repetidos de:
  - `answer_price`
  - `list_services`
  - `ask_clarification`
  - primeira mensagem
- `orchestrator-actions.ts` tambem ja extraiu handlers dedicados para:
  - `no_match_fallback`
  - `ask_clarification`
  - `service_detail`
- `orchestrator-actions.ts` agora tambem concentra a classificacao residual de `match/rejection` em `getOrchestratorServiceMatchSummary(...)`
- `orchestrator-actions.ts` agora tambem concentra o lookup residual de servico/catalogo em `resolveOrchestratorCatalogService(...)`
- `orchestrator-actions.ts` agora tambem concentra a montagem de `serviceOptions`/`last_service_options` em `buildOrchestratorServiceOptionsState(...)`
- `orchestrator-actions.ts` agora tambem concentra a montagem de esclarecimento em `buildOrchestratorClarificationResult(...)`
- `orchestrator-actions.ts` agora tambem concentra o fallback de catalogo/preco em helpers dedicados
- o documento agora registra explicitamente o guia disciplinar da fase atual para manter o `semantic_core` como camada soberana
- `semantic-runtime-fixture.test.ts` ganhou cobertura explicita para `additional booking -> ask_contact` com opcao de reutilizar contato do titular
- `semantic-runtime-fixture.test.ts` agora tambem cobre, de forma explicita:
  - saudacao seguida de booking
  - booking com servico na primeira frase
  - multiagendamento sem nomes
  - resposta curta preservando contexto de contato
- `semantic-runtime-fixture.test.ts` agora tambem cobre:
  - preco sem transicao implicita para booking
  - `closing` com oferta de calendario apos confirmacao
- `semantic-runtime-fixture.test.ts` agora tambem cobre:
  - `o outro depois` preservando a oferta de sequencia
  - confirmacao de booking adicional com reuso de contato ja decidido
- `semantic-core` agora limpa `contact_preference` apos confirmacao final, com cobertura de runtime e unidade
- `semantic-core.test.ts` agora tambem cobre invariantes unitarias de `contact_options`, `missing_step = contact` e `outbound_notifications`
- `semantic-core.test.ts` agora tambem cobre a camada de renderer/canal, reforcando que adaptacao de opcao e hint visual nao muda a semantica do turno
- `semantic-core.test.ts` agora tambem cobre explicitamente decisoes criticas do `decision_engine` de booking
- o `decision-engine` do `semantic_core` agora monta resultados por helpers locais compartilhados, reduzindo repeticao estrutural sem alterar precedencia
- `runtime.ts` e `test-runtime.ts` agora compartilham a mesma montagem de `ask_clarification`, evitando divergencia entre runtime real e fixtures
- `runtime-helpers.ts` agora concentra a montagem do contexto e a resolucao `policy -> decision -> execution`, reduzindo duplicacao entre runtime real e runner de fixtures
- `semantic-core.test.ts` agora tambem cobre explicitamente esse pipeline compartilhado do runtime
- o snapshot semantico agora tambem carrega `contact_preference` quando o usuario responde ao passo de contato, incluindo `skip_primary`
- o runtime do `semantic_core` agora cobre explicitamente a transicao `usa o mesmo contato -> confirm_booking`
- o runtime do `semantic_core` agora tambem cobre explicitamente `phone`, `email` e `both` ate `confirm_booking`
- o runtime do `semantic_core` agora tambem cobre respostas curtas residuais (`sim`) em audience confirmation, data e horario
- o runtime do `semantic_core` agora tambem disciplina o pos-fechamento: `offer_calendar` so dispara com flag ativo e limpa esse estado apos exibir a oferta
- o snapshot e o `decision_engine` do `semantic_core` agora tambem tratam explicitamente aceite/recusa do calendario, sem fallback generico
- o renderer central do `semantic_core` agora tambem reconhece `reply_calendar_confirmed` e `reply_calendar_declined`, sem recair no fallback visual
- o runtime soberano do `semantic_core` agora tambem:
  - preserva a fila inferida entre executores de booking
  - limpa `slots` de booking corretamente apos confirmacao final
  - nao perde `same_next` ao atravessar o passo de escolha de servico
  - nao reabre template de sequencia quando o snapshot ja trouxe `date/time`
- a validacao automatica do `semantic_core` agora foi de fato executada neste ambiente, e nao apenas planejada:
  - `semantic-core.test.ts` passou integralmente
  - `semantic-runtime-fixture.test.ts` passou integralmente
- `qualification.ts` agora tambem concentra `resolveCatalogService(...)` e `applyBookingLeadContext(...)`, reduzindo duplicacao semantica residual com `orchestrator-actions.ts`
- `qualification.ts` agora tambem concentra `resolveServiceMatchSummary(...)`, reduzindo a duplicacao estrutural de `classifyServiceMatch + hasMatchContext + generateRejectionMessageWithAI` entre `turn-handler`, `orchestrator`, early gate e booking legado
- `qualification.ts` agora tambem concentra helpers compartilhados de resposta de preco, reduzindo mais uma duplicacao estrutural entre `turn-handler` e `orchestrator-actions.ts`
- `qualification.ts` agora tambem concentra resposta de preco via IA com CTA e a vitrine/lista de servicos com preco, reduzindo ainda mais a duplicacao do eixo comercial entre os modulos legados externos
- `qualification.ts` agora tambem concentra a inicializacao compartilhada do booking lead / multiagendamento inicial, antes espalhada no `turn-handler`
- `turn-handler.ts` agora tambem reaproveita essas primitivas no fluxo legado de preco, removendo mais uma duplicacao de lead de booking
- `resolve-booking.ts` agora tambem concentra a avaliacao de contato/completude, reduzindo repeticao no legado de booking
- `turn-handler.ts` agora tambem concentra o roteamento local de `match.service` / `reject` / `context`, reduzindo mais uma camada de branching duplicado
- `turn-handler.ts` agora tambem concentra o bootstrap inicial de servico e reaproveita o helper de `step` nos entrypoints simples de qualification
- `turn-handler.ts` agora tambem concentra os hard-guards e recovery de atendido em helpers compartilhados
- `turn-handler.ts` agora tambem concentra os gates pre-mode do fallback legado em um dispatch unico
- `turn-handler.ts` agora tambem concentra o residual desse fallback pre-mode em helper proprio, deixando a fase mais linear entre `qualification entry`, `booking entry` e residual final
- `turn-handler.ts` agora tambem separa explicitamente a elegibilidade e a execucao dos gates pre-mode de `qualification entry` e `any-turn booking entry`, reduzindo mais uma camada de branching inline no fallback legado
- `turn-handler.ts` agora tambem concentra o miolo comum de `qualification` e `qualification_rejected` em um helper unico
- `runLegacyQualificationRejectedPhase(...)` ja nao depende mais de um pos-core separado so para chamar `resolveLegacyRejectedMatchFallback(...)`
- `turn-handler.ts` agora tambem concentra o estado `qualification_rejected` e o fallback final de `qualification` em helpers compartilhados, reduzindo mais uma camada de montagem inline
- `turn-handler.ts` agora tambem concentra a montagem basica de resposta legado em `buildLegacyMessageResult(...)`, reduzindo repeticao de `buildResult(...)` entre contexto, rejeicao e fallback de match
- `turn-handler.ts` agora tambem reaproveita esse helper nos pontos residuais de greeting entry, ask_mode, guidance, clarification e pre-step informacional, reduzindo mais uma faixa de resposta inline no miolo legado
- `turn-handler.ts` agora tambem usa o mesmo helper base para respostas com `action_options` e para o agradecimento final, deixando o proximo passo mais voltado a cortar branch do que a alinhar builder
- `turn-handler.ts` agora tambem concentra em helpers compartilhados a transicao por `service match summary` na entrada e no `service gate` de `qualification`
- `turn-handler.ts` agora tambem concentra em helpers compartilhados o `attendee recovery` do fallback e o pre-step `informational/audience` de `qualification`
- `turn-handler.ts` agora tambem concentra em helpers compartilhados o `entry/tail` do miolo de `qualification` e o routing residual do `fallback pre-mode`
- `resolve-booking.ts` agora tambem concentra a derivacao operacional do turno em helper unico, deixando a entrada mais curta antes de `BOOKING_HANDLERS`
- `orchestrator-actions.ts` agora tambem concentra a montagem compartilhada da propria tabela de handlers, reduzindo mais uma duplicacao estrutural entre `qualification`, `qualification_rejected` e `first_message`
- `orchestrator-actions.ts` agora tambem concentra a montagem das tabelas de handlers por fase em builders dedicados e voltou a deixar o tail de `ask_clarification` alinhado ao fallback unico de esclarecimento
- `orchestrator-actions.ts` agora tambem concentra a montagem basica das respostas triviais em `buildOrchestratorMessageResult(...)`, reduzindo mais uma camada de `buildResult(...)` repetido no legado externo
- `index.ts` agora tambem concentra parte do runtime `internal` em helper proprio de rate limit, mantendo essa camada mais isolada no radar sem puxar o escopo principal
- `resolve-booking.ts` agora tambem concentra a entrada informacional e o dispatch final dos handlers, deixando a funcao principal ainda mais curta
- `index.ts` agora tambem concentra helpers auxiliares do runtime `internal`, reduzindo mais detalhe inline nessa camada paralela
- `index.ts` agora tambem deixou de duplicar o rate limit do branch `internal` no dispatch principal, deixando essa regra em um unico ponto
- `turn-handler.ts` agora tambem concentra o bootstrap de entrada do turno e o fechamento final de agradecimento em helpers compartilhados
- `turn-handler.ts` agora tambem usa `resolveLegacyIncomingTurnInput(...)` como primitiva real do bootstrap do turno, sem duplicar inline a normalizacao numerica de acoes/servicos
- `orchestrator-actions.ts` agora tambem concentra a resposta de preco com servico identificado em primitiva unica compartilhada
- `orchestrator-actions.ts` agora tambem concentrou o fallback final de catalogo/preco da primeira mensagem e removeu helper redundante residual
- `orchestrator-actions.ts` agora tambem deixou o tail de `ask_clarification` mais explicito, com helper alinhado ao papel real de fallback de esclarecimento
- `resolve-booking.ts` agora tambem centraliza o criterio base de slots obrigatorios de booking, reduzindo mais uma divergencia curta de completude
- `resolve-booking.ts` agora tambem centraliza as leituras auxiliares de `lastAssistantMsg` e `pending service choice`, reduzindo mais um pouco o ruído de `waitingFor`
- `resolve-booking.ts` agora tambem separa em helper proprio a falta estrutural de `service/date/time`, em vez de misturar isso inline ao `waitingFor`
- `turn-handler.ts` agora tambem centraliza a resposta de entrada em `qualification_rejected`, reduzindo mais uma repeticao curta de state + result
- `turn-handler.ts` agora tambem centraliza a resposta legado de preco com e sem valor disponivel, reduzindo mais uma duplicacao curta no eixo `answer_price`
- `turn-handler.ts` agora tambem centraliza a resposta legado de preco quando a IA retorna um valor valido, reduzindo mais uma repeticao curta no mesmo eixo
- `orchestrator-actions.ts` agora tambem centraliza a resposta direta da IA antes do fallback generico, reduzindo mais uma repeticao curta no legado
- `orchestrator-actions.ts` agora tambem reaproveita o helper comum de `serviceOptions/last_service_options` no fallback de preco por catalogo
- `turn-handler.ts` agora tambem concentra a vitrine legado de preco por catalogo em helper proprio, reduzindo mais uma escrita manual de `last_service_options`
- `turn-handler.ts` agora tambem centraliza a resposta direta da IA no fallback final de `qualification`, reduzindo mais uma repeticao curta
- `orchestrator-actions.ts` agora tambem centraliza a resposta de rejeicao contextual, reduzindo mais uma repeticao curta no legado
- `turn-handler.ts` agora tambem centraliza a resposta de rejeicao contextual simples, reduzindo mais uma repeticao curta no legado
- `orchestrator-actions.ts` agora tambem centraliza o fallback generico em helper proprio, reduzindo mais uma montagem inline residual
- `turn-handler.ts` agora tambem centraliza o esclarecimento simples do bootstrap legado, reduzindo mais uma montagem inline residual
- `orchestrator-actions.ts` agora tambem centraliza o CTA simples de booking no `service_detail` inicial, reduzindo mais uma repeticao curta
- `orchestrator-actions.ts` agora tambem concentra a vitrine/lista residual de servicos em helper unico, reduzindo mais uma duplicacao curta de `serviceOptions + last_service_options`
- `turn-handler.ts` agora tambem concentra o runner comum das fases `qualification` e `qualification_rejected`, reduzindo mais uma duplicacao de core + fallback no legado externo
- `internal-intents.ts` agora tambem reaproveita de forma mais ampla os builders `buildHandledInternalResult(...)` / `buildUnhandledInternalResult(...)`, reduzindo mais uma faixa de retornos inline no runtime `internal`
- `internal-intents.ts` agora tambem concentra a consulta e a formatacao da agenda por data em helpers compartilhados, reduzindo duplicacao entre `today`, `tomorrow` e `by_date`
- `internal-intents.ts` agora tambem concentra a limpeza de `quote_pending` / `appointment_pending` em helper compartilhado, reduzindo mais uma repeticao curta nas confirmacoes do runtime `internal`
- `internal-intents.ts` agora tambem reaproveita a query base de appointments por dia nos fluxos de consulta por horario e cancelamento, reduzindo mais uma duplicacao operacional no `internal`
- `internal-intents.ts` agora tambem concentra as queries de contato por ids e por termo em helpers compartilhados, reduzindo mais uma duplicacao de acesso a `contact` no runtime `internal`
- `index.ts` agora tambem reaproveita o builder central no rate limit do branch `internal`, eliminando o ultimo retorno inline simples dessa casca operacional
- `internal-intents.ts` agora tambem concentra a janela de horario em helper compartilhado, reduzindo repeticao entre consulta por horario e cancelamento
- `internal-intents.ts` agora tambem concentra a resolucao/criacao do contato interno na confirmacao de agendamento, reduzindo mais uma duplicacao operacional de `contact`
- `internal-intents.ts` agora tambem concentra a montagem de estado pendente (`appointment_pending` / `quote_pending`) em helper compartilhado, reduzindo mais uma duplicacao curta de state + action options
- `internal-intents.ts` agora tambem concentra a query de conflito de agenda e a carga de `quote_service` ativo em helpers compartilhados, reduzindo mais uma duplicacao operacional no runtime `internal`
- `internal-intents.ts` agora tambem concentra a formatacao da consulta por faixa horaria em helper compartilhado, reduzindo mais uma repeticao de linhas/telefone/servico no runtime `internal`
- `internal-intents.ts` agora tambem concentra a renderizacao da busca de contatos por nome em helper compartilhado, reduzindo mais uma repeticao de `0/1/N resultados`
- `internal-intents.ts` agora tambem concentra a validacao/draft de criacao de agendamento em helper compartilhado, reduzindo mais uma faixa de branching operacional no `internal`
- `internal-intents.ts` agora tambem concentra a selecao operacional do `quote_service` ativo em helper proprio, reduzindo mais uma decisao repetida dentro do runtime `internal`
- `internal-intents.ts` agora tambem concentra o runner das consultas de agenda por data em helper compartilhado, reduzindo mais uma duplicacao de query + erro + render entre `today`, `tomorrow` e `by_date`
- `internal-intents.ts` agora tambem concentra o envelope comum de confirmacoes pendentes em helper compartilhado, reduzindo mais uma duplicacao de `persist -> clear pending -> responder`
- `internal-intents.ts` agora tambem concentra o parsing de data interna e os gatilhos-base de agenda em helpers compartilhados, reduzindo mais uma duplicacao residual da classificacao deterministica
- `internal-intents.ts` agora tambem concentra a busca de agendamentos por faixa horaria em helper compartilhado, reduzindo mais uma duplicacao entre consulta por horario e cancelamento
- `internal-intents.ts` agora tambem concentra a extracao base de `time/date/name` na classificacao deterministica, reduzindo mais uma repeticao curta entre `cancel_appointment` e `create_appointment_internal`
- `internal-intents.ts` agora tambem concentra a resolucao de nome para `query_contact_by_name` em helper compartilhado, reduzindo mais uma duplicacao curta na classificacao deterministica
- `internal-intents.ts` agora tambem concentra a resolucao base de horario explicito em helper compartilhado, reduzindo mais uma repeticao curta entre `query_contact_by_appointment_time` e `query_appointment_by_time`
- `internal-intents.ts` agora tambem concentra o filtro efetivo da faixa horaria dentro do lookup compartilhado, reduzindo mais uma duplicacao curta entre consulta por horario e cancelamento
- `index.ts` agora tambem concentra a montagem do resultado handled em helper compartilhado entre `internal` e quote externo legado, reduzindo mais uma duplicacao curta no entrypoint
- `index.ts` agora tambem reaproveita o builder central no pos-processamento conversacional de `action_options`, reduzindo mais uma remontagem manual de resultado no entrypoint
- `index.ts` agora tambem concentra o cast de `result.state` em um `resultState` local no fechamento da resposta, reduzindo repeticao curta de leitura e filtro do estado final
- `index.ts` agora tambem concentra o shape comum de mensagem assistant no fechamento da resposta, reduzindo mais uma duplicacao curta entre mensagem principal e mensagens auxiliares
- `index.ts` agora tambem concentra a decisao de `service_multi_select` em helper proprio no fechamento da resposta, reduzindo mais uma ilha inline de logica operacional
- `index.ts` agora tambem concentra o envelope de persistencia das mensagens assistant em helper compartilhado, reduzindo mais uma duplicacao curta entre log da mensagem principal e auxiliares
- `index.ts` agora tambem concentra o envelope de persistencia da mensagem user em helper proprio, alinhando o fechamento de `conversation_messages` a um padrao unico de builders
- `index.ts` agora tambem materializa uma unica vez as `extraAssistantMessages` validas, reduzindo mais uma duplicacao curta de filtro entre persistencia e resposta final
- `index.ts` agora tambem concentra a montagem de `contextUpdate` em helper proprio, reduzindo mais uma ilha inline no fechamento operacional do turno
- `index.ts` agora tambem concentra o payload de insert de `appointment` derivado de `completed_bookings` em helper proprio, reduzindo mais uma faixa repetitiva do fechamento operacional
- `index.ts` agora tambem faz o loop de `completed_bookings` consumir o helper de insert como caminho efetivo unico, neutralizando a duplicacao residual desse fechamento
- `resolve-booking.ts` agora tambem reaproveita `hasCompletedBooking` ja derivado ao interpretar contexto adicional, reduzindo uma recomputacao curta no setup do booking legado
- `index.ts` agora deixa mais explicitos os preprocessamentos por ator (`internal`/`external`) antes de cair no fluxo principal
- `resolve-booking.ts` ja ficou mais proximo de um orquestrador curto de contexto + `BOOKING_HANDLERS`
- `qualification.ts` ja modularizou boa parte de `enterBookingFromIntent(...)`
- `turn/early/reject-and-first.ts` e `booking/staff-and-date.ts` agora tambem reaproveitam a primitiva compartilhada de match/rejeicao, reduzindo divergencia entre gates de entrada e booking legado
- a validacao com `cmd /c npx tsc --noEmit` precisa ser rodada novamente apos novos cortes relevantes ou antes de deploy

Arquivos mais relevantes agora:

- `supabase/functions/conversations-turn/lib/turn-handler.ts`
- `supabase/functions/conversations-turn/lib/qualification.ts`
- `supabase/functions/conversations-turn/lib/resolve-booking.ts`
- `supabase/functions/conversations-turn/lib/orchestrator-actions.ts`

Proximo passo recomendado:

1. preservar essa barra de validacao automatica do `semantic_core` a cada bloco relevante:
   - `cmd /c npx tsc --noEmit`
   - `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
   - `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`
2. continuar convertendo a matriz de aceite critica em fixtures executaveis, priorizando:
  - retomada de continuidade apos finalizacao
  - respostas curtas residuais como `sim` e `pode ser` em pontos de continuidade ainda nao cobertos
  - variacoes curtas adicionais em sequencia e horario que ainda nao tenham fixture dedicada
  - respostas finais curtas de encerramento apos calendario, se ainda houver variacao relevante no runtime
3. revisar se ainda sobra autoridade semantica relevante fora do `semantic_core`, principalmente nos pontos em que `turn-handler`, `qualification`, `orchestrator` e a camada `internal` ainda decidem comportamento em paralelo
4. se a barra de testes continuar verde, voltar ao corte de superficie duplicada pelos pontos restantes do legado sem reabrir duplicidade no `turn-handler`, principalmente nos ultimos gates locais ainda antes do dispatch principal

Criterio de continuidade:

- evitar criar interpretacao paralela nova fora de `semantic_core`
- preferir novos helpers pequenos e reuso antes de mover comportamento
- manter o documento atualizado a cada bloco relevante, nao a cada microedicao

## Handoff Obrigatorio Para Proximo Agente

Status atual do projeto:

- percentual estimado de conclusao: `99%`
- esse percentual so vira `100%` quando o `internal` deixar de existir como runtime paralelo fora da soberania do `semantic_core`
- a fase atual ja drenou quase toda a duplicacao local util do legado externo e da casca operacional
- o que resta e principalmente fechamento arquitetural, nao mais microdeduplicacao cosmetica

Leitura obrigatoria antes de qualquer nova acao:

- ler o documento inteiro do inicio ao fim
- entender a evolucao completa da refatoracao antes de editar qualquer arquivo
- revisar especialmente os blocos finais de status evolutivo e os criterios de continuidade

Regra critica de disciplina:

- evitar a todo custo qualquer reintroducao de duplicacao de codigo, duplicacao semantica ou funcoes concorrentes que facam a mesma coisa
- nao criar interpretacao paralela nova fora do `semantic_core`
- nao aceitar convivencia permanente entre runtime novo e legado como estado final

Diretriz de execucao por bloco:

- sempre refatorar o maximo possivel em cada acao, desde que o corte continue seguro
- sempre atualizar este documento ao terminar cada bloco relevante
- sempre registrar status evolutivo ao final de cada bloco
- sempre informar percentual estimado de conclusao ao final de cada entrega
- sempre rodar a barra minima de validacao antes de considerar um bloco concluido:
  - `cmd /c npx tsc --noEmit`
  - `cmd /c npx deno test --allow-env lib/semantic-core/semantic-core.test.ts`
  - `cmd /c npx deno test --allow-env lib/semantic-core/semantic-runtime-fixture.test.ts`

Regra de arquitetura final:

- o legado tera que ser desligado
- nao deve existir nenhum tipo de convivencia permanente entre legado e `semantic_core`
- `semantic_core` deve ser a unica autoridade soberana do turno quando o projeto for considerado concluido
- se algum caminho ainda depender do legado ou de runtime paralelo, o projeto nao esta finalizado

Foco real do proximo ciclo:

- parar de espremer apenas microdeduplicacao onde o ganho ja ficou marginal
- priorizar o fechamento arquitetural restante
- resolver explicitamente a absorcao, substituicao ou desligamento definitivo do `internal`
