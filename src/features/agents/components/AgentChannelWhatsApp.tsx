'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Copy, MessageCircle, QrCode, Settings, Trash2, Unplug, X } from 'lucide-react'

export interface WhatsAppChannelState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error' | string
  provider: 'evolution' | null
  phone_number: string | null
  webhook_url: string | null
  last_healthcheck_at: string | null
  last_error: string | null
  evolution_base_url: string | null
  evolution_instance: string | null
  evolution_state?: string | null
}

interface ConnectStartResponse {
  pairingCode?: string
  status?: string
  message?: string
  error?: string
}

export interface AgentChannelWhatsAppProps {
  agentId: string
  onSave: () => void
  initialState?: WhatsAppChannelState | null
  onConnectionStatusChange?: (status: string) => void
}

export function AgentChannelWhatsApp({
  agentId,
  onSave,
  initialState = null,
  onConnectionStatusChange,
}: AgentChannelWhatsAppProps) {
  const [state, setState] = React.useState<WhatsAppChannelState | null>(initialState)
  const [loading, setLoading] = React.useState(!initialState)
  const [error, setError] = React.useState<string | null>(null)
  const [savingConfig, setSavingConfig] = React.useState(false)
  const [isModalOpen, setIsModalOpen] = React.useState(false)

  const [showAdvancedConfig, setShowAdvancedConfig] = React.useState(false)
  const [evolutionBaseUrl, setEvolutionBaseUrl] = React.useState('')
  const [evolutionInstance, setEvolutionInstance] = React.useState('')
  const [evolutionApiKey, setEvolutionApiKey] = React.useState('')
  const [phoneInput, setPhoneInput] = React.useState('')

  const [connectLoading, setConnectLoading] = React.useState(false)
  const [connectError, setConnectError] = React.useState<string | null>(null)
  const [pairingCode, setPairingCode] = React.useState<string | null>(null)
  const [connectHint, setConnectHint] = React.useState<string | null>(null)

  const [opLoading, setOpLoading] = React.useState<'disconnect' | 'remove' | null>(null)

  const [showQrFallback, setShowQrFallback] = React.useState(false)
  const [qrCode, setQrCode] = React.useState<string | null>(null)
  const [qrLoading, setQrLoading] = React.useState(false)
  const [qrError, setQrError] = React.useState<string | null>(null)
  const [showTechnicalDetails, setShowTechnicalDetails] = React.useState(false)
  const [footerNotice, setFooterNotice] = React.useState<string | null>(null)
  const prevStatusRef = React.useRef<string | null>(null)
  const pollingTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingAttemptRef = React.useRef(0)

  React.useEffect(() => {
    if (!initialState) return
    setState(initialState)
    setEvolutionBaseUrl(initialState.evolution_base_url ?? '')
    setEvolutionInstance(initialState.evolution_instance ?? '')
    setLoading(false)
  }, [initialState])

  const fetchChannel = React.useCallback(async () => {
    const res = await fetch(`/api/app/agents/${agentId}/channel/whatsapp?include_live=1`)
    const data = (await res.json().catch(() => ({}))) as WhatsAppChannelState & { error?: string }
    if (!res.ok) throw new Error(data.error || res.statusText)
    setState(data)
    setEvolutionBaseUrl(data.evolution_base_url ?? '')
    setEvolutionInstance(data.evolution_instance ?? '')
    return data
  }, [agentId])

  const fetchLiveStatus = React.useCallback(async () => {
    const res = await fetch(`/api/whatsapp/connect/status?agent_id=${encodeURIComponent(agentId)}`)
    const data = (await res.json().catch(() => ({}))) as {
      status?: string
      last_error?: string
      phone_number?: string | null
      evolution_state?: string | null
    }
    if (!res.ok) return
    setState((prev) =>
      prev
        ? {
            ...prev,
            status: (data.status || prev.status) as WhatsAppChannelState['status'],
            last_error: data.last_error ?? prev.last_error,
            phone_number: data.phone_number ?? prev.phone_number,
            evolution_state: data.evolution_state ?? prev.evolution_state,
          }
        : prev
    )
  }, [agentId])

  React.useEffect(() => {
    let cancelled = false
    setError(null)
    ;(async () => {
      try {
        if (initialState?.provider === 'evolution' && initialState?.evolution_base_url && initialState?.evolution_instance) {
          await fetchChannel()
          return
        }
        await fetchChannel()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro ao carregar canal')
      }
    })()
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchChannel, initialState])

  React.useEffect(() => {
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current)
      pollingTimeoutRef.current = null
    }

    if (!isModalOpen || state?.status !== 'connecting') {
      pollingAttemptRef.current = 0
      return
    }

    const delayByAttempt = [4000, 6000, 10000]
    const delay = delayByAttempt[Math.min(pollingAttemptRef.current, delayByAttempt.length - 1)]

    pollingTimeoutRef.current = setTimeout(async () => {
      pollingAttemptRef.current += 1
      try {
        await fetchChannel()
      } catch {
        await fetchLiveStatus()
      }
    }, delay)

    return () => {
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current)
        pollingTimeoutRef.current = null
      }
    }
  }, [isModalOpen, state?.status, fetchChannel, fetchLiveStatus])

  React.useEffect(() => {
    const currentStatus = state?.status ?? null
    const previousStatus = prevStatusRef.current
    const justConnected = previousStatus !== 'connected' && currentStatus === 'connected'
    if (currentStatus !== 'connecting') {
      pollingAttemptRef.current = 0
    }
    if (isModalOpen && justConnected) {
      setIsModalOpen(false)
      setConnectError(null)
      setConnectHint(null)
      setPairingCode(null)
      setShowQrFallback(false)
      setQrCode(null)
      setQrError(null)
      setFooterNotice('WhatsApp conectado com sucesso.')
    }
    prevStatusRef.current = currentStatus
  }, [state?.status, isModalOpen])

  React.useEffect(() => {
    if (!footerNotice) return
    const timer = setTimeout(() => setFooterNotice(null), 4500)
    return () => clearTimeout(timer)
  }, [footerNotice])

  React.useEffect(() => {
    if (!state?.status) return
    onConnectionStatusChange?.(state.status)
  }, [state?.status, onConnectionStatusChange])

  const statusLabel =
    state?.status === 'connected'
      ? 'Conectado'
      : state?.status === 'connecting'
        ? 'Conectando'
        : state?.status === 'error'
          ? 'Erro'
          : 'Desconectado'
  const hasInstance = Boolean(state?.evolution_instance)
  const isDisconnectedWithoutInstance = state?.status === 'disconnected' && !hasInstance

  const saveConfigIfNeeded = async () => {
    const currentBase = state?.evolution_base_url ?? ''
    const currentInstance = state?.evolution_instance ?? ''
    const typedBase = evolutionBaseUrl.trim()
    const typedInstance = evolutionInstance.trim()
    const typedApiKey = evolutionApiKey.trim()
    const mustSave =
      typedApiKey.length > 0 ||
      (typedBase.length > 0 && typedBase !== currentBase) ||
      (typedInstance.length > 0 && typedInstance !== currentInstance)
    if (!mustSave) return

    setSavingConfig(true)
    try {
      const res = await fetch(`/api/app/agents/${agentId}/channel/whatsapp`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'evolution',
          evolution_base_url: typedBase || undefined,
          evolution_instance: typedInstance || undefined,
          evolution_api_key: typedApiKey || undefined,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || res.statusText)
      setEvolutionApiKey('')
      onSave()
      await fetchChannel()
    } finally {
      setSavingConfig(false)
    }
  }

  const handleStartConnect = async () => {
    setConnectError(null)
    setConnectHint(null)
    setPairingCode(null)
    setShowQrFallback(false)
    setQrCode(null)
    setQrError(null)
    if (!phoneInput.trim()) {
      setConnectError('Informe o número com DDI/DDD (ex: 5511999999999).')
      return
    }

    setConnectLoading(true)
    try {
      await saveConfigIfNeeded()
      const res = await fetch('/api/whatsapp/connect/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, phone: phoneInput }),
      })
      const data = (await res.json().catch(() => ({}))) as ConnectStartResponse
      if (!res.ok) throw new Error(data.error || res.statusText)
      setPairingCode(data.pairingCode ?? null)
      setConnectHint(data.message ?? null)
      await fetchChannel()
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Erro ao iniciar conexão')
    } finally {
      setConnectLoading(false)
    }
  }

  const handleRetryCode = async () => {
    setConnectError(null)
    setConnectLoading(true)
    try {
      const res = await fetch('/api/whatsapp/connect/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, phone: phoneInput }),
      })
      const data = (await res.json().catch(() => ({}))) as ConnectStartResponse
      if (!res.ok) throw new Error(data.error || res.statusText)
      setPairingCode(data.pairingCode ?? null)
      await fetchChannel()
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Erro ao regerar código')
    } finally {
      setConnectLoading(false)
    }
  }

  const fetchQrCode = async () => {
    setQrLoading(true)
    setQrError(null)
    try {
      const res = await fetch(`/api/app/agents/${agentId}/channel/whatsapp/evolution-qr`)
      const data = (await res.json().catch(() => ({}))) as { qrcode?: string; error?: string }
      if (!res.ok) throw new Error(data.error || res.statusText)
      if (!data.qrcode) throw new Error('QR Code não retornado')
      setQrCode(data.qrcode)
    } catch (e) {
      setQrError(e instanceof Error ? e.message : 'Erro ao buscar QR Code')
    } finally {
      setQrLoading(false)
    }
  }

  const handleDisconnect = async () => {
    setOpLoading('disconnect')
    setError(null)
    try {
      const res = await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || res.statusText)
      await fetchChannel()
      setPairingCode(null)
      setConnectHint(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao desconectar número')
    } finally {
      setOpLoading(null)
    }
  }

  const handleRemoveInstance = async () => {
    const confirmed = window.confirm(
      'Tem certeza que deseja remover a instância na Evolution? Essa ação desconecta o número e exige nova conexão.'
    )
    if (!confirmed) return
    setOpLoading('remove')
    setError(null)
    try {
      const res = await fetch(`/api/whatsapp/instance?agent_id=${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || res.statusText)
      await fetchChannel()
      setPairingCode(null)
      setConnectHint(null)
      setShowQrFallback(false)
      setQrCode(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao remover instância')
    } finally {
      setOpLoading(null)
    }
  }

  const copyWebhook = () => {
    if (!state?.webhook_url) return
    void navigator.clipboard.writeText(state.webhook_url)
  }

  if (loading) return <p className="text-muted-foreground">Carregando canal WhatsApp...</p>
  if (error && !state) return <p className="text-destructive">{error}</p>

  return (
    <div className="space-y-6">
      {isDisconnectedWithoutInstance ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">WhatsApp</CardTitle>
            <CardDescription>Conecte seu número para o agente começar a atender no WhatsApp.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-background p-2 border">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Seu WhatsApp não está conectado</p>
                  <p className="text-sm text-muted-foreground">
                    Clique em conectar para gerar o código e vincular seu número.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => setIsModalOpen(true)}>Conectar WhatsApp agora</Button>
                <Button variant="outline" onClick={() => void fetchChannel()}>
                  Sincronizar conexão
                </Button>
              </div>
            </div>

            <div className="pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowTechnicalDetails((v) => !v)}
              >
                {showTechnicalDetails ? 'Ocultar detalhes técnicos' : 'Ver detalhes técnicos'}
              </Button>
              {showTechnicalDetails && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{statusLabel}</code>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Provedor</p>
                    <code className="block break-all rounded bg-muted px-2 py-1 text-xs">Evolution API</code>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-muted-foreground">URL base Evolution</p>
                    <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                      {state?.evolution_base_url || '—'}
                    </code>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">WhatsApp (Evolution API)</CardTitle>
            <CardDescription>
              Conexão por código como padrão. Use o modal para configurar e conectar.
            </CardDescription>
            <div className="flex items-center gap-2 pt-2">
              <Badge
                variant={state?.status === 'connected' ? 'default' : 'secondary'}
                className={state?.status === 'connected' ? '!bg-emerald-600 !text-white !border-emerald-600' : undefined}
                style={
                  state?.status === 'connected'
                    ? { backgroundColor: '#16a34a', color: '#ffffff', borderColor: '#16a34a' }
                    : undefined
                }
              >
                {statusLabel}
              </Badge>
              <span className="text-sm text-muted-foreground">Provedor: Evolution API</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Instância</p>
                <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                  {state?.evolution_instance || '—'}
                </code>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Número conectado</p>
                <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                  {state?.phone_number || '—'}
                </code>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">URL base Evolution</p>
                <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                  {state?.evolution_base_url || '—'}
                </code>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {state?.status !== 'connected' && (
                <Button onClick={() => setIsModalOpen(true)}>Conectar WhatsApp</Button>
              )}
              <Button variant="outline" onClick={() => void fetchChannel()}>
                Sincronizar conexão
              </Button>
              <Button variant="outline" className="gap-2" onClick={handleDisconnect} disabled={opLoading !== null}>
                <Unplug className="h-4 w-4" />
                {opLoading === 'disconnect' ? 'Desconectando...' : 'Desconectar número'}
              </Button>
              <Button variant="destructive" className="gap-2" onClick={handleRemoveInstance} disabled={opLoading !== null}>
                <Trash2 className="h-4 w-4" />
                {opLoading === 'remove' ? 'Removendo...' : 'Remover instância'}
              </Button>
            </div>

            {state?.last_error && <p className="text-sm text-destructive">{state.last_error}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook</CardTitle>
          <CardDescription>Endpoint usado pela Evolution para entregar mensagens ao Nevo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {state?.webhook_url ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-0 break-all rounded bg-muted px-2 py-1 text-xs">{state.webhook_url}</code>
              <Button variant="outline" size="sm" className="gap-1" onClick={copyWebhook}>
                <Copy className="h-4 w-4" />
                Copiar
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Defina <code className="rounded bg-muted px-1 text-xs">NEXT_PUBLIC_APP_URL</code> para exibir a URL pública do webhook.
            </p>
          )}
        </CardContent>
      </Card>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="relative w-full max-w-xl rounded-lg border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="mb-1 text-lg font-semibold">Conectar WhatsApp</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Fluxo principal: informe o número e use o código de pareamento no WhatsApp.
            </p>

            <div className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              Evolution API usa conexão não oficial (Baileys). Recomendado para QA/ambientes controlados.
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Configuração técnica (avançado)</p>
                <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setShowAdvancedConfig((v) => !v)}>
                  <Settings className="h-4 w-4" />
                  {showAdvancedConfig ? 'Ocultar' : 'Mostrar'}
                </Button>
              </div>

              {showAdvancedConfig && (
                <div className="grid gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">URL base Evolution</label>
                    <Input
                      value={evolutionBaseUrl}
                      onChange={(e) => setEvolutionBaseUrl(e.target.value)}
                      placeholder="https://evolution.exemplo.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Instância</label>
                    <Input
                      value={evolutionInstance}
                      onChange={(e) => setEvolutionInstance(e.target.value)}
                      placeholder="nevo-instancia"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">API Key (somente para atualizar)</label>
                    <Input
                      type="password"
                      value={evolutionApiKey}
                      onChange={(e) => setEvolutionApiKey(e.target.value)}
                      placeholder="evonevo2025"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" disabled={savingConfig} onClick={() => void saveConfigIfNeeded()}>
                      {savingConfig ? 'Salvando...' : 'Salvar configuração'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Conectar por código</p>
              <Input
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="Número com DDI/DDD (ex: 5511999999999)"
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={handleStartConnect} disabled={connectLoading}>
                  {connectLoading ? 'Gerando código...' : 'Gerar código de pareamento'}
                </Button>
                <Button type="button" variant="outline" onClick={handleRetryCode} disabled={connectLoading || !phoneInput.trim()}>
                  Regerar código
                </Button>
                <Button type="button" variant="outline" onClick={() => void fetchChannel()}>
                  Verificar status
                </Button>
              </div>

              {connectError && <p className="text-sm text-destructive">{connectError}</p>}
              {connectHint && <p className="text-xs text-muted-foreground">{connectHint}</p>}
              {pairingCode && (
                <div className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Código de pareamento</p>
                  <p className="mt-1 font-mono text-2xl font-semibold tracking-wider">{pairingCode}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    No WhatsApp: Configurações → Aparelhos conectados → Vincular dispositivo → Vincular com código.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Fallback por QR Code</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    const next = !showQrFallback
                    setShowQrFallback(next)
                    if (next) void fetchQrCode()
                  }}
                >
                  <QrCode className="h-4 w-4" />
                  {showQrFallback ? 'Ocultar QR' : 'Mostrar QR'}
                </Button>
              </div>
              {showQrFallback && (
                <div className="space-y-2">
                  {qrLoading && <p className="text-sm text-muted-foreground">Carregando QR Code...</p>}
                  {qrError && <p className="text-sm text-destructive">{qrError}</p>}
                  {qrCode && (
                    <img
                      src={qrCode}
                      alt="QR Code para conectar WhatsApp"
                      className="rounded-lg border"
                      width={280}
                      height={280}
                    />
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => void fetchQrCode()}>
                    Atualizar QR
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {footerNotice && (
        <div className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 backdrop-blur">
          {footerNotice}
        </div>
      )}
    </div>
  )
}

