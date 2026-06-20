export interface Paleta { nome: string; primaria: string; dark: string; light: string; from: string }

export const PALETAS: Record<string, Paleta> = {
  azul:     { nome: 'Azul',      primaria: '#008fba', dark: '#006f96', light: '#E0F7FF', from: '#22D3EE' },
  laranja:  { nome: 'Laranja',   primaria: '#E8660A', dark: '#C25208', light: '#FFF0E0', from: '#FB923C' },
  vermelho: { nome: 'Vermelho',  primaria: '#DC2626', dark: '#B91C1C', light: '#FEE2E2', from: '#F87171' },
  preto:    { nome: 'Preto',     primaria: '#111827', dark: '#030712', light: '#F3F4F6', from: '#374151' },
  petroleo: { nome: 'Petróleo',  primaria: '#0F766E', dark: '#0A5955', light: '#CCFBF1', from: '#2DD4BF' },
  chumbo:   { nome: 'Chumbo',    primaria: '#374151', dark: '#1F2937', light: '#E5E7EB', from: '#6B7280' },
  ambar:    { nome: 'Âmbar',     primaria: '#B45309', dark: '#92400E', light: '#FEF3C7', from: '#FBBF24' },
  roxo:     { nome: 'Roxo',      primaria: '#7C3AED', dark: '#6D28D9', light: '#EDE9FE', from: '#A78BFA' },
  verde:    { nome: 'Verde',     primaria: '#16A34A', dark: '#15803D', light: '#DCFCE7', from: '#4ADE80' },
  rosa:     { nome: 'Rosa',      primaria: '#BE185D', dark: '#9D174D', light: '#FCE7F3', from: '#F472B6' },
}

export function temaCores(hex: string): Omit<Paleta, 'nome'> {
  const r = parseInt(hex.slice(1,3), 16)/255
  const g = parseInt(hex.slice(3,5), 16)/255
  const b = parseInt(hex.slice(5,7), 16)/255
  const max = Math.max(r,g,b), min = Math.min(r,g,b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d/(2-max-min) : d/(max+min)
    if (max === r) h = ((g-b)/d + (g<b ? 6:0)) / 6
    else if (max === g) h = ((b-r)/d + 2) / 6
    else h = ((r-g)/d + 4) / 6
  }
  const hsl = (hh: number, ss: number, ll: number) => {
    const c = (p: number, q: number, t: number) => {
      if (t<0) t+=1; if (t>1) t-=1
      if (t<1/6) return p+(q-p)*6*t
      if (t<1/2) return q
      if (t<2/3) return p+(q-p)*(2/3-t)*6
      return p
    }
    const q = ll<0.5 ? ll*(1+ss) : ll+ss-ll*ss
    const p2 = 2*ll-q
    const x = (n: number) => Math.round(n*255).toString(16).padStart(2,'0')
    return `#${x(c(p2,q,hh+1/3))}${x(c(p2,q,hh))}${x(c(p2,q,hh-1/3))}`
  }
  return {
    primaria: hex,
    dark:  hsl(h, s, Math.max(0.05, l - 0.15)),
    from:  hsl(h, Math.min(1, s*0.8), Math.min(0.85, l + 0.15)),
    light: hsl(h, Math.min(0.5, s*0.35), 0.95),
  }
}

/** Resolve paleta a partir de chave (ex: 'azul') ou hex customizado (ex: '#FF5733'). */
export function resolverPaleta(corTema: string): Omit<Paleta, 'nome'> {
  if (corTema.startsWith('#')) return temaCores(corTema)
  return PALETAS[corTema] ?? PALETAS.azul
}
