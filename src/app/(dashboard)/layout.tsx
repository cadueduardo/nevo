import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AgentProvider } from '@/components/providers/AgentProvider'
import { SimulatorDock } from '@/features/simulator/components/SimulatorDock'
import { AppShell } from './AppShell'

/**
 * Layout protegido da área autenticada (/app).
 * Verifica sessão Supabase Auth e redireciona para /login se não autenticado.
 * AgentProvider + Shell (sidebar + header com AgentSwitcher) + SimulatorDock fixo.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const userEmail = user.email ?? 'usuário'

  return (
    <AgentProvider>
      <div className="relative min-h-screen">
        <AppShell userEmail={userEmail}>{children}</AppShell>
        {/* Simulador flutuante: sempre visível no canto inferior direito em todas as páginas /app */}
        <SimulatorDock />
      </div>
    </AgentProvider>
  )
}
