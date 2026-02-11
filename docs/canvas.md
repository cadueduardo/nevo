# Canvas de Fluxo do Agente — Especificação Oficial (Nevo)

> **Documento obrigatório para implementação do Canvas de Fluxo (Modo Avançado).**  
> Este canvas **não é ilustrativo**. Ele é um **editor funcional** que define o comportamento real do agente em produção (WhatsApp-first).

---

## 1. Objetivo do Canvas

O **Canvas de Fluxo** permite editar o comportamento do agente de forma **visual, determinística e segura**.

Ele deve permitir:
- criar, editar e remover passos do atendimento
- visualizar claramente a ordem do fluxo
- editar mensagens, perguntas, decisões e nós de IA
- refletir exatamente o que o runtime executa
- garantir compatibilidade total com **WhatsApp**

Se o usuário **não consegue alterar o fluxo**, o canvas **está errado**.

---

## 2. O que o Canvas NÃO é

❌ diagrama ilustrativo  
❌ mock visual  
❌ visualização readonly  
❌ onboarding desenhado  

O canvas é um **editor funcional de fluxo**.

---

## 3. Tipos oficiais de nós (obrigatório)

O canvas só pode utilizar nós suportados pelo runtime do Nevo.

| Tipo        | Código      | Descrição                                      |
|-------------|-------------|-----------------------------------------------|
| Trigger     | `start`     | Início do atendimento                          |
| Mensagem    | `message`   | Envia mensagem ao cliente                     |
| Pergunta    | `question`  | Coleta resposta do cliente                    |
| IA          | `ai`        | Execução explícita de LLM                     |
| Condição    | `condition` | Bifurcação por regra                          |
| Handoff     | `handoff`   | Transferência para humano                     |
| Fim         | `end`       | Encerramento do fluxo                         |

❗ **Não existe nó genérico.**

---

## 4. Ações obrigatórias no Canvas

### 4.1. Criar nós
- Botão `+` **entre nós**
- Botão `+` **no final do fluxo**
- Modal/menu para escolher o tipo do nó

### 4.2. Selecionar nós
- Clique seleciona o nó
- Nó selecionado deve:
  - ter destaque visual
  - abrir o Inspector

### 4.3. Editar nós
- Edição nunca ocorre diretamente no canvas
- Toda edição ocorre no **Inspector (painel lateral)**

### 4.4. Remover nós
- Ação “Remover” no Inspector
- Confirmação obrigatória

### 4.5. Reordenar fluxo
- Fluxo principal é **vertical** (layout automático quando não há posição salva)
- Condições criam ramificações laterais
- **Drag-and-drop** dos nós é permitido para organizar o layout; as posições são salvas ao soltar

> O runtime é determinístico → o canvas deve ser **guiado**, não caótico.

---

## 5. Conexões (linhas) — Regras

- Cada nó possui:
  - 1 entrada (exceto `start`)
  - 1 ou mais saídas
- Conexões são criadas automaticamente pelo sistema
- Usuário **não desenha linhas livremente**
- Em nós `condition`, cada saída deve ter **label obrigatória**
  - ex.: `booking`, `quote`, `else`

---

## 6. Inspector (painel lateral)

O Inspector é o **coração do Canvas**.

Sem Inspector funcional, o Canvas é considerado **incompleto**.

### 6.1. Funções do Inspector
- Editar conteúdo do nó
- Editar regras e condições
- Editar prompts de IA
- Validar compatibilidade WhatsApp

---

## 7. Conteúdo do Inspector por tipo de nó

### 7.1. `message`
- Textarea da mensagem
- Tipo de UI:
  - texto
  - botões
  - lista
- Preview WhatsApp **ao vivo**

### 7.2. `question`
- Mensagem exibida
- Variável salva (`variable`)
- Tipo de resposta esperada
- Preview WhatsApp

### 7.3. `ai`
- Objetivo da IA (label)
- Prompt template (textarea)
- Variáveis disponíveis
- Schema de saída (visual, não código)
- Aviso explícito: “IA é usada neste ponto”

### 7.4. `condition`
- Regra da condição (ex.: `intent == booking`)
- Edição das saídas e labels

### 7.5. `handoff`
- Motivo do handoff
- Regra de acionamento (sempre / condicional)

---

## 8. WhatsApp-first (regra inegociável)

O Canvas **não pode permitir** configurações incompatíveis com WhatsApp.

### Regras:
- Mensagens suportadas:
  - texto
  - botões
  - listas
- Cada nó `message` ou `question` deve exibir:
  - preview estilo WhatsApp
- Se algo não for compatível:
  - mostrar aviso visual no Inspector
  - bloquear o salvamento

---

## 9. Persistência do Fluxo

### 9.1. Fonte da verdade
- O Canvas edita `flow.definition` do agente

### 9.2. Quando salvar
- Botão “Salvar” no Inspector
- (Futuro) autosave com debounce

### 9.3. Integração com Simulador
Toda alteração salva deve:
- chamar `notifyAgentConfigUpdated(reason)`
- exibir “Alterações prontas” no SimulatorDock

---

## 10. Estados obrigatórios do Canvas

### 10.1. Fluxo vazio
- Mensagem clara: “Fluxo vazio”
- CTA: “Adicionar primeiro passo”

### 10.2. Nó inválido
- Destaque visual em vermelho
- Tooltip explicando o problema

### 10.3. Modo avançado
- Alerta fixo no topo:
  > “Alterações nesta aba afetam o atendimento. Teste no simulador após qualquer mudança.”

---

## 11. Critérios de aceite (obrigatórios)

O Canvas só é considerado **pronto** se:

- [x] É possível adicionar um nó
- [x] É possível editar o conteúdo de um nó
- [x] É possível criar condições com ramificações
- [x] Preview WhatsApp está visível
- [x] É possível salvar e ver o simulador reagir
- [x] É possível remover nós
- [x] O fluxo salvo reflete o runtime real

Se qualquer item falhar → **Canvas incompleto**.

---

## 12. Diagnóstico do Canvas atual

Se o Canvas:
- não permite adicionar nós
- não possui Inspector funcional
- não exibe preview WhatsApp
- não salva alterações
- não interage com o simulador

Então ele é apenas um **mock visual** e **não atende esta especificação**.

---

## 13. Instrução final para implementação

Refatorar o Canvas existente para cumprir **integralmente** este documento.

- Não criar nova tela
- Não manter comportamento readonly
- Evoluir a tela atual para um **editor funcional**
- Priorizar comportamento antes de estética

Este documento é a **fonte oficial de verdade** para o Canvas de Fluxo do Nevo.

---

## Status da implementação

- [x] §3 Tipos oficiais de nós (types.ts: OFFICIAL_NODE_TYPES, normalizeNodeType)
- [x] §4 Ações: criar nós (+ entre nós e no final, modal tipo), selecionar, editar no Inspector, remover com confirmação, layout vertical com drag para organizar
- [x] §5 Conexões automáticas; labels em condition
- [x] §6–7 Inspector por tipo (message, question, ai, condition, handoff); preview WhatsApp
- [x] §8 WhatsApp-first: validação e bloqueio de salvamento se incompatível
- [x] §9 Persistência em flow.definition; notificar simulador (Alterações prontas)
- [x] §10 Estados: fluxo vazio (CTA), nó inválido (vermelho + tooltip), alerta modo avançado no topo
- [x] §11 Critérios de aceite atendidos
