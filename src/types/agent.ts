/**
 * Tipos globais para o modelo "agente" (unidade de atendimento por tenant).
 * Compartilhado entre API, context e componentes.
 */

export type AgentStatus = 'draft' | 'active'
export type AgentChannelPrimary = 'whatsapp' | 'web'
export type WhatsAppConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface AgentWhatsAppSummary {
  status: WhatsAppConnectionStatus
  provider?: 'twilio' | 'custom'
}

export interface Agent {
  id: string
  name: string
  business_type: string | null
  channel_primary: AgentChannelPrimary
  status: AgentStatus
  updated_at: string
  services_count: number
  upcoming_bookings_count: number
  whatsapp?: AgentWhatsAppSummary
}
