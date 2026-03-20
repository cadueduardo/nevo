import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import '@/styles/globals.css'

const SentryProvider = dynamic(
  () => import('@/components/providers/SentryProvider').then((mod) => mod.SentryProvider),
  {
    ssr: false,
  }
)

export const metadata: Metadata = {
  title: 'Nevo - Atendimento Inteligente',
  description: 'SaaS de atendimento inteligente por WhatsApp',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💬</text></svg>",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <SentryProvider>{children}</SentryProvider>
      </body>
    </html>
  )
}
