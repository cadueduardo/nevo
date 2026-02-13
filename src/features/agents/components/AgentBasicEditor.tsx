'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  Service,
  Schedule,
  EstablishmentAddress,
  ServiceArea,
  Policies,
  DynamicVariable,
  FAQ,
} from '@/types/business-model'
import { fetchAddressByCep } from '@/lib/viacep'
import { fetchFeriadosNacionais } from '@/lib/brasil-api'

const DAYS_OF_WEEK = [
  { value: 'monday', label: 'Segunda' },
  { value: 'tuesday', label: 'Terça' },
  { value: 'wednesday', label: 'Quarta' },
  { value: 'thursday', label: 'Quinta' },
  { value: 'friday', label: 'Sexta' },
  { value: 'saturday', label: 'Sábado' },
  { value: 'sunday', label: 'Domingo' },
] as const

function defaultSchedule(): Schedule {
  return {
    days_of_week: [],
    start_time: '09:00',
    end_time: '18:00',
    interval_minutes: 30,
    min_booking_lead_minutes: 20,
    breaks: [],
  }
}

function defaultAddress(): EstablishmentAddress {
  return {
    cep: '',
    logradouro: '',
    numero: '',
    bairro: '',
    localidade: '',
    uf: '',
  }
}

/** Payload completo da aba Básico (espelho do onboarding). */
export interface BasicConfigPayload {
  services: Service[]
  schedule?: Schedule
  greeting_message?: string
  fallback_message?: string
  business_type?: string
  business_name?: string
  context?: 'booking' | 'quote' | 'both'
  location_mode?: 'fixed' | 'mobile'
  establishment_address?: EstablishmentAddress
  service_area?: ServiceArea
  policies?: Policies
  tone_of_voice?: string
  handoff_mode?: string
  dynamic_variables?: DynamicVariable[]
  faq?: FAQ[]
  allow_sequence_booking?: boolean
  staff?: Array<{ name: string; schedule?: Schedule }>
  holidays_attend?: string[]
  closure_periods?: Array<{ start: string; end: string }>
}

export interface AgentBasicEditorProps {
  name: string
  businessType?: string | null
  /** Todas as configs do onboarding (business_config + campos que espelham o fluxo). */
  initialConfig: Partial<BasicConfigPayload>
  onSave: (payload: {
    name?: string
    business_type?: string
    business_config?: Partial<BasicConfigPayload>
  }) => Promise<void>
}

/**
 * Editor da aba Básico: todas as configurações do onboarding para edição livre.
 * Nome, negócio, contexto, serviços, agenda, localização, políticas, mensagens, tom/handoff, variáveis orçamento, FAQ.
 */
export function AgentBasicEditor({
  name: initialName,
  businessType: initialBusinessType = '',
  initialConfig,
  onSave,
}: AgentBasicEditorProps) {
  const [name, setName] = React.useState(initialName)
  const [businessType, setBusinessType] = React.useState(initialBusinessType ?? '')
  const [businessName, setBusinessName] = React.useState(initialConfig.business_name ?? '')
  const [context, setContext] = React.useState<string>(initialConfig.context ?? '')
  const [services, setServices] = React.useState<Service[]>(
    Array.isArray(initialConfig.services) ? initialConfig.services : []
  )
  const [schedule, setSchedule] = React.useState<Schedule>(() => {
    const base =
      initialConfig.schedule && Array.isArray(initialConfig.schedule.days_of_week)
        ? { ...initialConfig.schedule, breaks: initialConfig.schedule.breaks ?? [] }
        : defaultSchedule()
    return {
      ...base,
      min_booking_lead_minutes: base.min_booking_lead_minutes ?? 20,
    }
  })
  const [loadingCep, setLoadingCep] = React.useState(false)
  const [locationMode, setLocationMode] = React.useState<string>(initialConfig.location_mode ?? '')
  const [address, setAddress] = React.useState<EstablishmentAddress>(
    initialConfig.establishment_address ?? defaultAddress()
  )
  const [serviceArea, setServiceArea] = React.useState<ServiceArea>({
    region: initialConfig.service_area?.region ?? '',
    coverage: initialConfig.service_area?.coverage ?? '',
    travel_fee: initialConfig.service_area?.travel_fee,
    distance_limit_km: initialConfig.service_area?.distance_limit_km,
  })
  const [policies, setPolicies] = React.useState<Policies>({
    cancellation_hours: initialConfig.policies?.cancellation_hours,
    deposit_percentage: initialConfig.policies?.deposit_percentage,
    deposit_rules: initialConfig.policies?.deposit_rules ?? '',
    refund_policy: initialConfig.policies?.refund_policy ?? '',
  })
  const [greetingMessage, setGreetingMessage] = React.useState(initialConfig.greeting_message ?? '')
  const [fallbackMessage, setFallbackMessage] = React.useState(initialConfig.fallback_message ?? '')
  const [toneOfVoice, setToneOfVoice] = React.useState(initialConfig.tone_of_voice ?? '')
  const [handoffMode, setHandoffMode] = React.useState(initialConfig.handoff_mode ?? '')
  const [dynamicVariables, setDynamicVariables] = React.useState<DynamicVariable[]>(
    Array.isArray(initialConfig.dynamic_variables) ? initialConfig.dynamic_variables : []
  )
  const [faq, setFaq] = React.useState<FAQ[]>(Array.isArray(initialConfig.faq) ? initialConfig.faq : [])
  const [allowSequenceBooking, setAllowSequenceBooking] = React.useState(
    initialConfig.allow_sequence_booking ?? false
  )
  const [staff, setStaff] = React.useState<Array<{ name: string }>>(
    Array.isArray(initialConfig.staff) ? initialConfig.staff.map((s) => ({ name: s.name ?? '' })) : []
  )
  const [holidaysAttend, setHolidaysAttend] = React.useState<string[]>(
    Array.isArray(initialConfig.holidays_attend) ? initialConfig.holidays_attend : []
  )
  /** Réplica do onboarding: modo "Sim, quero marcar" — mostra lista da API Brasil com checkboxes. */
  const [holidaysSelecting, setHolidaysSelecting] = React.useState(false)
  const [holidaysList, setHolidaysList] = React.useState<Array<{ date: string; name: string }>>([])
  const [holidaysLoading, setHolidaysLoading] = React.useState(false)
  const [holidaysYear] = React.useState(() => new Date().getFullYear())
  /** Seleção temporária ao marcar feriados (antes de "Aplicar seleção"). */
  const [holidaysSelection, setHolidaysSelection] = React.useState<Set<string>>(new Set())
  const [closurePeriods, setClosurePeriods] = React.useState<Array<{ start: string; end: string }>>(
    Array.isArray(initialConfig.closure_periods) ? initialConfig.closure_periods : []
  )
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setName(initialName)
    setBusinessType(initialBusinessType ?? '')
    setBusinessName(initialConfig.business_name ?? '')
    setContext(initialConfig.context ?? '')
    setServices(Array.isArray(initialConfig.services) ? initialConfig.services : [])
    setSchedule(
      initialConfig.schedule && Array.isArray(initialConfig.schedule.days_of_week)
        ? { ...initialConfig.schedule }
        : defaultSchedule()
    )
    setLocationMode(initialConfig.location_mode ?? '')
    setAddress(initialConfig.establishment_address ?? defaultAddress())
    setServiceArea({
      region: initialConfig.service_area?.region ?? '',
      coverage: initialConfig.service_area?.coverage ?? '',
      travel_fee: initialConfig.service_area?.travel_fee,
      distance_limit_km: initialConfig.service_area?.distance_limit_km,
    })
    setPolicies({
      cancellation_hours: initialConfig.policies?.cancellation_hours,
      deposit_percentage: initialConfig.policies?.deposit_percentage,
      deposit_rules: initialConfig.policies?.deposit_rules ?? '',
      refund_policy: initialConfig.policies?.refund_policy ?? '',
    })
    setGreetingMessage(initialConfig.greeting_message ?? '')
    setFallbackMessage(initialConfig.fallback_message ?? '')
    setToneOfVoice(initialConfig.tone_of_voice ?? '')
    setHandoffMode(initialConfig.handoff_mode ?? '')
    setDynamicVariables(Array.isArray(initialConfig.dynamic_variables) ? initialConfig.dynamic_variables : [])
    setFaq(Array.isArray(initialConfig.faq) ? initialConfig.faq : [])
    setAllowSequenceBooking(initialConfig.allow_sequence_booking ?? false)
    setStaff(Array.isArray(initialConfig.staff) ? initialConfig.staff.map((s) => ({ name: (s as { name?: string }).name ?? '' })) : [])
    setHolidaysAttend(Array.isArray(initialConfig.holidays_attend) ? initialConfig.holidays_attend : [])
    setHolidaysSelection(new Set(Array.isArray(initialConfig.holidays_attend) ? initialConfig.holidays_attend : []))
    setClosurePeriods(Array.isArray(initialConfig.closure_periods) ? initialConfig.closure_periods : [])
  }, [initialName, initialBusinessType, initialConfig])

  const buildPayload = (): Partial<BasicConfigPayload> => ({
    services,
    schedule,
    greeting_message: greetingMessage.trim() || undefined,
    fallback_message: fallbackMessage.trim() || undefined,
    business_name: businessName.trim() || undefined,
    context: (context as 'booking' | 'quote' | 'both') || undefined,
    location_mode: (locationMode as 'fixed' | 'mobile') || undefined,
    establishment_address:
      locationMode === 'fixed' && (address.cep || address.logradouro || address.localidade)
        ? address
        : undefined,
    service_area: locationMode === 'mobile' && serviceArea.region ? serviceArea : undefined,
    policies:
      policies.cancellation_hours != null ||
      policies.deposit_percentage != null ||
      policies.deposit_rules ||
      policies.refund_policy
        ? policies
        : undefined,
    tone_of_voice: toneOfVoice || undefined,
    handoff_mode: handoffMode || undefined,
    dynamic_variables: dynamicVariables.length > 0 ? dynamicVariables : undefined,
    faq: faq.length > 0 ? faq : undefined,
    allow_sequence_booking: allowSequenceBooking,
    staff: staff.filter((s) => s.name.trim()).length > 0 ? staff : undefined,
    holidays_attend: holidaysAttend.length > 0 ? holidaysAttend : undefined,
    closure_periods: closurePeriods.length > 0 ? closurePeriods : undefined,
  })

  const handleSave = async () => {
    setError(null)
    setSaving(true)
    try {
      await onSave({
        name: name.trim() !== initialName ? name.trim() : undefined,
        business_type: businessType.trim() || undefined,
        business_config: buildPayload(),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const toggleDay = (day: string) => {
    setSchedule((prev) => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(day)
        ? prev.days_of_week.filter((d) => d !== day)
        : [...prev.days_of_week, day],
    }))
  }

  const addService = () => {
    setServices((prev) => [...prev, { id: `s-${Date.now()}`, name: '', duration_minutes: 30 }])
  }
  const updateService = (index: number, updates: Partial<Service>) => {
    setServices((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], ...updates }
      return next
    })
  }
  const removeService = (index: number) => {
    setServices((prev) => prev.filter((_, i) => i !== index))
  }

  const addFaq = () => {
    setFaq((prev) => [...prev, { question: '', answer: '' }])
  }
  const updateFaq = (index: number, updates: Partial<FAQ>) => {
    setFaq((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], ...updates }
      return next
    })
  }
  const removeFaq = (index: number) => {
    setFaq((prev) => prev.filter((_, i) => i !== index))
  }

  const addDynamicVariable = () => {
    setDynamicVariables((prev) => [
      ...prev,
      { key: '', label: '', type: 'text', required: false, context: 'quote' },
    ])
  }
  const updateDynamicVariable = (index: number, updates: Partial<DynamicVariable>) => {
    setDynamicVariables((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], ...updates }
      return next
    })
  }
  const removeDynamicVariable = (index: number) => {
    setDynamicVariables((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-6">
      {/* Nome do agente */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Nome do agente</CardTitle>
          <CardDescription>Nome exibido no header e no simulador.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Atendimento Principal"
            className="max-w-md"
          />
        </CardContent>
      </Card>

      {/* Negócio (tipo + nome) - onboarding steps 1-2 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Negócio</CardTitle>
          <CardDescription>Tipo e nome do negócio (configurados no onboarding).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Tipo do negócio</label>
            <Input
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              placeholder="Ex.: Barbearia, Design de sobrancelhas"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome do negócio</label>
            <Input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Ex.: Barbearia Brutos"
            />
          </div>
        </CardContent>
      </Card>

      {/* Contexto - onboarding step 3 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Contexto</CardTitle>
          <CardDescription>Agendamento, orçamento ou ambos.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={context || 'none'} onValueChange={(v) => setContext(v === 'none' ? '' : v)}>
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              <SelectItem value="booking">Agendamento</SelectItem>
              <SelectItem value="quote">Orçamento</SelectItem>
              <SelectItem value="both">Ambos</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Serviços - onboarding 4, 8, 9 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Serviços</CardTitle>
          <CardDescription>Lista de serviços (nome, duração, valor opcional).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {services.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
              <Input
                value={s.name}
                onChange={(e) => updateService(i, { name: e.target.value })}
                placeholder="Nome"
                className="flex-1 min-w-[120px]"
              />
              <Input
                type="number"
                value={s.duration_minutes ?? ''}
                onChange={(e) =>
                  updateService(i, {
                    duration_minutes: e.target.value ? parseInt(e.target.value, 10) : undefined,
                  })
                }
                placeholder="Min"
                className="w-16"
              />
              <span className="text-xs text-muted-foreground">min</span>
              <Input
                type="number"
                value={s.base_price ?? ''}
                onChange={(e) =>
                  updateService(i, {
                    base_price: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
                placeholder="R$"
                className="w-24"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeService(i)}
                className="text-destructive hover:text-destructive"
              >
                Remover
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addService}>
            Adicionar serviço
          </Button>
        </CardContent>
      </Card>

      {/* Agenda - onboarding 5, 6, 7 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Agenda</CardTitle>
          <CardDescription>Dias, horário, intervalo entre atendimentos e pausas no dia.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">Dias de funcionamento</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map(({ value, label }) => (
                <label key={value} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={schedule.days_of_week.includes(value)}
                    onChange={() => toggleDay(value)}
                    className="rounded border-input"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Horário início</label>
              <Input
                type="time"
                value={schedule.start_time}
                onChange={(e) => setSchedule((p) => ({ ...p, start_time: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Horário fim</label>
              <Input
                type="time"
                value={schedule.end_time}
                onChange={(e) => setSchedule((p) => ({ ...p, end_time: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Intervalo entre atendimentos (min)</label>
              <Input
                type="number"
                min={5}
                value={schedule.interval_minutes}
                onChange={(e) =>
                  setSchedule((p) => ({
                    ...p,
                    interval_minutes: parseInt(e.target.value, 10) || 30,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Antecedência mínima para agendamento (min)</label>
              <p className="text-muted-foreground text-xs">
                Quanto tempo antes do horário o cliente precisa solicitar o agendamento.
              </p>
              <select
                value={schedule.min_booking_lead_minutes ?? 20}
                onChange={(e) =>
                  setSchedule((p) => ({
                    ...p,
                    min_booking_lead_minutes: parseInt(e.target.value, 10),
                  }))
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value={5}>5 min</option>
                <option value={10}>10 min</option>
                <option value={15}>15 min</option>
                <option value={20}>20 min</option>
                <option value={30}>30 min</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Pausas no dia</label>
            <p className="text-muted-foreground text-xs">Ex.: almoço das 12h às 13h.</p>
            <div className="mt-2 space-y-2">
              {(schedule.breaks ?? []).map((br, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input
                    type="time"
                    className="w-28"
                    value={br.start}
                    onChange={(e) =>
                      setSchedule((p) => ({
                        ...p,
                        breaks: (p.breaks ?? []).map((b, j) => (j === i ? { ...b, start: e.target.value } : b)),
                      }))
                    }
                  />
                  <span className="text-muted-foreground text-sm">até</span>
                  <Input
                    type="time"
                    className="w-28"
                    value={br.end}
                    onChange={(e) =>
                      setSchedule((p) => ({
                        ...p,
                        breaks: (p.breaks ?? []).map((b, j) => (j === i ? { ...b, end: e.target.value } : b)),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSchedule((p) => ({
                        ...p,
                        breaks: (p.breaks ?? []).filter((_, j) => j !== i),
                      }))
                    }
                  >
                    Remover
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSchedule((p) => ({
                    ...p,
                    breaks: [...(p.breaks ?? []), { start: '12:00', end: '13:00' }],
                  }))
                }
              >
                Adicionar pausa
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Localização - onboarding 17, 18, 19, 20 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Localização</CardTitle>
          <CardDescription>Endereço fixo ou região de atendimento.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Modo</label>
            <Select value={locationMode || 'none'} onValueChange={(v) => setLocationMode(v === 'none' ? '' : v)}>
              <SelectTrigger className="max-w-xs">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="fixed">Endereço fixo</SelectItem>
                <SelectItem value="mobile">Atendo no endereço do cliente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {locationMode === 'fixed' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Input
                  placeholder="CEP"
                  value={address.cep}
                  onChange={(e) => setAddress((a) => ({ ...a, cep: e.target.value }))}
                  onBlur={async () => {
                    const digits = (address.cep ?? '').replace(/\D/g, '')
                    if (digits.length !== 8) return
                    setLoadingCep(true)
                    try {
                      const data = await fetchAddressByCep(address.cep)
                      if (data) {
                        setAddress((a) => ({
                          ...a,
                          logradouro: data.logradouro ?? a.logradouro,
                          bairro: data.bairro ?? a.bairro,
                          localidade: data.localidade ?? a.localidade,
                          uf: data.uf ?? a.uf,
                        }))
                      }
                    } finally {
                      setLoadingCep(false)
                    }
                  }}
                />
                {loadingCep && <p className="text-muted-foreground text-xs">Buscando endereço…</p>}
              </div>
              <Input
                placeholder="Logradouro"
                value={address.logradouro}
                onChange={(e) => setAddress((a) => ({ ...a, logradouro: e.target.value }))}
              />
              <Input
                placeholder="Número"
                value={address.numero}
                onChange={(e) => setAddress((a) => ({ ...a, numero: e.target.value }))}
              />
              <Input
                placeholder="Bairro"
                value={address.bairro}
                onChange={(e) => setAddress((a) => ({ ...a, bairro: e.target.value }))}
              />
              <Input
                placeholder="Cidade"
                value={address.localidade}
                onChange={(e) => setAddress((a) => ({ ...a, localidade: e.target.value }))}
              />
              <Input
                placeholder="UF"
                value={address.uf}
                onChange={(e) => setAddress((a) => ({ ...a, uf: e.target.value }))}
                maxLength={2}
              />
            </div>
          )}
          {locationMode === 'mobile' && (
            <div className="space-y-2">
              <Input
                placeholder="Região de atendimento (ex.: Osasco e região)"
                value={serviceArea.region}
                onChange={(e) => setServiceArea((a) => ({ ...a, region: e.target.value }))}
              />
              <Input
                type="number"
                placeholder="Taxa de deslocamento (R$)"
                value={serviceArea.travel_fee ?? ''}
                onChange={(e) =>
                  setServiceArea((a) => ({
                    ...a,
                    travel_fee: e.target.value ? parseFloat(e.target.value) : undefined,
                  }))
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Políticas - onboarding 21 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Políticas</CardTitle>
          <CardDescription>Cancelamento, sinal, reembolso (opcional).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Horas para cancelamento</label>
              <Input
                type="number"
                value={policies.cancellation_hours ?? ''}
                onChange={(e) =>
                  setPolicies((p) => ({
                    ...p,
                    cancellation_hours: e.target.value ? parseInt(e.target.value, 10) : undefined,
                  }))
                }
                placeholder="Ex.: 24"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Sinal (%)</label>
              <Input
                type="number"
                value={policies.deposit_percentage ?? ''}
                onChange={(e) =>
                  setPolicies((p) => ({
                    ...p,
                    deposit_percentage: e.target.value ? parseFloat(e.target.value) : undefined,
                  }))
                }
                placeholder="Ex.: 50"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Regras de sinal</label>
            <Textarea
              value={policies.deposit_rules}
              onChange={(e) => setPolicies((p) => ({ ...p, deposit_rules: e.target.value }))}
              placeholder="Opcional"
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Política de reembolso</label>
            <Textarea
              value={policies.refund_policy}
              onChange={(e) => setPolicies((p) => ({ ...p, refund_policy: e.target.value }))}
              placeholder="Opcional"
              rows={2}
              className="resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Mensagens */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mensagens</CardTitle>
          <CardDescription>Saudação e fallback (opcional).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Saudação</label>
            <Textarea
              value={greetingMessage}
              onChange={(e) => setGreetingMessage(e.target.value)}
              placeholder="Ex.: Olá! Como posso ajudar?"
              rows={2}
              className="resize-none"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Fallback</label>
            <Textarea
              value={fallbackMessage}
              onChange={(e) => setFallbackMessage(e.target.value)}
              placeholder="Ex.: Deseja falar com um atendente?"
              rows={2}
              className="resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Tom e handoff - onboarding 22, 23 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Tom e handoff</CardTitle>
          <CardDescription>Tom de voz e quando passar para humano.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Tom</label>
            <Select value={toneOfVoice || 'none'} onValueChange={(v) => setToneOfVoice(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="formal">Formal</SelectItem>
                <SelectItem value="friendly">Amigável</SelectItem>
                <SelectItem value="professional">Profissional</SelectItem>
                <SelectItem value="funny">Engraçado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Handoff</label>
            <Select value={handoffMode || 'none'} onValueChange={(v) => setHandoffMode(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="always">Sempre humano</SelectItem>
                <SelectItem value="conditional">Condicional</SelectItem>
                <SelectItem value="never">Automático</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Variáveis para orçamento - onboarding 17 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Variáveis para orçamento</CardTitle>
          <CardDescription>Informações que o cliente deve informar (ex.: medidas, quantidade).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {dynamicVariables.map((v, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <Input
                placeholder="Chave (snake_case)"
                value={v.key}
                onChange={(e) => updateDynamicVariable(i, { key: e.target.value })}
                className="w-32 font-mono text-sm"
              />
              <Input
                placeholder="Rótulo"
                value={v.label}
                onChange={(e) => updateDynamicVariable(i, { label: e.target.value })}
                className="flex-1 min-w-[100px]"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeDynamicVariable(i)}
                className="text-destructive"
              >
                Remover
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addDynamicVariable}>
            Adicionar variável
          </Button>
        </CardContent>
      </Card>

      {/* FAQ - onboarding 26 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Perguntas frequentes</CardTitle>
          <CardDescription>Perguntas e respostas (opcional).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {faq.map((item, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <Input
                placeholder="Pergunta"
                value={item.question}
                onChange={(e) => updateFaq(i, { question: e.target.value })}
              />
              <Textarea
                placeholder="Resposta"
                value={item.answer}
                onChange={(e) => updateFaq(i, { answer: e.target.value })}
                rows={2}
                className="resize-none"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeFaq(i)}
                className="text-destructive"
              >
                Remover
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addFaq}>
            Adicionar FAQ
          </Button>
        </CardContent>
      </Card>

      {/* Staff - onboarding: colaboradores */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Colaboradores (staff)</CardTitle>
          <CardDescription>Quem atende (nome).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {staff.map((s, i) => (
            <div key={i} className="flex gap-2">
              <Input
                placeholder="Nome do colaborador"
                value={s.name}
                onChange={(e) =>
                  setStaff((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStaff((prev) => prev.filter((_, j) => j !== i))}
                className="text-destructive"
              >
                Remover
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setStaff((prev) => [...prev, { name: '' }])}
          >
            Adicionar colaborador
          </Button>
        </CardContent>
      </Card>

      {/* Sequência de agendamento - onboarding */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sequência de agendamento</CardTitle>
          <CardDescription>Permitir agendar mais de um serviço em sequência.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={allowSequenceBooking}
              onChange={(e) => setAllowSequenceBooking(e.target.checked)}
              className="rounded border-input"
            />
            <span className="text-sm">Permitir agendamento em sequência</span>
          </label>
        </CardContent>
      </Card>

      {/* Feriados - réplica do onboarding: holidays_offer + holidays_select, API Brasil */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Feriados em que atende</CardTitle>
          <CardDescription>
            Por padrão o agendamento fica fechado em feriados nacionais. Você atende em algum? (Lista via Brasil API.)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!holidaysSelecting ? (
            <>
              <p className="text-sm text-muted-foreground">
                {holidaysAttend.length > 0
                  ? `${holidaysAttend.length} feriado(s) em que você atende neste ano.`
                  : 'Não configurado ou não atende em feriados.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setHolidaysSelecting(true)
                    setHolidaysLoading(true)
                    fetchFeriadosNacionais(holidaysYear)
                      .then((list) => {
                        setHolidaysList(list)
                        setHolidaysSelection(new Set(holidaysAttend))
                      })
                      .finally(() => setHolidaysLoading(false))
                  }}
                >
                  Ver lista de feriados (Brasil API)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const list = await fetchFeriadosNacionais(holidaysYear)
                    setHolidaysAttend(list.map((h) => h.date))
                  }}
                >
                  Atendo todos os feriados
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setHolidaysAttend([])}
                >
                  Não atendo em feriados
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm">Marque os feriados em que você atende e clique em Aplicar seleção.</p>
              {holidaysLoading ? (
                <p className="text-muted-foreground text-sm">Carregando feriados de {holidaysYear}…</p>
              ) : (
                <>
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
                    {holidaysList.map((h) => (
                      <label
                        key={h.date}
                        className="flex cursor-pointer items-center gap-2 rounded p-1.5 hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          checked={holidaysSelection.has(h.date)}
                          onChange={() =>
                            setHolidaysSelection((prev) => {
                              const next = new Set(prev)
                              if (next.has(h.date)) next.delete(h.date)
                              else next.add(h.date)
                              return next
                            })
                          }
                          className="rounded border-input"
                        />
                        <span className="text-sm">
                          {h.name} ({h.date.split('-').reverse().join('/')})
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setHolidaysSelection(new Set(holidaysList.map((h) => h.date)))
                      }}
                    >
                      Atendo todos os feriados
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setHolidaysSelection(new Set())}
                    >
                      Não atendo em nenhum
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setHolidaysAttend(Array.from(holidaysSelection))
                        setHolidaysSelecting(false)
                      }}
                    >
                      Aplicar seleção
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setHolidaysSelecting(false)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Períodos de fechamento - onboarding closure_periods */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Períodos de fechamento</CardTitle>
          <CardDescription>Ex.: 20/12 a 05/01 (férias).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {closurePeriods.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                className="w-36"
                value={p.start}
                onChange={(e) =>
                  setClosurePeriods((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, start: e.target.value } : x))
                  )
                }
              />
              <span className="text-muted-foreground text-sm">até</span>
              <Input
                type="date"
                className="w-36"
                value={p.end}
                onChange={(e) =>
                  setClosurePeriods((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, end: e.target.value } : x))
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setClosurePeriods((prev) => prev.filter((_, j) => j !== i))}
                className="text-destructive"
              >
                Remover
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setClosurePeriods((prev) => [
                ...prev,
                { start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) },
              ])
            }
          >
            Adicionar período
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Salvando…' : 'Salvar'}
      </Button>
    </div>
  )
}
