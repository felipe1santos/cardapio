import { describe, it, expect } from 'vitest'
import { montarPedidoPublico, CAMPOS_INTERNOS, chavePedidoPublico, QTD_MAX_POR_ITEM } from './pedido-publico'

const CORPO_HONESTO = {
  tipo: 'entrega',
  cliente: { nome: 'Maria', telefone: '5527999990000' },
  endereco: { rua: 'Rua A', numero: '10', complemento: '', bairro: 'Centro', cep: '29100000' },
  pagamento: 'dinheiro',
  trocoPara: 50,
  // A vitrine em produção manda este campo; o servidor recalcula e ignora.
  taxaEntrega: 7,
  itens: [{ itemId: 'i1', quantidade: 1 }],
}

describe('montarPedidoPublico', () => {
  it('aceita o corpo da vitrine e força origem cardapio', () => {
    const r = montarPedidoPublico(CORPO_HONESTO)
    expect(r.ok).toBe(true)
    expect(r.input?.origem).toBe('cardapio')
    expect(r.input?.cliente.nome).toBe('Maria')
    expect(r.input?.itens).toHaveLength(1)
  })

  it('não copia taxaEntrega para dentro da entrada', () => {
    const r = montarPedidoPublico(CORPO_HONESTO)
    expect((r.input as unknown as Record<string, unknown>).taxaEntrega).toBeUndefined()
  })

  it('recusa TODOS os campos internos, um a um', () => {
    for (const campo of CAMPOS_INTERNOS) {
      const r = montarPedidoPublico({ ...CORPO_HONESTO, [campo]: 'x' })
      expect(r.ok, `campo ${campo} deveria ser recusado`).toBe(false)
      expect(r.recusados).toContain(campo)
      expect(r.input).toBeUndefined()
    }
  })

  it('recusa a tentativa clássica: origem pdv para pular as checagens de canal', () => {
    const r = montarPedidoPublico({ ...CORPO_HONESTO, origem: 'pdv' })
    expect(r.ok).toBe(false)
    expect(r.recusados).toEqual(['origem'])
  })

  it('recusa canal, que é a fronteira da RLS entre salão e delivery', () => {
    expect(montarPedidoPublico({ ...CORPO_HONESTO, canal: 'mesa' }).ok).toBe(false)
  })

  it('recusa comanda e mesa', () => {
    expect(montarPedidoPublico({ ...CORPO_HONESTO, comandaId: 'c1' }).ok).toBe(false)
    expect(montarPedidoPublico({ ...CORPO_HONESTO, mesa: 'Mesa 1' }).ok).toBe(false)
  })

  it('recusa restaurante de outra loja', () => {
    expect(montarPedidoPublico({ ...CORPO_HONESTO, restauranteId: 'outra' }).ok).toBe(false)
  })

  it('recusa pago e status, que decidiriam dinheiro e fluxo', () => {
    expect(montarPedidoPublico({ ...CORPO_HONESTO, pago: true }).ok).toBe(false)
    expect(montarPedidoPublico({ ...CORPO_HONESTO, status: 'entregue' }).ok).toBe(false)
  })

  it('lista todos os campos internos presentes de uma vez', () => {
    const r = montarPedidoPublico({ ...CORPO_HONESTO, origem: 'pdv', canal: 'mesa', comandaId: 'c1' })
    expect(r.recusados.sort()).toEqual(['canal', 'comandaId', 'origem'])
  })

  it('normaliza tipo desconhecido para entrega', () => {
    expect(montarPedidoPublico({ ...CORPO_HONESTO, tipo: 'teleporte' }).input?.tipo).toBe('entrega')
    expect(montarPedidoPublico({ ...CORPO_HONESTO, tipo: 'retirada' }).input?.tipo).toBe('retirada')
  })

  it('corta texto longo e aguenta corpo malformado', () => {
    const r = montarPedidoPublico({ ...CORPO_HONESTO, cliente: { nome: 'x'.repeat(500), telefone: 1 } })
    expect(r.input?.cliente.nome).toHaveLength(120)
    expect(r.input?.cliente.telefone).toBe('')
    for (const lixo of [null, undefined, 'texto', 42, []]) {
      expect(() => montarPedidoPublico(lixo)).not.toThrow()
    }
    expect(montarPedidoPublico(null).ok).toBe(false)
  })

  it('cupom e prêmio continuam passando — são validados no servidor', () => {
    const r = montarPedidoPublico({ ...CORPO_HONESTO, cupomCodigo: 'BEMVINDO' })
    expect(r.input?.cupomCodigo).toBe('BEMVINDO')
  })
})

describe('pedido público: idempotência e quantidade (M24)', () => {
  it('chave da vitrine vira chave de idempotência com prefixo próprio', () => {
    const r = montarPedidoPublico({ ...CORPO_HONESTO, chavePedido: '6f1d2c3b-aaaa-4bbb-8ccc-123456789abc' })
    expect(r.ok).toBe(true)
    expect(r.input?.chaveIdempotencia).toBe('vitrine:6f1d2c3b-aaaa-4bbb-8ccc-123456789abc')
  })

  it('sem chave ou chave malformada: pedido segue, sem idempotência', () => {
    expect(montarPedidoPublico(CORPO_HONESTO).input?.chaveIdempotencia).toBeUndefined()
    for (const ruim of ['curta', 'x'.repeat(65), 'com espaço aqui 1234567', "';drop--123456789", 123, null]) {
      expect(chavePedidoPublico(ruim), String(ruim)).toBeNull()
    }
  })

  it('o campo interno chaveIdempotencia continua recusado (não dá para escolher a chave da mesa)', () => {
    const r = montarPedidoPublico({ ...CORPO_HONESTO, chaveIdempotencia: 'mesa-123' })
    expect(r.ok).toBe(false)
    expect(r.recusados).toContain('chaveIdempotencia')
  })

  it('quantidade fora de 1..999, fracionada ou não numérica é recusada com mensagem', () => {
    for (const q of [0, -1, 1.5, QTD_MAX_POR_ITEM + 1, 3_000_000_000, Number.NaN, '2', null]) {
      const r = montarPedidoPublico({ ...CORPO_HONESTO, itens: [{ itemId: 'i1', quantidade: q }] })
      expect(r.ok, String(q)).toBe(false)
      expect(r.erro).toMatch(/1 a 999/)
    }
    expect(montarPedidoPublico({ ...CORPO_HONESTO, itens: [{ itemId: 'i1', quantidade: QTD_MAX_POR_ITEM }] }).ok).toBe(true)
  })
})
