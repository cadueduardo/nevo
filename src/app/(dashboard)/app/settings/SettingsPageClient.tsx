'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAgentContext } from '@/components/providers/AgentProvider'

interface BootstrapData {
  tenant: { id: string; name: string; slug: string }
  tenant_setting: {
    tone: string | null
    handoff_mode: string | null
    when_client_asks_price_no_value: string | null
    business_config: Record<string, unknown>
  }
  flow: unknown
}

export function SettingsPageClient() {
  const { activeAgentId } = useAgentContext()
  const [data, setData] = useState<BootstrapData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tone, setTone] = useState<string>('')
  const [handoffMode, setHandoffMode] = useState<string>('')
  const [businessConfigJson, setBusinessConfigJson] = useState<string>('')

  useEffect(() => {
    if (activeAgentId == null) {
      setLoading(false)
      setData(null)
      return
    }
    let cancelled = false
    fetch(`/api/app/bootstrap?agent_id=${encodeURIComponent(activeAgentId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((bootstrap: BootstrapData) => {
        if (!cancelled) {
          setData(bootstrap)
          setTone(bootstrap.tenant_setting.tone ?? 'professional')
          setHandoffMode(bootstrap.tenant_setting.handoff_mode ?? 'conditional')
          setBusinessConfigJson(JSON.stringify(bootstrap.tenant_setting.business_config, null, 2))
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Erro ao carregar')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeAgentId])

  const handleSave = async () => {
    if (!data) return
    let bc: Record<string, unknown>
    try {
      bc = JSON.parse(businessConfigJson) as Record<string, unknown>
    } catch {
      setError('JSON de business_config inválido.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/app/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tone: tone || undefined,
          handoff_mode: handoffMode || undefined,
          business_config: bc,
          agent_id: activeAgentId ?? undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || res.statusText)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  if (activeAgentId == null) {
    return (
      <p className="text-muted-foreground">
        Selecione um agente no menu acima para editar as configurações.
      </p>
    )
  }
  if (loading) return <p className="text-muted-foreground">Carregando…</p>
  if (error && !data) return <p className="text-destructive">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tom e handoff</CardTitle>
          <CardDescription>
            Tom de voz do assistente e quando transferir para humano.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Tom</label>
            <Select value={tone} onValueChange={setTone}>
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
            <Select value={handoffMode} onValueChange={setHandoffMode}>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Negócio (business_config)</CardTitle>
          <CardDescription>
            Serviços, agenda, colaboradores, etc. Edite em JSON. Alterações impactam o simulador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="sr-only text-sm font-medium">business_config JSON</label>
          <textarea
            className="min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            value={businessConfigJson}
            onChange={(e) => setBusinessConfigJson(e.target.value)}
            spellCheck={false}
          />
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </CardFooter>
      </Card>

      <p>
        <Link href="/app" className="text-primary underline hover:no-underline">
          Voltar ao início
        </Link>
      </p>
    </div>
  )
}
