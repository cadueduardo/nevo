import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from './LoginForm'

/**
 * Página de login. Se o usuário já estiver autenticado, redireciona para /app.
 */
export default async function LoginPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/app')
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold">Nevo</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Entre na sua conta
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
