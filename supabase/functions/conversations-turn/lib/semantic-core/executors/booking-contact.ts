// @ts-nocheck
import type { SemanticDecisionResult, SemanticExecutorResult, SemanticTurnContext, TurnSemanticSnapshot } from "../types.ts"
import { deriveBookingContext } from "../booking-context.ts"
import { buildExecutorResult, buildBookingQueueState } from "./shared.ts"
import { isNo, isYes } from "../../detection.ts"
import { formatEstablishmentAddress } from "../../calendar.ts"
import { formatDatePt } from "../../utils.ts"

export function executeBookingContact(
  decision: SemanticDecisionResult,
  snapshot: TurnSemanticSnapshot,
  context: SemanticTurnContext
): SemanticExecutorResult {
  const booking = deriveBookingContext(snapshot, context)
  const queueState = buildBookingQueueState(decision, snapshot, context)
  const pendingSecondary = context.state.pending_secondary_contact
  const rawMsg = snapshot.meta.raw_user_message || ""
  const phone = snapshot.signals.contact_phone
  const senderDigits =
    typeof context.sender_id === "string" ? context.sender_id.replace(/\D+/g, "") : ""
  const hasSenderPhone = senderDigits.length >= 10 && senderDigits.length <= 13

  // Fluxo especial: após 2º agendamento, coletar telefone para avisar a 2ª pessoa.
  if (pendingSecondary) {
    if (isNo(rawMsg)) {
      return buildExecutorResult({
        executor: "booking-contact",
        decision,
        state_patch: {
          pending_secondary_contact: undefined,
          pending_calendar_offer: true,
          pending_contact_field: undefined,
        },
      })
    }
    if (phone) {
      const address = formatEstablishmentAddress(context.business_brain.raw_config)
      const serviceLabel = String(pendingSecondary.service || "seu atendimento")
      const dateLabel = pendingSecondary.date ? formatDatePt(pendingSecondary.date) : ""
      const timeLabel = pendingSecondary.time ? ` às ${pendingSecondary.time}` : ""
      const addressLine = address ? `\nEndereco: ${address}` : ""
      return buildExecutorResult({
        executor: "booking-contact",
        decision,
        state_patch: {
          pending_secondary_contact: undefined,
          pending_calendar_offer: true,
          pending_contact_field: undefined,
          outbound_notifications: [
            ...(Array.isArray(context.state.outbound_notifications) ? context.state.outbound_notifications : []),
            {
              phone,
              content: `Ola ${pendingSecondary.attendee_name || "cliente"}! Seu agendamento de ${serviceLabel} foi confirmado para ${dateLabel}${timeLabel}.${addressLine}`,
            },
          ],
        },
      })
    }
    return buildExecutorResult({
      executor: "booking-contact",
      decision,
      state_patch: { pending_contact_field: "contact_preference" },
    })
  }

  // WhatsApp: confirmação do telefone principal (usar o mesmo número do remetente ou outro).
  if (context.channel === "whatsapp") {
    // Se o usuário já está no passo de informar telefone manualmente.
    if (context.state.pending_contact_field === "phone") {
      if (phone) {
        return buildExecutorResult({
          executor: "booking-contact",
          decision,
          slot_updates: { customer_phone: phone },
          state_patch: {
            pending_contact_field: undefined,
            pending_primary_phone_confirmation: false,
            primary_phone_candidate: undefined,
          },
        })
      }
      return buildExecutorResult({
        executor: "booking-contact",
        decision,
        state_patch: { pending_contact_field: "phone" },
      })
    }

    // Se existe candidato (número do remetente) e ainda não temos customer_phone, perguntar/confirmação.
    if (!context.state.slots?.customer_phone && !phone && hasSenderPhone) {
      // Usuário respondeu "sim": aceitar o número do remetente.
      if (context.state.pending_primary_phone_confirmation && isYes(rawMsg)) {
        return buildExecutorResult({
          executor: "booking-contact",
          decision,
          slot_updates: { customer_phone: senderDigits },
          state_patch: {
            pending_primary_phone_confirmation: false,
            primary_phone_candidate: undefined,
            pending_contact_field: undefined,
          },
        })
      }
      // Usuário respondeu com um telefone diretamente: usar esse.
      if (context.state.pending_primary_phone_confirmation && phone) {
        return buildExecutorResult({
          executor: "booking-contact",
          decision,
          slot_updates: { customer_phone: phone },
          state_patch: {
            pending_primary_phone_confirmation: false,
            primary_phone_candidate: undefined,
            pending_contact_field: undefined,
          },
        })
      }
      // Usuário respondeu "não": pedir outro telefone.
      if (context.state.pending_primary_phone_confirmation && isNo(rawMsg)) {
        return buildExecutorResult({
          executor: "booking-contact",
          decision,
          state_patch: {
            pending_primary_phone_confirmation: false,
            primary_phone_candidate: undefined,
            pending_contact_field: "phone",
          },
        })
      }

      // Ainda não estamos aguardando confirmação: setar flag/candidato para o renderer perguntar.
      return buildExecutorResult({
        executor: "booking-contact",
        decision,
        state_patch: {
          pending_primary_phone_confirmation: true,
          primary_phone_candidate: senderDigits,
          pending_contact_field: undefined,
        },
      })
    }
  }

  // "O meu mesmo" / "pode ser o meu" etc. → contact_preference "phone"; no WhatsApp preencher com número do remetente.
  const inferredContactPref =
    snapshot.signals.contact_preference ||
    (phone ? "phone" : snapshot.signals.contact_email ? "email" : undefined) ||
    context.state.contact_preference
  const useSenderAsPhone =
    inferredContactPref === "phone" &&
    context.channel === "whatsapp" &&
    hasSenderPhone &&
    !context.state.slots?.customer_phone &&
    !decision.slot_updates?.customer_phone

  const slotUpdates: Record<string, unknown> = {
    ...(decision.slot_updates || {}),
    ...(queueState.attendee_name ? { attendee_name: queueState.attendee_name } : {}),
    ...(phone ? { customer_phone: phone } : {}),
    ...(snapshot.signals.contact_email ? { customer_email: snapshot.signals.contact_email } : {}),
    ...(useSenderAsPhone ? { customer_phone: senderDigits } : {}),
  }
  const hasContactValue = Boolean(phone || snapshot.signals.contact_email || useSenderAsPhone)
  const hasSlotUpdates = queueState.attendee_name || decision.slot_updates || hasContactValue

  return buildExecutorResult({
    executor: "booking-contact",
    decision,
    slot_updates: hasSlotUpdates ? slotUpdates : undefined,
    state_patch: {
      ...((inferredContactPref || decision.slot_updates?.customer_phone || decision.slot_updates?.customer_email || hasContactValue)
        ? {
            pending_contact_field: undefined,
            contact_preference: inferredContactPref || context.state.contact_preference,
          }
        : {
            pending_contact_field: "contact_preference",
          }),
      pending_attendee_queue: queueState.remaining_queue,
    },
    action_options: decision.action_options || booking.contact_options,
  })
}
