import { describe, it, expect } from 'vitest'
import { esperarComBusca, esperarNovidade, _avisarParaTeste } from './despertador'

// Sem SUPABASE no ambiente de teste: o canal não sobe e a espera cai no modo "checa a
// cada 2 s" — o aviso manual (_avisarParaTeste) faz o papel do Realtime.
describe('espera longa do Assistente (despertador)', () => {
  it('já tem trabalho: responde na hora, sem esperar', async () => {
    const t = Date.now()
    const r = await esperarComBusca('loja-1', 20, undefined, async () => ['job'])
    expect(r).toEqual(['job'])
    expect(Date.now() - t).toBeLessThan(100)
  })

  it('esperar=0 (Assistente antigo): uma busca só, resposta na hora', async () => {
    let n = 0
    const r = await esperarComBusca('loja-1', 0, undefined, async () => { n++; return [] })
    expect(r).toEqual([])
    expect(n).toBe(1)
  })

  it('acorda com o aviso da loja e busca de novo', async () => {
    let fila: string[] = []
    const t = Date.now()
    setTimeout(() => { fila = ['pre-conta']; _avisarParaTeste('loja-2') }, 150)
    const r = await esperarComBusca('loja-2', 20, undefined, async () => fila)
    expect(r).toEqual(['pre-conta'])
    expect(Date.now() - t).toBeLessThan(1000)
  })

  it('aviso de OUTRA loja não acorda esta', async () => {
    const t = Date.now()
    setTimeout(() => _avisarParaTeste('outra-loja'), 50)
    const r = await esperarNovidade('loja-3', 300)
    expect(r).toBe('prazo')
    expect(Date.now() - t).toBeGreaterThanOrEqual(280)
  })

  it('pedido antes dos itens: depois do aviso confere de novo logo em seguida', async () => {
    let chamadas = 0
    setTimeout(() => _avisarParaTeste('loja-4'), 50)
    const r = await esperarComBusca('loja-4', 20, undefined, async () => { chamadas++; return chamadas >= 3 ? ['comanda'] : [] })
    expect(r).toEqual(['comanda'])
    expect(chamadas).toBe(3)
  })

  it('a situação mudou durante a espera (loja saiu de Cozinha e Caixa): para e não busca mais', async () => {
    let buscas = 0
    let vale = true
    setTimeout(() => { vale = false; _avisarParaTeste('loja-6') }, 80)
    const r = await esperarComBusca('loja-6', 20, undefined, async () => { buscas++; return buscas > 1 ? ['ficha'] : [] }, async () => vale)
    expect(r).toEqual([])
    expect(buscas).toBe(1)
  })

  it('o Assistente desistiu (conexão caiu): para de esperar', async () => {
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), 100)
    const t = Date.now()
    const r = await esperarComBusca('loja-5', 20, ctl.signal, async () => [])
    expect(r).toEqual([])
    expect(Date.now() - t).toBeLessThan(1500)
  })
})
