# Nevo — Implementação da Área do Cliente (MVP)

Este documento descreve, em ordem obrigatória, as etapas para implementar a área do cliente (/app) no projeto Nevo.

O objetivo NÃO é criar todas as funcionalidades finais, mas sim:
- estabelecer uma fonte única da verdade
- persistir agendamentos reais
- permitir operação básica via UI autenticada

Não pule etapas.
Não implemente funcionalidades fora do escopo descrito.

---

## CONTEXTO ATUAL DO PROJETO

- O onboarding já coleta todos os dados do negócio.
- O migrateOnboardingToTenant cria:
  - tenant
  - tenant_user
  - tenant_setting
  - flow
- O simulador funciona, mas:
  - usa dados do onboarding
  - NÃO persiste agendamentos
- NÃO existe área autenticada (/app).
- staff e schedule NÃO são migrados para o tenant_setting.business_config.

---

## PRINCÍPIOS OBRIGATÓRIOS

1. `tenant_setting.business_config` será a FONTE ÚNICA DA VERDADE (MVP).
2. O simulador e o atendimento devem montar o context a partir do tenant, não do onboarding.
3. Agendamentos devem ser persistidos no banco.
4. Não criar editor visual de fluxo nesta fase.
5. Priorizar consistência de dados, não UI avançada.

---

# ETAPA 1 — Criar Área Autenticada `/app`

### Tarefas
- Criar layout protegido:
  - `src/app/(app)/layout.tsx`
  - `src/app/(app)/app/page.tsx`
- Implementar proteção de rota usando Supabase Auth.
- Criar página `/login`:
  - `src/app/login/page.tsx`
  - login com email/senha via Supabase.

### Redirecionamento pós-onboarding
- Substituir o `console.log` após onboarding completo.
- Redirecionar automaticamente para `/app`.

### Critério de aceite
- Usuário autenticado acessa `/app`.
- Usuário não autenticado é redirecionado para `/login`.

---

# ETAPA 2 — Definir Fonte Única da Verdade (business_config)

## Decisão obrigatória (MVP)
Extender `tenant_setting.business_config` para conter:

- services
- schedule
- staff
- holidays_attend
- closure_periods
- sequence_booking
- context_mode
- business_type

## Estrutura obrigatória do business_config

```json
{
  "services": [],
  "schedule": {},
  "staff": {},
  "holidays_attend": [],
  "closure_periods": [],
  "sequence_booking": {
    "allow": false,
    "eligible_service_ids": []
  },
  "context_mode": "booking",
  "business_type": "barbearia"
}

Tarefas

Criar migration (documental, JSONB) se necessário.

Atualizar migrateOnboardingToTenant para salvar:

schedule

staff

context_mode

business_type
dentro do tenant_setting.business_config.

Critério de aceite

Um tenant recém-criado possui todos esses dados persistidos.

ETAPA 3 — API interna do /app (bootstrap + settings)
3.1 Bootstrap

Criar endpoint:

GET /api/app/bootstrap

Deve retornar:

tenant

tenant_setting (incluindo business_config)

flow (apenas leitura)

Autenticar via Supabase server client.

3.2 Atualização de settings

Criar endpoint:

PATCH /api/app/settings

Regras:

Atualização parcial (merge).

Não permitir apagar campos críticos acidentalmente.

Critério de aceite

/app carrega os dados reais do tenant.

Alterações persistem no banco.

ETAPA 4 — Persistência de Agendamentos
Decisão

Criar tabela nova: appointment.

Estrutura da tabela

id (uuid, pk)

tenant_id (fk)

contact_id (fk, nullable)

conversation_id (fk, nullable)

service_ids (jsonb)

staff_id (nullable)

start_at (timestamptz)

end_at (timestamptz)

status (confirmed | cancelled | rescheduled)

created_at (timestamptz)

Criar índices:

tenant_id + start_at

conversation_id

Tarefas

Criar migration SQL.

Atualizar conversations-turn:

quando um booking for confirmado, inserir appointment.

garantir idempotência básica.

Critério de aceite

Booking confirmado gera registro persistido.

Fechar página não perde o agendamento.

ETAPA 5 — Tela /app/agenda
API

Criar endpoint:

GET /api/app/appointments

retorna próximos agendamentos por tenant.

UI

Criar:

src/app/(app)/app/agenda/page.tsx

Funcionalidades MVP:

Lista de agendamentos.

Cancelar agendamento (update status).

Critério de aceite

Usuário vê e cancela agendamentos reais.

ETAPA 6 — Tela /app/settings

Criar:

src/app/(app)/app/settings/page.tsx

Escopo:

services

schedule

staff

tone / handoff_mode

Regras:

Editar diretamente o business_config.

Salvar via PATCH.

Critério de aceite

Alterações impactam o simulador e futuros atendimentos.

ETAPA 7 — Simulador Real no /app

Criar:

src/app/(app)/app/simulator/page.tsx

Regras:

Reutilizar SimulatorPanel.

Context deve vir EXCLUSIVAMENTE do tenant_setting.business_config.

Booking deve persistir (ETAPA 4).

Critério de aceite

Simulador funciona sem onboarding.

Agendamentos são reais.

DEFINIÇÃO DE PRONTO (MVP)

/app autenticado funcionando

business_config como fonte única

agendamentos persistidos

agenda operacional

simulador usando dados reais


---

## ✅ Como usar no Cursor (passo a passo)

1. Crie o arquivo:  
   **`NEVO_APP_MVP.md`**
2. Cole **exatamente** o conteúdo acima
3. Abra o arquivo no Cursor
4. Diga algo como:

> *“Execute este plano no repositório atual, seguindo rigorosamente a ordem das etapas. Avance uma etapa por vez.”*

---

