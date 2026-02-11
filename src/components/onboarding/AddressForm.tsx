'use client'

/**
 * AddressForm - Formulário de endereço com busca por CEP (ViaCEP/Correios).
 * Usado no onboarding quando o estabelecimento tem ponto fixo.
 */
import { useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchAddressByCep } from '@/lib/viacep'

export interface AddressFormSubmitPayload {
  cep: string
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
  localidade: string
  uf: string
}

interface AddressFormProps {
  disabled?: boolean
  onSubmit: (payload: AddressFormSubmitPayload) => void | Promise<void>
  onCancel?: () => void
}

function formatCep(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length > 5) return `${digits.slice(0, 5)}-${digits.slice(5)}`
  return digits
}

export function AddressForm({ disabled, onSubmit, onCancel }: AddressFormProps) {
  const [cep, setCep] = useState('')
  const [logradouro, setLogradouro] = useState('')
  const [numero, setNumero] = useState('')
  const [complemento, setComplemento] = useState('')
  const [bairro, setBairro] = useState('')
  const [localidade, setLocalidade] = useState('')
  const [uf, setUf] = useState('')
  const [loadingCep, setLoadingCep] = useState(false)
  const [cepError, setCepError] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const fillFromViaCep = useCallback(async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, '')
    if (digits.length !== 8) return
    setLoadingCep(true)
    setCepError(null)
    try {
      const data = await fetchAddressByCep(digits)
      if (data) {
        setLogradouro(data.logradouro || '')
        setBairro(data.bairro || '')
        setLocalidade(data.localidade || '')
        setUf(data.uf || '')
      } else {
        setCepError('CEP não encontrado.')
      }
    } catch {
      setCepError('Erro ao buscar CEP. Tente novamente.')
    } finally {
      setLoadingCep(false)
    }
  }, [])

  const handleCepBlur = () => {
    const digits = cep.replace(/\D/g, '')
    if (digits.length === 8) {
      fillFromViaCep(digits)
    } else if (digits.length > 0) {
      setCepError('CEP deve ter 8 dígitos.')
    } else {
      setCepError(null)
    }
  }

  const handleCepChange = (v: string) => {
    setCep(formatCep(v))
    setCepError(null)
  }

  const handleSubmit = async () => {
    const digits = cep.replace(/\D/g, '')
    if (digits.length !== 8) return setLocalError('Informe um CEP válido.')
    if (!logradouro.trim()) return setLocalError('O endereço não foi preenchido. Verifique o CEP.')
    if (!numero.trim()) return setLocalError('Informe o número.')

    setLocalError(null)
    await onSubmit({
      cep: formatCep(digits),
      logradouro: logradouro.trim(),
      numero: numero.trim(),
      complemento: complemento.trim() || undefined,
      bairro: bairro.trim(),
      localidade: localidade.trim(),
      uf: uf.trim().toUpperCase(),
    })
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-lg">Endereço do estabelecimento</CardTitle>
        <CardDescription>
          Comece pelo CEP. O endereço será preenchido automaticamente. Depois informe o número e o complemento (opcional).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2">
          <label className="text-sm text-muted-foreground">CEP</label>
          <Input
            type="text"
            inputMode="numeric"
            value={cep}
            onChange={(e) => handleCepChange(e.target.value)}
            onBlur={handleCepBlur}
            disabled={disabled}
            placeholder="00000-000"
            maxLength={9}
            className={cepError ? 'border-red-500' : ''}
          />
          {loadingCep && <span className="text-xs text-muted-foreground">Buscando endereço...</span>}
          {cepError && <span className="text-xs text-red-600">{cepError}</span>}
        </div>

        <div className="grid gap-2">
          <label className="text-sm text-muted-foreground">Logradouro</label>
          <Input
            type="text"
            value={logradouro}
            onChange={(e) => setLogradouro(e.target.value)}
            disabled={disabled}
            placeholder="Rua, Avenida..."
            readOnly
            className="bg-muted"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <label className="text-sm text-muted-foreground">Número</label>
            <Input
              type="text"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              disabled={disabled}
              placeholder="123"
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-muted-foreground">Complemento (opcional)</label>
            <Input
              type="text"
              value={complemento}
              onChange={(e) => setComplemento(e.target.value)}
              disabled={disabled}
              placeholder="Apto, sala, loja..."
            />
          </div>
        </div>

        <div className="grid gap-2">
          <label className="text-sm text-muted-foreground">Bairro</label>
          <Input
            type="text"
            value={bairro}
            onChange={(e) => setBairro(e.target.value)}
            disabled={disabled}
            readOnly
            className="bg-muted"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <label className="text-sm text-muted-foreground">Cidade</label>
            <Input
              type="text"
              value={localidade}
              onChange={(e) => setLocalidade(e.target.value)}
              disabled={disabled}
              readOnly
              className="bg-muted"
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-muted-foreground">UF</label>
            <Input
              type="text"
              value={uf}
              onChange={(e) => setUf(e.target.value)}
              disabled={disabled}
              placeholder="SP"
              maxLength={2}
              className="bg-muted w-20"
            />
          </div>
        </div>

        {localError && <div className="text-sm text-red-600">{localError}</div>}
      </CardContent>
      <CardFooter className="gap-2 justify-end">
        {onCancel && (
          <Button type="button" variant="ghost" disabled={disabled} onClick={onCancel}>
            Pular
          </Button>
        )}
        <Button type="button" disabled={disabled || loadingCep} onClick={handleSubmit}>
          Continuar
        </Button>
      </CardFooter>
    </Card>
  )
}
