import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { verificarIsolamento } from '../scripts/seguranca/guarda-isolamento.mjs'

/** Isolamento entre lojas (10/10/2026): nenhuma rota do painel escolhe a loja pelo que vem na requisição. */
describe('guarda de isolamento no código de verdade', () => {
  it('todas as rotas de /api/admin tiram a loja da sessão', () => {
    expect(verificarIsolamento(process.cwd())).toEqual([])
  })
})

describe('guarda de isolamento pega quem quebra', () => {
  const base = mkdtempSync(join(tmpdir(), 'isol-'))
  afterAll(() => rmSync(base, { recursive: true, force: true }))
  const arq = (rel: string, txt: string) => { mkdirSync(join(base, rel, '..'), { recursive: true }); writeFileSync(join(base, rel), txt) }
  arq('app/api/admin/a/route.ts', "const loja = new URL(req.url).searchParams.get('restauranteId')\n")
  arq('app/api/admin/b/route.ts', 'const corpo = await req.json()\nawait admin.from("pedidos").select().eq("restaurante_id", corpo.restauranteId)\n')
  arq('app/api/admin/c/route.ts', 'const { restauranteId } = await request.json()\n')
  arq('app/api/admin/ok/route.ts', 'const sessao = await getCurrentSession(s)\nconst loja = sessao.restauranteId\n')
  it('acusa as três rotas erradas e só elas', () => {
    const p = verificarIsolamento(base)
    expect(p.map((x) => x.split(':')[0]).sort()).toEqual(['app/api/admin/a/route.ts', 'app/api/admin/b/route.ts', 'app/api/admin/c/route.ts'])
  })
})
