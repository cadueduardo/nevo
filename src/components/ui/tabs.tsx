'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Tabs: abas controladas por valor. Uso: value + onValueChange (ou defaultValue).
 * Reutilizável em qualquer tela que precise de navegação por abas.
 */
export interface TabsContextValue {
  value: string
  onValueChange: (v: string) => void
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

export function Tabs({
  value: controlledValue,
  defaultValue = '',
  onValueChange,
  className,
  children,
  ...props
}: TabsProps) {
  const [uncontrolledValue, setUncontrolled] = React.useState(defaultValue)
  const value = controlledValue ?? uncontrolledValue
  const handleChange = React.useCallback(
    (v: string) => {
      if (onValueChange) onValueChange(v)
      else setUncontrolled(v)
    },
    [onValueChange]
  )
  const ctx: TabsContextValue = React.useMemo(
    () => ({ value, onValueChange: handleChange }),
    [value, handleChange]
  )
  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn('w-full', className)} data-state={value} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

export function useTabsContext() {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error('Tabs components must be used within Tabs')
  return ctx
}

export function TabsList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
}

export function TabsTrigger({ value, className, ...props }: TabsTriggerProps) {
  const { value: selected, onValueChange } = useTabsContext()
  const isSelected = selected === value
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      data-state={isSelected ? 'active' : 'inactive'}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        isSelected ? 'bg-background text-foreground shadow' : 'hover:bg-background/50 hover:text-foreground',
        className
      )}
      onClick={() => onValueChange(value)}
      {...props}
    />
  )
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
}

export function TabsContent({ value, className, ...props }: TabsContentProps) {
  const { value: selected } = useTabsContext()
  if (selected !== value) return null
  return (
    <div
      role="tabpanel"
      className={cn('mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', className)}
      {...props}
    />
  )
}
