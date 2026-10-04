/**
 * Área suave de um bairro em volta dos pedidos dele (item 54): sem limite oficial gratuito de bairro para
 * todas as cidades, a área é a envoltória convexa dos pontos com uma folga em volta (≈ 150 m), para que um
 * bairro com 1 ou 2 pedidos ainda vire uma mancha discreta e não uma linha.
 */
export interface PontoLatLng { lat: number; lng: number }

/** Folga em graus (~150 m de latitude). */
export const FOLGA_GRAUS = 0.00135

/** Envoltória convexa (monotone chain), no sentido anti-horário, sem repetir o primeiro ponto. */
export function envoltoria(pts: PontoLatLng[]): PontoLatLng[] {
  const p = [...new Map(pts.map((x) => [`${x.lat.toFixed(7)},${x.lng.toFixed(7)}`, x])).values()].sort((a, b) => a.lng - b.lng || a.lat - b.lat)
  if (p.length <= 2) return p
  const cruz = (o: PontoLatLng, a: PontoLatLng, b: PontoLatLng) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng)
  const baixo: PontoLatLng[] = []
  for (const x of p) { while (baixo.length >= 2 && cruz(baixo[baixo.length - 2], baixo[baixo.length - 1], x) <= 0) baixo.pop(); baixo.push(x) }
  const cima: PontoLatLng[] = []
  for (const x of [...p].reverse()) { while (cima.length >= 2 && cruz(cima[cima.length - 2], cima[cima.length - 1], x) <= 0) cima.pop(); cima.push(x) }
  return [...baixo.slice(0, -1), ...cima.slice(0, -1)]
}

/** Área do bairro: cada pedido vira um pequeno círculo (12 pontos) de raio FOLGA e a área é a envoltória deles. */
export function areaDoBairro(pts: PontoLatLng[], folga = FOLGA_GRAUS): PontoLatLng[] {
  const ao: PontoLatLng[] = []
  for (const x of pts) {
    const cosLat = Math.cos((x.lat * Math.PI) / 180) || 1
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * 2 * Math.PI
      ao.push({ lat: x.lat + folga * Math.sin(a), lng: x.lng + (folga * Math.cos(a)) / cosLat })
    }
  }
  return envoltoria(ao)
}

/** Distância em km (haversine). */
export function distanciaKm(a: PontoLatLng, b: PontoLatLng): number {
  const r = (g: number) => (g * Math.PI) / 180
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/**
 * Endereço geocodificado longe demais da loja (homônimo em outra cidade) sai do mapa: sem isso, um único
 * erro de geocodificação afastava o zoom até sumirem as ruas. Sem a posição da loja, nada é descartado.
 */
export function pertoDaLoja<T extends PontoLatLng>(pts: T[], loja: PontoLatLng | null, raioKm = 30): T[] {
  return loja ? pts.filter((p) => distanciaKm(p, loja) <= raioKm) : pts
}

/**
 * Grupos de pedidos próximos (ligação simples: dois pedidos a até `distKm` ficam no mesmo grupo). Cada grupo
 * vira uma mancha própria — a área não vira um triângulo atravessando quarteirões de outro bairro.
 */
export function agruparProximos<T extends PontoLatLng>(pts: T[], distKm = 0.6): T[][] {
  const grupo = pts.map((_, i) => i)
  const raiz = (i: number): number => (grupo[i] === i ? i : (grupo[i] = raiz(grupo[i])))
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (distanciaKm(pts[i], pts[j]) <= distKm) grupo[raiz(i)] = raiz(j)
  const porRaiz = new Map<number, T[]>()
  pts.forEach((p, i) => { const r = raiz(i); porRaiz.set(r, [...(porRaiz.get(r) ?? []), p]) })
  return [...porRaiz.values()]
}

/** Núcleo do bairro: só os pedidos a até `raioKm` do ponto mediano (a área não vira uma faixa entre bairros). */
export function nucleoDoBairro(pts: PontoLatLng[], raioKm = 1.2): PontoLatLng[] {
  if (pts.length <= 2) return pts
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  const centro = { lat: med(pts.map((p) => p.lat)), lng: med(pts.map((p) => p.lng)) }
  const perto = pts.filter((p) => distanciaKm(p, centro) <= raioKm)
  return perto.length ? perto : pts
}
