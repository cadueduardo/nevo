# Estratégia para implementar o roadmap sem comprometer o MVP atual

Este documento define como aplicar o branch **feature/assistente-pessoal-orcamento** de forma que o que já existe continue funcionando e, em caso de desastre, você possa **voltar o Nevo ao MVP atual** com o mínimo de risco.

---

# 1. Princípio geral: isolar ao máximo

- **Aditivo > modificativo:** prefira sempre **adicionar** (novas tabelas, novas colunas NULL, novos arquivos, novos branches no código) em vez de alterar o que já existe.
- **Feature flag:** um único ponto (ENV ou config) que desliga toda a lógica nova faz o sistema se comportar como o MVP atual.
- **Banco:** migrações só aditivas; nenhum `DROP`, nenhum `ALTER COLUMN` que mude tipo ou remova coluna usada pelo MVP.
- **Código:** novos fluxos entram por **ifs** explícitos (ex.: `if (context.mode === 'internal')`) para que, sem o flag ou sem os dados novos, o caminho seja o de hoje.

---

# 2. Git e branch

- **main (ou master)** = estado atual do MVP. Não fazer merge do feature até validação completa.
- **feature/assistente-pessoal-orcamento** = todo o trabalho do roadmap.
- **Tag de segurança:** antes de começar, criar uma tag no commit atual da main, ex.: `git tag mvp-pre-assistente-orcamento`. Assim você sempre tem um ponto de retorno: `git checkout mvp-pre-assistente-orcamento` (ou restaurar a branch main a partir dessa tag).
- **Merge apenas quando:** todas as fases validadas, testes do fluxo antigo passando, e decisão explícita de ativar em produção. Até lá, manter o feature branch longe da main.

---

# 3. Banco de dados

## 3.1 Regras de ouro

- **Só migrações aditivas.** Nada de:
  - `DROP TABLE` em tabelas usadas pelo MVP
  - `ALTER TABLE ... DROP COLUMN`
  - `ALTER COLUMN ... TYPE` em colunas já usadas (pode quebrar app atual)
- **Novas tabelas** com prefixo ou nome que deixe claro que são do novo fluxo (ex.: `quote_service`, `internal_rate_limit`, `internal_action_log`). Não renomear tabelas existentes.
- **Novas colunas** em tabelas existentes: sempre `ADD COLUMN ... NULL` ou com `DEFAULT`, para o código antigo não depender delas. Ex.: `tenant_user.phone_number` = NULL; `request.blueprint_id` = NULL; etc.
- **RLS:** políticas novas apenas para tabelas novas ou para colunas novas; não alterar políticas existentes que protegem o MVP, a menos que seja estritamente necessário e documentado.

## 3.2 Nomenclatura sugerida para migrações

- Usar um prefixo de data + nome descritivo, ex.: `20260224000000_assistente_pessoal_tenant_user_phone.sql`, `20260224000001_quote_service_and_request_fields.sql`.
- Manter um **único arquivo de migração por mudança lógica** (uma para tenant_user, um para quote_service + request, um para internal_rate_limit, etc.) para facilitar rollback mental e revisão.

## 3.3 Rollback de banco (se precisar voltar)

- **Não** rodar “migração reversa” que dropa tabelas/colunas se o app em produção já tiver usado esses recursos (pode quebrar o app ao voltar).
- **Estratégia segura:** em caso de rollback, você volta o **código** para o commit/tag do MVP. O banco fica com as tabelas/colunas novas; o app antigo simplesmente **não as usa**. Tabelas novas (quote_service, internal_rate_limit, etc.) ficam vazias e inofensivas; colunas novas (phone_number, blueprint_id, etc.) ficam NULL e ignoradas.
- Se no futuro quiser “limpar” o banco das estruturas não usadas, fazer isso em uma migração separada, **depois** de o MVP estar estável de novo e com backup.

## 3.4 Ambiente de QA (segundo projeto Supabase)

Para testar o roadmap **antes** de subir para produção, use um **segundo projeto** no Supabase (ex.: projeto QA).

- **Arquivo de exemplo:** `.env.qa.example` na raiz (copie para `.env.qa` e preencha as chaves).
- **Projeto QA:** `jfxlbffnzliapmcxfata` — URL: `https://jfxlbffnzliapmcxfata.supabase.co`
- **Passos:** (1) Preencher `.env.qa` com Anon Key, Service Role e DB password do dashboard do projeto QA; (2) `supabase link --project-ref jfxlbffnzliapmcxfata` e `supabase db push`; (3) Deploy das Edge Functions no projeto QA; (4) Rodar o app com env do QA (local: copiar `.env.qa` para `.env.local`; VPS: instância separada).
- **Segurança:** `.env.qa` está no `.gitignore`; nunca commitar nem expor a **service_role**.

---

# 4. Código (Next.js, Edge Functions, libs)

## 4.1 Feature flag global

- Definir uma variável de ambiente, ex.: `NEXT_PUBLIC_FEATURE_ASSISTENTE_ORCAMENTO=false` (e equivalente para Edge Functions, se usarem ENV).
- **Onde usar:** nos pontos de entrada da lógica nova:
  - Webhooks (Twilio/Evolution): antes de chamar `resolveActorByPhone` ou passar `mode`/`actor_type`, checar o flag. Se desligado: não resolver actor, não injetar mode no context; seguir exatamente o fluxo atual (só atendimento external).
  - Edge Function `conversations-turn`: no início, se flag desligado, ignorar `context.mode === 'internal'` e nunca executar intents de agenda/contato/orçamento internal; seguir só o fluxo atual (booking/quote existente).
- Com o flag em `false`, o sistema se comporta como o MVP atual mesmo com novas colunas e novas tabelas no banco.

## 4.2 Isolar por módulos e entrada

- **Novo código em arquivos/pastas separados:**
  - `src/lib/quote-engine/` (todo o motor de orçamento) — o MVP atual não importa essa pasta.
  - Funções auxiliares novas: ex. `resolveActorByPhone` em `src/lib/actor.ts` ou em pasta dedicada; o webhook só chama se o feature flag estiver ligado.
- **Pontos de entrada únicos:** a lógica “internal” e “quote engine” deve ser acionada em poucos lugares explícitos (ex.: webhook após identificar agent; dentro do conversations-turn em um `if (context.mode === 'internal')` ou `if (featureAssistenteOrcamento && ...)`). O restante do turn continua igual ao de hoje.
- **Evitar:** espalhar `if (mode === 'internal')` em dezenas de arquivos sem um “guard” central. Ideal: um único lugar (ex.: no início do handler do turn) que decide se entra no fluxo “MVP antigo” ou no fluxo “assistente + orçamento”.

## 4.3 Tabelas/entidades existentes (request, conversation, appointment)

- **request:** só **adicionar** colunas (blueprint_id, total_value, currency, calculation_result, is_estimated). O código atual que lê/escreve `request` continua funcionando; o código novo preenche as colunas novas quando gerar orçamento.
- **conversation.context:** o context já é JSONB. O código novo **adiciona** as chaves `mode` e `actor_type` quando o feature está ligado. O código antigo não depende delas; se não existirem, tratar como “só external”.
- **appointment:** não alterar estrutura; usar como está. Cancelamento = status + cancellation_reason já existentes.
- Assim, o MVP atual não quebra e o novo fluxo só usa “extensões”.

---

# 5. Edge Functions (Supabase)

- **conversations-turn:** é o ponto mais sensível. Estratégia:
  - Manter o fluxo atual intacto (todo o bloco que hoje trata mensagem → booking/quote existente).
  - No **início** da função: ler feature flag (ENV). Se desligado, pular qualquer resolução de actor e qualquer branch “internal”; passar adiante como hoje.
  - Lógica nova (resolveActor, intents internal, quote-engine) em **módulos separados** (ex.: `lib/internal-handler.ts`, `lib/quote-internal.ts`) importados só quando o flag estiver ligado ou quando `context.mode === 'internal'`.
- **Outras Edge Functions** (onboarding-chat, etc.): se tiver mudanças (ex.: branding opcional), fazer em blocos condicionais ou steps opcionais que, quando desativados, deixam o fluxo igual ao atual.

---

# 6. Webhooks (Twilio / Evolution)

- Hoje: recebem mensagem, montam context, chamam conversations-turn.
- Mudança: antes de chamar o turn, **se** feature flag ligado, chamar `resolveActorByPhone(tenant_id, from)` e injetar `mode` e `actor_type` no payload (ou no context que o turn vai persistir). Se flag desligado, **não** chamar resolveActor e **não** enviar mode/actor_type; o turn recebe o mesmo payload de hoje.
- Assim, o “contrato” do turn não quebra: ele só passa a receber dois campos a mais quando o feature está ativo.

---

# 7. Rollback em caso de desastre

1. **Reverter código:** voltar a branch main (ou a tag `mvp-pre-assistente-orcamento`) e fazer deploy da aplicação e das Edge Functions nesse estado. O sistema volta a se comportar como o MVP.
2. **Banco:** não reverter migrações em produção (evita novos erros). O app antigo ignora tabelas e colunas novas.
3. **Feature flag:** se você tiver deployado com o flag em `true` e quiser desligar rápido, colocar o flag em `false` e redeployar (ou reiniciar) pode ser suficiente para “esconder” a feature sem voltar commit.
4. **Backup de banco:** antes de aplicar migrações do feature em produção, fazer backup (export ou snapshot). Em caso de rollback, você restaura o backup só se tiver aplicado migrações destrutivas (o que esta estratégia evita).

---

# 8. Checklist antes do merge para main

- [ ] Tag `mvp-pre-assistente-orcamento` (ou equivalente) criada no commit atual da main.
- [ ] Todas as migrações são **aditivas** (sem DROP/ALTER destrutivo em estruturas usadas pelo MVP).
- [ ] Feature flag implementado e testado (flag = false → comportamento idêntico ao MVP).
- [ ] Fluxo atual (booking, atendimento cliente, simulador) testado **com o feature ligado e desligado**.
- [ ] Novos módulos (quote-engine, resolveActor, internal intents) não são importados nem executados quando o flag está desligado.
- [ ] Documentação do flag e do procedimento de rollback atualizada (este doc ou o README).

---

# 9. Resumo em uma frase

**Adicionar sem alterar o que já existe; guardar atrás de um feature flag; banco só migrações aditivas; em desastre, voltar o código ao MVP e deixar o banco como está.**

Referência do que implementar: `docs/roadmap-assistente-pessoal-e-orcamento.md`.
