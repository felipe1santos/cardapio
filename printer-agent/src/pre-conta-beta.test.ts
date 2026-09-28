import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { snapshotReciboTeste } from '../../lib/impressao/recibo-teste'

const require = createRequire(import.meta.url)
type Sub = { s: string; valor?: string }
type Bloco = { t: string; s?: string; rotulo?: string; valor?: string; desc?: string; qtd?: string; total?: string; subs?: Sub[]; linhas?: { s: string }[]; qr?: { linhas: string[]; icone: string } | null; nome?: string; telefone?: string; endereco?: string }
type Doc = { versao: number; modelo: string; teste: boolean; loja: string; blocos: Bloco[] }
const { montarPreContaBeta, textoDoDocumento } = require('./pre-conta-beta.js') as {
  montarPreContaBeta: (s: unknown) => Doc
  textoDoDocumento: (d: Doc) => string
}
const { CONTAS } = require('../test/fixtures-pre-conta.cjs') as { CONTAS: Record<string, Record<string, unknown>> }

const par = (d: Doc, r: string) => d.blocos.find((b) => b.t === 'par' && b.rotulo === r)?.valor
const total = (d: Doc) => d.blocos.find((b) => b.t === 'total')
const linhas = (d: Doc) => d.blocos.filter((b) => b.t === 'linha').map((b) => b.s)
const centavos = (s: string) => Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100)
const QR = { origem: 'cardapio', url: 'https://app.menuzia.com.br/loja/x', tamanho: 21, linhas: Array.from({ length: 21 }, () => '1'.repeat(21)) }
const LOJA = { nome: 'Pizza do Rosa', telefone: '(27) 99999-0000', endereco: 'Avenida Nossa Senhora da Penha, 1500' }
const destino = { loja: 'Pizza do Rosa', impressora: 'Caixa', nomeSistema: 'POS-80', computador: 'PC', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 }

describe('Pré-conta do Beta — modelo docs/referencias/impressao/v3/PRE-CONTA.png', () => {
  it('ordem do modelo: logo, PRE-CONTA, mesa/cliente/data, ITENS CONSUMIDOS, tabela, VALORES, A PAGAR entre tracejados, QR, loja', () => {
    const d = montarPreContaBeta({ ...CONTAS.mesa, qr: QR, loja_dados: LOJA })
    expect(d.versao).toBe(4)
    expect(d.modelo).toBe('pre_conta')
    expect(d.blocos.map((b) => b.t)).toEqual([
      'logo', 'titulo', 'linha', 'linha', 'faixa', 'tabela_cab', 'tracejado',
      'tabela_item', 'tabela_item', 'tabela_item',
      'faixa', 'par', 'par', 'par', 'par', 'par', 'tracejado', 'total', 'tracejado', 'rodape_qr', 'tracejado', 'loja', 'tracejado',
    ])
    expect(d.blocos.find((b) => b.t === 'tabela_cab')).toMatchObject({ qtd: 'QTD', desc: 'DESCRICAO', total: 'TOTAL (R$)' })
    expect(d.blocos.find((b) => b.t === 'loja')).toMatchObject({ nome: 'PIZZA DO ROSA', telefone: '(27) 99999-0000', endereco: LOJA.endereco })
  })

  it('topo só com mesa (ou balcão), cliente e data/hora — sem pedido, telefone nem endereço', () => {
    expect(linhas(montarPreContaBeta(CONTAS.mesa))).toEqual(['Mesa Varanda 02', '23/09/2026 19:40'])
    expect(linhas(montarPreContaBeta(CONTAS.balcao))).toEqual(['Balcao - Senha 128', 'Cliente: João', '23/09/2026 19:40 - 2a via'])
    expect(linhas(montarPreContaBeta({ ...CONTAS.mesa, mesa: '07' }))[0]).toBe('Mesa 07')
  })

  it('coluna TOTAL (R$) só com o número; cada adicional com o seu valor; a coluna soma o Subtotal', () => {
    const s = snapshotReciboTeste(destino, 'Op')
    const d = montarPreContaBeta(s)
    const itens = d.blocos.filter((b) => b.t === 'tabela_item')
    expect(itens.map((b) => [b.qtd, b.desc, b.total])).toEqual([
      ['1', 'PIZZA GRANDE CALABRESA', '59,90'], ['2', 'PIZZA MÉDIA MARGUERITA', '89,80'], ['1', 'BATATA FRITA', '28,00'], ['1', 'COCA-COLA 2 L', '14,00'], ['3', 'SUCO DE LARANJA 500 ML', '27,00'],
    ])
    expect(itens[0]!.subs).toEqual([{ s: '+ Borda recheada de catupiry', valor: '12,00' }, { s: '+ Bacon extra', valor: '8,00' }, { s: 'Obs.: Sem cebola' }])
    const soma = itens.reduce((t, b) => t + centavos(b.total!) + (b.subs ?? []).reduce((u, x) => u + (x.valor ? centavos(x.valor) : 0), 0), 0)
    expect(soma).toBe(25070)
    expect(par(d, 'Subtotal')).toBe('R$ 250,70')
  })

  it('valores com R$: subtotal, taxa de serviço, taxa manual, entrega, desconto e, com pagamento parcial, A PAGAR = restante', () => {
    const d = montarPreContaBeta({ ...CONTAS.mesa, taxa_extra: 15, taxa_extra_nome: 'Couvert', taxa_entrega: 8 })
    expect(d.blocos.filter((b) => b.t === 'par').map((b) => b.rotulo)).toEqual(['Subtotal', 'Taxa de serviço', 'Couvert', 'Taxa de entrega', 'Desconto', 'Total da conta', 'Já pago'])
    expect(par(d, 'Desconto')).toBe('- R$ 12,50')
    expect(par(d, 'Já pago')).toBe('- R$ 60,00')
    expect(total(d)).toMatchObject({ rotulo: 'A PAGAR', valor: 'R$ 100,09' })
    expect(total(montarPreContaBeta(CONTAS.balcao))).toMatchObject({ rotulo: 'TOTAL', valor: 'R$ 76,90' })
    expect(total(montarPreContaBeta(CONTAS.milhar))?.valor).toBe('R$ 4.088,00')
  })

  it('rodapé: frase do QR e "Sistema Menuzia"; Instagram com o @; sem QR, só o nome do sistema', () => {
    const r = (s: Record<string, unknown>) => montarPreContaBeta(s).blocos.find((b) => b.t === 'rodape_qr')!
    expect(r({ ...CONTAS.mesa, qr: QR }).linhas!.map((l) => l.s)).toEqual(['Peça de novo pelo nosso cardápio', '', 'Sistema Menuzia'])
    expect(r({ ...CONTAS.mesa, qr: { ...QR, origem: 'instagram', url: 'https://instagram.com/loja' } }).linhas!.map((l) => l.s)).toEqual(['Siga a gente no Instagram', '@loja', '', 'Sistema Menuzia'])
    expect(r(CONTAS.mesa).qr).toBeNull()
  })

  it('conta real NUNCA imprime telefone nem endereço do cliente, nem as marcas de teste', () => {
    const d = montarPreContaBeta({ ...CONTAS.mesa, cliente_telefone: '27999990000', endereco: { rua: 'Rua X', numero: '1' }, observacao: 'interno' })
    const t = textoDoDocumento(d)
    for (const x of ['27999990000', 'Rua X', 'interno', 'TESTE DE IMPRESSAO']) expect(t).not.toContain(x)
    expect(d.blocos.some((b) => b.t === 'marcas')).toBe(false)
  })
})

describe('Pré-conta do Beta — teste (mesmo montador)', () => {
  it('mesmo modelo da conta real, com aviso no topo, aviso SEM VALOR FISCAL no fim e marcas', () => {
    const d = montarPreContaBeta(snapshotReciboTeste(destino, 'Op'))
    expect(d.teste).toBe(true)
    expect(d.blocos.at(-1)!.t).toBe('marcas')
    const t = textoDoDocumento(d)
    expect(t).toContain('TESTE DE IMPRESSAO - PEDIDO DE DEMONSTRACAO')
    expect(t).toContain('TESTE DE IMPRESSAO - SEM VALOR FISCAL')
    expect(linhas(d)[0]).toBe('Mesa 34')
    expect(linhas(d)[1]).toBe('Cliente: Maria')
    expect(total(d)).toMatchObject({ rotulo: 'A PAGAR', valor: 'R$ 148,70' })
  })
})
