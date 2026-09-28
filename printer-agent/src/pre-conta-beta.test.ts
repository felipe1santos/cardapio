import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { snapshotReciboTeste } from '../../lib/impressao/recibo-teste'

const require = createRequire(import.meta.url)
type Bloco = { t: string; s?: string; rotulo?: string; valor?: string; desc?: string; qtd?: string; total?: string; subs?: string[]; linhas?: { s: string }[]; qr?: { linhas: string[]; icone: string } | null }
type Doc = { versao: number; modelo: string; teste: boolean; loja: string; blocos: Bloco[] }
const { montarPreContaBeta, textoDoDocumento } = require('./pre-conta-beta.js') as {
  montarPreContaBeta: (s: unknown) => Doc
  textoDoDocumento: (d: Doc) => string
}
const { CONTAS } = require('../test/fixtures-pre-conta.cjs') as { CONTAS: Record<string, Record<string, unknown>> }

const par = (d: Doc, r: string) => d.blocos.find((b) => b.t === 'par' && b.rotulo === r)?.valor
const total = (d: Doc) => d.blocos.find((b) => b.t === 'total')
const linhas = (d: Doc) => d.blocos.filter((b) => b.t === 'linha').map((b) => b.s)
const QR = { origem: 'instagram', url: 'https://instagram.com/loja', tamanho: 21, linhas: Array.from({ length: 21 }, () => '1'.repeat(21)) }

describe('Pré-conta do Beta — modelo docs/referencias/impressao/v2/PRE-CONTA.png', () => {
  it('ordem do modelo: logo, PRE-CONTA, mesa/pedido/data, faixa ITENS CONSUMIDOS, tabela, faixa VALORES, TOTAL entre tracejados, rodapé com QR', () => {
    const d = montarPreContaBeta({ ...CONTAS.mesa, pago: 0, restante: 160.09 })
    expect(d.versao).toBe(3)
    expect(d.modelo).toBe('pre_conta')
    expect(d.blocos.map((b) => b.t)).toEqual([
      'logo', 'titulo', 'linha', 'linha', 'linha', 'faixa', 'tabela_cab', 'tracejado',
      'tabela_item', 'tabela_item', 'tabela_item',
      'faixa', 'par', 'par', 'par', 'tracejado', 'total', 'tracejado', 'rodape_qr',
    ])
    expect(d.blocos.find((b) => b.t === 'titulo')?.s).toBe('PRE-CONTA')
    expect(d.blocos.filter((b) => b.t === 'faixa').map((b) => b.s)).toEqual(['ITENS CONSUMIDOS', 'VALORES'])
    expect(total(d)).toMatchObject({ rotulo: 'TOTAL', valor: 'R$ 160,09' })
  })

  it('cabeçalho centralizado: mesa (com ou sem a palavra "Mesa"), pedido e data/hora', () => {
    expect(linhas(montarPreContaBeta(CONTAS.mesa))).toEqual(['Mesa Varanda 02', 'Pedido #57', '23/09/2026 19:40'])
    expect(linhas(montarPreContaBeta({ ...CONTAS.mesa, mesa: 'Mesa 01' }))[0]).toBe('Mesa 01')
    expect(linhas(montarPreContaBeta({ ...CONTAS.mesa, mesa: '07' }))[0]).toBe('Mesa 07')
  })

  it('tabela: QTD, DESCRICAO em maiúsculas e TOTAL com R$; adicionais e observação embaixo da descrição', () => {
    const itens = montarPreContaBeta(CONTAS.mesa).blocos.filter((b) => b.t === 'tabela_item')
    expect(itens[0]).toMatchObject({ qtd: '2', desc: 'X-BURGUER ARTESANAL COM QUEIJO COALHO GRELHADO E CEBOLA CARAMELIZADA', total: 'R$ 80,00' })
    expect(itens[0]!.subs).toEqual(['+ 2x Bacon', '+ Ovo', 'Obs.: Bem passado'])
    expect(itens[1]!.subs).toEqual(['Média - Calabresa / Frango com Catupiry', '+ Borda: Cheddar', '+ Massa: Fina'])
  })

  it('valores: subtotal, taxa de serviço, desconto e, com pagamento parcial, A PAGAR = restante', () => {
    const d = montarPreContaBeta(CONTAS.mesa)
    expect(par(d, 'Subtotal')).toBe('R$ 156,90')
    expect(par(d, 'Taxa de serviço')).toBe('R$ 15,69')
    expect(par(d, 'Desconto')).toBe('- R$ 12,50')
    expect(par(d, 'Total da conta')).toBe('R$ 160,09')
    expect(par(d, 'Ja pago')).toBe('- R$ 60,00')
    expect(total(d)).toMatchObject({ rotulo: 'A PAGAR', valor: 'R$ 100,09' })
    const b = montarPreContaBeta(CONTAS.balcao)
    expect(total(b)).toMatchObject({ rotulo: 'TOTAL', valor: 'R$ 76,90' })
    expect(par(b, 'Ja pago')).toBeUndefined()
    expect(par(b, 'Desconto')).toBeUndefined()
    expect(total(montarPreContaBeta(CONTAS.milhar))?.valor).toBe('R$ 4.088,00')
  })

  it('taxa manual da conta (0106) sai com o nome dela, entre serviço e desconto', () => {
    const d = montarPreContaBeta({ ...CONTAS.mesa, taxa_extra: 15, taxa_extra_nome: 'Couvert' })
    const rot = d.blocos.filter((b) => b.t === 'par').map((b) => b.rotulo)
    expect(rot.slice(0, 4)).toEqual(['Subtotal', 'Taxa de serviço', 'Couvert', 'Desconto'])
    expect(par(d, 'Couvert')).toBe('R$ 15,00')
    expect(par(montarPreContaBeta(CONTAS.mesa), 'Couvert')).toBeUndefined()
  })

  it('balcão: senha no lugar da mesa, o primeiro nome do cliente e a reimpressão marcada', () => {
    expect(linhas(montarPreContaBeta(CONTAS.balcao))).toEqual(['Balcao - Senha 128', 'Pedido #12', 'Cliente: João', '23/09/2026 19:40', '2a via'])
  })

  it('rodapé: texto da loja à esquerda e o QR (Instagram com ícone) à direita', () => {
    const r = montarPreContaBeta({ ...CONTAS.mesa, qr: QR }).blocos.at(-1)!
    expect(r.t).toBe('rodape_qr')
    expect(r.qr).toMatchObject({ icone: 'instagram' })
    expect(r.linhas!.map((l) => l.s)).toEqual(['Siga a gente no Instagram', '@loja', 'Sistema Menúzia'])
    expect(montarPreContaBeta(CONTAS.mesa).blocos.at(-1)!.qr).toBeNull()
  })

  it('conta real NUNCA imprime telefone, endereço, observação do pedido nem frete, mesmo vindo no snapshot', () => {
    const d = montarPreContaBeta({ ...CONTAS.mesa, cliente_telefone: '27999990000', endereco: { rua: 'Rua X', numero: '1' }, observacao: 'interno', taxa_entrega: 9 })
    const t = textoDoDocumento(d)
    for (const x of ['27999990000', 'Rua X', 'interno', 'Taxa de entrega']) expect(t).not.toContain(x)
    expect(d.blocos.some((b) => b.t === 'marcas')).toBe(false)
    expect(t).not.toContain('TESTE DE IMPRESSAO')
  })
})

describe('Pré-conta do Beta — teste (mesmo montador)', () => {
  const s = snapshotReciboTeste(
    { loja: 'Cantina', impressora: 'Caixa', nomeSistema: 'POS-80', computador: 'PC', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 },
    'Operador',
  )
  it('mesmo modelo da conta real, com marcas de borda, aviso de teste e os dados de teste', () => {
    const d = montarPreContaBeta(s)
    expect(d.teste).toBe(true)
    expect(d.blocos[0]!.t).toBe('marcas')
    expect(d.blocos.at(-1)!.t).toBe('marcas')
    const t = textoDoDocumento(d)
    expect(t).toContain('PRE-CONTA')
    expect(t).toContain('TESTE DE IMPRESSAO - PEDIDO DE DEMONSTRACAO')
    expect(t).toContain('TESTE DE IMPRESSAO - SEM VALOR FISCAL')
    expect(t).toContain('(27) 99999-0000')
    expect(par(d, 'Taxa de entrega')).toBe('R$ 25,00')
    expect(total(d)?.valor).toBe('R$ 3.088,00')
  })
})
