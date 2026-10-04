import { describe, expect, it } from 'vitest'
import {
  custoCompraNovo, linhasDaBaixa, linhasDoEstorno, montarDre, numerosDePedidoCitados, ocorrenciasAGerar, periodoAnterior,
  precisaAprovacaoBaixa, quantidadeNaBase, statusExibido, tipoDaBaixa, variacaoPct, vencimentoDaOcorrencia,
} from './contas-regras'

describe('recorrência', () => {
  it('mensal mantém o dia e cai no último dia do mês curto', () => {
    expect(vencimentoDaOcorrencia('2026-01-31', 'mensal', 1)).toBe('2026-02-28')
    expect(vencimentoDaOcorrencia('2026-01-31', 'mensal', 2)).toBe('2026-03-31')
    expect(vencimentoDaOcorrencia('2026-11-10', 'mensal', 2)).toBe('2027-01-10')
  })
  it('semanal soma 7 dias', () => {
    expect(vencimentoDaOcorrencia('2026-10-01', 'semanal', 2)).toBe('2026-10-15')
  })
  it('gera só o que falta até o horizonte, sem repetir', () => {
    expect(ocorrenciasAGerar({ raiz: '2026-09-05', recorrencia: 'mensal', ultimo: '2026-09-05', hoje: '2026-10-04' })).toEqual(['2026-10-05'])
    expect(ocorrenciasAGerar({ raiz: '2026-09-05', recorrencia: 'mensal', ultimo: '2026-09-05', hoje: '2026-10-05' })).toEqual(['2026-10-05', '2026-11-05'])
    expect(ocorrenciasAGerar({ raiz: '2026-09-05', recorrencia: 'mensal', ultimo: '2026-11-05', hoje: '2026-10-04' })).toEqual([])
    expect(ocorrenciasAGerar({ raiz: '2026-10-01', recorrencia: 'semanal', ultimo: '2026-10-01', hoje: '2026-10-04' })).toEqual(['2026-10-08'])
    expect(ocorrenciasAGerar({ raiz: '2026-10-01', recorrencia: 'nenhuma', ultimo: '2026-10-01', hoje: '2026-12-04' })).toEqual([])
  })
  it('série esquecida há anos gera no máximo o limite por vez', () => {
    expect(ocorrenciasAGerar({ raiz: '2020-01-01', recorrencia: 'semanal', ultimo: '2020-01-01', hoje: '2026-10-04' }).length).toBe(24)
  })
})

describe('status', () => {
  it('a pagar vencida aparece como vencida; paga não', () => {
    expect(statusExibido('a_pagar', '2026-10-03', '2026-10-04')).toBe('vencido')
    expect(statusExibido('a_pagar', '2026-10-04', '2026-10-04')).toBe('a_pagar')
    expect(statusExibido('pago', '2026-10-01', '2026-10-04')).toBe('pago')
  })
})

describe('baixa no livro-caixa', () => {
  const base = { valor: 15000, forma: 'pix' as const, categoriaId: 'c1', contaId: 'k1' }
  it('pagar pela empresa: −empresa / −resultado, tipo conta_pagar, categoria nos dados', () => {
    const l = linhasDaBaixa({ ...base, tipo: 'pagar', carteira: 'empresa', grupo: 'despesa' })
    expect(l.map((x) => [x.carteira, x.tipo, x.valorCentavos, x.forma])).toEqual([['empresa', 'conta_pagar', -15000, 'pix'], ['resultado', 'conta_pagar', -15000, 'pix']])
    expect(l[1].dados).toMatchObject({ categoria_id: 'c1', conta_id: 'k1' })
  })
  it('pagar com dinheiro do caixa vira movimentação do turno (despesa; compra se for insumo)', () => {
    expect(linhasDaBaixa({ ...base, tipo: 'pagar', carteira: 'gaveta', grupo: 'despesa' }).map((x) => [x.carteira, x.tipo, x.valorCentavos, x.forma]))
      .toEqual([['gaveta', 'despesa', -15000, 'dinheiro'], ['resultado', 'despesa', -15000, 'dinheiro']])
    expect(tipoDaBaixa('pagar', 'gaveta', 'insumo')).toBe('compra')
  })
  it('receber: +carteira / +resultado', () => {
    expect(linhasDaBaixa({ ...base, tipo: 'receber', carteira: 'empresa', grupo: 'receita' }).map((x) => x.valorCentavos)).toEqual([15000, 15000])
  })
  it('estorno troca o sinal e aponta a original', () => {
    const e = linhasDoEstorno([{ id: 7, carteira: 'empresa', tipo: 'conta_pagar', valor_centavos: -15000, forma: 'pix', dados: { categoria_id: 'c1' } }])
    expect(e[0]).toMatchObject({ carteira: 'empresa', tipo: 'conta_pagar', valorCentavos: 15000, referenciaId: 7, dados: { categoria_id: 'c1', estorno: true } })
  })
  it('aprovação: só saída acima do limite; dono e recebimento nunca', () => {
    const lim = { limiteSaida: 10000, limiteConta: 100000 }
    expect(precisaAprovacaoBaixa({ ...lim, tipo: 'pagar', carteira: 'gaveta', valor: 10001, papel: 'gerente' })).toBe(true)
    expect(precisaAprovacaoBaixa({ ...lim, tipo: 'pagar', carteira: 'gaveta', valor: 10000, papel: 'gerente' })).toBe(false)
    expect(precisaAprovacaoBaixa({ ...lim, tipo: 'pagar', carteira: 'empresa', valor: 50000, papel: 'gerente' })).toBe(false)
    expect(precisaAprovacaoBaixa({ ...lim, tipo: 'pagar', carteira: 'empresa', valor: 100001, papel: 'atendente' })).toBe(true)
    expect(precisaAprovacaoBaixa({ ...lim, tipo: 'pagar', carteira: 'empresa', valor: 9_000_000, papel: 'dono' })).toBe(false)
    expect(precisaAprovacaoBaixa({ ...lim, tipo: 'receber', carteira: 'gaveta', valor: 9_000_000, papel: 'atendente' })).toBe(false)
  })
})

describe('compra atualiza o custo do insumo', () => {
  const carne = { unidadeCompra: 'kg', quantidadeCompra: 1, basePorUnidade: 1000, unidadeBase: 'g', custoCompraCentavos: 3200, preparado: false }
  const pao = { unidadeCompra: 'pacote', quantidadeCompra: 1, basePorUnidade: 24, unidadeBase: 'un', custoCompraCentavos: 2400, preparado: false }
  it('converte para a unidade base (unidade de compra ou a própria base)', () => {
    expect(quantidadeNaBase(carne, 5, 'kg')).toBe(5000)
    expect(quantidadeNaBase(carne, 500, 'g')).toBe(500)
    expect(quantidadeNaBase(pao, 3, 'pacote')).toBe(72)
    expect(quantidadeNaBase(carne, 5, 'L')).toBeNull()
  })
  it('5 kg por R$ 180,00 → R$ 36,00 o kg; 3 pacotes por R$ 81,00 → R$ 27,00 o pacote', () => {
    expect(custoCompraNovo(carne, 5000, 18000)).toBe(3600)
    expect(custoCompraNovo(pao, 72, 8100)).toBe(2700)
  })
})

describe('DRE', () => {
  const categorias = [
    { id: 'alu', nome: 'Aluguel', grupo: 'despesa' as const }, { id: 'ins', nome: 'Insumos', grupo: 'insumo' as const },
    { id: 'ifd', nome: 'Repasse de marketplace (iFood)', grupo: 'receita' as const }, { id: 'apo', nome: 'Aporte do sócio', grupo: 'fora' as const },
  ]
  it('faturamento − CMV + outras receitas − despesas = lucro líquido; compras e aporte ficam fora', () => {
    const d = montarDre({
      faturamento: 100000, cmv: 30000, categorias,
      resultado: [
        { tipo: 'conta_pagar', categoriaId: 'alu', valorCentavos: -20000 },
        { tipo: 'conta_pagar', categoriaId: 'ins', valorCentavos: -15000 },
        { tipo: 'conta_receber', categoriaId: 'ifd', valorCentavos: 8000 },
        { tipo: 'conta_receber', categoriaId: 'apo', valorCentavos: 50000 },
        { tipo: 'despesa', categoriaId: null, valorCentavos: -1000 },
        { tipo: 'ajuste', categoriaId: null, valorCentavos: -300 },
      ],
    })
    expect(d.lucroBrutoCentavos).toBe(70000)
    expect(d.outrasReceitasCentavos).toBe(8000)
    expect(d.despesasCentavos).toBe(21300)
    expect(d.lucroLiquidoCentavos).toBe(56700)
    expect(d.comprasInsumosCentavos).toBe(15000)
    expect(d.foraDoResultadoCentavos).toBe(50000)
    expect(d.despesas.map((x) => x.nome)).toEqual(['Aluguel', 'Despesas pagas no caixa', 'Diferenças de caixa (sobras e faltas)'])
  })
  it('estorno some do DRE (linha oposta)', () => {
    const d = montarDre({ faturamento: 0, cmv: 0, categorias, resultado: [{ tipo: 'conta_pagar', categoriaId: 'alu', valorCentavos: -20000 }, { tipo: 'conta_pagar', categoriaId: 'alu', valorCentavos: 20000 }] })
    expect(d.despesas).toEqual([])
    expect(d.lucroLiquidoCentavos).toBe(0)
  })
  it('período anterior de mesmo tamanho e variação', () => {
    expect(periodoAnterior('2026-10-01', '2026-10-31')).toEqual({ de: '2026-08-31', ate: '2026-09-30' })
    expect(periodoAnterior('2026-10-04', '2026-10-04')).toEqual({ de: '2026-10-03', ate: '2026-10-03' })
    expect(variacaoPct(150, 100)).toBe(50)
    expect(variacaoPct(10, 0)).toBeNull()
  })
})

describe('venda do sistema lançada à mão', () => {
  it('acha "#123" no texto', () => {
    expect(numerosDePedidoCitados('Venda pedido #123 e # 45')).toEqual([123, 45])
    expect(numerosDePedidoCitados('Venda no evento')).toEqual([])
  })
})
