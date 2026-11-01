import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { verificarB1, verificarB2, verificarB3, verificarB4, verificarB5, verificarBugsConhecidos } from '../../scripts/guardas/bugs-conhecidos.mjs'

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
  it('B5: script que sobe foto crua para o cardápio; com otimizador e os testes de segurança passam', () => {
    arq('scripts/import-x/importar.mjs', "await db.storage.from('cardapio').upload(caminho, buf, { upsert: true })\n")
    arq('scripts/import-y/importar.mjs', "const o = await otimizarBuffer(buf, 'produto')\nawait db.storage.from('cardapio').upload(caminho, o.buffer)\n")
    arq('scripts/seguranca/semear.mjs', "await admin.storage.from('cardapio').upload(c, b)\n")
    const e = verificarB5(base) as string[]
    expect(e).toHaveLength(1)
    expect(e[0]).toContain('scripts/import-x/importar.mjs')
  })
  it('B3: política nova sem (select …); a com select e as antigas passam', () => {
    const e = verificarB3(base) as string[]
    expect(e).toHaveLength(1)
    expect(e[0]).toContain('0219_ruim.sql')
  })
})

/**
 * B7 (01/11/2026, Fase 6): migration nova que cria função sem dizer quem executa. Com a 0241 o padrão passa a ser
 * "ninguém além do servidor", então toda função nova precisa de `revoke`/`grant execute` explícito — senão uma RPC da
 * vitrine quebra em silêncio ou uma de escrita fica aberta.
 */
describe('B7 função nova sem grant/revoke', () => {
  it('acusa create function sem grant nem revoke; aceita com um dos dois; ignora migrations antigas', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { verificarB7 } = await import('../../scripts/guardas/bugs-conhecidos.mjs')
    const base = mkdtempSync(join(tmpdir(), 'b7-'))
    mkdirSync(join(base, 'supabase/migrations'), { recursive: true })
    writeFileSync(join(base, 'supabase/migrations/0250_sem.sql'), 'create or replace function public.x_sem()\nreturns int language sql as $$ select 1 $$;\n')
    writeFileSync(join(base, 'supabase/migrations/0251_com.sql'), 'create or replace function public.x_com()\nreturns int language sql as $$ select 1 $$;\nrevoke all on function public.x_com() from public, anon, authenticated;\ngrant execute on function public.x_com() to service_role;\n')
    writeFileSync(join(base, 'supabase/migrations/0200_antiga.sql'), 'create function public.x_antiga() returns int language sql as $$ select 1 $$;\n')
    const erros = verificarB7(base)
    expect(erros).toHaveLength(1)
    expect(erros[0]).toMatch(/0250_sem\.sql B7 .*x_sem/)
  })
})
