import dynamic from 'next/dynamic'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const SignupForm = dynamic(() => import('./SignupForm').then((mod) => mod.SignupForm), {
  ssr: false,
  loading: () => <div className="min-h-[320px] rounded-lg border bg-card" />,
})

/**
 * Página de cadastro de nova conta. Se o usuário já estiver autenticado, redireciona para /app.
 */
export default async function SignupPage() {
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
            Crie sua conta
          </p>
        </div>
        <SignupForm />
      </div>
    </div>
  )
}
