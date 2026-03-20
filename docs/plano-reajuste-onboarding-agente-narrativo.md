# Plano de Reajuste do Onboarding ao Atendimento Final

## Objetivo

Definir como o Nevo pode evoluir de um motor conversacional guiado por contexto operacional fragmentado para um agente que:

- entende o neg?cio como contexto vivo
- conversa como quem pertence ao estabelecimento
- usa slots e agenda como ferramenta operacional
- n?o duplica l?gica entre onboarding e conversation

Este documento n?o substitui o plano de refatoracao do `semantic_core`.
Ele propÃµe a proxima camada arquitetural: transformar o onboarding em forma??o real do agente.

## Tese Central

O onboarding n?o deve apenas coletar campos.

Ele deve produzir duas saÃ­das complementares:

1. contexto estruturado do neg?cio
2. narrativa can?nica do agente

Em termos prÃ¡ticos:

- o `business_brain` continua existindo como base operacional
- mas ele deixa de ser a ?nica representacao do neg?cio
- surge uma camada de `agent_narrative` ou `agent_brief`
- a IA passa a atuar como atendente que usa o sistema, e n?o como parser que tenta s?breviver entre slots

## Modelo Mental Desej?do

O agente deve ser pensado assim:

- a IA e a atendente
- o `brain` e o manual vivo do neg?cio
- a agenda e os slots sao o sistema que ela preenche enquanto atende

Iss? implica:

- a conversa deve ser conduzida pela compreensao da IA
- o estado operacional deve ser consequencia do entendimento
- o sistema valida, persiste e executa
- o sistema n?o deve roubar o protagonismo da agente

Consequencia pratica:

- a conversa revela a intencao
- os slots apenas registram o que foi entendido
- o cliente fala livremente
- o agente entende
- o sistema organiza e valida
- o agente confirma de forma natural

## Problema do Modelo Atual

Hoje o onboarding alimenta bem a parte operacional, mas ainda n?o forma o agente de maneira suficiente.

Na pratica:

- a IA recebe recortes estruturados do neg?cio por turno
- n?o recebe uma narrativa cons?lidada e identitaria do estabelecimento
- responde com boa capacidade operacional em varios cas?s
- mas ainda pode s?ar como um res?lvedor de fluxo, n?o como uma atendente ambientada

Sintoma percebido pelo usuario:

- a IA parece pegar o bonde andando
- ela n?o parece ter internalizado o neg?cio
- o atendimento n?o s?a como algo "na ponta da lingua"
- o cliente ainda sente pontos rigidos quando fala fora da ordem esperada

## Fluidez Conversacional e Multiagendamento

Esse reajuste precisa considerar desde o inicio que o cliente pode montar um agendamento de muitas formas diferentes.

### Ordem das informa??es n?o importa

Estas conversas devem convergir para o mesmo comportamento operacional:

- "marca pra mim e pro Pedro as 10"
- "marca as 10" + "ah, e pro Pedro tambem"
- "marca um corte pra mim" + "na verdade coloca o Pedro depois do meu"
- "quero marcar dois cortes hoje, um pra mim e outro pro Pedro"

O que importa e o plano semantico que o cliente esta construindo, n?o a ordem exata em que os dados apareceram.

### O agente deve pensar em plano, n?o em etapa

O agente n?o deveria raciocinar assim:

- "estou no pass? 2"
- "agora precis? perguntar o slot X"

Ele deveria raciocinar assim:

- "o cliente esta montando um agendamento simples"
- "o cliente esta montando dois agendamentos em sequencia"
- "o cliente esta agendando para outra pess?a"
- "o cliente quer encaixar mais alguem depois"

### Representacao interna desej?da

Sem expor iss? ao usuario, o sistema deve poder cons?lidar algo equivalente a um `booking_plan`.

Exemplo conceitual:

- `attendee_1`
  - nome
  - servi?o
  - horario
- `attendee_2`
  - nome
  - servi?o
  - preferencia de sequencia

Importante:

- iss? n?o deve virar uma segunda fonte de verdade paralela aos slots
- `booking_plan` deve ser derivado do mesmo entendimento s?berano do turno
- ele pode ser uma representacao semantica intermediaria para a IA e para o `semantic_core`

### Multiagendamento deve ser nativo

O agente deve reconhecer naturalmente express?es como:

- "pra mim e pro Pedro"
- "meu irmao tambem"
- "coloca o Pedro tambem"
- "marca dois horarios"
- "um depois do outro"
- "na sequencia"
- "logo depois do meu"

Iss? n?o deve ser tratado como um cas? exotico.
Deve ser parte natural da capacidade conversacional do agente.

### Sequencia e contato fazem parte da conversa, n?o de um subfluxo t?cnico

Quando houver mais de uma pess?a:

- o agente deve priorizar sequencia quando fizer sentido
- o agente deve confirmar naturalmente o contato da segunda pess?a
- a conversa deve s?ar humana

Exemplos de tom desej?do:

- "Beleza, consigo sim."
- "Vou reservar esse horario aqui."
- "Deixa eu encaixar o Pedro logo depois."
- "Qual o nome dele?"
- "O WhatsApp dele e esse mesmo ou prefere que eu mande direto pra ele?"

Exemplos que devemos evitar:

- "Informe o proximo atendido."
- "Confirme o slot do segundo participante."

## Triagem Natural do Negocio

O agente n?o deve apenas conduzir agendamentos.
Ele tambem precisa entender, com naturalidade, quando o pedido do cliente esta fora do radar do neg?cio.

Iss? inclui pelo menos tres frentes:

- triagem por escopo de servi?o
- triagem por p?blico elegivel
- triagem por restricao operacional

### Triagem por escopo de servi?o

Se o cliente pedir algo que n?o faz parte do que o neg?cio oferece, o agente deve:

- entender a intencao real do pedido
- reconhecer que esse pedido esta fora do escopo atendido
- recusar com naturalidade
- redirecionar para aquilo que o neg?cio efetivamente faz

Exemplo conceitual:

- cliente: "Quero tirar meu irmao da cadeia"
- agente: "Entendi que voce precisa de ajuda com Direito Criminal, mas n?o atuamos nessa area. Se quiser, poss? te explicar as areas juridicas com as quais trabalhamos."

### Triagem por p?blico elegivel

Se o servi?o existir, mas o p?blico mencionado estiver fora da politica do neg?cio, o agente deve:

- reconhecer que o pedido faz sentido semanticamente
- identificar que o p?blico n?o se encaixa
- responder como recepcao real, n?o como bloqueio t?cnico

Exemplo conceitual:

- cliente: "Oi, quero agendar um corte de cabelo para minha esposa."
- agente: "Ah, infelizmente aqui atendemos homens e criancas a partir dos 5 anos. Se quiser, poss? te mostrar os servi?os que oferecemos para esse p?blico."

### Triagem por restricao operacional

Tambem devem existir recusas ou ajustes naturais para restricoes como:

- faixa etaria minima
- servi?os indisponiveis naquele contexto
- combinacoes n?o permitidas
- horarios ou formatos de atendimento n?o oferecidos

O objetivo n?o e travar a conversa.
O objetivo e responder com clareza, contexto e redirecionamento util.

### A triagem precisa ser uma capacidade generica do agente

Iss? n?o pode ser tratado como regra de uma barbearia.
Precisa valer para qualquer ramo configurado no onboarding.

Em termos conceituais:

- o onboarding define o radar do neg?cio
- o `business_brain` cons?lida esse radar
- o `agent_narrative` transforma iss? em orientacao de atendimento
- a IA usa esse contexto para aceitar, recusar ou redirecionar com naturalidade

### A triagem n?o deve criar uma segunda arquitetura

Triagem n?o deve nascer como um fluxo paralelo.

Ela deve sair das mesmas fontes can?nicas do agente:

- servi?os e categorias efetivamente oferecidos
- p?blico atendido e p?blico excluido
- pol?ticas e restricoes operacionais
- narrativa de como explicar esses limites de forma humana

## Principio de Nao Duplicacao

Este reajuste s? faz sentido se n?o criarmos duas fontes de verdade.

Regras obrigatorias:

- onboarding n?o deve montar uma narrativa em paralelo ao `business_brain`
- conversation n?o deve reconstruir narrativa por conta propria
- prompts n?o devem remontar manualmente os mesmos fatos em varios lugares
- `agent_narrative` deve ser derivado de uma ?nica fonte can?nica
- o runtime deve consumir artefatos prontos, n?o recompor texto de neg?cio em cada camada
- multiagendamento n?o deve ser modelado duas vezes, uma em texto e outra em estrutura operacional sem contrato comum
- triagem de servi?o, p?blico e restricao n?o deve existir em l?gicas paralelas entre onboarding, IA e conversation

Fonte de verdade desej?da:

1. `raw_config`
2. normalizacao em `business_brain`
3. derivacao can?nica em `agent_narrative`
4. consumo pelo runtime

Ou sej?:

- o onboarding preenche `raw_config`
- o dom?nio semantico cons?lida iss?
- a narrativa nasce dessa cons?lidacao
- a conversation cons?me essa mesma representacao

## Arquitetura Proposta

## Estado Atual da Implementacao

Bloco 1 j? implementado no backend do `conversation`:

- `business_brain` agora gera tambem um `agent_narrative` can?nico
- a narrativa nasce da mesma fonte de verdade do dom?nio, sem duplicacao no frontend
- o runtime semantico j? entrega essa narrativa para a IA no `external`
- `ai.ts` deixou de depender apenas de resumo operacional fragmentado e pass?u a receber um dossi? cons?lidado do neg?cio

Iss? ainda n?o conclui a frente de onboarding visual.
O resumo final no frontend continua como proximo pass?, mas agora j? existe um artefato can?nico real para ser exibido.

Bloco 2 j? implementado no `onboarding-chat`:

- o resumo final do onboarding j? nasce do mesmo `business_brain` + `agent_narrative` do runtime
- o backend do onboarding deixou de depender apenas do `generateSummary(...)` operacional antigo para a tela final
- a UI continua usando `editable_items`, mas a mensagem exibida agora pode refletir a narrativa can?nica do agente
- iss? reduz a diferenca entre "o que o onboarding mostra" e "o que a IA realmente recebe" no atendimento

Bloco 3 j? implementado no frontend do onboarding:

- a mensagem final do resumo narrativo pass?u a aceitar trechos clicaveis
- a edi??o desses trechos abre em painel `Sheet` mobile-first, evitando depender de inline puro em telas pequenas
- `editable_items` continuam sendo a estrutura can?nica de edi??o por baixo
- a narrativa e apenas a projeÃ§Ã£o clicavel dessa mesma estrutura, sem criar segunda fonte de verdade
- quando o trecho editado aparece literalmente no texto, a UI j? atualiza a narrativa localmente sem esperar uma nova rodada completa do backend

Bloco 4 j? implementado no transporte da narrativa:

- o onboarding pass?u a enviar `narrative_segments` expl?citos do backend para o frontend
- a UI deixou de depender de localizar trechos editaveis por busca literal no texto
- a edi??o local da narrativa agora atualiza a estrutura segmentada primeiro e recompÃµe o texto final a partir dela
- `narrative_segments` e `editable_items` continuam derivados da mesma configuracao can?nica, sem criar segunda fonte de verdade

Bloco 5 j? implementado na ponte entre narrativa e lista estruturada:

- o modo `summary_edit` tambem pass?u a carregar a mesma narrativa can?nica, em vez de cair em uma mensagem separada e genÃ©rica
- a lista estruturada continua disponivel como fallback de ajuste detalhado, mas agora convivendo com a narrativa na mesma resposta
- o usuario pode alternar entre leitura narrativa e ajuste estruturado sem trocar de fonte de verdade

Bloco 6 j? implementado na cobertura editavel da narrativa:

- o resumo narrativo pass?u a aceitar tambem trechos como endereco do estabelecimento, p?blico atendido e orientacoes/pol?ticas relevantes
- esses trechos continuam editando a mesma estrutura can?nica j? usada pelo onboarding
- a narrativa fica mais completa como revisao final sem exigir que o usuario caia imediatamente na lista detalhada

Bloco 7 j? implementado na limpeza do contrato do resumo:

- o frontend deixou de reconstruir `editable_items` a partir do texto do resumo
- a definicao dos itens revisaveis do resumo ficou centralizada no backend
- o resumo narrativo agora depende apenas do payload can?nico enviado pelo onboarding-chat

Bloco 8 j? implementado na cobertura automatizada do onboarding:

- o builder `generateNarrativeSummaryPayload(...)` pass?u a ter teste dedicado no onboarding
- os testes travam a existencia e a ordem dos principais segmentos editaveis da narrativa
- iss? reduz o risco de regressao silenciosa no resumo final enquanto o runtime continua evoluindo

### 1. `business_brain`

Permanece como base estruturada e operacional.

Responsabilidades:

- servi?os
- duracoes
- precos
- equipe
- agenda
- p?blico
- FAQ
- pol?ticas
- restricoes
- escopo real do que o neg?cio faz e n?o faz
- regras de elegibilidade de p?blico
- limites operacionais que impactam aceite ou recusa

Tambem deve ser a fonte para regras como:

- servi?os que podem ser combinados
- preferencia por sequencia
- pol?ticas de contato para participantes adicionais
- recusas por escopo fora do neg?cio
- recusas por p?blico fora do perfil atendido
- redirecionamentos seguros para alternativas dentro do escopo

Nao deve tentar virar texto narrativo diretamente dentro das funcoes de IA.

### 2. `agent_narrative`

Novo artefato can?nico derivado do `business_brain`.

Responsabilidades:

- identidade do neg?cio
- resumo operacional em linguagem natural
- forma de atendimento
- regras importantes de conducao
- combinacoes e restricoes relevantes
- tom esperado
- prioridades do atendimento
- filos?fia de conducao do atendimento
- como lidar com multiagendamento de forma natural
- como explicar recusas e limites sem s?ar robotico
- como redirecionar o cliente para servi?os e p?blicos realmente atendidos

Exemplo de saida esperada:

`Otimo, entendi seu neg?cio assim: voce tem uma barbearia chamada Brutos, atende de segunda a sexta das 8h as 18h, faz pausa das 12h as 13h, oferece Corte, Barba e outros servi?os, e Corte + Barba podem ser agendados em conjunto...`

Iss? n?o e s? UX do onboarding.
Iss? deve ser um artefato real do dom?nio.

### 3. `agent_runtime_context`

Camada de consumo para a IA.

Esse contexto deve reunir:

- `agent_narrative`
- `business_brain`
- estado atual da conversa
- historico recente
- pass? operacional atual
- continuidade detectada
- plano conversacional em montagem quando houver multiagendamento
- contexto de triagem quando o pedido estiver fora do escopo ou do p?blico elegivel

Objetivo:

- a IA recebe primeiro "quem s?u / como esse neg?cio funciona"
- depois "o que esta acontecendo neste turno"

## Mudanca no Papel do Onboarding

O onboarding passa a ter duas funcoes:

1. configurar o neg?cio
2. formar o agente

No final do fluxo, deve existir uma tela ou resumo de valida??o como:

- "foi assim que entendi seu neg?cio"
- "e assim que o agente vai atender seus clientes"

Essa tela n?o deve inventar nada.
Ela deve espelhar exatamente o `agent_narrative` can?nico.

Beneficios:

- transparencia para o usuario
- valida??o antes de publicar
- ajuste fino da narrativa
- menos surpresa no atendimento

## Mudanca no Papel da IA

Hoje:

- a IA interpreta turnos com contexto operacional

Desej?do:

- a IA atende como agente do neg?cio e usa o contexto operacional para registrar corretamente

Em termos simples:

- a IA deve ser protagonista da conversa
- o slot-filling deve ser subordinado a ela

Em multiagendamento:

- a IA deve entender que varias pess?as podem estar sendo montadas na mesma conversa
- o sistema deve ajudar a organizar iss? sem quebrar a naturalidade

## O Que Nao Deve Ser Feito

Para evitar um novo legado:

- n?o criar uma narrativa manual no frontend e outra no backend
- n?o duplicar resumo do neg?cio em prompts espalhados
- n?o deixar cada funcao de IA montar seu proprio "mini briefing"
- n?o criar texto de onboarding diss?ciado do runtime real
- n?o transformar `agent_narrative` em mais uma string s?lta sem contrato
- n?o criar uma camada de multiagendamento desconectada do snapshot s?berano
- n?o duplicar "plano de booking" em varios formatos com l?gica concorrente
- n?o espalhar recusas de servi?o e p?blico em helpers s?ltos sem fonte can?nica comum
- n?o deixar onboarding descrever um limite e o atendimento aplicar outro

## Proposta de Implementacao por Fases

### Fase 1. Canonizar a narrativa

Criar um builder unico, algo como:

- `buildAgentNarrative(businessBrain)`

Saida minima:

- `summary`
- `operational_rules`
- `service_overview`
- `audience_rules`
- `tone_guidance`
- `booking_guidance`
- `multi_booking_guidance`
- `triage_guidance`

CritÃ©rio:

- onboarding e runtime passam a consumir a mesma narrativa

### Fase 2. Exibir no onboarding

No fim do onboarding:

- mostrar o resumo gerado
- permitir revisao humana
- n?o permitir que a UI invente texto fora do builder can?nico

CritÃ©rio:

- o usuario enxerga exatamente a narrativa que alimentara o agente

### Fase 3. Injetar no runtime da IA

Atualizar `ai.ts` para usar:

- narrativa base do agente
- contexto do turno
- plano semantico em montagem quando houver varios participantes

Ordem desej?da do prompt:

1. quem e o agente e como o neg?cio funciona
2. como ele deve atender
3. contexto atual da conversa
4. tarefa semantica do turno

CritÃ©rio:

- a IA deixa de depender apenas de listas operacionais e passa a responder a partir de um contexto identitario cons?lidado

### Fase 4. Rebaixar o excess? de conducao estrutural

Com o `agent_narrative` ativo:

- reduzir where possible a dependencia de perguntas fixas
- manter snapshot, policy, decision e executor
- mas deixar o motor mais semanticamente guiado pela leitura da IA

CritÃ©rio:

- o sistema continua seguro operacionalmente
- mas o atendimento s?a menos formularizado

### Fase 5. Valida??o de fluidez

Criar cenarios de aceite orientados a comportamento:

- cliente cumprimenta e faz pergunta aberta
- cliente mistura duvida com agendamento
- cliente responde curto sem repetir contexto
- cliente interrompe, retoma e encerra
- cliente pergunta algo fora do fluxo principal
- cliente informa pess?as, servi?os e horarios em ordens diferentes
- cliente constroi multiagendamento aos poucos
- cliente pede sequencia de horarios
- cliente mistura agendamento proprio com agendamento para terceiro
- cliente informa contato do segundo participante no meio da conversa
- cliente pede algo fora do escopo real do neg?cio
- cliente pede servi?o para p?blico n?o elegivel
- cliente esbarra em restricao operacional legitima e recebe redirecionamento natural

CritÃ©rio:

- o agente responde como quem conhece o neg?cio
- n?o como quem s? tenta empurrar o fluxo
- multiagendamento parece atendimento real, n?o subfluxo t?cnico

## Arquivos Provavelmente Impactados

Sem duplicar dom?nio, a tendencia e atuar principalmente em:

- `supabase/functions/conversations-turn/lib/semantic-core/business-brain.ts`
- `supabase/functions/conversations-turn/lib/ai.ts`
- novo m?dulo de narrativa, algo como:
  - `supabase/functions/conversations-turn/lib/semantic-core/agent-narrative.ts`
- telas finais do onboarding no frontend

Importante:

- n?o mover regra para o frontend
- n?o gerar narrativa diferente no frontend e no backend

## CritÃ©rios de Aceite

Esta proposta estara bem conduzida quando:

- o onboarding produzir uma narrativa can?nica ?nica
- essa narrativa for mostrada ao usuario no final do onboarding
- essa mesma narrativa alimentar a IA no atendimento
- `business_brain` e `agent_narrative` tiverem papeis claros e n?o duplicados
- slots continuarem servindo a operacao, n?o comandando a conversa
- o atendimento s?ar mais pertencente ao neg?cio
- multiagendamento for entendido como variacao natural da conversa
- ordem livre das informa??es n?o quebrar a montagem do atendimento
- pedidos fora do escopo forem recusados com naturalidade e redirecionamento util
- p?blico fora do perfil atendido for tratado com triagem clara e humana
- limites operacionais forem explicados sem parecer erro de sistema

## Perguntas de Valida??o

Antes de implementar, vale validar estas decis?es:

1. o `agent_narrative` deve ser apenas derivado autom?ticamente ou tambem editavel pelo usuario?
2. qual nivel de liberdade narrativa o produto quer permitir?
3. o resumo final do onboarding deve ser apenas visualiza??o ou tambem etapa obrigatoria de confirma??o?
4. queremos uma ?nica narrativa can?nica ou uma narrativa base + playbooks por dom?nio, como booking/faq/quote?

## Recomendacao Final

Nao recomendo reconstruir tudo.

Recomendo:

- preservar a base do `semantic_core`
- adicionar `agent_narrative` como camada can?nica nova
- reposicionar o onboarding como forma??o do agente
- reposicionar a IA como atendente que usa o sistema

Essa dire??o e uma adapta??o profunda, mas em cima de base reaproveit?vel.
Ela parece ser a evolu??o mais coerente com a premissa original do Nevo.

## Estado Atual da Implementacao

Blocos j? conclu?dos:

- Bloco 1: `agent_narrative` can?nico derivado do mesmo `business_brain` usado no atendimento
- Bloco 2: resumo final do onboarding alimentado pela mesma narrativa can?nica do runtime
- Bloco 3: narrativa clicavel no frontend com edi??o mobile-first via `Sheet`
- Bloco 4: `narrative_segments` expl?citos do backend ao frontend, sem depender de parsing do texto
- Bloco 5: `summary_edit` reaproveitando a mesma narrativa can?nica com fallback estruturado
- Bloco 6: ampliacao da cobertura editavel da narrativa para endereco, p?blico e pol?ticas
- Bloco 7: contrato can?nico de `editable_items` centralizado no backend
- Bloco 8: cobertura automatizada do onboarding para `generateNarrativeSummaryPayload(...)`
- Bloco 9: `agent_runtime_context` expl?cito no `conversation`, derivado da mesma narrativa can?nica e consumido por `ai.ts` como dossi? estruturado de runtime
- Bloco 10: centralizacao dos insumos de IA em `ai.ts`, com leitura de servi?os, estilo e radar do neg?cio preferindo `business_brain` e `agent_runtime_context`, em vez de remontar `config` cru em varios prompts
- Bloco 11: triagem natural por escopo de servi?o no `semantic_core`, com redirecionamento s?berano para a lista real de servi?os quando o pedido cai fora do radar do neg?cio
- Bloco 12: normalizacao de copy vis?vel do `semantic_core` para PT-BR com acentua??o correta em prompts e respostas renderizadas
- Bloco 13: normalizacao da copy vis?vel do onboarding narrativo e do resumo final em `flow-manager.ts`, preservando a mesma estrutura can?nica sem duplicar narrativa no frontend
- Bloco 14: triagem natural por pÃºblico elegÃ­vel no `semantic_core`, usando o risco semÃ¢ntico do snapshot para recusar pÃºblico fora do perfil sem depender de `policies.ts` legado
- Bloco 15: extra??o da triagem de p?blico para `audience-triage.ts`, deixando `policy-layer` como orquestrador enxuto e mantendo a regra em m?dulo pr?prio do n?cleo
- Bloco 16: estabilizacao operacional do `onboarding-chat`, com restauracao do entrypoint limpo, preservacao do resumo narrativo canonico e alinhamento do CTA `Continuar` no fechamento do onboarding
- Bloco 17: normalizacao de copy visivel do onboarding narrativo, corrigindo acentuacao quebrada em passos de publico, horario e resumo final antes do deploy de QA
- Bloco 18: blindagem do `business_brain` para normalizar preco e duracao tambem quando o config chega como string, evitando fallback generico no simulador ao responder preco de servicos configurados no onboarding
- Bloco 19: normalizacao da copy do inicio do onboarding (`business_name` e `context`) para eliminar mojibake em mensagens como â€œSÃ³ pra eu direcionar as prÃ³ximas perguntasâ€ e â€œOrÃ§amentoâ€
- Bloco 20: restauracao limpa de `flow-manager.ts` com reencaixe das exports narrativas canÃ´nicas, removendo mojibake espalhado em agenda/pausa sem perder o fechamento narrativo do onboarding
- Bloco 21: aumento da autoria da IA nas respostas finais do `external`, com `reply_price`, `reply_faq`, `reply_identity`, `reply_service_detail`, `reply_service_list` e `reply_closing` passando a tentar resposta contextual gerada por IA antes do fallback determinÃ­stico do renderer`r`n- Bloco 22: aumento da autoria da IA tambem nas respostas de booking do `external`, com `ask_service`, `ask_attendee_name`, `ask_date`, `ask_time`, `ask_contact`, `confirm_booking`, `offer_calendar`, `offer_sequence_template` e `ask_audience_confirmation` passando a tentar resposta contextual gerada por IA antes do fallback deterministico do renderer

Leitura atual:

- onboarding narrativo can?nico: cons?lidado
- conversation consumindo contexto narrativo estruturado, e n?o s? texto livre: iniciado e com base principal pronta`r`n- autoria da IA na resposta final ao cliente: ampliada, com renderer deterministico ficando como fallback de seguranca e nao mais como autor principal das falas informativas e de booking
- duplicacao entre onboarding e conversation: reduzida, com fonte can?nica preservada em `raw_config -> business_brain -> agent_narrative -> agent_runtime_context`
- fechamento do onboarding: ajustado para priorizar a narrativa completa como conteudo principal antes das acoes de edicao
- refinamento do fechamento narrativo: o texto final passou a esconder a camada tecnica de interpretacao, priorizar CTA simples de continuidade e deixar a edicao como acao secundaria
- sustentacao do onboarding-chat: estabilizada apos restauracao do entrypoint e redeploy da funcao para eliminar timeout anomalo no primeiro turno


- Bloco 23: blindagem factual de 
eply_price, garantindo que a resposta final nao diga 'sob consulta' quando o preco exato ja existe no usiness_brain; a IA continua podendo redigir a fala, mas so permanece se mencionar o valor correto.


- Bloco 24: merge canonico entre ooking_services e services no usiness_brain, preservando preco, duracao e descricao mesmo quando o simulador recebe uma lista de agendamento mais pobre e uma lista legado mais rica vindas do onboarding.


- Bloco 25: perguntas abertas sobre o negocio, como 'Como ta o movimento ai hoje?', passaram a ser classificadas como aq contextual no snapshot, evitando clarificacao generica e deixando a resposta sair pela IA com base no contexto do estabelecimento.



- Bloco 26: contexto do simulador passou a preservar e mesclar ooking_services e services antes de enviar para o runtime, evitando perda de preco e duracao quando o onboarding enriquece apenas a lista legado de servicos.


- Bloco 27: a edicao local do onboarding passou a atualizar tambem o `onboardingData` canônico no frontend para `service_price_*`, `service_duration_*` e `service_*`, evitando que o simulador leia contexto desatualizado depois de ajustes feitos na narrativa/resumo.


- Bloco 28: a narrativa final do onboarding passou a explicitar tambem os valores configurados por serviço em um parágrafo próprio, reaproveitando os mesmos campos canônicos editáveis de serviço e preço.


- Bloco 29: o entrypoint de `conversations-turn` passou a mesclar `context.booking_services`, `context.services` e `context.catalog_services` já na entrada do request, evitando descartar preços configurados quando o simulador envia `booking_services` mais pobre e `services` mais rico.


- Bloco 30: `informational-context` passou a recuperar preço do serviço também direto do `raw_config` canônico quando a seleção semântica resolve o serviço, evitando cair em `sob consulta` por inconsistência residual entre listas de serviços no runtime.


- Bloco 31: início da reestruturação canônica com módulo central de serviços no `conversations-turn`, reduzindo duplicação de normalização/merge entre `request-helpers`, entrypoint, `business-brain` e `informational-context`, além da abertura do documento de migração com matriz explícita de descarte.


- Bloco 32: introdução inicial de `business_profile` no contrato do runtime e do simulador, com derivação por adaptador a partir das listas antigas e preferência explícita do `business-brain` pelo perfil canônico quando presente.


- Bloco 33: o onboarding passou a derivar e persistir `business_profile` no próprio `collected_data`, além de devolver esse contrato em `extracted_data`, reduzindo a necessidade de reconstrução do perfil canônico no frontend e no simulador.


- Bloco 34: simulador e loaders de configuração do `conversations-turn` passaram a preferir `business_profile.services` como fonte real de leitura, deixando `services`, `booking_services` e `catalog_services` apenas como fallback compatível durante a migração.


- Bloco 35: a projeção reversa do perfil canônico para contratos herdados começou a ser centralizada em adaptador explícito, com `conversations-turn` e `onboarding-chat/migrate` deixando de reconstruir `booking_services` e `catalog_services` manualmente em cada borda.


- Bloco 36: `ai.ts`, `builders.ts` e `services.ts` passaram a resolver o catálogo efetivo do negócio por helper canônico, reduzindo dependência direta de `config.services` como fonte implícita dentro do runtime.


- Bloco 37: `anytime-handlers`, `resolve-booking`, `ensure-mode`, `turn-handler`, `turn/early/*` e os principais handlers de `booking/*` passaram a usar o resolvedor canônico de serviços, reduzindo o uso direto de `config.services` na orquestração de booking e fallback legado.


- Bloco 38: `informational`, `orchestrator-actions`, `qualification`, `internal-intents` e a rota `src/app/api/onboarding/migrate` passaram a preferir o catálogo canônico e/ou `business_profile`, deixando o restante do inventário concentrado em adaptadores, tipos e testes de compatibilidade.


- Bloco 39: o entrypoint de `conversations-turn` foi reforçado como borda de compatibilidade e os contratos herdados ainda expostos em `types.ts` e `src/lib/simulator/api.ts` passaram a ser marcados explicitamente como temporários/deprecated.


- Bloco 40: rotas auxiliares do app (`src/app/api/app/agents/*` e preview local de `src/app/api/conversations-turn/route.ts`) passaram a preferir `business_profile.services`, reduzindo leitura herdada fora do runtime principal.



- Bloco 41: `request-helpers`, `business-brain` e `informational-context` passaram a ler servi?os pelo resolvedor can?nico central, e o entrypoint de `conversations-turn` ganhou `syncConfigServiceViews(...)` para concentrar a proje??o compat?vel de `business_profile` para contratos herdados em um ?nico ponto.


- Bloco 42: o app passou a compartilhar um helper local de `business_profile`, e `src/lib/simulator/context.ts` + `src/app/api/onboarding/migrate/route.ts` deixaram de reconstruir servi?os por l?gicas paralelas, consumindo a mesma canoniza??o e a mesma proje??o compat?vel.


- Bloco 43: o runtime passou a resolver elegibilidade de sequ?ncia por helper can?nico (`resolveSequenceEligibleServicesFromConfig(...)`), reduzindo o uso espalhado de `sequence_eligible_services` em builders e handlers de booking para um fallback compat?vel bem mais concentrado.


- Bloco 44: o app passou a consumir `business_profile` por helpers canônicos nas rotas de agentes e na página do dashboard, removendo leitura explícita de listas legadas nesses pontos; o contrato público do simulador/request também deixou de expor `services`, `booking_services` e `catalog_services`, mantendo compatibilidade antiga apenas na borda do `conversations-turn`.
