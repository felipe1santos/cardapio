import { describe, expect, it } from 'vitest'
import {
  barraProgresso, calcularCreditosDoPedido, montarBlocoCashbackGanho, montarMensagemProgresso, planejarConsumo, saldoDisponivel,
  valorCashbackAplicavel, type RegraCashback,
} from './cashback-regras'

/** Etapa 7 (20/10): cashback por item — quanto dá, quanto usa, de qual crédito tira, e as mensagens ao cliente. */
const agora = new Date('2026-10-20T15:00:00Z')
const regraValor: RegraCashback = { id: 'r1', itemId: 'burger', tipo: 'valor', valor: 2, validadeDias: 30, ativo: true }
const regraPct: RegraCashback = { id: 'r2', itemId: 'pizza', tipo: 'percentual', valor: 10, validadeDias: 7, ativo: true }

describe('créditos do pedido entregue', () => {
  it('R$ por unidade × quantidade; % sobre o valor da linha; validade a partir da entrega', () => {
    const c = calcularCreditosDoPedido([regraValor, regraPct], [
      { itemId: 'burger', nome: 'X-Burger', quantidade: 3, precoUnitario: 25 },
      { itemId: 'pizza', nome: 'Pizza G', quantidade: 1, precoUnitario: 59.9 },
    ], agora)
    expect(c).toEqual([
      { regraId: 'r1', itemNome: 'X-Burger', valor: 6, expiraEm: '2026-11-19T15:00:00.000Z' },
      { regraId: 'r2', itemNome: 'Pizza G', valor: 5.99, expiraEm: '2026-10-27T15:00:00.000Z' },
    ])
  })
  it('item sem regra, regra desligada, linha grátis (prêmio) ou sem item não geram nada', () => {
    const c = calcularCreditosDoPedido([{ ...regraValor, ativo: false }, regraPct], [
      { itemId: 'burger', nome: 'X-Burger', quantidade: 1, precoUnitario: 25 },
      { itemId: 'pizza', nome: 'Pizza — prêmio', quantidade: 1, precoUnitario: 0 },
      { itemId: null, nome: 'Avulso', quantidade: 1, precoUnitario: 10 },
      { itemId: 'coca', nome: 'Coca', quantidade: 2, precoUnitario: 6 },
    ], agora)
    expect(c).toEqual([])
  })
  it('cashback em R$ nunca passa do valor da linha', () => {
    const c = calcularCreditosDoPedido([{ ...regraValor, valor: 50 }], [{ itemId: 'burger', nome: 'Mini', quantidade: 1, precoUnitario: 12 }], agora)
    expect(c[0].valor).toBe(12)
  })
})

describe('saldo e aplicação no checkout', () => {
  const creditos = [
    { id: 'a', saldo: 4, expiraEm: '2026-10-25T00:00:00Z' },
    { id: 'b', saldo: 10, expiraEm: '2026-11-05T00:00:00Z' },
    { id: 'c', saldo: 3, expiraEm: '2026-10-01T00:00:00Z' }, // vencido
  ]
  it('soma só o que ainda vale e diz a próxima expiração', () => {
    expect(saldoDisponivel(creditos, agora)).toEqual({ saldo: 14, proximaExpiracao: '2026-10-25T00:00:00Z' })
  })
  it('usa no máximo o que sobrou do subtotal depois de cupom/prêmio; nunca o frete', () => {
    expect(valorCashbackAplicavel(14, 50, 0)).toBe(14)
    expect(valorCashbackAplicavel(14, 10, 0)).toBe(10)
    expect(valorCashbackAplicavel(14, 20, 15)).toBe(5)
    expect(valorCashbackAplicavel(14, 20, 25)).toBe(0)
  })
  it('consome primeiro o que expira antes e para quando cobre o valor', () => {
    const plano = planejarConsumo(creditos, 6, agora)
    expect(plano).toEqual({ usos: [{ id: 'a', usar: 4, saldoAntes: 4 }, { id: 'b', usar: 2, saldoAntes: 10 }], total: 6 })
  })
  it('saldo menor que o pedido: cobre o que dá', () => {
    expect(planejarConsumo(creditos, 100, agora).total).toBe(14)
  })
})

describe('mensagens ao cliente', () => {
  it('bloco de cashback ganho: valor, validade e saldo total quando já tinha', () => {
    const b = montarBlocoCashbackGanho([{ valor: 6, expiraEm: '2026-11-19T15:00:00Z' }], 20)
    expect(b).toContain('R$ 6,00 de cashback')
    expect(b).toContain('até 19/11')
    expect(b).toContain('Saldo total disponível: *R$ 20,00*')
    expect(montarBlocoCashbackGanho([], 0)).toBeNull()
  })
  it('barra de progresso em texto', () => {
    expect(barraProgresso(30)).toBe('▰▰▰▱▱▱▱▱▱▱ 30%')
    expect(barraProgresso(100)).toBe('▰▰▰▰▰▰▰▰▰▰ 100%')
  })
  it('"Ver meu progresso" traz cashback, prêmios, missões e cupons; sem nada, diz que cada pedido conta', () => {
    const m = montarMensagemProgresso({
      nomeLoja: 'Menuzia', nomeCliente: 'Ana Souza', linkCardapio: 'https://app.menuzia.com.br/loja/menuzia',
      cashback: { saldo: 14, proximaExpiracao: '2026-10-25T00:00:00Z' },
      campanhas: [{ faltaTexto: 'Faltam R$ 40,00', premioLabel: 'X-Burger grátis', percentual: 60 }],
      recompensas: [{ premioLabel: '10% de desconto', podeResgatarHoje: true }],
      cupons: [{ codigo: 'VOLTA10', descricao: '10% para voltar' }],
    })
    expect(m).toContain('SEU PROGRESSO NA MENUZIA')
    expect(m).toContain('Olá, _Ana_!')
    expect(m).toContain('Cashback disponível:* `R$ 14,00` (use até 24/10)')
    expect(m).toContain('- 10% de desconto')
    expect(m).toContain('Faltam R$ 40,00 para ganhar X-Burger grátis')
    expect(m).toContain('▰▰▰▰▰▰▱▱▱▱ 60%')
    expect(m).toContain('`VOLTA10` — 10% para voltar')
    expect(m).toContain('*Fazer um pedido:* https://app.menuzia.com.br/loja/menuzia')
    const vazio = montarMensagemProgresso({ nomeLoja: 'Menuzia', linkCardapio: 'x', cashback: null, campanhas: [], recompensas: [], cupons: [] })
    expect(vazio).toContain('Cada pedido entregue conta')
  })
})
