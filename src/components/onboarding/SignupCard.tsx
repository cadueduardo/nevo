/**
 * SignupCard
 *
 * Componente específico do onboarding para cadastro com email/senha.
 * Não envia senha pelo chat; dispara callbacks para o container orquestrar as chamadas.
 */
'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface SignupCardSubmitPayload {
  email: string
  password: string
}

interface SignupCardProps {
  disabled?: boolean
  onSubmit: (payload: SignupCardSubmitPayload) => void | Promise<void>
  onCancel?: () => void
  onGoogleClick?: () => void
  googleEnabled?: boolean
  /** Erro retornado pelo servidor (ex.: e-mail já cadastrado). Exibido dentro do card. */
  serverError?: string | null
  /** Chamado quando o usuário altera email/senha para limpar o erro do servidor na UI. */
  onClearServerError?: () => void
}

export function SignupCard({ disabled, onSubmit, onCancel, onGoogleClick, googleEnabled = false, serverError, onClearServerError }: SignupCardProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const errorToShow = serverError ?? localError

  const handleSubmit = async () => {
    const e = email.trim()
    if (!e.includes('@')) return setLocalError('Informe um email válido.')
    if (password.length < 8) return setLocalError('A senha deve ter no mínimo 8 caracteres.')
    if (password !== confirm) return setLocalError('As senhas não coincidem.')
    setLocalError(null)
    await onSubmit({ email: e, password })
  }

  const clearErrors = () => {
    setLocalError(null)
    onClearServerError?.()
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-lg">Criar conta</CardTitle>
        <CardDescription>
          Você pode cadastrar com email e senha. (O Google será habilitado quando o fluxo de migração do onboarding suportar OAuth.)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={disabled || !googleEnabled}
          onClick={onGoogleClick}
        >
          Continuar com Google
        </Button>

        <div className="grid gap-2">
          <label className="text-sm text-muted-foreground">Email</label>
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearErrors() }}
            onFocus={clearErrors}
            disabled={disabled}
            placeholder="voce@empresa.com"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm text-muted-foreground">Senha</label>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={disabled}
            placeholder="mínimo 8 caracteres"
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm text-muted-foreground">Confirmar senha</label>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={disabled}
            placeholder="repita a senha"
          />
        </div>

        {errorToShow && <div className="text-sm text-destructive" role="alert">{errorToShow}</div>}
      </CardContent>
      <CardFooter className="gap-2 justify-end">
        {onCancel && (
          <Button type="button" variant="ghost" disabled={disabled} onClick={onCancel}>
            Agora não
          </Button>
        )}
        <Button type="button" disabled={disabled} onClick={handleSubmit}>
          Criar conta
        </Button>
      </CardFooter>
    </Card>
  )
}

