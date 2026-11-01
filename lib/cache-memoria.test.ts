import { describe, expect, it } from 'vitest'
import { esquecer, lembrar } from './cache-memoria'

/**
 * Cache em memória com prazo (01/11/2026, Fase 3): o app do motoboy relia logo da loja, foto, status e módulo
 * financeiro a cada 10 s — dados que mudam uma vez por mês. Guardar por alguns minutos corta 4 consultas por leitura.
 * O app roda num container só; o que precisar invalidar chama `esquecer`.
 */
describe('lembrar / esquecer', () => {
  it('calcula na primeira vez, devolve o guardado dentro do prazo e recalcula depois', async () => {
    const mapa = new Map<string, { valor: number; ate: number }>()
    let n = 0
    const calc = async () => ++n
    expect(await lembrar(mapa, 'a', 1000, 0, calc)).toBe(1)
    expect(await lembrar(mapa, 'a', 1000, 999, calc)).toBe(1)
    expect(await lembrar(mapa, 'a', 1000, 1000, calc)).toBe(2)
  })
  it('esquecer força recalcular; chaves diferentes não se misturam', async () => {
    const mapa = new Map<string, { valor: string; ate: number }>()
    expect(await lembrar(mapa, 'x', 1000, 0, async () => 'x1')).toBe('x1')
    expect(await lembrar(mapa, 'y', 1000, 0, async () => 'y1')).toBe('y1')
    esquecer(mapa, 'x')
    expect(await lembrar(mapa, 'x', 1000, 1, async () => 'x2')).toBe('x2')
    expect(await lembrar(mapa, 'y', 1000, 1, async () => 'y2')).toBe('y1')
  })
  it('erro no cálculo não fica guardado', async () => {
    const mapa = new Map<string, { valor: number; ate: number }>()
    await expect(lembrar(mapa, 'a', 1000, 0, async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(await lembrar(mapa, 'a', 1000, 1, async () => 7)).toBe(7)
  })
})
