// @ts-nocheck
/** Handler: multi-booking após completo, prompts (!service/!date/!time), validação date+time, addBookedSlot, buildFinalBookingMessage, fallback. */
import type { SimulatorResult } from "../types.ts"
import { buildResult, resetSlotsForNextBooking, addBookedSlot } from "../state.ts"
import { formatEstablishmentAddress } from "../calendar.ts"
import {
  buildServicePrompt,
  buildServiceOptions,
  buildMultiBookingSummary,
  buildAdditionalBookingAfterCompletePrompt,
  buildSingleAdditionalPrompt,
} from "../builders.ts"
import { getScheduleForStaff, getOtherStaffOptions } from "../staff.ts"
import { buildStaffDayOptions } from "../staff.ts"
import {
  resolveOptionByNumber,
  formatDatePt,
  formatTimePeriod,
  getTodayIsoBusinessTz,
  getMockAvailability,
  isTimeTooSoonForDate,
  isBusinessClosedForToday,
  MIN_BOOKING_LEAD_MINUTES,
} from "../utils.ts"
import { getServicesTotalDuration } from "../services.ts"
import type { BookingContext } from "./context.ts"

export async function handleFinalization(ctx: BookingContext): Promise<SimulatorResult | null> {
  const {
    config,
    text,
    state,
    nextState,
    toNumberedOptions,
    getOtherDayOptions,
    bookingComplete,
    interpretedHasAdditional,
    interpretedCount,
    wasAdditionalPending,
    explicitService,
  } = ctx

  // Captura apenas novos pedidos adicionais detectados neste turno.
  // Quando ja estamos no fluxo de adicionais (wasAdditionalPending), a logica principal
  // de decremento/fechamento acontece no bloco mais abaixo.
  if (bookingComplete && interpretedHasAdditional && !wasAdditionalPending) {
    let extraCount = interpretedCount && interpretedCount > 0 ? interpretedCount : 1
    nextState.last_booking = {
      attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
      service: nextState.slots.service,
      date: nextState.slots.date,
      time: nextState.slots.time,
      staff_name: nextState.slots.staff_name,
    }
    if (interpretedHasAdditional && !wasAdditionalPending) {
      nextState.pending_default_service = explicitService || undefined
      nextState.pending_default_service_locked = Boolean(explicitService)
    } else if (nextState.pending_default_service_locked && nextState.slots.service) {
      nextState.pending_default_service = nextState.slots.service
    }
    const firstDuration = getServicesTotalDuration(config, nextState.slots.service)
    const firstSchedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const intervalMins = firstSchedule?.interval_minutes ?? 30
    nextState.booked_slots = addBookedSlot(
      nextState.booked_slots,
      nextState.slots.staff_name,
      nextState.slots.date,
      nextState.slots.time,
      firstDuration ?? undefined,
      intervalMins
    )
    nextState.completed_bookings?.push({
      attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
      service: nextState.slots.service,
      date: nextState.slots.date,
      time: nextState.slots.time,
      staff_name: nextState.slots.staff_name,
      customer_phone: nextState.slots.customer_phone,
      customer_email: nextState.slots.customer_email,
    })
    nextState.pending_additional_count = extraCount
    nextState.pending_additional_booking = extraCount > 0
    if (nextState.expected_additional_count === undefined && extraCount > 0) {
      nextState.expected_additional_count = extraCount
    }
    nextState.slots = resetSlotsForNextBooking(nextState)
    // Para multiatendimento, cada pessoa deve informar o proprio contato.
    nextState.slots.customer_phone = undefined
    nextState.slots.customer_email = undefined
    nextState.contact_preference = undefined
    nextState.pending_attendee_name = true
    return buildResult(
      extraCount > 0 ? buildAdditionalBookingAfterCompletePrompt() : buildSingleAdditionalPrompt(),
      nextState
    )
  }

  if (!nextState.slots.service) {
    const prompt = buildServicePrompt(config, text, {
      date: nextState.slots.date,
      time: nextState.slots.time,
      time_period: nextState.slots.time_period,
      attendee_name: nextState.slots.attendee_name,
    })
    const canSequence = config.allow_sequence_booking
    const sequenceList =
      (config.sequence_eligible_services?.length ?? 0) > 0
        ? config.sequence_eligible_services!
        : (config.services || []).map((s) => s.name).filter(Boolean)
    if (canSequence && sequenceList.length > 0) {
      nextState.service_selection_multi = true
      const sequenceOpts = [...sequenceList, "Quero agendar uma visita"]
      nextState.last_service_options = sequenceOpts
      return buildResult(prompt.message, nextState, toNumberedOptions(sequenceOpts))
    }
    nextState.service_selection_multi = false
    nextState.last_service_options = buildServiceOptions(config.services || [])
    return buildResult(prompt.message, nextState, toNumberedOptions(prompt.action_options))
  }

  if (!nextState.slots.date) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const days = schedule?.days_of_week || []
    const dayOpts = buildStaffDayOptions(days)
    const prefix = nextState.slots.time
      ? `Anotei ${nextState.slots.service} no horario ${nextState.slots.time}. `
      : nextState.slots.time_period
        ? `Anotei ${nextState.slots.service} no periodo ${formatTimePeriod(nextState.slots.time_period)}. `
        : `Certo, ${nextState.slots.service}. `
    return buildResult(
      `${prefix}Qual dia voce prefere? (ex: Hoje, Amanha ou dia da semana)`,
      nextState,
      toNumberedOptions(dayOpts)
    )
  }

  if (!nextState.slots.time) {
    const timeFromNumber =
      Array.isArray(state.last_time_options) && state.last_time_options.length > 0
        ? resolveOptionByNumber(text, state.last_time_options)
        : null
    if (timeFromNumber) {
      const scheduleForLead = getScheduleForStaff(config, nextState.slots.staff_name)
      const minLead = scheduleForLead?.min_booking_lead_minutes ?? MIN_BOOKING_LEAD_MINUTES
      if (nextState.slots.date && isTimeTooSoonForDate(nextState.slots.date, timeFromNumber, minLead)) {
        const schedule = scheduleForLead
        const serviceDuration = getServicesTotalDuration(
          config,
          nextState.slots.service || nextState.pending_default_service
        )
        const availability = getMockAvailability(
          nextState.slots.date,
          schedule,
          nextState.booked_slots,
          nextState.slots.staff_name,
          serviceDuration
        )
        nextState.last_time_options = availability.available.slice(0, 24)
        nextState.last_time_options_date = nextState.slots.date
        nextState.last_time_options_staff = nextState.slots.staff_name
        return buildResult(
          `Este horário não pode ser agendado agora. Trabalhamos com antecedência mínima de ${minLead} minutos. Qual horário você prefere?`,
          nextState,
          toNumberedOptions(availability.available.slice(0, 24))
        )
      }
      nextState.slots.time = timeFromNumber
    }
  }

  if (!nextState.slots.time) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const serviceDuration = getServicesTotalDuration(
      config,
      nextState.slots.service || nextState.pending_default_service
    )
    const availability = getMockAvailability(
      nextState.slots.date,
      schedule,
      nextState.booked_slots,
      nextState.slots.staff_name,
      serviceDuration
    )
    const options = availability.available.slice(0, 24)
    if (availability.available.length === 0) {
      const otherStaff = getOtherStaffOptions(config, nextState.slots.staff_name)
      const closedToday =
        nextState.slots.date === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
      const msg = closedToday
        ? "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce."
        : otherStaff.length > 0
          ? `Esse dia esta cheio com ${nextState.slots.staff_name || "este colaborador"}. Posso sugerir horarios com outro colaborador ou prefere outro dia?`
          : `Esse dia esta cheio. Quer tentar outro dia?`
      const optionList = closedToday
        ? [...getOtherDayOptions(schedule), ...otherStaff]
        : otherStaff.length > 0
          ? [...otherStaff, "Outro dia"]
          : ["Outro dia"]
      return buildResult(msg, nextState, toNumberedOptions(optionList))
    }
    nextState.last_time_options = options
    nextState.last_time_options_date = nextState.slots.date
    nextState.last_time_options_staff = nextState.slots.staff_name
    if (nextState.slots.time_period) {
      return buildResult(
        `Perfeito, ${formatTimePeriod(nextState.slots.time_period)}. Qual horario voce prefere?`,
        nextState,
        toNumberedOptions(options)
      )
    }
    return buildResult("Qual horario voce prefere?", nextState, toNumberedOptions(options))
  }

  const dateIso = nextState.slots.date
  const time = nextState.slots.time
  if (dateIso && time) {
    const schedule = getScheduleForStaff(config, nextState.slots.staff_name)
    const serviceDuration = getServicesTotalDuration(
      config,
      nextState.slots.service || nextState.pending_default_service
    )
    const availability = getMockAvailability(
      dateIso,
      schedule,
      nextState.booked_slots,
      nextState.slots.staff_name,
      serviceDuration
    )
    const minLead = schedule?.min_booking_lead_minutes ?? MIN_BOOKING_LEAD_MINUTES
    if (isTimeTooSoonForDate(dateIso, time, minLead)) {
      nextState.slots.time = undefined
      nextState.last_time_options = availability.available.slice(0, 24)
      nextState.last_time_options_date = dateIso
      nextState.last_time_options_staff = nextState.slots.staff_name
      return buildResult(
        `Esse horario nao esta disponivel para agora. A antecedencia minima e de ${minLead} minutos. Vou te mostrar os proximos horarios livres.`,
        nextState,
        toNumberedOptions(availability.available.slice(0, 24))
      )
    }
    const isTimeFromLastOptions =
      Array.isArray(state.last_time_options) &&
      state.last_time_options.includes(time) &&
      state.last_time_options_date === dateIso &&
      state.last_time_options_staff === nextState.slots.staff_name
    if (availability.available.includes(time) || isTimeFromLastOptions) {
      if (!nextState.slots.customer_name) {
        nextState.pending_contact_field = "name"
        return buildResult("Pra confirmar, qual seu nome?", nextState)
      }
      const pref = nextState.contact_preference ?? state.contact_preference
      if (!pref) {
        nextState.pending_contact_field = "contact_preference"
        return buildResult(
          "Como prefere ser contatado para confirmar o agendamento?",
          nextState,
          ["Só celular", "Só email", "Celular e email"]
        )
      }
      const needsPhone = pref === "phone" || pref === "both"
      const needsEmail = pref === "email" || pref === "both"
      if (needsPhone && !nextState.slots.customer_phone) {
        nextState.pending_contact_field = "phone"
        return buildResult("Qual seu celular com DDD?", nextState)
      }
      if (needsEmail && !nextState.slots.customer_email) {
        nextState.pending_contact_field = "email"
        return buildResult("Qual seu email?", nextState)
      }
      if (
        nextState.pending_additional_booking ||
        (nextState.pending_additional_count || 0) > 0 ||
        (nextState.expected_additional_count || 0) > 0
      ) {
        const completedCountBeforePush = nextState.completed_bookings?.length || 0
        const completedService = nextState.slots.service
        const completedDate = nextState.slots.date
        const completedTime = nextState.slots.time
        nextState.last_booking = {
          attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
          service: completedService,
          date: completedDate,
          time: completedTime,
          staff_name: nextState.slots.staff_name,
        }
        if (nextState.pending_default_service_locked && completedService) {
          nextState.pending_default_service = completedService
        }
        const completedDuration = getServicesTotalDuration(config, completedService)
        const completedSchedule = getScheduleForStaff(config, nextState.slots.staff_name)
        const completedInterval = completedSchedule?.interval_minutes ?? 30
        nextState.booked_slots = addBookedSlot(
          nextState.booked_slots,
          nextState.slots.staff_name,
          completedDate,
          completedTime,
          completedDuration ?? undefined,
          completedInterval
        )
        nextState.completed_bookings?.push({
          attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
          service: completedService,
          date: completedDate,
          time: completedTime,
          staff_name: nextState.slots.staff_name,
          customer_phone: nextState.slots.customer_phone,
          customer_email: nextState.slots.customer_email,
        })
        nextState.pending_additional_booking = false
        // pending_additional_count representa quantas pessoas adicionais faltam apos o primeiro.
        // Portanto, nao decrementa no primeiro agendamento (quando ainda nao havia bookings concluidos).
        if (completedCountBeforePush > 0 && (nextState.pending_additional_count || 0) > 0) {
          nextState.pending_additional_count = Math.max(0, (nextState.pending_additional_count || 0) - 1)
        }
        const expectedTotal =
          (nextState.expected_additional_count || 0) > 0 ? (nextState.expected_additional_count || 0) + 1 : 0
        const completedCount = nextState.completed_bookings?.length || 0
        const pendingAdditionalCount = nextState.pending_additional_count
        const shouldAskMoreByPending =
          typeof pendingAdditionalCount === "number"
            ? pendingAdditionalCount > 0
            : false
        const shouldAskMoreByExpectedFallback =
          pendingAdditionalCount === undefined &&
          expectedTotal > 0 &&
          completedCount < expectedTotal
        if (shouldAskMoreByPending || shouldAskMoreByExpectedFallback) {
          nextState.slots = resetSlotsForNextBooking(nextState)
          // Para multiatendimento, cada pessoa deve informar o proprio contato.
          nextState.slots.customer_phone = undefined
          nextState.slots.customer_email = undefined
          nextState.contact_preference = undefined
          nextState.pending_attendee_name = true
          return buildResult(
            `Perfeito! Agendei ${completedService} para ${formatDatePt(
              completedDate || dateIso
            )} as ${completedTime || time}. Vamos agendar o proximo? De quem sera o proximo agendamento?`,
            nextState
          )
        }
        nextState.pending_final_confirmation = true
        const summary = buildMultiBookingSummary(nextState.completed_bookings || [])
        const address = formatEstablishmentAddress(config)
        const addressLine = address ? `\n\nEndereco: ${address}` : ""
        return buildResult(
          `${summary}${addressLine}\n\nDeseja confirmar esses agendamentos?`,
          nextState,
          ["Confirmar agendamento"]
        )
      }
      const slotDuration = getServicesTotalDuration(config, nextState.slots.service)
      const slotSchedule = getScheduleForStaff(config, nextState.slots.staff_name)
      const slotInterval = slotSchedule?.interval_minutes ?? 30
      nextState.booked_slots = addBookedSlot(
        nextState.booked_slots,
        nextState.slots.staff_name,
        dateIso,
        time,
        slotDuration ?? undefined,
        slotInterval
      )
      if (!nextState.completed_bookings) nextState.completed_bookings = []
      nextState.completed_bookings.push({
        attendee_name: nextState.slots.attendee_name || nextState.slots.customer_name,
        service: nextState.slots.service,
        date: dateIso,
        time,
        staff_name: nextState.slots.staff_name,
        customer_phone: nextState.slots.customer_phone,
        customer_email: nextState.slots.customer_email,
      })
      const address = formatEstablishmentAddress(config)
      const serviceLabel = nextState.slots.service || "atendimento"
      const whereLine = address ? `\nEndereco: ${address}` : ""
      nextState.pending_calendar_offer = true
      nextState.slots = resetSlotsForNextBooking(nextState)
      return buildResult(
        `Perfeito! Seu agendamento de ${serviceLabel} ficou confirmado para ${formatDatePt(dateIso)} as ${time}.${whereLine}\n\nGostaria de adicionar este compromisso no seu calendario?`,
        nextState,
        ["Adicionar no calendario", "Nao, obrigado"]
      )
    }

    const next = availability.available.find((slot) => slot > time) || availability.available[0]
    if (next) {
      nextState.pending_suggested_time = next
      nextState.slots.time = undefined
      return buildResult(`Esse horario esta ocupado. Posso te oferecer ${next} no mesmo dia?`, nextState)
    }
    const closedToday =
      dateIso === getTodayIsoBusinessTz() && isBusinessClosedForToday(schedule)
    return buildResult(
      closedToday
        ? "Encerramos nossas atividades por hoje. Quer agendar para outro dia? Escolha abaixo o melhor dia para voce."
        : "Esse dia esta cheio. Quer tentar outro dia?",
      nextState,
      closedToday ? getOtherDayOptions(schedule) : undefined
    )
  }

  return buildResult("Certo! Me diz o melhor dia e horario para voce.", nextState)
}
