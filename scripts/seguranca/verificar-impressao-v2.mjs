/**
 * Impressão com vários computadores, impressoras e pré-conta — prova de ponta a ponta
 * pelas APIs reais (painel com sessão de verdade, agentes por HTTP com credencial).
 *
 * Nada imprime: os "agentes" aqui só consomem a fila e informam o resultado. A parte
 * de papel virtual é do e2e-impressao-v2.mjs. Loja de demonstração local; credenciais
 * e códigos gerados aqui nunca são impressos.
 *
 *   node scripts/seguranca/verificar-impressao-v2.mjs
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
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== null && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const sha = (s) => createHash('sha256').update(s).digest('hex')
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]
const erroSql = async (sql, p = []) => {
  try {
    await db.query(sql, p)
    return null
  } catch (e) {
    return e.message
  }
}

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const vizinha = (await um(`select id from restaurantes where slug='vizinha-demo'`)).id
for (const l of [loja, vizinha]) {
  await db.query('delete from impressao_trabalhos where restaurante_id=$1', [l])
  await db.query('delete from impressao_funcoes where restaurante_id=$1', [l])
  await db.query('delete from impressao_dispositivos where restaurante_id=$1', [l])
  await db.query('delete from impressao_pareamentos where restaurante_id=$1', [l])
  await db.query('delete from impressao_agentes where restaurante_id=$1', [l])
  await db.query('delete from impressao_reservas where restaurante_id=$1', [l])
}
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza teste impressão', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await db.query('update mesas set limpeza_desde=null, limpeza_comanda_id=null where restaurante_id=$1', [loja])
await db.query(`update restaurantes set pdv_v2=true, modulo_mesas_ativo=true, impressao_automatica=true, impressao_cozinha_por_funcao=false,
  impressao_agente_visto_em=null, salao_caixa_desconto=true where id=$1`, [loja])
await db.query(`update restaurantes set pdv_v2=true where id=$1`, [vizinha])
await db.query('update pedidos set impresso=true, reimprimir=false where restaurante_id=$1', [loja])

// Gerente de demonstração (só local).
const adminSb = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
{
  const email = 'gerente@demo.local'
  const { data, error } = await adminSb.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  const id = data?.user?.id ?? (await adminSb.auth.admin.listUsers()).data.users.find((u) => u.email === email).id
  await db.query(
    `insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,'gerente','Gerente Demo',$3,'gerente.local',true)
     on conflict (id) do update set restaurante_id=excluded.restaurante_id, papel='gerente', desativado_em=null`, [id, loja, email])
}

const browser = await chromium.launch()
async function logar(usuario) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')])
  return page
}
const api = (page, url, metodo = 'GET', corpo) =>
  page.evaluate(
    async ({ url, metodo, corpo }) => {
      const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
      let json = null
      try { json = await r.json() } catch { /* sem corpo */ }
      return { status: r.status, json, texto: JSON.stringify(json) }
    },
    { url: `${BASE}${url}`, metodo, corpo },
  )
const agente = (credencial) => ({
  get: async (p) => {
    const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${credencial}`, 'X-Agente-Versao': '0.1.26' } })
    return { status: r.status, json: await r.json().catch(() => null) }
  },
  post: async (p, corpo) => {
    const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${credencial}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo ?? {}) })
    return { status: r.status, json: await r.json().catch(() => null) }
  },
})
const parear = async (codigo, nome) => {
  const r = await fetch(`${BASE}/api/agente/parear`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo, nome, versao: '0.1.26' }) })
  return { status: r.status, json: await r.json().catch(() => null) }
}

const pDono = await logar('dono.local')
const pGer = await logar('gerente.local')
const pAt = await logar('atendente.local')
const pViz = await logar('dono@vizinha.local')

// ════════════════════════════════════════════════════════════════════════════
secao('Pareamento por código e credencial por computador')
ok('atendente não gera código de pareamento', (await api(pAt, '/api/admin/impressao/pareamento', 'POST')).status === 403)
const c1 = await api(pGer, '/api/admin/impressao/pareamento', 'POST')
ok('gerente gera código XXXX-XXXX', c1.status === 201 && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c1.json?.codigo ?? ''))
ok('banco guarda só o hash do código', !!(await um('select 1 from impressao_pareamentos where codigo_hash=$1', [sha(c1.json.codigo.replace('-', ''))])) &&
  !(await um(`select 1 from impressao_pareamentos where codigo_hash like $1`, [`%${c1.json.codigo}%`])))
const pa = await parear(c1.json.codigo.toLowerCase(), 'PC Cozinha e Caixa')
ok('computador A pareia (código digitado em minúsculas aceito)', pa.status === 201 && pa.json?.credencial?.startsWith('mza_ag_'))
const credA = pa.json.credencial
const A = agente(credA)
ok('banco guarda só o hash da credencial', !!(await um('select 1 from impressao_agentes where credencial_hash=$1', [sha(credA)])) &&
  Number((await um(`select count(*) n from impressao_agentes where credencial_hash like '%mza_ag_%'`)).n) === 0)
ok('código de uso único: segunda troca recusada', (await parear(c1.json.codigo, 'Outro')).status === 401)
const cVencido = await api(pGer, '/api/admin/impressao/pareamento', 'POST')
await db.query(`update impressao_pareamentos set expira_em=now()-interval '1 minute' where codigo_hash=$1`, [sha(cVencido.json.codigo.replace('-', ''))])
ok('código vencido recusado', (await parear(cVencido.json.codigo, 'X')).status === 401)
const cB = await api(pDono, '/api/admin/impressao/pareamento', 'POST')
const pb = await parear(cB.json.codigo, 'PC Bar')
const B = agente(pb.json.credencial)
ok('computador B pareia (dono também gera código)', pb.status === 201)
const auditoria = await q(`select dados::text d from eventos_auditoria where restaurante_id=$1 and acao like 'impressao.%' and criado_em > now()-interval '5 minutes'`, [loja])
ok('auditoria sem código nem credencial', auditoria.length >= 3 && auditoria.every((a) => !a.d.includes('mza_ag_') && !a.d.includes(c1.json.codigo)))
ok('credencial inválida não passa', (await agente('mza_ag_' + 'x'.repeat(43)).get('/api/agente/trabalhos')).status === 401)

secao('Descoberta de impressoras por computador')
ok('A informa duas impressoras', (await A.post('/api/agente/impressoras', { impressoras: ['Impressora 01', 'Impressora 02'] })).status === 200)
ok('B informa uma', (await B.post('/api/agente/impressoras', { impressoras: ['Impressora B'] })).status === 200)
const painel = await api(pGer, '/api/admin/impressao/painel')
const disp = Object.fromEntries(painel.json.dispositivos.map((d) => [d.nomeSistema, d]))
ok('painel do gerente: 2 computadores e 3 impressoras, cada uma no seu computador', painel.json.agentes.length === 2 && painel.json.dispositivos.length === 3 &&
  disp['Impressora B'].agenteId !== disp['Impressora 01'].agenteId && disp['Impressora 01'].agenteId === disp['Impressora 02'].agenteId)
ok('painel não expõe credencial nem hash', !painel.texto.includes('mza_ag_') && !painel.texto.includes('credencial'))
ok('atendente não abre o painel de impressão', (await api(pAt, '/api/admin/impressao/painel')).status === 403)
const tokenLegado = uuid()
await db.query('update restaurantes set impressao_agente_token=$2 where id=$1', [loja, tokenLegado])
ok('token antigo da loja não informa impressoras (só computador pareado)', (await agente(tokenLegado).post('/api/agente/impressoras', { impressoras: ['X'] })).status === 403)
await api(pGer, `/api/admin/impressao/dispositivos/${disp['Impressora 01'].id}`, 'PATCH', { apelido: 'Cozinha 01' })
await api(pGer, `/api/admin/impressao/dispositivos/${disp['Impressora 02'].id}`, 'PATCH', { apelido: 'Caixa 02', larguraMm: 58 })
ok('apelido e largura salvos', (await um('select apelido, largura_mm from impressao_dispositivos where id=$1', [disp['Impressora 02'].id])).largura_mm === 58)
ok('largura inválida recusada', (await api(pGer, `/api/admin/impressao/dispositivos/${disp['Impressora 02'].id}`, 'PATCH', { larguraMm: 72 })).status === 400)

secao('Funções: Cozinha e Caixa')
ok('caixa → Caixa 02', (await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: disp['Impressora 02'].id })).status === 200)
ok('cozinha → Cozinha 01', (await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'cozinha', dispositivoId: disp['Impressora 01'].id })).status === 200)
const semConfirmar = await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: disp['Impressora 01'].id })
ok('mesma impressora nas duas funções sem confirmar: recusado', semConfirmar.status === 409 && semConfirmar.json?.codigo === 'confirmar_compartilhada')
ok('com confirmação explícita: aceito', (await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: disp['Impressora 01'].id, confirmarCompartilhada: true })).status === 200)
await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: disp['Impressora 02'].id })
ok('outra loja não atribui impressora desta loja', (await api(pViz, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'caixa', dispositivoId: disp['Impressora 02'].id })).status === 404)
ok('outra loja não renomeia impressora desta loja', (await api(pViz, `/api/admin/impressao/dispositivos/${disp['Impressora 02'].id}`, 'PATCH', { apelido: 'x' })).status === 404)
ok('outra loja não vê os computadores desta', (await api(pViz, '/api/admin/impressao/painel')).json.agentes.length === 0)

// ════════════════════════════════════════════════════════════════════════════
secao('Mesa com vários pedidos, taxa, desconto, pagamento parcial e item cancelado')
const item = async (nome) => um('select id, nome, preco from itens_cardapio where restaurante_id=$1 and nome=$2', [loja, nome])
const FILE = await item('Filé à Parmegiana')
const AGUA = await item('Água com Gás')
const SUCO = await item('Suco de Laranja')
const mesa = await um(`select m.id, m.nome from mesas m where restaurante_id=$1 and ativa and bloqueada_em is null
  and m.limpeza_desde is null and not exists (select 1 from comandas c where c.mesa_id=m.id and c.status='aberta') order by ordem limit 1`, [loja])
// 0094: mesa abre com o nome do cliente antes do primeiro lançamento.
await api(pAt, `/api/admin/mesas/${mesa.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'Cliente Demonstração', chave: uuid() })
const l1 = await api(pAt, '/api/admin/pdv/lancamento', 'POST', { mesaId: mesa.id, chave: uuid(), itens: [{ itemId: FILE.id, quantidade: 2, complementos: [] }] })
const comanda = l1.json.comandaId
await esperar(300)
await api(pAt, '/api/admin/pdv/lancamento', 'POST', { comandaId: comanda, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }, { itemId: SUCO.id, quantidade: 1, complementos: [] }] })
ok('dois lançamentos na mesa em momentos diferentes', Number((await um('select count(*) n from pedidos where comanda_id=$1', [comanda])).n) === 2)
const contaG = (await api(pGer, `/api/admin/comandas/${comanda}`)).json.conta
const itemSuco = contaG.pedidos.flatMap((p) => p.itens).find((i) => i.nome === SUCO.nome)
await api(pGer, `/api/admin/comandas/${comanda}`, 'POST', { acao: 'cancelar_item', itemId: itemSuco.id, motivo: 'Acabou a laranja' })
await api(pGer, `/api/admin/comandas/${comanda}`, 'POST', { acao: 'ajustar_valores', descontoTipo: 'valor', descontoValor: 5, motivo: 'Cortesia interna do gerente' })
await api(pAt, `/api/admin/comandas/${comanda}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: 20, chave: uuid() })
const tot = await um('select * from comanda_totais($1)', [comanda])

// Estado da conta antes da pré-conta — para provar que ela não muda NADA.
const fotografia = async () => JSON.stringify({
  pedidos: await q('select id, status, atendimento_status, impresso, reimprimir, total, pago from pedidos where comanda_id=$1 order by id', [comanda]),
  comanda: await q('select status, taxa_servico_percentual, desconto_valor, total_final, fechada_em from comandas where id=$1', [comanda]),
  pagamentos: await q('select id, valor, estornado_em from pagamentos_comanda where comanda_id=$1 order by id', [comanda]),
  reservasCozinha: await q('select pedido_id from impressao_reservas r join pedidos p on p.id=r.pedido_id where p.comanda_id=$1', [comanda]),
})
const antes = await fotografia()

secao('Pré-conta: valores do servidor, idempotência, vias')
const chave1 = uuid()
const pc1 = await api(pAt, `/api/admin/comandas/${comanda}/pre-conta`, 'POST', {
  chave: chave1, total: 0.01, subtotal: 0.01, itens: [], impressora: disp['Impressora B'].id, restauranteId: vizinha, via: 9,
})
ok('atendente imprime pré-conta', pc1.status === 201 && pc1.json?.via === 1, pc1.json?.error)
const job1 = await um('select * from impressao_trabalhos where id=$1', [pc1.json.id])
ok('valores forjados ignorados: total do servidor', Number(job1.snapshot.total) === Number(tot.total) && Number(job1.snapshot.restante) === Number(tot.restante))
ok('destino forjado ignorado: impressora de Caixa, loja da sessão, via 1', job1.dispositivo_id === disp['Impressora 02'].id && job1.restaurante_id === loja && job1.via === 1)
const s = job1.snapshot
ok('snapshot: taxa 10% da mesa, desconto 5, pago 20 em pix', Number(s.taxa_percentual) === 10 && Number(s.desconto) === 5 && Number(s.pago) === 20 && s.pagamentos.some((p) => p.forma === 'pix' && Number(p.valor) === 20))
ok('snapshot: itens cobrados sem o cancelado; cancelado à parte', s.itens.every((i) => i.nome !== SUCO.nome) && s.cancelados.some((c) => c.nome === SUCO.nome))
ok('snapshot: sem telefone, endereço ou motivo do desconto', !JSON.stringify(s).includes('Cortesia interna') && !('cliente_telefone' in s) && !('endereco' in s))
ok('snapshot da mesa: nome da mesa e número da comanda', s.mesa === mesa.nome && Number.isInteger(s.comanda_numero))
ok('clique duplo (mesma chave): o mesmo trabalho', (await api(pAt, `/api/admin/comandas/${comanda}/pre-conta`, 'POST', { chave: chave1 })).json?.id === pc1.json.id)
ok('outra aba (outra chave) em seguida: o mesmo trabalho', (await api(pAt, `/api/admin/comandas/${comanda}/pre-conta`, 'POST', { chave: uuid() })).json?.id === pc1.json.id)
ok('pré-conta não mudou nada na conta, pedidos, pagamentos nem cozinha', (await fotografia()) === antes)
ok('pré-conta auditada', !!(await um(`select 1 from eventos_auditoria where acao='impressao.pre_conta' and entidade_id=$1 and dados->>'via'='1'`, [comanda])))
ok('snapshot imutável', /trabalho_imutavel/.test((await erroSql(`update impressao_trabalhos set snapshot='{}'::jsonb where id=$1`, [pc1.json.id])) ?? ''))
ok('via e destino imutáveis', /trabalho_imutavel/.test((await erroSql(`update impressao_trabalhos set via=5 where id=$1`, [pc1.json.id])) ?? ''))

// Dois operadores ao mesmo tempo (primeira via de outra comanda): um trabalho só.
const lb = await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Cliente Impressão', chave: uuid() })
await api(pAt, '/api/admin/pdv/lancamento', 'POST', { comandaId: lb.json.id, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 2, complementos: [] }] })
const [o1, o2] = await Promise.all([
  api(pAt, `/api/admin/comandas/${lb.json.id}/pre-conta`, 'POST', { chave: uuid() }),
  api(pGer, `/api/admin/comandas/${lb.json.id}/pre-conta`, 'POST', { chave: uuid() }),
])
ok('dois operadores juntos na primeira via: um trabalho', o1.json?.id && o1.json.id === o2.json?.id, `${o1.status}/${o2.status}`)
const sb = (await um('select snapshot from impressao_trabalhos where id=$1', [o1.json.id])).snapshot
ok('balcão: senha, nome, taxa 0', sb.tipo === 'balcao' && Number.isInteger(sb.senha) && sb.cliente_nome === 'Cliente Impressão' && Number(sb.taxa) === 0)

secao('Agentes consumindo a fila')
ok('B não recebe trabalho de impressora que não é dele', ((await B.get('/api/agente/trabalhos')).json?.trabalhos ?? []).length === 0)
const [ra, rb] = await Promise.all([A.get('/api/agente/trabalhos'), A.get('/api/agente/trabalhos')])
const ids = [...(ra.json?.trabalhos ?? []), ...(rb.json?.trabalhos ?? [])].map((t) => t.id)
ok('duas consultas simultâneas do mesmo agente: nenhum trabalho duplicado', ids.length === new Set(ids).size && ids.includes(pc1.json.id))
const tA = [...(ra.json?.trabalhos ?? []), ...(rb.json?.trabalhos ?? [])].find((t) => t.id === pc1.json.id)
ok('trabalho chega com destino (nome no Windows e largura), snapshot e prazo', tA.nomeSistema === 'Impressora 02' && tA.larguraMm === 58 && tA.segundosRestantes > 500 && tA.snapshot.total !== undefined)
ok('B não informa resultado de trabalho de A', (await B.post(`/api/agente/trabalhos/${pc1.json.id}/resultado`, { ok: true })).status === 404)
const rOk = await A.post(`/api/agente/trabalhos/${pc1.json.id}/resultado`, { ok: true })
ok('resultado: aceito pela fila do Windows (enviado_spooler), não "impresso"', rOk.json?.estado === 'enviado_spooler')
ok('impressora registra último uso', !!(await um('select ultimo_uso_em from impressao_dispositivos where id=$1', [disp['Impressora 02'].id])).ultimo_uso_em)
for (const t of [...(ra.json?.trabalhos ?? []), ...(rb.json?.trabalhos ?? [])]) if (t.id !== pc1.json.id) await A.post(`/api/agente/trabalhos/${t.id}/resultado`, { ok: true })
ok('pré-conta impressa não mudou a conta', (await fotografia()) === antes)

// Segunda via depois de a conta mudar.
await api(pAt, `/api/admin/comandas/${comanda}`, 'POST', { acao: 'pagamento', forma: 'debito', valor: 10, chave: uuid() })
const pc2 = await api(pAt, `/api/admin/comandas/${comanda}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
const job2 = await um('select via, snapshot from impressao_trabalhos where id=$1', [pc2.json.id])
const job1depois = await um('select snapshot from impressao_trabalhos where id=$1', [pc1.json.id])
ok('reimpressão explícita cria a 2ª via', pc2.status === 201 && job2.via === 2)
ok('2ª via com o pagamento novo; 1ª via continua como foi impressa', Number(job2.snapshot.pago) === 30 && Number(job1depois.snapshot.pago) === 20)
ok('2ª via auditada', !!(await um(`select 1 from eventos_auditoria where acao='impressao.pre_conta' and entidade_id=$1 and dados->>'via'='2'`, [comanda])))
const vias = (await api(pAt, `/api/admin/comandas/${comanda}/pre-conta`)).json.vias
ok('PDV vê as vias com impressora e estado', vias[0].via === 2 && vias[0].impressora === 'Caixa 02' && vias[1].estado === 'enviado_spooler')

secao('Falhas: tentativas, reserva abandonada, vencimento, impressora sumida')
const tRes = await A.get('/api/agente/trabalhos')
const t2 = (tRes.json?.trabalhos ?? []).find((t) => t.id === pc2.json.id)
ok('2ª via reservada para A', !!t2)
for (let i = 0; i < 4; i++) {
  await A.post(`/api/agente/trabalhos/${pc2.json.id}/resultado`, { ok: false, erro: "Impressora 'Impressora 02' nao encontrada no Windows." })
  if (i === 0) ok('depois da falha, espera antes de tentar de novo', !((await A.get('/api/agente/trabalhos')).json?.trabalhos ?? []).some((t) => t.id === pc2.json.id))
  // Simula a passagem da espera (10 s × tentativas) sem dormir no teste.
  await db.query(`update impressao_trabalhos set reservado_ate = now() - interval '1 second' where id = $1`, [pc2.json.id])
  await A.get('/api/agente/trabalhos')
}
const r5 = await A.post(`/api/agente/trabalhos/${pc2.json.id}/resultado`, { ok: false, erro: 'sem papel' })
ok('cinco tentativas com erro: falhou', r5.json?.estado === 'falhou', r5.json?.estado)
ok('trabalho falhado não volta para a fila', !((await A.get('/api/agente/trabalhos')).json?.trabalhos ?? []).some((t) => t.id === pc2.json.id))
ok('último erro registrado na impressora', /sem papel/.test((await um('select ultimo_erro from impressao_dispositivos where id=$1', [disp['Impressora 02'].id])).ultimo_erro ?? ''))
const pc3 = await api(pGer, `/api/admin/comandas/${comanda}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
await A.get('/api/agente/trabalhos')
await db.query(`update impressao_trabalhos set reservado_ate=now()-interval '1 second' where id=$1`, [pc3.json.id])
const volta = (await A.get('/api/agente/trabalhos')).json?.trabalhos ?? []
ok('reserva abandonada volta para a fila (tentativa 2)', volta.some((t) => t.id === pc3.json.id && t.tentativas === 2))
await A.post(`/api/agente/trabalhos/${pc3.json.id}/resultado`, { ok: true })
const pc4 = await api(pGer, `/api/admin/comandas/${comanda}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
await db.query(`begin; set local session_replication_role = replica; update impressao_trabalhos set expira_em=now()-interval '1 second' where id='${pc4.json.id}'; commit;`)
ok('pré-conta com mais de 10 min não sai', !((await A.get('/api/agente/trabalhos')).json?.trabalhos ?? []).some((t) => t.id === pc4.json.id))
ok('e fica marcada como expirada', (await um('select estado from impressao_trabalhos where id=$1', [pc4.json.id])).estado === 'expirado')
await A.post('/api/agente/impressoras', { impressoras: ['Impressora 01'] })
ok('impressora que sumiu do Windows fica indisponível', (await um('select disponivel from impressao_dispositivos where id=$1', [disp['Impressora 02'].id])).disponivel === false)
ok('e a função Caixa NÃO é trocada por outra', (await um(`select dispositivo_id from impressao_funcoes where restaurante_id=$1 and funcao='caixa'`, [loja])).dispositivo_id === disp['Impressora 02'].id)
const pc5 = await api(pAt, `/api/admin/comandas/${comanda}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
ok('pré-conta continua pendente para a impressora de Caixa (sem fallback para a cozinha)', pc5.status === 201 && (await um('select dispositivo_id from impressao_trabalhos where id=$1', [pc5.json.id])).dispositivo_id === disp['Impressora 02'].id)
await A.post('/api/agente/impressoras', { impressoras: ['Impressora 01', 'Impressora 02'] })
await db.query(`update impressao_agentes set visto_em=now()-interval '5 minutes' where credencial_hash=$1`, [sha(credA)])
const viaOff = (await api(pAt, `/api/admin/comandas/${comanda}/pre-conta`)).json.vias[0]
ok('PDV avisa que o computador do Caixa está offline', viaOff.id === pc5.json.id && viaOff.computadorOnline === false && viaOff.estado === 'pendente')

secao('Teste de impressora e permissões')
const teste = await api(pGer, `/api/admin/impressao/dispositivos/${disp['Impressora B'].id}`, 'POST', { acao: 'teste', chave: uuid() })
ok('gerente pede teste: vai só para a impressora escolhida', teste.status === 201 && ((await B.get('/api/agente/trabalhos')).json?.trabalhos ?? []).some((t) => t.id === teste.json.id && t.tipo === 'teste_impressora'))
ok('atendente não pede teste', (await api(pAt, `/api/admin/impressao/dispositivos/${disp['Impressora B'].id}`, 'POST', { acao: 'teste', chave: uuid() })).status === 403)
ok('outra loja não pede teste nesta impressora', (await api(pViz, `/api/admin/impressao/dispositivos/${disp['Impressora B'].id}`, 'POST', { acao: 'teste', chave: uuid() })).status >= 400)
ok('outra loja não imprime pré-conta desta conta', (await api(pViz, `/api/admin/comandas/${comanda}/pre-conta`, 'POST', { chave: uuid() })).status === 404)
const cViz = await api(pViz, '/api/admin/impressao/pareamento', 'POST')
const V = agente((await parear(cViz.json.codigo, 'PC Vizinha')).json.credencial)
ok('agente de outra loja não recebe trabalhos desta', ((await V.get('/api/agente/trabalhos')).json?.trabalhos ?? []).length === 0)
ok('nem informa resultado de trabalho desta', (await V.post(`/api/agente/trabalhos/${pc5.json.id}/resultado`, { ok: true })).status === 404)
ok('nem recebe a fila da cozinha desta', ((await V.get('/api/agente/pedidos')).json?.pedidos ?? []).every((p) => p.clienteNome !== mesa.nome))
await db.query('update restaurantes set pdv_v2=false where id=$1', [vizinha])

secao('Taxa manual no balcão (comanda.taxa)')
const cbal = lb.json.id
const tAt = await api(pAt, `/api/admin/comandas/${cbal}`, 'POST', { acao: 'ajustar_valores', taxaServico: 10 })
ok('atendente (mesmo com desconto liberado ao caixa) não aplica taxa no balcão', tAt.status === 403 && tAt.json?.codigo === 'sem_permissao_taxa')
ok('atendente dá desconto (regra atual)', (await api(pAt, `/api/admin/comandas/${cbal}`, 'POST', { acao: 'ajustar_valores', descontoTipo: 'valor', descontoValor: 1, motivo: 'arredondamento' })).status === 200)
ok('gerente aplica taxa manual no balcão', (await api(pGer, `/api/admin/comandas/${cbal}`, 'POST', { acao: 'ajustar_valores', taxaServico: 10 })).status === 200)
ok('percentual fora do permitido recusado pelo servidor', (await api(pGer, `/api/admin/comandas/${cbal}`, 'POST', { acao: 'ajustar_valores', taxaServico: 50 })).status === 400)
ok('mudança de taxa auditada', !!(await um(`select 1 from eventos_auditoria where acao='conta.alterou_taxa' and entidade_id=$1`, [cbal])))
const restBal = (await api(pAt, `/api/admin/comandas/${cbal}`)).json.conta.totais.restante
await api(pAt, `/api/admin/comandas/${cbal}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: restBal, chave: uuid() })
const baixa = await api(pGer, `/api/admin/comandas/${cbal}`, 'POST', { acao: 'ajustar_valores', taxaServico: 0, descontoTipo: 'valor', descontoValor: 14, motivo: 'teste de limite' })
ok('taxa/desconto que deixariam o total abaixo do já pago: recusado (estornar antes)', baixa.status === 409 && baixa.json?.codigo === 'pagamento_excede_total')
ok('balcão novo nasce com taxa 0', Number((await um('select taxa_servico_percentual t from comandas where id=$1', [(await api(pAt, '/api/admin/balcao/comandas', 'POST', { nome: 'Taxa Zero', chave: uuid() })).json.id])).t) === 0)

secao('Cozinha: modo de sempre e roteamento por função')
await db.query(`update impressao_agentes set visto_em=now() where credencial_hash=$1`, [sha(credA)])
const kped = await api(pAt, '/api/admin/pdv/lancamento', 'POST', { comandaId: cbal, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }] })
const legado = await fetch(`${BASE}/api/agente/pedidos`, { headers: { Authorization: `Bearer ${tokenLegado}` } }).then((r) => r.json())
ok('flag desligada: Assistente antigo (token) lista a ficha como sempre', legado.pedidos.some((p) => p.id === kped.json.id))
ok('ficha da cozinha nunca aparece na fila de pré-conta', !((await A.get('/api/agente/trabalhos')).json?.trabalhos ?? []).some((t) => t.id === kped.json.id))
await db.query('update restaurantes set impressao_agente_visto_em=now() where id=$1', [loja])
const liga1 = await api(pGer, '/api/admin/impressao/cozinha-por-funcao', 'PUT', { ativo: true })
ok('não liga com Assistente antigo em uso (evita ficha em dobro na troca)', liga1.status === 409 && liga1.json?.codigo === 'assistente_antigo_ativo')
await db.query(`update restaurantes set impressao_agente_visto_em=now()-interval '5 minutes' where id=$1`, [loja])
ok('liga quando é seguro', (await api(pGer, '/api/admin/impressao/cozinha-por-funcao', 'PUT', { ativo: true })).status === 200)
await db.query('delete from impressao_reservas where restaurante_id=$1', [loja])
const legado2 = await fetch(`${BASE}/api/agente/pedidos`, { headers: { Authorization: `Bearer ${tokenLegado}`, 'X-Agente-Instancia': 'antigo-x-12345' } }).then((r) => r.json())
ok('ligada: Assistente antigo não recebe a ficha', !(legado2.pedidos ?? []).some((p) => p.id === kped.json.id))
ok('ligada: outro computador pareado (B) não recebe', !(((await B.get('/api/agente/pedidos')).json?.pedidos) ?? []).some((p) => p.id === kped.json.id))
const kA = (await A.get('/api/agente/pedidos')).json
ok('ligada: só o computador da Cozinha recebe, com destino Cozinha 01', kA.pedidos.some((p) => p.id === kped.json.id) && kA.destinoCozinha?.nomeSistema === 'Impressora 01')
ok('e a ficha fica reservada para ele (sem duplicidade)', !!(await um(`select 1 from impressao_reservas where pedido_id=$1 and reservado_por like 'agente-%'`, [kped.json.id])))
ok('confirmar ficha pelo agente marca impresso (fila antiga intacta)', (await A.post(`/api/agente/pedidos/${kped.json.id}/imprimir`)).status === 200 && (await um('select impresso from pedidos where id=$1', [kped.json.id])).impresso === true)
ok('tirar a função Cozinha desliga o roteamento (volta ao modo de sempre)', (await api(pGer, '/api/admin/impressao/funcoes', 'PUT', { funcao: 'cozinha', dispositivoId: null })).status === 200 &&
  (await um('select impressao_cozinha_por_funcao f from restaurantes where id=$1', [loja])).f === false)

secao('Revogação')
ok('gerente revoga o computador A', (await api(pGer, `/api/admin/impressao/agentes/${(await um('select id from impressao_agentes where credencial_hash=$1', [sha(credA)])).id}`, 'POST', { acao: 'revogar' })).status === 200)
ok('A revogado não busca mais trabalhos', (await A.get('/api/agente/trabalhos')).status === 401)
ok('nem a fila da cozinha', (await A.get('/api/agente/pedidos')).status === 401)
ok('trabalhos pendentes dele foram cancelados', (await um('select estado from impressao_trabalhos where id=$1', [pc5.json.id])).estado === 'cancelado')
const semDestino = await api(pAt, `/api/admin/comandas/${comanda}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
ok('pré-conta com Caixa em computador revogado: erro claro, nada enfileirado', semDestino.status === 409 && semDestino.json?.codigo === 'impressora_caixa_indisponivel')
await db.query(`delete from impressao_funcoes where restaurante_id=$1`, [loja])
const semCaixa = await api(pAt, `/api/admin/comandas/${comanda}/pre-conta`, 'POST', { chave: uuid(), reimpressao: true })
ok('sem impressora de Caixa: erro com orientação', semCaixa.status === 409 && semCaixa.json?.codigo === 'impressora_caixa_nao_configurada' && /Ajustes › Impressão/.test(semCaixa.json?.error ?? ''))
ok('B segue funcionando depois da revogação de A', (await B.get('/api/agente/trabalhos')).status === 200)

// limpeza
await db.query('update restaurantes set impressao_agente_token=null, impressao_cozinha_por_funcao=false where id=$1', [loja])
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza teste impressão', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja])
await browser.close()
await db.end()
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
