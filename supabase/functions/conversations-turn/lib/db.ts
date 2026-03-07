// @ts-nocheck
/** Acesso a tenant, channel, contact, conversation para a Edge Function. */
import { createSimulatorState } from "./state.ts"

export type ChannelType = "web_simulator" | "whatsapp"

export async function getTenantById(supabaseAdmin: any, tenantId: string) {
  const { data, error } = await supabaseAdmin.from("tenant").select("id, name, slug").eq("id", tenantId).single()
  if (error || !data) return null
  return data
}

export async function getOrCreateTenant(supabaseAdmin: any, sessionId: string, businessName?: string) {
  const slug = `sim-${sessionId}`
  const { data: existing } = await supabaseAdmin.from("tenant").select("*").eq("slug", slug).maybeSingle()
  if (existing) return existing
  const { data, error } = await supabaseAdmin
    .from("tenant")
    .insert({ name: businessName || `Simulador ${sessionId}`, slug })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getOrCreateAgentForSimTenant(supabaseAdmin: any, tenantId: string, tenantName?: string) {
  const { data: existing } = await supabaseAdmin
    .from("agent")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id
  const { data: newAgent, error } = await supabaseAdmin
    .from("agent")
    .insert({
      tenant_id: tenantId,
      name: tenantName || "Agente Simulador",
      status: "active",
      channel_primary: "web",
    })
    .select("id")
    .single()
  if (error) throw error
  await supabaseAdmin.from("agent_setting").insert({
    agent_id: newAgent.id,
    tone: "professional",
    language: "pt-BR",
    handoff_mode: "conditional",
    business_config: {},
    when_client_asks_price_no_value: "offer_handoff_or_booking",
  })
  return newAgent.id
}

export async function getOrCreateChannel(
  supabaseAdmin: any,
  tenantId: string,
  agentId: string,
  channelType: ChannelType = "web_simulator"
) {
  const dbType = channelType === "whatsapp" ? "whatsapp" : "web_chat"
  const simSlug = `sim-${tenantId}-${agentId}`
  let existing: any = null
  if (dbType === "web_chat") {
    const { data } = await supabaseAdmin
      .from("channel")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("agent_id", agentId)
      .eq("type", "web_chat")
      .eq("chat_slug", simSlug)
      .maybeSingle()
    existing = data
  } else {
    const { data } = await supabaseAdmin
      .from("channel")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("agent_id", agentId)
      .eq("type", "whatsapp")
      .maybeSingle()
    existing = data
  }
  if (existing) return existing
  const insertPayload =
    channelType === "whatsapp"
      ? { tenant_id: tenantId, agent_id: agentId, type: "whatsapp", provider: "evolution", provider_config: {}, is_active: true }
      : { tenant_id: tenantId, agent_id: agentId, type: "web_chat", chat_slug: simSlug, is_active: true }
  const { data, error } = await supabaseAdmin.from("channel").insert(insertPayload).select().single()
  if (error) throw error
  return data
}

export async function getOrCreateContact(
  supabaseAdmin: any,
  tenantId: string,
  channelId: string,
  sessionId: string,
  businessName?: string
) {
  const { data: existing } = await supabaseAdmin
    .from("contact")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("channel_id", channelId)
    .eq("external_id", sessionId)
    .maybeSingle()
  if (existing) return existing
  const { data, error } = await supabaseAdmin
    .from("contact")
    .insert({
      tenant_id: tenantId,
      channel_id: channelId,
      external_id: sessionId,
      phone: sessionId,
      display_name: businessName || "Cliente",
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getOrCreateConversation(
  supabaseAdmin: any,
  tenantId: string,
  channelId: string,
  contactId: string,
  agentId: string,
  conversationId?: string
) {
  if (conversationId) {
    const { data: existing } = await supabaseAdmin
      .from("conversation")
      .select("*")
      .eq("id", conversationId)
      .eq("tenant_id", tenantId)
      .maybeSingle()
    if (existing) return existing
  }
  const { data: existingRows } = await supabaseAdmin
    .from("conversation")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("channel_id", channelId)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("last_message_at", { ascending: false })
    .limit(1)
  const existingByContact = Array.isArray(existingRows) ? existingRows[0] : null
  if (existingByContact) return existingByContact
  const { data, error } = await supabaseAdmin
    .from("conversation")
    .insert({
      tenant_id: tenantId,
      agent_id: agentId,
      channel_id: channelId,
      contact_id: contactId,
      status: "open",
      context: {},
      state_json: {},
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export function buildFreshConversationState(channelType: ChannelType) {
  return { state: createSimulatorState(), channel: channelType }
}
