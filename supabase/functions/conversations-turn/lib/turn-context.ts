// @ts-nocheck
/** Tipos de contexto usados pelo handler do turno (processSimulatorMessage). */
import type { SimulatorConfig, SimulatorState } from "./types.ts"

/** Contexto de runtime da conversa (tenant, agente, canal, contato, etc.). */
export type ConversationRuntimeContext = {
  supabaseAdmin: any
  tenantId: string
  agentId: string
  channel?: "web_simulator" | "whatsapp"
  sessionId?: string
  senderId?: string
  /** FASE 7: true = cliente externo; bloqueia cancelamento e consulta de agenda. */
  isExternalActor?: boolean
  contactId?: string
  contact?: { display_name?: string | null }
  senderDisplayName?: string
  history: Array<{ role: string; content: string }>
  config: SimulatorConfig
}

/** Contexto para o handler de mensagem em modo booking. */
export type SimulatorHandlerContext = {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  runtime?: ConversationRuntimeContext
}

import type { FlowOrchestratorOutput } from "./types.ts"

/** Contexto compartilhado pelas fases do pipeline e pelos early steps do turno. */
export type TurnPipelineContext = {
  text: string
  config: SimulatorConfig
  nextState: SimulatorState
  history: Array<{ role: string; content: string }>
  senderDisplayName?: string
  isFirst: boolean
  textNorm: string
  /** Opção numérica "Quero agendar" selecionada. */
  hasForcedBookingAction: boolean
  hasStrongBookingIntent: boolean
  minOrchestratorConfidence: number
  getOrchestrator: () => Promise<FlowOrchestratorOutput | null>
  runtime?: ConversationRuntimeContext
}
