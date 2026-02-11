import { DashboardClient } from './DashboardClient'

/**
 * Página inicial da área do cliente (/app).
 * Dados escopados ao agente ativo (bootstrap e agenda via DashboardClient).
 */
export default function AppPage() {
  return <DashboardClient />
}
