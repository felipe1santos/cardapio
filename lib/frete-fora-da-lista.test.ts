import { describe, expect, it, vi } from 'vitest'
import { decidirFrete, normalizarForaDaLista, resolverFrete } from './frete'

// Bairro sem taxa cadastrada (migration 0054): 'bloquear' é a lista fechada de
// sempre; 'taxa_padrao' faz a loja aceitar o pedido cobrando a taxa padrão.
// O raio NUNCA afrouxa: ele é a fronteira da área atendida.

const bairros = [
  { bairro: 'Jardim Colorado', taxa: 5 },
  { bairro: 'São Geraldo', taxa: 6 },
]
const raios = [
  { ateKm: 3, taxa: 4 },
  { ateKm: 6, taxa: 8 },
]

describe('normalizarForaDaLista', () => {
  it('só aceita o valor explícito — NULL, lixo e undefined caem no modo seguro', () => {
    expect(normalizarForaDaLista('taxa_padrao')).toBe('taxa_padrao')
    expect(normalizarForaDaLista('bloquear')).toBe('bloquear')
    expect(normalizarForaDaLista(null)).toBe('bloquear')
    expect(normalizarForaDaLista(undefined)).toBe('bloquear')
    expect(normalizarForaDaLista('qualquer_coisa')).toBe('bloquear')
  })
})

describe('decidirFrete com frete_fora_da_lista', () => {
  it('sem o parâmetro, o comportamento é o de hoje: bairro fora da lista bloqueia', () => {
    const r = decidirFrete({ bairroCliente: 'Centro', bairros, raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r.entregavel).toBe(false)
  })

  describe("loja só com bairros (sem raio), modo 'taxa_padrao'", () => {
    const padrao = (bairroCliente: string) =>
      decidirFrete({ bairroCliente, bairros, raios: [], taxaPadrao: 10, distanciaKm: null, foraDaLista: 'taxa_padrao' as const })

    it('bairro fora da tabela passa a ser entregável pela taxa padrão', () => {
      expect(padrao('Centro')).toEqual({ entregavel: true, taxa: 10, fonte: 'padrao', distanciaKm: null })
    })

    it('bairro cadastrado continua com a taxa específica dele — a padrão não atropela', () => {
      expect(padrao('Jardim Colorado')).toEqual({ entregavel: true, taxa: 5, fonte: 'bairro', distanciaKm: null })
      expect(padrao('sao geraldo')).toEqual({ entregavel: true, taxa: 6, fonte: 'bairro', distanciaKm: null })
    })

    it('bairro vazio também cai na taxa padrão (não há mais lista pra escolher)', () => {
      expect(padrao('')).toEqual({ entregavel: true, taxa: 10, fonte: 'padrao', distanciaKm: null })
    })

    it('taxa padrão zero é uma escolha válida — entrega grátis, não bloqueio', () => {
      const r = decidirFrete({ bairroCliente: 'Centro', bairros, raios: [], taxaPadrao: 0, distanciaKm: null, foraDaLista: 'taxa_padrao' })
      expect(r).toEqual({ entregavel: true, taxa: 0, fonte: 'padrao', distanciaKm: null })
    })
  })

  describe("loja com raio, modo 'taxa_padrao' — o raio continua sendo a fronteira", () => {
    const comRaio = (bairroCliente: string, distanciaKm: number | null) =>
      decidirFrete({ bairroCliente, bairros, raios, taxaPadrao: 10, distanciaKm, foraDaLista: 'taxa_padrao' as const })

    it('endereço confirmado dentro da faixa: vale a taxa da faixa, não a padrão', () => {
      expect(comRaio('Centro', 2)).toEqual({ entregavel: true, taxa: 4, fonte: 'raio', distanciaKm: 2 })
      expect(comRaio('Centro', 5.5)).toEqual({ entregavel: true, taxa: 8, fonte: 'raio', distanciaKm: 5.5 })
    })

    it('endereço fora da última faixa segue BLOQUEADO — não cai na taxa padrão', () => {
      const r = comRaio('Centro', 12)
      expect(r.entregavel).toBe(false)
      expect(r.taxa).toBe(0)
      expect(r.motivo).toMatch(/fora da área de entrega/i)
    })

    it('geocode falhou (distância desconhecida) segue BLOQUEADO — não dá pra provar que está na área', () => {
      const r = comRaio('Centro', null)
      expect(r.entregavel).toBe(false)
      expect(r.taxa).toBe(0)
      expect(r.motivo).toMatch(/localizar esse endereço/i)
    })

    it('bairro cadastrado continua entregável mesmo sem geocode', () => {
      expect(comRaio('Jardim Colorado', null)).toEqual({ entregavel: true, taxa: 5, fonte: 'bairro', distanciaKm: null })
    })
  })

  it("modo 'bloquear' com raio se comporta igual ao modo 'taxa_padrao' com raio", () => {
    for (const distancia of [2, 12, null]) {
      const bloquear = decidirFrete({ bairroCliente: 'Centro', bairros, raios, taxaPadrao: 10, distanciaKm: distancia, foraDaLista: 'bloquear' })
      const padrao = decidirFrete({ bairroCliente: 'Centro', bairros, raios, taxaPadrao: 10, distanciaKm: distancia, foraDaLista: 'taxa_padrao' })
      expect(padrao).toEqual(bloquear)
    }
  })

  it('loja sem bairro e sem raio ignora o modo — sempre taxa padrão', () => {
    for (const modo of ['bloquear', 'taxa_padrao'] as const) {
      const r = decidirFrete({ bairroCliente: 'Centro', bairros: [], raios: [], taxaPadrao: 9, distanciaKm: null, foraDaLista: modo })
      expect(r).toEqual({ entregavel: true, taxa: 9, fonte: 'padrao', distanciaKm: null })
    }
  })
})

// ── resolverFrete: é literalmente o que POST /api/loja/[slug]/frete devolve ───
// (a rota só resolve o slug e repassa o body). Fake do Supabase roteado por tabela.

function supabaseFrete(loja: Record<string, unknown>, bairrosDb: { bairro: string; taxa: number }[], raiosDb: { ate_km: number; taxa: number }[]) {
  const from = vi.fn((tabela: string) => {
    if (tabela === 'restaurantes') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: loja, error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }
    }
    if (tabela === 'taxas_entrega_bairro') {
      return { select: () => ({ eq: async () => ({ data: bairrosDb, error: null }) }) }
    }
    if (tabela === 'taxas_entrega_raio') {
      return { select: () => ({ eq: () => ({ order: async () => ({ data: raiosDb, error: null }) }) }) }
    }
    throw new Error(`tabela inesperada: ${tabela}`)
  })
  return { client: { from } as never }
}

const LOJA_BASE = { taxa_entrega_padrao: 7, latitude: -20.33, longitude: -40.29, cep: '29100500', endereco: 'Rua X, 10' }

describe('resolverFrete (resposta da API de frete)', () => {
  it('loja só com bairros no modo bloquear: bairro fora da tabela é recusado', async () => {
    const { client } = supabaseFrete({ ...LOJA_BASE, frete_fora_da_lista: 'bloquear' }, [{ bairro: 'Centro', taxa: 5 }], [])
    const r = await resolverFrete(client, 'r1', { bairro: 'Bairro Novo' })
    expect(r.entregavel).toBe(false)
    expect(r.motivo).toMatch(/não entrega nesse bairro/i)
  })

  it('loja só com bairros no modo taxa_padrao: bairro fora da tabela paga a taxa padrão', async () => {
    const { client } = supabaseFrete({ ...LOJA_BASE, frete_fora_da_lista: 'taxa_padrao' }, [{ bairro: 'Centro', taxa: 5 }], [])
    const r = await resolverFrete(client, 'r1', { bairro: 'Bairro Novo' })
    expect(r).toEqual({ entregavel: true, taxa: 7, fonte: 'padrao', distanciaKm: null })
  })

  it('bairro cadastrado continua com a taxa dele no modo taxa_padrao', async () => {
    const { client } = supabaseFrete({ ...LOJA_BASE, frete_fora_da_lista: 'taxa_padrao' }, [{ bairro: 'Centro', taxa: 5 }], [])
    const r = await resolverFrete(client, 'r1', { bairro: 'centro' })
    expect(r).toEqual({ entregavel: true, taxa: 5, fonte: 'bairro', distanciaKm: null })
  })

  it('coluna NULL (loja anterior à migration) se comporta como bloquear', async () => {
    const { client } = supabaseFrete({ ...LOJA_BASE, frete_fora_da_lista: null }, [{ bairro: 'Centro', taxa: 5 }], [])
    const r = await resolverFrete(client, 'r1', { bairro: 'Bairro Novo' })
    expect(r.entregavel).toBe(false)
  })

  it('com raio e sem chave de geocode, modo taxa_padrao NÃO destrava: segue recusado', async () => {
    const { client } = supabaseFrete({ ...LOJA_BASE, frete_fora_da_lista: 'taxa_padrao' }, [{ bairro: 'Centro', taxa: 5 }], [
      { ate_km: 5, taxa: 6 },
    ])
    // Sem mapsKey o geocode do cliente falha → distância desconhecida.
    const r = await resolverFrete(client, 'r1', { bairro: 'Bairro Novo', cep: '', rua: '', numero: '' })
    expect(r.entregavel).toBe(false)
    expect(r.taxa).toBe(0)
  })
})
