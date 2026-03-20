# Auditoria de Saude, Performance e Seguranca

Data: 2026-03-19
Projeto: Nevo
Escopo: Next.js App Router, rotas `/api`, Edge Functions Supabase, integracao WhatsApp/Evolution, fluxo de onboarding e dashboard.

## Objetivo

Usar este documento como checklist central da auditoria, registrando evidencias, riscos, impacto e recomendacoes priorizadas.

## Checklist da Auditoria

### 1. Arquitetura e Saude Geral

- [x] Mapear pontos de entrada do sistema
- [x] Identificar modulos criticos por negocio e risco
- [x] Verificar acoplamento excessivo, arquivos grandes e hotspots de manutencao
- [x] Avaliar consistencia de padroes entre frontend, APIs e funcoes

### 2. Frontend e Paginas

- [x] Revisar App Router e renderizacao
- [x] Identificar componentes client-heavy e re-render excessivo
- [x] Procurar gargalos de UX, polling e chamadas redundantes
- [x] Verificar risco de bundle inflado e carregamento desnecessario

### 3. APIs Next.js

- [x] Validacao de entrada
- [x] Autenticacao e autorizacao
- [x] Tratamento de erro e timeouts
- [x] Exposicao indevida de dados ou segredos
- [x] Possiveis vetores de SSRF, replay, abuso e denial of service

### 4. Supabase e Banco

- [x] Uso de `service_role`
- [x] Isolamento multi-tenant
- [x] RLS e consultas sensiveis
- [x] Padroes de leitura/escrita e custos evitaveis

### 5. Edge Functions e IA

- [x] Custo por chamada e latencia
- [x] Tamanho e complexidade dos handlers
- [x] Fallbacks, retries e resiliencia
- [x] Log de dados sensiveis
- [x] Seguranca em prompts e entrada de usuario

### 6. WhatsApp / Evolution

- [x] Autenticidade do webhook
- [x] Sanitizacao e validacao do payload
- [x] Segregacao por agente e tenant
- [x] Risco de abuso para spam, envio indevido ou propagacao em massa
- [x] Protecao de credenciais e chamadas outbound

### 7. Performance

- [x] Chamadas duplicadas
- [x] Sequencias serializadas que poderiam ser paralelizadas
- [x] Esperas artificiais no caminho critico
- [x] Operacoes pesadas sem cache, memoizacao ou limites
- [x] Oportunidades de particionar modulos grandes

### 8. Testes e Observabilidade

- [x] Executar testes existentes
- [x] Mapear lacunas de cobertura
- [x] Verificar logs, alertas e diagnosabilidade
- [x] Identificar ausencia de testes de seguranca e carga

## Regra de Classificacao

- Critico: risco de invasao, vazamento, execucao indevida, spam em massa ou quebra grave de isolamento.
- Alto: falha relevante de seguranca, performance ou resiliencia em fluxo critico.
- Medio: problema importante, mas com mitigacao parcial ou impacto restrito.
- Baixo: ajuste recomendavel de qualidade, manutencao ou eficiencia.

## Achados

## Correcoes Aplicadas Nesta Rodada

- Adicionada validacao e sanitizacao central da URL da Evolution para reduzir risco de SSRF.
- Adicionada criptografia AES-GCM para API keys da Evolution quando salvas manualmente pelo app.
- Mantida retrocompatibilidade de leitura para chaves legadas e fallback para chave vinda do ambiente.
- Removido armazenamento em texto puro da API key em provisionamento automatico; nesses casos o backend passa a depender da chave de ambiente.
- Adicionado `webhook_secret` por agente e URL de webhook assinada por token para a Evolution.
- Adicionada validacao do token do webhook antes de processar payload e enviar mensagens.
- Ajustado retorno do webhook na API do canal para preservar a URL assinada com token.
- Adicionado rate limiting basico nas rotas publicas `/api/onboarding` e `/api/conversations-turn`.
- Migration `20260319000100_agent_channel_whatsapp_webhook_secret.sql` aplicada no projeto Supabase remoto vinculado.
- Semantic core estabilizado nesta auditoria, com correcao de continuidade, finalizacao e preservacao de slots.
- Aplicado `next/dynamic` nas rotas publicas e nas abas pesadas do detalhe do agente para reduzir eager loading.
- Removida uma rodada redundante de fetch do canal WhatsApp no mount e condicionado o fetch de status ao contexto da tela.
- `LandingChat` foi desidratado do bundle inicial com carregamento sob demanda de Supabase client, restore de sessao, normalizacao de telefone e dependencias do simulador.
- `ChatThread` passou a lazy-load dos cards de signup, login e endereco, reduzindo mais um pouco o bundle inicial do onboarding.
- `ChatShell` passou a lazy-load da thread completa do chat, evitando carregar `ChatThread` e `ChatMessage` no estado vazio inicial.
- A rota dedicada do simulador e o `SimulatorPanel` passaram a lazy-load do cliente e das mensagens, reduzindo o custo inicial de `/app/simulator`.
- As rotas `login` e `signup` passaram a lazy-load dos formularios e do cliente Supabase, reduzindo o custo inicial de autenticacao.
- A rota `app/settings` foi testada com lazy loading do cliente de configuracao, sem impacto material no `First Load JS`, indicando que o gargalo remanescente esta concentrado no shared bundle do dashboard.
- O `ThemeProvider` global foi removido do root layout por estar sem uso efetivo, e o menu autenticado passou a carregar Supabase apenas no logout; o build permaneceu estavel, mas sem reducao material do shared bundle, reforcando que o custo remanescente esta concentrado em dependencias comuns de UI/runtime.
- O `SentryProvider` tambem foi testado fora do caminho inicial do root layout, sem alteracao material no shared bundle. Isso fecha a etapa de otimizacao incremental de baixo risco e confirma que o restante depende de refatoracao estrutural do pacote compartilhado.
- `next.config.js` recebeu cabecalhos basicos de seguranca para endurecer a superficie HTTP do app.
- Foi criado um workflow de CI em `.github/workflows/verify-core-and-build.yml` para obrigar semantic core, runtime fixtures e build de producao antes de merge/deploy em `master`.
- `package.json` recebeu scripts dedicados para semantic core, runtime fixture e verificacao consolidada (`ci:verify`).
- Foi criado o util central `src/lib/security/log-sanitizer.ts` e aplicadas mascaras de PII/URL em logs das rotas `conversations-turn` e do webhook Evolution, reduzindo exposicao operacional de telefone, URL e payload de erro.
- Foram adicionados schemas com `zod` nas rotas sensiveis `app/settings`, `agents/[id]/channel/whatsapp` e `whatsapp/connect/start`, reduzindo parsing permissivo e endurecendo a validacao de entrada.
- O hardening de schema foi estendido para `whatsapp/connect/retry`, `whatsapp/disconnect` e `whatsapp/instance`, fechando o fluxo principal do canal com validacao de entrada mais consistente.
- O CRUD principal de agentes tambem passou a usar `zod` em `app/agents` e `app/agents/[id]`, reduzindo body parsing frouxo na criacao e atualizacao de agentes.
- O hardening de schema foi ampliado para `agents/[id]/flow`, `appointments/[id]` e `app/simulator`, fechando as rotas irmas mais expostas do dashboard com validacao de payload mais consistente.
- A camada de chamadas OpenAI em `conversations-turn/lib/ai.ts` passou a usar helper central com timeout padronizado e reaproveitamento nas funcoes mais quentes do turno (`answerWithContextualAI`, `interpretFlowWithAI`, `interpretSemanticTurnWithAI` e `interpretBookingRequestWithAI`), reduzindo risco de travamento por upstream lento e duplicacao operacional.
- O `turn-handler.ts` foi desinchado no ponto de entrada do pipeline legado, com extracao da deteccao de resposta para attendee prompt e da montagem das fases do turno, reduzindo acoplamento local de `processSimulatorMessage` sem alterar a ordem do fluxo.
- O webhook Evolution foi endurecido operacionalmente para ignorar grupos e broadcast, limitar fan-out de notificacoes outbound, aplicar timeout nas chamadas externas e desabilitar a simulacao de digitacao por padrao, reduzindo risco de propagacao indevida e retenção longa de request.
- O webhook Evolution passou a registrar `external_message_id` em tabela de recibo dedicada para deduplicacao/idempotencia, evitando reprocessar retries duplicados do provedor e reduzir respostas repetidas ao mesmo cliente.
- As notificacoes secundarias de `outbound_notifications` sairam do caminho critico do webhook e passaram a ser enfileiradas em `whatsapp_outbox`, com endpoint interno protegido para drenagem assincrona/retry controlado.`r`n- Foi adicionado o runner operacional `scripts/drain-whatsapp-outbox.ps1` e o script `npm run drain:whatsapp-outbox`, deixando pronto o acionamento manual/cron do dreno interno do outbox.
- O detalhe do agente passou a reutilizar o estado inicial do canal WhatsApp entre a pagina e o componente da aba, reduzindo duplicacao de bootstrap e uma leitura redundante no carregamento da configuracao.
- A rota `app/agents/[id]/channel/whatsapp` passou a suportar resposta consolidada com `include_live=1`, unificando bootstrap e status vivo do canal para reduzir uma chamada separada no carregamento inicial da configuracao.
- O modal de conexao WhatsApp passou a usar polling com backoff progressivo e parada automatica quando o status sai de `connecting`, reduzindo chamadas repetidas e sincronizacoes redundantes apos `start` e `retry`.

### Criticos

- Webhook da Evolution aceita chamadas sem qualquer verificacao de autenticidade e usa o payload recebido para acionar `conversations-turn` com `service_role` e enviar mensagens reais pelo WhatsApp do cliente. Isso permite spoofing, spam e disparo indevido em massa se a URL do webhook for descoberta. Evidencias: [src/app/api/webhooks/evolution/[agentId]/route.ts](c:\Projects\Nevo\src\app\api\webhooks\evolution\[agentId]\route.ts#L22), [src/app/api/webhooks/evolution/[agentId]/route.ts](c:\Projects\Nevo\src\app\api\webhooks\evolution\[agentId]\route.ts#L45), [src/app/api/webhooks/evolution/[agentId]/route.ts](c:\Projects\Nevo\src\app\api\webhooks\evolution\[agentId]\route.ts#L116), [src/app/api/webhooks/evolution/[agentId]/route.ts](c:\Projects\Nevo\src\app\api\webhooks\evolution\[agentId]\route.ts#L174), [src/app/api/webhooks/evolution/[agentId]/route.ts](c:\Projects\Nevo\src\app\api\webhooks\evolution\[agentId]\route.ts#L245), [src/app/api/webhooks/evolution/[agentId]/route.ts](c:\Projects\Nevo\src\app\api\webhooks\evolution\[agentId]\route.ts#L300).
Readequacao recomendada: exigir assinatura HMAC ou token secreto por agente no webhook, validar IP/origem quando possivel, rejeitar requests sem prova criptografica e desacoplar envio outbound para fila interna com auditoria.

### Altos

- A chave da Evolution esta nomeada como `evolution_api_key_encrypted`, mas esta sendo salva e reutilizada em texto puro. Evidencias: [supabase/migrations/20260211000000_agent_channel_whatsapp_evolution.sql](c:\Projects\Nevo\supabase\migrations\20260211000000_agent_channel_whatsapp_evolution.sql#L15), [supabase/migrations/20260211000000_agent_channel_whatsapp_evolution.sql](c:\Projects\Nevo\supabase\migrations\20260211000000_agent_channel_whatsapp_evolution.sql#L19), [src/app/api/app/agents/[id]/channel/whatsapp/route.ts](c:\Projects\Nevo\src\app\api\app\agents\[id]\channel\whatsapp\route.ts#L188), [src/app/api/app/agents/[id]/channel/whatsapp/route.ts](c:\Projects\Nevo\src\app\api\app\agents\[id]\channel\whatsapp\route.ts#L205).
Readequacao recomendada: criptografar com KMS ou segredo de app server-side, separar storage de segredo do config operacional e nunca expor coluna crua ao app.

- `evolution_base_url` aceita URL arbitraria e depois e usada em `fetch` server-side em rotas de status, connect, retry, disconnect, remove instance e webhook. Isso abre vetor de SSRF e de abuso de egress se uma conta admin for comprometida. Evidencias: [src/app/api/app/agents/[id]/channel/whatsapp/route.ts](c:\Projects\Nevo\src\app\api\app\agents\[id]\channel\whatsapp\route.ts#L159), [src/app/api/whatsapp/connect/start/route.ts](c:\Projects\Nevo\src\app\api\whatsapp\connect\start\route.ts#L224), [src/app/api/whatsapp/connect/status/route.ts](c:\Projects\Nevo\src\app\api\whatsapp\connect\status\route.ts#L81), [src/app/api/whatsapp/disconnect/route.ts](c:\Projects\Nevo\src\app\api\whatsapp\disconnect\route.ts#L66), [src/app/api/whatsapp/instance/route.ts](c:\Projects\Nevo\src\app\api\whatsapp\instance\route.ts#L68), [src/app/api/whatsapp/connect/retry/route.ts](c:\Projects\Nevo\src\app\api\whatsapp\connect\retry\route.ts#L143).
Readequacao recomendada: validar hostname, bloquear IPs privados e loopback, manter allowlist de dominios internos autorizados e negar protocolos/portas nao esperados.

- As rotas publicas `/api/onboarding` e `/api/conversations-turn` fazem proxy para Edge Functions com CORS `*`, sem autenticacao nem rate limit. Isso aumenta risco de abuso de custo, flooding e uso nao autorizado do backend de IA. Evidencias: [src/app/api/onboarding/route.ts](c:\Projects\Nevo\src\app\api\onboarding\route.ts#L3), [src/app/api/onboarding/route.ts](c:\Projects\Nevo\src\app\api\onboarding\route.ts#L29), [src/app/api/onboarding/route.ts](c:\Projects\Nevo\src\app\api\onboarding\route.ts#L105), [src/app/api/conversations-turn/route.ts](c:\Projects\Nevo\src\app\api\conversations-turn\route.ts#L3), [src/app/api/conversations-turn/route.ts](c:\Projects\Nevo\src\app\api\conversations-turn\route.ts#L35), [src/app/api/conversations-turn/route.ts](c:\Projects\Nevo\src\app\api\conversations-turn\route.ts#L81).
Readequacao recomendada: aplicar rate limiting por IP/session, challenge anti-bot, limites de tamanho de payload e, no minimo, telemetria e circuit breaker por tenant/origem.

- O semantic core entrou na auditoria com regressao de saude relevante e import invalido em [supabase/functions/conversations-turn/lib/http.ts](c:\Projects\Nevo\supabase\functions\conversations-turn\lib\http.ts#L2), afetando continuidade de agendamento, opcoes de acao e fluxo de calendario. O risco foi corrigido nesta rodada e a suite voltou a verde.
Readequacao recomendada: manter gate de CI obrigatorio para semantic core antes de deploy e evitar merge de alteracoes sem fixture/runtime suite verde.

### Medios

- O webhook adiciona atraso artificial de digitacao de 2.2s a 4.2s dentro da propria requisicao. Isso aumenta custo, tempo de CPU ocupado, chance de retry do provedor e reduz throughput sob carga. Evidencias: [src/app/api/webhooks/evolution/[agentId]/route.ts](c:\Projects\Nevo\src\app\api\webhooks\evolution\[agentId]\route.ts#L6), [src/app/api/webhooks/evolution/[agentId]/route.ts](c:\Projects\Nevo\src\app\api\webhooks\evolution\[agentId]\route.ts#L239).
Readequacao recomendada: responder rapido ao webhook, mover typing/send para job assincrono ou remover simulacao de digitacao do canal WhatsApp.

- O carregamento inicial do onboarding/home era um dos principais hotspots. A mitigacao aplicada nesta auditoria reduziu o `First Load JS` de 180 kB para 116 kB ao carregar sob demanda partes pesadas de `LandingChat`, `ChatThread` e cards contextuais, mas o fluxo ainda concentra responsabilidade demais no mesmo dominio de componente. Evidencias: [src/app/page.tsx](c:\Projects\Nevo\src\app\page.tsx#L1), [src/app/onboarding/page.tsx](c:\Projects\Nevo\src\app\onboarding\page.tsx#L1), [src/components/onboarding/LandingChat.tsx](c:\Projects\Nevo\src\components\onboarding\LandingChat.tsx#L1), [src/components/shared/ChatShell.tsx](c:\Projects\Nevo\src\components\shared\ChatShell.tsx#L1), [src/components/shared/ChatThread.tsx](c:\Projects\Nevo\src\components\shared\ChatThread.tsx#L1).
Readequacao recomendada: continuar a separacao de `LandingChat` por dominio funcional, principalmente auth/signup/login, conexao WhatsApp e restauracao de estado.

- A pagina de detalhe do agente carregava editor basico, canal WhatsApp, flow builder e simulador de uma vez no client. O risco foi parcialmente mitigado nesta auditoria com lazy loading por aba, reduzindo o `First Load JS` de 162 kB para 138 kB em `/app/agentes/[agentId]`. Evidencias: [src/app/(dashboard)/app/agentes/[agentId]/page.tsx](c:\Projects\Nevo\src\app\(dashboard)\app\agentes\[agentId]\page.tsx#L1).
Readequacao recomendada: manter `next/dynamic` por aba, revisar dependencias do editor basico e evitar bootstrap de canal/status fora dos casos em que a UI realmente precisa.

- A rota `/app/simulator` carregava mais UI do que o necessario no primeiro paint. A mitigacao aplicada nesta auditoria reduziu o `First Load JS` de 115 kB para 111 kB com carregamento sob demanda do cliente e dos blocos de mensagem. Evidencias: [src/app/(dashboard)/app/simulator/page.tsx](c:\Projects\Nevo\src\app\(dashboard)\app\simulator\page.tsx#L1), [src/features/simulator/components/SimulatorPanel.tsx](c:\Projects\Nevo\src\features\simulator\components\SimulatorPanel.tsx#L1).
Readequacao recomendada: manter o simulador desacoplado da arvore principal de dashboard e evitar importar renderers de mensagem quando o estado esta vazio.

- As rotas de autenticacao estavam acima do necessario para telas simples de formulario. A mitigacao aplicada nesta auditoria reduziu `login` de 151 kB para 98.1 kB e `signup` de 160 kB para 107 kB com carregamento sob demanda dos formularios e do cliente Supabase. Evidencias: [src/app/login/page.tsx](c:\Projects\Nevo\src\app\login\page.tsx#L1), [src/app/login/LoginForm.tsx](c:\Projects\Nevo\src\app\login\LoginForm.tsx#L1), [src/app/signup/page.tsx](c:\Projects\Nevo\src\app\signup\page.tsx#L1), [src/app/signup/SignupForm.tsx](c:\Projects\Nevo\src\app\signup\SignupForm.tsx#L1).
Readequacao recomendada: manter os fluxos de autenticacao com shell server-first e carregar integracoes de auth apenas no submit ou na montagem do formulario.

- Existem chamadas redundantes e polling evitavel no fluxo do canal WhatsApp. Bootstrap e status vivo foram consolidados nesta auditoria, e o modal de conexao passou a usar backoff com parada automatica quando o status estabiliza. Evidencias: [src/app/(dashboard)/app/agentes/[agentId]/page.tsx](c:\Projects\Nevo\src\app\(dashboard)\app\agentes\[agentId]\page.tsx#L113), [src/features/agents/components/AgentChannelWhatsApp.tsx](c:\Projects\Nevo\src\features\agents\components\AgentChannelWhatsApp.tsx#L62), [src/features/agents/components/AgentChannelWhatsApp.tsx](c:\Projects\Nevo\src\features\agents\components\AgentChannelWhatsApp.tsx#L87), [src/features/agents/components/AgentChannelWhatsApp.tsx](c:\Projects\Nevo\src\features\agents\components\AgentChannelWhatsApp.tsx#L110).
Readequacao recomendada: se houver nova rodada de otimizacao, mover o polling restante para um hook dedicado e limitar refresh manual a eventos de transicao ou erro.

- Logs atuais registram previews de mensagem, telefone e URLs operacionais em caminhos sensiveis. Evidencias: [src/app/api/onboarding/route.ts](c:\Projects\Nevo\src\app\api\onboarding\route.ts#L18), [src/app/api/webhooks/evolution/[agentId]/route.ts](c:\Projects\Nevo\src\app\api\webhooks\evolution\[agentId]\route.ts#L168), [src/app/api/webhooks/evolution/[agentId]/route.ts](c:\Projects\Nevo\src\app\api\webhooks\evolution\[agentId]\route.ts#L264), [src/app/api/webhooks/evolution/[agentId]/route.ts](c:\Projects\Nevo\src\app\api\webhooks\evolution\[agentId]\route.ts#L315).
Readequacao recomendada: mascarar PII, truncar payloads, centralizar logger com niveis e redacao automatica.

### Baixos

- Falta padronizacao forte de schema validation nas rotas Next. O fluxo principal de agentes, WhatsApp, flow, appointments e simulator foi endurecido nesta auditoria, mas ainda existem leituras de `req.json()` sem Zod ou schema equivalente em areas secundarias, o que piora seguranca defensiva e previsibilidade de erro.

- `next.config.js` entrou na auditoria sem cabecalhos de seguranca. O risco foi parcialmente mitigado nesta rodada com CSP basica, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options` e `Cross-Origin-Opener-Policy`. Evidencia: [next.config.js](c:\Projects\Nevo\next.config.js#L1).

## Execucao do Checklist

- Status atual: concluido
- Rodada de mitigacao aplicada em codigo: parcial
- Testes executados:
- `cmd /c npx deno test --no-check --allow-env supabase/functions/conversations-turn/lib/semantic-core/semantic-core.test.ts` -> 54 passaram, 0 falharam.
- `cmd /c npx deno test --no-check --allow-env supabase/functions/conversations-turn/lib/semantic-core/semantic-runtime-fixture.test.ts` -> 50 passaram, 0 falharam.
- `cmd /c npm run build` -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos mitigacoes de seguranca -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos mitigacoes de performance -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos lazy loading interno de `LandingChat` -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos lazy loading dos cards do chat e headers de seguranca -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos lazy loading de `ChatThread` no estado vazio do onboarding -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos lazy loading do cliente e das mensagens do simulador -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos lazy loading dos formularios de autenticacao e do cliente Supabase -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos teste de lazy loading em `app/settings` -> build de producao concluida com sucesso, sem reducao material no `First Load JS` da rota.
- `cmd /c npm run build` apos remocao do `ThemeProvider` global e adiamento do cliente Supabase no menu autenticado -> build de producao concluida com sucesso, sem reducao material no shared bundle.
- `cmd /c npm run build` apos adiar o `SentryProvider` do root layout -> build de producao concluida com sucesso, sem reducao material no shared bundle.
- `cmd /c npm run test:semantic-core` -> 54 passaram, 0 falharam.
- `cmd /c npm run test:semantic-runtime` -> 50 passaram, 0 falharam.
- `cmd /c npm run build` apos criacao do gate de CI -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos sanitizacao de logs sensiveis -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos adicionar schema validation nas rotas sensiveis -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos estender schema validation para as rotas irmas do fluxo WhatsApp -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos adicionar `zod` no CRUD principal de agentes -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos estender `zod` para flow, appointments e simulator -> build de producao concluida com sucesso.
- `cmd /c npm run test:semantic-core` apos centralizar chamadas OpenAI quentes -> suite verde.
- `cmd /c npm run test:semantic-runtime` apos centralizar chamadas OpenAI quentes -> suite verde.
- `cmd /c npm run build` apos centralizar chamadas OpenAI quentes -> build de producao concluida com sucesso.
- `cmd /c npm run test:semantic-core` apos desinchar `turn-handler.ts` -> suite verde.
- `cmd /c npm run test:semantic-runtime` apos desinchar `turn-handler.ts` -> suite verde.
- `cmd /c npm run build` apos desinchar `turn-handler.ts` -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos endurecer operacionalmente o webhook Evolution -> build de producao concluida com sucesso.
- `cmd /c npx supabase db push --include-all --linked` apos criar recibo de webhook -> schema remoto sincronizado.
- `cmd /c npm run build` apos adicionar idempotencia no webhook Evolution -> build de producao concluida com sucesso.
- `cmd /c npx supabase db push --include-all --linked` apos criar `whatsapp_outbox` -> schema remoto sincronizado.
- `cmd /c npm run build` apos mover outbound secundario para outbox -> build de producao concluida com sucesso.`r`n- `cmd /c npm run build` apos adicionar runner operacional do outbox -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos deduplicar o bootstrap inicial do canal WhatsApp entre a pagina do agente e a aba de canais -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos consolidar bootstrap + live status do canal WhatsApp no backend -> build de producao concluida com sucesso.
- `cmd /c npm run build` apos aplicar backoff e parada automatica no polling do canal WhatsApp -> build de producao concluida com sucesso.
- `cmd /c npx supabase migration list --linked` -> remoto sincronizado com `20260319000100`.
- Indicadores observados na build:
- `/` e `/onboarding`: `First Load JS` de 116 kB.
- `/app/agentes/[agentId]`: `First Load JS` de 138 kB.
- `/app/simulator`: `First Load JS` de 111 kB.
- `/login`: `First Load JS` de 98.1 kB.
- `/signup`: `First Load JS` de 107 kB.
- Maiores hotspots de manutencao por tamanho:
- `supabase/functions/onboarding-chat/index.ts`
- `supabase/functions/conversations-turn/lib/ai.ts`
- `src/components/onboarding/LandingChat.tsx`
- `supabase/functions/conversations-turn/lib/turn-handler.ts`

## Resumo Executivo

- A auditoria encontrou riscos reais em webhook WhatsApp, protecao de credenciais, abuso de rotas publicas e SSRF. A maior parte dos vetores mais perigosos foi mitigada nesta rodada.
- A saude funcional do semantic core foi recuperada e a suite voltou a verde, removendo um risco relevante de regressao em producao.
- A performance de rotas publicas melhorou de forma material, com reducoes relevantes de bundle no onboarding, autenticacao e parte do dashboard.
- A fase de otimizacao incremental de baixo risco foi praticamente esgotada. O principal custo remanescente agora esta no shared bundle comum e em componentes grandes com responsabilidade excessiva.
- O sistema esta mais seguro e mais leve do que no inicio da auditoria, mas ainda existe backlog importante antes de considerar a base realmente endurecida.

## Estado Final da Auditoria

- Seguranca critica: parcialmente mitigada
- Performance frontend: mitigada com ganho material
- Saude funcional do core conversacional: estabilizada
- Observabilidade e hardening operacional: parcial
- Refatoracao estrutural pendente: sim

## Backlog Priorizado

### P0

- Fechar definitivamente o webhook WhatsApp com prova criptografica obrigatoria, validacao de origem quando possivel e processamento assíncrono.
- Garantir storage seguro definitivo de credenciais da Evolution com segredo de ambiente gerenciado e rotação operacional clara.
- Manter gate de CI obrigatorio para semantic core, runtime fixtures e build de producao.

### P1

- Consolidar bootstrap e status do canal WhatsApp para reduzir fetch duplicado, polling e custo por abertura de tela.
- Separar `LandingChat` por dominio funcional: auth, restore, WhatsApp connect, simulador e fluxo principal.
- Atacar o shared bundle comum do dashboard com refatoracao estrutural, em vez de novos lazy loads pontuais.
- Redigir logs sensiveis automaticamente para mascarar telefone, mensagem e URLs operacionais.

### P2

- Padronizar validacao de entrada com schema em rotas Next.js sensiveis.
- Revisar CSP atual para endurecimento progressivo, reduzindo dependencias de `unsafe-inline` e `unsafe-eval` quando viavel.
- Revisar hotspots grandes de manutencao em `ai.ts`, `turn-handler.ts`, `LandingChat.tsx` e `onboarding-chat/index.ts`.

## Ordem Recomendada de Execucao

1. Hardening final de webhook e credenciais.
2. Gate de CI e testes obrigatorios de semantic core.
3. Consolidacao do canal WhatsApp e limpeza de polling.
4. Refatoracao estrutural de `LandingChat`.
5. Ataque dedicado ao shared bundle do dashboard.
6. Padronizacao de schemas, logs e hardening restante.

## Criterio de Encerramento

- Webhook autenticado e auditavel.
- Credenciais da Evolution fora de qualquer fluxo de persistencia insegura.
- Suites do semantic core obrigatorias em CI.
- Shared bundle do dashboard revisitado apos refatoracao estrutural.
- Logs com redacao automatica de PII.
- Rotas sensiveis com validacao de schema consistente.

## Operacao do Outbox

- Endpoint interno de drenagem: /api/internal/whatsapp-outbox/drain
- Autenticacao: Authorization: Bearer <WHATSAPP_OUTBOX_SECRET> ou header x-outbox-secret
- Script local/servidor: 
pm run drain:whatsapp-outbox
- Variaveis de ambiente necessarias:
- WHATSAPP_OUTBOX_SECRET
- NEXT_PUBLIC_APP_URL para ambientes remotos, ou use BaseUrl manual no script

Exemplo de execucao:

`powershell
powershell -ExecutionPolicy Bypass -File C:\Projects\Nevo\scripts\drain-whatsapp-outbox.ps1 -BaseUrl "https://nevoqa.pratikapp.com.br" -Secret "<WHATSAPP_OUTBOX_SECRET>"
`

Frequencia recomendada:

- a cada 1 minuto em QA/producao enquanto o canal WhatsApp estiver ativo
