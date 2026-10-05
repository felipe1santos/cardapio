import { describe, expect, it } from 'vitest'
import { resumoPorOrigem } from './dashboard-origem'

describe('origem das visitas e dos pedidos por canal', () => {
  const visitas = [
    { origem: 'Direto', visitas: 100 }, { origem: 'ig', visitas: 40 }, { origem: 'l.instagram.com', visitas: 10 },
    { origem: 'fb', visitas: 5 }, { origem: 'l.wl.co', visitas: 8 }, { origem: 'whatsapp', visitas: 2 }, { origem: 'trello.com', visitas: 1 },
  ]
  const pedidos = [
    { origemCanal: 'instagram', total: 50, status: 'entregue', origemVenda: 'vitrine' },
    { origemCanal: 'instagram', total: 30, status: 'recebido', origemVenda: 'vitrine' },
    { origemCanal: 'whatsapp', total: 20, status: 'entregue', origemVenda: 'vitrine' },
    { origemCanal: 'instagram', total: 999, status: 'cancelado', origemVenda: 'vitrine' },
    { origemCanal: 'direto', total: 10, status: 'aguardando_pagamento', origemVenda: 'vitrine' },
    { origemCanal: null, total: 15, status: 'entregue', origemVenda: 'vitrine' },
    { origemCanal: null, total: 70, status: 'entregue', origemVenda: 'pdv' },
  ]
  const r = resumoPorOrigem(visitas, pedidos)
  const de = (c: string) => r.linhas.find((l) => l.canal === c)!
  it('visitas somadas no canal certo (textos crus antigos inclusive)', () => {
    expect(de('direto').visitas).toBe(100)
    expect(de('instagram').visitas).toBe(50)
    expect(de('facebook').visitas).toBe(5)
    expect(de('whatsapp').visitas).toBe(10)
    expect(de('outros').visitas).toBe(1)
  })
  it('pedidos e faturamento: só vitrine, sem cancelado nem aguardando pagamento', () => {
    expect(de('instagram').pedidos).toBe(2)
    expect(de('instagram').faturamento).toBe(80)
    expect(de('whatsapp').pedidos).toBe(1)
    expect(r.semOrigem).toBe(1)
  })
  it('conversão = pedidos ÷ visitas; totais batem com a soma das linhas', () => {
    expect(de('instagram').conversao).toBeCloseTo(4, 5)
    expect(r.totais.visitas).toBe(r.linhas.reduce((s, l) => s + l.visitas, 0))
    expect(r.totais.pedidos).toBe(3)
    expect(r.totais.faturamento).toBe(100)
  })
  it('canal sem visita nem pedido não aparece; vazio fica vazio', () => {
    expect(r.linhas.find((l) => l.canal === 'qrcode')).toBeUndefined()
    expect(resumoPorOrigem([], []).linhas).toEqual([])
  })
})
