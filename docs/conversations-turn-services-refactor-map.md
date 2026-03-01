# Revisão Estruturada – config.services no conversations-turn

**Objetivo:** Classificar cada uso de `config.services` para refatoração segura (catalog_services vs booking_services).

**Legenda:**
- 🔵 **Informativo** → `getCatalogServices(config)`
- 🟢 **Agendamento** → `getBookingServices(config)`
- 🟡 **Preço** → `getBookingServices(config)` (base_price vem de booking)
- 🟣 **Ambíguo** → precisa decisão
- ⚙️ **Infra** → carregamento/merge de dados (não usa config diretamente no fluxo)

---

## 1. ARQUIVOS E USOS

### 1.1 `lib/informational.ts`

| Linha | Uso | Classificação | Observação |
|-------|-----|---------------|------------|
| 178-179 | `config.services` em `isListServicesInformational` | 🔵 Informativo | "Quais serviços vocês fazem?" → catálogo |
| 180 | `buildServicesListWithPrices(config)` | 🟣 Ambíguo | Hoje inclui preço. Doc: informativo usa catalog (sem preço). Se houver booking, adicionar CTA "Se quiser, posso agendar..." |

**Ação:** Criar `buildCatalogListMessage(config)` para informativo (sem preço, com description se existir). Manter `buildServicesListWithPrices` para contexto de agendamento (usa booking).

---

### 1.2 `lib/builders.ts`

| Linha | Uso | Classificação | Observação |
|-------|-----|---------------|------------|
| 179-191 | `buildServicesListWithPrices` | 🟡 Preço + 🟢 Agendamento | Lista serviços COM preço. Usado em contexto de agendamento e preço. → `getBookingServices` |
| 206-213 | `buildGenericFallback` | 🔵 Informativo | "Nós trabalhamos com: X" → catálogo |
| 245-264 | `buildServicePrompt` | 🟢 Agendamento | "Qual serviço quer agendar?" + `buildServiceOptions(config.services)` → booking |
| 251-254 | `fallbackExamples` de sequence | 🟢 Agendamento | sequence_eligible_services ou services → booking |
| 312-313 | `buildRejectionMessage` | 🔵 Informativo | "Trabalhamos com: X" (reject_unlisted) → doc diz validar contra **catalog** |
| 362 | `generateRejectionMessageWithAI` | 🔵 Informativo | servicesList para IA → catalog |

**Ação:** `buildRejectionMessage` e `generateRejectionMessageWithAI` → `getCatalogServices` (reject_unlisted valida contra catálogo).

---

### 1.3 `lib/services.ts`

| Linha | Uso | Classificação | Observação |
|-------|-----|---------------|------------|
| 5-12 | `findServiceByExactMatch(text, services)` | Recebe array | Chamador passa getCatalog ou getBooking conforme contexto |
| 59-101 | `findServiceFromText(text, services)` | Recebe array | Idem |
| 104-110 | `getServiceWithPrice(services, name)` | 🟡 Preço | Sempre opera sobre **booking_services** (precisa base_price) |
| 112-119 | `getServiceDurationMinutes(config, name)` | 🟢 Agendamento | duration_minutes → booking |
| 131-141 | `getServicesTotalDuration(config, str)` | 🟢 Agendamento | Usa getServiceDurationMinutes → booking |
| 144-157 | `getServicesTotalPrice(config, str)` | 🟡 Preço | Usa getServiceWithPrice → booking |
| 160-196 | `findServicesFromText(text, services, eligible)` | 🟢 Agendamento | Sequência de agendamento → booking |
| 197+ | `areaMatchesServices` | Recebe array | Chamador define |

**Ação:** As funções que recebem `services` como parâmetro: o **chamador** passa `getCatalogServices(config)` ou `getBookingServices(config)`. `getServiceWithPrice`, `getServiceDurationMinutes`, `getServicesTotalDuration`, `getServicesTotalPrice` → sempre recebem `getBookingServices(config)`.

---

### 1.4 `lib/qualification.ts`

| Linha | Uso | Classificação | Observação |
|-------|-----|---------------|------------|
| 45-46 | `handleShortDecline` – "atendemos: X" | 🔵 Informativo | Lista para cliente que desistiu → catálogo |

---

### 1.5 `lib/ai.ts`

| Linha | Uso | Classificação | Observação |
|-------|-----|---------------|------------|
| 34-45 | `buildConfigSummary` para IA | 🟣 Ambíguo | Resumo de serviços para contexto da IA. Inclui preço e duração. Para classificação genérica, catalog pode bastar; para agendamento, booking. |

**Decisão:** Manter resumo com **booking_services** (preço + duração) para a IA ter contexto completo. Ou: catalog para "o que oferecemos" + booking para "o que pode agendar". Recomendação: usar **booking** no resumo da IA (mais útil para agendamento).

---

### 1.6 `index.ts` – Carregamento e merge

| Linha | Uso | Classificação | Observação |
|-------|-----|---------------|------------|
| 180, 189 | `loadServicesFromSettings` – `business_config.services` | ⚙️ Infra | Migração: carregar `catalog_services` e `booking_services`. Retornar ambos no config. |
| 202 | `loadServicesFromOnboardingSession` – `collected_data.services` | ⚙️ Infra | Onboarding: durante transição, pode ter `services` ou `catalog_services`/`booking_services`. Fallback. |

---

### 1.7 `index.ts` – Fluxo de atendimento (por bloco)

#### tryHandlePriceQuestionAnytime (linhas 234-264)
| Uso | Classificação |
|-----|---------------|
| findServiceFromText(text, config.services) | 🟡 Preço → getBookingServices |
| getServiceWithPrice(config.services, serviceName) | 🟡 Preço → getBookingServices |
| (config.services).filter(base_price) | 🟡 Preço → getBookingServices |

#### buildServicesListResult / helpers (linhas 271-287)
| Uso | Classificação |
|-----|---------------|
| serviceOptions de config.services | 🟡 Preço / 🟢 Agendamento → getBookingServices |
| sequence_eligible_services \|\| services.map | 🟢 Agendamento → getBookingServices |
| findServicesFromText(text, config.services) | 🟢 Agendamento → getBookingServices |

#### resolveBooking e fluxo de agendamento (linhas 320-360, 888-972, 1221-1278)
| Uso | Classificação |
|-----|---------------|
| findServiceFromText, getServiceWithPrice | 🟢 Agendamento → getBookingServices |
| serviceOptions, buildServiceOptions | 🟢 Agendamento → getBookingServices |
| state.slots.service \|\| (config.services)[0] | 🟢 Agendamento → getBookingServices |
| services no resolveBooking context | 🟢 Agendamento → getBookingServices |

#### handleBookingModeMessage (linhas 2717-2760)
| Uso | Classificação |
|-----|---------------|
| isPriceQuestion + findServiceFromText, getServiceWithPrice | 🟡 Preço → getBookingServices |
| classifyServiceMatch (usa config) | 🟣 Ver ai.ts |
| withPrice, serviceOptions | 🟡 Preço → getBookingServices |

#### handleFirstMessageOrchestratorAction (linhas 2335-2660)
| Uso | Classificação |
|-----|---------------|
| getServiceWithPrice(config.services, orchestrator.inferred_service) | 🟡 Preço / 🟢 Agendamento → getBookingServices |
| findServiceFromText(text, config.services) | 🟢 Agendamento → getBookingServices |
| buildServicePrompt, buildServiceOptions | 🟢 Agendamento → getBookingServices |
| list_services (buildListServicesMessage) | 🟣 Ambíguo | Pode ser informativo OU pré-agendamento. Doc: informativo = catalog. Se list_services é "quais serviços?" → catalog. Se é "escolha para agendar" → booking. |

**Decisão list_services:** Quando o orchestrator dispara `list_services`, o contexto é "cliente quer saber/ver serviços". Se for só informativo → catalog. Se for para escolher e agendar → booking. O `buildListServicesMessage` hoje usa `buildServicesListWithPrices` (com preço). Para "listar para agendar" → booking. Manter booking para list_services no orchestrator (é pré-agendamento).

#### canSetMode / reject_unlisted (linhas 2694-2695, 2911-2912)
| Uso | Classificação |
|-----|---------------|
| (config.services).length === 0 | 🟣 Ambíguo | Condição para não exigir qualification. Doc: reject_unlisted valida contra **catalog**. Usar getCatalogServices().length |
| lead_policy.reject_unlisted_services && config.services.length | 🔵 Informativo | Validação contra catálogo → getCatalogServices |

#### classifyServiceMatch (chamadas)
| Uso | Classificação |
|-----|---------------|
| Recebe config | 🟣 | A função usa config.services internamente. Deve receber catalog para validar "está na lista?" (reject_unlisted). → getCatalogServices |

#### Demais usos no index.ts
Todos os demais `config.services` no fluxo de booking, price, resolveBooking, buildServicePrompt, etc. → 🟢 ou 🟡 → **getBookingServices**.

---

## 2. RESUMO POR CLASSIFICAÇÃO

| Classificação | Qtd aprox. | Ação |
|---------------|------------|------|
| 🔵 Informativo | ~8 | `getCatalogServices(config)` |
| 🟢 Agendamento | ~45 | `getBookingServices(config)` |
| 🟡 Preço | ~15 | `getBookingServices(config)` |
| 🟣 Ambíguo | ~5 | Decisão explícita (ver acima) |
| ⚙️ Infra | 3 | Atualizar loaders para catalog/booking |

---

## 3. ORDEM DE REFATORAÇÃO RECOMENDADA

### Fase 1 – Infraestrutura
1. Criar `getCatalogServices(config)` e `getBookingServices(config)` em `lib/services.ts` (ou novo `lib/config-helpers.ts`).
2. Atualizar `loadServicesFromSettings` e `loadServicesFromOnboardingSession` para ler `catalog_services` e `booking_services` do DB, com fallback para `services`.
3. Garantir que o config montado (body.context) inclua `catalog_services` e `booking_services` quando disponíveis.

### Fase 2 – Builders e informational
4. `informational.ts`: trocar `config.services` por `getCatalogServices(config)`.
5. Criar `buildCatalogListMessage(config)` para resposta informativa (sem preço, com description).
6. `builders.ts`: `buildGenericFallback`, `buildRejectionMessage`, `generateRejectionMessageWithAI` → `getCatalogServices`.
7. `builders.ts`: `buildServicesListWithPrices`, `buildServicePrompt`, `buildServiceOptions` (quando em contexto de agendamento) → `getBookingServices`.

### Fase 3 – services.ts
8. `getServiceDurationMinutes`, `getServicesTotalDuration`, `getServicesTotalPrice` → passar a usar `getBookingServices(config)` internamente.
9. Manter `findServiceFromText`, `getServiceWithPrice` recebendo array; todos os chamadores passam `getBookingServices(config)` ou `getCatalogServices(config)` conforme o caso.

### Fase 4 – qualification.ts
10. `handleShortDecline` → `getCatalogServices`.

### Fase 5 – index.ts (substituição em massa)
11. Substituir cada `config.services` por `getCatalogServices(config)` ou `getBookingServices(config)` conforme a tabela acima.
12. `canSetMode` e `reject_unlisted`: usar `getCatalogServices(config)`.
13. `classifyServiceMatch`: garantir que use catalog para validação.

### Fase 6 – ai.ts
14. `buildConfigSummary`: decidir catalog vs booking (recomendação: booking para contexto completo).

### Fase 7 – Testes e depreciação
15. Testar simulador (informativo, agendamento, preço).
16. Manter fallback para `config.services` durante janela de depreciação.
17. Remover `services` do config e fallback após validação.

---

## 4. PONTOS DE ATENÇÃO

1. **buildServicesListWithPrices vs buildCatalogListMessage:** O informativo ("quais serviços?") não deve mostrar preço (doc). Criar função separada para catalog.
2. **classifyServiceMatch:** Usar catalog para validar se o serviço mencionado está na lista do negócio.
3. **list_services no orchestrator:** Manter booking (é pré-agendamento, cliente vai escolher).
4. **sequence_eligible_services:** Já é subconjunto de services; após migração será de booking_services. Garantir que `buildServicePrompt` e similares usem `getBookingServices` para sequence_eligible_services.
5. **Config vindo do body.context:** Os webhooks e o simulator passam `context` com `services`. Será preciso passar também `catalog_services` e `booking_services` (ou aplicar migração no backend antes de enviar).

---

## 5. CHECKLIST DE VALIDAÇÃO

- [ ] Helpers criados com fallback
- [ ] Loaders atualizados (DB)
- [ ] Webhooks/API passam catalog e booking no context
- [ ] informational.ts migrado
- [ ] builders.ts migrado
- [ ] services.ts – chamadores atualizados
- [ ] qualification.ts migrado
- [ ] index.ts – todos os usos substituídos
- [ ] ai.ts migrado
- [ ] Testes manuais: "quais serviços?", agendamento, preço, reject_unlisted
- [ ] Fallback temporário funcionando
- [ ] Documentar remoção de `services` após janela
