// @ts-nocheck
/** Edge Function: direciona requisições para lib (turn-handler, DB, persistência). Lógica de turno em lib/turn-handler.ts. */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { processSimulatorMessage } from "./lib/turn-handler.ts"
import {
  json,
  createSupabaseAdmin,
  rewriteWithTone,
  normalizeIncomingServices,
  getTodayIsoBusinessTz,
  addBookedSlot,
  createSimulatorState,
  buildFreshConversationState,
  getServicesTotalDuration,
  getServiceDurationMinutes,
  parseServiceNames,
  hasAnyConfiguredPrice,
  loadServicesFromSettings,
  loadServicesFromOnboardingSession,
  mergeServicesPreferIncoming,
  getTenantById,
  getOrCreateTenant,
  getOrCreateAgentForSimTenant,
  getOrCreateChannel,
  getOrCreateContact,
  getOrCreateConversation,
  ChannelType,
  isEndTestCommand,
  handleInternalIntent,
  tryHandleExternalQuote,
} from "./lib/index.ts"
import type {
  ConversationTurnRequest,
  ConversationTurnResponse,
  SimulatorConfig,
  SimulatorState,
  SimulatorResult,
} from "./lib/index.ts"

// Lógica de turno (processSimulatorMessage, handleBookingModeMessage) em lib/turn-handler.ts

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Max-Age": "86400",
      },
    })
  }

  try {
    const body = (await req.json()) as ConversationTurnRequest
    if (!body?.message) {
      return json({ error: "message e obrigatorio" }, 400)
    }
    const isWhatsApp = (body as { channel?: string }).channel === "whatsapp"
    if (isWhatsApp && !(body as { from?: string }).from) {
      return json({ error: "para channel whatsapp, from (numero do remetente) e obrigatorio" }, 400)
    }
    if (!isWhatsApp && !body?.session_id) {
      return json({ error: "session_id e obrigatorio para web_simulator" }, 400)
    }

    const { supabaseAdmin, envError } = createSupabaseAdmin()
    if (envError) return json({ error: envError }, 500)

    const ctxLead = body.context?.lead_policy
    const leadPolicy =
      typeof ctxLead === "object" && ctxLead !== null
        ? { reject_unlisted_services: true, use_ai_matching: true, ...ctxLead }
        : { reject_unlisted_services: true, use_ai_matching: true }

    const incomingCatalogServices = normalizeIncomingServices((body.context as any)?.catalog_services)
    const incomingBookingServices = normalizeIncomingServices((body.context as any)?.booking_services)
    const incomingLegacyServices = normalizeIncomingServices(body.context?.services)
    const resolvedBookingServices = incomingBookingServices.length > 0 ? incomingBookingServices : incomingLegacyServices
    const resolvedCatalogServices = incomingCatalogServices.length > 0 ? incomingCatalogServices : resolvedBookingServices

    const config: SimulatorConfig = {
      business_name: body.context?.business_name,
      business_type: body.context?.business_type,
      context_mode: body.context?.context_mode,
      establishment_address: body.context?.establishment_address,
      tone: body.context?.tone,
      catalog_services: resolvedCatalogServices,
      booking_services: resolvedBookingServices,
      // Compat legado: enquanto houver cÃ³digo antigo, services aponta para booking_services.
      services: resolvedBookingServices,
      when_client_asks_price_no_value: body.context?.when_client_asks_price_no_value || "offer_handoff_or_booking",
      schedule: body.context?.schedule,
      staff: body.context?.staff || [],
      dynamic_variables: body.context?.dynamic_variables || [],
      lead_policy: leadPolicy,
      holidays_attend: body.context?.holidays_attend,
      closure_periods: body.context?.closure_periods,
      allow_sequence_booking: body.context?.allow_sequence_booking ?? false,
      sequence_eligible_services: body.context?.sequence_eligible_services ?? [],
      target_audience: body.context?.target_audience,
      interaction_style: body.context?.interaction_style ?? "hybrid",
      branding: body.context?.branding,
    }

    const tenant = (body as { tenant_id?: string }).tenant_id
      ? await getTenantById(supabaseAdmin, (body as { tenant_id: string }).tenant_id)
      : await getOrCreateTenant(supabaseAdmin, body.session_id, config.business_name)
    if (!tenant) {
      return json({ error: "tenant_id invalido ou nao encontrado" }, 400)
    }

    let agentId = (body as { agent_id?: string }).agent_id
    if (!agentId) {
      const { data: firstAgent } = await supabaseAdmin
        .from("agent")
        .select("id")
        .eq("tenant_id", tenant.id)
        .limit(1)
        .maybeSingle()
      agentId = firstAgent?.id ?? undefined
    }
    if (!agentId) {
      agentId = await getOrCreateAgentForSimTenant(supabaseAdmin, tenant.id, config.business_name)
    }
    if (!agentId) {
      return json({ error: "tenant sem agente configurado; agent_id obrigatorio para conversation/channel" }, 400)
    }

    if (!config.services?.length || !hasAnyConfiguredPrice(config.services)) {
      const servicesFromSettings = await loadServicesFromSettings(supabaseAdmin, tenant.id, agentId)
      if (servicesFromSettings.length > 0) {
        config.services = mergeServicesPreferIncoming(config.services || [], servicesFromSettings)
      }
    }
    if (!config.services?.length || !hasAnyConfiguredPrice(config.services)) {
      const servicesFromOnboarding = await loadServicesFromOnboardingSession(supabaseAdmin, body.session_id)
      if (servicesFromOnboarding.length > 0) {
        config.services = mergeServicesPreferIncoming(config.services || [], servicesFromOnboarding)
      }
    }

    const channelType: ChannelType = (body as { channel?: string }).channel === "whatsapp" ? "whatsapp" : "web_simulator"
    const sessionIdForContact =
      channelType === "whatsapp" && (body as { from?: string }).from
        ? (body as { from: string }).from
        : body.session_id
    const channel = await getOrCreateChannel(supabaseAdmin, tenant.id, agentId, channelType)
    const contact = await getOrCreateContact(supabaseAdmin, tenant.id, channel.id, sessionIdForContact, config.business_name)
    const conversation = await getOrCreateConversation(supabaseAdmin, tenant.id, channel.id, contact.id, agentId, body.conversation_id)

        // Comando para encerrar/reiniciar: fecha a conversa atual e abre uma nova para limpar estado + historico.
    if (isEndTestCommand(body.message)) {
      const nowIso = new Date().toISOString()
      const replyText = "Conversa encerrada. Quando quiser, e so mandar uma mensagem para comecar de novo."
      await supabaseAdmin.from("conversation_messages").insert([
        { tenant_id: tenant.id, conversation_id: conversation.id, role: "user", content_text: body.message, metadata: { channel: channelType } },
        { tenant_id: tenant.id, conversation_id: conversation.id, role: "assistant", content_text: replyText, metadata: { channel: channelType } },
      ])
      await supabaseAdmin
        .from("conversation")
        .update({
          status: "closed",
          state_json: buildFreshConversationState(channelType),
          last_message_at: nowIso,
        })
        .eq("id", conversation.id)
        .eq("tenant_id", tenant.id)

      const { data: freshConversation, error: freshConversationError } = await supabaseAdmin
        .from("conversation")
        .insert({
          tenant_id: tenant.id,
          agent_id: agentId,
          channel_id: channel.id,
          contact_id: contact.id,
          status: "open",
          context: {},
          state_json: {},
          last_message_at: nowIso,
        })
        .select()
        .single()
      if (freshConversationError) throw freshConversationError

      return json({
        conversation_id: freshConversation.id,
        messages: [{ role: "assistant", content: replyText, created_at: nowIso, action_options: undefined }],
      })
    }

    // Verificar se Ã© a primeira mensagem da conversa
    const { count: messageCount } = await supabaseAdmin
      .from("conversation_messages")
      .select("*", { count: "exact", head: true })
      .eq("conversation_id", conversation.id)
      .eq("role", "user")
    const isFirstMessage = (messageCount || 0) === 0

    const stateFromConversation = (conversation.state_json?.state as SimulatorState) || createSimulatorState()

    const mergeBookedSlots = (
      base?: Record<string, Record<string, string[]>>,
      extra?: Record<string, Record<string, string[]>>
    ): Record<string, Record<string, string[]>> => {
      const merged: Record<string, Record<string, string[]>> = {}
      const sources = [base || {}, extra || {}]
      for (const src of sources) {
        for (const staffKey of Object.keys(src)) {
          if (!merged[staffKey]) merged[staffKey] = {}
          const byDate = src[staffKey] || {}
          for (const dateIso of Object.keys(byDate)) {
            const existing = new Set(merged[staffKey][dateIso] || [])
            for (const t of byDate[dateIso] || []) existing.add(t)
            merged[staffKey][dateIso] = Array.from(existing).sort()
          }
        }
      }
      return merged
    }

    const toBusinessDateTime = (value: string): { dateIso: string; time: string } => {
      const dt = new Date(value)
      return {
        dateIso: dt.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
        time: dt.toLocaleTimeString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      }
    }

    // Hidrata agenda ocupada real para filtrar horÃ¡rios indisponÃ­veis (alÃ©m dos slots deste turno).
    let persistedBookedSlots: Record<string, Record<string, string[]>> = {}
    try {
      const todayIso = getTodayIsoBusinessTz()
      const { data: appointmentRows, error: appointmentRowsError } = await supabaseAdmin
        .from("appointment")
        .select("staff_name, start_at, status")
        .eq("tenant_id", tenant.id)
        .eq("agent_id", agentId)
        .neq("status", "cancelled")
        .gte("start_at", `${todayIso}T00:00:00.000-03:00`)
        .limit(3000)
      if (appointmentRowsError) {
        console.error("appointment hydration error:", appointmentRowsError)
      } else {
        for (const row of (appointmentRows || []) as Array<{ staff_name?: string | null; start_at?: string | null }>) {
          if (!row?.staff_name || !row?.start_at) continue
          const { dateIso, time } = toBusinessDateTime(row.start_at)
          persistedBookedSlots = addBookedSlot(persistedBookedSlots, row.staff_name, dateIso, time)
        }
      }
    } catch (hydrationErr) {
      console.error("appointment hydration exception:", hydrationErr)
      // Continua com slots vazios para nÃ£o bloquear o simulador
    }

    const currentState: SimulatorState = {
      ...stateFromConversation,
      booked_slots: mergeBookedSlots(persistedBookedSlots, stateFromConversation.booked_slots),
    }
    const stateWithFirstFlag = { ...currentState, _isFirstMessage: isFirstMessage }

    const { data: recentMessages } = await supabaseAdmin
      .from("conversation_messages")
      .select("role, content_text")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(12)
    const history = (recentMessages || []).map((m) => ({
      role: m.role || "user",
      content: (m.content_text || "").trim(),
    }))

    // WhatsApp: janela de 24h sem interaÃ§Ã£o encerra (sÃ³ templates depois). Avisar se inatividade prÃ³xima do limite.
    const SESSION_WARN_HOURS = 18
    const SESSION_WINDOW_HOURS = 24
    let sessionExpiryWarning: string | null = null
    if (channelType === "whatsapp") {
      const { data: lastUserRows } = await supabaseAdmin
        .from("conversation_messages")
        .select("created_at")
        .eq("conversation_id", conversation.id)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1)
      const lastUserMsg = Array.isArray(lastUserRows) ? lastUserRows[0] : null
      const lastAt = lastUserMsg?.created_at
      if (lastAt) {
        const lastMs = new Date(lastAt).getTime()
        const nowMs = Date.now()
        const hoursSince = (nowMs - lastMs) / (60 * 60 * 1000)
        if (hoursSince >= SESSION_WARN_HOURS && hoursSince < SESSION_WINDOW_HOURS) {
          const hoursLeft = Math.max(0.5, Math.floor((SESSION_WINDOW_HOURS - hoursSince) * 10) / 10)
          const nome = (currentState as SimulatorState).slots?.customer_name
            || (currentState as SimulatorState).slots?.attendee_name
            || contact?.display_name
            || ""
          const nomePart = nome ? `Oi ${nome}, ` : "Oi, "
          sessionExpiryWarning =
            `${nomePart}ainda estÃ¡ aÃ­? Esta conversa vai encerrar em cerca de ${hoursLeft} hora(s) se nÃ£o houver mais interaÃ§Ã£o.`
        }
      }
    }

    const senderDisplayName = (body as { sender_display_name?: string }).sender_display_name?.trim() || undefined
    let result: SimulatorResult

    // Intents internas (modo internal, owner/admin): consulta/cancelamento de agenda.
    const incomingMode = (body as { mode?: string }).mode
    const incomingActorType = (body as { actor_type?: string }).actor_type
    const isInternalActor =
      incomingMode === "internal" &&
      (incomingActorType === "owner" || incomingActorType === "admin")

    if (isInternalActor) {
      // FASE 6: Rate limit configurÃ¡vel via ENV (default 20/min)
      const RATE_LIMIT_WINDOW_SEC = 60
      const RATE_LIMIT_MAX = Math.max(1, parseInt(Deno.env.get("INTERNAL_RATE_LIMIT_PER_MINUTE") || "20", 10) || 20)
      const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString()
      const { count: recentCount, error: countErr } = await supabaseAdmin
        .from("internal_action_log")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .gte("created_at", windowStart)
      if (!countErr && (recentCount ?? 0) >= RATE_LIMIT_MAX) {
        result = {
          message: "VocÃª enviou muitos comandos. Tenta em 30 segundos.",
          state: stateWithFirstFlag,
          action_options: undefined,
        }
      } else {
        await supabaseAdmin.from("internal_action_log").insert({
          tenant_id: tenant.id,
          action: "internal_command",
          payload: { message: body.message },
        })
        const internalResult = await handleInternalIntent({
          supabaseAdmin,
          tenantId: tenant.id,
          agentId,
          message: body.message,
          config: {
            business_name: config.business_name,
            branding: config.branding,
            schedule: config.schedule,
            services: config.services,
          },
          state: stateWithFirstFlag,
          conversationId: conversation.id,
          channelId: channel.id,
        })
        if (internalResult.handled) {
          result = {
            message: internalResult.message,
            state: internalResult.state ?? stateWithFirstFlag,
            action_options: internalResult.action_options,
          }
        } else {
          // NÃ£o classificou como intent interna; segue fluxo normal.
          try {
            result = await processSimulatorMessage(body.message, config, stateWithFirstFlag, history, senderDisplayName, {
              supabaseAdmin,
              tenantId: tenant.id,
              agentId,
              contactId: contact.id,
              contact,
              senderDisplayName,
              history,
              config,
            })
          } catch (err) {
            console.error("processSimulatorMessage error:", err)
            result = {
              message: "Desculpe, tive um problema ao processar. Pode repetir?",
              state: stateWithFirstFlag,
              action_options: undefined,
            }
          }
        }
      }
    } else {
      // FASE 5: OrÃ§amento externo (cliente pergunta preÃ§o com medidas â†’ faixa + CTA)
      const externalQuoteResult = await tryHandleExternalQuote({
        supabaseAdmin,
        tenantId: tenant.id,
        agentId,
        conversationId: conversation.id,
        message: body.message,
      })
      if (externalQuoteResult.handled) {
        result = {
          message: externalQuoteResult.message || "",
          state: stateWithFirstFlag,
          action_options: externalQuoteResult.action_options,
        }
      } else {
        try {
          result = await processSimulatorMessage(body.message, config, stateWithFirstFlag, history, senderDisplayName, {
            supabaseAdmin,
            tenantId: tenant.id,
            agentId,
            isExternalActor: true,
            contactId: contact.id,
            contact,
            senderDisplayName,
            history,
            config,
          })
        } catch (err) {
          console.error("processSimulatorMessage error:", err)
          result = {
            message: "Desculpe, tive um problema ao processar. Pode repetir?",
            state: stateWithFirstFlag,
            action_options: undefined,
          }
        }
      }
    }

    // Estilo conversacional: nao prefixar opcoes com "1 -", "2 -", etc.
    if (config.interaction_style === "conversational" && Array.isArray(result.action_options)) {
      const denumberedOptions = result.action_options.map((opt) => String(opt || "").replace(/^\d+\s*-\s*/, "").trim())
      result = {
        ...result,
        action_options: denumberedOptions,
        state: {
          ...result.state,
          last_action_options: denumberedOptions,
        },
      }
    }

    const rewritten = await rewriteWithTone(result.message, config.tone)
    const finalMessage = sessionExpiryWarning
      ? `${sessionExpiryWarning}\n\n${rewritten.message}`
      : rewritten.message

    const nowIso = new Date().toISOString()

    await supabaseAdmin.from("conversation_messages").insert([
      {
        tenant_id: tenant.id,
        conversation_id: conversation.id,
        role: "user",
        content_text: body.message,
        metadata: { channel: channelType },
      },
      {
        tenant_id: tenant.id,
        conversation_id: conversation.id,
        role: "assistant",
        content_text: finalMessage,
        metadata: {
          channel: channelType,
          tone: config.tone,
          base_message: result.message,
          used_ai: rewritten.used_ai,
          action_options: result.action_options || null,
        },
      },
    ])

    // Remover flag temporÃ¡ria do estado antes de salvar
    const { _isFirstMessage, ...stateToSave } = result.state as SimulatorState & { _isFirstMessage?: boolean }
    
    const contextUpdate: Record<string, unknown> = {
      ...(conversation.context || {}),
      session_id: sessionIdForContact,
      business_name: config.business_name,
      business_type: config.business_type,
      context_mode: config.context_mode,
      tone: config.tone,
    }
    if (incomingMode === "internal" || incomingMode === "external") {
      contextUpdate.mode = incomingMode
    }
    if (incomingActorType != null && typeof incomingActorType === "string") {
      contextUpdate.actor_type = incomingActorType
    }

    await supabaseAdmin
      .from("conversation")
      .update({
        state_json: { state: stateToSave, channel: channelType },
        context: contextUpdate,
        last_message_at: nowIso,
      })
      .eq("id", conversation.id)
      .eq("tenant_id", tenant.id)

    const tenantIdForAppointment = (body as { tenant_id?: string }).tenant_id
    if (tenantIdForAppointment) {
      const prevLen = (currentState.completed_bookings?.length ?? 0)
      const completed = (stateToSave as SimulatorState).completed_bookings ?? []
      const newBookings = completed.slice(prevLen)
      for (const b of newBookings) {
        const staffName = (b as { staff_name?: string }).staff_name ?? null
        const date = (b as { date?: string }).date
        const time = (b as { time?: string }).time
        const service = (b as { service?: string }).service
        if (!date || !time || !staffName) continue
        // HorÃ¡rio Ã© em hora local do negÃ³cio (Brasil). Usar -03:00 para que 15:30 local = 18:30 UTC
        // (evita bug onde 15:30 era armazenado como UTC e exibia 12:30 no calendÃ¡rio)
        const startAt = `${date}T${time}:00.000-03:00`
        const duration = getServicesTotalDuration(config, service) ?? getServiceDurationMinutes(config, service) ?? 30
        const endAt = new Date(Date.parse(startAt) + duration * 60 * 1000).toISOString()
        const serviceNames = parseServiceNames(service)
        const { error: insErr } = await supabaseAdmin.from("appointment").insert({
          tenant_id: tenantIdForAppointment,
          agent_id: agentId,
          contact_id: contact.id,
          attendee_name: (b as { attendee_name?: string }).attendee_name ?? null,
          staff_name: staffName,
          service_names: serviceNames.length > 0 ? serviceNames : service ? [service] : [],
          start_at: startAt,
          end_at: endAt,
          status: "confirmed",
        })
        if (insErr && insErr.code !== "23505") console.error("appointment insert error:", insErr)
      }
    }

    const response: ConversationTurnResponse = {
      conversation_id: conversation.id,
      messages: [
        {
          role: "assistant",
          content: finalMessage,
          created_at: nowIso,
          action_options: result.action_options,
          service_multi_select: (() => {
            const byState = (result.state as SimulatorState).service_selection_multi ?? false
            if (byState) return true
            const hasMultipleOptions = Array.isArray(result.action_options) && result.action_options.length >= 2
            const msg = String(result.message || "").toLowerCase()
            const hintsMultiSelect =
              /mais de um|mais de uma|sequ[eê]ncia|pode escolher|pode selecionar/.test(msg)
            return hasMultipleOptions && hintsMultiSelect
          })(),
        },
      ],
    }

    return json(response)
  } catch (error: any) {
    console.error("Error na Edge Function:", error)
    return json({ error: error?.message || error?.toString() || "Erro desconhecido" }, 500)
  }
})
