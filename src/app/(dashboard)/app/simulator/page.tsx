import { SimulatorAppClient } from '@/features/simulator/components/SimulatorAppClient'
import Link from 'next/link'

export default function SimulatorPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Simulador</h1>
        <Link href="/app" className="text-sm text-primary underline hover:no-underline">
          Voltar ao início
        </Link>
      </div>
      <div className="flex-1 min-h-0">
        <SimulatorAppClient />
      </div>
    </div>
  )
}
