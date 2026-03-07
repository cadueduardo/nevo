// @ts-nocheck
import type { SemanticRuntimeResult } from "../runtime.ts"

export function renderInformational(semantic: SemanticRuntimeResult): { message: string; action_options?: string[] } {
  const brain = semantic.business_brain
  const decision = semantic.decision
  const services = brain.services.map((service) => service.name)
  const businessName = brain.business_name || "a empresa"

  switch (decision.action) {
    case "reply_identity":
      return {
        message: `Aqui e da ${businessName}. Vou te ajudar no que precisar.`,
        action_options: ["Quero agendar"],
      }
    case "reply_price":
      return {
        message: "Posso te informar os valores certinhos e te ajudar a agendar. Qual servico voce quer consultar?",
        action_options: services,
      }
    case "reply_service_detail":
      return {
        message: "Posso te explicar melhor esse servico e, se quiser, ja seguimos para o agendamento.",
        action_options: ["Quero agendar"],
      }
    case "reply_service_list":
      return {
        message: `Estes sao os servicos disponiveis em ${businessName}. Qual voce quer agendar?`,
        action_options: services,
      }
    default:
      return {
        message: "Pode me dar mais detalhes sobre o que voce precisa? Assim, consigo te ajudar melhor.",
        action_options: ["Quero agendar"],
      }
  }
}
