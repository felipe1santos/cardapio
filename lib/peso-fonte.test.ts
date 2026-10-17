import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Regra 6 (item 58, 2026-10-07): peso de fonte no máximo 600 em TODO o sistema. Falha se algum
 * arquivo de tela usar font-bold / font-extrabold / font-black, font-[700+], fontWeight 700+ ou
 * font-weight 700+ (CSS, fora do @font-face).
 * Fora da regra: o papel impresso (folha do QR Code; a impressão térmica fica no printer-agent,
 * que não é varrido) e a tela "Despacho de rotas", cujo design não muda (regra 4).
 */
const RAIZ = join(__dirname, '..')
const PASTAS = ['app', 'components', 'lib']
export const FORA_DA_REGRA = [
  'components/admin/qr-cardapio-folha.tsx',
  'lib/previa-loja.ts', // imagem de compartilhamento (não é tela)
  ...DESPACHO_DE_ROTAS(),
]
function DESPACHO_DE_ROTAS(): string[] {
  return ['components/pedidos/rota-panel.tsx', 'components/pedidos/rota-map.tsx', 'components/maps/route-map.tsx']
}

function arquivos(dir: string): string[] {
  const out: string[] = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    const s = statSync(p)
    if (s.isDirectory()) { if (n !== 'node_modules' && !n.startsWith('.')) out.push(...arquivos(p)) }
    else if (/\.(tsx|ts|jsx|css)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p)
  }
  return out
}

const CLASSE = /(?<![\w-])(font-bold|font-extrabold|font-black|font-\[(7|8|9)00\])(?![\w-])/g
const JSX_PESO = /fontWeight\s*[:=]\s*\{?\s*['"]?(700|800|900|bold|bolder)\b/g
const SVG_PESO = /font-weight\s*=\s*["'](700|800|900|bold)["']/g
const CSS_PESO = /font-weight\s*:\s*(700|800|900|bold|bolder)\s*(;|!|\}|$)/g

describe('peso de fonte no máximo 600 (regra 6)', () => {
  it('nenhuma tela usa peso acima de 600', () => {
    const achados: string[] = []
    for (const pasta of PASTAS) {
      for (const f of arquivos(join(RAIZ, pasta))) {
        const rel = relative(RAIZ, f).split('\\').join('/')
        if (FORA_DA_REGRA.includes(rel)) continue
        let txt = readFileSync(f, 'utf8')
        if (f.endsWith('.css')) txt = txt.replace(/@font-face\s*\{[^}]*\}/g, '')
        const linhas = txt.split('\n')
        linhas.forEach((l, i) => {
          const regras = f.endsWith('.css') ? [CSS_PESO] : [CLASSE, JSX_PESO, SVG_PESO]
          for (const r of regras) {
            r.lastIndex = 0
            if (r.test(l)) achados.push(`${rel}:${i + 1}: ${l.trim().slice(0, 120)}`)
          }
        })
      }
    }
    expect(achados, achados.slice(0, 40).join('\n')).toEqual([])
  })
})
