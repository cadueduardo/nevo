/**
 * LoginCard
 *
 * Componente específico do onboarding para login com email/senha.
 */
'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface LoginCardSubmitPayload {
  email: string
  password: string
}

interface LoginCardProps {
  disabled?: boolean
  onSubmit: (payload: LoginCardSubmitPayload) => void | Promise<void>
  onCancel?: () => void
}

export function LoginCard({ disabled, onSubmit, onCancel }: LoginCardProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSubmit = async () => {
    const e = email.trim()
    if (!e.includes('@')) return setLocalError('Informe um email válido.')
    if (!password) return setLocalError('Informe sua senha.')
    setLocalError(null)
    await onSubmit({ email: e, password })
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-lg">Entrar</CardTitle>
        <CardDescription>
          Use seu email e senha para continuar o onboarding.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2">
          <label className="text-sm text-muted-foreground">Email</label>
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={disabled}
            placeholder="voce@empresa.com"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm text-muted-foreground">Senha</label>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={disabled}
            placeholder="sua senha"
          />
        </div>

        {localError && <div className="text-sm text-red-600">{localError}</div>}
      </CardContent>
      <CardFooter className="gap-2 justify-end">
        {onCancel && (
          <Button type="button" variant="ghost" disabled={disabled} onClick={onCancel}>
            Agora não
          </Button>
        )}
        <Button type="button" disabled={disabled} onClick={handleSubmit}>
          Entrar
        </Button>
      </CardFooter>
    </Card>
  )
}

