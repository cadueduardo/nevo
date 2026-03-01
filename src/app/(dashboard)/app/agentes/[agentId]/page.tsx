'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { MessageSquare, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AgentBasicEditor } from '@/features/agents/components/AgentBasicEditor'
import { AgentChannelWhatsApp } from '@/features/agents/components/AgentChannelWhatsApp'
import { AgentFlowBuilder } from '@/features/flow/components/AgentFlowBuilder'
import { SimulatorAppClient } from '@/features/simulator/components/SimulatorAppClient'
import { useAgentContext } from '@/components/providers/AgentProvider'
import type { Service, Schedule } from '@/types/business-model'
import type { BasicConfigPayload } from '@/features/agents/components/AgentBasicEditor'
import type { FlowNodeShape, FlowEdgeShape } from '@/features/flow/types'

/** Forma do retorno de GET /api/app/bootstrap?agent_id=… (evita import do módulo server no client). */
interface AgentDetailBootstrap {
  agent: { id: string; name: string; business_type: string | null; status: string }
  agent_setting: {
    tone: string | null
    handoff_mode: string | null
    when_client_asks_price_no_value: string | null
    business_config: Record<string, unknown>
  }
  tenant_setting: {
    tone: string | null
    handoff_mode: string | null
    business_config: Record<string, unknown>
  }
  flow: {
    id: string
    name: string
    version: number | null
    definition: unknown
    layout: unknown
  } | null
}

const TAB_VALUES = ['basico', 'fluxo', 'simulador', 'canais', 'config'] as const
type TabValue = (typeof TAB_VALUES)[number]

function parseTab(s: string | null): TabValue {
  if (s && TAB_VALUES.includes(s as TabValue)) return s as TabValue
  return 'basico'
}

export default function AgentDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const agentId = params.agentId as string
  const tabParam = searchParams.get('tab')
  const pendingParam = searchParams.get('pending')
  const [tab, setTab] = React.useState<TabValue>(() => parseTab(tabParam))
  const [data, setData] = React.useState<AgentDetailBootstrap | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [publishing, setPublishing] = React.useState(false)
  const [whatsappStatus, setWhatsappStatus] = React.useState<string | null>(null)
  const { setActiveAgentId, notifyAgentConfigUpdated } = useAgentContext()

  // Sincronizar aba com URL
  React.useEffect(() => {
    setTab(parseTab(tabParam))
  }, [tabParam])

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/app/bootstrap?agent_id=${encodeURIComponent(agentId)}`)
      .then((r) => {
        if (!r.ok) return Promise.reject(new Error(r.status === 404 ? 'Agente não encontrado' : r.statusText))
        return r.json()
      })
      .then((d: AgentDetailBootstrap) => {
        if (!cancelled) setData(d)
        return fetch(`/api/app/agents/${agentId}/channel/whatsapp`)
          .then((r) => (r.ok ? r.json() : null))
          .then((channel) => {
            if (!cancelled && channel?.status) setWhatsappStatus(channel.status as string)
          })
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [agentId])

  const handleTabChange = React.useCallback((value: string) => {
    setTab(value as TabValue)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', value)
    window.history.replaceState({}, '', url.pathname + url.search)
  }, [])

  const openWhatsappConfig = React.useCallback(() => {
    handleTabChange('canais')
  }, [handleTabChange])

  const handleSaveBasic = React.useCallback(
    async (payload: {
      name?: string
      business_type?: string
      business_config?: Partial<BasicConfigPayload>
    }) => {
      if (!agentId) return
      const agentUpdates: { name?: string; business_type?: string } = {}
      if (payload.name !== undefined) agentUpdates.name = payload.name
      if (payload.business_type !== undefined) agentUpdates.business_type = payload.business_type
      if (Object.keys(agentUpdates).length > 0) {
        const r = await fetch(`/api/app/agents/${agentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agentUpdates),
        })
        if (!r.ok) {
          const err = await r.json().catch(() => ({}))
          throw new Error((err as { error?: string }).error || r.statusText)
        }
        setData((prev) =>
          prev ? { ...prev, agent: { ...prev.agent, ...agentUpdates } } : null
        )
      }
      if (payload.business_config !== undefined) {
        const body: { agent_id: string; business_config: Partial<BasicConfigPayload>; tone?: string; handoff_mode?: string } = {
          agent_id: agentId,
          business_config: payload.business_config,
        }
        if (payload.business_config.tone_of_voice !== undefined) body.tone = payload.business_config.tone_of_voice
        if (payload.business_config.handoff_mode !== undefined) body.handoff_mode = payload.business_config.handoff_mode
        const r = await fetch('/api/app/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!r.ok) {
          const err = await r.json().catch(() => ({}))
          throw new Error((err as { error?: string }).error || r.statusText)
        }
        setData((prev) =>
          prev && payload.business_config
            ? {
                ...prev,
                agent_setting: {
                  ...prev.agent_setting,
                  business_config: { ...prev.agent_setting.business_config, ...payload.business_config },
                  ...(payload.business_config.tone_of_voice !== undefined && { tone: payload.business_config.tone_of_voice || null }),
                  ...(payload.business_config.handoff_mode !== undefined && { handoff_mode: payload.business_config.handoff_mode || null }),
                },
                tenant_setting: prev.tenant_setting,
              }
            : prev
        )
      }
      notifyAgentConfigUpdated('Básico')
    },
    [agentId, notifyAgentConfigUpdated]
  )

  const handleSaveConfig = React.useCallback(
    async (tone: string, handoffMode: string) => {
      const r = await fetch('/api/app/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          tone: tone || undefined,
          handoff_mode: handoffMode || undefined,
        }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error || r.statusText)
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              agent_setting: {
                ...prev.agent_setting,
                tone: tone || null,
                handoff_mode: handoffMode || null,
                when_client_asks_price_no_value: prev.agent_setting.when_client_asks_price_no_value,
                business_config: prev.agent_setting.business_config,
              },
              tenant_setting: prev.tenant_setting,
            }
          : null
      )
      notifyAgentConfigUpdated('Configurações')
    },
    [agentId, notifyAgentConfigUpdated]
  )

  const handlePublish = React.useCallback(async () => {
    setPublishing(true)
    try {
      const r = await fetch(`/api/app/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      })
      if (!r.ok) throw new Error('Falha ao publicar')
      setData((prev) =>
        prev ? { ...prev, agent: { ...prev.agent, status: 'active' } } : null
      )
    } finally {
      setPublishing(false)
    }
  }, [agentId])

  const openSimulator = React.useCallback(() => {
    setActiveAgentId(agentId)
    window.open('/app/simulator', '_blank')
  }, [agentId, setActiveAgentId])

  if (loading) return <div className="p-6 text-muted-foreground">Carregando…</div>
  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-destructive">Agente não encontrado</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/app/agentes">Voltar aos agentes</Link>
        </Button>
      </div>
    )
  }

  const agent = data.agent
  const setting = data.agent_setting
  const bc = setting.business_config ?? {}
  const validContext = bc.context as string | undefined
  const contextValue =
    validContext === 'booking' || validContext === 'quote' || validContext === 'both'
      ? validContext
      : undefined
  const validLocationMode = bc.location_mode as string | undefined
  const locationModeValue =
    validLocationMode === 'fixed' || validLocationMode === 'mobile' ? validLocationMode : undefined

  const initialConfig: Partial<BasicConfigPayload> = {
    services: (bc.services as Service[] | undefined) ?? [],
    schedule: (bc.schedule as Schedule | undefined) ?? undefined,
    greeting_message: (bc.greeting_message as string | undefined) ?? '',
    fallback_message: (bc.fallback_message as string | undefined) ?? '',
    business_name: (bc.business_name as string | undefined) ?? '',
    context: contextValue,
    location_mode: locationModeValue,
    establishment_address: (bc.establishment_address as BasicConfigPayload['establishment_address']) ?? undefined,
    service_area: (bc.service_area as BasicConfigPayload['service_area']) ?? undefined,
    policies: (bc.policies as BasicConfigPayload['policies']) ?? undefined,
    tone_of_voice: (bc.tone_of_voice as string | undefined) ?? setting.tone ?? '',
    handoff_mode: (bc.handoff_mode as string | undefined) ?? setting.handoff_mode ?? '',
    target_audience: (bc.target_audience as BasicConfigPayload['target_audience']) ?? undefined,
    interaction_style: (bc.interaction_style as BasicConfigPayload['interaction_style']) ?? undefined,
    dynamic_variables: (bc.dynamic_variables as BasicConfigPayload['dynamic_variables']) ?? undefined,
    faq: (bc.faq as BasicConfigPayload['faq']) ?? undefined,
    allow_sequence_booking: (bc.allow_sequence_booking as boolean | undefined) ?? undefined,
    staff: (bc.staff as BasicConfigPayload['staff']) ?? undefined,
    holidays_attend: (bc.holidays_attend as string[] | undefined) ?? undefined,
    closure_periods: (bc.closure_periods as BasicConfigPayload['closure_periods']) ?? undefined,
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/app/agentes" className="hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Agentes
          </Link>
          <span>/</span>
          <span className="text-foreground">{agent.name}</span>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
            <Badge variant={agent.status === 'active' ? 'default' : 'secondary'}>
              {agent.status === 'active' ? 'Ativo' : 'Rascunho'}
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={openSimulator}>
              <MessageSquare className="h-4 w-4" />
              Abrir simulador
            </Button>
            {agent.status === 'draft' && (
              <Button size="sm" onClick={handlePublish} disabled={publishing}>
                {publishing ? 'Publicando…' : 'Publicar'}
              </Button>
            )}
          </div>
        </div>

        {agent.status === 'draft' && (
          whatsappStatus === 'connected' ? (
            <Card className="mt-4 border-emerald-500/40 bg-emerald-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Seu WhatsApp está conectado!</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Não esqueça de confirmar a ativação do seu agente clicando em publicar.
                </p>
                <Button size="sm" onClick={handlePublish} disabled={publishing}>
                  {publishing ? 'Publicando...' : 'Publicar agente agora!'}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="mt-4 border-amber-500/40 bg-amber-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Configuração pendente</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Este agente está em rascunho e aguardando finalização da configuração do WhatsApp.
                  {pendingParam === 'whatsapp' ? ' Finalize a conexão para começar a receber mensagens reais.' : ''}
                </p>
                <Button size="sm" variant="outline" onClick={openWhatsappConfig}>
                  Conectar WhatsApp
                </Button>
              </CardContent>
            </Card>
          )
        )}

        <Tabs value={tab} onValueChange={handleTabChange} className="mt-6">
          <TabsList className="flex flex-wrap gap-1 h-auto p-1 bg-muted/50">
            <TabsTrigger value="basico">Básico</TabsTrigger>
            <TabsTrigger value="fluxo">Fluxo (Avançado)</TabsTrigger>
            <TabsTrigger value="simulador">Simulador</TabsTrigger>
            <TabsTrigger value="canais">Canais</TabsTrigger>
            <TabsTrigger value="config">Configurações</TabsTrigger>
          </TabsList>

          <TabsContent value="basico" className="mt-4">
            <AgentBasicEditor
              name={agent.name}
              businessType={agent.business_type ?? ''}
              initialConfig={initialConfig}
              onSave={handleSaveBasic}
            />
          </TabsContent>

          <TabsContent value="fluxo" className="mt-4">
            <FlowTabContent agentId={agentId} flow={data.flow} onConfigUpdated={() => notifyAgentConfigUpdated('Fluxo')} />
          </TabsContent>

          <TabsContent value="simulador" className="mt-4">
            <div className="rounded-lg border bg-card min-h-[400px] flex flex-col">
              <SimulatorAppClient agentIdOverride={agentId} />
            </div>
          </TabsContent>

          <TabsContent value="canais" className="mt-4">
            <AgentChannelWhatsApp
              agentId={agentId}
              onSave={() => notifyAgentConfigUpdated('Canais WhatsApp')}
              onConnectionStatusChange={setWhatsappStatus}
            />
          </TabsContent>

          <TabsContent value="config" className="mt-4">
            <AgentConfigTab
              tone={setting.tone ?? 'professional'}
              handoffMode={setting.handoff_mode ?? 'conditional'}
              onSave={handleSaveConfig}
            />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  )
}

/** Aba Fluxo (Avançado): aviso 7.5 + AgentFlowBuilder (Fase 7). */
function FlowTabContent({
  agentId,
  flow,
  onConfigUpdated,
}: {
  agentId: string
  flow: AgentDetailBootstrap['flow']
  onConfigUpdated: () => void
}) {
  const def = flow?.definition as { nodes?: FlowNodeShape[]; edges?: FlowEdgeShape[] } | undefined
  const nodes = Array.isArray(def?.nodes) ? def.nodes : []
  const edges = Array.isArray(def?.edges) ? def.edges : []

  return (
    <div className="space-y-4">
      {/* Fase 7.5: Aviso modo avançado */}
      <div
        className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-4 text-sm"
        role="alert"
      >
        <p className="font-medium text-amber-800 dark:text-amber-200">
          Modo avançado
        </p>
        <p className="mt-1 text-muted-foreground">
          Alterações nesta aba afetam o atendimento. Teste no simulador após qualquer mudança.
        </p>
      </div>

      {!flow ? (
        <Card className="border-dashed">
          <CardContent className="py-8">
            <p className="text-sm font-medium">Nenhum fluxo ativo</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Este agente ainda não tem um fluxo ativo. O construtor completo (canvas e inspector) será disponibilizado em breve.
            </p>
          </CardContent>
        </Card>
      ) : (
        <AgentFlowBuilder
          agentId={agentId}
          nodes={nodes}
          edges={edges}
          onConfigUpdated={onConfigUpdated}
        />
      )}
    </div>
  )
}

/** Aba Configurações: tom e handoff (agent_setting). */
function AgentConfigTab({
  tone,
  handoffMode,
  onSave,
}: {
  tone: string
  handoffMode: string
  onSave: (tone: string, handoffMode: string) => Promise<void>
}) {
  const [t, setT] = React.useState(tone)
  const [h, setH] = React.useState(handoffMode)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setT(tone)
    setH(handoffMode)
  }, [tone, handoffMode])

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      await onSave(t, h)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-md">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Tom</label>
            <Select value={t} onValueChange={setT}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="friendly">Amigável</SelectItem>
                <SelectItem value="professional">Profissional</SelectItem>
                <SelectItem value="formal">Formal</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">Handoff</label>
            <Select value={h} onValueChange={setH}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Sempre transferir</SelectItem>
                <SelectItem value="conditional">Condicional</SelectItem>
                <SelectItem value="never">Nunca</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Salvando…' : 'Salvar'}
      </Button>
    </div>
  )
}
