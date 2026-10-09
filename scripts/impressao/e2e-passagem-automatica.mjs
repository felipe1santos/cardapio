/**
 * E2E — passagem automática para o assistente novo (09/10). Stack LOCAL, loja cantina-e2e.
 * Loja "só assistente novo" (impressao_somente_nova) que ainda imprime pelo antigo:
 *   · computador no beta.10 conecta → NÃO passa (precisa do beta.11+);
 *   · beta.13 com 2 impressoras reais e nenhuma com o nome da antiga → NÃO passa (não adivinha);
 *   · beta.13 com a impressora de MESMO nome da antiga → passa sozinha: Cozinha e Pré-conta nela,
 *     pedidos concluídos marcados como impressos, modo "Cozinha e Caixa", auditoria;
 *   · pedido em aberto continua para imprimir pelo novo.
 * Tudo volta ao que era no fim.  node scripts/impressao/e2e-passagem-automatica.mjs
 */
import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais(); exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
let falhas = 0, total = 0
const ok = (n, c, d = '') => { total++; if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }

const loja = await um(`select id, impressao_beta_modo m, impressao_beta_liberado lib, impressao_somente_nova sn, impressao_cozinha_por_funcao cpf from restaurantes where slug='cantina-e2e'`)
if (!loja) { console.error('loja cantina-e2e não existe'); process.exit(2) }
const L = loja.id
const NOME_ANTIGA = 'LINTIAN TESTE'
const funcoesAntes = (await db.query('select funcao, dispositivo_id from impressao_funcoes where restaurante_id=$1', [L])).rows
const agentes = []
const pedidos = []
async function novoAgente(nome) {
  const cred = 'mza_ag_' + randomBytes(32).toString('base64url')
  const a = await um(`insert into impressao_agentes (restaurante_id, nome, credencial_hash) values ($1,$2,$3) returning id`, [L, nome, createHash('sha256').update(cred).digest('hex')])
  agentes.push(a.id)
  return { id: a.id, sinal: (versao, impressoras) => fetch(`${BASE}/api/agente/impressoras`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cred}`, 'X-Agente-Versao': versao }, body: JSON.stringify({ impressoras }) }) }
}
const modo = async () => (await um('select impressao_beta_modo m from restaurantes where id=$1', [L])).m

try {
  await db.query('update impressao_agentes set revogado_em=coalesce(revogado_em, now()) where restaurante_id=$1', [L])
  await db.query('delete from impressao_funcoes where restaurante_id=$1', [L])
  await db.query(`update restaurantes set impressao_beta_modo='teste', impressao_beta_liberado=true, impressao_somente_nova=true, impressao_cozinha_por_funcao=false where id=$1`, [L])
  await db.query(`insert into impressoras (restaurante_id, nome, ativa) values ($1,$2,true)`, [L, NOME_ANTIGA])
  const mk = async (status) => { const p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, canal, origem, observacao, impresso, criado_em) values ($1,'retirada',$2,10,10,'TESTE passagem','27999990062','pix','balcao','pdv','',false, now()) returning id`, [L, status]); pedidos.push(p.id); return p.id }
  const concluido = await mk('entregue')
  const aberto = await mk('preparando')

  const a1 = await novoAgente('PC Passagem 1')
  await a1.sinal('0.2.0-beta.10', ['Microsoft Print to PDF', NOME_ANTIGA])
  ok('beta.10 conectou: continua no antigo', (await modo()) === 'teste')

  const a2 = await novoAgente('PC Passagem 2')
  await a2.sinal('0.2.0-beta.13', ['Microsoft Print to PDF', 'POS-80 A', 'POS-80 B'])
  ok('beta.13 com 2 impressoras reais e nenhuma igual à antiga: não adivinha, continua no antigo', (await modo()) === 'teste' && !(await um('select 1 x from impressao_funcoes where restaurante_id=$1', [L])))

  const a3 = await novoAgente('PC Passagem 3')
  const r = await a3.sinal('0.2.0-beta.13', ['Microsoft Print to PDF', 'OneNote for Windows 10', NOME_ANTIGA])
  const disp = await um(`select id from impressao_dispositivos where agente_id=$1 and nome_sistema=$2`, [a3.id, NOME_ANTIGA])
  const f = (await db.query('select funcao, dispositivo_id d from impressao_funcoes where restaurante_id=$1 order by funcao', [L])).rows
  ok('beta.13 com a impressora de mesmo nome da antiga: passa sozinha para "Cozinha e Caixa"', r.status === 200 && (await modo()) === 'cozinha_caixa', `${r.status} ${await modo()}`)
  ok('Cozinha e Pré-conta na impressora de mesmo nome', f.length === 2 && f.every((x) => x.d === disp?.id), JSON.stringify(f))
  ok('pedido concluído marcado como impresso (nada sai acumulado)', (await um('select impresso from pedidos where id=$1', [concluido])).impresso === true)
  ok('pedido em aberto continua para imprimir pelo novo', (await um('select impresso from pedidos where id=$1', [aberto])).impresso === false)
  ok('auditoria "impressao.passou_para_novo"', !!(await um(`select 1 x from eventos_auditoria where restaurante_id=$1 and acao='impressao.passou_para_novo' and criado_em > now() - interval '2 minutes'`, [L])))
  await a3.sinal('0.2.0-beta.13', ['Microsoft Print to PDF', NOME_ANTIGA])
  ok('sinais seguintes não mexem em nada (já está no novo)', (await modo()) === 'cozinha_caixa' && (await db.query('select 1 from impressao_funcoes where restaurante_id=$1', [L])).rowCount === 2)
} catch (e) {
  falhas++; console.error('ERRO', e)
} finally {
  await db.query('delete from impressao_funcoes where restaurante_id=$1', [L])
  for (const f of funcoesAntes) await db.query('insert into impressao_funcoes (restaurante_id, funcao, dispositivo_id) values ($1,$2,$3) on conflict do nothing', [L, f.funcao, f.dispositivo_id]).catch(() => {})
  await db.query('delete from impressao_dispositivos where agente_id = any($1::uuid[])', [agentes])
  await db.query('delete from impressao_agentes where id = any($1::uuid[])', [agentes])
  await db.query(`delete from impressoras where restaurante_id=$1 and nome=$2`, [L, NOME_ANTIGA])
  await db.query(`update pedidos set status='cancelado' where id = any($1::uuid[]) and status <> 'cancelado'`, [pedidos]).catch(() => {})
  await db.query(`update restaurantes set impressao_beta_modo=$2, impressao_beta_liberado=$3, impressao_somente_nova=$4, impressao_cozinha_por_funcao=$5 where id=$1`, [L, loja.m, loja.lib, loja.sn, loja.cpf])
  await db.end()
  console.log(`\n${total - falhas}/${total} ok${falhas ? ` — ${falhas} FALHA(S)` : ''}`)
  process.exit(falhas ? 1 : 0)
}
