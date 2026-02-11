'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { FlowInspector } from './FlowInspector'
import { WhatsAppPreview } from './WhatsAppPreview'
import { computeLayout } from '../lib/layout'
import { getNodeValidationError } from '../lib/validation'
import {
  normalizeNodeType,
  OFFICIAL_NODE_TYPES,
  type FlowNodeShape,
  type FlowEdgeShape,
  type OfficialNodeType,
} from '../types'

const NODE_WIDTH = 180
const NODE_HEIGHT = 52
const SLOT_SIZE = 28

interface AgentFlowBuilderProps {
  agentId: string
  nodes: FlowNodeShape[]
  edges: FlowEdgeShape[]
  onConfigUpdated?: () => void
}

/** Gera id único para novo nó */
function nextNodeId(nodes: FlowNodeShape[]): string {
  const max = nodes.reduce((acc, n) => {
    const m = n.id.match(/^node-(\d+)$/)
    return m ? Math.max(acc, parseInt(m[1], 10)) : acc
  }, 0)
  return `node-${max + 1}`
}

export function AgentFlowBuilder({
  agentId,
  nodes: initialNodes,
  edges: initialEdges,
  onConfigUpdated,
}: AgentFlowBuilderProps) {
  const [nodes, setNodes] = React.useState<FlowNodeShape[]>(initialNodes)
  const [edges, setEdges] = React.useState<FlowEdgeShape[]>(initialEdges)
  const [selectedId, setSelectedId] = React.useState<string | null>(initialNodes[0]?.id ?? null)
  const [saving, setSaving] = React.useState(false)
  const [addSlot, setAddSlot] = React.useState<{
    afterId: string
    beforeId: string | null
    edgeLabel?: string
  } | null>(null)
  const [dragging, setDragging] = React.useState<{
    nodeId: string
    offsetX: number
    offsetY: number
  } | null>(null)
  const nodesRef = React.useRef(nodes)
  nodesRef.current = nodes
  const edgesRef = React.useRef(edges)
  edgesRef.current = edges
  const didDragRef = React.useRef(false)

  React.useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
    if (!selectedId && initialNodes[0]) setSelectedId(initialNodes[0].id)
  }, [initialNodes, initialEdges])

  const selected = React.useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId]
  )

  const computedLayout = React.useMemo(() => computeLayout(nodes, edges), [nodes, edges])
  const positions = React.useMemo(() => {
    const map = new Map<string, { x: number; y: number }>()
    for (const n of nodes) {
      map.set(n.id, n.position ?? computedLayout.get(n.id) ?? { x: 0, y: 0 })
    }
    return map
  }, [nodes, computedLayout])

  const nodeMap = React.useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const getCenter = React.useCallback(
    (id: string) => {
      const pos = positions.get(id) ?? { x: 0, y: 0 }
      return {
        x: pos.x + NODE_WIDTH / 2,
        y: pos.y + NODE_HEIGHT / 2,
      }
    },
    [positions]
  )

  const bounds = React.useMemo(() => {
    let maxX = 0,
      maxY = 0
    for (const [, pos] of positions) {
      if (pos.x + NODE_WIDTH > maxX) maxX = pos.x + NODE_WIDTH
      if (pos.y + NODE_HEIGHT > maxY) maxY = pos.y + NODE_HEIGHT
    }
    return {
      width: Math.max(maxX + 120, 500),
      height: Math.max(maxY + 100, 400),
    }
  }, [positions])

  const persistFlow = React.useCallback(
    async (newNodes: FlowNodeShape[], newEdges: FlowEdgeShape[]) => {
      setSaving(true)
      try {
        const layout = computeLayout(newNodes, newEdges)
        const nodesWithPosition = newNodes.map((n) => ({
          ...n,
          position: n.position ?? layout.get(n.id) ?? { x: 0, y: 0 },
        }))
        const res = await fetch(`/api/app/agents/${agentId}/flow`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            definition: {
              nodes: nodesWithPosition,
              edges: newEdges,
            },
          }),
        })
        if (!res.ok) throw new Error(await res.text())
        setNodes(nodesWithPosition)
        setEdges(newEdges)
        onConfigUpdated?.()
      } finally {
        setSaving(false)
      }
    },
    [agentId, onConfigUpdated]
  )

  const handleNodeSave = React.useCallback(
    (nodeId: string, patch: Partial<FlowNodeShape>) => {
      const nextNodes = nodes.map((n) =>
        n.id === nodeId ? { ...n, ...patch, data: { ...n.data, ...patch.data } } : n
      )
      setNodes(nextNodes)
      persistFlow(nextNodes, edges)
    },
    [nodes, edges, persistFlow]
  )

  const handleAddNode = React.useCallback(
    (type: OfficialNodeType) => {
      if (!addSlot) return
      const { afterId, beforeId, edgeLabel } = addSlot
      setAddSlot(null)

      const id = nextNodeId(nodes)
      const newNode: FlowNodeShape = {
        id,
        type,
        data: {
          label: type === 'start' ? 'Início' : type === 'end' ? 'Fim' : type,
          ...(type === 'condition' && { branches: [{ label: 'sim' }, { label: 'não' }] }),
        },
      }

      let newEdges: FlowEdgeShape[] = [...edges]
      const outFromAfter = edges.filter((e) => e.source === afterId)
      const edgeToBefore = edges.find((e) => e.source === afterId && e.target === (beforeId ?? ''))

      if (beforeId && edgeToBefore) {
        newEdges = edges.filter((e) => !(e.source === afterId && e.target === beforeId))
        newEdges.push({ source: afterId, target: id, label: edgeToBefore.label })
        newEdges.push({ source: id, target: beforeId, label: edgeToBefore.label })
      } else {
        newEdges.push({
          source: afterId,
          target: id,
          ...(edgeLabel !== undefined && { label: edgeLabel }),
        })
      }

      const newNodes = [...nodes, newNode]
      setNodes(newNodes)
      setEdges(newEdges)
      setSelectedId(id)
      persistFlow(newNodes, newEdges)
    },
    [addSlot, nodes, edges, persistFlow]
  )

  const handleRemoveNode = React.useCallback(
    (nodeId: string) => {
      const incoming = edges.filter((e) => e.target === nodeId)
      const outgoing = edges.filter((e) => e.source === nodeId)
      let newEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
      if (incoming.length === 1 && outgoing.length === 1) {
        newEdges.push({ source: incoming[0].source, target: outgoing[0].target, label: outgoing[0].label })
      }
      const newNodes = nodes.filter((n) => n.id !== nodeId)
      setNodes(newNodes)
      setEdges(newEdges)
      if (selectedId === nodeId) setSelectedId(newNodes[0]?.id ?? null)
      persistFlow(newNodes, newEdges)
    },
    [nodes, edges, selectedId, persistFlow]
  )

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault()
      didDragRef.current = false
      const pos = positions.get(nodeId) ?? { x: 0, y: 0 }
      setDragging({ nodeId, offsetX: e.clientX - pos.x, offsetY: e.clientY - pos.y })
    },
    [positions]
  )

  React.useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      didDragRef.current = true
      const pos = { x: e.clientX - dragging.offsetX, y: e.clientY - dragging.offsetY }
      setNodes((prev) =>
        prev.map((n) =>
          n.id === dragging.nodeId ? { ...n, position: pos } : n
        )
      )
    }
    const onUp = () => {
      persistFlow(nodesRef.current, edgesRef.current)
      setDragging(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, persistFlow])

  const outEdgesBySource = React.useMemo(() => {
    const m = new Map<string, FlowEdgeShape[]>()
    for (const e of edges) {
      const list = m.get(e.source) ?? []
      list.push(e)
      m.set(e.source, list)
    }
    return m
  }, [edges])

  const hasOutgoing = (nodeId: string) => (outEdgesBySource.get(nodeId)?.length ?? 0) > 0

  // —— Estado: fluxo vazio ——
  if (nodes.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <p className="font-medium text-muted-foreground">Fluxo vazio</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Adicione o primeiro passo do atendimento.
            </p>
            <Button
              className="mt-4 gap-2"
              onClick={() => {
                const id = nextNodeId([])
                const start: FlowNodeShape = {
                  id,
                  type: 'start',
                  data: { label: 'Início' },
                }
                setNodes([start])
                setEdges([])
                setSelectedId(id)
                persistFlow([start], [])
              }}
            >
              <Plus className="h-4 w-4" />
              Adicionar primeiro passo
            </Button>
          </CardContent>
        </Card>
        <div className="hidden lg:block" />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">Fluxo</span>
            {saving && <span className="text-xs text-muted-foreground">Salvando…</span>}
          </div>
          <div
            className="overflow-auto rounded-b-lg border-t bg-muted/10"
            style={{ minHeight: 380 }}
          >
            <div
              className="relative"
              style={{ width: bounds.width, height: bounds.height }}
            >
              <svg
                className="absolute inset-0 pointer-events-none"
                width={bounds.width}
                height={bounds.height}
              >
                {edges.map((e, i) => {
                  const from = getCenter(e.source)
                  const to = getCenter(e.target)
                  return (
                    <line
                      key={e.id ?? `e-${i}`}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                    />
                  )
                })}
              </svg>

              {nodes.map((node) => {
                const pos = positions.get(node.id) ?? { x: 0, y: 0 }
                const type = normalizeNodeType(node.type)
                const label = node.data?.label ?? node.id
                const isMessage = type === 'message' || type === 'question'
                const isSelected = node.id === selectedId
                const error = getNodeValidationError(node)

                return (
                  <React.Fragment key={node.id}>
                    <div
                      className={`absolute rounded-md border bg-card shadow-sm overflow-hidden cursor-pointer ${dragging?.nodeId === node.id ? 'cursor-grabbing' : 'cursor-grab'}`}
                      style={{
                        left: pos.x,
                        top: pos.y,
                        width: NODE_WIDTH,
                        minHeight: NODE_HEIGHT,
                        borderColor: error ? 'hsl(var(--destructive))' : undefined,
                      }}
                      onMouseDown={(e) => handleMouseDown(e, node.id)}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (didDragRef.current) {
                          didDragRef.current = false
                          return
                        }
                        setSelectedId(node.id)
                      }}
                      title={error ?? undefined}
                    >
                      <div
                        className={
                          isSelected
                            ? 'ring-2 ring-primary'
                            : error
                              ? 'ring-2 ring-destructive'
                              : ''
                        }
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 2,
                          padding: 8,
                        }}
                      >
                        <span className="text-[10px] uppercase text-muted-foreground truncate w-full text-center">
                          {type}
                        </span>
                        <span className="text-sm font-medium truncate w-full text-center" title={String(label)}>
                          {label}
                        </span>
                        {isMessage && node.data?.message && (
                          <div className="mt-1 w-full scale-75 origin-center">
                            <WhatsAppPreview
                              message={node.data.message}
                              ui={node.data.ui}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Slot "+" após o nó (entre este e o próximo, ou fim do fluxo) */}
                    {(() => {
                      const outs = outEdgesBySource.get(node.id) ?? []
                      if (outs.length === 0) {
                        const cx = pos.x + NODE_WIDTH / 2 - SLOT_SIZE / 2
                        const cy = pos.y + NODE_HEIGHT + 8
                        return (
                          <Button
                            key={`slot-end-${node.id}`}
                            type="button"
                            variant="outline"
                            size="icon"
                            className="absolute rounded-full h-7 w-7"
                            style={{ left: cx, top: cy }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setAddSlot({ afterId: node.id, beforeId: null })
                            }}
                            aria-label="Adicionar passo após"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        )
                      }
                      return outs.map((e) => {
                        const from = getCenter(node.id)
                        const to = getCenter(e.target)
                        const cx = (from.x + to.x) / 2 - SLOT_SIZE / 2
                        const cy = (from.y + to.y) / 2 - SLOT_SIZE / 2
                        return (
                          <Button
                            key={`slot-${node.id}-${e.target}`}
                            type="button"
                            variant="outline"
                            size="icon"
                            className="absolute rounded-full h-7 w-7"
                            style={{ left: cx, top: cy }}
                            onClick={(ev) => {
                              ev.stopPropagation()
                              setAddSlot({
                                afterId: node.id,
                                beforeId: e.target,
                                edgeLabel: e.label,
                              })
                            }}
                            aria-label="Inserir passo entre"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        )
                      })
                    })()}
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modal: escolher tipo de nó */}
      {addSlot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setAddSlot(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Escolher tipo de nó"
        >
          <Card
            className="mx-4 w-full max-w-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <CardContent className="p-4">
              <p className="mb-3 text-sm font-medium">Adicionar nó</p>
              <div className="grid grid-cols-2 gap-2">
                {OFFICIAL_NODE_TYPES.filter((t) => t !== 'start' || nodes.every((n) => normalizeNodeType(n.type) !== 'start')).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => handleAddNode(t)}
                  >
                    {t === 'start' ? 'Início' : t === 'message' ? 'Mensagem' : t === 'question' ? 'Pergunta' : t === 'ai' ? 'IA' : t === 'condition' ? 'Condição' : t === 'handoff' ? 'Handoff' : 'Fim'}
                  </Button>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => setAddSlot(null)}>
                Cancelar
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="hidden lg:block">
        <FlowInspector
          node={selected}
          onSave={handleNodeSave}
          onRemove={selectedId ? () => handleRemoveNode(selectedId) : undefined}
          saving={saving}
        />
      </div>

      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full" disabled={!selected}>
              Editar nó selecionado
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[75vh]">
            <SheetHeader>
              <SheetTitle>Editar nó</SheetTitle>
            </SheetHeader>
            <div className="mt-3">
              <FlowInspector
                node={selected}
                onSave={handleNodeSave}
                onRemove={selectedId ? () => handleRemoveNode(selectedId) : undefined}
                saving={saving}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}
