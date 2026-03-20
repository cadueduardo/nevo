// @ts-nocheck
import { generateInformationalReplyWithAI } from "../../ai.ts"
import { buildCalendarLinkForBooking } from "../../calendar.ts"
import { formatExternalQuote } from "../../quote-engine.ts"
import { deriveInformationalContext } from "../informational-context.ts"
import type { SemanticRuntimeResult } from "../runtime.ts"
import {
  buildCalendarConfirmedMessage,
  buildCalendarDeclinedMessage,
  buildClosingMessage,
  buildFallbackClarificationMessage,
  buildFaqFallbackMessage,
  buildIdentityMessage,
  buildOutOfScopeServiceRedirectMessage,
  buildQuoteEstimateMessage,
  buildQuoteMeasurementsMessage,
  buildServiceDetailMessage,
  buildServiceListMessage,
  buildServicePriceMessage,
  resolveSemanticPromptText,
} from "./prompt-library.ts"
import type { RenderedSemanticMessage } from "./shared.ts"

function resolvePriceReplyMessage(params: {
  aiMessage: string | null
  serviceName?: string
  servicePrice?: number
}): string {
  const fallback = buildServicePriceMessage(params.serviceName, params.servicePrice)
  if (typeof params.servicePrice !== "number") {
    return params.aiMessage || fallback
  }

  const expectedPrice = `R$ ${params.servicePrice}`
  const aiMessage = (params.aiMessage || "").trim()
  if (!aiMessage) return fallback
  if (/sob consulta/i.test(aiMessage)) return fallback
  if (!aiMessage.includes(expectedPrice)) return fallback
  return aiMessage
}

export async function renderInformational(semantic: SemanticRuntimeResult): Promise<RenderedSemanticMessage> {
  const info = deriveInformationalContext(semantic.snapshot, semantic.context)
  const decision = semantic.decision
  const services = info.service_names
  const businessName = info.business_name

  const tryContextualReply = async (
    action:
      | "reply_identity"
      | "reply_faq"
      | "reply_price"
      | "reply_service_detail"
      | "reply_service_list"
      | "reply_closing"
      | "reply_open_context"
  ): Promise<string | null> =>
    await generateInformationalReplyWithAI({
      config: semantic.business_brain.raw_config,
      message: semantic.snapshot.meta.raw_user_message || "",
      history: semantic.context.history,
      action,
      businessName,
      serviceNames: services,
      selectedServiceName: info.selected_service_name,
      selectedServicePrice: info.selected_service_price,
      selectedServiceDescription: info.selected_service_description,
      faqAnswer: info.answer,
      runtimeContext: {
        business_brain: semantic.business_brain,
        agent_narrative: semantic.business_brain.agent_narrative,
        agent_runtime_context: semantic.business_brain.agent_runtime_context,
      },
    })

  const prependIdentityIfFirst = (msg: string): string => {
    const isFirst =
      (semantic.context.state as any)?._isFirstMessage === true ||
      (Array.isArray(semantic.context.history) ? semantic.context.history.filter((m) => m?.role === "user").length : 0) === 0
    if (!isFirst) return msg
    const businessNameLocal = semantic.business_brain.business_name
    const identity = businessNameLocal ? `Aqui é da ${businessNameLocal}.` : "Aqui é do atendimento."
    const trimmed = String(msg || "").trim()
    if (!trimmed) return identity
    if (businessNameLocal && trimmed.toLowerCase().includes(String(businessNameLocal).toLowerCase())) return trimmed
    if (trimmed.toLowerCase().includes("aqui e") || trimmed.toLowerCase().includes("aqui é")) return trimmed
    return `${identity} ${trimmed}`.trim()
  }

  switch (decision.action) {
    case "ask_clarification":
      return {
        message: resolveSemanticPromptText({
          next_question: decision.next_question,
          fallback: buildFallbackClarificationMessage(),
          brain: semantic.business_brain,
        }),
        action_options: ["Quero agendar", "Quero tirar uma dúvida"],
      }
    case "reply_faq":
      return {
        message: prependIdentityIfFirst(
          (await tryContextualReply("reply_faq")) || info.answer || buildFaqFallbackMessage(businessName)
        ),
      }
    case "reply_identity":
      return {
        message: (await tryContextualReply("reply_identity")) || buildIdentityMessage(businessName),
      }
    case "reply_calendar_confirmed": {
      const lastBooking = semantic.context.state?.last_booking as
        | { attendee_name?: string; service?: string; staff_name?: string; date?: string; time?: string }
        | undefined
      const config = semantic.business_brain?.raw_config
      let message = buildCalendarConfirmedMessage()
      if (config && lastBooking?.date && lastBooking?.time) {
        const link = await buildCalendarLinkForBooking({
          config,
          attendeeName: lastBooking.attendee_name,
          service: lastBooking.service,
          staffName: lastBooking.staff_name,
          dateIso: lastBooking.date,
          time: lastBooking.time,
        })
        if (link?.calendar_url) {
          message += `\n\nPode acessar o link abaixo para adicionar na sua agenda:\n${link.calendar_url}`
        }
      }
      return { message }
    }
    case "reply_calendar_declined":
      return {
        message: buildCalendarDeclinedMessage(),
      }
    case "reply_closing":
      return {
        message: (await tryContextualReply("reply_closing")) || buildClosingMessage(),
      }
    case "reply_price": {
      const aiPriceReply = await tryContextualReply("reply_price")
      return {
        message: prependIdentityIfFirst(resolvePriceReplyMessage({
          aiMessage: aiPriceReply,
          serviceName: info.selected_service_name,
          servicePrice: info.selected_service_price,
        })),
        action_options: info.selected_service_name ? ["Quero agendar"] : services,
      }
    }
    case "ask_quote_measurements":
      return {
        message: buildQuoteMeasurementsMessage(info.quote?.service?.name),
      }
    case "reply_quote_estimate":
      return {
        message: buildQuoteEstimateMessage(
          info.quote?.range ? formatExternalQuote({
            service_name: info.quote.service.name,
            min: info.quote.range.min,
            max: info.quote.range.max,
            currency: info.quote.range.currency,
          }) : undefined
        ),
        action_options: ["Sim, quero agendar", "Depois"],
      }
    case "reply_service_detail":
      return {
        message: (await tryContextualReply("reply_service_detail")) || buildServiceDetailMessage(info.selected_service_name, info.selected_service_description),
      }
    case "reply_service_list":
      return {
        message:
          (await tryContextualReply("reply_service_list")) ||
          (decision.reason === "service_out_of_scope_redirect"
            ? buildOutOfScopeServiceRedirectMessage(businessName)
            : buildServiceListMessage(businessName)),
        action_options: decision.reason === "service_out_of_scope_redirect" ? services : undefined,
      }
    default: {
      const openContextReply = await tryContextualReply("reply_open_context")
      return {
        message: openContextReply || buildFallbackClarificationMessage(),
        action_options: ["Quero agendar"],
      }
    }
  }
}
