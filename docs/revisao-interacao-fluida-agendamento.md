# Revisão: interação fluida no agendamento

Este documento descreve **o que já existe** no código em relação ao “olhar de interação fluida” (agendamento em qualquer turno, com contexto acumulado) e **o que pode ser alterado**, com cuidado para **evitar duplicidade** e **não comprometer outros fluxos**.

---

## 1. O que já existe

### 1.1 Pipeline “a cada turno” (quando já estamos em booking)

- **Onde:** `supabase/functions/conversations-turn/index.ts` → `resolveBooking()`.
- **Comportamento:** Sempre que o fluxo está em modo `booking` (ou entra nele), o **mesmo** pipeline roda:
  - **Compreensão:** `interpretSlotsFromMessageWithAI(message, { current_slots, history, last_assistant_message, ... }, config)` em `lib/ai.ts`.
  - **Entrada:** mensagem atual + histórico (últimas mensagens) + slots já preenchidos (`current_slots`).
  - A IA já recebe histórico e slots atuais; pode completar slots de turnos anteriores (ex.: “amanhã” no turno 1 + “corte às 14h” no turno 2).
- **Conclusão:** Não há dois pipelines distintos (“primeira mensagem” vs “turnos seguintes”). Um único `resolveBooking` trata todos os turnos de agendamento, com contexto acumulado.

### 1.2 Histórico e estado

- **Histórico:** Em cada request, a Edge Function monta `history` a partir de `conversation_messages` (últimas ~12 mensagens) e passa para `processSimulatorMessage` e, em seguida, para `resolveBooking` e `interpretSlotsFromMessageWithAI`.
- **Estado:** `state.slots` (serviço, data, horário, nome, etc.) é persistido em `conversation.state_json` e rehidratado no próximo turno. Ou seja, o que já foi extraído em turnos anteriores já está em `current_slots` quando a IA roda.
- **Primeira mensagem:** Definida por `_isFirstMessage` (contagem de mensagens do usuário no DB = 0). Usada para saudação, regras de “primeira interação” e orquestrador; **não** para decidir se o pipeline de slots roda ou não (esse roda sempre que estamos em booking).

### 1.3 Entrada no modo booking

- **Gatilhos atuais:**  
  - Opção numérica “Quero agendar” (bypass determinístico).  
  - `hasStrongBookingIntent`: `isExplicitBookingIntent(text)` ou regex `(quero|gostaria|preciso|pode|sim).*(agendar|marcar)`.  
  - Em vários ramos: `qualification`, `qualification_rejected`, `ask_mode`, etc., quando a intenção de agendar é detectada.
- **Exemplo do doc:** Turno 1: “atendem amanhã?” → resposta informativa. Turno 2: “Eu quero agendar um corte às 14h, tem disponibilidade?” → contém “quero agendar” → `hasStrongBookingIntent` → entra em booking → `resolveBooking` com `history` (inclui turno 1). A IA pode extrair “amanhã” do histórico e preencher o slot de data.

### 1.4 Separação de fluxos

- **onboarding-chat:** Edge Function separada; trata cadastro do negócio, extração de modelo de negócio, primeiras mensagens do **dono do negócio**. Não compartilha lógica de slots de agendamento com `conversations-turn`.
- **conversations-turn:** Único lugar onde o pipeline de agendamento (Compreensão → Validação → Resposta) roda. Toda a extração de slots de agendamento (serviço, data, horário, nome) para o **cliente** está aqui (e em `lib/ai.ts`, `lib/services.ts`, etc.).

---

## 2. O que pode ser alterado (sem duplicar pipeline)

### 2.1 Melhorias opcionais (não obrigatórias para “fluidez”)

- **Persistir data em perguntas informativas:** Se o cliente pergunta “atendem amanhã?” e respondemos “Sim! O que precisa?”, hoje **não** gravamos “amanhã” em `state.slots.date`. A IA em turnos seguintes pode inferir do histórico. Opcionalmente, poderíamos preencher `state.slots.date` quando a pergunta informativa menciona um dia específico — com cuidado para não sobrescrever contexto em conversas que mudam de dia.
- **Intenção de agendar sem a palavra “agendar”:** Frases como “corte às 14h” ou “amanhã às 14h” (sem “quero agendar”) hoje não disparam `hasStrongBookingIntent`. Se quisermos aceitar isso como entrada em booking, seria uma **extensão da detecção** (ex.: novo helper “message + history sugerem slots suficientes para agendar”) em um único lugar, **sem** criar um segundo pipeline — continuaria entrando no mesmo `resolveBooking`.

### 2.2 O que **não** deve ser feito (evitar duplicidade e quebra)

- **Não** criar um segundo “pipeline de compreensão” só para “primeira mensagem” ou “mensagem fluida”. O pipeline único já é “a cada turno” quando em booking.
- **Não** duplicar a lógica de extração de slots (ex.: em onboarding-chat para agendamento do cliente). Onboarding continua apenas para configuração do negócio.
- **Não** chamar `resolveBooking` em momentos que hoje são tratados por orquestrador/qualificação (ex.: primeira mensagem ambígua) sem critério claro, para não “roubar” mensagens que devem ser respondidas com esclarecimento ou lista de serviços.

---

## 3. Riscos e mitigação

| Risco | Mitigação |
|-------|------------|
| Duplicar o pipeline de slots | Manter um único ponto: `resolveBooking` + `interpretSlotsFromMessageWithAI`. Qualquer melhoria de “fluidez” deve ser entrada de dados (histórico/estado) ou detecção de intenção, não um segundo fluxo de compreensão. |
| Quebrar onboarding | Não reutilizar onboarding-chat para agendamento do cliente; não mover lógica de slots para fora de `conversations-turn`. |
| Interceptar mensagens de qualificação | Qualquer nova condição para “entrar em booking” (ex.: “slots completos no texto + histórico”) deve ser aplicada **depois** das regras de primeira mensagem e orquestrador, ou integrada ao orquestrador, para não tratar como booking mensagens que são “qualificação” ou “esclarecimento”. |
| Estado inconsistente entre turnos | O estado já é persistido em `conversation.state_json` e o histórico em `conversation_messages`. Qualquer novo campo (ex.: data inferida de pergunta informativa) deve seguir o mesmo padrão e ser documentado no tipo `SimulatorState`. |

---

## 4. Resumo

- **Já existe:** Pipeline único (Compreensão → Validação → Resposta) a cada turno em booking; histórico e `current_slots` passados para a IA; entrada em booking por “Quero agendar” e frases equivalentes; separação clara entre onboarding-chat e conversations-turn.
- **Pode ser alterado:** (1) Opcionalmente persistir data quando a pergunta informativa menciona dia; (2) Opcionalmente considerar “slots suficientes na mensagem + histórico” como intenção de agendar, sem duplicar pipeline.
- **Não fazer:** Segundo pipeline de slots; usar onboarding para agendamento do cliente; chamar o pipeline de booking em momentos que hoje são de qualificação/orquestrador sem critério definido.

Assim, o “olhar de interação fluida” já está em grande parte atendido pelo desenho atual; alterações devem ser **incrementais** (dados de entrada ou detecção de intenção) e **centralizadas** em `conversations-turn`, sem duplicidade nem impacto em outros fluxos.
