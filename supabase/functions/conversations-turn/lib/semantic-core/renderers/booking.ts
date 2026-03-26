// @ts-nocheck
import { generateAdaptiveGreetingWithAI, generateBookingReplyWithAI } from "../../ai.ts"
import { deriveBookingContext } from "../booking-context.ts"
import type { SemanticRuntimeResult } from "../runtime.ts"
import {
  buildAttendeeQuestion,
  buildAudienceConfirmationMessage,
  buildBookingConfirmationMessage,
  buildBookingConfirmedMessage,
  buildCalendarOfferMessage,
  buildContactQuestion,
  buildSecondaryContactQuestion,
  buildWhatsAppPrimaryPhoneConfirmQuestion,
  buildPrimaryPhoneQuestion,
  buildDateQuestion,
  buildFallbackClarificationMessage,
  buildGreetingFallbackMessage,
  buildNextAttendeePrompt,
  buildSequenceOfferQuestion,
  buildServiceQuestion,
  buildTimeQuestion,
  resolveSemanticPromptText,
  shouldUsePluralAudienceCopy,
} from "./prompt-library.ts"
import type { RenderedSemanticMessage } from "./shared.ts"
import { formatDatePt } from "../../utils.ts"
import { addDaysToIsoDate, getTodayIsoBusinessTz } from "../../utils.ts"

function getAttendeeName(semantic: SemanticRuntimeResult): string | undefined {
  return semantic.execution?.slot_updates?.attendee_name || semantic.decision.slot_updates?.attendee_name
}

function getServiceNames(semantic: SemanticRuntimeResult): string[] {
  return semantic.execution?.metadata?.service_names || semantic.snapshot.entities.services.map((service) => service.name)
}

function getDate(semantic: SemanticRuntimeResult): string | undefined {
  return semantic.execution?.metadata?.date || semantic.snapshot.entities.date?.iso_date
}

function getTime(semantic: SemanticRuntimeResult): string | undefined {
  return semantic.execution?.metadata?.time || semantic.snapshot.entities.time?.hhmm
}

function isValidHHMM(value?: string): boolean {
  if (!value) return false
  const m = String(value).match(/^(\d{2}):(\d{2})$/)
  if (!m) return false
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (Number.isNaN(hh) || Number.isNaN(mm)) return false
  if (hh < 0 || hh > 23) return false
  if (mm < 0 || mm > 59) return false
  return true
}

function hasLeadingGreeting(message?: string): boolean {
  return /^(oi|oii|oa|ola|olá|opa|fala|salve|bom dia|boa tarde|boa noite)\b/i.test(String(message || "").trim())
}

function isFirstMeaningfulTurn(semantic: SemanticRuntimeResult): boolean {
  return !Array.isArray(semantic.context.history) || semantic.context.history.length === 0
}

export async function renderBooking(semantic: SemanticRuntimeResult): Promise<RenderedSemanticMessage> {
  const booking = deriveBookingContext(semantic.snapshot, semantic.context)
  const attendeeName = getAttendeeName(semantic) || booking.current_attendee_name
  const serviceNames = getServiceNames(semantic)
  // Importante: em passos como `ask_contact`, o usuÃ¡rio frequentemente nÃ£o repete data/hora.
  // EntÃ£o precisamos herdar do estado persistido, senÃ£o o texto pode usar um valor antigo do snapshot.
  let dateIso = getDate(semantic)
  if (!dateIso) dateIso = semantic.context.state?.slots?.date || booking.slot_updates?.date
  const time = getTime(semantic) || semantic.context.state?.slots?.time || booking.slot_updates?.time
  const decision = semantic.decision
  const execution = semantic.execution
  const brain = semantic.business_brain
  const rawUserMessage = semantic.snapshot.meta.raw_user_message || ""
  const usePluralAudienceCopy = shouldUsePluralAudienceCopy({
    additional_count: semantic.snapshot.signals.additional_count,
    attendee_names: semantic.snapshot.entities.attendee_names,
    people_count: Array.isArray(semantic.snapshot.entities.people) ? semantic.snapshot.entities.people.length : 0,
  })

  const dateLabel = (() => {
    if (!dateIso) return "hoje"
    if (dateIso === "hoje") return "hoje"
    if (dateIso === "amanha") return "amanhã"
    const todayIso = getTodayIsoBusinessTz()
    const tomorrowIso = addDaysToIsoDate(todayIso, 1)
    if (dateIso === todayIso) return "hoje"
    if (dateIso === tomorrowIso) return "amanhã"
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return formatDatePt(dateIso)
    return dateIso
  })()

  const tryContextualReply = async (
    action:
      | "ask_audience_confirmation"
      | "ask_attendee_name"
      | "ask_service"
      | "offer_sequence_template"
      | "ask_date"
      | "ask_time"
      | "ask_contact"
      | "confirm_booking"
      | "offer_calendar"
  ): Promise<string | null> =>
    await generateBookingReplyWithAI({
      config: semantic.business_brain.raw_config,
      message: semantic.snapshot.meta.raw_user_message || "",
      history: semantic.context.history,
      action,
      attendeeName,
      serviceNames,
      dateIso,
      time,
      runtimeContext: {
        business_brain: semantic.business_brain,
        agent_narrative: semantic.business_brain.agent_narrative,
        agent_runtime_context: semantic.business_brain.agent_runtime_context,
      },
    })

  const safeTryContextualReply = async (
    action: Parameters<typeof tryContextualReply>[0],
    opts?: { avoidSpecificDays?: boolean; avoidSpecificTimes?: boolean }
  ): Promise<string | null> => {
    const txt = await tryContextualReply(action)
    if (!txt) return null

    const lower = txt.toLowerCase()
    if (opts?.avoidSpecificDays) {
      // Se ainda nÃ£o escolheu data (ask_date), nÃ£o deixar a IA mencionar "hoje/amanhÃ£" nem datas explÃ­citas.
      const mentionsDay =
        /\b(hoje|amanhÃ£|amanha)\b/.test(lower) ||
        /\b(segunda|terÃ§a|terca|quarta|quinta|sexta|sabado|sÃ¡bado|domingo)\b/.test(lower) ||
        /\b\d{2}\/\d{2}\b/.test(lower) ||
        /\bdia\s+\d{1,2}\b/.test(lower)
      if (mentionsDay) return null
    }

    if (opts?.avoidSpecificTimes) {
      // Se ainda nÃ£o escolheu hora (ask_time), nÃ£o deixar a IA mencionar horÃ¡rios especÃ­ficos.
      const mentionsTime = /\b\d{1,2}:\d{2}\b/.test(lower) || /\bÃ s\s+\d{1,2}:\d{2}\b/.test(lower)
      if (mentionsTime) return null
    }

    return txt
  }

  const buildIntroGreetingPrefix = async (): Promise<string | null> => {
    if (!isFirstMeaningfulTurn(semantic) || !hasLeadingGreeting(rawUserMessage)) return null

    const aiGreeting = await generateAdaptiveGreetingWithAI(
      semantic.business_brain.raw_config,
      rawUserMessage,
      semantic.context.history,
      semantic.context.sender_display_name,
      {
        business_brain: semantic.business_brain,
        agent_narrative: semantic.business_brain.agent_narrative,
      }
    )

    const businessName = semantic.business_brain.business_name
    const identityLine = businessName ? `Aqui é o assistente virtual da ${businessName}.` : "Aqui é o assistente virtual."
    const fallback = buildGreetingFallbackMessage(
      semantic.business_brain.business_name,
      semantic.context.sender_display_name?.trim(),
      /\b(opa|fala|salve|e ai|suave|tranquilo|man)\b/.test(rawUserMessage.toLowerCase())
    )
    const base = String(aiGreeting || fallback).trim()
    if (!base) return null
    const baseLower = base.toLowerCase()
    if (/\baqui\s+[ée]\b/.test(baseLower) || /assistente virtual/.test(baseLower) || /sou o assistente/.test(baseLower)) {
      return base
    }
    return `${identityLine} ${base}`.trim()
  }

  const introGreetingPrefix = await buildIntroGreetingPrefix()
  const withIntroGreeting = (message: string) => (introGreetingPrefix ? `${introGreetingPrefix}\n\n${message}` : message)

  switch (decision.action) {
    case "ask_audience_confirmation":
      return {
        message:
          withIntroGreeting(
            resolveSemanticPromptText({
              next_question: decision.next_question,
              fallback: buildAudienceConfirmationMessage(brain, { plural: usePluralAudienceCopy }),
              brain,
              audiencePlural: usePluralAudienceCopy,
            })
          ),
        action_options: decision.action_options,
      }
    case "ask_attendee_name": {
      const isExplicitMulti =
        semantic.snapshot.intents.primary === "booking_sequence" ||
        (semantic.snapshot.signals.additional_count || 0) > 0 ||
        semantic.snapshot.signals.sequence_request === true
      const isOngoingAdditionalBooking =
        booking.has_completed_bookings ||
        Boolean(semantic.context.state.slots?.attendee_name) ||
        (Array.isArray(semantic.context.state.pending_attendee_queue) &&
          semantic.context.state.pending_attendee_queue.length > 0)
      return {
        message: withIntroGreeting(
          (await safeTryContextualReply("ask_attendee_name")) ||
            buildAttendeeQuestion({
              is_additional: isOngoingAdditionalBooking,
              is_explicit_multi: isExplicitMulti,
            })
        ),
      }
    }
    case "ask_service":
      if (booking.template_choice === "same_next") {
        return {
          message: `Perfeito. Antes de sugerir o prÃ³ximo horÃ¡rio em sequÃªncia para ${
            attendeeName || "a prÃ³xima pessoa"
          }, preciso confirmar o serviÃ§o.`,
          action_options: execution?.action_options || booking.service_options,
          render_hints: {
            service_multi_select: semantic.decision.channel_hints?.prefer_multi_select === true,
          },
        }
      }
      return {
        message:
          (await safeTryContextualReply("ask_service")) ||
          buildServiceQuestion(attendeeName, { allowSequence: Boolean(brain.policies.sequence_enabled) }),
        action_options: execution?.action_options || booking.service_options,
        render_hints: {
          service_multi_select: semantic.decision.channel_hints?.prefer_multi_select === true,
        },
      }
    case "offer_sequence_template":
      return {
        message: buildSequenceOfferQuestion(attendeeName),
        action_options: decision.action_options,
      }
    case "ask_date":
      if (booking.template_choice === "same_next" && booking.sequence_suggestion && !booking.sequence_suggestion.available) {
        return {
          message:
            (await tryContextualReply("ask_date")) ||
            "NÃ£o encontrei um prÃ³ximo horÃ¡rio livre na sequÃªncia desse atendimento. Vamos escolher outro dia ou outro horÃ¡rio para continuar.",
          action_options: execution?.action_options,
        }
      }
      return {
        message:
          (await safeTryContextualReply("ask_date", { avoidSpecificDays: true })) ||
          (() => {
            const timeLabel = isValidHHMM(time) ? ` Ã s ${time}` : ""
            if (attendeeName && (semantic.execution?.metadata?.attendee_name || booking.current_attendee_name)) {
              return `Perfeito, ${attendeeName}. Para o seu agendamento${timeLabel}, qual dia vocÃª prefere?`
            }
            return timeLabel ? `Para o horÃ¡rio${timeLabel}, qual dia vocÃª prefere?` : buildDateQuestion()
          })(),
        action_options: execution?.action_options,
      }
    case "ask_time":
      return {
        message:
          (await safeTryContextualReply("ask_time", { avoidSpecificTimes: true })) ||
          (dateLabel ? `Para ${dateLabel}, qual horÃ¡rio vocÃª prefere?` : buildTimeQuestion()),
        action_options: execution?.action_options,
      }
    case "ask_contact":
      if (semantic.context.state?.pending_secondary_contact) {
        return {
          message:
            buildSecondaryContactQuestion({
              attendeeName: (semantic.context.state.pending_secondary_contact as any)?.attendee_name,
            }),
        }
      }
      if (semantic.context.channel === "whatsapp" && semantic.context.state?.pending_primary_phone_confirmation) {
        return {
          message: buildWhatsAppPrimaryPhoneConfirmQuestion(
            (semantic.context.state as any)?.primary_phone_candidate
          ),
        }
      }
      if (semantic.context.channel === "whatsapp" && semantic.context.state?.pending_contact_field === "phone") {
        return { message: buildPrimaryPhoneQuestion() }
      }
      // Quando o usuÃ¡rio perguntou disponibilidade com horÃ¡rio (ex.: "tem para hoje Ã s 16?"),
      // apresentamos isso de forma determinÃ­stica antes de pedir o contato.
      if (semantic.snapshot.signals.availability_check === true && isValidHHMM(time)) {
        return {
          message: `Tenho horÃ¡rio disponÃ­vel ${dateLabel} Ã s ${time}. Podemos marcar? ${buildContactQuestion()}`,
        }
      }
      // Blindagem: nÃ£o permitir que a IA "confirme" agendamento no passo de contato.
      return { message: buildContactQuestion(), action_options: decision.action_options }
    case "confirm_booking":
      if (execution?.metadata?.completed_booking) {
        const confirmed = execution.metadata.completed_booking as any
        const postPlan = execution.metadata.post_confirmation_plan as any
        const lines = [(await tryContextualReply("confirm_booking")) || buildBookingConfirmedMessage(confirmed)]
        if (postPlan?.has_more_people) {
          lines.push(buildNextAttendeePrompt(postPlan))
        } else {
          // Se houver notificaÃ§Ãµes automÃ¡ticas jÃ¡ planejadas, informar (mas ainda oferecer calendÃ¡rio).
          if ((postPlan?.outbound_notifications || []).length > 0) {
            lines.push(
              `Enviei a confirmaÃ§Ã£o dos outros agendamentos para ${(postPlan.outbound_notifications || []).length} contato(s) via WhatsApp.`
            )
          }
          // Se ainda falta telefone da 2Âª pessoa, perguntar aqui (sem depender de botÃµes).
          if (semantic.context.state?.pending_secondary_contact) {
            lines.push(
              buildSecondaryContactQuestion({
                attendeeName: (semantic.context.state.pending_secondary_contact as any)?.attendee_name,
              })
            )
          } else {
            lines.push("Quer marcar este compromisso na sua agenda?")
          }
        }
        return {
          message: lines.join("\n\n"),
          action_options:
            postPlan?.has_more_people
              ? postPlan?.next_action_options || ["Continuar agendamento"]
              : ["Adicionar no calend\u00e1rio", "N\u00e3o, obrigado"],
        }
      }
      return {
        // Blindagem: quando ainda NÃƒO finalizamos (pendÃªncia de confirmaÃ§Ã£o),
        // nÃ£o deixamos o AI reescrever a mensagem como se estivesse "confirmado".
        message: buildBookingConfirmationMessage(serviceNames, attendeeName, dateLabel, time),
        // Quando ainda nÃ£o finalizamos (pendÃªncia de confirmaÃ§Ã£o), mostrar a opÃ§Ã£o para o usuÃ¡rio.
        action_options: execution?.action_options,
      }
    case "offer_calendar":
      return {
        message: (await tryContextualReply("offer_calendar")) || buildCalendarOfferMessage(),
        action_options: decision.action_options,
      }
    default:
      return {
        message: buildFallbackClarificationMessage(),
        action_options: ["Quero agendar"],
      }
  }
}








