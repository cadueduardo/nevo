import { SettingsPageClient } from './SettingsPageClient'

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <SettingsPageClient />
      </div>
    </div>
  )
}
