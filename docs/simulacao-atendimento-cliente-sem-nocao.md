# Simulação: atendimento completo com cliente “sem noção”

Cenário: **Barbos** (barbearia). Serviços: Corte (R$ 40, 30 min), Barba (R$ 25, 20 min). Horário: segunda a sexta, 08:00–18:00. Estilo: opções numeradas.

O **cliente** é o mais “sem noção” possível: respostas vagas, muda de assunto, não diz o serviço direito, mistura “pra mim” e “pro meu irmão”, hesita em dia/horário, etc.

Em cada resposta do **assistente** está indicado **[FLUXO]** — qual ramo do código foi usado e por quê, para você seguir a lógica até a confirmação final.

---

## Turno 1

**Cliente:** oi

**[FLUXO]** `isFirst && isGreeting(text)` → `answerWithContextualAI` (saudação) ou `getGreetingMessage`. Estado: `step: "qualification"`.

**Assistente:** Oi! Sou a assistente virtual da Barbos. Como posso ajudar você hoje?  
**Opções:** 1 - Quero agendar

---

## Turno 2

**Cliente:** ah então eu queria uma coisa assim tipo marcar um horário né mas não sei se é pra mim ou pro meu irmão ainda

**[FLUXO]** Não é greeting. `isFirst && !mode && !step` → primeiro tenta `answerWithContextualAI` (pode responder algo genérico e convidar a agendar). Se a IA responder, retorna com step qualification. Se não, chama orquestrador. Mensagem sugere “marcar” mas sem serviço específico → orquestrador pode devolver `list_services` ou `ask_clarification`. Se `list_services` → lista serviços + “Quem vai ser o agendamento, você ou seu irmão?”. Aqui assumimos que a IA contextual responde de forma natural.

**Assistente:** Sem problema! Você pode agendar para você ou para seu irmão. Aqui temos Corte e Barba. O que você gostaria de agendar? E será para você ou para outra pessoa?  
**Opções:** 1 - Quero agendar (ou lista de serviços, conforme config)

---

## Turno 3

**Cliente:** é pra mim mas tipo quero algo rápido

**[FLUXO]** step ainda qualification. `answerWithContextualAI` pode responder; ou orquestrador. “Algo rápido” não é serviço da lista → orquestrador pode dar `list_services` (mostrar Corte, Barba) ou a IA contextual explicar que temos Corte (30 min) e Barba (20 min) e perguntar qual quer. Não entra em booking ainda porque não há serviço escolhido.

**Assistente:** Beleza, é para você então. Para ser rápido temos Corte (cerca de 30 min) e Barba (cerca de 20 min), ou os dois em sequência. Qual você prefere?  
**Opções:** 1 - Corte, 2 - Barba, 3 - Corte e Barba (ou equivalente)

---

## Turno 4

**Cliente:** 1

**[FLUXO]** `tryResolveNumericServiceSelection`: “1” com `last_service_options` → vira “Corte”. Depois, em qualification, pode ter `match.service` (classifyServiceMatch) ou fluxo que preenche `slots.service` e entra em booking. Se “1” for interpretado como opção de serviço → `nextState.slots.service = "Corte"`, `mode = "booking"`, chama `resolveBooking`. Dentro de `resolveBooking`: falta attendee (nome), data, hora. Pergunta o dia.

**Assistente:** Entendi, Corte para você. Em qual dia você gostaria de agendar? (ex.: Hoje, Amanhã ou dia da semana)  
**Opções:** 1 - Hoje, 2 - Amanhã, 3 - Segunda, …

---

## Turno 5

**Cliente:** amanhã... ou não, acho que quinta dá melhor

**[FLUXO]** Já em booking. `resolveBooking` recebe texto + histórico. `interpretSlotsFromMessageWithAI` com `waiting_for: "date"`, `current_slots: { service: "Corte" }`, history. IA extrai: “amanhã” e “quinta” → pode devolver a data que o cliente “confirmou” (quinta). Ou o código usa `parseDateOrWeekday` para “quinta” → próxima quinta. Estado: `slots.date` = próxima quinta. Pergunta horário.

**Assistente:** Beleza, quinta então. Qual horário você prefere?  
**Opções:** lista de horários (ex.: 08:00, 09:00, …)

---

## Turno 6

**Cliente:** tipo umas 14h mas se não tiver pode ser depois

**[FLUXO]** `interpretSlotsFromMessageWithAI` com `waiting_for: "time"`. Extrai “14:00”. Validação: verifica se 14:00 está livre naquela data; se não, busca alternativas. Resposta: “Tenho 14:00 livre, confirmo?” ou “14:00 ocupado, tenho 15:00 e 16:00. Qual prefere?”. Aqui assumimos 14:00 livre. Falta só nome para confirmar (e depois contato se config exige).

**Assistente:** Tenho 14:00 livre na quinta. Posso anotar Corte para você às 14h. Qual seu nome para fechar?

---

## Turno 7

**Cliente:** João. Mas espera, era pra ser pro meu irmão mesmo

**[FLUXO]** `interpretSlotsFromMessageWithAI`: attendee_name “João” já preenchido; mensagem diz “era pro meu irmão” → pode manter “João” como nome do irmão (quem recebe o serviço) ou ajustar. Slots: service, date, time, attendee_name. Se já tiver nome + contato (ou config não exige), monta confirmação. Se faltar contato, pergunta telefone/email. Aqui assumimos que o sistema aceita “João” (irmão) e pede confirmação ou contato.

**Assistente:** Sem problema! Então fica Corte para o João (seu irmão) na quinta às 14h. Para finalizar, me passa um telefone ou e-mail para contato?

---

## Turno 8

**Cliente:** 11 99999 9999

**[FLUXO]** `resolveBooking`: `parsePhone` pega o número, preenche `slots.customer_phone`. Com serviço, data, hora, nome e contato preenchidos → `bookingComplete`. Próxima mensagem pode ser confirmação explícita (ex. “confirmar”) ou o sistema já mostrar opção “Confirmar agendamento”.

**Assistente:** Perfeito. Ficou: Corte para João, quinta [data], 14h. Telefone 11 99999-9999. Confirmo o agendamento?  
**Opções:** 1 - Sim, confirmar / 2 - Outro horário / 3 - Outro dia / …

---

## Turno 9

**Cliente:** isso pode ser

**[FLUXO]** `isConfirm` (ex.: “isso”, “confirmar”, “pode ser”) + `bookingComplete` → não é “1” de opção numérica, mas texto de confirmação. `isDonePhrase(text)` ou equivalente pode capturar “isso pode ser”. Se sim: `addBookedSlot`, `completed_bookings.push(...)`, `buildFinalBookingMessage`, `final_thanks_sent = true`, `resetSlotsForNextBooking`. Resposta de encerramento.

**Assistente:** Pronto! Agendamento confirmado: Corte para João na quinta [data] às 14h. Qualquer coisa estamos à disposição. Bom dia!

---

## Turno 10 (opcional — cliente “sem noção” de novo)

**Cliente:** valeu. ah e onde fica vocês mesmo?

**[FLUXO]** `isFinalizedState` (agendamento já confirmado). “valeu” → pode cair em thanks e enviar mensagem de despedida antes, ou a mensagem atual já é “valeu. ah e onde fica”. Normalizado: duas intenções. O fluxo pode tratar a última frase: “onde fica vocês” → `isAddressQuestion` (finalized) ou, no bloco finalized, primeiro `answerWithContextualAI` com histórico (config tem endereço). IA responde com o endereço sem pedir confirmação de novo.

**Assistente:** Disponha! Ficamos na [endereço da Barbos]. Qualquer coisa é só chamar.

---

## Resumo da lógica (por tipo de mensagem)

| Cliente “sem noção”        | O que o fluxo faz |
|----------------------------|-------------------|
| “oi”                       | Greeting → IA ou mensagem fixa + step qualification. |
| “queria marcar, não sei se pra mim ou irmão” | IA contextual ou orquestrador; list_services/clarificação; mantém qualification. |
| “é pra mim, algo rápido”   | IA/orquestrador; não assume serviço → lista ou pergunta. |
| “1” (opção)                | Resolve numérico → preenche serviço, entra em booking, resolveBooking. |
| “amanhã... quinta dá”      | interpretSlotsFromMessageWithAI + parseDateOrWeekday → preenche data. |
| “umas 14h se não tiver depois” | IA extrai 14:00; validação de disponibilidade; pergunta nome ou confirma. |
| “João. era pro meu irmão”  | Slots attendee; mantém ou ajusta para “João” (irmão). |
| Telefone                   | parsePhone → bookingComplete; pede ou mostra confirmação. |
| “isso pode ser”            | isConfirm + bookingComplete → grava agendamento, mensagem final. |
| “valeu, onde fica?”        | finalized + IA contextual com endereço no config. |

---

## Onde a IA atua (consierge)

- **Saudação e dúvidas vagas** (turnos 1–3): `answerWithContextualAI` ou orquestrador com histórico e config.
- **“Amanhã ou quinta”** (turno 5): `interpretSlotsFromMessageWithAI` usa mensagem + histórico para preencher data.
- **“14h se não tiver depois”** (turno 6): mesma extração de slots + validação determinística de disponibilidade.
- **“Era pro meu irmão”** (turno 7): IA de slots mantém “João” como titular do agendamento.
- **Depois de confirmar** (turno 10): `answerWithContextualAI` em estado finalized, com endereço no config.

O determinístico entra em: opção numérica (1, 2, 3), parse de data/hora, disponibilidade, confirmação e persistência. Quem interpreta “cliente sem noção” é a IA; quem garante regra e consistência é o código.
