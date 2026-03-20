'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Calendar,
  MessageSquare,
  Settings,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAgentContext } from '@/components/providers/AgentProvider'
import { cn } from '@/lib/utils'

const AgentSwitcher = dynamic(
  () => import('@/features/agents/components/AgentSwitcher').then((mod) => mod.AgentSwitcher),
  {
    ssr: false,
    loading: () => <div className="h-9 w-[160px] rounded-md border bg-background" />,
  }
)

const AuthenticatedHeaderUserMenu = dynamic(
  () =>
    import('@/components/shared/AuthenticatedHeaderUserMenu').then(
      (mod) => mod.AuthenticatedHeaderUserMenu
    ),
  {
    ssr: false,
    loading: () => <div className="h-9 w-9 rounded-full border bg-background" />,
  }
)

/** Ordem: Dashboard primeiro; Agentes = detalhe do agente ativo (Básico/Fluxo/Canais etc.). */
function buildNavItems(activeAgentId: string | null) {
  const agentesHref = activeAgentId ? `/app/agentes/${activeAgentId}` : '/app/agentes'
  return [
    { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
    { href: agentesHref, label: 'Agentes', icon: Users, key: 'agentes' },
    { href: '/app/agenda', label: 'Agenda', icon: Calendar },
    { href: '/app/simulator', label: 'Simulador', icon: MessageSquare },
    { href: '/app/settings', label: 'Configurações', icon: Settings },
  ]
}

function getPageTitle(pathname: string): string {
  if (pathname === '/app') return 'Dashboard'
  if (pathname.startsWith('/app/agentes')) return 'Agentes'
  if (pathname.startsWith('/app/agenda')) return 'Agenda'
  if (pathname.startsWith('/app/simulator')) return 'Simulador'
  if (pathname.startsWith('/app/settings')) return 'Configurações'
  return 'Área do cliente'
}

export function AppShell({
  userEmail,
  children,
}: {
  userEmail: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const { activeAgentId } = useAgentContext()

  const navItems = buildNavItems(activeAgentId ?? null)

  const title = getPageTitle(pathname)

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar fixa */}
      <aside className="hidden md:flex w-56 flex-col border-r bg-card/50 shrink-0">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Link href="/app" className="font-semibold tracking-tight text-primary">
            Nevo
          </Link>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {navItems.map((item) => {
            const href = item.href
            const isActive =
              href === '/app' ? pathname === '/app' : pathname.startsWith(href)
            const key = 'key' in item ? item.key : href
            return (
              <Link key={key} href={href}>
                <span
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </span>
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto border-t p-2">
          <Link
            href="/app/settings"
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
              pathname.startsWith('/app/settings')
                ? 'bg-muted text-foreground'
                : ''
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            Configurações da conta
          </Link>
        </div>
      </aside>

      {/* Conteúdo principal: header + área de conteúdo */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:gap-4 md:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="text-lg font-semibold truncate">{title}</h1>
          </div>
          {/* Mobile: links rápidos (sidebar fica oculta em md-) */}
          <nav className="flex md:hidden items-center gap-1">
            <Button asChild variant="ghost" size="icon" title="Agenda">
              <Link href="/app/agenda">
                <Calendar className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="icon" title="Simulador">
              <Link href="/app/simulator">
                <MessageSquare className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="icon" title="Configurações">
              <Link href="/app/settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
          </nav>
          <div className="flex items-center gap-2 md:gap-3">
            <AgentSwitcher />
            <AuthenticatedHeaderUserMenu userEmail={userEmail} />
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
