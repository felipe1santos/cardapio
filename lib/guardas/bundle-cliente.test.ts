import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * B6 (28/10/2026): módulo que entra no código do NAVEGADOR não pode puxar biblioteca só de servidor. A guarda de custo
 * (lib/custo/guarda.ts) entra na tela de Ajustes pelo frete; ao importar o envio de alertas (→ web-push → 'net') o build
 * do Coolify quebrou. tsc e vitest não pegam isso — só o `next build`. Aqui: segue os imports e procura os proibidos.
 */
const RAIZ = resolve(__dirname, '..', '..')
const PROIBIDOS = [/^web-push$/, /^ffmpeg-static$/, /^sharp$/, /^pg$/, /^node:(child_process|net|tls)$/]
const ENTRADAS = ['lib/frete.ts', 'lib/custo/guarda.ts', 'lib/geocode/geocodificar.ts']

function arquivo(base: string, spec: string): string | null {
  const alvo = spec.startsWith('@/') ? join(RAIZ, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(base), spec) : null
  if (!alvo) return null
  for (const c of [alvo, `${alvo}.ts`, `${alvo}.tsx`, join(alvo, 'index.ts')]) if (existsSync(c) && !c.endsWith('/')) { try { readFileSync(c); return c } catch { /* pasta */ } }
  return null
}

function proibidosAlcancados(entrada: string): string[] {
  const vistos = new Set<string>()
  const achados: string[] = []
  const fila = [join(RAIZ, entrada)]
  while (fila.length) {
    const f = fila.pop() as string
    if (vistos.has(f)) continue
    vistos.add(f)
    const src = readFileSync(f, 'utf8')
    // Só imports estáticos (import ... from / export ... from); `import type` não vai para o bundle.
    for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      const spec = m[1]
      if (PROIBIDOS.some((p) => p.test(spec))) achados.push(`${f.slice(RAIZ.length + 1)} → ${spec}`)
      const prox = arquivo(f, spec)
      if (prox) fila.push(prox)
    }
  }
  return achados
}

describe('B6: código do navegador sem biblioteca só de servidor', () => {
  for (const e of ENTRADAS) {
    it(`${e} não alcança web-push, ffmpeg, sharp, pg nem net`, () => {
      expect(proibidosAlcancados(e)).toEqual([])
    })
  }
})
