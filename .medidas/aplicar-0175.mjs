// 0175 em PRODUÇÃO: ensaio (padrão) aplica, testa e desfaz; ENSAIO=0 grava.
import { readFileSync } from 'node:fs'
import pg from 'pg'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect()
const sql = readFileSync('supabase/migrations/0175_villa_trava_por_computador.sql', 'utf8'), ensaio = process.env.ENSAIO !== '0'
let ok = true
const v = (rot, b, x = '') => { if (!b) ok = false; console.log(b ? '✅' : '🐞', rot, x) }
const bloqueado = async (ip) => (await c.query(`select 1 from impressao_agente_ips i join impressao_agentes a on a.id=i.agente_id where i.ip=$1 and a.sem_atualizacao and a.revogado_em is null
  union select 1 from impressao_agentes a join restaurantes r on r.id=a.restaurante_id where a.visto_ip=$1 and a.revogado_em is null and r.impressao_sem_atualizacao`, [ip])).rowCount > 0
await c.query('begin')
try {
  await c.query(sql)
  const travados = (await c.query(`select a.nome, r.slug from impressao_agentes a join restaurantes r on r.id=a.restaurante_id where a.sem_atualizacao`)).rows
  v('só o PC-PRINCIPAL da Villa travado', travados.length === 1 && travados[0].slug === 'villa-lanches' && travados[0].nome === 'PC-PRINCIPAL', JSON.stringify(travados))
  v('IP atual da Villa bloqueado', await bloqueado('186.223.169.172'))
  await c.query(`update restaurantes set impressao_sem_atualizacao=false where slug='villa-lanches'`) // prova só a 1ª checagem
  // Villa troca de internet: o Assistente busca pedidos do IP novo → gatilho grava → bloqueado.
  await c.query(`update impressao_agentes set visto_ip='203.0.113.77' where nome='PC-PRINCIPAL' and sem_atualizacao`)
  v('IP NOVO da Villa bloqueado (mesmo sem a loja no IP antigo)', await bloqueado('203.0.113.77'))
  v('IP antigo da Villa continua bloqueado', await bloqueado('186.223.169.172'))
  const outros = (await c.query(`select distinct visto_ip from impressao_agentes a join restaurantes r on r.id=a.restaurante_id where r.slug<>'villa-lanches' and a.revogado_em is null and visto_ip is not null`)).rows.map((x) => x.visto_ip)
  let livres = true; for (const ip of outros) if (await bloqueado(ip)) livres = false
  v('outras lojas liberadas', livres, outros.join(','))
  await c.query(`update impressao_agentes set visto_ip='198.51.100.9' where id=(select a.id from impressao_agentes a join restaurantes r on r.id=a.restaurante_id where r.slug='menuzia' and a.revogado_em is null limit 1)`)
  v('IP novo de outra loja NÃO entra no histórico', (await c.query(`select count(*)::int n from impressao_agente_ips where ip='198.51.100.9'`)).rows[0].n === 0)
  if (ensaio || !ok) { await c.query('rollback'); console.log(ok ? 'ENSAIO ok (desfeito)' : 'ERRO no ensaio — desfeito'); if (!ok) process.exitCode = 1 }
  else { await c.query('rollback'); await c.query('begin'); await c.query(sql); await c.query('commit'); console.log('APLICADA') }
} catch (e) { await c.query('rollback').catch(() => {}); console.error('ERRO', e.message); process.exitCode = 1 } finally { await c.end() }
