# Fluxo de agendamento: conversa fluida e sequência de serviços

Este documento descreve o desenho do fluxo para o assistente de agendamento quando o cliente já conhece o negócio. O cliente pode **em qualquer momento** da conversa — primeira mensagem ou no meio do processo — enviar serviço(s), dia e horário **em qualquer redação**. Não é uma receita de bolo: a conversa pode começar com uma pergunta genérica e só depois o cliente completa o pedido. A **IA deve atuar como consierge** (interpretar intenção e contexto em qualquer forma de falar); o código determinístico garante validação e persistência. Ver também: [IA como consierge no atendimento](./ia-consierge-atendimento.md). Inclui as regras de **agendamento em sequência** (soma das durações).

---

## Fluidez da conversa (não só primeira mensagem)

O pipeline abaixo roda **a cada turno** em que a mensagem do cliente (somada ao histórico) permitir extrair ou completar slots. O contexto da conversa é mantido: o que já foi dito antes entra na Compreensão (mesclar com slots já extraídos). **Os exemplos abaixo são apenas ilustrativos** — o sistema deve entender qualquer forma de pedir agendamento ou de perguntar sobre dia/horário/serviço.

**Exemplo ilustrativo de fluxo no meio do processo:**

| Turno | Cliente (exemplo) | Assistente |
|-------|-------------------|------------|
| 1 | Pergunta sobre disponibilidade em um dia (qualquer redação) | Resposta natural + convite a dizer o que precisa |
| 2 | Manifesta intenção de agendar com serviço e horário (qualquer redação) | [Pipeline: Compreensão (mensagem + histórico) → Validação → Resposta] Ex.: confirma entendimento, verifica disponibilidade, oferece confirmação |

Ou seja: o cliente não precisa mandar tudo na primeira frase nem usar palavras específicas. Pode perguntar sobre horário de funcionamento ou disponibilidade, depois em outra mensagem fechar o agendamento. O sistema deve **acumular** o que entendeu (ex.: dia mencionado antes; depois serviço e horário) e, quando tiver o mínimo para validar disponibilidade, rodar Validação e Resposta.

---

## Visão geral do pipeline (3 etapas)

O pipeline é acionado **sempre que a mensagem atual** (somada ao histórico) permitir extrair ou atualizar slots e, quando fizer sentido, checar disponibilidade e responder.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  MENSAGEM ATUAL DO CLIENTE + HISTÓRICO DA CONVERSA                               │
│  Entrada: texto livre, qualquer redação (a IA interpreta intenção e slots        │
│  usando histórico e slots já preenchidos no estado).                              │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ETAPA 1 — COMPREENSÃO (extração de slots)                                        │
│  • Entrada: mensagem atual + histórico (e slots já preenchidos no contexto)      │
│  • Saída: slots extraídos/atualizados (serviço(s), data/dia, horário) + o que falta│
│  • Responsável: IA (ou híbrido regex + IA). Pode completar slots de turnos antes. │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ETAPA 2 — VALIDAÇÃO (regras + disponibilidade)                                   │
│  • Validar serviços e sequência (sequence_eligible_services)                       │
│  • Resolver data (ex: "amanhã" → 24/02, "segunda" → próxima segunda)             │
│  • Para SEQUÊNCIA: somar durações dos serviços → bloco [início, início+total]     │
│  • Consultar calendário: há vaga no bloco? Ou alternativas?                      │
│  • Saída: slots normalizados + resultado (livre / ocupado / alternativas)        │
│  • Responsável: lógica determinística (código + calendário)                       │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ETAPA 3 — RESPOSTA (uma mensagem humana)                                         │
│  • Entrada: o que foi compreendido + resultado da validação                        │
│  • Saída: uma mensagem natural (confirmar entendimento + disponibilidade/lista)   │
│  • Responsável: IA                                                                │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  RESPOSTA AO CLIENTE                                                              │
│  Ex: "Olá! Maravilha, vamos agendar seu corte e barba para segunda (23/02).      │
│       O horário das 15h está preenchido; ainda tenho: [LISTA]."                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Regra central: agendamento em sequência e duração total

Quando o cliente pede **mais de um serviço na mesma visita** (ex.: "corte e barba"):

1. **Serviços elegíveis para sequência**  
   Só entram na sequência os que estão em `sequence_eligible_services`.  
   Se o cliente pedir um serviço que não está nessa lista, a validação deve sinalizar e a resposta deve explicar (ex.: "Corte infantil não pode ser combinado na mesma sequência; você pode agendar corte e barba juntos ou corte infantil em outro horário").

2. **Duração total do bloco**  
   O tempo do agendamento **não** é o de um único serviço; é a **soma das durações** de cada serviço da sequência:
   - Ex.: Corte = 30 min, Barba = 20 min → **bloco = 50 min**.
   - O sistema deve usar a **duração total** para:
     - verificar disponibilidade (o bloco inteiro precisa estar livre);
     - preencher o agendamento (um único agendamento com início em T e fim em T + 50 min, ou equivalente em slots de agenda).

3. **Consulta à disponibilidade**  
   Dado:
   - data/dia resolvido (ex.: segunda 23/02);
   - horário pedido (ex.: 15h);
   - duração total (ex.: 50 min);  
   a validação consulta o calendário para o **intervalo [15:00, 15:50]**.  
   - Se estiver livre → resultado "disponível".  
   - Se estiver ocupado → buscar próximos blocos livres do mesmo tamanho (50 min) e devolver como alternativas.

4. **Persistência do agendamento**  
   Ao confirmar, o sistema cria **um** agendamento (ou equivalente no modelo de dados) com:
   - serviços: [Corte, Barba];
   - início: 15:00;
   - duração total: 50 min (ou fim 15:50);
   - demais campos (atendente, estabelecimento, etc.) conforme regras existentes.

O diagrama abaixo detalha a etapa de validação com esse fluxo de sequência e duração.

---

## Detalhe da etapa de validação (sequência + duração)

```
                    Slots extraídos pela Compreensão
                    (ex: serviços=[Corte, Barba], dia=segunda, hora=15h)
                                        │
                                        ▼
                    ┌───────────────────────────────────┐
                    │ Serviços na sequence_eligible?    │
                    │ (todos os pedidos podem ser       │
                    │  combinados em sequência?)         │
                    └───────────────────────────────────┘
                        │ sim                    │ não
                        ▼                        ▼
            ┌───────────────────────┐   ┌───────────────────────────────────┐
            │ Calcular duração      │   │ Montar aviso para a Resposta:     │
            │ total da sequência:  │   │ "Serviço X não pode ser combinado  │
            │ duration_total =     │   │  na mesma sequência; oferecer      │
            │   sum(duração de     │   │  alternativas (só elegíveis ou      │
            │   cada serviço)      │   │  X em outro horário)."             │
            └───────────────────────┘   └───────────────────────────────────┘
                        │
                        ▼
            ┌───────────────────────┐
            │ Resolver data e      │
            │ horário (ex: segunda │
            │ 23/02, 15:00)        │
            └───────────────────────┘
                        │
                        ▼
            ┌───────────────────────┐
            │ Bloco de tempo:       │
            │ início = 15:00       │
            │ fim = 15:00 +        │
            │   duration_total     │
            │ (ex: 15:50 se 50min) │
            └───────────────────────┘
                        │
                        ▼
            ┌───────────────────────┐
            │ Consultar calendário:│
            │ [início, fim] está  │
            │ livre?               │
            └───────────────────────┘
                    │ sim        │ não
                    ▼            ▼
            ┌─────────────┐  ┌─────────────────────────────────┐
            │ Resultado:  │  │ Buscar próximos blocos livres   │
            │ disponível  │  │ do mesmo duration_total;        │
            │             │  │ Resultado: alternativas [lista] │
            └─────────────┘  └─────────────────────────────────┘
                    │                    │
                    └──────────┬─────────┘
                               ▼
                    Entrada para a Etapa 3 (Resposta)
                    (slots + disponível ou alternativas + avisos)
```

---

## Resumo das regras para implementação

| Tópico | Regra |
|--------|--------|
| **A cada turno** | O pipeline (Compreensão → Validação → Resposta) pode rodar em **qualquer** mensagem, não só na primeira. O cliente pode começar com "atendem amanhã?" e só depois "quero agendar corte às 14h"; o sistema acumula contexto e responde com fluidez. |
| **Sequência elegível** | Apenas serviços em `sequence_eligible_services` podem ser agendados juntos na mesma visita. Se o cliente pedir outro, a resposta deve deixar claro e oferecer alternativas. |
| **Duração em sequência** | Para "corte e barba" (ou N serviços em sequência): **duração_total = soma(duração de cada serviço)**. O agendamento usa esse bloco (início até início + duração_total). |
| **Disponibilidade** | A consulta ao calendário considera o **bloco inteiro** (início + duração_total). Se ocupado, buscar outros blocos do mesmo tamanho para alternativas. |
| **Resposta** | Uma única mensagem natural: confirma o que foi entendido + informa se está disponível ou lista alternativas (+ avisos de sequência, se houver). |

---

## Próximos passos (implementação)

1. **Compreensão:** Garantir extração de serviços (incl. múltiplos), data/dia e horário na primeira mensagem (e nas seguintes).  
2. **Validação:** Na lógica de agendamento em sequência, usar sempre a soma das durações e consultar disponibilidade para o bloco correspondente.  
3. **Persistência:** Ao criar o agendamento em sequência, gravar início + duração total (ou fim) e a lista de serviços.  
4. **Resposta:** Gerar mensagem humana a partir do resultado da validação (disponível / ocupado + alternativas / avisos de sequência).

---

## Status de implementação (em relação a este doc e ao ia-consierge)

| Item | Status | Onde está / observação |
|------|--------|-------------------------|
| **Compreensão** (extração em qualquer turno, múltiplos serviços) | **Já implementado** | `interpretSlotsFromMessageWithAI` recebe histórico + `current_slots`; `getSequenceServicesFromText` / `findServicesFromText` para sequência; pipeline único em `resolveBooking`. |
| **Validação** (soma durações, bloco, disponibilidade) | **Já implementado** | `getServicesTotalDuration` usado em disponibilidade e confirmação; `sequence_eligible_services` validado; bloco [início, início+total] considerado. |
| **Persistência** (início + fim + lista de serviços) | **Já implementado** | `appointment` insert com `start_at`, `end_at` (calculado com duração total), `service_names` (array). |
| **Resposta** (mensagem a partir do resultado) | **Já implementado** | `buildFinalBookingMessage`, `buildAvailabilityForDateMessage`, builders de confirmação/alternativas. |
| **Doc sem frases fixas** (exemplos ilustrativos) | **Já alterado** | Introdução e diagrama usam "qualquer redação"; link para ia-consierge. |
| **Estilo de interação** (onboarding) | **Já implementado** | Ver doc [IA como consierge](./ia-consierge-atendimento.md): prompts e fluxo consideram `interaction_style`; conversacional/híbrido priorizam orquestrador para entrar em booking. |
