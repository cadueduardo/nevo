Perfeito. Li seu snapshot de arquitetura e estado atual 

arquitetura-e-estado-atual

 — e ele mostra uma base muito bem estruturada para dar o próximo passo: transformar o Nevo de “agenda-first” para “agenda + orçamento-first”, sem quebrar o princípio da IA como consierge + execução determinística.

Agora vou estruturar isso de forma arquitetural, não superficial.

🎯 Primeiro: qual é a diferença estrutural entre AGENDAMENTO e ORÇAMENTO no Nevo?

Hoje o agendamento está assim:

intenção → qualificação → calendário → confirmação → appointment

Ele termina numa entidade forte: appointment.

Orçamento precisa terminar em outra entidade forte.
Hoje você já tem algo promissor:

request (conversation_id, status, slots, preco_estimado)

Essa tabela é o embrião correto para orçamento.

🧠 O grande erro que você pode cometer

Tentar tratar orçamento como:

“um flow parecido com agendamento”

ou “uma mensagem com preço calculado”

Isso seria frágil.

Orçamento precisa ser:

Estruturado

Variável por domínio

Reprocessável

Versionável

Auditável

🏗️ Proposta Arquitetural para Orçamento no Nevo
1️⃣ Criar um modelo mental: Orçamento é um “pipeline determinístico de cálculo”

Enquanto o agendamento termina num horário,
o orçamento termina num cálculo.

Pipeline ideal:
Intenção detectada (IA)
→ Selecionar blueprint de orçamento
→ Coletar variáveis
→ Validar regras
→ Calcular preço
→ Persistir request
→ Enviar resposta estruturada
→ (opcional) gerar proposta formal
📦 Estrutura de Dados Recomendada

Você já tem:

request

Eu recomendo evoluir para:

request

id

tenant_id

agent_id

conversation_id

blueprint_id

status (collecting | calculated | sent | approved | rejected)

slots (JSONB)

calculation_result (JSONB)

total_value (numeric)

currency

created_at

request_item (opcional se quiser granular)

request_id

label

quantity

unit_price

subtotal

🧩 Como integrar com o modelo atual de Flow?

Você já tem:

flow (definition JSONB)
variable (slots por flow)
blueprint

Minha sugestão:

Criar um novo tipo de flow:
flow.type = 'booking' | 'quote'

Ou manter dois fluxos separados por agente:

flow_booking

flow_quote

Eu prefiro:

flow.type

Porque mantém escalável.

🧠 Papel da IA no orçamento

IA NÃO calcula preço.

IA apenas:

Detecta intenção

Extrai valores livres

Classifica contexto

Exemplo:

Usuário:

"Quero orçamento para 200 metros de forro PVC"

IA responde:

intent: request_quote
extracted:
  metragem: 200
  material: "forro pvc"
confidence: 0.94

Depois disso:

⚠️ Código determinístico faz:

validação

cálculo

regras de negócio

🧮 Onde entra a lógica de cálculo?

Sugestão limpa:

Criar um módulo:

src/lib/quote-engine/

Com:

parseInput.ts
validateSlots.ts
calculateQuote.ts
formatQuoteMessage.ts

A Edge Function conversations-turn chama esse módulo quando:

intent === "request_quote"
📊 Tipos de Orçamento que o Nevo precisa suportar

Existem 3 grandes modelos:

1️⃣ Preço fixo por item

Ex:

Corte de cabelo = R$ 60

Progressiva = R$ 250

Fácil.

2️⃣ Preço por variável linear

Ex:

R$ 45 por metro

R$ 10 por convidado

R$ 120 por hora

Modelo:

total = variável * preço_unitário
3️⃣ Fórmula composta

Ex:

Base fixa + variável

Faixas de desconto

Múltiplos itens

Taxa de deslocamento

Modelo:

total = base
      + (variável1 * valor1)
      + (variável2 * valor2)
      - desconto_condicional

Esse modelo precisa ser suportado desde o início.

🧱 Como representar isso no banco?

Você já tem blueprint.

Eu criaria:

quote_blueprint

id

agent_id

name

variables (JSONB)

pricing_rules (JSONB)

output_template (string)

Exemplo de pricing_rules:

{
  "type": "linear",
  "base_price": 0,
  "unit_price": 45,
  "variable_key": "metragem"
}

Ou:

{
  "type": "formula",
  "expression": "base + (metros * valor_metro) + taxa_deslocamento"
}

E o cálculo é feito via parser seguro (nunca eval direto).

🧭 UX: como o usuário configura isso no dashboard?

Você vai precisar de uma tela nova:

/app/orcamentos

Mobile-first, como sua agenda.

📱 Referência Visual 1 – Tabela clara e objetiva
4

Aqui a ideia é:

Lista de orçamentos

Status

Valor total

Botão para ver detalhes

📱 Referência Visual 2 – Editor de regras simples
4

Você pode fazer algo estilo:

[ Variável ] x [ Valor ]
[ + adicionar taxa ]
[ + adicionar desconto ]

Sem expor JSON ao usuário.

🔄 Como orçamento conversa com agendamento?

Esse é o ponto estratégico.

Você pode permitir:

Orçamento aprovado → botão → Agendar

Ou:

Durante orçamento → oferecer agendamento

Isso conecta os dois pipelines.

🧠 Decisão Estratégica Importante

Você precisa decidir:

O Nevo vai:

A) Apenas calcular e responder preço?
ou
B) Gerar proposta formal (PDF, link, etc.)?

Se for B:

Você precisa:

gerar documento

salvar versão

permitir reenvio

🚀 Minha sugestão de evolução incremental
Fase 1 – MVP de Orçamento

Intent detection

Coleta de variáveis

Cálculo linear simples

Persistir request

Enviar resposta estruturada

Sem PDF.
Sem múltiplos itens.
Sem fórmula complexa.

Fase 2 – Engine Avançada

Fórmulas compostas

Itens múltiplos

Descontos

Taxas

Fase 3 – Proposta Formal

Geração PDF

Link público

Status aprovado/rejeitado

Conversão para agendamento

📌 Perguntas estratégicas para você

Você quer que o orçamento seja:

único por conversa?

ou múltiplos por conversa?

Ele pode ser recalculado depois?

Você quer permitir edição manual do valor?

O cliente pode aprovar pelo WhatsApp?

💬 Minha opinião direta

Se você estruturar orçamento como:

“um mini motor determinístico de cálculo, com blueprint por agente”

Você transforma o Nevo num sistema muito mais poderoso do que só agenda.

E isso posiciona como:

SaaS de atendimento

SaaS de conversão

SaaS de pré-venda automatizada

Se quiser, no próximo passo eu posso:

Desenhar a estrutura exata da quote-engine

Ou propor a migration SQL ideal

Ou modelar o fluxo completo do conversations-turn para orçamento

Qual desses você quer aprofundar agora?

Fontes
por exemplo, o sistema de agendamento ele é dinamico de tal forma que pode configurar qualquer ramo de atividade ali, ok, isso está sendo bem refinado. Porém orçamento, ele tem N variáveis de acordo com o ramo de atividade. Vamos supor se a empresa é de venda e instalação de cortinas seja residenciais ou comerciais. Para fluir um orçamento, ele precisa de variáveis especificas do negócio.
Ex: Medidas precisas, Tipo de Suporte e Fixação, Modelo da Cortina, Condições do Local, etc... e cada tipo de negócio irá contar com o seu motor de calculo, concorda. Consegue simular caso o sistema de orçamento fosse para o ramo de cortinas?

Concordo — orçamento é “domínio-específico” por natureza. O que dá pra deixar genérico é o framework (coleta → valida → calcula → apresenta), mas as variáveis + regras de cálculo mudam por ramo.

Abaixo vai uma simulação bem realista para cortinas (venda + instalação), já no formato “motor determinístico + IA só pra extrair/classificar”.

1) Blueprint de orçamento: Cortinas
Variáveis (slots) típicas

Identificação do ambiente

tipo_ambiente: residencial | comercial

ambiente: sala | quarto | escritório | etc

cidade_bairro (impacta deslocamento)

Medidas

largura_cm (número)

altura_cm (número)

quantidade_vãos (número)

tipo_instalacao: teto | parede | vão/embutido

Modelo e materiais

modelo_cortina: wave | ilhós | prega_macho | romana | rolô | painel | blackout | etc

tecido: voil | linho | blackout | tela_solar | etc

forro_blackout: sim | não

nivel_transparencia: translúcida | semi | blackout

trilho_varao: trilho_suiço | trilho_wave | varão | rolô_mecanismo

Suporte e fixação

tipo_parede: alvenaria | drywall | madeira | vidro

altura_trabalho: até_3m | 3a5m | acima_5m

necessita_andaime: sim | não

Serviço

inclui_instalacao: sim | não

prazo_urgente: sim | não

visita_tecnica: sim | não (às vezes obrigatória)

Qualidade do dado

medida_confirmada: sim | não (se não, vira orçamento “estimado”)

2) Regras de cálculo (motor) — exemplo simples, mas completo
Cálculos base

Largura de tecido (com franzimento/onda)

fator_franzi por modelo:

wave: 2.0

ilhós: 2.0

prega_macho: 2.5

rolô: 1.1 (quase sem franzir)

largura_tecido_m = (largura_cm/100) * fator_franzi * quantidade_vãos

Altura de tecido

altura_tecido_m = (altura_cm/100) + barra
(barra pode variar por modelo; ex.: 0.20 m)

Área efetiva

area_m2 = largura_tecido_m * altura_tecido_m

Preço de material

preco_tecido_m2 depende de tecido e nivel_transparencia

preco_blackout_m2 se forro_blackout = sim

preco_trilho_m depende de trilho_varao

Mão de obra e adicionais

instalação: valor fixo por vão + adicional por altura (acima de 3m) + adicional por tipo de parede (drywall etc)

deslocamento: por bairro/cidade (ou faixa)

urgência: % sobre mão de obra (ou total)

Resultado

total = materiais + instalação + adicionais

devolver também “faixa” se medida não confirmada

3) Simulação de conversa (WhatsApp)

Cliente: Oi! Queria um orçamento de cortina pra minha sala.

Nevo: Perfeito — pra eu calcular certinho, é residencial ou comercial?

Cliente: Residencial.

Nevo: Beleza. Quantos vãos/janelas vão receber a cortina?

Cliente: Só 1.

Nevo: Me passa as medidas desse vão: largura e altura (pode ser em cm).

Cliente: 280 de largura e 260 de altura.

Nevo: Obrigado. Qual modelo você prefere: wave, ilhós, romana ou rolô?

Cliente: Wave.

Nevo: E o tecido: você quer algo mais leve (voil/linho) ou blackout pra escurecer?

Cliente: Quero blackout mesmo.

Nevo: Certo. A instalação seria no teto ou na parede?

Cliente: No teto.

Nevo: Última: sua parede/teto é alvenaria ou drywall?

Cliente: Alvenaria.

Nevo (resposta final):
Perfeito. Com 280x260 (1 vão), modelo wave com blackout, trilho de teto e instalação em alvenaria, eu tenho esse orçamento:

Materiais (tecido + trilho): R$ X

Confecção: R$ Y

Instalação: R$ Z
Total estimado: R$ T

Se você quiser, eu já agendo uma visita técnica pra confirmar medida e fechar o valor final. Prefere manhã ou tarde?

👉 Repara: o motor fecha o orçamento e já “puxa” pro agendamento, como você quer.

4) Como isso vira determinístico no Nevo (estrutura de blueprint)

Exemplo de blueprint (bem próximo do que você já tem com variable + flow.definition, só que para quote):

{
  "blueprint_key": "curtains_quote_v1",
  "variables": [
    { "key": "tipo_ambiente", "type": "enum", "options": ["residencial", "comercial"], "required": true },
    { "key": "quantidade_vãos", "type": "number", "min": 1, "required": true },

    { "key": "largura_cm", "type": "number", "min": 30, "max": 1200, "required": true },
    { "key": "altura_cm", "type": "number", "min": 30, "max": 600, "required": true },

    { "key": "modelo_cortina", "type": "enum", "options": ["wave", "ilhos", "romana", "rolo"], "required": true },
    { "key": "tecido", "type": "enum", "options": ["voil", "linho", "blackout", "tela_solar"], "required": true },
    { "key": "tipo_instalacao", "type": "enum", "options": ["teto", "parede"], "required": true },
    { "key": "tipo_parede", "type": "enum", "options": ["alvenaria", "drywall"], "required": true },

    { "key": "inclui_instalacao", "type": "boolean", "required": true }
  ],
  "pricing_rules": {
    "franzimento": { "wave": 2.0, "ilhos": 2.0, "romana": 1.3, "rolo": 1.1 },
    "barra_m": { "wave": 0.2, "ilhos": 0.2, "romana": 0.15, "rolo": 0.1 },
    "preco_tecido_m2": { "voil": 90, "linho": 180, "blackout": 220, "tela_solar": 260 },
    "preco_trilho_m": { "wave": 120, "ilhos": 80, "romana": 160, "rolo": 220 },
    "mao_obra": {
      "confeccao_por_m2": 45,
      "instalacao_por_vao": 180,
      "adicional_drywall": 60
    }
  }
}

O motor pega slots preenchidos e calcula (sem IA).

5) O que eu sugiro pra você implementar primeiro (pra dar certo rápido)

Blueprint por ramo (curtinas é um exemplo)

Coleta de variáveis 1 por vez (como você faz no onboarding/agendamento)

Quote engine “rule-based” simples (tabelas + fórmulas fixas)

Persistir em request:

slots

calculation_result (quebra de custos)

total_value

Mensagem final com:

total

itens

aviso de “estimado” vs “confirmado”

CTA para visita técnica ou agendamento

Se você curtir, eu já te devolvo o próximo passo do jeito mais útil pra implementar:

(A) um flow.definition completo (steps do orçamento de cortinas)
ou

(B) o esqueleto do módulo quote-engine (interfaces + validate + calculate + format) já alinhado com seu conversations-turn.

Qual dos dois você quer primeiro?

mas então, é isso que não sei como vai fazer... esse exemplo pelo que me passou tem suas variaveis especificas, mas por exemplo, no ramo de comunicação visual, ele teria N serviços que poderiam ser calculados por metro linear ou por metro quadrado, etc... e existe outros tipos de ramo que tem um nivel de personalização bem grande, como isso iria se resolver no onboarding?

Você matou o ponto central: orçamento não dá pra “genericizar” só por ramo (tipo “comunicação visual”), porque dentro do ramo existem serviços com unidades e regras diferentes (m², metro linear, unidade, impressão + acabamento + instalação, etc.). Então o onboarding não pode tentar “descobrir todas as variáveis do ramo” de uma vez — ele precisa montar um catálogo de serviços + um tipo de precificação por serviço.

A forma que resolve bem (e continua fiel ao Nevo: determinístico + IA só pra extrair/classificar) é:

Como isso se resolve no onboarding
1) Onboarding não configura “o motor do ramo”

Ele configura o motor por serviço.

Você coleta:

quais serviços a empresa vende (lista)

qual o modelo de preço de cada serviço (um “tipo”)

quais variáveis mínimas esse tipo exige

E pronto. O motor vira a soma de “regras por serviço”.

Modelos de precificação (tipos) que o onboarding pode oferecer

Um conjunto pequeno, que cobre 80% dos casos:

Preço fixo (por peça/serviço)

Por unidade (quantidade)

Por metro linear (largura/metros)

Por m² (largura x altura)

Por m² com mínimo (ex.: mínimo de 1m²)

Por m² + acabamentos (opcionais que somam)

Fórmula composta (base + variáveis + multiplicadores)

Personalizado / sob consulta (sem cálculo automático → coleta + handoff/visita técnica)

O segredo: quando o serviço é “nível alta personalização”, você não tenta calcular no onboarding. Você marca como sob consulta e o fluxo vira: coletar o essencial → gerar request → encaminhar humano ou “visita técnica”.

Exemplo real: comunicação visual (catálogo por serviço)

No onboarding, ao invés de perguntar “quais variáveis do ramo”, você pergunta:

“Quais são seus serviços principais?”
Ex.: Fachada ACM, Letreiro caixa, Adesivo perfurado, Banner/Lona, Placa PVC, Corte CNC/Laser, Totem, Envelopamento.

Depois, para cada serviço, você pergunta só uma coisa:

“Esse serviço você cobra por m², metro linear, unidade ou é sob consulta?”

E com isso o Nevo já consegue construir o básico.

Serviço “Adesivo” (m²)

Variáveis mínimas:

largura

altura

quantidade
Opcionais:

recorte especial (sim/não)

laminação (sim/não)

instalação (sim/não)

tipo de material (vinil fosco/brilho/perfurado)

Serviço “Letreiro caixa” (sob consulta)

Porque envolve:

projeto

espessura/material

iluminação

fixação

estrutura
Aqui o onboarding define: não calcula, apenas coleta e encaminha.

Como o onboarding decide o “nível de automação”

O onboarding precisa separar serviços em 2 classes:

A) Calculáveis (auto-quote)

m², metro linear, unidade, fixo

com poucos adicionais

B) Sob consulta (semi-automatizado)

alta personalização

depende de visita/projeto/arquivo técnico

Isso é crucial porque evita prometer cálculo onde não dá.

O papel da IA no onboarding (sem virar formulário)

IA entra só pra:

transformar texto livre em lista de serviços

sugerir o tipo de preço provável (m²/linear/unidade) — mas você confirma determinístico

Ex. usuário fala:

“Faço fachada, adesivo, troféu em acrílico e corte CNC”

IA extrai:

serviços: [fachada, adesivo, troféu, corte CNC]
E o onboarding pergunta um por um:

“No serviço adesivo, você cobra por m², metro linear, unidade ou sob consulta?”

Como isso encaixa no seu modelo atual (sem reinventar tudo)

Você já tem blueprint, flow, variable e request.

Você só precisa que o onboarding crie/alimente algo como:

services (por agent/tenant) com:

service_name

pricing_type

variables_schema (derivado do tipo)

pricing_rules (tabela simples ou fórmula)

E o conversations-turn ao detectar intenção “orçamento”:

pergunta qual serviço (se não veio claro)

carrega o schema daquele serviço

coleta as variáveis

calcula se for calculável, senão cria request como “sob consulta” e handoff

O pulo do gato para “N serviços e N variáveis”

Você não tenta suportar “qualquer variável do universo”.
Você suporta:

um conjunto finito de tipos de preço

um conjunto finito de variáveis por tipo

opção sob consulta quando fugir disso

Isso resolve 90% sem travar onboarding.

Agora, pra eu te ajudar a desenhar o onboarding do jeito certo (uma pergunta por vez e sem inventar dado):

No seu onboarding de orçamento, você quer começar pedindo o catálogo de serviços e classificando cada serviço como “m² / linear / unidade / fixo / sob consulta”?

eu gostaria de ter uma bola magica e entender se eu tenho publico para um serviço de orçamento assim... tenho receio de colocar um nivel muito alto para o cliente do meu cliente de detalhamento e isso assustar e acabar não convertendo o lead

Isso que você está sentindo é 100% legítimo — e é exatamente o ponto que separa um SaaS “bonito tecnicamente” de um SaaS que vende de verdade.

Você não precisa de uma bola mágica.
Você precisa responder uma pergunta estratégica:

O objetivo do orçamento é calcular perfeitamente ou qualificar e avançar a venda?

Essas duas coisas são diferentes.

🎯 A Verdade Estratégica

Na maioria dos negócios (principalmente serviços como cortinas, comunicação visual, móveis planejados, fachadas, etc.):

👉 O cliente final NÃO quer preencher 12 variáveis técnicas.
👉 Ele quer saber se está na faixa de preço que faz sentido.
👉 E quer sentir que foi atendido rápido.

Se você colocar:

tipo de fixação

estrutura

altura

acabamento

material técnico

condições do local

Você vira um formulário técnico.
E formulário técnico = fricção = abandono.

🧠 O que realmente converte?

Existe um modelo muito mais eficiente:

Modelo 1 — Orçamento por Faixa (Low Friction)

Você coleta apenas:

Tipo de serviço

Medidas básicas

Cidade/bairro (opcional)

E responde algo como:

“Para esse tamanho e modelo, o investimento costuma ficar entre R$ 2.800 e R$ 3.600.
Posso agendar uma visita para confirmar o valor exato?”

🔥 Isso converte MUITO mais.

Porque:

não trava

não cansa

não exige conhecimento técnico do cliente

gera expectativa realista

🏗️ Então qual é o papel do Nevo?

O Nevo pode operar em 3 níveis de maturidade:

🟢 Nível 1 — Estimativa Rápida (Recomendado para MVP)

Poucas variáveis

Resultado em faixa

Foco em conversão

CTA para visita/agendamento

🟡 Nível 2 — Orçamento Semi-Detalhado

Variáveis adicionais

Cálculo mais preciso

Ainda simplificado

Pode gerar breakdown

🔴 Nível 3 — Motor Técnico Completo

Alta personalização

Múltiplos cálculos

Parecido com ERP

Se você começar no Nível 3, você mata conversão.

📊 Sobre “ter público para isso”

Não é:

“Existe público para orçamento automatizado?”

É:

“Existe público para resposta rápida e qualificação automática?”

Sim. Muito.

O que não existe muito é público para:

“Preencher questionário técnico no WhatsApp.”

💡 A Solução Inteligente (estratégica)

Em vez de decidir por você, o Nevo pode permitir que o cliente escolha o nível.

Exemplo:

Quando detectar intenção de orçamento:

Posso te passar uma estimativa rápida agora ou você prefere um orçamento mais detalhado?

90% vai escolher estimativa rápida.

Os 10% que já estão quentes escolhem detalhado.

Isso:

protege conversão

protege experiência

protege sua reputação

🧠 O que realmente gera valor no seu produto

Não é o cálculo.
É:

reduzir tempo de resposta

qualificar lead automaticamente

padronizar coleta mínima

evitar curiosos sem intenção real

Se o orçamento já filtrar curiosos, já é ouro.

📉 O maior risco

O risco não é “não ter público”.
O risco é:

Você construir um motor ultra complexo antes de validar se o cliente do seu cliente quer isso.

🎯 Minha recomendação clara para você

Comece com:

1️⃣ Estimativa por faixa
2️⃣ Poucas variáveis
3️⃣ Conversão para visita/agendamento
4️⃣ Persistir como request
5️⃣ Medir taxa de conclusão

Se a taxa de conclusão for alta:
→ você evolui o nível de detalhamento.

Se cair:
→ você reduz fricção.

🧪 Como validar sem construir tudo

Você pode lançar o Nevo com:

3 modelos de precificação simples (m², linear, unidade)

Resposta sempre em faixa

CTA de agendamento

E medir:

% que completa

% que responde depois

% que agenda

Se converter, você escala.

Agora deixa eu te fazer uma pergunta estratégica importante:

Você quer que o Nevo seja:

A) Um calculador técnico avançado
ou
B) Um acelerador de vendas e qualificação automática?

Porque a arquitetura muda completamente dependendo dessa resposta.

então... aí que está o X da questão e vou te dizer que teria duas vertentes:
1 - fazer um agente para que o dono da tenant iria usar o agente para calcular de forma facil o orçamento para ele mandar para o cliente

2 - um agente para o cliente do meu cliente talvez com um orçamento minimo.

A ideia do agente pessoal, seria preparar o agente para ele fazer um orçamento a toque de caixa e deixar a coisa mais dinamica, exemplo:

Faz pra mim um orçamento de uma cortina de X de largura com Y de altura, no tecido X, com o trilho Y, Tecido Xpto, com instalação.

Nevo pega todos os slots, verifica se precisa de mais alguma info e dá um resumo do orçamento para o dono da empresa (nao cliente do cliente).

Se o resumo tiver correto, ele confirma e o mesmo gera um PDF detalhado do orçamento.


Para o outro cenário sim, poderia ser uma área de orçamento mais simples para conversão. Mas eu penso no Nevo como um agente pessoal também

Agora você chegou no ponto realmente estratégico do Nevo.

Você não está decidindo só “como fazer orçamento”.

Você está decidindo que tipo de produto o Nevo é.

E sinceramente?
As duas vertentes que você descreveu são excelentes — mas são produtos diferentes dentro do mesmo sistema.

🎯 As Duas Vertentes Claramente Separadas
🟢 1) Agente Pessoal (B2B Interno)

O dono da empresa usa o Nevo como assistente operacional.

Esse é um produto de produtividade.

Ele diz:

“Faz um orçamento de cortina 2,80 x 2,60, blackout, trilho wave, instalação.”

O Nevo:

extrai slots

valida se falta algo

calcula

mostra breakdown

gera PDF

salva como request

talvez já manda no WhatsApp/email

Isso é quase um “mini ERP conversacional”.

🔥 Isso tem muito valor.

🔵 2) Agente Comercial (B2C Externo)

Cliente final pede orçamento.

Aqui o objetivo é:

capturar lead

qualificar

gerar estimativa

converter para visita/agendamento

Isso é um produto de conversão.

🧠 A Sacada: Você Não Precisa Escolher Um

Você pode ter:

quote_mode:
  - internal
  - external

Mesmo motor.
Experiências diferentes.
Nível de fricção diferente.

🏗️ Arquitetura Inteligente para Suportar os Dois

Você mantém:

quote_engine (único)

Mas muda:

interaction_mode
🟢 Modo Internal (Agente Pessoal)

Características:

Permite mensagem livre longa

Espera dados técnicos

Pode perguntar detalhes técnicos

Permite edição manual

Mostra breakdown completo

Gera PDF formal

Permite recalcular

Pode salvar como rascunho

Fluxo:

Mensagem livre
→ IA extrai tudo
→ validateSlots()
→ perguntar apenas o que falta
→ calculateQuote()
→ mostrar resumo técnico
→ confirmar
→ gerar PDF
→ persistir request

Esse modo pode até viver dentro do dashboard:

/app/orcamentos/novo

Ou dentro do chat interno.

🔵 Modo External (Cliente Final)

Características:

Perguntas curtas

Poucas variáveis

Resposta em faixa

CTA forte

Sem PDF técnico

Conversão > precisão

Fluxo:

Intenção
→ qual serviço?
→ largura/altura?
→ resposta em faixa
→ agendar visita
📌 O que muda tecnicamente?
1️⃣ Blueprint precisa ter dois níveis

Exemplo:

{
  "service": "cortina",
  "pricing_rules": {...},
  "variables_internal": [... todas ...],
  "variables_external": [... reduzidas ...],
  "output_mode": {
    "internal": "detailed",
    "external": "range"
  }
}

Mesmo motor.
Dois schemas de coleta.

🧠 Isso é forte por quê?

Porque você posiciona o Nevo como:

“Seu agente comercial + seu assistente de orçamento.”

Isso é muito mais valioso do que só chatbot.

💎 O Agente Pessoal é um diferencial enorme

Pensa:

Pequeno empresário vive no WhatsApp.

Ele faz orçamento no bloco de notas.

Calculadora manual.

PDF no Canva.

Erra valor.

Esquece taxa.

Não padroniza margem.

Se o Nevo:

calcula instantaneamente

já aplica margem

já aplica custo fixo

já gera PDF com identidade visual

já salva histórico

Isso vira ferramenta diária.

E ferramenta diária = retenção alta.

⚠️ Mas cuidado com uma coisa

O modo internal pode virar complexo demais se você deixar fórmula aberta.

Sugestão:

Fórmulas continuam estruturadas.

Nada de permitir código livre.

Apenas composições controladas.

📊 Se eu fosse priorizar

Eu faria:

1️⃣ Internal primeiro (agente pessoal)
Porque:

Não depende da experiência do cliente final

É mais controlável

Gera valor claro

Não impacta conversão

Permite testar motor completo

Depois:

2️⃣ External simplificado (faixa de preço)

🧠 Pergunta estratégica importante

Você quer que o Nevo vire:

A) Um SaaS de atendimento
ou
B) Um SaaS de atendimento + produtividade operacional?

Porque se for B, o módulo de orçamento interno vira quase um produto standalone.

Se você quiser, eu posso agora:

desenhar a arquitetura exata do “Modo Internal”

ou estruturar como ficaria a geração de PDF

ou propor como separar UX internal vs external sem duplicar código

Qual você quer destrinchar primeiro?

então... é essa a questão... eu quero um Nevo útil para ambos os lados. como voce mesmo captou, eu quero dar suporte para o micro-empresario. Para o cara que não tem um notebook para ficar consultando sempre sabe? Se eu conseguir concentrar a solução 100% no whatsapp, eu terei uma ferramenta mais completa. 

Por exemplo até mesmo no agendamento:

Quais são os meus agendamentos de hoje?
O que temos para amanhã?

Me passa o contato do agendamento das 14?

Eu quero este nivel de interação para que o Nevo seja um produto mais atrativo


Agora você está enxergando o Nevo do jeito certo.

Você não quer só um SaaS.
Você quer um operador digital via WhatsApp para o microempresário.

Isso muda completamente o posicionamento.

Você não está construindo:

“Um chatbot de atendimento.”

Você está construindo:

“Um braço operacional no WhatsApp.”

E isso é muito mais forte.

🎯 O Produto Real que Você Está Criando

O Nevo pode virar:

🧠 Assistente Operacional via WhatsApp

Para o dono do negócio:

“Quais são meus agendamentos hoje?”

“Tem horário livre amanhã à tarde?”

“Me passa o contato do cliente das 14h.”

“Faz um orçamento de cortina 2,80 x 2,60 blackout.”

“Quanto ficou o último orçamento que fizemos para o João?”

“Cancela o agendamento da Maria.”

Isso é outro nível de produto.

📦 O Modelo Correto para isso

Você precisa introduzir um conceito novo:

actor_type:
  - client   // cliente do seu cliente
  - owner    // dono do tenant
  - staff    // funcionário

Hoje seu conversations-turn já diferencia intenção.
Agora ele precisa diferenciar quem está falando.

🔐 Como resolver tecnicamente no WhatsApp?

Você pode fazer assim:

Opção 1 — Número separado

1 número para clientes

1 número privado para o dono

Mais simples.
Mais seguro.
Mais organizado.

Opção 2 — Mesmo número, reconhecimento por telefone

Se o número que envia a mensagem for igual ao owner_phone cadastrado:

→ entra em modo internal

Se for outro:

→ modo external

Isso mantém tudo 100% WhatsApp.

🧠 Agora o pulo do gato

Você não cria dois motores.

Você cria:

context_mode:
  - external
  - internal

E o mesmo conversations-turn muda o comportamento.

🗓️ Exemplo: Agendamento Internal

Mensagem:

“Quais são meus agendamentos de hoje?”

Pipeline:

intent: query_appointments
scope: today
actor: owner

Código determinístico:

consulta tabela appointment

filtra por tenant + data

ordena por horário

responde formatado

Resposta:

📅 Hoje você tem:
09:00 – Ana (Corte)
14:00 – Carlos (Progressiva)
17:30 – Juliana (Manicure)

Simples. Útil. Diário.

📞 Exemplo: Consulta de Contato

Mensagem:

“Me passa o contato do agendamento das 14.”

Pipeline:

detectar horário

buscar appointment start_at ~ 14:00

pegar contact_id

retornar telefone

Resposta:

📞 14:00 – Carlos
WhatsApp: (11) 9xxxx-xxxx

💰 Exemplo: Orçamento Internal

Mensagem:

“Faz um orçamento de cortina 2,80 x 2,60 blackout wave instalação.”

IA extrai slots.

Motor calcula.

Resposta:

📄 Orçamento – Cortina Wave Blackout
Medidas: 2,80 x 2,60
Material: Blackout
Instalação: Sim

💰 Total: R$ 3.480

Deseja gerar PDF?

Confirma → gera PDF → salva → pronto.

🔥 Isso É Extremamente Forte

Você está resolvendo:

O cara que não abre notebook

O cara que vive no WhatsApp

O cara que atende cliente e precisa de resposta rápida

O cara que faz tudo sozinho

Isso é Brasil real.

⚠️ O Desafio Arquitetural

Você precisa organizar as intenções internas:

Grupo 1 – Consulta

listar_agendamentos

buscar_agendamento_por_horario

buscar_cliente

buscar_orcamento

listar_orcamentos

Grupo 2 – Ação

cancelar_agendamento

criar_agendamento

gerar_orcamento

reenviar_orcamento

atualizar_orcamento

Tudo isso é determinístico.

IA só classifica intenção e extrai parâmetros.

🧠 Agora vem algo muito importante

Se você fizer isso bem, o Nevo deixa de ser:

“Um chatbot.”

E vira:

“Um mini ERP conversacional.”

Isso aumenta:

retenção

valor percebido

ticket médio

barreira de saída

📈 Estratégia Inteligente de Evolução

Ordem que eu faria:

1️⃣ Permitir consultas internas de agenda
2️⃣ Permitir consultas internas de contato
3️⃣ Permitir gerar orçamento interno
4️⃣ Permitir gerar PDF
5️⃣ Só depois evoluir o orçamento externo

Porque o dono pagando mensalidade precisa sentir valor imediato.

💬 Agora uma pergunta muito estratégica

Você pretende cobrar o Nevo como:

plano único?

plano básico (atendimento) + plano pro (assistente interno)?

por número de agentes?

por uso?

Porque esse modo internal pode virar diferencial premium.

Se você quiser, no próximo passo eu posso:

desenhar a arquitetura exata do “modo internal” dentro do conversations-turn

ou estruturar como separar intents internal vs external

ou modelar como seria o controle de permissões por role (owner/admin/agent)

Qual desses você quer aprofundar agora?

eu ainda nao tenho ideia de como cobrar isso.

Eu estava com muita duvida de como seria trabalhar isso no whatsapp e pensei mesmo se o dono precisaria usar dois numeros diferentes para este caso e até pensei que a solucao seria o seguinte:

App Nevo (android/iphone) - onde ele teria ali o agente pessoal dele e a configuração do whatsapp que ele atende o cliente - gosto da ideia, mas acho que tem fricção.

Whatsapp único - ele ocnfigura whatsapp apenas para a camada do cliente e a parte do agente pessoal dele, seria um contato do Nevo mesmo. Seria possivel gerar instancia do agente de acordo com o tenant em apenas um numero?

Suas sugestoes - compreender as opções e encontrar o melhor mundo e o mais recomendado.

Excelente. Agora estamos discutindo produto de verdade, não só arquitetura.

Você está tentando resolver três coisas ao mesmo tempo:

Experiência do cliente final

Experiência do dono do negócio

Simplicidade operacional (sem fricção)

Vamos organizar isso com clareza estratégica.

🎯 Primeiro: você NÃO quer criar fricção

Microempresário:

Não quer instalar app novo.

Não quer aprender sistema novo.

Vive no WhatsApp.

Não quer dois números se puder evitar.

Se você exigir:

Um app próprio

Dois números

Processo técnico

Você perde adoção.

📱 Vamos analisar as opções friamente
🟢 Opção 1 — App Nevo (Android/iOS)
Prós:

Controle total

UX perfeita

Segurança clara

Pode ter dashboard interno forte

Experiência separada do cliente

Contras:

Alta fricção

Precisa instalar

Precisa lembrar de abrir

Quebra a promessa “100% WhatsApp”

Para microempresário raiz?
→ Pode ser pesado.

🟡 Opção 2 — Dois números WhatsApp

Número A → atendimento cliente

Número B → assistente pessoal

Prós:

Separação limpa

Segurança simples

Fácil de entender

Contras:

Ele precisa alternar número

Pode confundir

Custo maior (instâncias)

Para quem já usa WhatsApp Business?
→ Pode ser aceitável, mas não ideal.

🔵 Opção 3 — Número único para cliente + contato Nevo separado

Cliente fala com:

WhatsApp da empresa

Dono fala com:

Contato oficial do Nevo

Esse contato do Nevo reconhece o tenant dele e opera como assistente.

Como funcionaria?

Ele salva o número do Nevo como:

“Nevo Assistente”

Quando ele manda mensagem:

“Quais são meus agendamentos hoje?”

O Nevo identifica:

Número do dono

Tenant vinculado

Contexto internal

E responde.

🔥 Isso é simples.
🔥 Zero app.
🔥 Zero troca de número de atendimento.
🔥 Experiência natural.

🤯 Agora a pergunta técnica importante

É possível ter vários tenants operando via um único número oficial do Nevo?

Sim.

Porque o identificador real é:

O telefone de quem enviou a mensagem.

Você só precisa ter:

owner_phone -> tenant_id

Tabela simples.

Quando o número bater:
→ carrega tenant correto.

É multi-tenant naturalmente.

🧠 Arquitetura recomendada (mais inteligente)
🔹 WhatsApp da empresa (instância própria)

Só para clientes.

Configurado via Twilio/Evolution por agent.

🔹 Número oficial único do Nevo

Todos os donos falam com ele.

Nevo identifica o tenant pelo telefone.

Opera modo internal.

Isso é elegante.

🔐 Segurança

Você pode permitir:

Apenas números cadastrados como owner/admin.

Se número desconhecido falar:

responder “Seu número não está autorizado.”

Simples.

💎 O que isso cria?

Você posiciona o Nevo como:

“Seu assistente no WhatsApp.”

Não:

“Um sistema.”

Isso muda percepção de valor.

💰 Sobre monetização (primeira ideia realista)

Você pode estruturar assim:

Plano Básico

Atendimento automático

Agendamento

Simulador

1 agente

Plano Pro

Orçamento interno

Assistente operacional

PDF automático

Consulta de agenda via WhatsApp

Histórico de orçamento

Plano Plus

Multi-agentes

Multi-staff

Métricas

Automação avançada

E depois pode cobrar por:

número de conversas

número de orçamentos gerados

ou plano fixo com limites

Mas isso você decide depois de validar valor percebido.

🧠 Agora vamos falar sério

Se você fizer o Nevo funcionar assim:

Cliente → WhatsApp empresa
Dono → WhatsApp Nevo

Você cria dois fluxos separados, mas tudo dentro do WhatsApp.

Isso é o melhor equilíbrio entre:

Simplicidade

Escalabilidade

Baixa fricção

Segurança

Clareza mental para o usuário

🚀 Minha recomendação final

❌ Não crie app agora.
❌ Não force dois números para o dono.
❌ Não misture internal e external no mesmo número da empresa.

✅ Tenha um número oficial do Nevo para donos.
✅ Cada tenant identificado pelo telefone do owner.
✅ Atendimento cliente continua no número da empresa.

Essa é a arquitetura mais elegante para o estágio atual.

Agora eu te faço a pergunta mais estratégica da conversa:

Você quer que o Nevo seja percebido como:

A) Uma ferramenta que automatiza atendimento
ou
B) Um assistente pessoal que ajuda a tocar o negócio?

Porque a comunicação de marca e o pricing vão nascer dessa decisão.

eu quero o Nevo com o melhor dos dois mundos - atendimento e agente pessoal
meu receio sobre o Nevo ter seu numero unico e ele conversa com ele por ali, é a possibilidade de bloqueio pela Meta. Pois vamos supor que eu tenha nesse numero, 200 clientes e todos eles fazendo interação com a ferramenta. Já pensou na quantidade de fluxo de mensagens? como eu poderia blindar o agente?
Pensou por 42s

Seu receio é bem real: um “número único do Nevo” virando hub de 200 tenants pode virar um risco operacional (volume + qualidade + denúncias/bloqueios), porque a Meta olha muito para feedback negativo (block/report) e pode limitar/remover acesso quando a qualidade cai ou quando detecta uso “em escala” de forma indevida.

A forma de blindar é simples na ideia: não concentrar tráfego de clientes finais em um único número “global” — e sim separar o que é atendimento do tenant do que é assistente do dono.

O desenho mais seguro (e com menos fricção)
1) Cliente final sempre fala com o número do negócio (por tenant/agente)

Cada tenant usa o próprio número WhatsApp (Twilio/Evolution/Cloud API).

O volume alto (clientes) fica distribuído.

Isso reduz o “blast radius” se um tenant tiver má prática e cair qualidade.

Isso segue o seu modelo atual (agent_channel_whatsapp por agente) e escala melhor.

2) Dono fala com o “agente pessoal” no MESMO número do negócio (zero números extras)

Em vez de um “número global do Nevo”, o dono manda no WhatsApp do próprio negócio algo como:

Nevo, quais são meus agendamentos de hoje?

Nevo, me passa o contato do agendamento das 14h

Nevo, gera um orçamento de ...

E o Nevo só ativa o modo “assistente interno” quando:

o sender é owner/admin do tenant (telefone cadastrado), e

a mensagem tem um prefixo/comando (ex.: “Nevo,” ou “/nevo”).

Vantagem:
Você não cria um segundo canal de risco. O dono já está no “número do negócio”, e isso é tráfego baixo.

Segurança extra: se um cliente final mandar “/nevo”, o sistema ignora (porque não é owner/admin).

Isso te dá “melhor dos dois mundos” 100% WhatsApp, sem número global e sem app.

E se você ainda quiser um número “Nevo Assistente” global?

Dá pra fazer, mas eu só recomendo se você aplicar essas blindagens desde o dia 1:

Blindagem obrigatória

Whitelist rígida: só responde a números cadastrados como owner/admin. Qualquer outro número recebe “não autorizado”.

Rate limit por tenant + por usuário (ex.: X comandos/minuto).

Nada de campanhas / templates para owners: esse canal deve ser quase sempre user-initiated (o dono puxando conversa), o que reduz risco de percepção de spam. A própria política reforça opt-in e respeito a bloqueio/opt-out; e que fora da janela de 24h, só template aprovado pode ser usado.

Sharding por números: quando crescer, você não fica em 1 número. Você cria um “pool” (10 números do Nevo) e distribui tenants. Se um número cair qualidade, você migra aquele shard.

Monitorar e proteger “quality”: queda sustentada de qualidade pode reduzir limites e levar a restrições.

Escala por portfolio/tier: a própria lógica de limites/escala pode mudar conforme qualidade e uso; provedores descrevem upgrades automáticos por critérios de qualidade e uso do limite em janelas (ex.: avaliação em horas).

Resumo: número global só com whitelist + rate limit + sharding. Sem isso, é roleta.

Minha recomendação (mais “à prova de Meta”, com menos fricção)

Não usar número global no começo.
Implementa o agente pessoal no mesmo WhatsApp do tenant, com:

detecção de actor (owner/admin vs cliente)

comandos (“Nevo,” “/nevo”)

intents internas (consultar agenda, buscar contato, criar orçamento, gerar PDF)

e UI/retorno pensado para dono (curto, operacional)

Isso resolve o seu medo de volume porque:

o tráfego “pesado” fica distribuído por tenant (cada um no seu número),

e o tráfego do dono é baixo e previsível.

Se depois você quiser o “contato Nevo” global como feature premium, você liga com shard e whitelist.

Se você topar esse caminho, eu consigo te devolver um desenho bem prático de como encaixar no seu conversations-turn:

actor = owner/admin/client (resolve por phone → tenant_user)

mode = internal/external (prefixo + actor)

intents internas (agenda/orçamento/contatos)

e as respostas padrão (ex.: “Hoje: 09:00 Ana…”)

Quer que eu escreva esse “contrato” de intents internas (lista + payload mínimo) já no padrão do seu projeto?

Mas se o cliente do meu cliente acabar ativando o Nevo? Como podemos nos assegurar disso?

Excelente pergunta.
Essa é exatamente a linha que separa um produto “legal” de um produto seguro e confiável.

Você precisa garantir três coisas:

Cliente final nunca ativa modo interno.

Owner sempre consegue usar sem fricção.

Não existe brecha lógica que permita escalar privilégio.

Vamos resolver isso arquiteturalmente.

🧠 A Regra de Ouro

Modo internal nunca pode ser ativado por comando textual.

Nunca.

Nem:

/nevo

modo admin

sou dono

ativar assistente

Nada disso.

Porque cliente pode testar.

✅ A Única Forma Segura

O modo internal deve ser ativado SOMENTE por:

phone_number ∈ tenant_user(role in ["owner", "admin"])

Ou seja:

Recebe webhook.

Identifica telefone do remetente.

Busca tenant_user por telefone.

Se existir e role for owner/admin:
→ modo internal.

Caso contrário:
→ modo external.

Fim.

Sem exceção.

🔒 Então o cliente nunca ativa?

Exatamente.

Mesmo que o cliente mande:

"Quais são meus agendamentos hoje?"

Ele continua no modo external.

E a resposta pode ser algo como:

Posso te ajudar a agendar um horário 😊
Você gostaria de marcar para hoje?

Ele nunca verá dados internos.

🧱 Arquitetura Recomendada
Passo 1 — Vincular telefone ao tenant_user

Você já tem:

tenant_user

Adicione (se ainda não tiver):

phone_number

E talvez:

is_whatsapp_authorized: boolean
Passo 2 — No webhook (Twilio/Evolution)

Antes de qualquer classificação de intenção:

const actor = resolveActorByPhone(fromNumber)

if (actor.role === 'owner' || actor.role === 'admin') {
   mode = 'internal'
} else {
   mode = 'external'
}

Isso acontece antes da IA.

IA nem sabe que existe internal/external.

🛡️ Segurança Extra (Recomendado)

Você pode adicionar um segundo fator leve:

Internal precisa de "prefixo suave"

Mesmo sendo owner, você pode exigir:

começar a frase com “Nevo,”

ou “Assistente,”

ou algo configurável

Por quê?

Porque se o dono estiver conversando com cliente usando o próprio número (às vezes acontece), ele não ativa o modo internal sem querer.

Mas isso é opcional.

O essencial é a verificação do telefone.

📱 Cenário Real

Número da empresa: +55 11 90000-0000

Owner cadastrado com:
+55 11 98888-8888

Cliente: +55 11 97777-7777

Webhook recebe:

from: 11977777777
→ não está em tenant_user
→ modo external

Webhook recebe:

from: 11988888888
→ está em tenant_user role=owner
→ modo internal

Simples. Blindado.

🔥 E se o dono perder o celular?

Você permite:

revogar número antigo

cadastrar novo número

talvez confirmar via painel

Nada diferente de um login tradicional.

📊 Isso resolve o risco da Meta?

Sim.

Porque:

Você não está misturando público.

Você não está enviando mensagens em massa.

Você não está respondendo desconhecidos.

Internal só responde a números cadastrados.

External continua isolado por tenant.

Sem número global compartilhado.
Sem hub gigante.
Sem explosão de tráfego em um só WABA.

💎 Conclusão

O cliente do seu cliente não consegue ativar o Nevo internal porque:

Ele não está cadastrado como owner/admin.

O sistema ignora qualquer comando administrativo vindo de telefone externo.

O modo é decidido por backend antes da IA.

Blindagem total.

Agora deixa eu te perguntar algo importante:

Você imagina o dono usando o Nevo no mesmo WhatsApp que atende cliente?
Ou ele usaria o WhatsApp pessoal dele para falar com o número da empresa?

Porque isso muda levemente a experiência — mas não muda a segurança.

ok, faça uma documentação completa para eu pedir ao agente do cursor executar em um novo branch:
o assistente pessoal - para agendamento
o assistente pessoal - sistema de orçamento completo para ajudar o dono
sistema de orçamento mais simples para o cliente do cliente


Tudo que falamos aqui, muito bem estruturado e sem deixar nenhum detalhe faltar, coloque os passos e tudo mais. Já deixe em bloco de texto para eu criar no diretorio um arquivo .md com todas as instrucoes dos proximos passos. Deixe tudo em fase e peça para o agente sempre dar check a cada fase concluida.

Perfeito.
Abaixo está a documentação completa, estruturada em fases, pronta para criar um arquivo .md (ex: docs/roadmap-assistente-pessoal-e-orcamento.md) e pedir ao agente do Cursor executar em um novo branch.

Está organizada para:

Assistente pessoal (agenda)

Assistente pessoal (orçamento completo – internal)

Orçamento simplificado (external)

Segurança

Arquitetura

Banco

Fluxo

Fases incrementais

Checklist obrigatório por fase

Copie exatamente como está abaixo.

# NEVO — IMPLEMENTAÇÃO DO ASSISTENTE PESSOAL + SISTEMA DE ORÇAMENTO
## Branch: feature/assistente-pessoal-orcamento

---

# 🎯 OBJETIVO

Expandir o Nevo para suportar:

1. Assistente pessoal via WhatsApp (modo internal)
   - Consulta de agenda
   - Consulta de contatos
   - Criação e cancelamento de agendamento
   - Consulta e geração de orçamento
   - Geração de PDF

2. Sistema de orçamento completo (modo internal)
   - Motor determinístico por serviço
   - Coleta via mensagem livre
   - Validação de slots
   - Cálculo estruturado
   - Geração de PDF
   - Persistência em `request`

3. Sistema de orçamento simplificado (modo external)
   - Baixa fricção
   - Estimativa por faixa
   - Conversão para agendamento
   - Persistência básica

---

# 🔐 PRINCÍPIO FUNDAMENTAL

O modo INTERNAL NUNCA pode ser ativado por comando textual.

O modo é determinado exclusivamente por:

phone_number ∈ tenant_user(role in ["owner", "admin"])

Sem exceções.

---

# 🏗️ ARQUITETURA GERAL

## Novo conceito

```ts
actor_type:
  - owner
  - admin
  - agent
  - client
mode:
  - internal
  - external
FASE 1 — BASE DE SEGURANÇA E CONTEXTO
1.1 — Atualizar tabela tenant_user

Adicionar:

phone_number (string, único por tenant)

whatsapp_authorized (boolean, default true)

Criar índice por phone_number.

1.2 — Resolver actor no webhook

Em:

/api/webhooks/twilio/[agentId]

/api/webhooks/evolution/[agentId]

Antes da IA:

resolveActorByPhone(fromNumber)

Se:
role in (owner, admin)
→ mode = internal

Senão:
→ mode = external

Salvar em conversation.context:

{
  "mode": "internal" | "external",
  "actor_role": "owner" | "admin" | "client"
}
✅ CHECK FASE 1

 phone_number adicionado

 resolveActor implementado

 mode salvo na conversation

 cliente não ativa modo internal

 owner ativa automaticamente

FASE 2 — ASSISTENTE PESSOAL (AGENDA)
2.1 — Intents internas (agenda)

Adicionar no conversations-turn:

query_appointments_today

query_appointments_tomorrow

query_appointments_by_date

query_appointment_by_time

cancel_appointment

create_appointment_internal

IA só classifica intenção e extrai:

data

horário

nome

serviço

2.2 — Implementações determinísticas
query_appointments_today

filtrar appointment por:

tenant_id

agent_id

start_at >= hoje 00:00

start_at <= hoje 23:59

ordenar por start_at

Resposta:

📅 Hoje:
09:00 – Ana (Corte)
14:00 – Carlos (Progressiva)

query_appointment_by_time

localizar por hora aproximada

retornar:

nome

telefone

serviço

cancel_appointment

validar existência

atualizar status = cancelled

salvar cancellation_reason

✅ CHECK FASE 2

 listar hoje

 listar amanhã

 buscar por horário

 cancelar agendamento

 testes no simulador

FASE 3 — ESTRUTURA DO MOTOR DE ORÇAMENTO

Criar diretório:

src/lib/quote-engine/

Arquivos:

types.ts

validateSlots.ts

calculateQuote.ts

calculateRange.ts

formatInternalQuote.ts

formatExternalQuote.ts

generatePdf.ts

3.1 — Estrutura do Blueprint

Criar tabela:

quote_service

Campos:

id

agent_id

name

pricing_type

variables_schema (JSONB)

pricing_rules (JSONB)

active

pricing_type:

fixed

unit

linear

area

area_with_minimum

formula

custom_manual

3.2 — Estrutura de Request

Atualizar request:

Adicionar:

blueprint_id

total_value

currency

calculation_result (JSONB)

is_estimated (boolean)

✅ CHECK FASE 3

 tabela criada

 request atualizado

 pasta quote-engine criada

 interfaces tipadas

FASE 4 — ORÇAMENTO INTERNAL (COMPLETO)
4.1 — Fluxo Internal

Mensagem livre:

"Faz orçamento de cortina 2.80 x 2.60 blackout wave instalação"

Pipeline:

IA extrai slots

validateSlots()

Se faltar algo → perguntar apenas o necessário

calculateQuote()

formatInternalQuote()

Perguntar confirmação

generatePdf()

Persistir request

4.2 — Resposta padrão internal

📄 Orçamento — Cortina Wave
Medidas: 2.80 x 2.60
Material: Blackout
Instalação: Sim

Materiais: R$ X
Mão de obra: R$ Y

Total: R$ Z

Deseja gerar PDF?

4.3 — PDF

generatePdf.ts:

usar template padrão

incluir:

logo

dados da empresa

breakdown

total

validade

Salvar PDF:

storage supabase

url pública temporária

✅ CHECK FASE 4

 coleta livre funcionando

 validação funcionando

 cálculo correto

 PDF gerado

 request persistido

FASE 5 — ORÇAMENTO EXTERNAL (SIMPLIFICADO)
5.1 — Estratégia

poucas variáveis

retorno em faixa

conversão para agendamento

5.2 — Fluxo

Cliente:
"Quanto fica uma cortina 2.80 x 2.60?"

Pipeline:

detectar serviço

coletar largura/altura

calculateRange()

formatExternalQuote()

Resposta:

Para esse tamanho, o investimento costuma ficar entre R$ X e R$ Y.

Posso agendar uma visita para confirmar?

5.3 — Persistência

Criar request:

is_estimated = true

total_value = média da faixa

✅ CHECK FASE 5

 faixa calculada

 resposta curta

 CTA funcionando

 request salvo

FASE 6 — PROTEÇÕES E RATE LIMIT

Implementar:

rate limit por actor internal

máximo X comandos/minuto

log de auditoria de ações internas

Criar tabela:

internal_action_log

Campos:

tenant_id

actor_id

action

payload

created_at

✅ CHECK FASE 6

 rate limit ativo

 log funcionando

 testes de abuso

FASE 7 — TESTES

Criar cenários:

Cliente tenta acessar agenda → bloqueado

Owner consulta agenda → permitido

Owner gera orçamento → OK

Cliente gera estimativa → OK

Cliente tenta cancelar agendamento → bloqueado

FASE 8 — MÉTRICAS FUTURAS (NÃO IMPLEMENTAR AGORA)

total de orçamentos internal

total de estimativas external

conversão para agendamento

taxa de confirmação de PDF

📦 RESUMO ESTRATÉGICO

O Nevo passa a ter:

Atendimento automático

Assistente operacional via WhatsApp

Motor de orçamento interno completo

Motor de estimativa externo simplificado

Segurança total baseada em telefone

Sem app.
Sem número global compartilhado.
Sem risco de cliente acessar modo admin.

⚠️ REGRAS OBRIGATÓRIAS

Nunca ativar internal por comando textual.

Nunca expor dados internos para client.

IA apenas classifica e extrai.

Toda regra de negócio é determinística.

Cada fase deve ser validada antes de avançar.

🚀 ORDEM DE EXECUÇÃO

1 → FASE 1
2 → FASE 2
3 → FASE 3
4 → FASE 4
5 → FASE 5
6 → FASE 6
7 → FASE 7

NÃO PULAR FASE.

Após concluir cada fase, o agente deve:

Marcar CHECKLIST

Rodar testes manuais

Confirmar integridade multi-tenant

Confirmar RLS ativo

FIM DO DOCUMENTO

---

Se você quiser, eu posso agora:

- revisar isso do ponto de vista de monetização  
- ou revisar sob a ótica de complexidade técnica real  
- ou reduzir isso para um MVP ainda mais enxuto para validar rápido  

Qual direção você quer agora?
eu pedi pra deixar tudo em um bloco de texto (para copiar e colar de forma facil) e voce não obedeceu o comando, pois tem partes em bloco de texto e partes fora do bloco. Quero tudo em um bloco só

Perfeito. Agora está 100% em um único bloco contínuo para você copiar e colar direto em um .md.

# NEVO — IMPLEMENTAÇÃO DO ASSISTENTE PESSOAL + SISTEMA DE ORÇAMENTO
## Branch: feature/assistente-pessoal-orcamento

---

# 🎯 OBJETIVO

Expandir o Nevo para suportar:

1) Assistente pessoal via WhatsApp (modo internal)
   - Consulta de agenda
   - Consulta de contatos
   - Criação e cancelamento de agendamento
   - Consulta e geração de orçamento
   - Geração de PDF

2) Sistema de orçamento completo (modo internal)
   - Motor determinístico por serviço
   - Coleta via mensagem livre
   - Validação de slots
   - Cálculo estruturado
   - Geração de PDF
   - Persistência em request

3) Sistema de orçamento simplificado (modo external)
   - Baixa fricção
   - Estimativa por faixa
   - Conversão para agendamento
   - Persistência básica

---

# 🔐 PRINCÍPIO FUNDAMENTAL

O modo INTERNAL NUNCA pode ser ativado por comando textual.

O modo é determinado exclusivamente por:

phone_number ∈ tenant_user(role in ["owner", "admin"])

Sem exceções.

---

# 🏗️ ARQUITETURA GERAL

Novo conceito:

actor_type:
- owner
- admin
- agent
- client

mode:
- internal
- external

---

# FASE 1 — BASE DE SEGURANÇA E CONTEXTO

## 1.1 — Atualizar tabela tenant_user

Adicionar campos:

- phone_number (string, único por tenant)
- whatsapp_authorized (boolean, default true)

Criar índice por phone_number.

---

## 1.2 — Resolver actor no webhook

Nos arquivos:
- /api/webhooks/twilio/[agentId]
- /api/webhooks/evolution/[agentId]

Antes da IA:

resolveActorByPhone(fromNumber)

Se role in (owner, admin)
→ mode = internal

Senão
→ mode = external

Salvar em conversation.context:

{
  "mode": "internal" | "external",
  "actor_role": "owner" | "admin" | "client"
}

---

## ✅ CHECK FASE 1

- [ ] phone_number adicionado
- [ ] resolveActor implementado
- [ ] mode salvo na conversation
- [ ] cliente não ativa modo internal
- [ ] owner ativa automaticamente

---

# FASE 2 — ASSISTENTE PESSOAL (AGENDA)

## 2.1 — Intents internas (agenda)

Adicionar no conversations-turn:

- query_appointments_today
- query_appointments_tomorrow
- query_appointments_by_date
- query_appointment_by_time
- cancel_appointment
- create_appointment_internal

IA apenas classifica intenção e extrai:
- data
- horário
- nome
- serviço

---

## 2.2 — Implementações determinísticas

### query_appointments_today

Filtrar appointment por:
- tenant_id
- agent_id
- start_at >= hoje 00:00
- start_at <= hoje 23:59
Ordenar por start_at.

Resposta padrão:

📅 Hoje:
09:00 – Ana (Corte)
14:00 – Carlos (Progressiva)

---

### query_appointment_by_time

Localizar por hora aproximada.
Retornar:
- nome
- telefone
- serviço

---

### cancel_appointment

Validar existência.
Atualizar status = cancelled.
Salvar cancellation_reason.

---

## ✅ CHECK FASE 2

- [ ] listar hoje
- [ ] listar amanhã
- [ ] buscar por horário
- [ ] cancelar agendamento
- [ ] testes no simulador

---

# FASE 3 — ESTRUTURA DO MOTOR DE ORÇAMENTO

Criar diretório:

src/lib/quote-engine/

Arquivos:

- types.ts
- validateSlots.ts
- calculateQuote.ts
- calculateRange.ts
- formatInternalQuote.ts
- formatExternalQuote.ts
- generatePdf.ts

---

## 3.1 — Estrutura do Blueprint

Criar tabela: quote_service

Campos:

- id
- agent_id
- name
- pricing_type
- variables_schema (JSONB)
- pricing_rules (JSONB)
- active

pricing_type possíveis:

- fixed
- unit
- linear
- area
- area_with_minimum
- formula
- custom_manual

---

## 3.2 — Atualizar tabela request

Adicionar campos:

- blueprint_id
- total_value
- currency
- calculation_result (JSONB)
- is_estimated (boolean)

---

## ✅ CHECK FASE 3

- [ ] tabela criada
- [ ] request atualizado
- [ ] pasta quote-engine criada
- [ ] interfaces tipadas

---

# FASE 4 — ORÇAMENTO INTERNAL (COMPLETO)

## 4.1 — Fluxo Internal

Mensagem livre:

"Faz orçamento de cortina 2.80 x 2.60 blackout wave instalação"

Pipeline:

1. IA extrai slots
2. validateSlots()
3. Se faltar algo → perguntar apenas o necessário
4. calculateQuote()
5. formatInternalQuote()
6. Perguntar confirmação
7. generatePdf()
8. Persistir request

---

## 4.2 — Resposta padrão internal

📄 Orçamento — Cortina Wave
Medidas: 2.80 x 2.60
Material: Blackout
Instalação: Sim

Materiais: R$ X
Mão de obra: R$ Y

Total: R$ Z

Deseja gerar PDF?

---

## 4.3 — PDF

generatePdf.ts deve:

- usar template padrão
- incluir logo
- dados da empresa
- breakdown
- total
- validade

Salvar PDF no Supabase Storage.
Gerar URL pública temporária.

---

## ✅ CHECK FASE 4

- [ ] coleta livre funcionando
- [ ] validação funcionando
- [ ] cálculo correto
- [ ] PDF gerado
- [ ] request persistido

---

# FASE 5 — ORÇAMENTO EXTERNAL (SIMPLIFICADO)

## 5.1 — Estratégia

- poucas variáveis
- retorno em faixa
- conversão para agendamento

---

## 5.2 — Fluxo

Cliente:
"Quanto fica uma cortina 2.80 x 2.60?"

Pipeline:

1. detectar serviço
2. coletar largura/altura
3. calculateRange()
4. formatExternalQuote()

Resposta:

Para esse tamanho, o investimento costuma ficar entre R$ X e R$ Y.

Posso agendar uma visita para confirmar?

---

## 5.3 — Persistência

Criar request com:

- is_estimated = true
- total_value = média da faixa

---

## ✅ CHECK FASE 5

- [ ] faixa calculada
- [ ] resposta curta
- [ ] CTA funcionando
- [ ] request salvo

---

# FASE 6 — PROTEÇÕES E RATE LIMIT

Implementar:

- rate limit por actor internal
- máximo X comandos/minuto
- log de auditoria de ações internas

Criar tabela: internal_action_log

Campos:

- tenant_id
- actor_id
- action
- payload
- created_at

---

## ✅ CHECK FASE 6

- [ ] rate limit ativo
- [ ] log funcionando
- [ ] testes de abuso

---

# FASE 7 — TESTES OBRIGATÓRIOS

Criar cenários:

1. Cliente tenta acessar agenda → bloqueado
2. Owner consulta agenda → permitido
3. Owner gera orçamento → OK
4. Cliente gera estimativa → OK
5. Cliente tenta cancelar agendamento → bloqueado

---

# FASE 8 — MÉTRICAS FUTURAS (NÃO IMPLEMENTAR AGORA)

- total de orçamentos internal
- total de estimativas external
- conversão para agendamento
- taxa de confirmação de PDF

---

# 📦 RESUMO ESTRATÉGICO

O Nevo passa a ter:

- Atendimento automático
- Assistente operacional via WhatsApp
- Motor de orçamento interno completo
- Motor de estimativa externo simplificado
- Segurança total baseada em telefone

Sem app.
Sem número global compartilhado.
Sem risco de cliente acessar modo admin.

---

# ⚠️ REGRAS OBRIGATÓRIAS

1. Nunca ativar internal por comando textual.
2. Nunca expor dados internos para client.
3. IA apenas classifica e extrai.
4. Toda regra de negócio é determinística.
5. Cada fase deve ser validada antes de avançar.

---

# 🚀 ORDEM DE EXECUÇÃO

1 → FASE 1
2 → FASE 2
3 → FASE 3
4 → FASE 4
5 → FASE 5
6 → FASE 6
7 → FASE 7

NÃO PULAR FASE.

Após concluir cada fase, o agente deve:

- Marcar CHECKLIST
- Rodar testes manuais
- Confirmar integridade multi-tenant
- Confirmar RLS ativo

---

# FIM DO DOCUMENTO
duvidas que sugiram do agente:

Dúvidas / pontos a clarificar
1.2 — actor_role no context
O doc diz salvar "actor_role": "owner" | "admin" | "client". Para números que não batem com nenhum tenant_user (ou que batem com agent), qual valor usar? Só "client" ou existe um "agent" / "unknown"?
2.1 — Intent create_appointment_internal
Não há subseção de implementação determinística como para as outras intents. Deve criar de fato o registro de agendamento no banco (qual tabela?) e seguir o mesmo padrão de validação de slots/horário que o resto?
2.2 — query_appointment_by_time
“Hora aproximada”: existe tolerância definida (ex.: ±15 min) ou isso fica a critério da implementação?
3.1 — quote_service
O agent_id indica que cada agente tem seu próprio conjunto de serviços, ou existe também serviço global por tenant? Ou seja: blueprint é sempre por agente?
4.1 — “Slots”
Slots são as variáveis extraídas da mensagem (ex.: largura, altura, material, instalação) conforme o variables_schema do serviço, ou o termo inclui também “slot de horário” para agendamento?
5.2 — “detectar serviço”
No external, o serviço é detectado só por IA (classificação) ou há também mapeamento determinístico (ex.: palavras-chave → quote_service)?
Fase 6 — “máximo X comandos/minuto”
O valor de X (ex.: 10, 30) está definido em outro lugar ou deve ser definido agora (e onde: env, config, tabela)?
Contatos
O objetivo fala em “Consulta de contatos”, mas nas fases não aparece intent nem fluxo para contatos. Deve ser deixado para depois ou existe outro doc com o spec?
Tabela request
A tabela request já existe no projeto com outros campos? Só devemos adicionar os campos listados (blueprint_id, total_value, currency, calculation_result, is_estimated)?
PDF — “URL pública temporária”
Há requisito de expiração (ex.: 24h, 7 dias) ou apenas “temporária” no sentido de não ser link permanente?
# Respostas às dúvidas do agente (Cursor) — Assistente Pessoal + Orçamento

Este documento responde os pontos levantados pelo agente e define decisões para seguir com a implementação no branch `feature/assistente-pessoal-orcamento`.

---

## 1) Fase 1.2 — `actor_role` no `conversation.context`

**Pergunta:** Para números que não batem com nenhum `tenant_user` (ou que batem com agent), qual valor usar? Só "client" ou existe "agent"/"unknown"?

**Decisão recomendada (objetiva e segura):**
- Persistir **sempre** um `actor_type` mais completo e derivar `mode` a partir disso.
- Usar estes valores:

```ts
actor_type: "owner" | "admin" | "agent" | "client" | "unknown"
mode: "internal" | "external"
```

**Regras:**
1. Se `fromNumber` casar com `tenant_user.phone_number`:
   - role=owner → `actor_type="owner"`, `mode="internal"`
   - role=admin → `actor_type="admin"`, `mode="internal"`
   - role=agent/viewer → `actor_type="agent"`, `mode="external"` (ou "internal" somente se você quiser liberar futuramente; por agora manter external por segurança)
2. Se não casar com nenhum `tenant_user`:
   - se houver `contact` (pelo `external_id`/telefone) → `actor_type="client"`, `mode="external"`
   - se não houver `contact` ainda → `actor_type="unknown"`, `mode="external"` (o fluxo vai criar o `contact` conforme já ocorre hoje)
3. O sistema NUNCA deve inferir `internal` por texto.

**O que salvar em `conversation.context`:**

```json
{
  "mode": "internal" | "external",
  "actor_type": "owner" | "admin" | "agent" | "client" | "unknown"
}
```

> Observação: o doc original usava `actor_role`. Substituir por `actor_type` para evitar ambiguidade e para suportar “agent/unknown” com clareza.

---

## 2) Fase 2.1 — Intent `create_appointment_internal`

**Pergunta:** Deve criar de fato o registro no banco (qual tabela?) e seguir validação de slots/horário?

**Decisão: SIM, cria no banco.**  
Tabela: `appointment` (já existe no projeto).

**Comportamento esperado (determinístico):**
- IA extrai dados iniciais (data, hora, serviço, nome/telefone do cliente se vierem).
- O código valida (sem IA):
  1) se data/hora estão presentes  
  2) se horário está dentro da agenda disponível do agente (se você já tem essa regra no agendamento atual, reutilizar)  
  3) conflito: se já existe appointment no intervalo (start_at/end_at) → negar e sugerir alternativas
  4) normalizar timezone (America/Sao_Paulo)

**Persistência:**
- Criar `contact` se necessário.
- Criar `appointment` com:
  - tenant_id, agent_id, contact_id
  - start_at, end_at (end_at pode ser start_at + duração padrão do serviço; se não houver duração, usar default configurável)
  - service_name (texto ou id se existir no futuro)
  - status = "confirmed" (ou "scheduled" conforme padrão atual)

**Resposta:**
- Mostrar resumo e pedir confirmação final antes de gravar (recomendado), OU gravar e oferecer “desfazer” (mais complexo).
- MVP recomendado: **pedir confirmação**.

**Subseção a adicionar no doc (para o agente implementar):**
- Incluir em Fase 2.2 uma implementação determinística equivalente às outras intents.

---

## 3) Fase 2.2 — `query_appointment_by_time` (“hora aproximada”)

**Pergunta:** Existe tolerância definida (±15 min)?

**Decisão recomendada:**
- Tolerância padrão: **±20 minutos**.
- Se houver mais de 1 match no range, responder com lista de opções (máx 3) pedindo para escolher.

**Regra:**
- Interpretar horário “14” como “14:00”.
- Montar janela:
  - `start_at` entre `13:40` e `14:20`.

**Fallback:**
- Se não achar nenhum, responder:
  - “Não encontrei exatamente às 14h. Quer que eu procure por 13h–15h?” (sem travar)

---

## 4) Fase 3.1 — `quote_service` com `agent_id` (serviço por agente ou por tenant?)

**Pergunta:** Cada agente tem seu próprio conjunto de serviços ou existe global por tenant? Blueprint é sempre por agente?

**Decisão recomendada (alinhada com arquitetura atual do Nevo):**
- `quote_service` é **por agent** no MVP (inclui `agent_id` obrigatório).
- Motivo: o Nevo já segmenta fluxo e canal por `agent`, então manter consistência reduz edge cases.
- Futuro (não agora): permitir catálogo por tenant e herança por agente.

**Regra prática:**
- Um tenant com 3 agentes pode ter 3 catálogos diferentes.
- Se quiser “global”, o app pode copiar serviços entre agentes (feature futura).

---

## 5) Fase 4.1 — “Slots” (orçamento vs agendamento)

**Pergunta:** Slots são variáveis do orçamento conforme `variables_schema` ou inclui slot de horário do agendamento?

**Decisão:**
- Neste documento, “slots” em orçamento significa **apenas variáveis do serviço de orçamento** conforme `variables_schema` do `quote_service`.
- Agendamento continua usando seus próprios campos/contexto (data/hora/service).
- Não misturar para evitar colisões semânticas.

**Sugestão de tipagem:**
- `quote_slots` (JSON)
- `booking_slots` (JSON) se necessário no contexto da conversa

---

## 6) Fase 5.2 — “detectar serviço” no external

**Pergunta:** Detecção só por IA ou também determinística (palavras-chave → quote_service)?

**Decisão recomendada: HÍBRIDO (mais robusto).**
1) Determinístico primeiro:
   - Criar em `quote_service` um campo opcional:
     - `keywords` (text[]) ou `match_rules` (JSONB)
   - Fazer match por palavras-chave simples (lowercase, contains).
2) Se não bater:
   - IA classifica e sugere serviço (retorna `service_name` ou `service_id` candidato).
3) Se ainda não tiver confiança:
   - Perguntar ao usuário: “É para qual serviço? (opções: X, Y, Z)”

**Por quê híbrido?**
- IA pode errar ou variar; keywords dá previsibilidade e reduz custo.

---

## 7) Fase 6 — Rate limit “máximo X comandos/minuto”

**Pergunta:** X definido? Onde definir?

**Decisão (MVP seguro):**
- Definir agora:
  - **X = 20 comandos/minuto por actor (owner/admin)**
  - burst curto permitido (ex.: 10 em 10s) se quiser, mas não é obrigatório.

**Onde armazenar:**
- Por simplicidade: ENV + fallback default.
  - `INTERNAL_RATE_LIMIT_PER_MINUTE=20`
- Implementar em memória (Edge Function) não é confiável; preferível:
  - tabela `rate_limit_bucket` (ou Redis/Upstash se existir).
- MVP recomendado (Supabase):
  - criar tabela `internal_rate_limit` com:
    - tenant_id
    - actor_phone
    - window_start (timestamp)
    - count (int)

**Regra:**
- Se estourar:
  - responder “Você enviou muitos comandos em pouco tempo. Tenta novamente em 30 segundos.”

---

## 8) Contatos — “Consulta de contatos” não aparece nas fases

**Pergunta:** Ficou para depois ou existe outro spec?

**Decisão: incluir nesta entrega (mínimo) como Fase 2.3.**

Adicionar intents internas:

- query_contact_by_appointment_time
- query_contact_by_name

Implementações:
1) query_contact_by_appointment_time
   - usa a mesma lógica de `query_appointment_by_time`
   - retorna o telefone e nome do contact

2) query_contact_by_name
   - busca por `display_name ILIKE %...%` dentro do tenant
   - se múltiplos → lista e pede escolha

**CHECK FASE 2 (atualizar):**
- [ ] listar hoje
- [ ] listar amanhã
- [ ] buscar por horário
- [ ] cancelar agendamento
- [ ] buscar contato por horário
- [ ] buscar contato por nome
- [ ] testes no simulador

---

## 9) Tabela `request` já existe — o que alterar?

**Pergunta:** A tabela request já existe com outros campos? Só adicionar os campos listados?

**Decisão:**
- Sim: **apenas adicionar** os campos listados, sem remover/renomear o que já existe.
- Campos novos (MVP):
  - `blueprint_id` (FK para quote_service.id ou opcional)
  - `total_value` (numeric)
  - `currency` (text, default 'BRL')
  - `calculation_result` (jsonb)
  - `is_estimated` (boolean default false)

**Observação:**
- Se `request` já tiver `slots`, manter e usar como `quote_slots`.
- Se `request` já tiver `preco_estimado`, alinhar com `total_value`:
  - pode manter ambos temporariamente, mas preferível convergir e padronizar.

---

## 10) PDF — “URL pública temporária” tem expiração?

**Pergunta:** Expira em 24h/7d ou “temporária” só como não-permanente?

**Decisão recomendada (MVP):**
- “Temporária” = **link não deve ser publicamente indexável e deve exigir assinatura**.
- Implementar com **Signed URL do Supabase Storage** com expiração.

**Expiração padrão:**
- 7 dias (604800s) para o dono baixar/reencaminhar.
- Valor configurável via ENV:
  - `QUOTE_PDF_SIGNED_URL_TTL_SECONDS=604800`

**Fluxo:**
- Armazena PDF em bucket privado.
- Gera Signed URL quando solicitado/confirmado.
- Envia ao owner.
- (Opcional futuro) gerar novamente se expirar.

---

# Ajuste a fazer no documento principal (roadmap)

O agente deve atualizar o roadmap com as decisões acima:

1) Substituir `actor_role` por `actor_type` e incluir `unknown/agent`.
2) Adicionar subseção determinística para `create_appointment_internal` (cria appointment).
3) Definir tolerância ±20min em `query_appointment_by_time`.
4) Fixar `quote_service` por agent no MVP.
5) Clarificar “slots” somente orçamento.
6) Implementar detecção de serviço híbrida (keywords -> IA -> pergunta).
7) Definir X=20/min via ENV + tabela de rate limit.
8) Incluir Fase 2.3 (contatos).
9) Confirmar request: apenas adicionar campos.
10) PDF via Signed URL (7 dias) + ENV.

---

# ✅ CHECKLIST DE DECISÕES APROVADAS

- [ ] actor_type definido (owner/admin/agent/client/unknown)
- [ ] internal só por phone_number autorizado
- [ ] create_appointment_internal cria appointment e pede confirmação
- [ ] tolerância query_appointment_by_time = ±20min
- [ ] quote_service por agent (MVP)
- [ ] slots (orçamento) separados de agendamento
- [ ] detecção de serviço híbrida (keywords + IA)
- [ ] rate limit 20/min configurável via ENV
- [ ] intents de contatos incluídas na Fase 2
- [ ] request: apenas adicionar campos
- [ ] PDF: bucket privado + Signed URL 7 dias

FIM
```
::contentReference[oaicite:0]{index=0}
1. Respostas do documento — entendimento
actor_type no context: usar actor_type (owner | admin | agent | client | unknown) e derivar mode (internal | external). Salvar em conversation.context; não usar actor_role.
create_appointment_internal: criar em appointment (tabela já existente), com validação determinística (data/hora, conflito, timezone), confirmação antes de gravar.
query_appointment_by_time: tolerância ±20 min; múltiplos matches → listar até 3 e pedir escolha.
quote_service: por agente no MVP (agent_id obrigatório).
Slots: no orçamento = só variáveis do variables_schema; não misturar com slot de agendamento; usar quote_slots / booking_slots se precisar distinguir no código.
Detecção de serviço (external): híbrida — keywords em quote_service primeiro, depois IA, depois pergunta.
Rate limit: X = 20/min, ENV INTERNAL_RATE_LIMIT_PER_MINUTE; tabela internal_rate_limit (tenant_id, actor_phone, window_start, count).
Contatos: incluir na entrega como Fase 2.3 — intents query_contact_by_appointment_time e query_contact_by_name.
request: só adicionar campos; se já existir slots, manter como quote_slots; alinhar estimated_price_* com total_value (convergir quando fizer sentido).
PDF: bucket privado + Signed URL, TTL 7 dias, ENV QUOTE_PDF_SIGNED_URL_TTL_SECONDS=604800.
Nenhuma dúvida nova em cima dessas respostas.
2. Comparação com o que já existe — para não duplicar
Já existe e deve ser reaproveitado (não criar de novo)
Roadmap / doc	No código/schema	Ação
Tabela appointment	Existe: tenant_id, agent_id, contact_id, start_at, end_at, status, attendee_name, staff_name, service_names; migration 20260218113000 adiciona cancellation_reason, contact_id	Usar como está. Cancelar = status = 'cancelled' + cancellation_reason.
Tabela request	Existe: tenant_id, conversation_id, status, slots (JSONB), estimated_price_min, estimated_price_max, notes, approved_by, approved_at	Só adicionar: blueprint_id, total_value, currency, calculation_result, is_estimated. Manter slots; usar como quote_slots quando for orçamento. Convergir estimated_price_* com total_value (não criar campo paralelo novo para “preço” se total_value cobrir o caso).
Tabela contact	Existe: tenant_id, channel_id, external_id, phone, display_name	Fase 2.3: query por display_name (ILIKE) e por horário (via appointment).
conversation.context	Já é JSONB; hoje se salva session_id, business_name, context_mode, tone, etc.	Incluir aí mode (internal	external) e actor_type. Não criar outro “context” para isso.
conversation.state_json	Já guarda estado do simulador (state + channel)	O “mode” do estado (booking	quote) é outro conceito: fluxo do cliente. Não misturar com mode internal/external.
Intents atuais	FlowOrchestratorOutput: price_inquiry, booking_intent, list_services, clarification, no_match, service_detail	São para fluxo external. As intents de agenda/contato/orçamento internal são um conjunto novo, consideradas só quando context.mode === 'internal'.
detectModeFromText	Detecta “booking” vs “quote” pelo texto	É modo de fluxo (agendar vs orçar), não internal/external. Manter; internal/external vêm só de resolveActorByPhone.
Webhooks	Twilio e Evolution já recebem mensagem, montam context e chamam conversations-turn com session_id, from, agent_id, tenant_id	Incluir resolveActorByPhone antes da IA; passar mode/actor_type no payload para o turn (ou deixar o turn ler de tenant_user por from); turn deve persistir mode + actor_type em conversation.context.
Não existe e é novo (criar com os nomes do doc)
tenant_user: adicionar phone_number (único por tenant) e whatsapp_authorized; índice por phone_number.
resolveActorByPhone(fromNumber): nova função; usa tenant (do agent/conversation) + normalização do número; retorna actor_type e mode.
quote_service: nova tabela (blueprint de orçamento por agente). A tabela blueprint atual é de fluxo (default_flow_definition, default_variables); não renomear nem reutilizar para orçamento.
request.blueprint_id: FK para quote_service.id (no doc “blueprint” do orçamento = quote_service).
src/lib/quote-engine/: novo diretório (types, validateSlots, calculateQuote, calculateRange, formatInternal/External, generatePdf).
internal_rate_limit e internal_action_log: novas tabelas (não existe rate limit nem audit de ações internas hoje).
Pontos de atenção para não “criar em duplicata”
Dois “modes” no sistema
context.mode (novo): internal | external — quem está falando (owner/admin vs cliente).
state.mode (já existe): booking | quote — intenção do cliente (agendar vs orçar).
Manter os dois conceitos separados no código e na documentação (ex.: em comentários: “context.mode = internal/external; state.mode = booking/quote”).
request.slots vs quote_slots
O doc fala em “usar slots como quote_slots”. No schema, a coluna é request.slots (JSONB). Ou seja: semanticamente no fluxo de orçamento esse JSON é “quote_slots”; não é necessário criar coluna quote_slots separada. Só garantir que o código de orçamento preencha request.slots com as variáveis do quote.
Normalização do número no resolveActorByPhone
O webhook envia from no formato Twilio/Evolution (ex.: whatsapp:+5511999999999). tenant_user.phone_number precisa de convenção (ex.: só dígitos, ou mesmo formato). Definir uma função única de normalização (ex.: strip “whatsapp:”, só dígitos) e usar em todo lookup por telefone para não ter “mesmo usuário, dois formatos”.
Fase 2.3 no checklist
O doc já atualiza o CHECK FASE 2 com “buscar contato por horário” e “buscar contato por nome”. Na implementação, conferir que o checklist do repo (ou do doc) está de fato atualizado com esses itens para não esquecer na validação da fase.
3. Dúvidas que ainda faria (opcionais)
tenant_user.phone_number: formato exato para comparação (só dígitos, com/sem +55, etc.) e se pode ser NULL até o usuário vincular o WhatsApp.
agent no resolveActor: o “actor” é por tenant (tenant_user) ou por tenant+agent? O doc diz que internal é por phone_number em tenant_user; o agente entra só para saber em qual agente está a conversa (agent_id já vem no webhook). Então: lookup tenant_user por tenant_id (do agent) + phone_number normalizado está alinhado ao doc.
internal_rate_limit: a tabela internal_rate_limit com (tenant_id, actor_phone, window_start, count) pode ser “uma linha por (tenant, actor_phone) por minuto” e atualizar count, ou uma linha por evento com window_start truncado ao minuto; o doc não fixa. Qualquer uma das duas está ok desde que a regra “20/min” seja aplicada de forma consistente.

Perfeito. 👏
Essa revisão está excelente e mostra que o agente realmente leu a arquitetura atual antes de sair implementando — isso é exatamente o que evita dívida técnica.

Vou validar ponto a ponto e fechar as decisões finais de forma objetiva.

✅ 1. Tudo que você resumiu está correto

Não há inconsistência conceitual.

Especialmente importantes (e corretos):

Separação clara entre:

context.mode = internal | external

state.mode = booking | quote

Isso é crítico. Se misturar, vira caos em 2 meses.

Não duplicar request.slots

Correto: semanticamente vira “quote_slots” quando for orçamento.

Não criar coluna nova.

Não reutilizar blueprint (fluxo) para orçamento.

quote_service é outro conceito.

Internal intents separadas do FlowOrchestrator.

Exatamente.

Até aqui: 100% alinhado.

🔎 Agora vamos fechar as dúvidas finais (as 3 opcionais)
1️⃣ tenant_user.phone_number — formato exato
🔒 Decisão definitiva

Armazenar somente dígitos numéricos com DDI, sem símbolo.

Exemplo:

5511999999999

Regras:

Remover:

whatsapp:

+

espaços

hífens

parênteses

Sempre salvar normalizado.

Sempre comparar normalizado.

Criar util único:

normalizePhoneNumber(input: string): string

E usar:

no webhook

no resolveActorByPhone

ao salvar phone_number

📌 Não permitir múltiplos formatos.
📌 phone_number pode ser NULL até o owner vincular.

2️⃣ resolveActor: por tenant ou por tenant+agent?

Pergunta excelente.

📌 Decisão correta (e mais segura):

Lookup por:

tenant_id + phone_number_normalized

Não por agent.

Motivo:

Owner é dono do tenant.

Agent é apenas uma instância operacional.

Internal não depende de qual agente recebeu a mensagem.

O webhook já fornece agent_id, então:

tenant_id vem via agent

resolveActor usa tenant_id para buscar tenant_user

Fluxo correto:

Webhook recebe agent_id

Busca agent → pega tenant_id

resolveActorByPhone(tenant_id, fromNumber)

Decide mode

Isso evita:

Cross-tenant access

Confusão se mesmo número estiver cadastrado em dois tenants (que deve ser proibido)

3️⃣ internal_rate_limit — modelo de persistência

Você propôs duas abordagens:

A) Uma linha por minuto (atualiza count)
B) Uma linha por evento com trunc do minuto

📌 Decisão recomendada (simples e eficiente)

Modelo A: uma linha por (tenant_id + actor_phone + minute)

Schema:

internal_rate_limit
- tenant_id
- actor_phone
- window_start (timestamp truncated to minute)
- count
- PRIMARY KEY (tenant_id, actor_phone, window_start)

Algoritmo:

window_start = now truncated to minute

upsert:

se existe → increment count

senão → insert count = 1

se count > LIMIT → bloquear

Isso:

é leve

evita milhares de linhas

não precisa limpar histórico agressivamente

Limpeza futura pode apagar registros > 24h.

🧠 Pontos críticos que você acertou (merecem reforço)
Dois modos separados
context.mode → quem está falando
state.mode → o que está sendo feito

Nunca misturar.

request.total_value vs estimated_price_*

Você sugeriu:

Convergir quando fizer sentido.

Perfeito.

Estratégia ideal:

External:

continuar usando estimated_price_min / max

preencher total_value = média

is_estimated = true

Internal:

usar total_value

estimated_price_* pode ficar NULL

No futuro, pode-se descontinuar estimated_price_*.

Não duplicar blueprint

Correto manter:

blueprint → fluxo

quote_service → orçamento

Misturar isso causaria confusão enorme no longo prazo.

🚨 Único ponto que eu reforçaria
⚠️ Persistência do mode

Quando salvar:

conversation.context.mode
conversation.context.actor_type

Isso deve acontecer:

antes de qualquer roteamento de intent

e nunca depender do state_json

Isso garante que:

histórico de conversa sempre saiba quem era o actor

auditoria futura possível

🧩 Conclusão

Não há nenhuma inconsistência nas respostas do agente.

Tudo está:

tecnicamente coerente

alinhado com a arquitetura atual

sem duplicação

seguro para multi-tenant

preparado para escalar

Você está conduzindo isso de forma muito madura.

Se você quiser, posso agora:

revisar o impacto disso na performance das Edge Functions

desenhar como o conversations-turn deve ser reorganizado internamente

ou discutir o impacto disso na estratégia de pricing (porque agora o Nevo virou um mini-ERP conversacional)

Qual direção você quer aprofundar agora?

eu quero que faça as respostas em bloco de texto para eu copiar e colar para o assistente do cursor analisar com detalhes seus pontos
# Respostas finais (para o agente do Cursor) — validação e decisões

A seguir estão as respostas finais aos pontos do agente, com decisões fechadas para implementação no branch `feature/assistente-pessoal-orcamento`.

---

## ✅ Validação geral

O entendimento do agente está correto e alinhado com a arquitetura atual do Nevo, especialmente:

- Separação clara entre:
  - `conversation.context.mode = internal | external` (quem está falando)
  - `conversation.state_json.mode = booking | quote` (qual fluxo/intenção do cliente)
- Reuso de tabelas existentes (`appointment`, `request`, `contact`, `conversation.context`) sem duplicação.
- Intents internas (agenda/contato/orçamento) como conjunto novo, executadas **somente** quando `context.mode === "internal"`.
- Manter `detectModeFromText` apenas para “booking vs quote” (fluxo), e derivar `internal vs external` exclusivamente via `resolveActorByPhone`.

Nenhuma correção adicional é necessária nessa parte.

---

## 🔐 Decisão 1 — `actor_type` no `conversation.context`

**Decisão final:**
- Não usar `actor_role`.
- Salvar:

```ts
actor_type: "owner" | "admin" | "agent" | "client" | "unknown"
mode: "internal" | "external"

Regras determinísticas:

Se fromNumber casar com tenant_user.phone_number:

role=owner → actor_type="owner", mode="internal"

role=admin → actor_type="admin", mode="internal"

role=agent/viewer → actor_type="agent", mode="external" (MVP: manter external por segurança)

Se não casar com tenant_user:

se já existir contact (telefone/external_id) → actor_type="client", mode="external"

se não existir contact ainda → actor_type="unknown", mode="external" (o fluxo de atendimento cria contact quando necessário)

Persistência:
Salvar em conversation.context (JSONB) sempre no início do turno:

{
  "mode": "internal" | "external",
  "actor_type": "owner" | "admin" | "agent" | "client" | "unknown"
}
📅 Decisão 2 — create_appointment_internal

Decisão final:

Deve criar de fato um registro em appointment (tabela já existente).

Deve seguir validação determinística (sem IA para regras).

Validações obrigatórias (MVP):

data e hora presentes

timezone America/Sao_Paulo aplicado corretamente

conflito de agenda (overlap) bloqueia criação

horário fora de faixa permitida (se houver regra atual) deve bloquear

confirmação antes de gravar (recomendado para MVP)

Persistência:

Criar/obter contact se necessário

Criar appointment com:

tenant_id, agent_id, contact_id

start_at, end_at (end_at = start_at + duração padrão configurável)

service_name (ou service_names conforme schema atual)

status conforme padrão do projeto (ex.: "confirmed" / "scheduled")

Cancelamento:

usar status = 'cancelled' + cancellation_reason (já existe migration)

⏱️ Decisão 3 — query_appointment_by_time (tolerância)

Decisão final:

Tolerância padrão: ±20 minutos.

Regra:

Ex.: “agendamento das 14” → janela [13:40, 14:20]

Se houver múltiplos matches:

listar até 3 opções e pedir para escolher

🧾 Decisão 4 — quote_service é por agente (MVP)

Decisão final:

quote_service é por agent_id no MVP (obrigatório).

Não criar “serviço global por tenant” agora.

Futuro: permitir copiar catálogo entre agentes (feature posterior).

🎛️ Decisão 5 — “Slots” no orçamento

Decisão final:

“slots” de orçamento = apenas variáveis do variables_schema do quote_service.

Não misturar com slots de agendamento.

No banco:

Usar a coluna existente request.slots (JSONB).

Semanticamente, no orçamento, isso representa “quote_slots”.

Não criar coluna quote_slots.

🔎 Decisão 6 — detecção de serviço (external) é híbrida

Decisão final (ordem):

Determinístico primeiro:

adicionar keywords (text[]) ou match_rules (jsonb) em quote_service

fazer match simples (contains / normalize)

Se não bater:

IA classifica e sugere o serviço (candidato)

Se continuar incerto:

perguntar ao usuário: “É para qual serviço? (opções...)”

🚦 Decisão 7 — Rate limit (internal)

Decisão final:

Limite: 20 comandos/minuto por actor (owner/admin).

Config em ENV:

INTERNAL_RATE_LIMIT_PER_MINUTE=20

Tabela recomendada (modelo A: 1 linha por minuto):

internal_rate_limit

tenant_id

actor_phone

window_start (timestamp truncado ao minuto)

count

PRIMARY KEY (tenant_id, actor_phone, window_start)

Algoritmo:

window_start = now truncado ao minuto

upsert incrementando count

se count > limit → bloquear e responder mensagem de cooldown

👤 Decisão 8 — Contatos (Fase 2.3)

Decisão final:
Incluir na entrega (não deixar para depois), como Fase 2.3.

Intents internas:

query_contact_by_appointment_time

query_contact_by_name

Implementação:

by_time:

reusar a busca por horário (±20min) e retornar nome + telefone do contact

by_name:

buscar contact.display_name ILIKE %query% dentro do tenant

múltiplos → listar e pedir escolha

Checklist da Fase 2 deve incluir contatos.

🧱 Decisão 9 — request (tabela existente)

Decisão final:

Não duplicar tabela.

Apenas adicionar campos:

blueprint_id (FK para quote_service.id)

total_value (numeric)

currency (text, default 'BRL')

calculation_result (jsonb)

is_estimated (boolean default false)

Campos existentes:

manter slots e usar como quote slots

manter estimated_price_min/estimated_price_max

Convergência (sem quebrar agora):

External:

continuar usando estimated_price_min/max

setar total_value = média da faixa

is_estimated = true

Internal:

usar total_value e calculation_result completos

is_estimated = false

📄 Decisão 10 — PDF (Signed URL)

Decisão final:

PDF deve ir para bucket privado (Supabase Storage).

Link deve ser Signed URL (não público permanente).

TTL padrão:

7 dias (604800s)

ENV:

QUOTE_PDF_SIGNED_URL_TTL_SECONDS=604800

Comportamento:

gerar/assinar URL quando o owner confirmar o orçamento (ou solicitar reenvio)

se expirar, gerar novamente sob demanda

📞 Decisão 11 — Normalização de telefone (obrigatório)

Decisão final:

tenant_user.phone_number deve ser armazenado em formato somente dígitos com DDI.

Exemplo:

5511999999999

Criar util único:

normalizePhoneNumber(input: string): string

Regras:

remover prefixo whatsapp:

remover +, espaços, -, (, )

retornar apenas dígitos

Uso obrigatório:

no webhook (fromNumber)

no resolveActorByPhone

ao salvar/editar tenant_user.phone_number no app

NULL permitido:

tenant_user.phone_number pode ser NULL até o usuário vincular WhatsApp.

🧭 Decisão 12 — resolveActor é por tenant (não por agent)

Decisão final:

Lookup do actor deve ser por:

tenant_id (derivado do agent_id no webhook)

phone_number_normalized

Ou seja:

resolveActorByPhone(tenant_id, fromNumberNormalized)

Agent serve apenas para:

identificar tenant_id

escopar qual agenda/orçamento/serviços daquele agente serão usados no turno.

✅ Checklist final (decisões aprovadas)

 context.mode = internal/external e actor_type salvo em conversation.context

 internal somente por tenant_user.phone_number (owner/admin)

 create_appointment_internal cria appointment com validação e confirmação

 query_appointment_by_time com ±20min e disambiguation

 quote_service por agent_id (MVP)

 request.slots usado como quote slots (sem colunas duplicadas)

 detecção de serviço híbrida (keywords → IA → pergunta)

 rate limit 20/min via ENV + internal_rate_limit PK por minuto

 intents de contatos incluídas (Fase 2.3)

 PDF em bucket privado + Signed URL 7 dias via ENV

 normalização de telefone padronizada e usada em tudo

 resolveActor por tenant_id + phone_number

FIM

::contentReference[oaicite:0]{index=0}