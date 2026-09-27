/**
 * Impressora VIRTUAL do Windows vale igual à física (regra de 2026-09-27) — prova de ponta a
 * ponta pelas APIs reais, com o Beta (credencial) e o Assistente antigo (token) consultando
 * a mesma loja. Nada imprime: o "Beta" aqui só consome a fila e informa o resultado.
 *
 *   · virtual só na Cozinha / só no Recibo/Extrato / nas duas;
 *   · "Somente Caixa" e "Cozinha e Caixa" ligam com virtual;
 *   · Testar Cozinha / Testar Recibo/Extrato na virtual;
 *   · Recibo/Extrato do PDV e ficha da cozinha roteados para o Beta na virtual;
 *   · antigo não recebe a ficha nem o Recibo/Extrato (sem duplicidade);
 *   · física continua igual; desconectado, pareamento antigo e sem impressora bloqueiam.
 * Loja de demonstração local (cantina-demo).
 *
 *   node scripts/seguranca/verificar-impressao-virtual.mjs
 */
import { createHash } from 'node:crypto'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)

const res = []
const ok = (nome, passou, detalhe) => { res.push(!!passou); console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const sha = (s) => createHash('sha256').update(s).digest('hex')

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
for (const t of ['impressao_trabalhos', 'impressao_funcoes', 'impressao_dispositivos', 'impressao_pareamentos', 'impressao_agentes', 'impressao_reservas']) await db.query(`delete from ${t} where restaurante_id=$1`, [loja])
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza teste impressão', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await db.query(`update restaurantes set pdv_v2=true, modulo_mesas_ativo=true, impressao_automatica=true, impressao_ativar_assistente=true, impressao_cozinha_por_funcao=false,
  impressao_beta_liberado=true, impressao_beta_modo='teste', impressao_cozinha_transferida_em=null where id=$1`, [loja])
await db.query('update pedidos set impresso=true, reimprimir=false where restaurante_id=$1', [loja])
const tokenLegado = uuid()
await db.query('update restaurantes set impressao_agente_token=$2 where id=$1', [loja, tokenLegado])

const adminSb = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
{
  const email = 'gerente@demo.local'
  const { data, error } = await adminSb.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  const id = data?.user?.id ?? (await adminSb.auth.admin.listUsers()).data.users.find((u) => u.email === email).id
  await db.query(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,'gerente','Gerente Demo',$3,'gerente.local',true)
     on conflict (id) do update set restaurante_id=excluded.restaurante_id, papel='gerente', desativado_em=null`, [id, loja, email])
}
const browser = await chromium.launch()
async function logar(usuario) {
  const page = await (await browser.newContext()).newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')])
  return page
}
const api = (page, url, metodo = 'GET', corpo) => page.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  let json = null
  try { json = await r.json() } catch { /* sem corpo */ }
  return { status: r.status, json }
}, { url: `${BASE}${url}`, metodo, corpo })
const VERSAO = '0.2.0-beta.1'
const agente = (cred) => ({
  get: async (p) => { const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${cred}`, 'X-Agente-Versao': VERSAO } }); return { status: r.status, json: await r.json().catch(() => null) } },
  post: async (p, c) => { const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${cred}`, 'Content-Type': 'application/json' }, body: JSON.stringify(c ?? {}) }); return { status: r.status, json: await r.json().catch(() => null) } },
})
const antigo = async () => (await fetch(`${BASE}/api/agente/pedidos`, { headers: { Authorization: `Bearer ${tokenLegado}` } }).then((r) => r.json())).pedidos ?? []
const modo = (m) => api(pGer, '/api/admin/impressao/modo', 'PUT', { modo: m })
const funcao = (f, id) => api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: f, dispositivoId: id, confirmarCompartilhada: true })
const modoLoja = async () => (await um('select impressao_beta_modo m from restaurantes where id=$1', [loja])).m

const pGer = await logar('gerente.local')
const pAt = await logar('atendente.local')
const AGUA = await um('select id from itens_cardapio where restaurante_id=$1 and nome=$2', [loja, 'Água com Gás'])
const balcao = (await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Cliente Virtual', chave: uuid() })).json.id
const lancar = async () => (await api(pAt, '/api/admin/pdv/lancamento', 'POST', { comandaId: balcao, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }] })).json.id

try {
  secao('Pareamento: computador de teste só com impressoras virtuais (e uma física)')
  const cod = await api(pGer, '/api/admin/impressao/pareamento', 'POST')
  const pa = await fetch(`${BASE}/api/agente/parear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo: cod.json.codigo, nome: 'PC-TESTE', versao: VERSAO }) }).then((r) => r.json())
  const A = agente(pa.credencial)
  ok('computador pareado', !!pa.credencial)
  await A.post('/api/agente/impressoras', { impressoras: ['Microsoft Print to PDF', 'Microsoft XPS Document Writer', 'POS-80'] })
  const disp = Object.fromEntries((await q('select nome_sistema, id from impressao_dispositivos where restaurante_id=$1', [loja])).map((r) => [r.nome_sistema, r.id]))
  const PDF = disp['Microsoft Print to PDF']
  const POS = disp['POS-80']
  ok('impressoras detectadas (2 virtuais + 1 física)', !!PDF && !!disp['Microsoft XPS Document Writer'] && !!POS)
  const beat = () => A.get('/api/agente/trabalhos')

  secao('Virtual só na Cozinha')
  ok('PDF como Cozinha: aceito', (await funcao('cozinha', PDF)).status === 200)
  await beat()
  const c1 = await modo('caixa')
  ok('Somente Caixa pede Recibo/Extrato (por falta dele, não por ser virtual)', c1.status === 409 && c1.json?.codigo === 'impressora_caixa_nao_configurada')

  secao('Virtual só no Recibo/Extrato')
  await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'cozinha', dispositivoId: null })
  ok('PDF como Recibo/Extrato: aceito', (await funcao('caixa', PDF)).status === 200)
  await beat()
  const c2 = await modo('caixa')
  ok('"Somente Caixa" liberado com Recibo/Extrato virtual', c2.status === 200 && (await modoLoja()) === 'caixa', `${c2.status} ${c2.json?.error ?? ''}`)

  secao('Testes na impressora virtual')
  const tCoz = await api(pGer, `/api/admin/impressao/dispositivos/${PDF}`, 'POST', { acao: 'teste', chave: uuid() })
  const tRec = await api(pGer, `/api/admin/impressao/dispositivos/${PDF}`, 'POST', { acao: 'recibo_teste', chave: uuid() })
  ok('Testar Cozinha na virtual: trabalho criado', [200, 201].includes(tCoz.status) && !!tCoz.json?.id, JSON.stringify(tCoz.json))
  ok('Testar Recibo/Extrato na virtual: trabalho criado', [200, 201].includes(tRec.status) && !!tRec.json?.id, JSON.stringify(tRec.json))
  const tb = (await A.get('/api/agente/trabalhos')).json?.trabalhos ?? []
  const naPdf = (id) => tb.find((t) => t.id === id)?.impressora?.nomeSistema ?? tb.find((t) => t.id === id)?.nomeSistema ?? tb.find((t) => t.id === id)?.impressora
  ok('os dois testes chegam ao Beta', tb.some((t) => t.id === tCoz.json.id) && tb.some((t) => t.id === tRec.json.id))
  ok('destino dos testes: Microsoft Print to PDF', JSON.stringify(tb.filter((t) => [tCoz.json.id, tRec.json.id].includes(t.id))).includes('Microsoft Print to PDF'), String(naPdf(tCoz.json.id)))
  for (const id of [tCoz.json.id, tRec.json.id]) await A.post(`/api/agente/trabalhos/${id}/resultado`, { ok: true })
  ok('testes concluídos (aceitos pela fila do Windows)', (await q(`select estado from impressao_trabalhos where id = any($1::uuid[])`, [[tCoz.json.id, tRec.json.id]])).every((r) => r.estado === 'enviado_spooler'))

  secao('Recibo/Extrato do PDV na virtual ("Somente Caixa")')
  await lancar()
  const pc = await api(pAt, `/api/admin/comandas/${balcao}/pre-conta`, 'POST', { chave: uuid() })
  ok('PDV: Recibo/Extrato aceito (sem o erro antigo)', [200, 201].includes(pc.status) && !!pc.json?.id, `${pc.status} ${pc.json?.error ?? ''}`)
  const tPc = ((await A.get('/api/agente/trabalhos')).json?.trabalhos ?? []).find((t) => t.id === pc.json.id)
  ok('Recibo/Extrato roteado para o Beta, na Microsoft Print to PDF', !!tPc && JSON.stringify(tPc).includes('Microsoft Print to PDF'))
  await A.post(`/api/agente/trabalhos/${pc.json.id}/resultado`, { ok: true })
  ok('um trabalho só para esse Recibo/Extrato', Number((await um(`select count(*) n from impressao_trabalhos where restaurante_id=$1 and tipo='pre_conta'`, [loja])).n) === 1)
  ok('Assistente antigo nunca vê Recibo/Extrato (só lista pedidos da cozinha)', !(await antigo()).some((p) => p.id === pc.json.id))

  secao('Virtual nas duas funções: "Cozinha e Caixa"')
  ok('PDF como Cozinha e Recibo/Extrato (a mesma virtual)', (await funcao('cozinha', PDF)).status === 200)
  await beat()
  await db.query('update pedidos set impresso=true where restaurante_id=$1', [loja])
  const c3 = await modo('cozinha_caixa')
  ok('"Cozinha e Caixa" liberado com as duas na virtual', c3.status === 200 && (await modoLoja()) === 'cozinha_caixa', `${c3.status} ${c3.json?.error ?? ''}`)
  await db.query(`update restaurantes set impressao_cozinha_transferida_em=now()-interval '2 minutes' where id=$1`, [loja])
  const k1 = await lancar()
  const kb = (await A.get('/api/agente/pedidos')).json
  ok('ficha da cozinha roteada para o Beta, destino Microsoft Print to PDF', kb.pedidos.some((p) => p.id === k1) && kb.destinoCozinha?.nomeSistema === 'Microsoft Print to PDF', kb.destinoCozinha?.nomeSistema)
  const [, velho] = await Promise.all([A.get('/api/agente/pedidos'), antigo()])
  ok('Assistente antigo não recebe essa ficha (sem duplicidade)', !velho.some((p) => p.id === k1) && Number((await um('select count(*) n from impressao_reservas where pedido_id=$1', [k1])).n) === 1)
  ok('Beta confirma: impresso uma vez', (await A.post(`/api/agente/pedidos/${k1}/imprimir`)).status === 200 && (await um('select impresso from pedidos where id=$1', [k1])).impresso === true)
  ok('fila do antigo continua vazia', (await antigo()).length === 0)

  secao('Física continua igual')
  ok('POS-80 como Cozinha', (await funcao('cozinha', POS)).status === 200)
  await db.query('delete from impressao_reservas where restaurante_id=$1', [loja])
  const k2 = await lancar()
  const kb2 = (await A.get('/api/agente/pedidos')).json
  ok('ficha na POS-80 pelo Beta', kb2.pedidos.some((p) => p.id === k2) && kb2.destinoCozinha?.nomeSistema === 'POS-80')
  await A.post(`/api/agente/pedidos/${k2}/imprimir`)

  secao('O que continua bloqueando')
  ok('volta para "Somente teste" sempre', (await modo('teste')).status === 200)
  await db.query('delete from impressao_funcoes where restaurante_id=$1', [loja])
  ok('sem impressora escolhida: "Somente Caixa" recusado', (await modo('caixa')).json?.codigo === 'impressora_caixa_nao_configurada')
  // Pareamento antigo: o mesmo computador pareado de novo; a virtual do registro velho não vale.
  const velhoAg = (await um(`insert into impressao_agentes (restaurante_id, nome, credencial_hash, versao, visto_em, criado_em) values ($1,'PC-TESTE',$2,$3, now()-interval '1 hour', now()-interval '1 day') returning id`, [loja, sha(uuid()), VERSAO])).id
  const velhoPdf = (await um(`insert into impressao_dispositivos (restaurante_id, agente_id, nome_sistema) values ($1,$2,'Microsoft Print to PDF') returning id`, [loja, velhoAg])).id
  await db.query(`insert into impressao_funcoes (restaurante_id, funcao, dispositivo_id) values ($1,'caixa',$2)`, [loja, velhoPdf])
  const pAnt = await modo('caixa')
  ok('pareamento antigo: recusado com orientação', pAnt.status === 409 && /pareamento antigo/i.test(pAnt.json?.error ?? ''), pAnt.json?.error)
  await db.query('delete from impressao_funcoes where restaurante_id=$1', [loja])
  ok('virtual do computador atual volta a liberar', (await funcao('caixa', PDF)).status === 200 && (await beat(), (await modo('caixa')).status === 200))
  // Desconectar o computador: o modo recua e não sobe de novo.
  const agId = (await um('select id from impressao_agentes where credencial_hash=$1', [sha(pa.credencial)])).id
  const rv = await api(pGer, `/api/admin/impressao/agentes/${agId}`, 'POST', { acao: 'revogar' })
  ok('desconectar o computador em uso: volta para "Somente teste"', rv.status === 200 && rv.json?.modoRecuou === 'teste' && (await modoLoja()) === 'teste')
  ok('computador desconectado: "Somente Caixa" recusado', (await modo('caixa')).json?.codigo === 'impressora_caixa_indisponivel')
  ok('nenhum trabalho ficou preso', Number((await um(`select count(*) n from impressao_trabalhos where restaurante_id=$1 and estado in ('pendente','reservado')`, [loja])).n) === 0)
} catch (e) {
  ok(`execução sem exceção: ${e.message}`, false)
} finally {
  await db.query(`update restaurantes set impressao_agente_token=null, impressao_cozinha_por_funcao=false, impressao_beta_liberado=false, impressao_beta_modo='teste' where id=$1`, [loja])
  await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza teste impressão', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
  await browser.close()
  await db.end()
}
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
