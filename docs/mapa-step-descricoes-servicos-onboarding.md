# Mapa: step de descrições dos serviços (IA + aprovação) no onboarding

Objetivo: inserir o step **catalog_services_descriptions_suggestion** (ou **catalog_services_descriptions_offer**) no fluxo de onboarding, **depois** de `catalog_services_list` e **antes** de `booking_services_list` (agendamento) ou `quote_services_list` (orçamento), para **ambos** os contextos (agendamento e orçamento). O step é **opcional**: o usuário pode "Pular por enquanto".

---

## 1. Ordem atual dos steps (flow-manager.ts)

Em `determineNextStep` a ordem é:

| Ordem | Step | Condição |
|-------|------|----------|
| 1 | `business_type` | missing business_type |
| 2 | `business_name` | missing business_name |
| 3 | `context` | !context |
| 4 | **`catalog_services_list`** | missing catalog_services OU catalogServices.length === 0 |
| 5 | **`booking_services_list`** | (booking ou both) E (missing booking_services OU !services_confirmed) |
| 6 | schedule_days, schedule_time, schedule_breaks, schedule_interval, min_booking_lead | (booking/both) E missing schedule.* |
| 7 | services_duration, services_pricing | (booking/both) E bookingServices preenchido |
| 8 | sequence_booking_offer, sequence_services_select | (booking/both) |
| 9 | staff_mode, staff_schedule_* | (booking/both) |
| 10 | **`quote_services_list`** | (quote ou both) E !quote_services |
| 11 | quote_service_pricing, quote_variables, ... | (quote/both) |

**Inserção desejada:** entre o step 4 e o step 5 (e, no ramo quote-only, entre 4 e 10). Ou seja:

- **Novo step 4.5:** `catalog_services_descriptions_offer` (ou `catalog_services_descriptions_suggestion`)
- Condição: `catalog_services.length > 0` E (opcionalmente) usuário ainda não respondeu a oferta (flag nova).

---

## 2. Arquivos a alterar

### 2.1 flow-manager.ts

- **Função:** `determineNextStep`
- **Onde:** logo após o bloco que retorna `catalog_services_list` (linhas 291–304), e **antes** do bloco que retorna `booking_services_list` (linhas 306–322).

**Alteração:**

1. Adicionar um campo opcional em `BusinessModelData` (ou usar um já existente) para indicar que a oferta de descrições foi respondida, por exemplo:
   - `catalog_descriptions_offer_done?: boolean` (true = usuário escolheu "Gerar" ou "Pular").
2. Inserir um novo `if`:
   - Condição: `catalogServices.length > 0` E `!currentData.catalog_descriptions_offer_done`.
   - Retorno: `step: 'catalog_services_descriptions_offer'`, mensagem tipo “Pra você não perder tempo, posso sugerir uma descrição curta para cada serviço. Você revisa e edita. Quer que eu gere agora?”, `action_options: ['Gerar descrições', 'Pular por enquanto']`, `requires_action: 'catalog_services_descriptions_offer'`.

Assim, ao sair de `catalog_services_list` com lista preenchida, o próximo step será o de oferta de descrições (ou, se já tiver sido feito, segue para `booking_services_list` ou `quote_services_list`).

---

### 2.2 index.ts (onboarding-chat)

**A) Handler do step de oferta (primeira tela)**

- **Onde:** na função que trata `currentStep` (por exemplo, o grande switch/if por step; hoje há blocos para `context`, `catalog_services_list`, `booking_services_list`, etc.).
- **Novo bloco:** `if (currentStep === 'catalog_services_descriptions_offer')`.
  - Se texto for "Pular por enquanto" (ou equivalente):  
    - `extracted_data: { catalog_descriptions_offer_done: true }`.  
    - Chamar `determineNextStep(merged, ..., makeFlowState('catalog_services_descriptions_offer', merged))` e retornar `next_step: next.step`, etc.
  - Se for "Gerar descrições" (ou equivalente):  
    - Manter `next_step: 'catalog_services_descriptions_offer'` e passar para um subestado de geração (ex.: `catalog_services_descriptions_generating` ou primeiro item do fluxo “um por vez”).

**B) Geração de descrições por IA**

- **Onde:** novo bloco ou função chamada quando o usuário escolhe "Gerar descrições".
- **Lógica:**
  - Chamar IA (uma vez por serviço ou em lote, conforme doc) para gerar 1–2 frases por `catalog_services[i].name`.
  - Persistir sugestões em memória/estado (ex.: `catalog_services_descriptions_suggestions: Array<{ name: string; suggested: string }>` ou atualizar direto `catalog_services[i].description`).
  - Definir próximo step como revisão, ex.: `catalog_services_descriptions_review` (com índice do serviço atual, ex. `catalog_services_descriptions_review_index: 0`).

**C) Handler do step de revisão (um serviço por vez)**

- **Step:** `catalog_services_descriptions_review` (e estado com índice do serviço).
- **Onde:** novo bloco no mesmo handler por `currentStep`.
- **Lógica:**
  - Mostrar: nome do serviço, sugestão de descrição, ações: "Aprovar" | "Editar" | "Refazer" | "Pular".
  - Aprovar: salvar `catalog_services[i].description = sugestão`; incrementar índice; se ainda houver próximo, retornar mesmo step com próximo índice; senão, `catalog_descriptions_offer_done: true` e `determineNextStep` para o próximo step do fluxo.
  - Editar: pedir texto livre; na resposta, salvar em `catalog_services[i].description` e avançar para próximo serviço (ou fim).
  - Refazer: chamar IA de novo só para esse serviço; atualizar sugestão e mostrar de novo.
  - Pular: manter `description` undefined para esse serviço; avançar para próximo (ou fim).
- Ao terminar todos: `extracted_data` com `catalog_services` atualizado e `catalog_descriptions_offer_done: true`; chamar `determineNextStep` e retornar `next_step`, etc.

**D) getStepContextualHint**

- Adicionar entrada para `catalog_services_descriptions_offer` (e, se existir, `catalog_services_descriptions_review`), por exemplo: “Escolha se quer gerar descrições sugeridas por IA ou pular.”.

**E) Resumo / edição**

- Se o resumo ou a edição exibem itens do catálogo, incluir `description` quando existir (já suportado se `catalog_services` for `Array<{ name: string; description?: string }>`).
- Garantir que, ao editar e salvar, `catalog_services` com `description` seja persistido (ex.: em `extracted_data` ou no objeto que vai para `collected_data` / backend).

---

### 2.3 Persistência e uso da descrição

- **Onboarding:** os dados são salvos em `collected_data` / `business_config` (ou equivalente). Garantir que:
  - `catalog_services` seja `Array<{ name: string; description?: string }>`.
  - Ao concluir ou pular o step de descrições, `catalog_services[i].description` esteja preenchido quando o usuário aprovou ou editou.
- **Atendimento (agendamento e orçamento):**
  - **conversations-turn** já usa `svc.description` quando o cliente pergunta detalhe do serviço (ex.: `turn-handler.ts`, `booking-mode.ts`, `anytime-handlers.ts`, `orchestrator-actions.ts`).
  - Garantir que o config que chega ao atendimento (agendamento e orçamento) inclua `catalog_services` / `booking_services` com `description` quando existir (já é o caso se vier de `business_config`/tenant). Nenhum outro arquivo de atendimento precisa ser alterado só por causa deste step; o que falta é **só** o step no onboarding que preenche `description`.

---

## 3. Fluxo resumido (agendamento e orçamento)

```
context (Agendamento | Orçamento | Ambos)
    ↓
catalog_services_list  ← usuário informa lista de serviços do catálogo
    ↓
[NOVO] catalog_services_descriptions_offer
    │   "Quer que eu sugira uma descrição curta para cada serviço?"
    │   Opções: "Gerar descrições" | "Pular por enquanto"
    ├─ "Pular por enquanto" → catalog_descriptions_offer_done = true → próximo step
    └─ "Gerar descrições" → IA gera 1–2 frases por serviço
            ↓
        catalog_services_descriptions_review (um serviço por vez)
            Aprovar | Editar | Refazer | Pular
            ↓ (após todos)
        catalog_descriptions_offer_done = true → próximo step
    ↓
Se (booking ou both): booking_services_list → schedule_* → ...
Se (quote ou both):   quote_services_list → quote_service_pricing → ...
```

O mesmo step de oferta e revisão de descrições serve para **ambos** os contextos; ele só roda uma vez, após o catálogo estar preenchido, e antes de ramificar para booking ou quote.

---

## 4. Onde exatamente inserir no flow-manager.ts

**Trecho atual (linhas 291–322):**

```ts
  if (
    missing.includes('catalog_services') ||
    catalogServices.length === 0
  ) {
    // ... return catalog_services_list
  }

  if (
    (currentData.context === 'booking' || currentData.context === 'both') &&
    (missing.includes('booking_services') || ...)
  ) {
    // ... return booking_services_list
  }
```

**Inserir entre os dois blocos:**

```ts
  // Step opcional: oferta de sugestão de descrições para o catálogo (agendamento e orçamento)
  if (
    catalogServices.length > 0 &&
    !(currentData as any).catalog_descriptions_offer_done
  ) {
    return {
      step: 'catalog_services_descriptions_offer',
      message: 'Pra você não perder tempo, eu posso sugerir uma descrição curta pra cada serviço. Você revisa e edita. Quer que eu gere agora?',
      action_options: ['Gerar descrições', 'Pular por enquanto'],
      requires_action: 'catalog_services_descriptions_offer',
    }
  }
```

---

## 5. Checklist de implementação (sem executar)

- [ ] **flow-manager.ts:** adicionar flag `catalog_descriptions_offer_done` (ou equivalente) no tipo/uso; inserir bloco do novo step entre `catalog_services_list` e `booking_services_list`.
- [ ] **index.ts:** handler para `catalog_services_descriptions_offer` (tratar "Pular" e "Gerar descrições").
- [ ] **index.ts:** chamada à IA para gerar descrições por serviço; persistir em `catalog_services[i].description` ou em estado temporário de revisão.
- [ ] **index.ts:** handler para `catalog_services_descriptions_review` (um por vez: Aprovar, Editar, Refazer, Pular); ao finalizar, setar `catalog_descriptions_offer_done: true` e chamar `determineNextStep`.
- [ ] **index.ts:** `getStepContextualHint` para os novos steps.
- [ ] **Persistência:** garantir que `collected_data` / `business_config` guarde `catalog_services[].description` e que o atendimento (agendamento e orçamento) já receba esse config (hoje já usa `description` quando existe).

Com isso, o step de descrições fica mapeado para **ambos** os fluxos (agendamento e orçamento), sem duplicar lógica, e a descrição passa a ser usada tanto no agendamento quanto no orçamento/respostas informativas.
