'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, MessageSquare, Calendar, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useAgentContext } from '@/components/providers/AgentProvider'
import type { Agent } from '@/types/agent'

export default function AgentesPage() {
  const router = useRouter()
  const { agents, isLoading, error, refetch, setActiveAgentId } = useAgentContext()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [search, setSearch] = React.useState('')

  const filtered = React.useMemo(() => {
    if (!search.trim()) return agents
    const q = search.trim().toLowerCase()
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.business_type ?? '').toLowerCase().includes(q)
    )
  }, [agents, search])

  const handleCreateBlank = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/app/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Novo agente' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || res.statusText)
      setCreateOpen(false)
      await refetch()
      if (data.id) {
        setActiveAgentId(data.id)
        router.push(`/app/agentes/${data.id}?tab=fluxo`)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setCreating(false)
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-[calc(100vh-3.5rem)] bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
          <p className="text-muted-foreground">Carregando agentes…</p>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-[calc(100vh-3.5rem)] bg-background">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" className="mt-2" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Agentes</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie os agentes de atendimento do seu tenant.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" />
            Criar agente
          </Button>
        </div>

        <div className="mt-4">
          <label htmlFor="search-agents" className="sr-only">
            Buscar por nome ou tipo
          </label>
          <input
            id="search-agents"
            type="search"
            placeholder="Buscar por nome ou tipo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm md:max-w-xs"
          />
        </div>

        {filtered.length === 0 ? (
          <Card className="mt-6 border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users className="h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-sm font-medium">
                {agents.length === 0 ? 'Nenhum agente' : 'Nenhum resultado na busca'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {agents.length === 0
                  ? 'Crie seu primeiro agente para começar.'
                  : 'Tente outro termo.'}
              </p>
              {agents.length === 0 && (
                <Button className="mt-4 gap-2" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Criar agente
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </ul>
        )}
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="bottom" className="rounded-t-xl">
          <SheetHeader>
            <SheetTitle>Criar agente</SheetTitle>
          </SheetHeader>
          <div className="mt-6 flex flex-col gap-3">
            <Button asChild variant="default" className="w-full justify-start gap-2">
              <Link href="/onboarding?newAgent=1">Criar com onboarding (recomendado)</Link>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={handleCreateBlank}
              disabled={creating}
            >
              {creating ? 'Criando…' : 'Criar em branco (avançado)'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md">
      <Link href={`/app/agentes/${agent.id}`}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight truncate">{agent.name}</h3>
            <Badge variant={agent.status === 'active' ? 'default' : 'secondary'} className="shrink-0">
              {agent.status === 'active' ? 'Ativo' : 'Rascunho'}
            </Badge>
          </div>
          {agent.business_type ? (
            <p className="text-sm text-muted-foreground">{agent.business_type}</p>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-4 w-4" />
            {agent.services_count} serviço(s)
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            {agent.upcoming_bookings_count} agendamento(s)
          </span>
        </CardContent>
      </Link>
    </Card>
  )
}
