# Sequência do fluxo de onboarding

Documento de referência: ordem das perguntas, tipo de resposta esperada e onde cada etapa é tratada (backend = Edge Function `onboarding-chat`, frontend = LandingChat + componentes).

---

## 1. Fase inicial (antes do fluxo de negócio)

| Ordem | Step (chave) | Pergunta / ação | Tipo de resposta | Onde |
|-------|----------------|------------------|------------------|------|
| 0 | `welcome` | Mensagem de boas-vindas ou tutorial (quando o usuário demonstra dúvida: "não sei o que fazer", "por onde começo"). | Texto livre (ou nenhum – só leitura) | Backend: `buildIntroTutorialMessage()`; frontend exibe mensagem do assistente. |
| - | (dúvida) | Usuário pergunta algo genérico (ex.: "posso cadastrar serviços?"). Resposta fluida por IA + opcionalmente tutorial. | Texto livre | Backend: `classifyNeedsIntroTutorial` + `answerDoubtWithAI`; `next_step` pode ir para `business_type` ou `collect_free_text`. |

---

## 2. Cadastro de conta (quando o backend pede criação de conta)

Esses steps aparecem quando o usuário ainda não está logado e o fluxo chega em um ponto que exige conta (ex.: após resumo ou quando a sessão indica signup).

| Ordem | Step | Pergunta / ação | Tipo de resposta | Onde |
|-------|------|------------------|------------------|------|
| S1 | `signup_email` | Coleta do **email** para criar conta. | Email (formulário; não exibido em texto no chat) | Frontend: `SignupCard`; envia `sendOnboardingMessage(sessionId, payload.email, 'signup_email')`. |
| S2 | `signup_password` | Coleta da **senha**. | Senha (formulário) | Frontend: `SignupCard`; envia mensagem com password em `signup_password`. |
| S3 | `signup_confirm_password` | Confirmação da senha. | Confirmação de senha (formulário) | Frontend: `SignupCard`. |

Após cadastro concluído: opções "Acessar minha área" e "Simular atendimento" (frontend).

---

## 3. Fluxo principal de configuração do negócio (flow-manager.ts)

Ordem exata definida por `determineNextStep()`. Campos faltantes e `context` (Agendamento / Orçamento / Ambos) determinam o próximo step.

| Ordem | Step | Pergunta (resumo) | Tipo de resposta | Observação |
|-------|------|-------------------|------------------|------------|
| 1 | `business_type` | Qual o tipo do seu negócio (o que você faz/vende)? Ex.: design de sobrancelhas, barbearia, loja de cortinas. | **Texto livre** | Pode ser extraído por IA (tipo + segmento + nome + serviços iniciais). |
| 2 | `business_name` | Entendi que você atua com **{business_type}**. Qual é o nome do seu negócio? | **Texto livre** | |
| 3 | `context` | Você quer configurar primeiro **agendamento**, **orçamento** ou **ambos**? | **Botões**: Agendamento, Orçamento, Ambos | `requires_action: 'context'` |
| 4 | `services_list` | Pra montar a parte de **agendamento**, o que o cliente pode marcar? Selecione ou adicione. | **Checkboxes** (exemplos por segmento) + texto para adicionar outros | `selectable_options` gerados por `buildServiceSelectableOptions(serviceExamples)` |
| 5 | `schedule_days` | Em quais **dias da semana** você atende? | **Checkboxes** (dias da semana) | `requires_action: 'schedule_days'` |
| 6 | `schedule_time` | Qual a **faixa de horário** que você atende? (ex.: 08:00 às 18:00) | **Botões** (08:00–18:00, 09:00–18:00, …) ou "Outro horário" | `requires_action: 'schedule_time'` |
| 7 | `schedule_interval` | Qual o **intervalo entre atendimentos**? | **Botões**: 15 min, 30 min, 45 min, 60 min, Outro intervalo | `requires_action: 'schedule_interval'` |
| 8 | `services_duration` | Algum serviço tem duração diferente do padrão? Ajuste abaixo. | Ajuste por serviço + **Botão** "Continuar" | `requires_action: 'services_duration'` |
| 9 | `services_pricing` | Quer informar o **valor** de cada serviço? | **Botões**: Informar valores, Pular por enquanto | |
| 10 | `sequence_booking_offer` | O cliente pode agendar **vários serviços na mesma visita** (em sequência) ou **um por agendamento**? | **Botões**: Apenas um serviço por agendamento / Sim, pode agendar em sequência | |
| 11 | `sequence_services_select` | (Se sequência) Quais serviços podem ser combinados? Selecione. | **Checkboxes** (lista de serviços) | Só se `allow_sequence_booking === true` |
| 12 | `staff_mode` | **Você** atende sozinho ou tem outros colaboradores? | **Botões**: Só eu atendo / Eu e outros colaboradores | |
| 13 | `staff_schedule_mode` | (Por colaborador) A agenda de **{nome}** é a mesma do estabelecimento ou horário próprio? | **Botões**: Mesmo horário do estabelecimento / Horário próprio | Repetido para cada membro de `staff` |
| 14 | `staff_schedule_days` | Em quais dias **{nome}** atende? | **Checkboxes** (dias) | Se horário próprio |
| 15 | `staff_schedule_time` | Faixa de horário que **{nome}** atende? | **Texto** (ex.: 08:00 às 18:00) | |
| 16 | `staff_schedule_interval` | Intervalo entre atendimentos para **{nome}**? | **Botões**: 15 min, 30 min, 45 min, 60 min, Outro intervalo | |
| 17 | `quote_variables` | (Se orçamento) Quais informações você precisa que o cliente informe para orçamento? Ex.: medidas, quantidade, material, cor. | **Texto livre** | Só se `context === 'quote'` ou `'both'` |
| 18 | `location_mode` | Serviço tem **endereço fixo** ou **atende no endereço do cliente**? | **Botões**: Tenho endereço fixo / Atendo no endereço do cliente | |
| 19 | `address` | Informe o endereço do estabelecimento. Comece pelo CEP. | **Formulário**: CEP, logradouro, número, complemento, bairro, localidade, UF | Frontend: `AddressForm`; `requires_action === 'address'` |
| 20 | `service_area` | (Se atende no cliente) Qual a **região de atendimento**? Ex.: Osasco e região, São Paulo capital. | **Texto livre** | Só se `location_mode === 'mobile'` |
| 21 | `policies` | Tem **política de cancelamento** ou **sinal**? | **Botões**: Não por enquanto / Tenho política | |
| 22 | `tone_of_voice` | Qual **tom de voz** prefere que eu use? | **Botões**: Formal, Amigável, Profissional, Engraçado | |
| 23 | `handoff_mode` | Quando prefere que eu **passe para um humano**? | **Botões**: Sempre humano / Condicional (alguns casos) / Automático | |
| 24 | `holidays_offer` | Sobre **feriados nacionais**: atende em algum? | **Botões**: Atendo todos / Sim quero marcar / Não atendo / Pular por enquanto | Opcional |
| 25 | `closure_offer` | Tem **período de férias** ou fechamento planejado? (ex.: 20/12 a 05/01) | **Botões**: Sim tenho período / Não / Pular por enquanto | Opcional |
| 26 | `faq_offer` | Quer cadastrar **perguntas frequentes** agora? | **Botões**: Sim quero adicionar / Não, pular | Opcional |
| 27 | `summary` | Resumo do que foi configurado. | **Botões**: Está correto / Quero ajustar | `generateSummary()`; `requires_action: 'summary_confirmation'` |

---

## 4. Resposta da API (padrão)

Cada resposta do backend (`/api/onboarding` → Edge Function `onboarding-chat`) pode incluir:

| Campo | Uso |
|-------|-----|
| `assistant_message` | Texto exibido no chat. |
| `next_step` | Próximo step (ex.: `business_type`, `schedule_days`, `summary`). |
| `requires_action` | Indica como o frontend deve responder: ex. `address` → mostrar formulário de endereço; `schedule_days` → checkboxes; `context` → botões. |
| `action_options` | Lista de opções para botões (ex.: Agendamento, Orçamento, Ambos). |
| `selectable_options` | Lista para checkboxes (ex.: dias da semana, serviços). |
| `editable_items` | Itens para edição no resumo (ex.: tipo de negócio, nome, contexto). |

---

## 5. Tipos de resposta no frontend (resumo)

| Tipo | Componente / UI | Exemplos de step |
|------|------------------|-------------------|
| Texto livre | Campo de mensagem do chat (input + enviar) | `business_type`, `business_name`, `service_area`, `quote_variables` |
| Botões | Botões gerados a partir de `action_options` | `context`, `schedule_time`, `schedule_interval`, `staff_mode`, `tone_of_voice`, `handoff_mode`, etc. |
| Checkboxes | Lista a partir de `selectable_options` | `services_list`, `schedule_days`, `staff_schedule_days`, `sequence_services_select` |
| Formulário de endereço | `AddressForm` (CEP, logradouro, número, bairro, cidade, UF) | `address` |
| Formulário de cadastro | `SignupCard` (email, senha, confirmação) | `signup_email`, `signup_password`, `signup_confirm_password` |
| Resumo editável | Itens clicáveis para editar + botões Está correto / Quero ajustar | `summary` |

---

## 6. Ordem condicional (contexto)

- Se **Agendamento** ou **Ambos**: perguntas de serviços, agenda (dias, horário, intervalo), duração, preços, sequência, equipe (staff), localização, políticas, tom, handoff, feriados, fechamento, FAQ, resumo.
- Se **Orçamento**: além do que for compartilhado (tipo, nome, contexto), entra `quote_variables` (variáveis para orçamento); depois localização, políticas, tom, handoff, resumo.
- Steps de **staff** (modo, horário por pessoa) repetem para cada colaborador até todos estarem configurados.

---

*Fonte: `supabase/functions/onboarding-chat/flow-manager.ts` (determineNextStep), `onboarding-chat/index.ts`, `src/components/onboarding/LandingChat.tsx`, `src/types/onboarding.ts`.*
