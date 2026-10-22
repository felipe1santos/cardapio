import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { verificarB1, verificarB2, verificarB3, verificarB4, verificarBugsConhecidos } from '../../scripts/guardas/bugs-conhecidos.mjs'

/** Bugs conhecidos (docs/BUGS-CONHECIDOS.md): o código de verdade não pode ter nenhum de volta. */
describe('bugs conhecidos no código de verdade', () => {
  it('nenhum voltou', () => {
    expect(verificarBugsConhecidos(process.cwd())).toEqual([])
  }, 60_000)
})

describe('a guarda pega quem reintroduz', () => {
  const base = mkdtempSync(join(tmpdir(), 'bugs-'))
  afterAll(() => rmSync(base, { recursive: true, force: true }))
  const arq = (rel: string, txt: string) => { mkdirSync(join(base, rel, '..'), { recursive: true }); writeFileSync(join(base, rel), txt) }
  arq('app/api/x/route.ts', "const n = /^d{1,3}$/.test(v) ? Number(v) : null\nconst ok = /^\\d{1,3}$/.test(v)\n")
  arq('app/api/cron/a/route.ts', "import { cicloPush } from '@/lib/push/ciclo'\nimport { lojasComFinanceiro } from '@/lib/financeiro/nivel'\n")
  arq('app/api/cron/b/route.ts', "import { processarCampanhas } from '@/lib/mensageria/campanhas-envio'\nimport { cicloPush } from '@/lib/push/ciclo'\nimport { lojasComFinanceiro } from '@/lib/financeiro/nivel'\n")
  arq('supabase/migrations/0219_ruim.sql', 'create policy x on public.pedidos for select to authenticated using (restaurante_id = auth_restaurante_id());\n')
  arq('supabase/migrations/0220_boa.sql', 'create policy y on public.pedidos for select to authenticated using (restaurante_id = (select public.auth_restaurante_id()));\n')
  arq('supabase/migrations/0100_antiga.sql', 'create policy z on public.pedidos using (restaurante_id = auth_restaurante_id());\n')

  it('B1: regex sem a barra (só a linha errada)', () => {
    const e = verificarB1(base) as string[]
    expect(e).toHaveLength(1)
    expect(e[0]).toContain('app/api/x/route.ts:1')
  })
  it('B2: o mesmo trabalho em dois crons (ajudante de lista não conta)', () => {
    const e = verificarB2(base) as string[]
    expect(e).toHaveLength(1)
    expect(e[0]).toContain('cicloPush')
  })
  it('B4: caractere de controle invisível (a barra do \\b virou backspace)', () => {
    arq('lib/q.ts', `const ok = !/^\\s*teste${String.fromCharCode(8)}/i.test(nome)\n`)
    const e = verificarB4(base) as string[]
    expect(e).toHaveLength(1)
    expect(e[0]).toContain('lib/q.ts:1')
  })
  it('B3: política nova sem (select …); a com select e as antigas passam', () => {
    const e = verificarB3(base) as string[]
    expect(e).toHaveLength(1)
    expect(e[0]).toContain('0219_ruim.sql')
  })
})
