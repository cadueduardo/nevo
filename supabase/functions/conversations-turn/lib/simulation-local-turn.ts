// @ts-nocheck
/**
 * Simulador do onboarding: mesmo motor semântico, sem gravar conversa/estado no banco.
 * Estado e histórico ficam no cliente (sessionStorage).
 */
import { isEndTestCommand } from "./detection.ts"
import { createSimulatorState } from "./state.ts"
import { runSemanticCoreTurn } from "./semantic-core/runtime.ts"
import { renderSemanticSimulatorResult } from "./semantic-core/renderers/index.ts"
import type { SimulatorConfig, SimulatorResult, SimulatorState } from "./types.ts"
import {
  resolveConfiguredServicesFromConfig,
  resolveSequenceEligibleServicesFromConfig,
} from "./canonical-services.ts"

function isInternalOwnerActor(body: { mode?: string; actor_type?: string }): boolean {
  return body.mode === "internal" && (body.actor_type === "owner" || body.actor_type === "admin")
}

function shouldRenderServiceMultiSelect(params: {
  result: SimulatorResult
  resultState: SimulatorState
  config: SimulatorConfig
}): boolean {
  const { result, resultState, config } = params
  if (Boolean(result.render_hints?.service_multi_select)) return true
  const isServiceStep =
    (resultState.service_selection_multi ?? false) && !resultState.slots?.service
  if (!isServiceStep) return false
  const normalizeOption = (v: string) =>
    String(v || "")
      .replace(/^\d+\s*-\s*/, "")
      .trim()
      .toLowerCase()
  const actionOptions = Array.isArray(result.action_options)
    ? result.action_options.map(normalizeOption).filter(Boolean)
    : []
  const serviceOptions = Array.isArray(resultState.last_service_options)
    ? resultState.last_service_options.map(normalizeOption).filter(Boolean)
    : []
  if (actionOptions.length === 0 || serviceOptions.length === 0) return false
  if (!actionOptions.every((opt) => serviceOptions.includes(opt))) return false
  const catalogServiceOptions = [
    ...resolveConfiguredServicesFromConfig(config).map((s) => String(s?.name || "")),
    ...resolveSequenceEligibleServicesFromConfig(config).map((s) => String(s || "")),
    "Quero agendar uma visita",
    "visita",
  ]
    .map(normalizeOption)
    .filter(Boolean)
  if (catalogServiceOptions.length === 0) return false
  return actionOptions.every((opt) => catalogServiceOptions.includes(opt))
}

function stripStateForClient(state: SimulatorState): SimulatorState {
  const {
    _isFirstMessage,
    outgoing_assistant_messages,
    outbound_notifications,
    ...rest
  } = state as SimulatorState & {
    _isFirstMessage?: boolean
    outgoing_assistant_messages?: unknown
    outbound_notifications?: unknown
  }
  void outgoing_assistant_messages
  void outbound_notifications
  return rest as SimulatorState
}

export type SimulationLocalBody = {
  message: string
  session_id: string
  mode?: string
  actor_type?: string
  sender_display_name?: string
  simulator_state?: SimulatorState | null
  simulator_history?: Array<{ role: string; content: string }>
}

export async function executeSimulationLocalTurn(
  body: SimulationLocalBody,
  config: SimulatorConfig
): Promise<{
  conversation_id: string
  messages: Array<{
    role: "assistant"
    content: string
    created_at: string
    action_options?: string[]
    service_multi_select?: boolean
  }>
  simulator_state: SimulatorState
  simulation_local: true
}> {
  const nowIso = new Date().toISOString()

  if (isEndTestCommand(body.message)) {
    return {
      conversation_id: "local",
      messages: [
        {
          role: "assistant",
          content:
            "Simulação zerada. Envie outra mensagem para começar de novo. (Tudo continua só no seu navegador.)",
          created_at: nowIso,
        },
      ],
      simulator_state: createSimulatorState(),
      simulation_local: true,
    }
  }

  if (isInternalOwnerActor(body)) {
    const prev = body.simulator_state && typeof body.simulator_state === "object"
      ? stripStateForClient(body.simulator_state as SimulatorState)
      : createSimulatorState()
    return {
      conversation_id: "local",
      messages: [
        {
          role: "assistant",
          content:
            "Neste simulador de teste os dados ficam só no seu navegador. Use **Como cliente** para testar o atendimento. Comandos de dono (agenda, orçamentos) ficam no painel, no simulador após salvar o agente — lá a conversa usa sua conta.",
          created_at: nowIso,
        },
      ],
      simulator_state: prev,
      simulation_local: true,
    }
  }

  const historyRaw = Array.isArray(body.simulator_history) ? body.simulator_history : []
  const history = historyRaw
    .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
    .slice(-20)
    .map((h) => ({ role: h.role, content: String(h.content).trim() }))

  const userTurnsBefore = history.filter((h) => h.role === "user").length
  const isFirstMessage = userTurnsBefore === 0

  // Quando o usuário está começando a conversa (primeiro turno), não reutilizar
  // simulator_state persistido de uma tentativa anterior. Isso evita o simulador
  // “continuar preso” em passos (ex.: pending_contact_field) de outro teste.
  let baseState: SimulatorState =
    isFirstMessage
      ? createSimulatorState()
      : body.simulator_state && typeof body.simulator_state === "object"
        ? ({ ...body.simulator_state, slots: body.simulator_state.slots || { quote_answers: {} } } as SimulatorState)
        : createSimulatorState()
  if (!baseState.slots) baseState = { ...baseState, slots: { quote_answers: {} } }

  const stateWithFirstFlag = { ...baseState, _isFirstMessage: isFirstMessage }

  const semantic = await runSemanticCoreTurn({
    message: body.message,
    channel: "web_simulator",
    config,
    state: stateWithFirstFlag,
    history,
    sender_display_name: body.sender_display_name?.trim() || undefined,
    session_id: body.session_id,
    sender_id: undefined,
  })

  const result = await renderSemanticSimulatorResult(stateWithFirstFlag, semantic)
  const resultState = result.state as SimulatorState
  const extraAssistantMessages = Array.isArray(resultState?.outgoing_assistant_messages)
    ? (resultState.outgoing_assistant_messages || [])
    : []
  const filteredExtra = extraAssistantMessages.filter(
    (m: { content?: string }) => typeof m?.content === "string" && m.content.trim().length > 0
  )

  const saved = stripStateForClient(resultState)

  const mainMsg = {
    role: "assistant" as const,
    content: result.message,
    created_at: nowIso,
    action_options: result.action_options,
    service_multi_select: shouldRenderServiceMultiSelect({
      result,
      resultState,
      config,
    }),
  }

  const extraMsgs = filteredExtra.map(
    (m: { content: string; action_options?: string[]; service_multi_select?: boolean }) => ({
      role: "assistant" as const,
      content: m.content,
      created_at: nowIso,
      action_options: m.action_options,
      service_multi_select: Boolean(m.service_multi_select),
    })
  )

  return {
    conversation_id: "local",
    messages: [mainMsg, ...extraMsgs],
    simulator_state: saved,
    simulation_local: true,
  }
}
