import { describe, expect, it } from 'vitest'
import { areaDoBairro, envoltoria, FOLGA_GRAUS } from './mapa-bairros'

describe('área suave do bairro', () => {
  it('envoltória de um quadrado com ponto no meio: só os 4 cantos', () => {
    const h = envoltoria([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 }, { lat: 0.5, lng: 0.5 }])
    expect(h).toHaveLength(4)
    expect(h.some((p) => p.lat === 0.5)).toBe(false)
  })
  it('um pedido só vira uma mancha (polígono) com a folga em volta', () => {
    const a = areaDoBairro([{ lat: -20.33, lng: -40.29 }])
    expect(a.length).toBeGreaterThanOrEqual(10)
    const lats = a.map((p) => p.lat)
    expect(Math.max(...lats) - Math.min(...lats)).toBeCloseTo(2 * FOLGA_GRAUS, 5)
  })
  it('todos os pedidos ficam dentro da área', () => {
    const pts = [{ lat: -20.33, lng: -40.29 }, { lat: -20.335, lng: -40.285 }, { lat: -20.328, lng: -40.295 }]
    const a = areaDoBairro(pts)
    const dentro = (p: { lat: number; lng: number }) => {
      let c = false
      for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
        if ((a[i].lat > p.lat) !== (a[j].lat > p.lat) && p.lng < ((a[j].lng - a[i].lng) * (p.lat - a[i].lat)) / (a[j].lat - a[i].lat) + a[i].lng) c = !c
      }
      return c
    }
    expect(pts.every(dentro)).toBe(true)
  })
})

describe('pontos fora do lugar', () => {
  const loja = { lat: -20.33, lng: -40.29 } // Vila Velha
  it('descarta endereço geocodificado em outra cidade (> 30 km da loja)', async () => {
    const { pertoDaLoja } = await import('./mapa-bairros')
    const pts = [{ lat: -20.335, lng: -40.29 }, { lat: -23.55, lng: -46.63 } /* São Paulo */]
    expect(pertoDaLoja(pts, loja)).toEqual([pts[0]])
    expect(pertoDaLoja(pts, null)).toHaveLength(2)
  })
  it('pedidos próximos ficam numa mancha só; distantes, em manchas separadas', async () => {
    const { agruparProximos } = await import('./mapa-bairros')
    const pts = [{ lat: -20.33, lng: -40.29 }, { lat: -20.332, lng: -40.291 }, { lat: -20.345, lng: -40.29 }]
    const g = agruparProximos(pts)
    expect(g).toHaveLength(2)
    expect(g.map((x) => x.length).sort()).toEqual([1, 2])
    expect(agruparProximos([])).toEqual([])
  })
  it('núcleo do bairro ignora o ponto solto longe dos outros', async () => {
    const { nucleoDoBairro } = await import('./mapa-bairros')
    const pts = [{ lat: -20.33, lng: -40.29 }, { lat: -20.331, lng: -40.291 }, { lat: -20.332, lng: -40.289 }, { lat: -20.20, lng: -40.20 }]
    expect(nucleoDoBairro(pts)).toHaveLength(3)
  })
})
