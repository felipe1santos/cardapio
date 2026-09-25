/**
 * Liga `pdv_v2` e LIBERA o Assistente Beta em "Somente teste" para TODAS as lojas, de uma
 * vez, numa transação — e desfaz exatamente a partir do retrato gravado antes.
 *
 * Só estas colunas mudam: `pdv_v2` e `impressao_beta_liberado`. O modo do Beta NÃO muda
 * (fica/permanece 'teste'), nenhum computador, código, função de impressora ou transferência
 * é criado, e a cozinha continua no Assistente antigo (`impressao_cozinha_por_funcao` =
 * false). Recusa aplicar se alguma loja não estiver em 'teste', tiver cozinha por função,
 * transferência registrada, função de impressora atribuída ou computador Beta ativo.
 * Cada loja alterada ganha um evento de auditoria.
 *
 *   node scripts/seguranca/flags-pdv-beta-todas.mjs retrato <arquivo.json>      # só leitura
 *   SOMENTE=ordem-qr-e2e,ordem-qr-vizinha ...                                 # prova local
 *   node scripts/seguranca/flags-pdv-beta-todas.mjs aplicar <arquivo.json> --confirmar-producao
 *   node scripts/seguranca/flags-pdv-beta-todas.mjs reverter <arquivo.json> --confirmar-producao
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [acao, arquivo] = process.argv.slice(2)
const confirmou = process.argv.includes('--confirmar-producao')
if (!['retrato', 'aplicar', 'reverter'].includes(acao) || !arquivo) {
  console.error('Uso: flags-pdv-beta-todas.mjs retrato|aplicar|reverter <arquivo.json> [--confirmar-producao]')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  for (const l of readFileSync(join(raiz, '.env.local'), 'utf8').split('\n')) {
    const t = l.trim(); const eq = t.indexOf('=')
    if (!t || t.startsWith('#') || eq < 0) continue
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
}
const DB_URL = process.env.DATABASE_URL
const host = new URL(DB_URL.replace(/^postgres(ql)?:/, 'http:')).hostname
const loop = ['127.0.0.1', 'localhost', '::1'].includes(host)
if (acao !== 'retrato' && !loop && !confirmou) { console.error(`❌ alvo ${host} sem --confirmar-producao`); process.exit(1) }

const c = new pg.Client({ connectionString: DB_URL, ssl: loop ? undefined : { rejectUnauthorized: false } })
await c.connect()
const q = async (s, p = []) => (await c.query(s, p)).rows
// Para prova local em lojas isoladas: SOMENTE=slug1,slug2. Em produção fica vazio (todas).
const SOMENTE = process.env.SOMENTE ? process.env.SOMENTE.split(',') : null

const lerEstado = () => q(`select r.id, r.slug, r.pdv_v2, r.impressao_beta_liberado, r.impressao_beta_modo, r.impressao_cozinha_por_funcao,
    r.impressao_cozinha_transferida_em,
    (select count(*)::int from impressao_agentes a where a.restaurante_id=r.id and a.revogado_em is null) agentes_ativos,
    (select count(*)::int from impressao_funcoes f where f.restaurante_id=r.id) funcoes
  from restaurantes r where ($1::text[] is null or r.slug = any($1)) order by r.slug`, [SOMENTE])

try {
  if (acao === 'retrato') {
    if (existsSync(arquivo)) { console.error(`❌ ${arquivo} já existe: não sobrescrevo o retrato`); process.exit(1) }
    const estado = await lerEstado()
    writeFileSync(arquivo, JSON.stringify({ em: new Date().toISOString(), host, lojas: estado }, null, 1))
    for (const l of estado) console.log(l.slug.padEnd(24), JSON.stringify(l))
    console.log(`retrato gravado em ${arquivo}`)
  } else {
    const retrato = JSON.parse(readFileSync(arquivo, 'utf8'))
    await c.query('begin')
    await c.query(`set local lock_timeout = '10s'`)
    const atual = await q(`select id, slug, pdv_v2, impressao_beta_liberado, impressao_beta_modo, impressao_cozinha_por_funcao, impressao_cozinha_transferida_em from restaurantes where ($1::text[] is null or slug = any($1)) order by slug for update`, [SOMENTE])
    if (atual.length !== retrato.lojas.length || atual.some((l, i) => l.id !== retrato.lojas[i].id)) throw new Error('as lojas mudaram desde o retrato')
    if (acao === 'aplicar') {
      const estado = await lerEstado()
      const problema = estado.filter((l) => l.impressao_beta_modo !== 'teste' || l.impressao_cozinha_por_funcao || l.impressao_cozinha_transferida_em || l.funcoes > 0 || l.agentes_ativos > 0)
      if (problema.length) throw new Error('estado inesperado, nada feito: ' + JSON.stringify(problema))
      for (const l of atual) {
        const muda = { pdv_v2: !l.pdv_v2, beta: !l.impressao_beta_liberado }
        if (!muda.pdv_v2 && !muda.beta) continue
        await c.query(`update restaurantes set pdv_v2 = true, impressao_beta_liberado = true where id = $1`, [l.id])
        if (muda.beta) await c.query(`select public.auditoria_registrar($1, null, 'Plataforma (Claude, autorizado pelo dono)', 'impressao.beta_liberado', 'restaurante', $1, '{"modo":"teste","motivo":"liberação geral em Somente teste"}'::jsonb)`, [l.id])
        if (muda.pdv_v2) await c.query(`select public.auditoria_registrar($1, null, 'Plataforma (Claude, autorizado pelo dono)', 'pdv.v2_ligado', 'restaurante', $1, '{"motivo":"liberação geral"}'::jsonb)`, [l.id])
      }
    } else {
      for (const r of retrato.lojas) {
        await c.query(`update restaurantes set pdv_v2 = $2, impressao_beta_liberado = $3 where id = $1`, [r.id, r.pdv_v2, r.impressao_beta_liberado])
        await c.query(`select public.auditoria_registrar($1, null, 'Plataforma (Claude, rollback)', 'plataforma.flags_revertidas', 'restaurante', $1, jsonb_build_object('pdv_v2', $2::boolean, 'beta', $3::boolean))`, [r.id, r.pdv_v2, r.impressao_beta_liberado])
      }
    }
    await c.query('commit')
    const depois = await lerEstado()
    for (const l of depois) console.log(l.slug.padEnd(24), 'pdv_v2', l.pdv_v2, '| beta', l.impressao_beta_liberado, l.impressao_beta_modo, '| cozinha por função', l.impressao_cozinha_por_funcao, '| transferida', l.impressao_cozinha_transferida_em, '| agentes', l.agentes_ativos, '| funções', l.funcoes)
  }
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.error('❌', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
