'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'

/**
 * Formulário de cadastro de nova conta. Cria usuário no Supabase Auth.
 */
export function SignupForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const eTrim = email.trim()
    if (!eTrim.includes('@')) {
      setError('Informe um email válido.')
      return
    }
    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.')
      return
    }
    setError(null)
    setSuccessMessage(null)
    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: eTrim,
        password,
      })
      if (signUpError) {
        setError(signUpError.message || 'Não foi possível criar a conta.')
        return
      }
      if (data?.user?.identities?.length === 0) {
        setError('Já existe uma conta com este email.')
        return
      }
      if (data?.session) {
        // Sem confirmação de email — já está autenticado
        router.push('/app')
        router.refresh()
        return
      }
      // Supabase exige confirmação de email — usuário precisa clicar no link enviado
      setSuccessMessage(
        'Conta criada! Confira seu email para confirmar o cadastro. Depois, faça login.'
      )
    } catch {
      setError('Não foi possível criar a conta. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle className="text-lg">Criar conta</CardTitle>
          <CardDescription>
            Use seu email para criar uma conta na área do cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <label htmlFor="signup-email" className="text-sm text-muted-foreground">
              Email
            </label>
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="voce@empresa.com"
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="signup-password" className="text-sm text-muted-foreground">
              Senha
            </label>
            <Input
              id="signup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="mínimo 6 caracteres"
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="signup-confirm-password" className="text-sm text-muted-foreground">
              Confirmar senha
            </label>
            <Input
              id="signup-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              placeholder="repita a senha"
            />
          </div>
          {error && (
            <div className="text-sm text-destructive" role="alert">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="text-sm text-green-600 dark:text-green-400" role="status">
              {successMessage}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Criando conta…' : 'Criar conta'}
          </Button>
          <p className="text-sm text-muted-foreground text-center">
            Já tem uma conta?{' '}
            <Link href="/login" className="underline hover:text-foreground">
              Entrar
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
