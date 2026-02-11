'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronDown, Users, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAgentContext } from '@/components/providers/AgentProvider'
import { cn } from '@/lib/utils'

/**
 * Header: se 1 agente = apenas botão "Novo agente"; se N agentes = dropdown (nome ativo, lista, Gerenciar, Novo agente).
 * Mobile-first; reutiliza padrão do menu do usuário (Button + lista absoluta).
 */
export function AgentSwitcher() {
  const {
    agents,
    activeAgent,
    activeAgentId,
    setActiveAgentId,
    isLoading,
    error,
  } = useAgentContext()
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Quando o tenant tem apenas 1 agente: não mostrar menu de seleção, apenas o botão "Novo agente".
  if (!isLoading && agents.length === 1) {
    return (
      <Link
        href="/onboarding?newAgent=1"
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
      >
        <Plus className="h-4 w-4 shrink-0" />
        Novo agente
      </Link>
    )
  }

  const label = isLoading
    ? 'Carregando…'
    : error
      ? 'Agentes'
      : agents.length === 0
        ? 'Nenhum agente'
        : (activeAgent?.name ?? 'Agente')

  return (
    <div className="relative flex items-center" ref={ref}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 min-w-0 max-w-[200px] sm:max-w-[240px]"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={isLoading}
      >
        <span className="truncate text-left">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </Button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md sm:left-0 sm:w-64"
          role="menu"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">
              Agente ativo
            </p>
            {activeAgent ? (
              <div className="mt-1 flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {activeAgent.name}
                </span>
                <Badge
                  variant={activeAgent.status === 'active' ? 'default' : 'secondary'}
                  className="shrink-0 text-xs"
                >
                  {activeAgent.status === 'active' ? 'Ativo' : 'Rascunho'}
                </Badge>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {error
                  ? 'Erro ao carregar. Tente novamente.'
                  : agents.length === 0
                    ? 'Crie um agente para começar.'
                    : null}
              </p>
            )}
          </div>
          {agents.length > 0 ? (
            <div className="max-h-48 overflow-y-auto py-1">
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent',
                    a.id === activeAgentId && 'bg-accent'
                  )}
                  onClick={() => {
                    setActiveAgentId(a.id)
                    setOpen(false)
                  }}
                  role="menuitem"
                >
                  <span className="truncate">{a.name}</span>
                  <Badge
                    variant={a.status === 'active' ? 'default' : 'secondary'}
                    className="shrink-0 text-xs"
                  >
                    {a.status === 'active' ? 'Ativo' : 'Rascunho'}
                  </Badge>
                </button>
              ))}
            </div>
          ) : null}
          <div className="border-t border-border py-1">
            <Link
              href="/app/agentes"
              className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
              onClick={() => setOpen(false)}
            >
              <Users className="h-4 w-4 shrink-0" />
              Gerenciar agentes
            </Link>
            <Link
              href="/onboarding?newAgent=1"
              className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
              onClick={() => setOpen(false)}
            >
              <Plus className="h-4 w-4 shrink-0" />
              Novo agente
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
