'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useAgentContext } from '@/components/providers/AgentProvider'
import { SimulatorAppClient } from '@/features/simulator/components/SimulatorAppClient'

/**
 * Conteúdo do dock (usa AgentContext). Só é montado no cliente para evitar SSR sem Provider.
 */
function SimulatorDockContent() {
  const {
    activeAgent,
    lastConfigUpdateAt,
    lastAppliedAt,
    lastConfigUpdateReason,
    markConfigApplied,
  } = useAgentContext()
  const [open, setOpen] = React.useState(false)
  const hasPendingChanges =
    lastConfigUpdateAt != null &&
    lastAppliedAt != null &&
    lastConfigUpdateAt > lastAppliedAt

  const handleRecarregar = React.useCallback(() => {
    markConfigApplied()
  }, [markConfigApplied])

  const content = (
    <>
      <div
        className="fixed bottom-6 right-6 z-[2147483647] flex flex-col items-end gap-2"
        style={{ position: 'fixed', bottom: 24, right: 24 }}
        aria-label="Simulador flutuante"
      >
        <Button
          type="button"
          variant="default"
          size="sm"
          className="relative gap-2 rounded-full shadow-lg min-w-[44px] min-h-[44px]"
          onClick={() => setOpen(true)}
          aria-label="Abrir simulador"
        >
          <MessageSquare className="h-4 w-4" />
          <span className="hidden sm:inline">Simulador</span>
          {hasPendingChanges && (
            <span
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground"
              aria-hidden
            >
              !
            </span>
          )}
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col p-0 sm:max-w-md"
        >
          <SheetHeader className="shrink-0 border-b border-border px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-5 w-5 shrink-0" />
              Simulador
              {activeAgent && (
                <span className="truncate font-normal text-muted-foreground">
                  • {activeAgent.name}
                </span>
              )}
            </SheetTitle>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {hasPendingChanges && (
              <div className="shrink-0 border-b border-border bg-muted/50 px-4 py-3 text-sm">
                <p className="font-medium">Alterações prontas</p>
                {lastConfigUpdateReason && (
                  <p className="mt-0.5 text-muted-foreground">
                    {lastConfigUpdateReason}
                  </p>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={handleRecarregar}
                >
                  Recarregar
                </Button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-hidden">
              <SimulatorAppClient onClose={() => setOpen(false)} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )

  if (typeof document === 'undefined') return null
  return createPortal(content, document.body)
}

/**
 * Dock fixo no canto inferior direito (plano: "Pill flutuante no canto inferior direito da tela").
 * Só monta no cliente e renderiza em portal para document.body para ficar sempre visível.
 */
export function SimulatorDock() {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  if (!mounted) return null
  return <SimulatorDockContent />
}
