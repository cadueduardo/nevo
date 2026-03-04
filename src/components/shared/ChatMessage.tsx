'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { cn } from '@/lib/utils'
import { Pencil, X } from 'lucide-react'
import type { EditableItem, SelectableOption } from './ChatShell'

/** Renderiza **texto** como negrito (compatível com Markdown/WhatsApp). */
function renderContentWithMarkdown(text: string): ReactNode {
  if (!text) return null
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/)
    if (boldMatch) return <strong key={i}>{boldMatch[1]}</strong>
    return part
  })
}

/**
 * Formata valor para máscara BRL (R$ 1.234). Backend parsePrice usa só dígitos = reais inteiros.
 */
function formatCurrencyBRL(value: string): string {
  const digits = (value || '').replace(/\D/g, '')
  if (!digits) return ''
  const num = parseInt(digits, 10)
  if (Number.isNaN(num) || num === 0) return ''
  const intStr = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `R$ ${intStr}`
}

function formatScheduleValuePtBR(value: string): string {
  let out = value || ''
  const map: Record<string, string> = {
    monday: 'Segunda',
    tuesday: 'Terça',
    wednesday: 'Quarta',
    thursday: 'Quinta',
    friday: 'Sexta',
    saturday: 'Sábado',
    sunday: 'Domingo',
  }

  // Substituir tokens em inglês (ids internos) por labels PT-BR para exibição.
  // Ex.: "tuesday, wednesday, thursday, friday, saturday - 09:00 às 18:00"
  for (const [en, pt] of Object.entries(map)) {
    out = out.replace(new RegExp(`\\b${en}\\b`, 'gi'), pt)
  }

  // Normalizar separadores comuns (não mexer em horários).
  out = out.replace(/\s*,\s*/g, ', ')
  return out
}

/** Remove prefixo "N - " das opções para enviar só o label ao backend. */
function stripOptionLabel(option: string): string {
  const trimmed = option.trim()
  const match = trimmed.match(/^\d+\s*-\s*(.+)$/)
  return match ? match[1].trim() : trimmed
}

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  timestamp?: Date
  actionOptions?: string[]
  /** Quando true, exibir actionOptions como checkboxes e enviar múltiplos selecionados separados por vírgula. */
  actionOptionsMultiSelect?: boolean
  editableItems?: EditableItem[]
  selectableOptions?: SelectableOption[]
  onActionClick?: (action: string) => void
  onItemEdit?: (id: string, newValue: string, allItems?: EditableItem[]) => void
  /** Salva localmente sem enviar mensagem (ex: Enter em service_price). */
  onItemEditLocal?: (id: string, newValue: string) => void
  onItemDelete?: (id: string, allItems?: EditableItem[]) => void
  onOptionSelect?: (selectedValues: string[], customInput?: string) => void
  /** Ex: "holidays_select" permite confirmar com 0 selecionados. */
  requiresAction?: string | null
  /** Exibe input para adicionar outros itens (ex: serviços) quando services_list. */
  allowCustomInput?: boolean
  customInputPlaceholder?: string
}

export function ChatMessage({ 
  role, 
  content, 
  timestamp,
  actionOptions,
  actionOptionsMultiSelect = false,
  editableItems,
  selectableOptions,
  onActionClick,
  onItemEdit,
  onItemEditLocal,
  onItemDelete,
  onOptionSelect,
  requiresAction,
  allowCustomInput,
  customInputPlaceholder = 'Ou adicione outros (separados por vírgula)',
}: ChatMessageProps) {
  const isUser = role === 'user'
  const [customInputValue, setCustomInputValue] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  /** Campo de preço em edição: ao dar Enter, salva localmente sem enviar mensagem. */
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [editingPriceValue, setEditingPriceValue] = useState('')
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(() => {
    return new Set(selectableOptions?.filter(opt => opt.selected).map(opt => opt.value) || [])
  })
  /** Opções de ação selecionadas quando actionOptionsMultiSelect é true (índices). */
  const [selectedActionIndices, setSelectedActionIndices] = useState<Set<number>>(new Set())

  // Atualizar selectedOptions quando selectableOptions mudar
  useEffect(() => {
    if (selectableOptions) {
      setSelectedOptions(new Set(selectableOptions.filter(opt => opt.selected).map(opt => opt.value)))
    }
  }, [selectableOptions])


  const handleEditStart = (item: EditableItem) => {
    setEditingId(item.id)
    setEditingValue(item.id === 'schedule' ? formatScheduleValuePtBR(item.value) : item.value)
  }

  const handleEditSave = (id: string) => {
    const valueToSave = editingValue.trim()
    if (!valueToSave) {
      setEditingId(null)
      setEditingValue('')
      return
    }
    if (onItemEditLocal) {
      // Garantir que o pai commita o estado antes de sair do modo edição, para a linha atualizar na hora.
      flushSync(() => {
        onItemEditLocal(id, valueToSave)
      })
    } else if (onItemEdit) {
      onItemEdit(id, valueToSave, editableItems)
    }
    setEditingId(null)
    setEditingValue('')
  }

  const handleEditCancel = () => {
    setEditingId(null)
    setEditingValue('')
  }

  const flushPendingInlineEdits = () => {
    if (editingId && onItemEditLocal) {
      const value = editingValue.trim()
      if (value) onItemEditLocal(editingId, value)
      setEditingId(null)
      setEditingValue('')
    }
    if (editingPriceId && onItemEditLocal) {
      const toSave = (editingPriceValue || '').trim()
      onItemEditLocal(editingPriceId, toSave ? formatCurrencyBRL(editingPriceValue) : '')
      setEditingPriceId(null)
      setEditingPriceValue('')
    }
  }

  const handleDelete = (id: string) => {
    if (onItemDelete) {
      onItemDelete(id, editableItems)
    }
  }

  const handleOptionToggle = (value: string) => {
    const newSelected = new Set(selectedOptions)
    if (newSelected.has(value)) {
      newSelected.delete(value)
    } else {
      newSelected.add(value)
    }
    setSelectedOptions(newSelected)
    // Não enviar automaticamente - usuário precisa clicar em "Confirmar seleção"
  }

  const handleConfirmSelection = () => {
    const selected = Array.from(selectedOptions)
    const hasCustom = allowCustomInput && customInputValue.trim()
    if ((selected.length > 0 || hasCustom) && onOptionSelect) {
      onOptionSelect(selected, hasCustom ? customInputValue.trim() : undefined)
    }
  }

  const customItemsCount = allowCustomInput && customInputValue.trim()
    ? customInputValue.split(',').map((s) => s.trim()).filter(Boolean).length
    : 0
  const isServicesSelection =
    (requiresAction === 'services_list' || requiresAction === 'services_edit') && allowCustomInput
  const isServicesEditInput = requiresAction === 'services_edit' && allowCustomInput
  const suggestionExamples = (selectableOptions || [])
    .map((option) => option.label.trim())
    .filter(Boolean)
    .slice(0, 4)
  const customInputPlaceholderText =
    (isServicesSelection || isServicesEditInput) && suggestionExamples.length > 0
      ? `Ex: ${suggestionExamples.join(', ')}`
      : customInputPlaceholder
  const canConfirm = isServicesEditInput
    ? selectedOptions.size > 0 || customItemsCount > 0
    : selectedOptions.size > 0 || customItemsCount > 0 || requiresAction === 'holidays_select'
  const totalCount = selectedOptions.size + customItemsCount

  return (
    <div
      className={cn(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        )}
      >
        <p className="text-sm sm:text-base whitespace-pre-wrap break-words font-normal leading-relaxed">
          {renderContentWithMarkdown(content)}
        </p>
        
        {/* Lista de itens editáveis (serviços, FAQ, etc) */}
        {!isUser && editableItems && editableItems.length > 0 && (
          <div className="mt-4 space-y-2">
            {editableItems.map((item) => {
              const isServicePrice = item.type === 'service_price'
              const displayValue = isServicePrice && editingPriceId === item.id
                ? editingPriceValue
                : (isServicePrice ? item.value : null)

              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-border"
                >
                  {isServicePrice ? (
                    <>
                      <span className="text-sm font-medium min-w-0 shrink-0">{item.label}</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={displayValue ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value
                          const formatted = formatCurrencyBRL(raw)
                          setEditingPriceValue(formatted)
                          if (!editingPriceId) setEditingPriceId(item.id)
                        }}
                        onFocus={() => {
                          setEditingPriceId(item.id)
                          setEditingPriceValue(item.value || '')
                        }}
                        onBlur={() => {
                          if (editingPriceId === item.id && onItemEditLocal) {
                            const toSave = (editingPriceValue || '').trim()
                            onItemEditLocal(item.id, toSave ? formatCurrencyBRL(editingPriceValue) : '')
                          }
                          setEditingPriceId(null)
                          setEditingPriceValue('')
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            if (onItemEditLocal) {
                              const toSave = (editingPriceValue || '').trim()
                              onItemEditLocal(item.id, toSave ? formatCurrencyBRL(editingPriceValue) : '')
                            }
                            setEditingPriceId(null)
                            setEditingPriceValue('')
                            ;(e.target as HTMLInputElement).blur()
                          }
                        }}
                        placeholder="R$ 0"
                        className="flex-1 min-w-[100px] px-2 py-1.5 text-sm rounded border border-input bg-background"
                      />
                    </>
                  ) : editingId === item.id ? (
                    <>
                      <input
                        type="text"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleEditSave(item.id)
                          } else if (e.key === 'Escape') {
                            handleEditCancel()
                          }
                        }}
                        className="flex-1 px-2 py-1 text-sm rounded border border-input bg-background"
                        autoFocus
                      />
                      <button
                        onClick={() => handleEditSave(item.id)}
                        className="p-1 text-green-600 hover:text-green-700"
                        title="Salvar"
                      >
                        ✓
                      </button>
                      <button
                        onClick={handleEditCancel}
                        className="p-1 text-red-600 hover:text-red-700"
                        title="Cancelar"
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-muted-foreground">{item.label}</div>
                        <div className="text-sm truncate">
                          {item.id === 'schedule' ? formatScheduleValuePtBR(item.value) : item.value}
                        </div>
                      </div>
                      <button
                        onClick={() => handleEditStart(item)}
                        className="p-1.5 hover:bg-muted rounded transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {(item.id.startsWith('service_') ||
                        item.id.startsWith('faq_') ||
                        item.id.startsWith('variable_') ||
                        item.id === 'schedule' ||
                        item.id === 'service_area' ||
                        item.id === 'tone_of_voice' ||
                        item.id === 'policies') && (
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 hover:bg-muted rounded transition-colors text-red-600 hover:text-red-700"
                          title="Remover"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Input enxuto para adicionar mais serviços em services_edit (sem checkboxes). */}
        {!isUser && isServicesEditInput && (!selectableOptions || selectableOptions.length === 0) && (
          <div className="mt-4 space-y-2">
            <div className="rounded-lg border border-border bg-background/50 p-3">
              <p className="text-xs text-muted-foreground mb-2">
                Adicione mais serviços separados por vírgula.
              </p>
              <input
                type="text"
                value={customInputValue}
                onChange={(e) => setCustomInputValue(e.target.value)}
                placeholder={customInputPlaceholderText}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background placeholder:text-muted-foreground"
              />
            </div>
            <button
              onClick={() => {
                if (!customInputValue.trim() || !onOptionSelect) return
                onOptionSelect([], customInputValue.trim())
                setCustomInputValue('')
              }}
              disabled={!canConfirm}
              className={cn(
                'w-full mt-3 px-4 py-2 rounded-lg text-sm font-normal transition-colors',
                canConfirm
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
            >
              Adicionar serviços ({totalCount})
            </button>
          </div>
        )}

        {/* Checkboxes para seleção múltipla (dias da semana, serviços, etc) */}
        {!isUser && selectableOptions && selectableOptions.length > 0 && (
          <div className="mt-4 space-y-2">
            {isServicesSelection && (
              <div className="mb-3 rounded-lg border border-border bg-background/50 p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  Escreva seus servicos do seu jeito, separados por virgula.
                </p>
                <input
                  type="text"
                  value={customInputValue}
                  onChange={(e) => setCustomInputValue(e.target.value)}
                  placeholder={customInputPlaceholderText}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background placeholder:text-muted-foreground"
                />
              </div>
            )}
            {isServicesSelection && (
              <p className="text-xs text-muted-foreground mb-1">Sugestoes da IA (opcional):</p>
            )}
            {selectableOptions.map((option) => (
              <label
                key={option.id}
                className="flex items-center gap-2 p-2 rounded-lg bg-background/50 border border-border cursor-pointer hover:bg-background/70 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedOptions.has(option.value)}
                  onChange={() => handleOptionToggle(option.value)}
                  className="w-4 h-4 rounded border-input"
                />
                <span className="text-sm flex-1">{option.label}</span>
              </label>
            ))}
            {allowCustomInput && !isServicesSelection && (
              <input
                type="text"
                value={customInputValue}
                onChange={(e) => setCustomInputValue(e.target.value)}
                placeholder={customInputPlaceholderText}
                className="w-full mt-2 px-3 py-2 text-sm rounded-lg border border-border bg-background placeholder:text-muted-foreground"
              />
            )}
            <button
              onClick={handleConfirmSelection}
              disabled={!canConfirm}
              className={cn(
                'w-full mt-3 px-4 py-2 rounded-lg text-sm font-normal transition-colors',
                canConfirm
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
            >
              Confirmar seleção ({totalCount} {totalCount === 1 ? 'item selecionado' : 'itens selecionados'})
            </button>
          </div>
        )}
        
        {/* Botões de ação (single) ou multi-select (checkboxes) */}
        {!isUser && actionOptions && actionOptions.length > 0 && !actionOptionsMultiSelect && (
          <div className="flex flex-wrap gap-2 mt-3">
            {actionOptions.map((option, index) => {
              if (option.startsWith('open_url|')) {
                const [, label, url] = option.split('|')
                if (!label || !url) return null
                return (
                  <a
                    key={index}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      'px-4 py-2',
                      'rounded-lg',
                      'text-sm font-normal',
                      'bg-background dark:bg-foreground/10',
                      'text-foreground',
                      'border border-border',
                      'hover:bg-muted',
                      'transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-primary/20'
                    )}
                  >
                    {label}
                  </a>
                )
              }
              return (
                <button
                  key={index}
                  onClick={() => {
                    if (option === 'Continuar') flushPendingInlineEdits()
                    onActionClick?.(option)
                  }}
                  className={cn(
                    'px-4 py-2',
                    'rounded-lg',
                    'text-sm font-normal',
                    'bg-background dark:bg-foreground/10',
                    'text-foreground',
                    'border border-border',
                    'hover:bg-muted',
                    'transition-colors',
                    'focus:outline-none focus:ring-2 focus:ring-primary/20'
                  )}
                >
                  {option}
                </button>
              )
            })}
          </div>
        )}
        {!isUser && actionOptions && actionOptions.length > 0 && actionOptionsMultiSelect && (
          <div className="flex flex-col gap-2 mt-3">
            <div className="flex flex-wrap gap-3">
              {actionOptions.map((option, index) => {
                if (option.startsWith('open_url|')) return null
                const isChecked = selectedActionIndices.has(index)
                return (
                  <label
                    key={index}
                    className={cn(
                      'flex items-center gap-2 cursor-pointer',
                      'px-3 py-2 rounded-lg border text-sm',
                      isChecked
                        ? 'bg-primary/10 border-primary text-foreground'
                        : 'bg-background dark:bg-foreground/10 border-border text-foreground hover:bg-muted'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        setSelectedActionIndices((prev) => {
                          const next = new Set(prev)
                          if (next.has(index)) next.delete(index)
                          else next.add(index)
                          return next
                        })
                      }}
                      className="rounded border-border"
                    />
                    <span>{option.replace(/^\d+\s*-\s*/, '')}</span>
                  </label>
                )
              })}
            </div>
            <button
              type="button"
              onClick={() => {
                if (selectedActionIndices.size === 0) return
                const labels = Array.from(selectedActionIndices)
                  .sort((a, b) => a - b)
                  .map((i) => stripOptionLabel(actionOptions![i]))
                onActionClick?.(labels.join(', '))
                setSelectedActionIndices(new Set())
              }}
              disabled={selectedActionIndices.size === 0}
              className={cn(
                'self-start px-4 py-2 rounded-lg text-sm font-medium',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:opacity-50 disabled:pointer-events-none',
                'focus:outline-none focus:ring-2 focus:ring-primary/20'
              )}
            >
              Confirmar seleção ({selectedActionIndices.size} {selectedActionIndices.size === 1 ? 'serviço' : 'serviços'})
            </button>
          </div>
        )}

        {timestamp && (
          <p className="text-xs mt-1 opacity-70">
            {timestamp.toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>
    </div>
  )
}
