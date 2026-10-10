import { afterEach, describe, expect, it, vi } from 'vitest'
import { buscarCoordenadas, buscarRota, chaveConjunto, chaveRotaPedido, emLotes, idsAPedir, podePedirRota, ROTA_INTERVALO_MS, type CoordOuNada } from './cliente'

afterEach(() => { vi.unstubAllGlobals() })

describe('mapas no navegador: quando pedir coordenadas', () => {
  it('a chave do conjunto não depende da ordem nem de repetidos', () => {
    expect(chaveConjunto(['b', 'a', 'b'])).toBe('a,b')
    expect(chaveConjunto(['a', 'b'])).toBe(chaveConjunto(['b', 'a']))
  })
  it('só pede o que ainda não tem resposta — null também é resposta', () => {
    const conhecidos = new Map<string, CoordOuNada>([['a', { lat: 1, lng: 2 }], ['b', null]])
    expect(idsAPedir(['a', 'b', 'c', 'c'], conhecidos)).toEqual(['c'])
    expect(idsAPedir(['a', 'b'], conhecidos)).toEqual([])
  })
  it('lotes de 100', () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(i))
    expect(emLotes(ids, 100).map((l) => l.length)).toEqual([100, 100, 50])
  })
})

describe('mapas no navegador: rota', () => {
  it('mesmo conjunto de paradas: no máximo 1 pedido por minuto; conjunto novo: na hora', () => {
    expect(podePedirRota(null, 'p1', 1000)).toBe(true)
    expect(podePedirRota({ paradas: 'p1', em: 1000 }, 'p1', 1000 + ROTA_INTERVALO_MS - 1)).toBe(false)
    expect(podePedirRota({ paradas: 'p1', em: 1000 }, 'p1', 1000 + ROTA_INTERVALO_MS)).toBe(true)
    expect(podePedirRota({ paradas: 'p1', em: 1000 }, 'p2', 1001)).toBe(true)
  })
  it('chave da rota arredonda ~10 m (GPS tremendo não pede rota nova)', () => {
    expect(chaveRotaPedido({ lat: -20.33331, lng: -40.29001 }, [{ lat: -20.3, lng: -40.3 }]))
      .toBe(chaveRotaPedido({ lat: -20.33334, lng: -40.29004 }, [{ lat: -20.3, lng: -40.3 }]))
  })
})

describe('mapas no navegador: chamadas ao servidor', () => {
  it('coordenadas: o que não veio (ou veio inválido) vira null; erro do servidor = null para todos', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ coords: { a: { lat: 1, lng: 2 }, b: { lat: 'x' } } }), { status: 200 })))
    expect(await buscarCoordenadas(['a', 'b', 'c'])).toEqual({ a: { lat: 1, lng: 2 }, b: null, c: null })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    expect(await buscarCoordenadas(['a'])).toEqual({ a: null })
  })
  it('coordenadas: lista vazia não chama o servidor', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await buscarCoordenadas([])).toEqual({})
    expect(f).not.toHaveBeenCalled()
  })
  it('rota: sem paradas não chama; falha vira polyline null', async () => {
    const f = vi.fn(async () => { throw new Error('rede') })
    vi.stubGlobal('fetch', f)
    expect(await buscarRota({ lat: 0, lng: 0 }, [])).toEqual({ polyline: null })
    expect(f).not.toHaveBeenCalled()
    expect(await buscarRota({ lat: 0, lng: 0 }, [{ lat: 1, lng: 1 }])).toEqual({ polyline: null })
  })
})
