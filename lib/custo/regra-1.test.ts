import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { verificarRegra1 } from '../../scripts/custo/regra-1.mjs'

/** REGRA Nº 1 (docs/REGRAS-DE-CUSTO.md): falha se algo novo chamar API paga fora da guarda ou expuser chave de servidor. */
describe('regra nº 1 no código de verdade', () => {
  it('nenhuma API paga fora de lib/custo|lib/geocode e nenhuma chave de servidor pública', () => {
    expect(verificarRegra1(process.cwd())).toEqual([])
  })
})

describe('regra nº 1 pega quem quebra', () => {
  const base = mkdtempSync(join(tmpdir(), 'regra1-'))
  afterAll(() => rmSync(base, { recursive: true, force: true }))
  const arq = (rel: string, txt: string) => { mkdirSync(join(base, rel, '..'), { recursive: true }); writeFileSync(join(base, rel), txt) }
  arq('components/mapa.tsx', "const g = new google.maps.Geocoder()\n")
  arq('app/api/x/route.ts', "await fetch(`https://maps.googleapis.com/maps/api/geocode/json?key=${k}`)\n")
  arq('lib/ia/bot.ts', "import OpenAI from 'openai'\nawait fetch('https://api.openai.com/v1/chat/completions')\n")
  arq('lib/x.ts', "const k = process.env.NEXT_PUBLIC_GOOGLE_MAPS_SERVER_KEY\n")
  arq('lib/geocode/ok.ts', "await fetch(`https://maps.googleapis.com/maps/api/geocode/json`)\n") // pasta liberada
  arq('lib/comentario.ts', '// aqui não usamos google.maps.Geocoder nem DirectionsService\n')
  arq('next.config.ts', "export default { env: { NEXT_PUBLIC_X: process.env.GOOGLE_MAPS_SERVER_KEY } }\n")
  const erros = verificarRegra1(base) as string[]
  it('Geocoder no navegador, fetch ao Google e OpenAI direto', () => {
    expect(erros.some((e) => e.startsWith('components/mapa.tsx'))).toBe(true)
    expect(erros.some((e) => e.startsWith('app/api/x/route.ts'))).toBe(true)
    expect(erros.filter((e) => e.startsWith('lib/ia/bot.ts')).length).toBeGreaterThanOrEqual(2)
  })
  it('chave de servidor em NEXT_PUBLIC (nome e next.config)', () => {
    expect(erros.some((e) => e.includes('NEXT_PUBLIC_GOOGLE_MAPS_SERVER_KEY'))).toBe(true)
    expect(erros.some((e) => e.includes('next.config.ts: GOOGLE_MAPS_SERVER_KEY'))).toBe(true)
  })
  it('pasta liberada e comentário não contam', () => {
    expect(erros.some((e) => e.startsWith('lib/geocode/'))).toBe(false)
    expect(erros.some((e) => e.startsWith('lib/comentario.ts'))).toBe(false)
  })
})
