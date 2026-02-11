/**
 * Calcula posições dos nós para layout vertical (canvas.md §4.5).
 * Fluxo principal vertical; condições criam ramificações laterais.
 */

import type { FlowNodeShape, FlowEdgeShape } from '../types'
import { normalizeNodeType } from '../types'

const ROW_HEIGHT = 72
const COL_WIDTH = 200

/** Retorna o id do nó de início (type start/trigger ou único sem arestas de entrada). */
export function getStartNodeId(nodes: FlowNodeShape[], edges: FlowEdgeShape[]): string | null {
  const hasIncoming = new Set(edges.map((e) => e.target))
  const startByType = nodes.find((n) => normalizeNodeType(n.type) === 'start')
  if (startByType) return startByType.id
  const withoutIncoming = nodes.find((n) => !hasIncoming.has(n.id))
  return withoutIncoming?.id ?? nodes[0]?.id ?? null
}

/** BFS a partir do start; retorna nós por nível e por ramo para posicionar. */
export function computeLayout(
  nodes: FlowNodeShape[],
  edges: FlowEdgeShape[]
): Map<string, { x: number; y: number }> {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const outEdges = new Map<string, { target: string; label?: string }[]>()
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue
    const list = outEdges.get(e.source) ?? []
    list.push({ target: e.target, label: e.label })
    outEdges.set(e.source, list)
  }

  const startId = getStartNodeId(nodes, edges)
  if (!startId) {
    // Fallback: disposição vertical pela ordem do array
    const pos = new Map<string, { x: number; y: number }>()
    nodes.forEach((n, i) => pos.set(n.id, { x: 0, y: i * ROW_HEIGHT }))
    return pos
  }

  const pos = new Map<string, { x: number; y: number }>()
  const queue: { id: string; depth: number; col: number }[] = [{ id: startId, depth: 0, col: 0 }]
  const visited = new Set<string>()
  const depthCols = new Map<number, number>() // max col por depth para próximo ramo

  while (queue.length > 0) {
    const { id, depth, col } = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    pos.set(id, { x: col * COL_WIDTH, y: depth * ROW_HEIGHT })

    const outs = outEdges.get(id) ?? []
    if (outs.length === 0) continue
    if (outs.length === 1) {
      queue.push({ id: outs[0].target, depth: depth + 1, col })
      continue
    }
    // Vários ramos (condition): dispor na mesma linha abaixo, colunas diferentes
    const nextCol = depthCols.get(depth + 1) ?? 0
    depthCols.set(depth + 1, nextCol + outs.length)
    outs.forEach((o, i) => {
      queue.push({ id: o.target, depth: depth + 1, col: nextCol + i })
    })
  }

  // Nós órfãos (não alcançados a partir do start): colocar no final
  let orphanRow = 0
  for (const n of nodes) {
    if (!pos.has(n.id)) {
      pos.set(n.id, { x: 0, y: (nodes.length + orphanRow) * ROW_HEIGHT })
      orphanRow++
    }
  }

  return pos
}
