// @ts-nocheck
/** Handler: pending_contact_field (nome, preferencia, telefone, email); extracao de email/telefone do texto. */
import type { SimulatorResult } from "../types.ts"
import { buildResult } from "../state.ts"
import { resolveOptionByNumber, parseEmail, parsePhone } from "../utils.ts"
import { extractContactPreferenceFromText } from "../ai.ts"
import type { BookingContext } from "./context.ts"

export async function handleContact(ctx: BookingContext): Promise<SimulatorResult | null> {
  const { text, state, nextState, history } = ctx

  if (state.pending_contact_field) {
    if (state.pending_contact_field === "name") {
      const name = text.trim()
      if (!name) {
        return buildResult("Pra confirmar, qual seu nome?", nextState)
      }
      nextState.slots.customer_name = name
      nextState.pending_contact_field = undefined
    } else if (state.pending_contact_field === "contact_preference") {
      const completedCount = (nextState.completed_bookings?.length ?? state.completed_bookings?.length ?? 0)
      const isAdditionalAttendee = completedCount > 0 || Boolean(nextState.pending_additional_booking)
      const prefOptions = isAdditionalAttendee
        ? ["So celular", "So email", "Celular e email", "Pular (usar contato do titular)"]
        : ["So celular", "So email", "Celular e email"]
      const prefInput = resolveOptionByNumber(text, prefOptions) || text
      const t = prefInput.toLowerCase().trim()
      let pref: "phone" | "email" | "both" | "skip_primary" | null = null
      if (/(so|apenas)\s*celular|celular\s*(apenas|mesmo)|celular\s+\d/.test(t)) pref = "phone"
      else if (/(so|apenas)\s*email|email\s*apenas/.test(t)) pref = "email"
      else if (/(ambos|celular\s*e\s*email|os\s*dois)/.test(t)) pref = "both"
      else if (/pular|titular|responsavel|usar contato/.test(t)) pref = "skip_primary"
      if (!pref) {
        const aiPref = await extractContactPreferenceFromText(prefInput, history)
        if (aiPref === "phone" || aiPref === "email" || aiPref === "both") pref = aiPref
      }

      if (pref === "phone") {
        nextState.contact_preference = "phone"
        nextState.pending_contact_field = undefined
        const phoneFromText = parsePhone(text)
        if (phoneFromText) {
          nextState.slots.customer_phone = phoneFromText
        } else {
          nextState.pending_contact_field = "phone"
          return buildResult("Qual seu celular com DDD?", nextState)
        }
      } else if (pref === "email") {
        nextState.contact_preference = "email"
        nextState.pending_contact_field = undefined
        const emailFromText = parseEmail(text)
        if (emailFromText) {
          nextState.slots.customer_email = emailFromText
        } else {
          nextState.pending_contact_field = "email"
          return buildResult("Qual seu email?", nextState)
        }
      } else if (pref === "both") {
        nextState.contact_preference = "both"
        nextState.pending_contact_field = undefined
        const phoneFromText = parsePhone(text)
        if (phoneFromText) {
          nextState.slots.customer_phone = phoneFromText
          nextState.pending_contact_field = "email"
          return buildResult("Qual seu email?", nextState)
        }
        nextState.pending_contact_field = "phone"
        return buildResult("Qual seu celular com DDD?", nextState)
      } else if (pref === "skip_primary" && isAdditionalAttendee) {
        nextState.contact_preference = "skip_primary"
        nextState.pending_contact_field = undefined
        nextState.slots.customer_phone = undefined
        nextState.slots.customer_email = undefined
      } else {
        return buildResult(
          isAdditionalAttendee
            ? "Como prefere ser contatado? Escolha: So celular, So email, Celular e email ou Pular (usar contato do titular)."
            : "Como prefere ser contatado? Escolha: So celular, So email ou Celular e email.",
          nextState,
          prefOptions
        )
      }
    } else if (state.pending_contact_field === "phone") {
      const phone = parsePhone(text)
      if (!phone) {
        return buildResult("Qual seu celular com DDD?", nextState)
      }
      nextState.slots.customer_phone = phone
      nextState.pending_contact_field = undefined
    } else if (state.pending_contact_field === "email") {
      const email = parseEmail(text)
      if (!email) {
        return buildResult("Qual seu email?", nextState)
      }
      nextState.slots.customer_email = email
      nextState.pending_contact_field = undefined
    }
  }

  if (!nextState.slots.customer_email) {
    const email = parseEmail(text)
    if (email) nextState.slots.customer_email = email
  }
  if (!nextState.slots.customer_phone) {
    const phone = parsePhone(text)
    if (phone) nextState.slots.customer_phone = phone
  }

  return null
}
