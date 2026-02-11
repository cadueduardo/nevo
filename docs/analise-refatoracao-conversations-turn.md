# Análise de blocos repetidos e inúteis — conversations-turn/index.ts

## Resumo executivo

O arquivo tem ~3000 linhas com **vários blocos duplicados** e **2 funções não utilizadas**. Há oportunidades claras de extrair helpers e reduzir duplicação.

---

## 1. Funções não utilizadas (dead code)

| Função | Linhas | Observação |
|--------|--------|------------|
| `isAdditionalBookingRequest` | 589-593 | Nunca chamada. A lógica de múltiplos agendamentos usa `interpretAdditionalBookingsWithAI`. |
| `extractCountFromText` | 596-603 | Nunca chamada. `interpretAdditionalBookingsWithAI` retorna `count` diretamente. |

**Recomendação:** Remover ambas. Se no futuro for necessário detectar múltiplos agendamentos sem IA, podem ser reintroduzidas.

---

## 2. Padrão `hasContext` repetido (6+ ocorrências)

O trecho abaixo aparece em vários pontos:

```typescript
const hasContext = match.inferred_area && 
                  match.inferred_area !== "indefinido" && 
                  (match.confidence ?? 0) >= 0.3
```

Ou variante:

```typescript
const hasContext =
  Boolean(match.inferred_area) &&
  match.inferred_area !== "indefinido" &&
  (match.confidence ?? 0) >= 0.3
```

**Recomendação:** Criar helper:

```typescript
function hasMatchContext(match: { inferred_area?: string; confidence?: number }): boolean {
  return Boolean(match.inferred_area) &&
    match.inferred_area !== "indefinido" &&
    (match.confidence ?? 0) >= 0.3
}
```

Substituir em todos os usos por `hasMatchContext(match)`.

---

## 3. Padrão de aplicação de `pending_additional_booking` (~12 ocorrências)

O bloco abaixo se repete com pequenas variações:

```typescript
const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
if (interpreted?.has_additional || (typeof interpreted?.count === "number" && interpreted.count > 0) 
    || orchestrator?.inferred_attendees === "multiple" || orchestrator?.inferred_attendees === "other_person") {
  nextState.pending_additional_booking = true
  nextState.pending_attendee_name = true
  nextState.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
  nextState.expected_additional_count = nextState.pending_additional_count
}
```

**Recomendação:** Criar função:

```typescript
function hasAdditionalBookings(
  interpreted: { has_additional?: boolean; count?: number } | null | undefined,
  orchestrator?: { inferred_attendees?: string } | null
): boolean {
  return Boolean(
    interpreted?.has_additional ||
    (typeof interpreted?.count === "number" && interpreted.count > 0) ||
    orchestrator?.inferred_attendees === "multiple" ||
    orchestrator?.inferred_attendees === "other_person"
  )
}

function applyAdditionalBookingState(
  state: SimulatorState,
  interpreted: { has_additional?: boolean; count?: number } | null | undefined,
  orchestrator?: { inferred_attendees?: string } | null
): void {
  if (!hasAdditionalBookings(interpreted, orchestrator)) return
  state.pending_additional_booking = true
  state.pending_attendee_name = true
  state.pending_additional_count = Math.max(1, interpreted?.count ?? 1)
  state.expected_additional_count = state.pending_additional_count
}
```

Isso reduz repetição e mantém o comportamento centralizado.

---

## 4. Bloco `answer_price` duplicado (qualification vs qualification_rejected)

O tratamento de `orchestrator.suggested_action === "answer_price"` é praticamente idêntico em:

- `qualification_rejected` (linhas ~2273-2317)
- `qualification` (linhas ~2452-2490)

A diferença principal:

- `qualification`: usa `getCordialPrefix(config, isFirst)` e inclui `orchestrator.inferred_attendees` na condição de additional.
- `qualification_rejected`: usa `getCordialPrefix(config, false)` e não inclui `inferred_attendees` na primeira parte.

**Recomendação:** Extrair função auxiliar, por exemplo:

```typescript
async function handleAnswerPriceAction(
  orchestrator: FlowOrchestratorOutput,
  text: string,
  config: SimulatorConfig,
  nextState: SimulatorState,
  cordialPrefix: string
): Promise<SimulatorResult | null> {
  const svc = orchestrator.inferred_service
    ? getServiceWithPrice(config.services || [], orchestrator.inferred_service)
    : null
  if (orchestrator.inferred_service && !svc) {
    const rejectionMessage = await generateRejectionMessageWithAI(orchestrator.inferred_service, config, false, true)
    return buildResult(rejectionMessage, nextState)
  }
  if (svc && svc.base_price != null) {
    nextState.slots.service = svc.name
    nextState.just_identified_service = true
    nextState.step = undefined
    nextState.mode = "booking"
    const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
    applyAdditionalBookingState(nextState, interpreted, orchestrator)
    return buildResult(
      cordialPrefix + `O ${svc.name} sai por R$ ${svc.base_price}. Quer agendar?`,
      nextState,
      ["Quero agendar", "Só queria saber"]
    )
  }
  const withPrice = (config.services || []).filter((s) => s.base_price != null)
  if (withPrice.length > 0) {
    const lines = withPrice.map((s) => `${s.name}: R$ ${s.base_price}`).join("; ")
    nextState.mode = "booking"
    nextState.step = undefined
    const interpreted = await interpretAdditionalBookingsWithAI(text, { has_completed_booking: false })
    applyAdditionalBookingState(nextState, interpreted, orchestrator)
    return buildResult(cordialPrefix + `Os valores são: ${lines}. Quer agendar algum?`, nextState, ["Quero agendar"])
  }
  return null
}
```

E chamar essa função nos dois blocos.

---

## 5. Bloco `isPriceQuestion` quase idêntico

O tratamento de `isPriceQuestion(text)` é muito similar em:

- `qualification_rejected` (linhas ~2354-2388)
- `qualification` (linhas ~2534-2585)

`qualification` tem tratamento extra:

- Serviço encontrado mas sem preço → `buildPriceNotAvailableMessage`
- Serviço não encontrado mas com contexto → `classifyServiceMatch` + rejeição

**Recomendação:** Extrair função:

```typescript
async function handlePriceQuestion(
  text: string,
  config: SimulatorConfig,
  nextState: SimulatorState,
  cordialPrefix: string,
  options: { isFirst: boolean; step?: "qualification" | "qualification_rejected" }
): Promise<SimulatorResult | null>
```

E implementar as variações via `options`. Isso reduz duplicação e torna o fluxo mais legível.

---

## 6. Bloco `isShortDecline` duplicado

O mesmo bloco aparece em:

- `qualification_rejected` (linhas ~2247-2257)
- `qualification` (linhas ~2427-2435)

**Recomendação:** Extrair:

```typescript
function handleShortDecline(config: SimulatorConfig, nextState: SimulatorState): SimulatorResult {
  const servicesList = (config.services || []).map((s) => s.name).filter(Boolean)
  if (servicesList.length > 0) {
    const list = servicesList.join(", ")
    return buildResult(`Tudo bem! Se precisar, atendemos: ${list}. Fico à disposição.`, nextState)
  }
  return buildResult("Tudo bem! Se precisar de algo, fico à disposição.", nextState)
}
```

---

## 7. Bloco `isDirectServiceInquiry` duplicado

Similar em ambos os steps, com diferença em `isFirst`.

**Recomendação:** Centralizar em uma função que recebe `isFirst` e `nextState`, e chamar nos dois pontos.

---

## 8. Padrão `getOtherStaffOptions` / `hasOtherStaff`

O padrão `const hasOtherStaff = getOtherStaffOptions(config, staffName).length > 0` aparece em vários lugares, com mensagens condicionais parecidas.

**Recomendação:** Criar helper:

```typescript
function hasOtherStaffOptions(config: SimulatorConfig, staffName?: string): boolean {
  return getOtherStaffOptions(config, staffName).length > 0
}
```

Isso não reduz muito código, mas deixa a intenção mais clara e facilita manutenção (ex.: regra de colaborador único).

---

## 9. Orquestrador: blocos `start_booking` e `list_services` duplicados

Os blocos de `orchestrator.suggested_action === "start_booking"` e `orchestrator.suggested_action === "list_services"` são praticamente iguais em `qualification` e `qualification_rejected`, exceto:

- `qualification_rejected` adiciona `step: "qualification"` em `list_services`
- Mensagem de cordialidade em `qualification` usa `cordial`; em `qualification_rejected` usa `getCordialPrefix(config, false)`

**Recomendação:** Extrair funções como `handleStartBookingAction` e `handleListServicesAction` e reutilizá-las nos dois fluxos.

---

## Priorização sugerida

| Prioridade | Item | Impacto | Esforço |
|------------|------|---------|---------|
| 1 | Remover `isAdditionalBookingRequest` e `extractCountFromText` | Baixo | Muito baixo |
| 2 | Criar `hasMatchContext(match)` | Médio | Baixo |
| 3 | Criar `hasAdditionalBookings` e `applyAdditionalBookingState` | Alto | Médio |
| 4 | Extrair `handleAnswerPriceAction` | Alto | Médio |
| 5 | Extrair `handleShortDecline` | Médio | Baixo |
| 6 | Extrair `handlePriceQuestion` | Alto | Alto |
| 7 | Extrair handlers do orquestrador (`start_booking`, `list_services`) | Médio | Médio |

---

## Próximos passos

1. ~~Aplicar prioridade 1 (remoção de funções mortas).~~ FEITO
2. ~~Implementar prioridade 2 e 3 (helpers de contexto e múltiplos agendamentos).~~ FEITO
3. Refatorar os blocos mais repetidos (prioridades 4–7) em etapas, com testes ou validação manual entre cada uma.

---

## Refatoração aplicada (fev/2025)

- **Modularização:** Código extraído para `supabase/functions/conversations-turn/lib/`:
  - `types.ts` — interfaces
  - `utils.ts` — normalizeText, parsing, schedule
  - `detection.ts` — is*, getGreetingByTime
  - `services.ts` — service matching, staff, classifyServiceMatch
  - `staff.ts` — getStaffList, getOtherStaffOptions, etc.
  - `builders.ts` — build*, generateRejectionMessageWithAI
  - `ai.ts` — interpretFlowWithAI, interpretAdditionalBookingsWithAI
  - `calendar.ts` — buildCalendarIcs, buildFinalBookingMessage
  - `state.ts` — createSimulatorState, buildResult, resetSlotsForNextBooking
  - `http.ts` — json, corsHeaders, createSupabaseAdmin, rewriteWithTone
  - `qualification.ts` — hasMatchContext, hasAdditionalBookings, applyAdditionalBookingState, handleShortDecline

- **Dead code removido:** `isAdditionalBookingRequest`, `extractCountFromText`

- **Helpers adicionados:** `hasMatchContext`, `hasAdditionalBookings`, `applyAdditionalBookingState`, `handleShortDecline`

- **Redução:** `index.ts` de ~3000 para ~1610 linhas
