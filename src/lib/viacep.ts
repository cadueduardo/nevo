/**
 * ViaCEP - API dos Correios para busca de endereço por CEP.
 * @see https://viacep.com.br/
 */

export interface ViaCepResponse {
  cep: string
  logradouro: string
  complemento: string
  bairro: string
  localidade: string
  uf: string
  ibge?: string
  ddd?: string
  erro?: boolean
}

export async function fetchAddressByCep(cep: string): Promise<ViaCepResponse | null> {
  const digits = (cep || '').replace(/\D/g, '')
  if (digits.length !== 8) return null

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as ViaCepResponse
    if (data.erro) return null
    return data
  } catch {
    return null
  }
}
