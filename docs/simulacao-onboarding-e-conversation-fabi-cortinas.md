# Simulação: Onboarding e Conversation — Fabi Cortinas

Documento de simulação para uma loja que vende e instala cortinas, configurando **agendamento de visita**, **orçamento interno** (assistente pessoal do dono) e **orçamento externo** (estimativa para o cliente). Serve como referência para o fluxo completo após a implementação do branch `feature/assistente-pessoal-orcamento`.

---

# Parte 1 — Onboarding (configuração inicial)

Cenário: **Fabi** está cadastrando o negócio **Fabi Cortinas** no Nevo. Ela quer agendamento de visitas técnicas e orçamento (tanto para ela usar no dia a dia quanto para o cliente pedir estimativa).

---

## 1.1 Fluxo do onboarding (passo a passo)

| # | Step | Pergunta do Nevo | Resposta da Fabi |
|---|------|------------------|------------------|
| 1 | `business_type` | Qual o tipo do seu negócio (o que você faz/vende)? | Venda e instalação de cortinas residenciais e comerciais. |
| 2 | `business_name` | Entendi que você atua com **venda e instalação de cortinas**. Qual é o nome do seu negócio? | Fabi Cortinas |
| 3 | `context` | Você quer configurar **agendamento**, **orçamento** ou **ambos**? | **Ambos** |
| 4 | `services_list` | Pra montar a parte de **agendamento**, o que o cliente pode marcar? | Visita técnica, Medição, Instalação, Retirada de cortina antiga |
| 5 | `schedule_days` | Em quais dias da semana você atende? | Segunda a Sábado |
| 6 | `schedule_time` | Qual a faixa de horário que você atende? | 08:00 às 18:00 |
| 7 | `schedule_interval` | Qual o intervalo entre atendimentos? | 60 min |
| 8 | `services_duration` | Algum serviço tem duração diferente do padrão? | Visita técnica 60 min, Medição 30 min, Instalação 90 min, Retirada 30 min |
| 9 | `services_pricing` | Quer informar o valor de cada serviço (para agendamento)? | Pular por enquanto |
| 10 | `sequence_booking_offer` | O cliente pode agendar vários serviços na mesma visita ou um por agendamento? | Apenas um serviço por agendamento |
| 11 | `staff_mode` | Você atende sozinha ou tem outros colaboradores? | Só eu atendo |
| 12 | **`quote_services_list`** *(novo)* | Para **orçamento**, quais são seus principais serviços que podem ser orçados? | Cortina (residencial e comercial) |
| 13 | **`quote_service_pricing`** *(novo)* | Para **Cortina**, você cobra por m², metro linear, unidade ou sob consulta? | **Por m²** (área do vão) |
| 14 | **`quote_variables`** *(existente, refinado)* | Quais informações você precisa para fechar o orçamento de cortina? Ex.: medidas, modelo, tecido, instalação. | Largura, altura, quantidade de vãos, modelo (wave, ilhós, romana, rolô), tecido (voil, linho, blackout), instalação (sim/não) |
| 15 | **`quote_external_variables`** *(novo)* | Para o **cliente** pedir uma estimativa rápida, quais dados são suficientes? (recomendado: poucos) | Só largura e altura |
| **15b** | **`branding_offer`** *(opcional)* | Quando eu gerar o PDF do orçamento, você quer que ele saia com seu logo e dados da empresa? | **Sim, quero personalizar agora** / **Depois eu configuro** *(bloco condicional; ver seção Branding abaixo)* |
| 16 | `location_mode` | Serviço tem endereço fixo ou atende no endereço do cliente? | Atendo no endereço do cliente |
| 17 | `service_area` | Qual a região de atendimento? | São Paulo capital e Osasco |
| 18 | `address` | Para documentos/oficial, informe o endereço do estabelecimento (CEP primeiro). | [Formulário: CEP 01234-567, Rua X, 100, São Paulo, SP] |
| 19 | `policies` | Tem política de cancelamento ou sinal? | Não por enquanto |
| 20 | `tone_of_voice` | Qual tom de voz prefere que eu use? | Amigável |
| 21 | `handoff_mode` | Quando prefere que eu passe para um humano? | Condicional |
| 22 | `summary` | Resumo do que foi configurado. | **Está correto** |

*(Steps opcionais como feriados, fechamento, FAQ foram pulados na simulação.)*

### Após o simulador — Conectar WhatsApp

Após o usuário **testar o fluxo no simulador** e aprovar, o produto oferece no chat:

> Quer colocar o Nevo para funcionar no seu WhatsApp agora?
> - **Conectar agora** (por código)
> - **Depois**

O fluxo de conexão por **pairing code** (Evolution API, sem QR) está descrito no roadmap: **IMPLEMENTAÇÃO — Conectar WhatsApp no chat via Evolution API** (FASE 6.5). Apenas owner/admin (modo internal) pode iniciar; se pular (“Depois”), não trava e o usuário pode dizer depois “conectar whatsapp”.

---

## 1.2 O que é persistido ao final do onboarding

### A) Migração para tenant (já existente)

- **tenant** (nome, slug)
- **tenant_user** (owner, user_id, **phone_number** = NULL até vincular depois no app)
- **agent** (nome = "Fabi Cortinas", tenant_id, status = active)
- **agent_setting** (tone, handoff_mode, **business_config**)
- **flow** (agent_id, definition para booking)
- **variable** (se houver dynamic_variables)

### B) business_config (em agent_setting)

```json
{
  "business_name": "Fabi Cortinas",
  "business_type": "Venda e instalação de cortinas residenciais e comerciais",
  "context_mode": "both",
  "services": [
    { "name": "Visita técnica", "duration_minutes": 60 },
    { "name": "Medição", "duration_minutes": 30 },
    { "name": "Instalação", "duration_minutes": 90 },
    { "name": "Retirada de cortina antiga", "duration_minutes": 30 }
  ],
  "schedule": {
    "days_of_week": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
    "start_time": "08:00",
    "end_time": "18:00",
    "interval_minutes": 60
  },
  "staff": [{ "name": "Fabi", "use_business_schedule": true }],
  "establishment_address": { "cep": "01234567", "logradouro": "Rua X", "numero": "100", "bairro": "Centro", "localidade": "São Paulo", "uf": "SP" },
  "location_mode": "mobile",
  "service_area": "São Paulo capital e Osasco"
}
```

### Branding / Timbrado (opcional)

O timbrado **não** faz parte do fluxo principal do onboarding. Deve ser tratado como **bloco opcional** e **não pode aumentar a fricção inicial**.

**Bloco condicional (após configurar orçamento):**

Pergunta:

> Quando eu gerar o PDF do orçamento, você quer que ele saia com seu logo e dados da empresa?

Opções:

- **Sim, quero personalizar agora**
- **Depois eu configuro**

**Se escolher "Depois eu configuro":**

- `branding.enabled = false`
- Não coletar dados de logo/timbrado.
- Onboarding continua normalmente (ex.: location_mode, address, resumo).

**Se escolher "Sim, quero personalizar agora":**

Entrar em mini-fluxo separado:

1. Upload do logo (`requires_action: 'logo_upload'`)
2. Razão social
3. CNPJ
4. Telefone comercial
5. E-mail

Persistir em:

```json
business_config.branding = {
  "enabled": true,
  "logo_url": "...",
  "company_legal_name": "...",
  "cnpj": "...",
  "company_phone": "...",
  "company_email": "..."
}
```

**IMPORTANTE:**

- Esse bloco é **opcional**.
- Não impede a conclusão do onboarding.
- Pode ser configurado depois na área logada (/app).

---

### C) quote_service (novo — um registro por serviço de orçamento)

Criado para o **agent_id** da Fabi Cortinas.

**No onboarding apenas:**

- nome do serviço
- tipo de cobrança (m², linear, unidade, etc.)
- variáveis principais (para orçamento completo)
- variáveis externas (para faixa de estimativa)

**pricing_rules detalhadas** devem ser:

- criadas com **valores default simples** (ex.: placeholders por tipo), ou
- configuradas **depois na área logada** (/app).

**Nota:** O onboarding não deve coletar regras complexas de precificação para evitar fricção.

| Campo | Valor |
|-------|--------|
| id | uuid |
| agent_id | id do agente Fabi Cortinas |
| name | Cortina |
| pricing_type | area |
| **variables_schema** | Ver JSON abaixo |
| **pricing_rules** | Ver JSON abaixo |
| **external_variable_keys** | ["largura_cm", "altura_cm"] *(variáveis usadas só no fluxo external para faixa)* |
| keywords | ["cortina", "cortinas", "tecido", "wave", "blackout", "instalação"] |
| active | true |

**variables_schema (internal — todas as variáveis):**

```json
[
  { "key": "largura_cm", "type": "number", "min": 30, "max": 1200, "required": true, "label": "Largura (cm)" },
  { "key": "altura_cm", "type": "number", "min": 30, "max": 600, "required": true, "label": "Altura (cm)" },
  { "key": "quantidade_vaos", "type": "number", "min": 1, "default": 1, "label": "Quantidade de vãos" },
  { "key": "modelo", "type": "enum", "options": ["wave", "ilhos", "romana", "rolo"], "required": true, "label": "Modelo" },
  { "key": "tecido", "type": "enum", "options": ["voil", "linho", "blackout", "tela_solar"], "required": true, "label": "Tecido" },
  { "key": "inclui_instalacao", "type": "boolean", "required": true, "default": true, "label": "Inclui instalação" }
]
```

**pricing_rules (exemplo simplificado):**

```json
{
  "preco_tecido_m2": { "voil": 90, "linho": 180, "blackout": 220, "tela_solar": 260 },
  "preco_trilho_m": { "wave": 120, "ilhos": 80, "romana": 160, "rolo": 220 },
  "franzimento": { "wave": 2.0, "ilhos": 2.0, "romana": 1.3, "rolo": 1.1 },
  "instalacao_por_vao": 180,
  "confeccao_por_m2": 45
}
```

*(O cálculo real em calculateQuote usaria essas regras de forma determinística.)*

---

## 1.3 O que a conversation (turn) recebe em runtime

- **context** (montado pelo webhook ou pela Edge Function a partir de tenant/agent):
  - `business_name`, `business_type`, `context_mode`, `schedule`, `staff`, `services`, `establishment_address`, etc. (já hoje).
  - **Novo:** quando for fluxo de orçamento, o turn precisa dos **quote_services** do agente (ou ao menos do serviço detectado). Forma recomendada: **carregar na Edge Function** os `quote_service` do `agent_id` (variables_schema, pricing_rules, external_variable_keys, keywords) e usar em memória para extrair slots, validar e calcular. Opcional: enviar um resumo no context (ex.: lista de nomes + keys das variáveis externas) para a IA.
- **conversation.context** (após resolveActor): `mode` (internal | external), `actor_type` (owner | admin | client | unknown).

---

# Parte 2 — Simulação da conversation na prática

Cenário: o WhatsApp do negócio é **+55 11 90000-0000**. A Fabi (dona) está cadastrada com o número **+55 11 98888-8888** em `tenant_user.phone_number`. Um cliente, **Carlos**, envia mensagem do número **+55 11 97777-7777**.

---

## 2.1 Cenário A — Dono (modo internal): assistente pessoal

Todas as mensagens abaixo vêm de **11988888888** (Fabi). O webhook identifica owner → `mode = internal`, `actor_type = owner`.

---

### A.1 Consulta de agenda

**Fabi:** Quais são meus agendamentos de hoje?

**Nevo (turn):**  
- resolveActorByPhone → internal.  
- Intent: `query_appointments_today`.  
- Busca: appointment onde tenant_id + agent_id, start_at entre hoje 00:00 e 23:59, status != cancelled.  
- Ordena por start_at.

**Resposta:**  
📅 Hoje:  
09:00 – Ana (Visita técnica)  
14:00 – Carlos (Medição)

---

### A.2 Contato por horário

**Fabi:** Me passa o contato do agendamento das 14h.

**Nevo:**  
- Intent: `query_contact_by_appointment_time`.  
- Janela ±20 min (13:40–14:20).  
- Encontra Carlos → contact.phone, contact.display_name.

**Resposta:**  
📞 14:00 – Carlos  
WhatsApp: (11) 97777-7777

---

### A.3 Orçamento completo (mensagem livre) + PDF

**Fabi:** Faz um orçamento de cortina 2,80 x 2,60 blackout wave com instalação.

**Nevo:**  
1. Intent: orçamento internal (request_quote_internal).  
2. IA extrai slots: largura_cm=280, altura_cm=260, tecido=blackout, modelo=wave, inclui_instalacao=true. quantidade_vaos não informado → usa default 1.  
3. validateSlots(quote_service, slots) → OK.  
4. calculateQuote(quote_service, slots) → calculation_result + total_value.  
5. formatInternalQuote() → mensagem com breakdown.  
6. Resposta pede confirmação para gerar PDF.

**Resposta:**  
📄 Orçamento — Cortina Wave  
Medidas: 2,80 m x 2,60 m (1 vão)  
Tecido: Blackout  
Modelo: Wave  
Instalação: Sim  

Materiais (tecido + trilho): R$ 1.420  
Confecção: R$ 327  
Instalação: R$ 180  

**Total: R$ 1.927**  

Deseja gerar o PDF do orçamento?

**Fabi:** Sim.

**Nevo:**  
- Verifica `branding.enabled` (business_config.branding).
- Se `true` → generatePdf() com template timbrado (logo, razão social, CNPJ, etc.).
- Se `false` → generatePdf() com template padrão Nevo (sem logo/timbrado).
- Persiste request; internal_action_log; envia link do PDF.

**Resposta (quando branding.enabled = true):**  
✅ PDF gerado. Link para download (válido por 7 dias): [Signed URL].  
Orçamento salvo no histórico.

**Resposta (quando branding.enabled = false — primeiro PDF ou nunca configurou):**  
✅ PDF gerado. Link para download (válido por 7 dias): [Signed URL].  
Orçamento salvo no histórico.  

Quer deixar esse orçamento mais profissional com seu logo e dados da empresa? Posso configurar agora.

*(Segunda oportunidade de configurar branding; não bloqueia o uso.)*

---

### A.4 Criar agendamento (internal)

**Fabi:** Agenda visita técnica para o Carlos amanhã às 10h.

**Nevo:**  
- Intent: `create_appointment_internal`.  
- IA extrai: data=amanhã, hora=10:00, serviço=Visita técnica, nome/contato=Carlos.  
- Valida: data/hora presentes, dentro do schedule, sem conflito.  
- Busca/cria contact Carlos.  
- Mostra resumo e pede confirmação.

**Resposta:**  
📅 Resumo: Visita técnica para Carlos, amanhã às 10:00. Confirmar?

**Fabi:** Confirma.

**Nevo:** Insere appointment (tenant_id, agent_id, contact_id=Carlos, start_at, end_at, status=confirmed). Responde: ✅ Agendamento confirmado para Carlos, amanhã às 10:00.

---

## 2.2 Cenário B — Cliente (modo external): estimativa rápida

Todas as mensagens abaixo vêm de **11977777777** (Carlos). O webhook identifica que não é tenant_user → `mode = external`, `actor_type = client` (ou unknown até existir contact).

---

### B.1 Primeira mensagem (estimativa em faixa)

**Carlos:** Quanto fica uma cortina 2,80 x 2,60?

**Nevo:**  
1. resolveActorByPhone → external.  
2. Intent de orçamento external (price_inquiry / request_quote_external).  
3. Detectar serviço: keywords "cortina" → quote_service "Cortina".  
4. Variáveis para external: só largura e altura (external_variable_keys). IA ou extração: largura_cm=280, altura_cm=260.  
5. calculateRange(quote_service, { largura_cm: 280, altura_cm: 260 }) → min/max (ex.: 1.650 a 2.200).  
6. formatExternalQuote() → mensagem curta + CTA.

**Resposta:**  
Para esse tamanho (2,80 m x 2,60 m), o investimento costuma ficar entre **R$ 1.650 e R$ 2.200**, conforme modelo e tecido.  
Posso agendar uma visita técnica para medir e fechar o valor exato? É rápido. 😊

**Carlos:** Pode agendar.

**Nevo:**  
- Fluxo de agendamento (booking): qual serviço → Visita técnica; data/hora; confirmação.  
- Cria appointment e contact se necessário.  
- Persiste request com is_estimated=true, total_value=média da faixa (ex.: 1925).

---

### B.2 Cliente tenta comando interno (deve ser bloqueado)

**Carlos:** Quais são meus agendamentos de hoje?

**Nevo:**  
- mode = external.  
- Intent pode ser interpretada como booking (querer agendar). Nunca executar query_appointments_today para client.  
- Resposta genérica de atendimento.

**Resposta:**  
Posso te ajudar a agendar uma visita ou tirar dúvidas sobre nossos serviços. O que você prefere?

*(Nunca mostra a agenda real.)*

---

# Parte 3 — Resumo do que vai para onde

| Onde | O quê |
|------|--------|
| **Onboarding** | business_type, business_name, context (agendamento + orçamento), services (agendamento), schedule, staff, **lista de serviços de orçamento**, **tipo de preço por serviço** (m², linear, etc.), **quote_variables** (lista para internal), **quote_external_variables** (poucas, para faixa), **branding opcional** (pergunta condicional; se "Sim", mini-fluxo logo + razão social + CNPJ + contato), localização, tom, handoff, resumo. |
| **Migração / app** | Cria/atualiza **quote_service** por agente (name, pricing_type, variables_schema, pricing_rules com defaults ou editável depois, external_variable_keys, keywords). **Branding** pode ser configurado depois na área logada. |
| **Conversation (turn)** | **context:** business_config (já hoje) + mode/actor_type (após resolveActor). **Runtime:** Edge Function carrega quote_services do agent_id para orçamento (validateSlots, calculateQuote, calculateRange). Não é obrigatório enviar variables_schema inteiro no context; basta ter no backend para validação e cálculo. |

---

# Princípio de ativação

O onboarding deve:

1. **Permitir funcionamento básico em menos de 3 minutos** — agendamento + estimativa simples operando logo.
2. **Não exigir dados fiscais ou branding obrigatórios** — CNPJ e timbrado são opcionais.
3. **Priorizar agendamento + estimativa simples** — foco em ativar valor rápido.
4. **Permitir profissionalização posterior** — branding, pricing_rules detalhadas e dados fiscais na área logada ou no segundo momento (ex.: oferta ao gerar o primeiro PDF).

---

# Fim da simulação

Este documento pode ser usado para validar o fluxo de onboarding e de conversation (internal e external) contra a implementação no branch `feature/assistente-pessoal-orcamento`.


Ótimo. Eu li a simulação inteira 

simulacao-onboarding-e-conversa…

 e vou te responder direto ao ponto.

✅ 1. Ele NÃO se confundiu sobre o WhatsApp do dono

Pelo que está descrito na Parte 2 da simulação:

WhatsApp do negócio: +55 11 90000-0000
Dona (Fabi): +55 11 98888-8888
Cliente: +55 11 97777-7777

O documento assume exatamente o modelo que fechamos:

Cliente fala com o número da empresa

Dona fala com o número da empresa

O sistema diferencia por tenant_user.phone_number

Ou seja:

✔️ É o mesmo número para todos.
✔️ O modo internal é ativado apenas porque o telefone da Fabi está cadastrado como owner.
✔️ Não existe número global do Nevo na simulação.

Isso está correto e alinhado com o que você queria:
100% WhatsApp, sem app e sem número extra.

🧠 2. O modelo está conceitualmente correto?

Sim. E está surpreendentemente coerente.

Ele respeitou:

context.mode = internal | external

state.mode = booking | quote

Não misturou slots de orçamento com agendamento

Não duplicou tabela request

Não reutilizou blueprint

Não colocou lógica sensível na IA

Arquiteturalmente, está maduro.

🎯 3. Pontos fortes da simulação
🔹 Internal (dono)

Muito bom:

Consulta agenda

Consulta contato por horário

Orçamento livre + confirmação

Geração de PDF

Criação de agendamento com confirmação

Isso já posiciona o Nevo como assistente operacional real.

🔹 External (cliente)

Muito bem feito:

Estimativa por faixa

Poucas variáveis

CTA direto para visita

Persistência como is_estimated = true

Cliente não acessa agenda

Fluxo de conversão está correto.

⚠️ 4. Pontos que eu ajustaria (refinamento estratégico)

Agora vou entrar na parte crítica.

🔴 Ajuste 1 — Overload do número da empresa

Mesmo sendo o mesmo número, pense no seguinte:

Se a Fabi está no WhatsApp Business da empresa, ela pode:

Receber mensagem do cliente

E ao mesmo tempo mandar mensagem para o Nevo (modo internal)

Isso pode gerar duas situações:

Ela está usando o mesmo chat para falar com cliente e usar comando interno.

Ela pode mandar mensagem privada para o número dela mesma (caso use outro celular).

A simulação assume que ela manda mensagem do número pessoal para o número da empresa.

Isso é o modelo mais seguro:

📌 Dona usa o número pessoal dela
📌 Cliente usa o número dele
📌 Ambos falam com o número da empresa

Isso é o ideal.

Se ela usar o mesmo número do negócio para falar com o Nevo, não funciona (porque o webhook não recebe mensagem “de si para si”).

Então o modelo real precisa ser:

Empresa tem número A

Dona tem número B (pessoal)

Cliente tem número C

Isso está implícito no documento e está correto.

🔴 Ajuste 2 — Orçamento internal sempre pede confirmação

Está certo para MVP.

Mas no mundo real o dono pode querer:

"Gera PDF direto."

No futuro você pode permitir:

Modo rápido (sem confirmação)

Ou “confirmar implícito” se não houver conflito

Mas para MVP, manter confirmação é prudente.

🔴 Ajuste 3 — Rate limit não aparece na simulação

Na Parte 2 ele não menciona comportamento se Fabi disparar 30 comandos.

Não é erro, mas o documento poderia incluir um cenário de proteção.

Arquiteturalmente está ok, só faltou ilustrar.

🔴 Ajuste 4 — Persistência de quote_service no onboarding

Aqui tem um detalhe estratégico importante.

O documento diz:

Pode ser criado na migração do onboarding ou em tela no app; aqui assumimos que o onboarding persiste o primeiro serviço.

⚠️ Isso pode ficar pesado demais no onboarding.

Minha recomendação real:

Onboarding cria apenas estrutura básica.

Configuração detalhada de pricing_rules deve ficar na área do cliente.

No onboarding você coleta:

nome do serviço

tipo de preço

variáveis

Mas não pricing_rules detalhado.

Senão o onboarding vira técnico demais.

💡 5. O modelo do WhatsApp do dono está correto?

Sim.

E a lógica é esta:

Número	Papel
+55 11 90000-0000	WhatsApp da empresa (instância agent)
+55 11 98888-8888	Dona (owner)
+55 11 97777-7777	Cliente

Ambos enviam mensagens para 90000-0000.

O webhook resolve pelo from.

Isso está alinhado com tudo que desenhamos.

Você não precisa de número global do Nevo.

📊 6. Avaliação final da simulação

Arquitetura: 9/10
Separação de responsabilidades: 10/10
Multi-tenant: correto
Segurança: correta
Fluxo de conversão: correto
Risco estrutural: baixo

A única coisa que eu simplificaria é o nível de detalhamento do orçamento já no onboarding.

🎯 Minha conclusão

A simulação está tecnicamente sólida.

Ela não confundiu o WhatsApp do dono.

Ela implementa exatamente o modelo que você queria:

Atendimento automático

Assistente pessoal no mesmo número

Segurança por telefone

Orçamento internal completo

Orçamento external simplificado

Se você seguir essa linha, o Nevo deixa de ser “chatbot” e vira:

Assistente operacional via WhatsApp para microempresário.

E isso é um posicionamento muito forte.