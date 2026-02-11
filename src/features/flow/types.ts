/**
 * Tipos do fluxo (definition.nodes / definition.edges no banco).
 * Alinhado ao docs/canvas.md — apenas tipos oficiais do runtime Nevo.
 */

/** Tipos oficiais de nós (canvas.md §3). Não existe nó genérico. */
export const OFFICIAL_NODE_TYPES = [
  'start',
  'message',
  'question',
  'ai',
  'condition',
  'handoff',
  'end',
] as const

export type OfficialNodeType = (typeof OFFICIAL_NODE_TYPES)[number]

export function isOfficialNodeType(t: string): t is OfficialNodeType {
  return OFFICIAL_NODE_TYPES.includes(t as OfficialNodeType)
}

/** Normaliza tipo legado (send -> message, trigger -> start) para o oficial. */
export function normalizeNodeType(type: string | undefined): OfficialNodeType {
  const t = (type ?? 'message').toLowerCase()
  if (t === 'send') return 'message'
  if (t === 'trigger') return 'start'
  return isOfficialNodeType(t) ? t : 'message'
}

export interface FlowNodePosition {
  x: number
  y: number
}

export interface FlowNodeData {
  label?: string
  message?: string
  prompt?: string
  /** Variável salva (nó question). */
  variable?: string
  /** UI para message/question: botões, lista ou texto livre (WhatsApp). */
  ui?: {
    kind?: 'buttons' | 'list' | 'text'
    options?: string[]
  }
  /** Regra da condição (ex.: intent == booking). Nó condition. */
  conditionRule?: string
  /** Saídas com labels obrigatórios. Nó condition. */
  branches?: { label: string; targetId?: string }[]
  /** Motivo do handoff. Nó handoff. */
  handoffReason?: string
  /** Regra de acionamento: always | conditional. Nó handoff. */
  handoffRule?: 'always' | 'conditional'
  [k: string]: unknown
}

export interface FlowNodeShape {
  id: string
  /** Tipo oficial (start | message | question | ai | condition | handoff | end). */
  type?: string
  position?: FlowNodePosition
  data?: FlowNodeData
}

export interface FlowEdgeShape {
  id?: string
  source: string
  target: string
  /** Obrigatório em edges que saem de nó condition. */
  label?: string
}

export interface FlowDefinition {
  nodes: FlowNodeShape[]
  edges: FlowEdgeShape[]
}
