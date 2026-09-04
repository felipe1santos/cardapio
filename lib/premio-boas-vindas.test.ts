import { describe, it, expect } from 'vitest'
import { assinaturaPremios, premioDeBoasVindas } from './premio-boas-vindas'
import type { FidelidadeCliente } from '@/lib/queries/fidelidade'

type Recompensa = FidelidadeCliente['recompensas'][number]
type Cupom = FidelidadeCliente['cuponsPublicos'][number]

function recompensa(over: Partial<Recompensa> = {}): Recompensa {
  return {
    id: 'r1',
    campanhaId: 'c1',
    campanhaNome: 'Fidelidade',
    premioTipo: 'item_gratis',
    premioValor: null,
    premioItemNome: 'X Burger',
    premioItemImagemUrl: null,
    diasSemanaResgate: [],
    podeResgatarHoje: true,
    ganhoEm: '2026-09-01',
    ...over,
  }
}

function cupom(over: Partial<Cupom> = {}): Cupom {
  return {
    id: 'k1',
    codigo: 'BEMVINDO10',
    descricao: '10% na primeira compra',
    tipo: 'desconto_percentual',
    valor: 10,
    valorMinimoPedido: null,
    validadeFim: null,
    ...over,
  }
}

function fidelidade(over: Partial<FidelidadeCliente> = {}): FidelidadeCliente {
  return { campanhas: [], recompensas: [], cuponsPublicos: [], ...over }
}

describe('premioDeBoasVindas', () => {
  it('não anuncia nada sem fidelidade carregada', () => {
    expect(premioDeBoasVindas(null)).toBeNull()
    expect(premioDeBoasVindas(fidelidade())).toBeNull()
  })

  it('anuncia o prêmio de fidelidade na frente do cupom', () => {
    const p = premioDeBoasVindas(fidelidade({ recompensas: [recompensa()], cuponsPublicos: [cupom()] }))
    expect(p?.origem).toBe('fidelidade')
    expect(p?.descricao).toBe('X Burger grátis')
    expect(p?.codigo).toBeUndefined()
  })

  it('ignora prêmio que não pode ser resgatado hoje', () => {
    const p = premioDeBoasVindas(fidelidade({ recompensas: [recompensa({ podeResgatarHoje: false })] }))
    expect(p).toBeNull()
  })

  it('cai no cupom público quando não há prêmio pra hoje', () => {
    const p = premioDeBoasVindas(
      fidelidade({ recompensas: [recompensa({ podeResgatarHoje: false })], cuponsPublicos: [cupom()] })
    )
    expect(p?.origem).toBe('cupom')
    expect(p?.codigo).toBe('BEMVINDO10')
    expect(p?.descricao).toBe('10% na primeira compra')
  })

  it('descreve cada tipo de benefício quando o cupom não tem descrição', () => {
    const semDescricao = (over: Partial<Cupom>) =>
      premioDeBoasVindas(fidelidade({ cuponsPublicos: [cupom({ descricao: '  ', ...over })] }))?.descricao

    expect(semDescricao({ tipo: 'entrega_gratis', valor: null })).toBe('Frete grátis')
    // O Intl separa "R$" do número com espaço não-quebrável — daí o regex.
    // O Intl separa "R$" do número com espaço não-quebrável — daí o \s no lugar do espaço.
    expect(semDescricao({ tipo: 'desconto_valor', valor: 12.5 })).toMatch(/^R\$\s12,50 de desconto$/)
    expect(semDescricao({ tipo: 'desconto_percentual', valor: 15 })).toBe('15% de desconto')
    expect(semDescricao({ tipo: 'item_gratis', valor: null, itemNome: 'Coca 350ml' })).toBe('Coca 350ml grátis')
    expect(semDescricao({ tipo: 'item_gratis', valor: null, itemNome: undefined })).toBe('Um item grátis')
  })

  it('descreve prêmio de frete grátis e de desconto', () => {
    const frete = premioDeBoasVindas(fidelidade({ recompensas: [recompensa({ premioTipo: 'entrega_gratis' })] }))
    expect(frete?.descricao).toBe('Frete grátis')

    const desconto = premioDeBoasVindas(
      fidelidade({ recompensas: [recompensa({ premioTipo: 'desconto_valor', premioValor: 8 })] })
    )
    expect(desconto?.descricao).toMatch(/^R\$\s8,00 de desconto$/)
  })
})

describe('assinaturaPremios', () => {
  it('muda quando entra um cupom novo', () => {
    const antes = assinaturaPremios(fidelidade({ cuponsPublicos: [cupom()] }))
    const depois = assinaturaPremios(fidelidade({ cuponsPublicos: [cupom(), cupom({ id: 'k2', codigo: 'FRETE0' })] }))
    expect(antes).not.toBe(depois)
  })

  it('não muda com a ordem e ignora prêmio indisponível hoje', () => {
    const a = assinaturaPremios(fidelidade({ recompensas: [recompensa(), recompensa({ id: 'r2' })] }))
    const b = assinaturaPremios(fidelidade({ recompensas: [recompensa({ id: 'r2' }), recompensa()] }))
    expect(a).toBe(b)

    const comIndisponivel = assinaturaPremios(
      fidelidade({ recompensas: [recompensa(), recompensa({ id: 'r3', podeResgatarHoje: false })] })
    )
    expect(comIndisponivel).toBe(assinaturaPremios(fidelidade({ recompensas: [recompensa()] })))
  })

  it('é vazia sem nada ativo', () => {
    expect(assinaturaPremios(null)).toBe('')
    expect(assinaturaPremios(fidelidade())).toBe('')
  })
})
