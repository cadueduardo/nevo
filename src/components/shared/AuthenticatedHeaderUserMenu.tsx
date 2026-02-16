'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

type AuthenticatedHeaderUserMenuProps = {
  userEmail: string
  settingsHref?: string
  loginHrefAfterSignOut?: string
  showWelcomeText?: boolean
  showClientAreaButton?: boolean
  clientAreaHref?: string
  clientAreaLabel?: string
  className?: string
}

/**
 * Controles reutilizáveis de sessão autenticada para headers.
 * Mostra estado logado, acesso rápido e menu de conta.
 */
export function AuthenticatedHeaderUserMenu({
  userEmail,
  settingsHref = '/app/settings',
  loginHrefAfterSignOut = '/login',
  showWelcomeText = true,
  showClientAreaButton = false,
  clientAreaHref = '/app',
  clientAreaLabel = 'Área do cliente',
  className,
}: AuthenticatedHeaderUserMenuProps) {
  const router = useRouter()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  const handleSignOut = async () => {
    setUserMenuOpen(false)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(loginHrefAfterSignOut)
    router.refresh()
  }

  return (
    <div className={cn('flex items-center gap-2 md:gap-3', className)}>
      {showClientAreaButton && (
        <Button variant="ghost" size="sm" asChild>
          <Link href={clientAreaHref}>{clientAreaLabel}</Link>
        </Button>
      )}
      {showWelcomeText && (
        <span className="hidden text-sm text-muted-foreground sm:inline">Bem-vindo, {userEmail}</span>
      )}
      <div className="relative" ref={menuRef}>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => setUserMenuOpen((open) => !open)}
          aria-expanded={userMenuOpen}
          aria-haspopup="true"
        >
          <span className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
            {userEmail.slice(0, 1).toUpperCase()}
          </span>
          <ChevronDown className="h-4 w-4" />
        </Button>
        {userMenuOpen && (
          <div
            className="absolute right-0 top-full mt-1 w-48 rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
            role="menu"
          >
            <Link
              href={settingsHref}
              className="block px-3 py-2 text-sm hover:bg-accent"
              onClick={() => setUserMenuOpen(false)}
            >
              Configurações
            </Link>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left"
              onClick={handleSignOut}
              role="menuitem"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
