# ANÁLISE – Protagonismo da IA no conversations-turn (Revisão + Integração com v2)

## OBJETIVO

Revisar o uso atual de IA no conversations-turn para:

1. Garantir flexibilidade em conversas reais (cliente caótico / ambíguo).
2. Evitar fluxo engessado.
3. Integrar corretamente com:
   - catalog_services
   - booking_services
   - sequence_eligible_services
4. Manter determinismo (agenda, validação, persistência).
5. Formalizar pontos já parcialmente implementados.

Este documento NÃO propõe reescrever tudo.
É uma análise de como estruturar e consolidar o que já existe.

---

# 1️⃣ PRINCÍPIO ARQUITETURAL

Regra central:

IA conduz a conversa.
Código garante as regras.

Ou seja:

- IA interpreta intenção, contexto e extrai slots.
- Sistema valida:
  - serviço existe?
  - serviço é agendável?
  - horário é válido?
  - preço existe?
  - política reject_unlisted?
- Persistência sempre determinística.

A IA nunca grava diretamente nada crítico.

---

# 2️⃣ ESTADOS ATUAIS DO FLUXO

Estados principais observados:

- qualification
- booking
- finalized

A IA hoje já atua em:
- interpretação de intenção
- extração de slots
- respostas contextualizadas

Mas há pontos onde:
- o fluxo pode ficar rígido
- decisões ainda dependem fortemente de ramificações fixas

Objetivo da revisão:
Aumentar protagonismo da IA sem perder controle estrutural.

---

# 3️⃣ PROBLEMA REAL – CLIENTE CAÓTICO

Exemplos típicos:

- “algo rápido amanhã”
- “quinta… não, melhor sexta”
- “era pra mim… não, pro meu irmão”
- “valeu! ah e onde fica?”
- mistura agradecimento + pergunta
- mistura preço + agendamento

O fluxo não pode:
- reiniciar
- ignorar parte da mensagem
- exigir formato perfeito

---

# 4️⃣ DECISION JSON (PADRÃO RECOMENDADO)

Formalizar saída estruturada da IA:

```json
{
  "mode_suggestion": "qualification | booking | finalized",
  "primary_intent": "ask_service | ask_price | booking_request | faq | thanks | other",
  "secondary_intents": [],
  "action": "ask | inform | confirm | list_options | handoff",
  "waiting_for": "service | date | time | attendee | none",
  "slots_extracted": {
    "service": "...",
    "date": "...",
    "time": "...",
    "attendee_name": "...",
    "for_third_party": true
  },
  "slot_conflicts": [],
  "confidence": {
    "service": 0.92,
    "date": 0.66,
    "time": 0.84
  },
  "response_draft": "..."
}

Regras:

Slots com alta confiança → aceitar

Confiança média → confirmar

Confiança baixa → perguntar

O sistema sempre valida contra:

getCatalogServices()

getBookingServices()

5️⃣ MULTI-INTENÇÃO

Se IA detectar múltiplas intenções:

Exemplo:
“valeu! onde fica?”

IA retorna:

primary_intent: ask_address

secondary_intents: [thanks]

O sistema responde:

responde endereço

incorpora agradecimento

não reabre fluxo de booking

Isso evita rigidez.

6️⃣ REPAIR LOOP (CORREÇÃO DE SLOT)

Caso cliente contradiga informação anterior:

Ex:
“João”
Depois:
“na verdade é pro meu irmão”

IA deve:

detectar conflito

sugerir atualização de slot

manter demais slots

Sistema:

substitui slot conflitante

confirma se necessário

Não reiniciar fluxo.

7️⃣ INTEGRAÇÃO COM CATALOG vs BOOKING

Nova modelagem impacta IA da seguinte forma:

Pergunta informativa

IA usa:
getCatalogServices(config)

Pergunta de preço

IA extrai serviço →
Sistema verifica:

Está em booking_services com base_price?
→ responder preço

Está apenas em catalog?
→ "Preço sob consulta"

Pedido de agendamento

IA usa:
getBookingServices(config)

Nunca misturar.

8️⃣ LIST_SERVICES NO ORCHESTRATOR

Regra clara:

Informativo (“quais serviços?”) → catalog_services

Pré-agendamento (“quero marcar”) → booking_services

Evitar ambiguidade.

9️⃣ CLASSIFYSERVICEMATCH

Refatorar para:

classifyServiceMatch(text, services)

Nunca depender diretamente de config.services.

Chamador decide:

Catalog (validação de existência)

Booking (fluxo de agendamento)

🔟 buildConfigSummary (IA context)

Opção recomendada:

Enviar para IA:

catalog_services (nomes + descrição)

booking_services (com preço e duração)

Se simplificar:

pelo menos booking_services

Evitar perder contexto do negócio.

1️⃣1️⃣ GARANTIAS DE CONTROLE

Mesmo com protagonismo da IA:

Nunca criar serviço que não exista

Nunca aceitar slot sem validação

Nunca agendar sem checar disponibilidade

Nunca responder preço inexistente

Nunca ignorar reject_unlisted

IA sugere.
Sistema decide.

1️⃣2️⃣ RISCOS IDENTIFICADOS

classifyServiceMatch ainda depende implicitamente de config.

list_services pode misturar informativo e agendamento.

buildConfigSummary pode não refletir nova modelagem.

context enviado para webhooks pode não incluir catalog/booking.

fallback legacy services pode mascarar erro de migração.

1️⃣3️⃣ CONCLUSÃO

O sistema já possui IA com certo protagonismo.
O que falta é:

Formalizar contrato de saída (Decision JSON)

Garantir multi-intenção estruturada

Garantir repair loop

Integrar completamente com catalog vs booking

Centralizar validação via getters

Revisar context enviado à IA

Resultado esperado:

✔ Conversa fluida
✔ Cliente caótico não quebra fluxo
✔ Sistema permanece determinístico
✔ Nova modelagem totalmente integrada
✔ IA com papel central, mas controlado

PRÓXIMO PASSO RECOMENDADO

Revisar especificamente:

conversations-turn/index.ts

classifyServiceMatch

buildConfigSummary

chamadas de IA em qualification e finalized

Validar se já seguem esse modelo ou precisam ajuste.


---

# V3 – Orchestrator “Concierge IA” (incremental, sem reescrever o sistema)

## Objetivo
Aumentar a fluidez para clientes caóticos (“sem noção”) sem engessar o fluxo, mantendo:
- regras determinísticas (validação, disponibilidade, persistência)
- multi-tenant e segurança
- separação catalog_services vs booking_services
- compatibilidade com o que já existe (V2), evoluindo por camadas

---

## 1) Visão geral: IA conduz, código decide
V3 formaliza 3 camadas:

1) **Detector determinístico (fast-path)**
   - confirmações (“pode ser”, “isso”) e opções numéricas (“1”, “2”)
   - parsing local de telefone, datas/hora simples
   - comandos internos (se modo internal)
   -> evita chamar IA quando o caminho é óbvio e barato

2) **Concierge IA (default em ambiguidade)**
   - multi-intenção
   - extração de slots com histórico
   - “repair loop” (corrige mudança de ideia sem resetar fluxo)
   - respostas fluidas em qualification/finalized

3) **Executor determinístico**
   - valida slots contra config
   - checa disponibilidade
   - aplica políticas (reject_unlisted, sob consulta, handoff)
   - persiste booking/quote
   -> a IA nunca persiste nada crítico

---

## 2) Contrato da IA: Decision JSON (obrigatório no V3)
A IA não retorna “texto solto” como decisão do fluxo.
Ela retorna um JSON padronizado e o sistema valida.

### Schema (mínimo)
```json
{
  "mode_suggestion": "qualification | booking | finalized",
  "primary_intent": "booking_request | ask_service | ask_price | faq | thanks | other",
  "secondary_intents": ["thanks", "faq_address"],
  "action": "ask | inform | confirm | list_options | handoff",
  "waiting_for": "service | date | time | attendee | phone | none",
  "slots_extracted": {
    "service": "Corte",
    "date": "next_thursday",
    "time": "14:00",
    "attendee_name": "João",
    "for_third_party": true
  },
  "slot_conflicts": [
    { "slot": "attendee_name", "from": "Eu", "to": "Meu irmão" }
  ],
  "confidence": {
    "service": 0.90,
    "date": 0.62,
    "time": 0.85,
    "attendee_name": 0.55
  },
  "response_draft": "..."
}


Regras de aceitação (determinístico)

confidence >= 0.85: aceitar slot direto

0.60–0.84: aceitar provisório + pedir confirmação curta

< 0.60: perguntar

Obs.: thresholds podem ser constantes.

3) Multi-intenção (resposta composta, sem engessar)

V3 permite responder 2 coisas no mesmo turno.
Ex.: “valeu… e onde fica?” deve responder endereço e incluir despedida, sem reabrir booking.
Isso já está na simulação como duas intenções no estado finalized. (ver lógica do Turno 10) 

simulacao-atendimento-cliente-s…

Implementação:

primary_intent define o branch principal

secondary_intents são respondidos com trechos curtos no final

Limite: 2 intenções por turno para não virar texto longo

4) Repair Loop (mudança de ideia sem reset)

Quando o cliente contradiz slots (“era pra mim… pro meu irmão”), V3:

detecta conflito (slot_conflicts)

atualiza apenas o slot afetado

preserva os demais slots preenchidos

Isto é exatamente o caso “João. era pro meu irmão” na simulação: mantém/ajusta titular sem reiniciar o fluxo. 

simulacao-atendimento-cliente-s…

Regra:

slot_conflicts != [] => aplicar atualização + (se confiança baixa) confirmar em 1 frase

5) Separação Catalog vs Booking (V3 aplica em todos os pontos)

V3 obriga o orquestrador a escolher “qual conjunto de serviços” usar:

Informativo (quais serviços?) => getCatalogServices(config)

Agendamento => getBookingServices(config)

Preço => getBookingServices(config) (base_price)

Preço de item só do catálogo => “sob consulta” + CTA (agendar visita/handoff)

Isso evita IA “inventar” serviço agendável e evita preço indevido.

6) Roteamento V3: prioridade por estado + intenção
A) finalized

se mensagem contém FAQ (endereço, horário, localização, “onde fica”) -> responder direto (IA concierge)

se contém novo pedido de agendar -> voltar para qualification/booking com contexto preservado

B) qualification

IA concierge é default quando:

texto vago

múltiplos tópicos

“algo rápido”

“pra mim ou pro meu irmão”

objetivo: chegar em service (booking_services) + “para quem” sem pressão

C) booking

manter executor determinístico:

slots → validar → disponibilidade → confirmar → persistir

IA entra para extrair slots em linguagem natural (amanhã… quinta, 14h se não tiver depois)

7) Fast-path determinístico (corta custo e melhora robustez)

Antes de chamar IA, V3 roda:

opção numérica => resolve serviço/sequence

isConfirm => confirma bookingComplete

parsePhone => preencher contato

parseDateOrWeekday simples => preencher data

parseTime simples => preencher hora

Se conseguir avançar, não chama IA.

A IA entra quando:

há ambiguidade

há múltiplas intenções

parsing simples falhou

8) Ações novas / refinamentos (features V3)
8.1 “Service disambiguation” (algo rápido)

Quando o texto não bate com serviço:

IA sugere candidatos do booking (ex.: Barba 20m, Corte 30m) e pergunta escolha
Isso já é descrito na simulação (Turno 3). 

simulacao-atendimento-cliente-s…

8.2 “Price intent” robusto

detectar serviço no texto

se base_price existe -> responder

se não existe -> “sob consulta” + CTA (visita técnica / handoff)

8.3 “Mode guard” (segurança)

Cliente externo não pode executar comandos internos (“meus agendamentos de hoje”):

V3 mantém bloqueio e responde de forma genérica, oferecendo agendar/dúvidas
(isto já aparece na simulação de onboarding/conversation). 

simulacao-onboarding-e-conversa…

9) Integração com código atual (mínima invasão)

V3 não exige reescrever tudo.
Implementar como “camada” no index.ts:

fastPathResult = tryFastPath(text, state, config)

se retornou action -> responder/avançar

decision = getConciergeDecisionJSON({ text, history, state, config_summary })

validar JSON e aplicar regras de confiança

applyDecision(decision, state, config)

merge slots

repair loop

escolher getters (catalog/booking)

chamar executor determinístico: resolveBooking / askNext / confirm / persist

renderResponse(decision, executorResult)

usar response_draft como base

anexar respostas de secondary_intents

manter mensagem curta

10) Observabilidade (V3 precisa disso)

Logar por turno:

fastPath: hit/miss

decision JSON (sem dados sensíveis)

slots aceitos vs confirmados

conflicts detectados

qual getter usado (catalog vs booking)

razão de handoff

Isso é essencial para iterar sem “chutar”.

11) Plano de rollout (seguro)

Feature flag: concierge_v3_enabled

Ativar primeiro apenas para:

finalized + FAQ (baixo risco)

qualification (médio risco)

booking (alto risco) ativar por último, pois toca persistência

12) Critérios de sucesso

Redução de “loops” e “perguntas repetidas”

Aumento de conversão para booking em mensagens vagas

Menos handoff desnecessário

Menos abandono por fricção

Zero regressão em validação/persistência

Nota final

A simulação “cliente sem noção” já descreve a essência do V3:
IA interpreta a bagunça; código mantém consistência e confirma/persiste. 

simulacao-atendimento-cliente-s…


O V3 apenas formaliza:

multi-intenção

repair loop

decision JSON

separação catalog vs booking em todos os branches

fast-path determinístico para reduzir custo e aumentar robustez