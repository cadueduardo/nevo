'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WhatsAppPreview } from './WhatsAppPreview'
import { normalizeNodeType, type FlowNodeShape, type FlowNodeData } from '../types'
import { getNodeValidationError, isWhatsAppCompatible } from '../lib/validation'

interface FlowInspectorProps {
  node: FlowNodeShape | null
  onSave?: (nodeId: string, data: Partial<FlowNodeShape>) => void
  onRemove?: () => void
  saving?: boolean
}

export function FlowInspector({ node, onSave, saving, onRemove }: FlowInspectorProps) {
  const [edited, setEdited] = React.useState<FlowNodeShape | null>(null)
  const [confirmRemove, setConfirmRemove] = React.useState(false)

  React.useEffect(() => {
    setEdited(node ? { ...node, data: { ...node.data } } : null)
    setConfirmRemove(false)
  }, [node?.id])

  const updateData = React.useCallback((patch: Partial<FlowNodeData>) => {
    setEdited((prev) =>
      prev ? { ...prev, data: { ...prev.data, ...patch } } : null
    )
  }, [])

  const handleSave = React.useCallback(() => {
    if (edited && onSave) {
      onSave(edited.id, { data: edited.data, position: edited.position })
    }
  }, [edited, onSave])

  const handleRemoveClick = React.useCallback(() => {
    if (confirmRemove && onRemove) {
      onRemove()
      setConfirmRemove(false)
      return
    }
    setConfirmRemove(true)
  }, [confirmRemove, onRemove])

  if (!node) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Selecione um nó para editar.
        </CardContent>
      </Card>
    )
  }

  const type = normalizeNodeType(node.type)
  const isMessage = type === 'message'
  const isQuestion = type === 'question'
  const isAi = type === 'ai'
  const isCondition = type === 'condition'
  const isHandoff = type === 'handoff'
  const isStart = type === 'start'
  const isEnd = type === 'end'

  const validationError = edited ? getNodeValidationError(edited) : getNodeValidationError(node)
  const whatsAppOk = edited ? isWhatsAppCompatible(edited) : isWhatsAppCompatible(node)
  const canSave = !validationError && (type === 'message' || type === 'question' ? whatsAppOk : true)

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-semibold">
              {(edited?.data?.label ?? node.data?.label) || node.id}
            </div>
            <div className="mt-1 text-xs text-muted-foreground uppercase">
              {type}
            </div>
          </div>
          <div className="flex gap-1">
            <Button size="sm" onClick={handleSave} disabled={saving || !onSave || !canSave}>
              {saving ? 'Salvando…' : 'Salvar'}
            </Button>
            {onRemove && !isStart && (
              <Button
                size="sm"
                variant={confirmRemove ? 'destructive' : 'outline'}
                onClick={handleRemoveClick}
              >
                {confirmRemove ? 'Confirmar remover?' : 'Remover'}
              </Button>
            )}
          </div>
        </div>

        {(isMessage || isQuestion) && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <div className="font-medium text-amber-800 dark:text-amber-200">
              Compatibilidade WhatsApp
            </div>
            <div className="mt-1 text-muted-foreground">
              Use apenas texto, botões ou lista. Evite imagens/áudio não suportados no preview.
            </div>
            {!whatsAppOk && (
              <p className="mt-2 font-medium text-destructive">
                Configuração incompatível com WhatsApp. Ajuste o tipo de UI ou opções antes de salvar.
              </p>
            )}
          </div>
        )}

        {validationError && (
          <p className="text-sm text-destructive">{validationError}</p>
        )}

        {isMessage && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Mensagem</label>
            <Textarea
              value={(edited?.data?.message ?? node.data?.message) ?? ''}
              onChange={(e) => updateData({ message: e.target.value })}
              placeholder="Texto enviado ao cliente"
              rows={3}
              className="resize-none"
            />
            <label className="text-sm font-medium">Tipo de UI</label>
            <Select
              value={(edited?.data?.ui?.kind ?? node.data?.ui?.kind) ?? 'text'}
              onValueChange={(v: 'buttons' | 'list' | 'text') =>
                updateData({
                  ui: {
                    ...(edited?.data?.ui ?? node.data?.ui),
                    kind: v,
                    options: (edited?.data?.ui?.options ?? node.data?.ui?.options) ?? [],
                  },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Texto</SelectItem>
                <SelectItem value="buttons">Botões</SelectItem>
                <SelectItem value="list">Lista</SelectItem>
              </SelectContent>
            </Select>
            {((edited?.data?.ui?.kind ?? node.data?.ui?.kind) === 'buttons' ||
              (edited?.data?.ui?.kind ?? node.data?.ui?.kind) === 'list') && (
              <>
                <label className="text-sm font-medium">Opções (uma por linha)</label>
                <Textarea
                  value={(edited?.data?.ui?.options ?? node.data?.ui?.options ?? []).join('\n')}
                  onChange={(e) =>
                    updateData({
                      ui: {
                        ...(edited?.data?.ui ?? node.data?.ui),
                        kind: (edited?.data?.ui?.kind ?? node.data?.ui?.kind) ?? 'buttons',
                        options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                      },
                    })
                  }
                  placeholder="Opção 1&#10;Opção 2"
                  rows={3}
                  className="resize-none font-mono text-sm"
                />
              </>
            )}
            <div className="pt-2">
              <span className="text-xs text-muted-foreground">Preview WhatsApp</span>
              <div className="mt-1">
                <WhatsAppPreview
                  message={(edited?.data?.message ?? node.data?.message) ?? ''}
                  ui={edited?.data?.ui ?? node.data?.ui}
                />
              </div>
            </div>
          </div>
        )}

        {isQuestion && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Pergunta (mensagem exibida)</label>
            <Textarea
              value={(edited?.data?.message ?? node.data?.message) ?? ''}
              onChange={(e) => updateData({ message: e.target.value })}
              placeholder="Texto da pergunta"
              rows={2}
              className="resize-none"
            />
            <label className="text-sm font-medium">Variável (salvar resposta)</label>
            <Input
              value={(edited?.data?.variable ?? node.data?.variable) ?? ''}
              onChange={(e) => updateData({ variable: e.target.value })}
              placeholder="ex: nome_cliente"
              className="font-mono text-sm"
            />
            <label className="text-sm font-medium">Tipo de UI</label>
            <Select
              value={(edited?.data?.ui?.kind ?? node.data?.ui?.kind) ?? 'text'}
              onValueChange={(v: 'buttons' | 'list' | 'text') =>
                updateData({
                  ui: {
                    ...(edited?.data?.ui ?? node.data?.ui),
                    kind: v,
                    options: (edited?.data?.ui?.options ?? node.data?.ui?.options) ?? [],
                  },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Texto livre</SelectItem>
                <SelectItem value="buttons">Botões</SelectItem>
                <SelectItem value="list">Lista</SelectItem>
              </SelectContent>
            </Select>
            {((edited?.data?.ui?.kind ?? node.data?.ui?.kind) === 'buttons' ||
              (edited?.data?.ui?.kind ?? node.data?.ui?.kind) === 'list') && (
              <>
                <label className="text-sm font-medium">Opções (uma por linha)</label>
                <Textarea
                  value={(edited?.data?.ui?.options ?? node.data?.ui?.options ?? []).join('\n')}
                  onChange={(e) =>
                    updateData({
                      ui: {
                        ...(edited?.data?.ui ?? node.data?.ui),
                        kind: (edited?.data?.ui?.kind ?? node.data?.ui?.kind) ?? 'buttons',
                        options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                      },
                    })
                  }
                  placeholder="Opção 1&#10;Opção 2"
                  rows={2}
                  className="resize-none font-mono text-sm"
                />
              </>
            )}
            <div className="pt-2">
              <span className="text-xs text-muted-foreground">Preview WhatsApp</span>
              <div className="mt-1">
                <WhatsAppPreview
                  message={(edited?.data?.message ?? node.data?.message) ?? ''}
                  ui={edited?.data?.ui ?? node.data?.ui}
                />
              </div>
            </div>
          </div>
        )}

        {isAi && (
          <div className="space-y-2">
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-800 dark:text-amber-200">
              IA é usada neste ponto do fluxo.
            </div>
            <label className="text-sm font-medium">Objetivo da IA (label)</label>
            <Input
              value={(edited?.data?.label ?? node.data?.label) ?? ''}
              onChange={(e) => updateData({ label: e.target.value })}
              placeholder="ex: Extrair intenção"
            />
            <label className="text-sm font-medium">Prompt / instruções</label>
            <Textarea
              value={(edited?.data?.prompt ?? node.data?.prompt ?? (node.data?.message ?? ''))}
              onChange={(e) => updateData({ prompt: e.target.value })}
              placeholder="Instruções para a IA..."
              rows={6}
              className="resize-none font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Variáveis disponíveis e schema de saída (visual) em versão futura.
            </p>
          </div>
        )}

        {isCondition && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Regra da condição</label>
            <Input
              value={(edited?.data?.conditionRule ?? node.data?.conditionRule) ?? ''}
              onChange={(e) => updateData({ conditionRule: e.target.value })}
              placeholder="ex: intent == booking"
              className="font-mono text-sm"
            />
            <label className="text-sm font-medium">Saídas (labels obrigatórios)</label>
            <p className="text-xs text-muted-foreground">
              Cada ramificação deve ter um label (ex.: booking, quote, else).
            </p>
            {(edited?.data?.branches ?? node.data?.branches ?? [{ label: 'sim' }, { label: 'não' }]).map((b, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  value={b.label}
                  onChange={(e) => {
                    const prev = edited?.data?.branches ?? node.data?.branches ?? [{ label: 'sim' }, { label: 'não' }]
                    const branches = prev.map((br, j) =>
                      j === i ? { ...br, label: e.target.value } : br
                    )
                    updateData({ branches })
                  }}
                  placeholder="Label"
                  className="font-mono text-sm flex-1"
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const branches = [...(edited?.data?.branches ?? node.data?.branches ?? []), { label: '' }]
                updateData({ branches })
              }}
            >
              + Saída
            </Button>
          </div>
        )}

        {isHandoff && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Motivo do handoff</label>
            <Input
              value={(edited?.data?.handoffReason ?? node.data?.handoffReason) ?? ''}
              onChange={(e) => updateData({ handoffReason: e.target.value })}
              placeholder="ex: Cliente pediu atendente"
            />
            <label className="text-sm font-medium">Regra de acionamento</label>
            <Select
              value={(edited?.data?.handoffRule ?? node.data?.handoffRule) ?? 'conditional'}
              onValueChange={(v: 'always' | 'conditional') => updateData({ handoffRule: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Sempre transferir</SelectItem>
                <SelectItem value="conditional">Condicional</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {(isStart || isEnd) && (
          <p className="text-sm text-muted-foreground">
            {isStart ? 'Nó de início do atendimento. Não editável além do label.' : 'Nó de encerramento do fluxo.'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
