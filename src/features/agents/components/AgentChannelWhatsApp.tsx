'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Copy, QrCode, X } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export interface WhatsAppChannelState {
  status: string
  provider: string | null
  phone_number: string | null
  webhook_url: string | null
  last_healthcheck_at: string | null
  last_error: string | null
  evolution_base_url: string | null
  evolution_instance: string | null
}

export interface AgentChannelWhatsAppProps {
  agentId: string
  onSave: () => void
}

/**
 * Aba Canais → WhatsApp: status, provedor (Twilio ou Evolution API), formulário por provedor.
 * Credenciais enviadas apenas no PATCH; nunca exibidas após salvar.
 */
export function AgentChannelWhatsApp({ agentId, onSave }: AgentChannelWhatsAppProps) {
  const [state, setState] = React.useState<WhatsAppChannelState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const [provider, setProvider] = React.useState<'twilio' | 'evolution'>('twilio')
  const [accountSid, setAccountSid] = React.useState('')
  const [authToken, setAuthToken] = React.useState('')
  const [messagingServiceSid, setMessagingServiceSid] = React.useState('')
  const [phoneNumber, setPhoneNumber] = React.useState('')

  const [evolutionBaseUrl, setEvolutionBaseUrl] = React.useState('')
  const [evolutionInstance, setEvolutionInstance] = React.useState('')
  const [evolutionApiKey, setEvolutionApiKey] = React.useState('')
  const [showAdvancedEvolution, setShowAdvancedEvolution] = React.useState(false)

  const [showQrModal, setShowQrModal] = React.useState(false)
  const [qrCode, setQrCode] = React.useState<string | null>(null)
  const [qrLoading, setQrLoading] = React.useState(false)
  const [qrError, setQrError] = React.useState<string | null>(null)
  const [qrDebug, setQrDebug] = React.useState<Record<string, unknown> | null>(null)
  const [savedSuccess, setSavedSuccess] = React.useState(false)

  // Intervalo de refresh do QR (30s) — o QR do WhatsApp expira rapidamente
  const QR_REFRESH_INTERVAL_MS = 30_000

  const fetchChannel = React.useCallback(() => {
    return fetch(`/api/app/agents/${agentId}/channel/whatsapp`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: WhatsAppChannelState) => {
        setState(data)
        if (data.provider === 'evolution') {
          setProvider('evolution')
          setEvolutionBaseUrl(data.evolution_base_url ?? '')
          setEvolutionInstance(data.evolution_instance ?? '')
        } else {
          setProvider('twilio')
        }
        return data
      })
  }, [agentId])

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/app/agents/${agentId}/channel/whatsapp`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: WhatsAppChannelState) => {
        if (!cancelled) {
          setState(data)
          if (data.provider === 'evolution') {
            setProvider('evolution')
            setEvolutionBaseUrl(data.evolution_base_url ?? '')
            setEvolutionInstance(data.evolution_instance ?? '')
          } else {
            setProvider('twilio')
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro ao carregar')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [agentId])

  const handleSave = async () => {
    setError(null)
    setSavedSuccess(false)
    setSaving(true)
    try {
      if (provider === 'evolution') {
        const url = evolutionBaseUrl.trim()
        const instance = evolutionInstance.trim()
        if (!url || !instance) {
          throw new Error('Preencha a URL base e o nome da instância.')
        }
        const hasStoredEvolution = state?.provider === 'evolution' && state?.evolution_base_url
        const apiKeyProvided = evolutionApiKey.trim().length > 0
        if (!apiKeyProvided && !hasStoredEvolution) {
          throw new Error('Informe a API Key. Ela é obrigatória na primeira configuração.')
        }
      }

      // API Key só é enviada quando o usuário preencheu (não limpamos antes do envio)
      const evolutionApiKeyToSend = provider === 'evolution' ? evolutionApiKey.trim() : ''
      const body: Record<string, unknown> =
        provider === 'evolution'
          ? {
              provider: 'evolution',
              evolution_base_url: evolutionBaseUrl.trim() || undefined,
              evolution_instance: evolutionInstance.trim() || undefined,
              evolution_api_key: evolutionApiKeyToSend || undefined,
            }
          : {
              provider: 'twilio',
              twilio_account_sid: accountSid.trim() || undefined,
              twilio_auth_token: authToken.trim() || undefined,
              messaging_service_sid: messagingServiceSid.trim() || undefined,
              phone_number: phoneNumber.trim() || undefined,
            }

      const res = await fetch(`/api/app/agents/${agentId}/channel/whatsapp`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || res.statusText)
      }
      onSave()
      setAuthToken('')
      // Limpa a API Key da memória após salvar (segurança). A chave já foi persistida no backend.
      setEvolutionApiKey('')
      setSavedSuccess(evolutionApiKeyToSend ? 'with_key' : true)
      setTimeout(() => setSavedSuccess(false), 5000)
      await fetchChannel()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const copyWebhook = () => {
    const url = state?.webhook_url
    if (!url) return
    void navigator.clipboard.writeText(url)
  }

  const fetchQrCode = React.useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/app/agents/${agentId}/channel/whatsapp/evolution-qr`)
      const data = (await res.json().catch(() => ({}))) as {
        qrcode?: string
        error?: string
        _debug?: Record<string, unknown>
      }
      if (!res.ok) {
        if (data._debug) setQrDebug(data._debug)
        throw new Error(data.error || res.statusText)
      }
      if (data.qrcode) {
        setQrCode(data.qrcode)
        setQrError(null)
        setQrDebug(null)
        return true
      }
      if (data._debug) setQrDebug(data._debug)
      throw new Error(data.error || 'QR Code não retornado')
    } catch (e) {
      setQrError(e instanceof Error ? e.message : 'Erro ao buscar QR Code')
      return false
    }
  }, [agentId])

  const handleConnectWhatsApp = async () => {
    setQrError(null)
    setQrDebug(null)
    setQrCode(null)
    setShowQrModal(true)
    setQrLoading(true)
    try {
      await fetchQrCode()
    } finally {
      setQrLoading(false)
    }
  }

  // Auto-refresh do QR a cada 30s enquanto o modal está aberto (o QR do WhatsApp expira rápido)
  React.useEffect(() => {
    if (!showQrModal || qrError || !qrCode) return
    const interval = setInterval(() => {
      void fetchQrCode()
    }, QR_REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [showQrModal, qrError, qrCode, fetchQrCode, QR_REFRESH_INTERVAL_MS])

  const canShowConnectButton =
    provider === 'evolution' &&
    state?.evolution_base_url &&
    state?.evolution_instance
  const isManagedEvolutionSetup =
    provider === 'evolution' &&
    state?.provider === 'evolution' &&
    Boolean(state?.evolution_base_url && state?.evolution_instance)
  const showEvolutionTechnicalFields = !isManagedEvolutionSetup || showAdvancedEvolution
  const showSaveButton = provider === 'twilio' || showEvolutionTechnicalFields

  const webhookDescription =
    provider === 'evolution'
      ? 'Configure esta URL na Evolution API (webhook para evento MESSAGES_UPSERT).'
      : 'Configure esta URL no console da Twilio (Sandbox settings → "When a message comes in").'

  const webhookPlaceholder =
    provider === 'evolution'
      ? `https://SEU-DOMINIO/api/webhooks/evolution/${agentId}`
      : `https://SEU-DOMINIO/api/webhooks/twilio/${agentId}`

  if (loading) return <p className="text-muted-foreground">Carregando canal WhatsApp…</p>
  if (error && !state) return <p className="text-destructive">{error}</p>

  const statusLabel =
    state?.status === 'connected'
      ? 'Conectado'
      : state?.status === 'connecting'
        ? 'Conectando'
        : state?.status === 'error'
          ? 'Erro'
          : 'Desconectado'

  const providerLabel = (p: string | null) =>
    p === 'evolution' ? 'Evolution API' : p === 'twilio' ? 'Twilio' : p ?? '—'

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">WhatsApp</CardTitle>
          <CardDescription>
            Conecte o canal WhatsApp deste agente. Escolha o provedor e preencha as credenciais.
            Dados sensíveis são armazenados de forma segura e nunca exibidos após salvar.
          </CardDescription>
          <div className="flex items-center gap-2 pt-2">
            <Badge variant={state?.status === 'connected' ? 'default' : 'secondary'}>
              {statusLabel}
            </Badge>
            {state?.provider && (
              <span className="text-sm text-muted-foreground">
                Provedor: {providerLabel(state.provider)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <span className="text-sm font-medium">Provedor</span>
            <Tabs value={provider} onValueChange={(v) => setProvider(v as 'twilio' | 'evolution')}>
              <TabsList>
                <TabsTrigger value="twilio">Twilio (API oficial)</TabsTrigger>
                <TabsTrigger value="evolution">Evolution API (não oficial)</TabsTrigger>
              </TabsList>
              <TabsContent value="twilio" className="mt-4" />
              <TabsContent value="evolution" className="mt-4" />
            </Tabs>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          {savedSuccess && (
            <div
              role="status"
              className="rounded-md border border-green-500/50 bg-green-500/10 px-3 py-2 text-sm text-green-800 dark:text-green-200"
            >
              {savedSuccess === 'with_key'
                ? 'Credenciais salvas (API Key incluída). Você já pode usar "Conectar WhatsApp".'
                : 'Credenciais salvas com sucesso.'}
            </div>
          )}

          {provider === 'twilio' && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Account SID (Twilio)</label>
                <Input
                  type="text"
                  value={accountSid}
                  onChange={(e) => setAccountSid(e.target.value)}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Auth Token (Twilio)</label>
                <Input
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="••••••••••••••••••••••••••••••••"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  O token não é exibido após salvar. Informe novamente apenas para atualizar.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Messaging Service SID (opcional)</label>
                <Input
                  type="text"
                  value={messagingServiceSid}
                  onChange={(e) => setMessagingServiceSid(e.target.value)}
                  placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Número de telefone (opcional)</label>
                <Input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+5511999999999"
                />
              </div>
            </>
          )}

          {provider === 'evolution' && (
            <>
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                A Evolution API usa conexão não oficial (Baileys). O uso pode violar os termos do
                WhatsApp. Ideal para testes e ambientes controlados.
              </div>
              {isManagedEvolutionSetup && (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
                  Configuração técnica pronta automaticamente. Para o cliente final, basta clicar em
                  {' '}
                  <strong>Conectar WhatsApp</strong>
                  {' '}
                  e escanear o QR Code.
                  <div className="mt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAdvancedEvolution((v) => !v)}
                    >
                      {showAdvancedEvolution ? 'Ocultar configuração avançada' : 'Mostrar configuração avançada'}
                    </Button>
                  </div>
                </div>
              )}
              {showEvolutionTechnicalFields && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">URL base da Evolution API</label>
                    <Input
                      type="url"
                      value={evolutionBaseUrl}
                      onChange={(e) => setEvolutionBaseUrl(e.target.value)}
                      placeholder="https://evolution.exemplo.com"
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      URL do servidor Evolution (sem barra no final).
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Nome da instância</label>
                    <Input
                      type="text"
                      value={evolutionInstance}
                      onChange={(e) => setEvolutionInstance(e.target.value)}
                      placeholder="minha-instancia"
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Nome da instância conectada ao WhatsApp na Evolution.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">API Key (obrigatória na primeira vez)</label>
                    <Input
                      type="password"
                      autoComplete="off"
                      value={evolutionApiKey}
                      onChange={(e) => setEvolutionApiKey(e.target.value)}
                      placeholder="evonevo2025"
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Obrigatória ao salvar pela primeira vez. Após salvar, o campo é limpo por segurança; use
                      &quot;Conectar WhatsApp&quot; com a chave já salva. Para trocar a chave, informe a nova e salve.
                    </p>
                  </div>
                </>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">URL base da Evolution API</label>
                <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                  {state?.evolution_base_url || evolutionBaseUrl || '—'}
                </code>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Instância</label>
                <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                  {state?.evolution_instance || evolutionInstance || '—'}
                </code>
              </div>
              {canShowConnectButton && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleConnectWhatsApp}
                  className="gap-2"
                >
                  <QrCode className="h-4 w-4" />
                  Conectar WhatsApp
                </Button>
              )}
            </>
          )}

          {state?.last_error && (
            <p className="text-sm text-destructive">{state.last_error}</p>
          )}
          {showSaveButton && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar credenciais'}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">URL do webhook</CardTitle>
          <CardDescription>{webhookDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {state?.webhook_url ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-0 break-all rounded bg-muted px-2 py-1 text-xs">
                {state.webhook_url}
              </code>
              <Button variant="outline" size="sm" onClick={copyWebhook} className="gap-1">
                <Copy className="h-4 w-4" />
                Copiar
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                A URL só é gerada quando a aplicação sabe seu endereço público. Defina{' '}
                <code className="rounded bg-muted px-1 text-xs">NEXT_PUBLIC_APP_URL</code> no
                servidor (ou em <code className="rounded bg-muted px-1 text-xs">.env.local</code>{' '}
                em desenvolvimento).
              </p>
              <p className="text-sm text-muted-foreground">
                Em local use ngrok e defina:{' '}
                <code className="rounded bg-muted px-1 text-xs">
                  NEXT_PUBLIC_APP_URL=https://abc123.ngrok.io
                </code>
              </p>
              <code className="block break-all rounded bg-muted px-2 py-2 text-xs">
                {webhookPlaceholder}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(webhookPlaceholder)}
                className="gap-1 mt-2"
              >
                <Copy className="h-4 w-4" />
                Copiar modelo
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">
            Validar conexão e Enviar teste: em breve.
          </p>
        </CardContent>
      </Card>

      {showQrModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-modal-title"
          onClick={() => setShowQrModal(false)}
        >
          <div
            className="relative w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
            <h2 id="qr-modal-title" className="mb-2 text-lg font-semibold">
              Conectar WhatsApp
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Escaneie o QR Code com o WhatsApp do celular: Aparelhos conectados → Conectar um
              aparelho. O QR é atualizado automaticamente a cada 30 segundos.
            </p>
            {qrLoading && (
              <div className="flex min-h-[280px] items-center justify-center">
                <p className="text-sm text-muted-foreground">Carregando QR Code…</p>
              </div>
            )}
            {qrError && (
              <div className="space-y-2">
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {qrError}
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full"
                    onClick={() => handleConnectWhatsApp()}
                  >
                    Tentar novamente
                  </Button>
                  {state?.evolution_base_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() =>
                        window.open(
                          `${state.evolution_base_url!.replace(/\/$/, '')}/manager`,
                          '_blank',
                          'noopener'
                        )
                      }
                    >
                      Abrir Evolution Manager (RESTART ou excluir/recriar instância)
                    </Button>
                  )}
                </div>
                {qrDebug && Object.keys(qrDebug).length > 0 ? (
                  <details className="rounded border bg-muted/50 px-3 py-2 text-xs" open>
                    <summary className="cursor-pointer font-medium text-muted-foreground">
                      Detalhes técnicos (expandir para diagnóstico)
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all text-muted-foreground">
                      {JSON.stringify(qrDebug, null, 2)}
                    </pre>
                  </details>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Verifique: Evolution rodando (docker ps), URL base (ex: http://localhost:8080),
                    instância existente e API Key correta (evonevo2025).
                  </p>
                )}
              </div>
            )}
            {!qrLoading && qrCode && (
              <div className="flex justify-center">
                <img
                  src={qrCode}
                  alt="QR Code para conectar WhatsApp"
                  className="rounded-lg border"
                  width={280}
                  height={280}
                />
              </div>
            )}
            {!qrLoading && qrCode && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 w-full"
                onClick={() => {
                  handleConnectWhatsApp()
                }}
              >
                Atualizar QR Code
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
