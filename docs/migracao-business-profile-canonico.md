# Migração para Business Profile Canônico

## Objetivo

Reduzir a fragmentação do domínio do negócio até chegar a uma leitura única em runtime:

1. onboarding coleta
2. `business_profile` consolida
3. `agent_narrative` deriva
4. simulador e atendimento consomem a mesma estrutura
5. a IA responde
6. o sistema apenas valida, persiste e executa

## Princípios de Execução

- nenhuma camada nova entra sem declarar qual camada antiga vai matar
- compatibilidade herdada só pode existir em adaptador de borda
- remoção faz parte da entrega, não de “fase futura”
- toda fase termina com busca de referências antigas e limpeza explícita
- o núcleo não pode conviver indefinidamente com contratos paralelos

## Fonte Canônica Alvo

Artefato alvo:

- `business_profile`

Subestrutura prioritária da migração:

- `business_profile.services`

Cada serviço deve concentrar:

- `name`
- `description`
- `base_price`
- `duration_minutes`
- `bookable`
- `catalog_visible`
- `sequence_eligible`

## Contratos Antigos que Precisam Morrer

### Serviços

- `services`
- `booking_services`
- `catalog_services`

### Regra

- eles podem continuar temporariamente apenas como entrada de adaptador
- eles não podem continuar como fonte de verdade no runtime

## Fases

### Fase 1: Canonização de Serviços

Objetivo:

- centralizar normalização e merge de serviços em um único módulo canônico

Entrega mínima:

- módulo único de serviços canônicos
- `conversations-turn` deixa de reconciliar listas em vários pontos
- `business_brain` passa a consumir reconciliação central

Critério de remoção:

- remover merges locais equivalentes no entrypoint, `request-helpers`, `business-brain` e `informational-context`

### Fase 2: Introdução do `business_profile`

Objetivo:

- materializar um contrato único do domínio do negócio

Entrega mínima:

- tipo explícito de `business_profile`
- adaptador legado que traduz `services`, `booking_services` e `catalog_services` para `business_profile.services`

Critério de remoção:

- nenhum módulo novo do runtime pode depender diretamente das três listas antigas

### Fase 3: Onboarding como produtor do perfil canônico

Objetivo:

- fazer o onboarding persistir o perfil consolidado

Entrega mínima:

- `onboarding-chat` produz `business_profile`
- narrativa final e simulador passam a ler o perfil consolidado

Critério de remoção:

- parar de usar projeções intermediárias locais para reconstruir serviços no frontend

### Fase 4: Simulador e Conversation lendo o mesmo perfil

Objetivo:

- eliminar divergência entre o que o onboarding mostra e o que o simulador atende

Entrega mínima:

- simulador usa `business_profile`
- `conversations-turn` usa `business_profile`

Critério de remoção:

- eliminar a necessidade de merges redundantes na borda do request

### Fase 5: Corte do Contrato Herdado

Objetivo:

- remover o suporte espalhado aos formatos antigos

Entrega mínima:

- manter compatibilidade apenas no adaptador
- remover referências órfãs de `services`, `booking_services`, `catalog_services`

Critério de remoção:

- `rg` em todo o projeto não deve mais encontrar uso desses contratos fora do adaptador, testes de compatibilidade e migração histórica

## Matriz de Descarte

| Elemento antigo | Substituto | Onde pode sobreviver temporariamente | Critério de morte |
| --- | --- | --- | --- |
| `services` | `business_profile.services` | adaptador legado | nenhum uso direto no runtime |
| `booking_services` | `business_profile.services[].bookable` | adaptador legado | nenhum uso direto fora do adaptador |
| `catalog_services` | `business_profile.services[].catalog_visible` | adaptador legado | nenhum uso direto fora do adaptador |
| merges locais de serviço | módulo canônico central | lugar nenhum | removidos no mesmo bloco |
| contexto montado manualmente no simulador | consumo direto do perfil canônico | frontend temporário até migração da fase 4 | simulador deixa de reconstruir serviços |

## Regras de Verificação por Fase

- rodar `rg` pelos contratos antigos
- listar referências restantes
- registrar no documento o que foi removido
- não encerrar a fase com caminho antigo equivalente ainda ativo sem justificativa explícita

## Estado Atual

- Fase 1: iniciada
- módulo canônico de serviços no `conversations-turn`: criado
- deduplicação do merge de serviços no runtime: em andamento
- Fase 2: iniciada
- `business_profile` introduzido no contrato do runtime como fonte preferencial de serviços, ainda derivado por adaptador dos formatos antigos
- Fase 3: iniciada
- onboarding passou a persistir `business_profile` em `collected_data` e a expor esse contrato no `extracted_data` para simulador e frontend local
- Fase 4: iniciada
- simulador passou a preferir `business_profile.services` como fonte de leitura e só reconstruir listas antigas em fallback compatível
- `request-helpers` do `conversations-turn` passaram a preferir `business_profile.services` ao carregar configuração de `agent_setting`, `tenant_setting` e `onboarding_sessions`
- a projeção reversa `business_profile -> services/booking_services/catalog_services` começou a ser centralizada em adaptador explícito, reduzindo reconstruções ad hoc no entrypoint e na migração do onboarding
- `ai.ts`, `builders.ts` e `services.ts` começaram a ler o catálogo efetivo por helper canônico, em vez de acessar `config.services` diretamente como contrato implícito
- `anytime-handlers`, `resolve-booking`, `ensure-mode`, `turn-handler`, `turn/early/*` e os principais handlers de `booking/*` passaram a resolver serviços pelo helper canônico, reduzindo o uso direto de `config.services` na orquestração interna
- `informational`, `orchestrator-actions`, `qualification`, `internal-intents` e a rota `src/app/api/onboarding/migrate` passaram a preferir `business_profile`/helper canônico; o inventário restante ficou concentrado em adaptadores explícitos, tipos e testes de compatibilidade
- `conversations-turn/index.ts` ficou mais claramente posicionado como borda de compatibilidade, e os contratos herdados expostos em `types.ts`/`src/lib/simulator/api.ts` passaram a ser marcados explicitamente como temporários/deprecated
- rotas auxiliares do app (`agents` e preview local de `conversations-turn`) passaram a preferir `business_profile.services`, reduzindo leitura herdada até em observabilidade e contagem de catálogo

- `request-helpers`, `business-brain` e `informational-context` passaram a consumir o resolvedor can?nico de servi?os diretamente, reduzindo fallback herdado espalhado e deixando a leitura compat?vel concentrada no helper central
- o entrypoint de `conversations-turn` ganhou `syncConfigServiceViews(...)` para parar de repetir sincroniza??o manual entre `business_profile`, `services`, `booking_services` e `catalog_services` em cada hidrata??o
- a rota local de preview de `conversations-turn` passou a priorizar `business_profile.services` e s? cair para contratos herdados como fallback expl?cito de observabilidade
- o app ganhou um helper compartilhado de `business_profile`, e `src/lib/simulator/context.ts` + `src/app/api/onboarding/migrate/route.ts` passaram a usar a mesma canoniza??o/proje??o de servi?os, reduzindo duplica??o entre simulador e migra??o de onboarding
- o runtime ganhou `resolveSequenceEligibleServicesFromConfig(...)`, e `builders`, `anytime-handlers`, `booking/ai-slots`, `booking/finalization`, `booking/time-and-availability`, `qualification` e `business-brain` deixaram de depender de `sequence_eligible_services` espalhado como fonte paralela na maior parte do fluxo
- o app passou a encapsular leitura canônica em helpers (`buildCanonicalBusinessProfileFromConfig` / `getCanonicalServiceCountFromConfig`), removendo referências explícitas a `services`, `booking_services`, `catalog_services` e `sequence_eligible_services` das rotas de agentes e da página do dashboard
- o contrato público do simulador/request deixou de expor listas legadas de serviço; a compatibilidade restante ficou isolada na borda do `conversations-turn`, onde o adaptador ainda tolera payload antigo de forma consciente
