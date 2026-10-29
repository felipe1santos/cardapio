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

  it('alarme do Assistente (12/10): pedido aceito durante a espera → devolve na hora (vazio), sem esperar os 20 s', async () => {
    let aceito = false
    const t = Date.now()
    setTimeout(() => { aceito = true; _avisarParaTeste('loja-7') }, 100)
    const r = await esperarComBusca('loja-7', 20, undefined, async () => [], async () => true, async () => aceito)
    expect(r).toEqual([])
    expect(Date.now() - t).toBeLessThan(2500)
  })

  it('alarme: a contagem JÁ mudou antes de esperar (aceitaram enquanto imprimia) → devolve na hora (teste real #292: 21 s)', async () => {
    const t = Date.now()
    const r = await esperarComBusca('loja-8', 20, undefined, async () => [], async () => true, async () => true)
    expect(r).toEqual([])
    expect(Date.now() - t).toBeLessThan(500)
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

  it('um aviso sem novidade chama aindaVale 1 vez e buscar até 3 vezes', async () => {
    let buscas = 0
    let conferencias = 0
    const ctl = new AbortController()
    setTimeout(() => _avisarParaTeste('loja-13'), 50)
    // Depois das buscas de 0,4 s e 1,2 s (≈1,25 s), antes do próximo prazo de 2 s do modo sem Realtime.
    setTimeout(() => ctl.abort(), 1600)
    const r = await esperarComBusca('loja-13', 20, ctl.signal, async () => { buscas++; return [] }, async () => { conferencias++; return true })
    expect(r).toEqual([])
    expect(conferencias).toBe(1)
    expect(buscas).toBe(1 + 3) // a primeira (antes de esperar) + 3 depois do aviso
  })

  it('aindaVale false no aviso → devolve [] e não chama buscar', async () => {
    let buscas = 0
    let vale = true
    setTimeout(() => { vale = false; _avisarParaTeste('loja-14') }, 50)
    const r = await esperarComBusca('loja-14', 20, undefined, async () => { buscas++; return buscas > 1 ? ['ficha'] : [] }, async () => vale)
    expect(r).toEqual([])
    expect(buscas).toBe(1) // só a primeira, antes de esperar
  })

  it('dono muda durante a espera → nada é reservado para o antigo', async () => {
    let dono = 'pc-antigo'
    const reservadas: string[] = []
    setTimeout(() => { dono = 'pc-novo'; _avisarParaTeste('loja-15') }, 50)
    const r = await esperarComBusca('loja-15', 20, undefined,
      async () => { if (dono !== 'pc-antigo') reservadas.push('ficha'); return dono !== 'pc-antigo' ? ['ficha'] : [] },
      async () => dono === 'pc-antigo')
    expect(r).toEqual([])
    expect(reservadas).toEqual([])
  })

  it('dono muda DEPOIS da 1ª busca pós-aviso (janela de 0,4/1,2 s) → nada é reservado para o antigo', async () => {
    let buscas = 0
    let conferencias = 0
    const reservadas: string[] = []
    setTimeout(() => _avisarParaTeste('loja-16'), 50)
    const r = await esperarComBusca('loja-16', 20, undefined,
      // Os itens "chegam" depois da 1ª busca pós-aviso: dali em diante a busca reservaria a ficha.
      async () => { buscas++; if (buscas >= 3) { reservadas.push('ficha'); return ['ficha'] } return [] },
      // Dono na 1ª conferência (pós-aviso); a Cozinha muda de computador logo depois.
      async () => ++conferencias === 1,
      undefined, 'pedidos',
      async () => buscas >= 2)
    expect(r).toEqual([])
    expect(reservadas).toEqual([])
  })

  it('re-busca sem novidade não chama aindaVale nem buscar', async () => {
    let buscas = 0
    let conferencias = 0
    let novidades = 0
    const ctl = new AbortController()
    setTimeout(() => _avisarParaTeste('loja-17'), 50)
    setTimeout(() => ctl.abort(), 1600)
    const r = await esperarComBusca('loja-17', 20, ctl.signal, async () => { buscas++; return [] },
      async () => { conferencias++; return true }, undefined, 'pedidos', async () => { novidades++; return false })
    expect(r).toEqual([])
    expect(buscas).toBe(2) // a primeira (antes de esperar) + a 1ª depois do aviso
    expect(conferencias).toBe(1)
    expect(novidades).toBe(2) // +0,4 s e +1,2 s: só a conferência barata
  })

  it('aviso de pedido não acorda espera de trabalhos', async () => {
    const t = Date.now()
    setTimeout(() => _avisarParaTeste('loja-9', 'pedidos'), 50)
    const r = await esperarNovidade('loja-9', 300, undefined, 'trabalhos')
    expect(r).toBe('prazo')
    expect(Date.now() - t).toBeGreaterThanOrEqual(280)
  })

  it('INSERT de trabalho não acorda espera de pedidos', async () => {
    const t = Date.now()
    setTimeout(() => _avisarParaTeste('loja-10', 'trabalhos'), 50)
    const r = await esperarNovidade('loja-10', 300)
    expect(r).toBe('prazo')
    expect(Date.now() - t).toBeGreaterThanOrEqual(280)
  })

  it('aviso de trabalho acorda a espera de trabalhos (pré-conta sai na hora)', async () => {
    let fila: string[] = []
    const t = Date.now()
    setTimeout(() => { fila = ['pre-conta']; _avisarParaTeste('loja-11', 'trabalhos') }, 150)
    const r = await esperarComBusca('loja-11', 20, undefined, async () => fila, undefined, undefined, 'trabalhos')
    expect(r).toEqual(['pre-conta'])
    expect(Date.now() - t).toBeLessThan(1000)
  })

  it('sem Realtime, a espera de trabalhos ainda confere o banco a cada ≤2 s', async () => {
    let n = 0
    const t = Date.now()
    const r = await esperarComBusca('loja-12', 20, undefined, async () => { n++; return n >= 2 ? ['teste'] : [] }, undefined, undefined, 'trabalhos')
    expect(r).toEqual(['teste'])
    expect(Date.now() - t).toBeLessThan(2600)
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
