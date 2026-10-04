import { describe, expect, it } from 'vitest'
import { PADRAO_FECHAMENTO, exigenciasDoFechamento, type SituacaoFechamento } from './fechamento-regras'

const limpo: SituacaoFechamento = { diferencaDinheiro: 0, diferencaCartao: 0, motoboysSemAcerto: 0, entreguesNaoPagos: 0, pixAConferirCentavos: 0, comandasAbertas: 0, comandasAbertasCentavos: 0 }
const ex = (s: Partial<SituacaoFechamento>, papel = 'atendente') => exigenciasDoFechamento({ ...limpo, ...s }, PADRAO_FECHAMENTO, papel)

describe('regras de PIN no fechamento (provisórias)', () => {
  it('tudo batendo: fecha sem nada', () => {
    expect(ex({})).toEqual({ justificativa: false, pin: false, motivos: [], pixParaODono: false })
  })
  it('diferença até a tolerância (R$ 2,00): só justificativa', () => {
    expect(ex({ diferencaDinheiro: -200 })).toMatchObject({ justificativa: true, pin: false, motivos: ['diferenca_dinheiro'] })
  })
  it('diferença acima da tolerância: PIN', () => {
    expect(ex({ diferencaDinheiro: 201 })).toMatchObject({ justificativa: true, pin: true, motivos: ['diferenca_dinheiro_acima'] })
  })
  it('maquininha: justificativa; acima da tolerância, PIN', () => {
    expect(ex({ diferencaCartao: 150 })).toMatchObject({ pin: false, motivos: ['diferenca_cartao'] })
    expect(ex({ diferencaCartao: -500 })).toMatchObject({ pin: true, motivos: ['diferenca_cartao_acima'] })
  })
  it('motoboy sem acerto e entregue não pago: PIN', () => {
    expect(ex({ motoboysSemAcerto: 1 })).toMatchObject({ pin: true, motivos: ['motoboy_sem_acerto'] })
    expect(ex({ entreguesNaoPagos: 2 })).toMatchObject({ pin: true, motivos: ['entregue_nao_pago'] })
  })
  it('Pix a conferir não trava: vai para a lista do dono', () => {
    expect(ex({ pixAConferirCentavos: 5000 })).toEqual({ justificativa: false, pin: false, motivos: [], pixParaODono: true })
  })
  it('comanda aberta: justificativa; acima de R$ 100,00 em aberto, PIN', () => {
    expect(ex({ comandasAbertas: 1, comandasAbertasCentavos: 10000 })).toMatchObject({ pin: false, motivos: ['comandas_abertas'] })
    expect(ex({ comandasAbertas: 2, comandasAbertasCentavos: 10001 })).toMatchObject({ pin: true, motivos: ['comandas_abertas_acima'] })
  })
  it('o dono nunca precisa de PIN, mas justifica', () => {
    expect(ex({ diferencaDinheiro: 9999, motoboysSemAcerto: 1 }, 'dono')).toMatchObject({ justificativa: true, pin: false })
  })
  it('tolerância configurável por loja', () => {
    expect(exigenciasDoFechamento({ ...limpo, diferencaDinheiro: 450 }, { toleranciaCentavos: 500, limiteComandasCentavos: 10000 }, 'gerente').pin).toBe(false)
  })
})
