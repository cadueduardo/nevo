# Nevo Landing (Modelo 4) — Layout em Grid Tailwind (Mobile-first, clean, alto contraste)
## Objetivo
Estruturar a home com visual “premium e espaçado”: hero escuro + seções claras + CTA escuro. Chat sempre visível no hero. Mostrar valor por dobras (uma ideia por seção).

> Nota: isto é um **wireframe de layout** pensado para Tailwind (classes, grids, espaçamentos, containers). Copy final pode ser trocada depois.  
> Importante: manter o site leve, sem poluição. Um mockup principal no hero; os demais são cards simples.

---

## 0) Tokens/Guidelines (para orientar o Tailwind)
- Container padrão: `max-w-6xl mx-auto px-4 sm:px-6 lg:px-8`
- Espaçamento vertical padrão: `py-16 sm:py-20 lg:py-24`
- Largura de leitura: `max-w-2xl`
- Cards: `rounded-2xl border border-zinc-200 bg-white shadow-sm`
- Fundo claro: `bg-white` e alternar `bg-zinc-50`
- Hero escuro: `bg-zinc-950` com `bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900`
- Tipografia:
  - H1: `text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight`
  - H2: `text-2xl sm:text-3xl font-semibold tracking-tight`
  - Body: `text-base sm:text-lg text-zinc-600`
- Botões:
  - Primário: `rounded-xl bg-emerald-500 px-5 py-3 text-sm sm:text-base font-semibold text-white hover:bg-emerald-600`
  - Secundário: `rounded-xl bg-white/10 px-5 py-3 text-sm sm:text-base font-semibold text-white hover:bg-white/15 border border-white/10`
- “Pills” (sugestões): `rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs sm:text-sm text-white/85 hover:bg-white/10`

---

## 1) Header (fixo, clean)
### Estrutura
- `header` com `sticky top-0 z-50`
- Fundo com blur: `bg-zinc-950/70 backdrop-blur border-b border-white/10`

### Grid
- Wrapper: `flex items-center justify-between h-16`
- Esquerda: logo
- Centro (desktop): nav simples (opcional)
- Direita: CTAs

### Tailwind (wireframe)
- `<header className="sticky top-0 z-50 bg-zinc-950/70 backdrop-blur border-b border-white/10">`
- `<div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">`
  - Logo: `flex items-center gap-2 text-white font-semibold`
  - Nav (md+): `hidden md:flex items-center gap-6 text-sm text-white/70`
  - Ações: `flex items-center gap-3`
    - Link entrar: `text-sm text-white/80 hover:text-white`
    - Botão começar: `rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600`

---

## 2) Hero (escuro, foco no chat + um mockup grande, sem poluição)
### Objetivo visual
- Lado esquerdo: headline + sub + input/chat + chips
- Lado direito: UM mockup grande (phone) com 2-3 mensagens (cliente → Nevo). Nada flutuando.

### Layout
- Section: `py-16 sm:py-20 lg:py-24`
- Grid 1 coluna (mobile) → 12 colunas (lg)
- Esquerda: `lg:col-span-6`
- Direita: `lg:col-span-6`

### Tailwind (wireframe)
- `<section className="bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 text-white">`
- `<div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">`
- `<div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">`

#### 2.1 Coluna esquerda (conteúdo + chat)
- Wrapper: `lg:col-span-6`
- H1 + span destaque: sublinhado/verde discreto
- Subheadline curta
- Bloco chat: card claro sobre escuro (alto contraste)

**Chat card (clean)**
- `rounded-2xl bg-white text-zinc-900 shadow-xl shadow-black/20 border border-white/10`
- Campo input: `h-12 sm:h-14`
- Botão enviar: quadrado arredondado `rounded-xl bg-emerald-500`

**Sugestões**
- Linha de chips (wrap): `flex flex-wrap gap-2 pt-3`

#### 2.2 Coluna direita (mockup)
- Wrapper: `lg:col-span-6`
- Card do mockup com “phone frame”:
  - `relative mx-auto w-full max-w-md`
  - Fundo: `rounded-[2.5rem] bg-zinc-900 border border-white/10 p-3 shadow-2xl`
  - Tela: `rounded-[2rem] bg-white overflow-hidden`
- Dentro: header do chat + 2 balões grandes + 1 CTA “Agendar visita?”

> Importante: manter o mockup com poucos elementos e muito respiro interno.

---

## 3) Seção “Dores” (claro, 3 cards grandes, muito espaço)
### Layout
- Fundo: `bg-white`
- Título central + sub
- Cards: grid 1 col (mobile) → 3 col (md)
- Cards com ícone simples (monocromático) + título + 1 linha

### Tailwind
- `<section className="bg-white">`
- `<div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">`
- Título: `max-w-2xl`
- Cards: `grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mt-10`
- Card: `rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm`

---

## 4) Seção “Veja como funciona” (cinza claro, fluxo em 3 passos, UMA coisa por vez)
### Objetivo visual
- Não colocar 3 mocks enormes juntos.
- Em desktop: 3 colunas com cards bem espaçados.
- Em mobile: carrossel simples (ou lista vertical com divisores).

### Layout
- Fundo: `bg-zinc-50`
- Grid 1 col → 3 col
- Cada card tem: label (Cliente/Nevo/Você) + mini mock do chat

### Tailwind
- `<section className="bg-zinc-50">`
- `<div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">`
- Cards: `grid grid-cols-1 lg:grid-cols-3 gap-6 mt-10`
- Card: `rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm`

> Dica: usar setas/linha pontilhada somente se ficar sutil. Caso pese, remover.

---

## 5) Seção “Pergunte no WhatsApp” (branco, tipografia grande editorial)
### Objetivo visual
- Muito respiro.
- Texto grande centralizado.
- 3-5 exemplos em “pills” grandes ou linhas destacadas.

### Layout
- Fundo: `bg-white`
- Centro: `max-w-3xl mx-auto text-center`
- Exemplos: `mt-8 flex flex-col gap-3 items-center`

### Tailwind
- Headline: `text-3xl sm:text-4xl font-semibold tracking-tight text-zinc-900`
- Exemplos (cards leves):
  - `w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm text-zinc-900`
  - ou pills grandes: `rounded-2xl bg-zinc-50 border border-zinc-200 px-4 py-3 text-zinc-800`

---

## 6) Seção “O que o Nevo faz” (branco, 3 colunas, ícones consistentes)
### Layout
- Fundo: `bg-white`
- Grid 1 col → 3 col
- Cards com título + 2 bullets

### Tailwind
- Cards: `grid grid-cols-1 md:grid-cols-3 gap-6 mt-10`
- Card: `rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm`
- Bullets: `mt-3 space-y-2 text-sm text-zinc-600`

---

## 7) Seção “Como começar” (cinza claro, 3 passos grandes + CTA lateral)
### Layout
- Fundo: `bg-zinc-50`
- Grid: 1 col (mobile) → 12 col (lg)
- Esquerda (passos): `lg:col-span-7`
- Direita (CTA card): `lg:col-span-5`

### Tailwind
- Wrapper: `grid grid-cols-1 lg:grid-cols-12 gap-8 items-start`
- Passos: lista vertical com número grande:
  - item: `flex gap-4`
  - número: `h-10 w-10 rounded-xl bg-white border border-zinc-200 flex items-center justify-center font-semibold text-zinc-900`
- CTA card: `rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sticky top-24` (somente desktop)

---

## 8) CTA Final (escuro, minimalista)
### Objetivo
- 1 headline, 1 sub curta, 1 botão.

### Tailwind
- `<section className="bg-zinc-950 text-white">`
- `<div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">`
- Center: `max-w-2xl`
- Botão: primário verde
- Microcopy: `text-white/70 text-sm mt-3`

---

## 9) Footer (claro, simples)
- Fundo: `bg-white`
- `border-t border-zinc-200`
- Colunas: 1 col → 3 col
- Links: Termos, Privacidade, Contato

---

## 10) Comportamento/UX (regras práticas)
- Hero deve carregar rápido. Mockup pode ser SVG/PNG otimizado.
- Evitar animações pesadas. Se animar, só “typing dots” no mockup com CSS leve.
- Sempre manter “1 ideia por seção”.
- Espaçamento vertical generoso: `py-16/20/24`.
- A cada dobra, garantir que:
  - texto = pouco
  - visual = claro
  - CTA = presente (mas sem spam)

---

## 11) Checklist de implementação (o agente deve dar check fase a fase)
### Fase A — Layout base
- [ ] Header sticky + CTA
- [ ] Hero grid (conteúdo + chat + mockup)
- [ ] Seção Dores (3 cards)
- [ ] Seção Como funciona (3 cards)
- [ ] Seção Pergunte no WhatsApp (editorial)
- [ ] Seção O que faz (3 cards)
- [ ] Seção Como começar (3 passos + CTA card)
- [ ] CTA final
- [ ] Footer

### Fase B — Polimento visual
- [ ] Ajustar espaçamentos (respiro)
- [ ] Garantir contraste AA no claro/escuro
- [ ] Garantir mobile first (sem quebra)
- [ ] Reduzir poluição (remover elementos redundantes)
- [ ] Garantir “um mockup principal” (hero) sem cards flutuantes extras

### Fase C — Integração com onboarding existente
- [ ] Campo de conversa do hero chama o mesmo endpoint/fluxo do onboarding (LandingChat)
- [ ] Sugestões clicáveis preenchem input com exemplos
- [ ] Botão enviar (CTA do chat) inicia a sessão corretamente

FIM