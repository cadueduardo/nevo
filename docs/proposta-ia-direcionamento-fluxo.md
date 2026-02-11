# Proposta: IA como cérebro do direcionamento de fluxo

> **Status:** Fase 1 implementada (orquestrador em qualification/qualification_rejected).

## Objetivo

Fazer a IA interpretar **sempre** o contexto da conversa e decidir o próximo passo, em vez de depender de regras fixas (regex, ramos condicionais). O agente deve ser o mais humanizado possível e usar o contexto para direcionar o fluxo.

## Princípios

- **Orquestrador genérico:** Não engessado a nenhum ramo (barbearia, advocacia, manicure etc.). Funciona para qualquer negócio via config.
- **Fallback:** Se não encontrar encaixe nos fluxos: "Não entendi exatamente o que deseja. Nós trabalhamos com X, Y, Z. Podemos te ajudar com algum dos nossos serviços?" (X, Y, Z vêm da config).
- **IA sempre busca encaixar** em fluxos e serviços existentes; não inventa respostas.

---

## Situação atual (regras fixas)

```
Mensagem do usuário
        │
        ▼
   ┌─────────────────────────────────────────┐
   │  isPriceQuestion?  →  Responde preço    │
   │  isListServicesQuestion? → Lista svcs   │
   │  isExplicitBookingIntent? → Entra book  │
   │  classifyServiceMatch → Rejeita/Match   │
   │  step === "qualification_rejected"?     │
   │  ... (dezenas de if/else encadeados)    │
   └─────────────────────────────────────────┘
        │
        ▼
   Resposta determinística
```

**Problema:** A ordem e a combinação das condições são fixas. Não há interpretação do contexto global nem “pensamento” sobre a melhor resposta.

---

## Visão proposta: IA como orquestrador

```
Mensagem do usuário + Histórico + Estado + Config
        │
        ▼
   ┌─────────────────────────────────────────────────────────┐
   │                 IA DE DIRECIONAMENTO                     │
   │                                                          │
   │  Input:                                                  │
   │  - Mensagem atual                                        │
   │  - Últimas N mensagens (histórico)                       │
   │  - Estado atual (slots, step, mode, pendências)          │
   │  - Config do negócio (serviços, agenda, políticas)       │
   │                                                          │
   │  Output (estruturado):                                   │
   │  - intent: "price_inquiry" | "booking_intent" | "clarify" | "reject" | ... │
   │  - inferred_service?: string                             │
   │  - inferred_attendees?: "single" | "multiple" | "other_person" │
   │  - suggested_action: "answer_price" | "start_booking" | "ask_clarification" | ... │
   │  - clarification_question?: string                       │
   │  - tone_hint?: string                                    │
   └─────────────────────────────────────────────────────────┘
        │
        ▼
   Executor (lógica determinística usa o output da IA)
   - Se suggested_action === "answer_price" → Monta resposta com preços
   - Se suggested_action === "start_booking" → Entra no fluxo de agendamento
   - Se suggested_action === "ask_clarification" → Usa clarification_question
   - ...
        │
        ▼
   Resposta humanizada (IA pode reescrever o texto final com o tom do negócio)
```

---

## Fluxo detalhado

### 1. Chamada de interpretação (toda mensagem)

Antes de qualquer lógica de negócio, a IA recebe:

```json
{
  "user_message": "certo, quanto tá o corte masculino?",
  "conversation_history": [
    { "role": "user", "content": "quanto tá o corte feminino?" },
    { "role": "assistant", "content": "Atualmente oferecemos apenas cortes masculinos e corte com barba..." }
  ],
  "current_state": {
    "step": "qualification_rejected",
    "mode": null,
    "slots": {}
  },
  "business_config": {
    "services": [...],
    "business_type": "barbearia"
  }
}
```

### 2. Output estruturado da IA

```json
{
  "intent": "price_inquiry",
  "intent_confidence": 0.95,
  "inferred_service": "Corte masculino",
  "inferred_attendees": "possibly_other_person",
  "reasoning": "Usuário perguntou sobre corte feminino primeiro, depois masculino. Pode estar perguntando para marido/filho.",
  "suggested_action": "answer_price_then_offer_booking",
  "clarification_suggestion": "Para quem será o atendimento? É para você ou para outra pessoa?",
  "should_ask_clarification_first": false
}
```

### 3. Executor usa o output

- `suggested_action === "answer_price_then_offer_booking"`  
  → Responde preço (R$ 40) e pergunta: "Quer agendar? É para você ou para outra pessoa?"
- `inferred_attendees === "possibly_other_person"`  
  → Inclui botão ou pergunta sobre múltiplos agendamentos

---

## Exemplos de decisões contextuais

| Cenário | Regra atual | Com IA |
|--------|-------------|--------|
| "quanto tá o corte masculino?" | Pode entrar direto em booking ou responder preço conforme ordem dos ifs | IA identifica `price_inquiry` → responde preço primeiro |
| Usuário perguntou corte feminino, depois masculino | Não usa esse contexto | IA infere "possivelmente para outra pessoa" → pergunta ou oferece fluxo múltiplo |
| "quero agendar" logo após ver preços | Entra em booking | IA confirma intenção e direciona corretamente |
| "entendi, quero para meu filho e marido" | Depende de regex em mensagem única | IA entende múltiplos a partir do histórico e do contexto |
| Mensagem ambígua | Escolhe um ramo fixo | IA pode pedir clarificação em vez de assumir |

---

## Componentes técnicos propostos

### A. `interpretFlowWithAI(message, history, state, config)`

- **Responsabilidade:** Interpretar mensagem e contexto e retornar decisão estruturada.
- **Modelo:** gpt-4o-mini (ou similar) com output em JSON.
- **Prompt:** Instruções para:
  - Classificar intenção (price_inquiry, booking_intent, clarification, reject, etc.)
  - Inferir serviço, quando aplicável
  - Inferir se é para o usuário, outra pessoa ou múltiplas pessoas
  - Sugerir ação e, se fizer sentido, pergunta de clarificação
  - Manter tom humanizado e coerente com o histórico

### B. Executor (lógica determinística)

- Recebe o output da IA.
- Executa a ação sugerida (resposta de preço, início de booking, clarificação, etc.).
- Mantém estado (slots, step, mode).
- Não decide sozinho o “próximo passo” — apenas executa o que a IA indicou.

### C. `rewriteWithTone` (já existe)

- Pode ser usado para ajustar o texto final ao tom do negócio, mantendo a humanização.

---

## Fases de implementação sugeridas

1. **Fase 1 – Proof of concept**
   - Criar `interpretFlowWithAI` e integrar em um ramo específico (ex.: `qualification` + `qualification_rejected`).
   - Manter fallback para regras atuais se a IA falhar ou retornar inválido.

2. **Fase 2 – Expansão**
   - Usar a IA em mais pontos do fluxo (booking, quote, rejeição).
   - Passar histórico recente (últimas 4–6 mensagens) em cada chamada.

3. **Fase 3 – Consolidação**
   - IA como ponto central de decisão em todas as mensagens.
   - Regras fixas apenas para ações muito específicas (parse de data, horário, etc.).

---

## Considerações

- **Custo:** Mais chamadas de IA por turno (1 para interpretação, opcionalmente 1 para reescrita).
- **Latência:** +200–500 ms por turno, dependendo do modelo.
- **Determinismo:** O output estruturado (JSON) mantém controle sobre o fluxo; a IA sugere, o executor aplica.
- **Fallback:** Se a IA falhar, usar o fluxo atual baseado em regras.
