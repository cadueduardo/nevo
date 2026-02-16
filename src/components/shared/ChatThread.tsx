'use client'

import { useEffect, useRef } from 'react'
import { ChatMessage } from './ChatMessage'
import type { Message } from './ChatShell'
import { SignupCard } from '@/components/onboarding/SignupCard'
import { LoginCard } from '@/components/onboarding/LoginCard'
import { AddressForm } from '@/components/onboarding/AddressForm'

interface ChatThreadProps {
  messages: Message[]
  isLoading?: boolean
  onActionClick?: (action: string) => void
  onItemEditLocal?: (id: string, value: string) => void
  onSignupSubmit?: (payload: { email: string; password: string }) => void | Promise<void>
  onSignupCancel?: () => void
  signupError?: string | null
  onClearSignupError?: () => void
  onLoginSubmit?: (payload: { email: string; password: string }) => void | Promise<void>
  onLoginCancel?: () => void
  onAddressSubmit?: (payload: {
    cep: string
    logradouro: string
    numero: string
    complemento?: string
    bairro: string
    localidade: string
    uf: string
  }) => void | Promise<void>
  onAddressCancel?: () => void
}

export function ChatThread({
  messages,
  isLoading,
  onActionClick,
  onItemEditLocal,
  onSignupSubmit,
  onSignupCancel,
  signupError,
  onClearSignupError,
  onLoginSubmit,
  onLoginCancel,
  onAddressSubmit,
  onAddressCancel,
}: ChatThreadProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="w-full max-w-3xl mx-auto px-4 py-6 space-y-6">
        {messages.map((message) => {
          if (message.kind === 'signup') {
            return (
              <div key={message.id} className="max-w-[85%] sm:max-w-[75%]">
                <SignupCard
                  disabled={isLoading}
                  onSubmit={async (payload) => onSignupSubmit?.(payload)}
                  onCancel={onSignupCancel}
                  googleEnabled={false}
                  serverError={signupError}
                  onClearServerError={onClearSignupError}
                />
              </div>
            )
          }

          if (message.kind === 'login') {
            return (
              <div key={message.id} className="max-w-[85%] sm:max-w-[75%]">
                <LoginCard
                  disabled={isLoading}
                  onSubmit={async (payload) => onLoginSubmit?.(payload)}
                  onCancel={onLoginCancel}
                />
              </div>
            )
          }

          if (message.kind === 'address') {
            return (
              <div key={message.id} className="max-w-[85%] sm:max-w-[75%]">
                <AddressForm
                  disabled={isLoading}
                  onSubmit={async (payload) => onAddressSubmit?.(payload)}
                  onCancel={onAddressCancel}
                />
              </div>
            )
          }

          return (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              timestamp={message.timestamp}
              actionOptions={message.actionOptions}
              editableItems={message.editableItems}
              selectableOptions={message.selectableOptions}
              requiresAction={message.requiresAction}
              allowCustomInput={message.allowCustomInput}
              customInputPlaceholder={message.customInputPlaceholder}
              onActionClick={onActionClick}
              onItemEditLocal={onItemEditLocal}
              onItemEdit={(id, newValue, allItems) => {
                // Preferir mensagens "humanas" para funcionar mesmo sem suporte a comandos determinísticos no backend.
                const items = allItems || []
                const item = items.find((it) => it.id === id)

                if (id === 'business_name') return onActionClick?.(`Meu negócio se chama ${newValue}.`)
                if (id === 'business_type') return onActionClick?.(`Meu ramo/tipo de negócio é ${newValue}.`)
                if (id === 'context') return onActionClick?.(`Quero configurar ${newValue}.`)
                if (id === 'location_mode') return onActionClick?.(`${newValue}.`)
                if (id === 'service_area') return onActionClick?.(`Minha região de atendimento é: ${newValue}.`)
                if (id === 'tone_of_voice') return onActionClick?.(`Quero que o tom de voz seja ${newValue}.`)
                if (id === 'target_audience') return onActionClick?.(`Meu público-alvo é ${newValue}.`)
                if (id === 'interaction_style') return onActionClick?.(`Quero estilo de respostas ${newValue}.`)
                if (id === 'schedule') return onActionClick?.(`Meu horário de atendimento é: ${newValue}.`)

                if (id.startsWith('service_duration_') && item?.label) {
                  return onActionClick?.(`A duração de ${item.label} é ${newValue}.`)
                }

                if (id.startsWith('service_')) {
                  // Re-enviar a lista completa de serviços (mais confiável do que tentar "renomear" um item).
                  const services = items
                    .filter((it) => it.id.startsWith('service_'))
                    .sort((a, b) => a.id.localeCompare(b.id))
                    .map((it) => (it.id === id ? newValue : it.value))
                    .filter(Boolean)
                  if (services.length > 0) return onActionClick?.(`Meus serviços são: ${services.join(', ')}.`)
                }

                // fallback genérico
                onActionClick?.(newValue)
              }}
              onItemDelete={(id, allItems) => {
                const items = allItems || []

                if (id === 'service_area') return onActionClick?.('Quero remover minha região de atendimento por enquanto.')
                if (id === 'tone_of_voice') return onActionClick?.('Quero remover/definir depois o tom de voz.')
                if (id === 'target_audience') return onActionClick?.('Quero remover/definir depois o público-alvo.')
                if (id === 'interaction_style') return onActionClick?.('Quero remover/definir depois o estilo de respostas.')
                if (id === 'schedule') return onActionClick?.('Quero remover meu horário por enquanto.')
                if (id === 'policies') return onActionClick?.('Não tenho políticas por enquanto.')

                if (id.startsWith('service_')) {
                  const services = items
                    .filter((it) => it.id.startsWith('service_') && it.id !== id)
                    .sort((a, b) => a.id.localeCompare(b.id))
                    .map((it) => it.value)
                    .filter(Boolean)
                  if (services.length > 0) return onActionClick?.(`Meus serviços são: ${services.join(', ')}.`)
                  return onActionClick?.('No momento não quero cadastrar serviços.')
                }

                // fallback genérico
                onActionClick?.('Quero remover isso.')
              }}
              onOptionSelect={(selectedValues, customInput) => {
                if (message.requiresAction === 'services_list' || message.requiresAction === 'services_edit') {
                  const parts = [...selectedValues]
                  if (customInput?.trim()) {
                    parts.push(...customInput.split(',').map((s) => s.trim()).filter(Boolean))
                  }
                  onActionClick?.(`select_services:${parts.join(', ')}`)
                  return
                }
                if (message.requiresAction === 'sequence_services_select') {
                  onActionClick?.(`select_sequence_services:${selectedValues.join(', ')}`)
                  return
                }
                const prefix = message.requiresAction === 'holidays_select' ? 'select_holidays' : 'select_days'
                onActionClick?.(`${prefix}:${selectedValues.join(',')}`)
              }}
            />
          )
        })}
        
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="w-2 h-2 bg-current rounded-full animate-pulse" />
            <div className="w-2 h-2 bg-current rounded-full animate-pulse delay-75" />
            <div className="w-2 h-2 bg-current rounded-full animate-pulse delay-150" />
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}
