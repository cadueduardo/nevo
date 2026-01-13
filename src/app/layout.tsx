import type { Metadata } from 'next'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'Nevo - Atendimento Inteligente',
  description: 'SaaS de atendimento inteligente por WhatsApp',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
