# Ajustes: simulador onboarding — estado perdido e fluxo pós‑“sim”

**Data:** 2025-03  
**Contexto:** A IA do simulador do onboarding “se perde” após confirmação de público (“sim”): pula para “Qual contato você prefere?” em vez de pedir nome/serviço/data/horário, e repete a pergunta de contato mesmo quando o usuário responde “o meu mesmo Carlos”.

---

## 1. Diálogo que evidenciou o problema

| Quem   | Mensagem |
|--------|----------|
| User   | bom dia como é que vai? |
| Bot    | Bom dia! Estou bem, obrigado por perguntar. Como posso ajudá-lo hoje? |
| User   | tem algum horario agora pra tarde? |
| Bot    | Sim, ainda temos horários disponíveis para esta tarde. Só para confirmar: atendemos homens e crianças a partir de 8 anos. Vocês se encaixam? Qual serviço você gostaria de agendar: Corte ou Barba? |
| User   | sim |
| Bot    | **Qual contato você prefere usar para confirmar o agendamento?** ← errado: deveria pedir nome ou serviço |
| User   | o meu mesmo Carlos |
| Bot    | **Qual contato você prefere usar para confirmar o agendamento?** ← repetiu; deveria ter entendido “Carlos” como nome e “o meu mesmo” como preferência de contato |

---

## 2. Análise técnica

### 2.1 Por que apareceu “Qual contato?” depois do “sim”

- O **motor semântico** (semantic core) decide o próximo passo com base em `deriveBookingContext` → `missing_step`.
- A ordem de decisão em `decision-engine/booking.ts` é: `pending_secondary_contact` → `pending_calendar_offer` → WhatsApp contact → `pending_contact_field === "phone"` → **audience** → **attendee** → service → date → time → **contact**.
- Depois de “sim”, o esperado é:
  - Detecção de continuação `audience_confirmation` (em `context-continuation.ts`).
  - `buildAudienceRisk(..., confirmedAlready: true)` → `requires_confirmation = false`.
  - `missing_step` = `"attendee"` (porque `!hasAttendee`) → decisão **ask_attendee_name**, não ask_contact.

Conclusão: quando o bot pergunta contato logo após “sim”, o estado que chegou no servidor tinha **slots já preenchidos** (serviço, data, horário, nome) e **sem** `audience_confirmed: true`. Ou seja:

- Estado **antigo** de outra sessão (ex.: outro teste) foi reutilizado; ou
- Estado no cliente (ref/sessionStorage) não foi atualizado corretamente após a resposta que pedia “Vocês se encaixam?”.

Assim, o backend “achou” que só faltava contato e decidiu **ask_contact**.

### 2.2 Proteção implementada (servidor)

Em `supabase/functions/conversations-turn/lib/semantic-core/booking-context.ts` foi adicionada uma **proteção** em `deriveBookingContext`:

- Se `missing_step === "contact"` **e**
  - `audience_confirmed !== true` **e**
  - não há `completed_bookings` **e**
  - não há `last_booking`,  
  então o estado é tratado como inconsistente (ex.: estado antigo de outra sessão).
- Nesse caso, **não** se aceita ir para contact; o passo é recuado para o primeiro que realmente falta: attendee → service → date → time.

Com isso, mesmo que o cliente envie um estado “adiantado” (slots cheios sem público confirmado), o fluxo volta a pedir nome/serviço/data/horário em vez de pular para contato.

### 2.3 “o meu mesmo Carlos”

- O usuário quis dizer: **nome = Carlos** e **preferência de contato = usar o mesmo (ex.: WhatsApp do remetente)**.
- O bot repetiu “Qual contato você prefere?” porque:
  - Ou a decisão continuou sendo ask_contact e a mensagem não foi interpretada como “uso o meu número” + “meu nome é Carlos”, ou
  - O executor de contato / extração de entidades não trata bem a junção “o meu mesmo” + nome na mesma frase.

Melhorias desejáveis (para o próximo agente):

- No passo **ask_contact**, ao interpretar a resposta:
  - Detectar padrões como “o meu mesmo”, “pode ser o meu”, “usa o meu” etc. e considerar como “usar o contato já disponível” (ex.: WhatsApp).
  - Extrair nome próprio (ex.: “Carlos”) da mesma mensagem e preencher `attendee_name` / `customer_name` quando ainda faltar.
- Garantir que, após aplicar nome + preferência de contato, o estado seja atualizado e a próxima decisão não seja de novo ask_contact.

---

## 3. Onde está o fluxo (para continuar os ajustes)

| Objetivo | Arquivo / camada |
|----------|-------------------|
| Decisão do próximo passo (audience → attendee → service → date → time → contact) | `supabase/functions/conversations-turn/lib/semantic-core/decision-engine/booking.ts` |
| Cálculo de `missing_step` e proteção contra estado inconsistente | `supabase/functions/conversations-turn/lib/semantic-core/booking-context.ts` (função `deriveBookingContext`) |
| Detecção de “sim” como confirmação de público | `supabase/functions/conversations-turn/lib/semantic-core/context-continuation.ts` (`isAwaitingAudienceConfirmation`, `isAudienceConfirmationMessage`) |
| Uso de `audience_confirmed` e risco de público | `supabase/functions/conversations-turn/lib/semantic-core/turn-semantics.ts` (`buildAudienceRisk`) |
| Estado retornado ao cliente (incl. `audience_confirmed`) | `supabase/functions/conversations-turn/lib/semantic-core/renderers/shared.ts` (`buildSemanticResult`, `mergeSemanticState`) |
| Executor de contato (telefone/email / “usar o meu”) | `supabase/functions/conversations-turn/lib/semantic-core/executors/booking-contact.ts` |
| Simulador no cliente (estado + histórico enviados ao backend) | `src/components/onboarding/LandingChat.tsx` (`handleSimulatorSend`, `simulatorSemanticStateRef`, `persistOnboardingSimulator`) |
| Persistência local do simulador | `sessionStorage` com chave por `sessionId`; carregamento ao abrir o painel (quando `simulatorMessages.length === 0`) |

---

## 4. Checklist para o próximo agente

- [ ] **Cliente:** Garantir que, ao abrir o simulador, se a intenção for “nova conversa” (ex.: primeira mensagem é saudação ou “tem horário?”), o estado no ref/sessionStorage não seja um estado antigo com slots cheios. Ex.: não carregar estado de sessão anterior quando as mensagens atuais forem “novas” (ex.: só 1–2 trocas).
- [ ] **Cliente:** Garantir que `simulator_state` retornado pelo backend seja sempre o que é passado no próximo request (ref atualizado com `response.simulator_state` e persistido igual no sessionStorage).
- [ ] **Servidor:** Manter a proteção em `booking-context.ts` (não ir para contact sem `audience_confirmed` quando não há completed_bookings/last_booking).
- [ ] **Servidor:** No passo ask_contact, interpretar “o meu mesmo” / “pode ser o meu” como aceite de usar o contato atual (ex.: WhatsApp) e extrair nome (ex.: “Carlos”) na mesma mensagem; atualizar slots e estado para não repetir ask_contact.
- [ ] **Testes:** Reproduzir o diálogo acima (bom dia → tem horário à tarde? → sim → o meu mesmo Carlos) e validar: após “sim”, pedir nome ou serviço; após “o meu mesmo Carlos”, não repetir pergunta de contato e avançar no fluxo.

---

## 5. Deploy

Após alterações em:

- `supabase/functions/conversations-turn/` (qualquer arquivo),

rodar:

```bash
npm run deploy:supabase
```

O simulador do onboarding usa o fluxo **simulation_local** (sem gravar conversa/estado no banco); estado e histórico vêm do cliente (sessionStorage) e são processados por `executeSimulationLocalTurn` em `lib/simulation-local-turn.ts`.

---

## 6. IA como atendente (fluxo não engessado)

A IA deve se comportar como o **atendente do estabelecimento**: conhece o negócio (config do onboarding), preenche o que o cliente disse e pergunta o que ainda falta, **sem ordem fixa** de passos.

- **Quando a IA é usada:** em cada turno de booking, `getBookingNextActionFromAI` (em `lib/ai.ts`) recebe o estado dos slots, a mensagem do cliente e o contexto do negócio; ela devolve a **próxima ação** (ask_attendee_name, ask_service, ask_date, ask_time, ask_contact, ask_audience_confirmation, confirm_booking, etc.). O decision-engine **prioriza essa sugestão** e só usa o fluxo determinístico por `missing_step` quando a IA não retorna ação.
- **Quando a IA não é usada:** se `OPENAI_API_KEY` não estiver definida na edge function (ou a chamada falhar), a sugestão fica nula e o fluxo cai no `decideBooking(snapshot, context)`, que segue a ordem fixa audience → attendee → service → date → time → contact. Por isso, para o comportamento desejado (atendente flexível), a **API key deve estar configurada** no ambiente da Supabase (secrets da função `conversations-turn` / simulador).
- **Contexto passado à IA:** lista de serviços do negócio, `businessContext` (agent_narrative / agent_runtime_context), resumo dos slots atuais e histórico recente, para ela “saber o que preencher e o que perguntar” até concluir o agendamento.
