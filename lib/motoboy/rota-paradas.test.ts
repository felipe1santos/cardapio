import { describe, expect, it } from 'vitest'
import { linksGoogleMaps, linkWaze, ordenarParadas, PARADAS_POR_LINK } from './rota-paradas'

const LOJA = { lat: -20.3, lng: -40.3 }
const p = (id: string, lat: number | null, lng = -40.3) => ({ id, endereco: `Rua ${id}, 1`, coordenadas: lat === null ? null : { lat, lng } })

describe('ordem da rota a partir da loja (item 59)', () => {
  it('vizinho mais próximo, saindo da loja', () => {
    const r = ordenarParadas(LOJA, [p('longe', -20.40), p('perto', -20.31), p('meio', -20.35)])
    expect(r.map((x) => x.id)).toEqual(['perto', 'meio', 'longe'])
  })
  it('sem coordenada vai para o fim, na ordem de chegada', () => {
    const r = ordenarParadas(LOJA, [p('semA', null), p('b', -20.32), p('semB', null)])
    expect(r.map((x) => x.id)).toEqual(['b', 'semA', 'semB'])
  })
  it('loja sem coordenada: começa pela primeira e segue a mais perto', () => {
    const r = ordenarParadas(null, [p('a', -20.40), p('b', -20.10), p('c', -20.39)])
    expect(r.map((x) => x.id)).toEqual(['a', 'c', 'b'])
  })
})

describe('links de navegação', () => {
  it('3 paradas = 1 link com origem na loja, 2 intermediários e o destino', () => {
    const [l, ...resto] = linksGoogleMaps(LOJA, [p('a', -20.31), p('b', -20.32), p('c', -20.33)])
    expect(resto).toHaveLength(0)
    const u = new URL(l)
    expect(u.searchParams.get('origin')).toBe('-20.3,-40.3')
    expect(u.searchParams.get('destination')).toBe('-20.33,-40.3')
    expect(u.searchParams.get('waypoints')).toBe('-20.31,-40.3|-20.32,-40.3')
  })
  it('respeita o limite do Google Maps: 12 paradas viram 2 links encadeados', () => {
    const ps = Array.from({ length: 12 }, (_, i) => p(`p${i}`, -20.31 - i / 100))
    const links = linksGoogleMaps(LOJA, ps)
    expect(links).toHaveLength(2)
    const a = new URL(links[0]); const b = new URL(links[1])
    expect(a.searchParams.get('waypoints')!.split('|')).toHaveLength(PARADAS_POR_LINK - 1)
    expect(b.searchParams.get('origin')).toBe(a.searchParams.get('destination'))
  })
  it('sem coordenada usa o endereço; Waze vai uma parada por vez', () => {
    const [l] = linksGoogleMaps(null, [p('x', null)])
    expect(new URL(l).searchParams.get('destination')).toBe('Rua x, 1')
    expect(new URL(l).searchParams.get('origin')).toBeNull()
    expect(linkWaze(p('y', -20.31))).toContain('ll=-20.31,-40.3')
  })
})
