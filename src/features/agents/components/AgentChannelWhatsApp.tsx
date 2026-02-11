'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Copy } from 'lucide-react'

export interface WhatsAppChannelState {
  status: string
  provider: string | null
  phone_number: string | null
  webhook_url: string | null
  last_healthcheck_at: string | null
  last_error: string | null
}

export interface AgentChannelWhatsAppProps {
  agentId: string
  onSave: () => void
}

/**
 * Aba Canais → WhatsApp: status, formulário Twilio (credenciais), webhook URL (somente leitura + copiar).
 * Credenciais enviadas apenas no POST/PATCH; nunca exibidas após salvar.
 */
export function AgentChannelWhatsApp({ agentId, onSave }: AgentChannelWhatsAppProps) {
  const [state, setState] = React.useState<WhatsAppChannelState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [accountSid, setAccountSid] = React.useState('')
  const [authToken, setAuthToken] = React.useState('')
  const [messagingServiceSid, setMessagingServiceSid] = React.useState('')
  const [phoneNumber, setPhoneNumber] = React.useState('')

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/app/agents/${agentId}/channel/whatsapp`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((data: WhatsAppChannelState) => {
        if (!cancelled) setState(data)
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
    setSaving(true)
    try {
      const res = await fetch(`/api/app/agents/${agentId}/channel/whatsapp`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'twilio',
          twilio_account_sid: accountSid.trim() || undefined,
          twilio_auth_token: authToken.trim() || undefined,
          messaging_service_sid: messagingServiceSid.trim() || undefined,
          phone_number: phoneNumber.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || res.statusText)
      }
      onSave()
      setState((prev) =>
        prev
          ? {
              ...prev,
              status: 'disconnected',
              provider: 'twilio',
              phone_number: phoneNumber.trim() || null,
            }
          : null
      )
      setAuthToken('')
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">WhatsApp</CardTitle>
          <CardDescription>
            Conecte o canal WhatsApp deste agente via Twilio. Credenciais são armazenadas de forma segura e nunca exibidas após salvar.
          </CardDescription>
          <div className="flex items-center gap-2 pt-2">
            <Badge variant={state?.status === 'connected' ? 'default' : 'secondary'}>
              {statusLabel}
            </Badge>
            {state?.provider && (
              <span className="text-sm text-muted-foreground">
                Provedor: {state.provider === 'twilio' ? 'Twilio' : state.provider}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
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
          {state?.last_error && (
            <p className="text-sm text-destructive">{state.last_error}</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar credenciais'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">URL do webhook</CardTitle>
          <CardDescription>
            Configure esta URL no console da Twilio (Sandbox settings → “When a message comes in”).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {state?.webhook_url ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 min-w-0 break-all rounded bg-muted px-2 py-1 text-xs">
                  {state.webhook_url}
                </code>
                <Button variant="outline" size="sm" onClick={copyWebhook} className="gap-1">
                  <Copy className="h-4 w-4" />
                  Copiar
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                A URL só é gerada quando a aplicação sabe seu endereço público. Defina no servidor (ou em <code className="rounded bg-muted px-1 text-xs">.env.local</code> em desenvolvimento):
              </p>
              <ul className="list-inside list-disc text-sm text-muted-foreground space-y-1">
                <li><code className="rounded bg-muted px-1">NEXT_PUBLIC_APP_URL=https://seu-dominio.com</code> (produção)</li>
                <li>Ou em local: <code className="rounded bg-muted px-1">NEXT_PUBLIC_APP_URL=https://abc123.ngrok.io</code> (use ngrok e cole a URL HTTPS)</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-2">
                Depois, salve de novo as credenciais e a URL aparecerá aqui. Enquanto isso, use este formato (substitua pelo seu domínio ou URL do ngrok):
              </p>
              <code className="block break-all rounded bg-muted px-2 py-2 text-xs">
                https://SEU-DOMINIO-OU-NGROK/api/webhooks/twilio/{agentId}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(`https://SEU-DOMINIO-OU-NGROK/api/webhooks/twilio/${agentId}`)}
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
    </div>
  )
}
