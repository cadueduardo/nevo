# Plano de Ação — Área do Cliente Nevo

Este documento é o **plano de execução** da nova etapa do projeto Nevo: a implementação da área do cliente autenticada (`/app`).

**Especificação de referência:** `docs/nevo-app.md`

**Objetivo:** Estabelecer área autenticada, persistir agendamentos reais e permitir operação básica via UI.

---

## Visão Geral

| Etapa | Resumo | Feito |
|-------|--------|-------|
| 1 | Área autenticada + login + redirecionamento pós-onboarding | [x] |
| 2 | Fonte única da verdade (business_config) | [x] |
| 3 | APIs bootstrap e settings | [x] |
| 4 | Tabela appointment + RLS | [x] |
| 5 | Rota /api/app/simulator + persistência na Edge Function | [x] |
| 6 | Tela /app/agenda | [x] |
| 7 | Tela /app/settings | [x] |
| 8 | Simulador real em /app | [x] |

### Fases (agrupamento para acompanhamento)

| Fase | Etapas | Foco |
|------|--------|------|
| **A — Fundação** | 1, 2 | Auth, layout /app, login, business_config completo na migração |
| **B — APIs e persistência** | 3, 4 | Bootstrap, settings, tabela appointment + RLS |
| **C — Simulador e agenda** | 5, 6 | Rota /api/app/simulator, persistência na Edge, tela agenda |
| **D — Settings e simulador em /app** | 7, 8 | Tela settings, página /app/simulator com dados reais |

**Próxima execução:** Todas as etapas do MVP concluídas. Revisar Definição de Pronto abaixo.

---

## Checklist Pré-Execução

- [ ] Ler `docs/nevo-app.md` na íntegra
- [ ] Ler `docs/analise-completa-projeto.md` para contexto
- [ ] Confirmar que onboarding e migração estão funcionando
- [ ] Ter acesso ao Supabase (migrations, Edge Functions)

---

## ETAPA 1 — Área autenticada /app

- [x] **Concluída**

### Tarefas

1. **Layout protegido**
   - Criar `src/app/(dashboard)/layout.tsx`
   - Criar `src/app/(dashboard)/app/page.tsx` → rota `/app`
   - Implementar verificação de sessão Supabase Auth
   - Redirecionar para `/login` se não autenticado

2. **Página de login**
   - Criar `src/app/login/page.tsx`
   - Login com email/senha via Supabase Auth
   - Após sucesso, redirecionar para `/app`

3. **Pós-onboarding**
   - Localizar o bloco com `console.log` após onboarding completo em `LandingChat.tsx`
   - **Fazer login automático:** chamar `supabase.auth.signInWithPassword({ email, password })` com as credenciais recém-cadastradas
   - Só então redirecionar para `/app`
   - Remover o `console.log`
   - *Observação:* Garanta que email/senha recém-cadastrados estejam disponíveis em estado local até completar signInWithPassword; se já existir sessão ativa, apenas redirecionar para `/app`.

### Critério de aceite

- [x] Usuário autenticado acessa `/app`
- [x] Usuário não autenticado é redirecionado para `/login`
- [x] Após cadastro no onboarding, usuário é logado e redirecionado para `/app`

---

## ETAPA 2 — Fonte única da verdade (business_config)

- [x] **Concluída**

### Estrutura obrigatória

```json
{
  "services": [
    { "name": "Corte", "duration_minutes": 30, "base_price": 50 }
  ],
  "staff": [
    { "name": "Carlos", "use_business_schedule": true, "schedule": null }
  ],
  "location_mode": "fixed",
  "establishment_address": {},
  "service_area": null,
  "holidays_attend": [],
  "closure_periods": [],
  "allow_sequence_booking": false,
  "sequence_eligible_services": [],
  "context_mode": "booking",
  "business_type": "barbearia"
}
```

**schedule:** manter EXATAMENTE o mesmo formato já utilizado hoje no simulador/onboarding (context.schedule). Não criar, simplificar ou adaptar o formato. O executor deve localizar no código onde o simulador monta/consome context.schedule e reutilizar esse formato como contrato.

### Tarefas

1. Atualizar `migrateOnboardingToTenant` em `supabase/functions/onboarding-chat/migrate.ts`:
   - Incluir `schedule` dentro de `business_config`
   - Incluir `staff` dentro de `business_config`
   - Incluir `context_mode` e `business_type`
   - NÃO criar IDs para staff ou services

### Critério de aceite

- [x] Tenant recém-criado possui schedule, staff, context_mode e business_type em `business_config`

---

## ETAPA 3 — APIs internas do /app

- [x] **Concluída**

### GET /api/app/bootstrap

- Autenticar usuário (Supabase server client com JWT do usuário)
- Resolver tenant via `tenant_user`
- Retornar: tenant, tenant_setting (tone, handoff_mode, when_client_asks_price_no_value), business_config, flow (somente leitura)

### PATCH /api/app/settings

- Atualização parcial de business_config e tenant_setting.tone, tenant_setting.handoff_mode
- Validar sessão e tenant ownership
- Não permitir apagar campos críticos acidentalmente

### Critério de aceite

- [x] `/app` carrega dados reais do tenant
- [x] Alterações persistem no banco

---

## ETAPA 4 — Persistência de Agendamentos

- [x] **Concluída**

### Tabela appointment

```sql
-- Campos: id, tenant_id, attendee_name, staff_name, service_names, start_at, end_at, status, created_at
-- Status: confirmed | cancelled | rescheduled
-- Idempotência (MVP):
-- Evitar dupla confirmação do mesmo slot verificando (tenant_id, staff_name, start_at).
-- Pode ser implementado via constraint UNIQUE OU via verificação manual antes do INSERT.
```

### RLS

- **SELECT/UPDATE:** feitos via rotas `/api/app/*` usando Supabase server client com JWT do usuário (sujeito a RLS). tenant_user só vê/atualiza appointments do próprio tenant.
- **INSERT:** feito pela Edge Function usando service role (admin). Portanto não depende de RLS para inserir — o INSERT é feito com cliente privilegiado, fora do escopo RLS.

Incluir políticas RLS na mesma migration que cria a tabela.

### Critério de aceite

- [x] Tabela criada
- [x] RLS configurado para tenant_user

---

## ETAPA 5 — Rota intermediária + persistência na Edge Function

- [x] **Concluída**

### POST /api/app/simulator

**Request body (do frontend):** apenas `message` e `conversation_id` (opcional).  
**Nunca aceitar** `context` ou `tenant_id` do cliente.

**Fluxo da rota:**
1. Validar sessão
2. Resolver tenant_id via tenant_user
3. Buscar tenant + business_config (ou usar cache)
4. Montar context a partir do tenant
5. Chamar Edge Function conversations-turn com: message, conversation_id, context, tenant_id

**Fluxo da Edge Function:**
- Aceitar `tenant_id` no request body (somente quando chamada por /api/app/simulator)
- Quando booking for confirmado, inserir registro em appointment
- Idempotência: verificar se já existe (tenant_id + staff_name + start_at) antes de inserir

### Critério de aceite

- [x] Rota protegida por auth
- [x] Booking confirmado gera appointment persistido
- [x] Fechar página não perde o agendamento

---

## ETAPA 6 — /app/agenda

- [x] **Concluída**

### GET /api/app/appointments

- Filtrar por tenant_id (resolvido da sessão)
- Intervalo: hoje → +30 dias
- Limite: 50
- Order by start_at asc

### Página /app/agenda

- Listar: attendee_name, service_names, start_at, staff_name
- Ação: cancelar (UPDATE status)
- Cancelar agendamento = atualizar status para `cancelled`. Não deletar registros da tabela appointment.

### Critério de aceite

- [x] Usuário vê e cancela agendamentos reais

---

## ETAPA 7 — /app/settings

- [x] **Concluída**

- Editar: services, schedule, staff, tone, handoff_mode
- Salvar via PATCH /api/app/settings
- Alterações impactam simulador e futuros atendimentos

### Critério de aceite

- [x] Edição e persistência via PATCH /api/app/settings
- [x] Alterações refletem no simulador e atendimentos

---

## ETAPA 8 — Simulador real em /app

- [x] **Concluída**

### Página /app/simulator

- Reutilizar SimulatorPanel
- **Adaptação:** SimulatorPanel deve chamar `POST /api/app/simulator` (não `/api/conversations-turn`)
- Enviar apenas `message` e `conversation_id` — context e tenant_id são resolvidos no backend
- Context vem exclusivamente do tenant (via bootstrap/cache na rota)
- Booking persiste em appointment

### Critério de aceite

- [x] Simulador funciona sem onboarding
- [x] Agendamentos são reais e aparecem na agenda

---

## Pontos de Atenção (da Análise)

| Ponto | Ação |
|-------|------|
| Frontend nunca envia tenant_id | Garantir em todas as rotas /api/app/* |
| Context nunca vem do cliente em /app | Rota /api/app/simulator monta context server-side |
| Login pós-onboarding | signInWithPassword antes do redirect |
| Persistência é na Edge Function | Não na rota Next.js |
| RLS para appointment | Criar na migration da tabela |

---

## Definição de Pronto (MVP)

- [x] /app autenticado funcional
- [x] business_config consistente (schedule, staff, etc.)
- [x] agendamentos persistidos
- [x] agenda operacional
- [x] simulador usando dados reais do tenant

---

## Referências

- `docs/nevo-app.md` — Especificação completa
- `docs/analise-completa-projeto.md` — Estado atual do projeto
- `supabase/functions/onboarding-chat/migrate.ts` — Migração para atualizar
- `supabase/functions/conversations-turn/index.ts` — Edge Function para atualizar
- `src/features/simulator/components/SimulatorPanel.tsx` — Componente a adaptar

---

## Como testar (MVP)

**Pré-requisitos:**

- App rodando (`npm run dev`).
- Supabase com migration `appointment_table_and_rls` aplicada e Edge Function `conversations-turn` deployada (com persistência em `appointment`).
- **Variável de ambiente:** em `.env.local` (ou no ambiente do servidor) defina `SUPABASE_SERVICE_ROLE_KEY` com a chave **service_role** do projeto (Supabase Dashboard → Project Settings → API). Sem ela, o Simulador em `/app` retorna *"Configuração do servidor incompleta"*.

1. **Login e /app**
   - Acesse `/login`, entre com email/senha de um usuário que já tenha tenant (ex.: criado pelo onboarding).
   - Deve redirecionar para `/app`. A página deve mostrar o nome do tenant e os links Agenda, Configurações, Simulador.

2. **Pós-onboarding**
   - Faça um novo cadastro completo pelo onboarding (landing) até criar conta.
   - Após confirmar senha, deve fazer login automático e redirecionar para `/app`.

3. **Simulador em /app**
   - Em `/app`, clique em **Simulador**. Converse até confirmar um agendamento (serviço, dia, horário, nome).
   - Verifique que a resposta confirma o agendamento. Feche a página e reabra `/app/simulator` (ou vá em Agenda).

4. **Agenda**
   - Acesse **Agenda**. Deve listar os agendamentos dos próximos 30 dias (incluindo o que você acabou de criar no simulador).
   - Clique em **Cancelar** em um agendamento: o status deve mudar para "Cancelado".

5. **Configurações**
   - Acesse **Configurações**. Altere **Tom** ou **Handoff** e clique em **Salvar**. Recarregue a página e confira se os valores persistiram.
   - O JSON de **business_config** pode ser editado e salvo (cuidado com JSON válido); as alterações passam a valer no simulador.
