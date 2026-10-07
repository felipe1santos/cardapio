/**
 * Ordem das paradas e links de navegação do app do motoboy (item 59).
 *
 * A ordem sai da loja: a cada passo, a parada mais perto de onde ele está (vizinho mais próximo,
 * em linha reta). Pedido sem coordenada vai para o fim, na ordem em que chegou. É o bastante para
 * 2 a 10 entregas de bairro — e não depende de chamada paga ao Google.
 *
 * O link do Google Maps aceita até 9 pontos intermediários + o destino: com mais paradas, a rota
 * vira vários links em sequência (o próximo começa onde o anterior terminou). O Waze não aceita
 * várias paradas: vai uma por vez, pelo link de cada pedido.
 */
export interface Coord { lat: number; lng: number }
export interface Parada { id: string; endereco: string; coordenadas: Coord | null }

/** Google Maps: 9 intermediários + destino por link. */
export const PARADAS_POR_LINK = 10

function km(a: Coord, b: Coord): number {
  const r = (g: number) => (g * Math.PI) / 180
  const dLat = r(b.lat - a.lat)
  const dLng = r(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

const valida = (c: Coord | null | undefined): c is Coord => !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng)

export function ordenarParadas<T extends Parada>(loja: Coord | null, paradas: T[]): T[] {
  const com = paradas.filter((p) => valida(p.coordenadas))
  const sem = paradas.filter((p) => !valida(p.coordenadas))
  const ordem: T[] = []
  let aqui: Coord | null = valida(loja) ? loja : null
  const resto = [...com]
  while (resto.length) {
    let i = 0
    if (aqui) {
      let melhor = Infinity
      resto.forEach((p, j) => { const d = km(aqui!, p.coordenadas!); if (d < melhor) { melhor = d; i = j } })
    }
    const [p] = resto.splice(i, 1)
    ordem.push(p)
    aqui = p.coordenadas
  }
  return [...ordem, ...sem]
}

const ponto = (p: Parada) => (valida(p.coordenadas) ? `${p.coordenadas.lat},${p.coordenadas.lng}` : p.endereco)

/** Links do Google Maps para a rota inteira, na ordem dada (sem origem = onde o celular está). */
export function linksGoogleMaps(loja: Coord | null, paradas: Parada[]): string[] {
  const links: string[] = []
  let origem: string | null = valida(loja) ? `${loja.lat},${loja.lng}` : null
  for (let i = 0; i < paradas.length; i += PARADAS_POR_LINK) {
    const bloco = paradas.slice(i, i + PARADAS_POR_LINK)
    const destino = bloco[bloco.length - 1]
    const q = new URLSearchParams({ api: '1', travelmode: 'driving' })
    if (origem) q.set('origin', origem)
    q.set('destination', ponto(destino))
    if (bloco.length > 1) q.set('waypoints', bloco.slice(0, -1).map(ponto).join('|'))
    links.push(`https://www.google.com/maps/dir/?${q.toString()}`)
    origem = ponto(destino)
  }
  return links
}

export function linkWaze(p: Parada): string {
  return valida(p.coordenadas)
    ? `https://waze.com/ul?ll=${p.coordenadas.lat},${p.coordenadas.lng}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(p.endereco)}&navigate=yes`
}
