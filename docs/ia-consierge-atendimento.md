# IA como consierge no atendimento

Este documento define o **princípio** de como a IA e o fluxo determinístico devem se dividir no atendimento (WhatsApp/simulador): a IA como **consierge** que entende e orquestra; o determinístico como **executor** que garante regras e consistência.

---

## Princípio

- **A IA deve ser o consierge:** entende a intenção do cliente **em qualquer redação e em qualquer estado** da conversa. Não dependemos de frases fixas (“quero agendar”, “atendem amanhã”). O cliente pode falar do jeito que quiser; a IA interpreta contexto e histórico e decide o que fazer em seguida.
- **O determinístico tem função clara:** depois que a IA (ou o orquestrador) decidiu *o que* o cliente quer, o código determinístico cuida de:
  - validar dados (serviço na lista, data/hora coerentes);
  - consultar disponibilidade e regras de negócio;
  - persistir agendamento, enviar confirmação;
  - aplicar regras que não podem depender de interpretação livre (ex.: RLS, duração de sequência, horário de funcionamento).

Ou seja: **quem “manda” na interpretação é a IA; quem “manda” na execução segura é o determinístico.**

---

## Problema atual (tensão)

Hoje o fluxo ainda depende de **gatilhos determinísticos** para decidir “é intenção de agendar”:

- Regex e funções como `hasStrongBookingIntent`, `isExplicitBookingIntent` usam padrões fixos de texto. Se o cliente disser a mesma coisa com outras palavras, o sistema pode não reconhecer e cair em esclarecimento ou outro ramo.
- O **orquestrador** (IA que interpreta intenção e sugere ação) só é chamado em alguns momentos: primeira mensagem (e só se não for informativa determinística) e em ramos como `qualification_rejected` / `qualification`. Em vários outros pontos a decisão “entrar em agendamento” é tomada por regex, sem passar pela IA.
- Exemplos em documentação (frases como “quero agendar corte às 14h”) passam a ideia de que o sistema espera aquelas frases. Na prática, o objetivo é **qualquer forma de pedir agendamento**, com a IA interpretando.

Isso torna o atendimento menos versátil e mais “engessado” do que o desejado para WhatsApp.

---

## Direção desejada

### 1. Orquestrador como porta de entrada da intenção

- Em **todo turno** (ou em todo turno em que a conversa está “aberta” — não dentro de um microfluxo fechado como “escolher opção 1/2/3 de confirmação”), a **primeira decisão** deve ser da IA:
  - Entrada: mensagem atual + histórico + estado atual (ex.: passo, slots já preenchidos) + config do negócio.
  - Saída: intenção interpretada e ação sugerida (ex.: `start_booking`, `answer_price`, `list_services`, `ask_clarification`, `no_match_fallback`), com confiança e, quando fizer sentido, dados inferidos (ex.: serviço).
- O código **não** deve usar regex ou frases fixas para decidir “é agendamento” em detrimento do orquestrador. Se a IA disser que a intenção é agendar (em qualquer redação), o fluxo deve seguir para o pipeline de agendamento.

### 2. Determinístico só para execução

- **Entrada no fluxo de agendamento:** decidida pelo orquestrador (ou por uma única camada de IA “consierge”), não por `hasStrongBookingIntent` / `isExplicitBookingIntent` como critério principal.
- **Dentro do agendamento:** o determinístico continua responsável por:
  - validação de serviços (lista, sequência elegível, duração);
  - resolução de data/hora (hoje, amanhã, dia da semana);
  - disponibilidade (calendário, blocos);
  - confirmação e persistência (appointment, mensagem final).
- A **extração de slots** (serviço, data, horário, nome) pode continuar híbrida: IA que entende mensagem + histórico + slots atuais; código que normaliza e valida.

### 3. Versatilidade no WhatsApp

- O cliente pode:
  - falar em qualquer ordem (perguntar horário, depois pedir agendamento; ou já pedir agendamento de forma vaga e ir refinando);
  - usar gírias, abreviações, áudio transcrito, mais de uma intenção na mesma mensagem;
- A IA deve conseguir, com histórico e estado, inferir a intenção e o que falta para um agendamento legítimo. O determinístico garante que, uma vez interpretado, o agendamento seja válido e persistido corretamente.

---

## Passos concretos (evolução do código)

1. **Chamar o orquestrador em mais momentos**  
   Onde hoje a decisão “entrar em booking” é tomada por `hasStrongBookingIntent` (ou equivalente), passar a consultar o orquestrador primeiro. Se o orquestrador retornar `start_booking` com confiança aceitável, entrar no pipeline de agendamento; senão, seguir o fallback atual (esclarecimento, lista de serviços, etc.).

2. **Reforçar o prompt do orquestrador**  
   Deixar explícito que ele deve reconhecer **qualquer** forma de pedir agendamento (marcar, agendar, marcar horário, “preciso ir aí amanhã”, “tem vaga pra X?”, etc.), usando histórico e contexto, sem depender de palavras-chave fixas.

3. **Reduzir dependência de frases fixas**  
   Manter regex/determinístico apenas onde for realmente necessário (ex.: opção numérica “1” = “Quero agendar” quando há botões; detecção de confirmação “sim”, “confirmar”). Não usar regex para “o cliente quer agendar” como critério principal.

4. **Documentação e testes**  
   Nos docs e em testes, evitar exemplos que pareçam “as frases que o sistema entende”. Usar descrições como “qualquer mensagem em que o cliente manifeste intenção de agendar” ou “cliente pergunta sobre disponibilidade em um dia” em vez de uma única frase de exemplo fixa.

---

## Resumo

| Papel | Quem | O quê |
|-------|------|--------|
| **Consierge** | IA (orquestrador + extração de slots / resposta natural) | Interpretar intenção em qualquer redação e estado; decidir qual fluxo seguir; extrair o que o cliente quer (serviço, dia, horário) a partir de mensagem + histórico. |
| **Executor** | Código determinístico | Validar, checar disponibilidade, persistir agendamento, aplicar regras de negócio e segurança. |

Objetivo: atendimento no WhatsApp o **mais versátil possível**, com a IA realmente atuante em todo o estado da conversa, e o determinístico garantindo que o agendamento seja legítimo e correto.

---

## Estilo de interação (escolha do dono no onboarding)

No onboarding, o dono do negócio escolhe **como** prefere o estilo das respostas no chat:

- **Opções numeradas (mais ágil):** o cliente pode (e em muitos momentos deve) responder por número (1, 2, 3). O sistema exibe botões/opções prefixadas com "1 -", "2 -", etc. Fluxo mais guiado e rápido.
- **Conversa natural (mais humana):** o dono quer o **mais natural possível**. O cliente responde em texto livre; a IA deve interpretar intenção em qualquer redação e atuar como consierge. Opções de resposta, quando existirem, não devem ser numeradas (apenas texto); e o sistema **não** deve depender de palavras-chave fixas para reconhecer agendamento — o orquestrador deve decidir pela intenção.
- **Misto (recomendado):** híbrido: conversa natural quando fizer sentido, com opções disponíveis em alguns momentos.

**Regra:** todo o código e todos os prompts da IA devem **levar em consideração** esse estilo:

- **Prompts (orquestrador, resposta contextual, extração de slots):** receber e usar `interaction_style`. Em estilo "conversa natural", instruir a IA a priorizar interpretação em texto livre e a reconhecer intenção de agendar em qualquer redação; em "opções numeradas", manter fluxo ágil com escolhas numeradas.
- **Fluxo (conversations-turn):** quando `interaction_style === "conversational"` (ou `"hybrid"`), **priorizar a decisão do orquestrador** para entrar em agendamento — ou seja, não exiger que a mensagem bata em regex (`hasStrongBookingIntent`); se o orquestrador retornar `start_booking` com confiança aceitável, seguir para o pipeline de agendamento. Quando `numbered_options`, manter o comportamento atual (opções numeradas e, se desejado, gatilhos determinísticos para agilidade).
- **Resposta ao cliente:** em "conversa natural", as opções enviadas ao canal (ex.: WhatsApp) não devem ser prefixadas com "1 -", "2 -" (já implementado); e a IA não deve assumir que o cliente vai responder por número.

---

## Status de implementação (passos concretos deste doc)

| Passo | Status | Onde está / observação |
|-------|--------|-------------------------|
| **1. Chamar o orquestrador em mais momentos** | **Implementado** | Nos ramos de qualification e qualification_rejected: quando estilo é conversacional ou híbrido, o orquestrador é consultado; se retornar `start_booking` com confiança ≥ limite, entra em booking mesmo sem regex. Em estilo "opções numeradas" continua usando `hasStrongBookingIntent` como antes. |
| **2. Reforçar o prompt do orquestrador** | **Implementado** | Em `interpretFlowWithAI`: instrução por estilo (conversa natural = reconhecer qualquer forma de pedir agendamento; misto = aceitar formas naturais). |
| **3. Reduzir dependência de frases fixas** | **Implementado** | Em todos os estilos a entrada em booking pode vir do orquestrador (qualquer redação) ou do regex. O orquestrador é sempre consultado nesses ramos; se retornar `start_booking` com confiança, entra em booking. Opção numérica "1" = "Quero agendar" mantida para agilidade. |
| **4. Documentação (evitar frases fixas)** | **Implementado** | [Fluxo de agendamento](./fluxo-agendamento-primeira-mensagem.md) com exemplos ilustrativos e "qualquer redação"; diagrama sem exemplos de frase fixa. |
| **Estilo de interação (onboarding)** | **Implementado** | Prompts (`answerWithContextualAI`, orquestrador, `interpretSlotsFromMessageWithAI`) e fluxo em `conversations-turn` consideram `interaction_style`; ver seção acima. |
