# FASE 7 — Cenários de Teste Obrigatórios

Cenários para validar o comportamento de segurança e funcionalidade do assistente pessoal + orçamento.

**Referência:** `docs/simulacao-onboarding-e-conversation-fabi-cortinas.md`

---

## 1. Cliente tenta acessar agenda → bloqueado

**Setup:** Cliente (número não cadastrado em `tenant_user.phone_number`) envia mensagem.

**Ação:** "Quais são meus agendamentos de hoje?"

**Esperado:**
- `mode = external`, `actor_type = client` (ou `unknown`)
- **Nunca** executar `query_appointments_today`
- Resposta genérica: "Posso te ajudar a agendar uma visita ou tirar dúvidas sobre nossos serviços. O que você prefere?"
- Nunca mostrar a agenda real

**Como validar:** Simulador com `mode: "external"` ou WhatsApp com número não cadastrado como owner/admin.

---

## 2. Owner consulta agenda → permitido

**Setup:** Dono (número em `tenant_user.phone_number` com role owner) envia mensagem.

**Ação:** "Quais são meus agendamentos de hoje?"

**Esperado:**
- `mode = internal`, `actor_type = owner`
- Intent `query_appointments_today` executada
- Resposta com lista de agendamentos do dia (ex.: "📅 Hoje: 09:00 – Ana (Visita técnica), 14:00 – Carlos (Medição)")

**Como validar:** Simulador com `mode: "internal"`, `actor_type: "owner"`.

---

## 3. Owner gera orçamento → OK

**Setup:** Dono, modo internal. `quote_service` configurado para o agente.

**Ação:** "Faz orçamento de cortina 2,80 x 2,60 blackout wave com instalação"

**Esperado:**
- Intent `request_quote_internal`
- Slots extraídos (largura, altura, tecido, modelo, instalação)
- `validateSlots` e `calculateQuote` executados
- Resposta com breakdown e total
- Opção de gerar PDF

**Como validar:** Simulador internal + tenant com quote_service cadastrado.

---

## 4. Cliente gera estimativa → OK

**Setup:** Cliente, modo external.

**Ação:** "Quanto fica uma cortina 2,80 x 2,60?"

**Esperado:**
- Intent de orçamento external (price_inquiry / request_quote_external)
- Serviço detectado (keywords do quote_service)
- `calculateRange` com variáveis externas (largura, altura)
- Resposta em faixa: "Para esse tamanho, o investimento costuma ficar entre R$ X e R$ Y"
- CTA: "Posso agendar uma visita técnica para medir e fechar o valor exato?"

**Como validar:** Simulador com `mode: "external"`.

---

## 5. Cliente tenta cancelar agendamento → bloqueado

**Setup:** Cliente (modo external) com agendamento existente.

**Ação:** "Quero cancelar meu agendamento"

**Esperado:**
- **Nunca** executar fluxo de cancelamento (update status=cancelled)
- Resposta genérica: "Para cancelar ou alterar seu agendamento, entre em contato conosco."
- Apenas owner/admin pode cancelar via assistente (intent `cancel_appointment`)

**Como validar:** Simulador external + mensagem de cancelamento.

---

## Checklist de validação

- [ ] Cenário 1: Cliente agenda → bloqueado
- [ ] Cenário 2: Owner agenda → permitido
- [ ] Cenário 3: Owner orçamento → OK
- [ ] Cenário 4: Cliente estimativa → OK
- [ ] Cenário 5: Cliente cancelar → bloqueado

---

## Integridade multi-tenant

- Cada tenant vê apenas seus próprios dados (agenda, orçamentos, contatos)
- RLS ativo em todas as tabelas sensíveis
- `tenant_id` e `agent_id` validados em todas as queries
