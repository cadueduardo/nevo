'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

type SheetContextValue = {
  open: boolean
  onOpenChange: (open: boolean) => void
}
const SheetContext = React.createContext<SheetContextValue | null>(null)

function useSheet() {
  const ctx = React.useContext(SheetContext)
  if (!ctx) throw new Error('Sheet components must be used within Sheet')
  return ctx
}

export interface SheetProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
  defaultOpen?: boolean
}

/**
 * Sheet: painel deslizante reutilizável (mobile-first). Usa apenas tokens do tema.
 * Renderiza em portal; fecha com Escape ou clique no overlay.
 * Suporta modo controlado (open + onOpenChange) ou não controlado (defaultOpen).
 */
function Sheet({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
}: SheetProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = controlledOpen !== undefined && controlledOnOpenChange !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const onOpenChange = isControlled
    ? controlledOnOpenChange!
    : (v: boolean) => setUncontrolledOpen(v)
  const onEscape = React.useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    },
    [onOpenChange]
  )
  React.useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', onEscape)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEscape)
      document.body.style.overflow = ''
    }
  }, [open, onEscape])

  const ctxValue = React.useMemo(
    () => ({ open, onOpenChange }),
    [open, onOpenChange]
  )

  React.useEffect(() => {
    if (!open) return
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onEscape)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEscape)
      document.body.style.overflow = ''
    }
  }, [open, onOpenChange])

  return <SheetContext.Provider value={ctxValue}>{children}</SheetContext.Provider>
}

export interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: 'bottom' | 'right'
}

/**
 * Conteúdo do Sheet. Por padrão desliza de baixo (mobile-first).
 * Renderiza em portal quando open.
 */
const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ className, side = 'bottom', children, ...props }, ref) => {
    const { open, onOpenChange } = useSheet()
    if (!open || typeof document === 'undefined') return null
    return createPortal(
      <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
        <div
          className="fixed inset-0 bg-black/50"
          onClick={() => onOpenChange(false)}
          aria-hidden
        />
        <div
          ref={ref}
          className={cn(
            'fixed z-50 flex flex-col bg-background border-border shadow-lg',
            side === 'bottom' &&
              'inset-x-0 bottom-0 max-h-[90vh] rounded-t-lg border-t',
            side === 'right' && 'top-0 right-0 h-full w-full max-w-lg border-l',
            className
          )}
          onClick={(e) => e.stopPropagation()}
          {...props}
        >
          {children}
        </div>
      </div>,
      document.body
    )
  }
)
SheetContent.displayName = 'SheetContent'

export interface SheetTriggerProps {
  asChild?: boolean
  children: React.ReactNode
  className?: string
}

/**
 * Dispara abertura do Sheet ao ser clicado.
 */
function SheetTrigger({ asChild, children, className }: SheetTriggerProps) {
  const { onOpenChange } = useSheet()
  const handleClick = React.useCallback(() => onOpenChange(true), [onOpenChange])
  if (asChild && React.isValidElement(children)) {
    const childOnClick = (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick
    return (
      <Slot
        className={className}
        onClick={(e: React.MouseEvent) => {
          childOnClick?.(e)
          handleClick()
        }}
      >
        {children}
      </Slot>
    )
  }
  return (
    <button type="button" className={className} onClick={handleClick}>
      {children}
    </button>
  )
}

const SheetHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1.5 p-6', className)}
    {...props}
  />
))
SheetHeader.displayName = 'SheetHeader'

const SheetTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
))
SheetTitle.displayName = 'SheetTitle'

const SheetFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col-reverse gap-2 p-6 sm:flex-row', className)}
    {...props}
  />
))
SheetFooter.displayName = 'SheetFooter'

export interface SheetCloseProps {
  asChild?: boolean
  children: React.ReactNode
  className?: string
}

/**
 * Fecha o Sheet ao ser ativado (ex.: Button como filho).
 */
function SheetClose({ asChild, children, className }: SheetCloseProps) {
  const { onOpenChange } = useSheet()
  const handleClick = React.useCallback(() => onOpenChange(false), [onOpenChange])
  if (asChild && React.isValidElement(children)) {
    const childOnClick = (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick
    return (
      <Slot
        className={className}
        onClick={(e: React.MouseEvent) => {
          childOnClick?.(e)
          handleClick()
        }}
      >
        {children}
      </Slot>
    )
  }
  return (
    <button type="button" className={className} onClick={handleClick}>
      {children}
    </button>
  )
}

export { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetClose, SheetTrigger }
