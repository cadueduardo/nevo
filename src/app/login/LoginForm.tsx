'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const eTrim = email.trim()
    if (!eTrim.includes('@')) {
      setError('Informe um email válido.')
      return
    }
    if (!password) {
      setError('Informe sua senha.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: eTrim,
        password,
      })
      if (signInError) {
        setError(signInError.message || 'Email ou senha incorretos.')
        return
      }
      router.push('/app')
      router.refresh()
    } catch {
      setError('Não foi possível entrar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle className="text-lg">Entrar</CardTitle>
          <CardDescription>
            Use seu email e senha para acessar a área do cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <label htmlFor="login-email" className="text-sm text-muted-foreground">
              Email
            </label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              placeholder="voce@empresa.com"
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="login-password" className="text-sm text-muted-foreground">
              Senha
            </label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="sua senha"
            />
          </div>
          {error && (
            <div className="text-sm text-destructive" role="alert">
              {error}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Entrando…' : 'Entrar'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
