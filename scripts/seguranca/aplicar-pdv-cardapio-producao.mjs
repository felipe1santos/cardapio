/**
 * Aplicador das migrations 0080–0097 (PDV v2, impressão, cardápio/tamanhos) — e SÓ delas.
 *
 * Por que não `npm run db:setup`: aquele runner também roda seed e aplicaria qualquer
 * pendente. Aqui a lista é fechada, em ordem numérica, e nada fora dela roda.
 *
 * Para cada arquivo:
 *   1. registra o início;
 *   2. aplica numa transação própria, com lock_timeout (não segura tabela viva);
 *   3. registra em schema_migrations NA MESMA transação — só se o SQL aplicou inteiro;
 *   4. depois do commit, confere os objetos esperados. Divergência → para ali.
 * Nada é marcado como aplicado à mão. Reexecutar pula o que já está registrado.
 *
 *   node scripts/seguranca/aplicar-pdv-cardapio-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-pdv-cardapio-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ARQUIVOS = [
  '0080_seg_restaurantes_isolamento.sql',
  '0081_seg_funcoes_definer_e_escrita_anon.sql',
  '0082_pdv_comanda_balcao.sql',
  '0083_pdv_pedidos_estados.sql',
  '0084_pdv_pagamentos_canal.sql',
  '0085_pdv_rpcs_conta_presencial.sql',
  '0086_pdv_realtime_e_reserva_impressao.sql',
  '0087_impressao_listagem_sem_reserva.sql',
  '0088_impressao_agentes.sql',
  '0089_impressao_dispositivos_e_funcoes.sql',
  '0090_impressao_trabalhos.sql',
  '0091_impressao_espera_entre_tentativas.sql',
  '0092_impressao_pre_conta_observacao.sql',
  '0093_impressao_pre_conta_ordem.sql',
  '0094_pdv_atendimento_identificado.sql',
  '0095_pdv_mesa_em_limpeza.sql',
  '0096_pdv_fechamento_completo.sql',
  '0097_cardapio_tamanhos_unicos_e_pizza_ocultos.sql',
]
for (const [i, nome] of ARQUIVOS.entries()) {
  if (nome.slice(0, 4) !== String(80 + i).padStart(4, '0')) {
    console.error(`❌ lista fora de ordem em ${nome}`)
    process.exit(1)
  }
}

// Objetos que cada migration tem de deixar. Consultas só de leitura.
const col = (t, c) => `select exists(select 1 from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}') ok`
const tab = (t) => `select to_regclass('public.${t}') is not null ok`
const fn = (f) => `select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${f}') ok`
const idx = (i) => `select exists(select 1 from pg_indexes where schemaname='public' and indexname='${i}') ok`
const ESPERADO = {
  '0080': [["authenticated NÃO lê restaurantes.impressao_agente_token", `select not has_column_privilege('authenticated','public.restaurantes','impressao_agente_token','SELECT') ok`],
    ["authenticated ainda lê restaurantes.nome", `select has_column_privilege('authenticated','public.restaurantes','nome','SELECT') ok`]],
  '0081': [["anon não insere em pedidos", `select not has_table_privilege('anon','public.pedidos','INSERT') ok`]],
  '0082': [['comandas.tipo', col('comandas', 'tipo')], ['restaurantes.pdv_v2', col('restaurantes', 'pdv_v2')], ['nenhuma loja com pdv_v2 ligado', `select not exists(select 1 from restaurantes where pdv_v2) ok`]],
  '0083': [['pedidos.atendimento_status', col('pedidos', 'atendimento_status')], ['índice pedidos_numero_unq', idx('pedidos_numero_unq')], ['tabela impressao_reservas', tab('impressao_reservas')]],
  '0084': [['pagamentos_comanda.canal', col('pagamentos_comanda', 'canal')], ['pagamentos sem canal/origem nulos', `select not exists(select 1 from pagamentos_comanda where canal is null or origem is null) ok`]],
  '0085': [['função comanda_balcao_abrir', fn('comanda_balcao_abrir')], ['função comanda_fechar_presencial', fn('comanda_fechar_presencial')]],
  '0086': [['função impressao_reservar', fn('impressao_reservar')]],
  '0087': [['função impressao_elegiveis', fn('impressao_elegiveis')]],
  '0088': [['tabela impressao_agentes', tab('impressao_agentes')]],
  '0089': [['tabela impressao_dispositivos', tab('impressao_dispositivos')], ['cozinha_por_funcao desligado em todas', `select not exists(select 1 from restaurantes where impressao_cozinha_por_funcao) ok`]],
  '0090': [['tabela impressao_trabalhos', tab('impressao_trabalhos')]],
  '0091': [['função impressao_trabalhos_reservar', fn('impressao_trabalhos_reservar')]],
  '0092': [['função impressao_snapshot_pre_conta', fn('impressao_snapshot_pre_conta')]],
  '0093': [['pedido_itens.lancamento_seq', col('pedido_itens', 'lancamento_seq')]],
  '0094': [['comandas.entrega', col('comandas', 'entrega')], ['pedidos.lancado_via', col('pedidos', 'lancado_via')]],
  '0095': [['função mesa_liberar', fn('mesa_liberar')]],
  '0096': [['comandas.fidelidade_processado', col('comandas', 'fidelidade_processado')], ['função comanda_aplicar_decisoes', fn('comanda_aplicar_decisoes')]],
  '0097': [['itens_cardapio.pizza_tamanhos_ocultos', col('itens_cardapio', 'pizza_tamanhos_ocultos')],
    ...['tamanhos_padrao_pizza', 'tamanhos_padrao_marmita', 'bordas_pizza', 'massas_pizza', 'tamanhos_item', 'pizza_sabores'].map((t) => [`índice ${t}_nome_unico`, idx(`${t}_nome_unico`)])],
}

const aplicar = process.argv.includes('--aplicar')
const confirmou = process.argv.includes('--confirmar-producao')
const ate = process.argv.find((a) => a.startsWith('--ate='))?.slice(6)
if (!process.env.DATABASE_URL) {
  try {
    for (const l of readFileSync(join(raiz, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim(); const eq = t.indexOf('=')
      if (!t || t.startsWith('#') || eq < 0) continue
      const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!(k in process.env)) process.env[k] = v
    }
  } catch { /* sem .env.local */ }
}
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error('❌ DATABASE_URL ausente'); process.exit(1) }
const host = new URL(DB_URL.replace(/^postgres(ql)?:/, 'http:')).hostname
const loop = ['127.0.0.1', 'localhost', '::1'].includes(host)
const sqls = ARQUIVOS.filter((n) => !ate || n.slice(0, 4) <= ate).map((nome) => ({ nome, sql: readFileSync(join(raiz, 'supabase', 'migrations', nome), 'utf8') }))

if (!aplicar) {
  console.log(`DRY-RUN — alvo ${host}. ${sqls.length} arquivo(s):`)
  for (const s of sqls) console.log(`  ${s.nome} (${s.sql.length} bytes)`)
  process.exit(0)
}
if (!loop && !confirmou) { console.error(`❌ alvo ${host} sem --confirmar-producao`); process.exit(1) }

const c = new pg.Client({ connectionString: DB_URL, ssl: loop ? undefined : { rejectUnauthorized: false } })
await c.connect()
const hora = () => new Date().toISOString()
const reg = new Set((await c.query('select name from schema_migrations')).rows.map((r) => r.name))
const estranhas = [...reg].filter((n) => n.slice(0, 4) >= '0080' && !ARQUIVOS.includes(n))
if (!reg.has('0079_entrega_sem_entregador.sql') || estranhas.length) {
  console.error(`❌ estado inesperado: 0079 registrada? ${reg.has('0079_entrega_sem_entregador.sql')}; fora da lista: ${estranhas.join(', ')}`)
  await c.end(); process.exit(1)
}
for (const { nome, sql } of sqls) {
  if (reg.has(nome)) { console.log(`⏭️  ${nome} já registrada`); continue }
  const t0 = Date.now()
  console.log(`▶ ${hora()} início ${nome}`)
  try {
    await c.query('begin')
    await c.query(`set local lock_timeout = '15s'`)
    await c.query(sql)
    await c.query('insert into schema_migrations (name) values ($1)', [nome])
    await c.query('commit')
  } catch (e) {
    await c.query('rollback').catch(() => {})
    console.error(`❌ ${hora()} ${nome} FALHOU e foi desfeita inteira: ${e.message}`)
    await c.end(); process.exit(1)
  }
  const registrada = (await c.query('select aplicada_em from schema_migrations where name=$1', [nome])).rows[0]
  console.log(`✅ ${hora()} concluída ${nome} (${Date.now() - t0} ms), registrada em ${registrada?.aplicada_em?.toISOString()}`)
  for (const [rotulo, consulta] of ESPERADO[nome.slice(0, 4)] ?? []) {
    const ok = (await c.query(consulta)).rows[0].ok
    console.log(`   ${ok ? '✔' : '✘'} ${rotulo}`)
    if (!ok) { console.error(`❌ divergência depois de ${nome}. Parando.`); await c.end(); process.exit(1) }
  }
}
console.log('\nRegistradas ≥ 0079:', (await c.query(`select name from schema_migrations where name >= '0079' order by name`)).rows.map((r) => r.name).join(', '))
await c.end()
