import type { Metadata } from 'next'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { SentryProvider } from '@/components/providers/SentryProvider'
import '@/styles/globals.css'

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
        <SentryProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </SentryProvider>
      </body>
    </html>
  )
}
