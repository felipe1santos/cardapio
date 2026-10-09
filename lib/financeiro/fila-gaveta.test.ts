import { describe, expect, it } from 'vitest'
import { naFilaDaGaveta } from './fila-gaveta'

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('fila da gaveta', () => {
  it('duas saídas ao mesmo tempo: a segunda confere depois que a primeira gravou (só uma passa)', async () => {
    let gaveta = 20999
    const sangria = (valor: number) => naFilaDaGaveta('loja-a', async () => {
      const saldo = gaveta // conferir
      await espera(20) // ida ao banco
      if (valor > saldo) return 'gaveta_insuficiente'
      gaveta = saldo - valor // gravar
      return 'ok'
    })
    const r = await Promise.all([sangria(12599), sangria(12599)])
    expect(r.sort()).toEqual(['gaveta_insuficiente', 'ok'])
    expect(gaveta).toBe(8400)
  })
  it('lojas diferentes não esperam uma pela outra', async () => {
    const ordem: string[] = []
    await Promise.all([
      naFilaDaGaveta('lenta', async () => { await espera(40); ordem.push('lenta') }),
      naFilaDaGaveta('rapida', async () => { ordem.push('rapida') }),
    ])
    expect(ordem).toEqual(['rapida', 'lenta'])
  })
  it('erro numa saída não trava a fila', async () => {
    await expect(naFilaDaGaveta('x', async () => { throw new Error('falhou') })).rejects.toThrow('falhou')
    await expect(naFilaDaGaveta('x', async () => 'seguiu')).resolves.toBe('seguiu')
  })
})
