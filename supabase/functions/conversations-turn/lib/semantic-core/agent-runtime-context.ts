// @ts-nocheck
import type { AgentNarrative, AgentRuntimeContext, BusinessBrain } from "./types.ts"

function joinSections(sections: Array<[string, string | undefined]>): string {
  return sections
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([label, value]) => `${label}:\n${String(value).trim()}`)
    .join("\n\n")
}

export function buildAgentRuntimeContext(params: {
  business_brain: BusinessBrain
  agent_narrative?: AgentNarrative
}): AgentRuntimeContext {
  const businessBrain = params.business_brain
  const agentNarrative = params.agent_narrative || businessBrain.agent_narrative

  const identityContext = agentNarrative.summary
  const serviceContext = agentNarrative.service_overview
  const audienceContext = agentNarrative.audience_rules
  const operationalContext = agentNarrative.operational_rules
  const bookingContext = [
    agentNarrative.tone_guidance,
    agentNarrative.booking_guidance,
  ].filter(Boolean).join(" ")
  const multiBookingContext = agentNarrative.multi_booking_guidance
  const triageContext = agentNarrative.triage_guidance

  return {
    identity_context: identityContext,
    service_context: serviceContext,
    audience_context: audienceContext,
    operational_context: operationalContext,
    booking_context: bookingContext,
    multi_booking_context: multiBookingContext,
    triage_context: triageContext,
    prompt_context: joinSections([
      ["IDENTIDADE DO AGENTE", identityContext],
      ["ESCOPO DE SERVICOS", serviceContext],
      ["PUBLICO E ELEGIBILIDADE", audienceContext],
      ["REGRAS OPERACIONAIS", operationalContext],
      ["CONDUCAO DE ATENDIMENTO E BOOKING", bookingContext],
      ["MULTIAGENDAMENTO", multiBookingContext],
      ["TRIAGEM E REDIRECIONAMENTO", triageContext],
    ]),
  }
}
