/**
 * Validação de nós para canvas (canvas.md §10.2, §8).
 * Nó inválido: destaque vermelho + tooltip.
 */

import { normalizeNodeType } from '../types'
import type { FlowNodeShape } from '../types'

/** Retorna mensagem de erro se o nó for inválido; null se válido. */
export function getNodeValidationError(node: FlowNodeShape): string | null {
  const type = normalizeNodeType(node.type)
  const data = node.data ?? {}

  switch (type) {
    case 'start':
      return null
    case 'message':
      if (!data.message?.trim()) return 'Mensagem é obrigatória.'
      if (data.ui?.kind && data.ui.kind !== 'text' && (!data.ui.options?.length)) {
        return 'Botões ou lista exigem ao menos uma opção.'
      }
      return null
    case 'question':
      if (!data.message?.trim()) return 'Pergunta (mensagem) é obrigatória.'
      if (!data.variable?.trim()) return 'Variável para salvar a resposta é obrigatória.'
      return null
    case 'ai':
      if (!data.prompt?.trim() && !data.message?.trim()) {
        return 'Prompt ou instruções para a IA são obrigatórios.'
      }
      return null
    case 'condition':
      if (!data.conditionRule?.trim()) return 'Regra da condição é obrigatória.'
      const branches = data.branches ?? []
      if (branches.length === 0) return 'Defina ao menos uma saída (branch) com label.'
      const emptyLabel = branches.some((b) => !(b.label ?? '').trim())
      if (emptyLabel) return 'Cada saída da condição deve ter um label.'
      return null
    case 'handoff':
      return null
    case 'end':
      return null
    default:
      return 'Tipo de nó não suportado.'
  }
}

/** Indica se o nó é compatível com WhatsApp (message/question: texto, botões, lista). */
export function isWhatsAppCompatible(node: FlowNodeShape): boolean {
  const type = normalizeNodeType(node.type)
  if (type !== 'message' && type !== 'question') return true
  const ui = node.data?.ui
  if (!ui?.kind || ui.kind === 'text') return true
  if (ui.kind === 'buttons' || ui.kind === 'list') {
    const opts = ui.options ?? []
    if (opts.length > 0 && opts.length <= (ui.kind === 'buttons' ? 6 : 10)) return true
  }
  return false
}
