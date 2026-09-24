// E2E local: card preto com Retirada/Entrega, destino da entrega pronta (Logística
// ligada/desligada), Detalhes com etiquetas e card do Kanban. Só banco LOCAL e só
// dados de teste (clientes "E2E Balcão …"); nada é apagado. As flags de logística da
// loja voltam ao valor original no fim.
//   node scripts/seguranca/e2e-balcao-entrega.mjs [pasta-de-screenshots]
import { chromium } from 'playwright'
import pg from 'pg'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
exigirLoopback(BASE)
const SHOTS = process.argv[2] ?? null
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`${c ? '✔' : '✘'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const SUF = Date.now().toString().slice(-6)

const loja = await um(`select id, usa_logistica, entrega_sem_entregador, pdv_v2 from restaurantes where slug = 'cantina-demo'`)
const flagsOriginais = { usa: loja.usa_logistica, sem: loja.entrega_sem_entregador, v2: loja.pdv_v2 }
await q(`update restaurantes set pdv_v2 = true where id = $1`, [loja.id])
const agua = await um(`select id, preco from itens_cardapio where restaurante_id = $1 and nome = 'Água com Gás'`, [loja.id])

const browser = await chromium.launch()
async function logar(usuario, w = 1366, h = 768) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', isMobile: w < 900, hasTouch: w < 900 })
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', usuario)
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }), p.click('button[type="submit"]')])
  await p.waitForLoadState('networkidle')
  return p
}
const dispensar = (p) => p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}, { url, metodo, corpo })
const foto = async (p, nome) => { if (SHOTS) await p.screenshot({ path: join(SHOTS, `${nome}.png`) }) }
const ENDERECO = { cep: '29050-100', rua: 'Rua E2E', numero: '10', bairro: 'Centro', cidade: 'Vitória', estado: 'ES', complemento: '', referencia: 'Perto da praça' }

try {
  const g = await logar('atendente.local')

  secao('Card preto: escolha obrigatória')
  await g.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' }); await dispensar(g)
  await g.getByTestId('card-balcao').click()
  await g.getByTestId('balcao-novo').click()
  ok('sem escolher Retirada/Entrega, "Abrir" fica desabilitado', await g.getByTestId('balcao-abrir').isDisabled())
  ok('nome e telefone só aparecem depois da escolha', (await g.getByTestId('balcao-nome').count()) === 0)
  await foto(g, '01-card-preto-escolha')
  await g.getByTestId('balcao-modalidade-retirada').click()
  ok('Retirada não pede endereço', (await g.getByTestId('balcao-entrega').count()) === 0)
  await g.getByTestId('balcao-abrir').click()
  ok('nome continua obrigatório', (await g.getByTestId('balcao-erro').innerText()).includes('nome'))
  const nomeRet = `E2E Balcão Retirada ${SUF}`
  await g.getByTestId('balcao-nome').fill(nomeRet)
  await g.getByTestId('balcao-abrir').click()
  await g.waitForTimeout(1500)
  const cRet = await um(`select id, entrega, taxa_entrega from comandas where restaurante_id = $1 and cliente_nome = $2`, [loja.id, nomeRet])
  ok('Retirada abre sem telefone e sem endereço', cRet && cRet.entrega === false && Number(cRet.taxa_entrega) === 0)

  secao('Card preto: Entrega')
  await g.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' })
  await g.getByTestId('card-balcao').click()
  await g.getByTestId('balcao-novo').click()
  await g.getByTestId('balcao-modalidade-entrega').click()
  const nomeEnt = `E2E Balcão Entrega ${SUF}`
  await g.getByTestId('balcao-nome').fill(nomeEnt)
  await g.getByTestId('balcao-abrir').click()
  const erroFaltando = await g.getByTestId('balcao-erro').innerText()
  ok('entrega sem endereço diz o que falta', /CEP.*rua.*número.*bairro.*cidade.*estado/.test(erroFaltando), erroFaltando)
  await g.getByTestId('entrega-cep').fill('01001-000')
  await g.waitForTimeout(3000)
  const ruaAuto = await g.getByTestId('entrega-rua').inputValue()
  const ufAuto = await g.getByTestId('entrega-estado').inputValue()
  ok('busca pelo CEP preenche rua, cidade e UF', /Pra[cç]a da S[eé]/i.test(ruaAuto) && ufAuto === 'SP', `${ruaAuto} / ${ufAuto}`)
  await g.getByTestId('entrega-cep').fill('29050-100')
  await g.waitForTimeout(2500)
  ok('CEP inexistente avisa para preencher à mão', /CEP não encontrado/.test(await g.getByTestId('balcao-entrega').innerText()))
  for (const k of ['rua', 'numero', 'bairro', 'cidade', 'estado', 'referencia']) await g.getByTestId(`entrega-${k}`).fill(ENDERECO[k])
  await g.getByTestId('entrega-taxa').fill('7,50')
  await foto(g, '02-card-preto-entrega')
  await g.getByTestId('balcao-abrir').click()
  await g.waitForTimeout(1500)
  const cEnt = await um(`select id, entrega, entrega_cidade, entrega_cep, entrega_referencia, taxa_entrega, taxa_entrega_manual from comandas where restaurante_id = $1 and cliente_nome = $2`, [loja.id, nomeEnt])
  ok('Entrega abre com o endereço completo', cEnt?.entrega === true && cEnt.entrega_cep === '29050100' && cEnt.entrega_referencia === ENDERECO.referencia, JSON.stringify(cEnt))
  ok('UF gravada junto da cidade', cEnt?.entrega_cidade === 'Vitória/ES', cEnt?.entrega_cidade)
  ok('taxa digitada marcada como manual', Number(cEnt?.taxa_entrega) === 7.5 && cEnt?.taxa_entrega_manual === true)

  secao('Servidor não confia no navegador')
  ok('modalidade inválida recusada', (await api(g, '/api/admin/balcao/comandas', 'POST', { nome: 'X', chave: uuid(), modalidade: 'mesa' })).s === 400)
  ok('entrega sem UF recusada', (await api(g, '/api/admin/balcao/comandas', 'POST', { nome: 'X', chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, estado: '' } })).s === 400)
  const forjada = await api(g, '/api/admin/balcao/comandas', 'POST', { nome: `E2E Balcão Forjado ${SUF}`, chave: uuid(), modalidade: 'retirada', origem: 'cardapio', canal: 'delivery', tipo: 'entrega', taxaEntrega: 99 })
  const cf = await um(`select tipo, entrega, taxa_entrega from comandas where id = $1`, [forjada.j?.id])
  ok('origem/canal/tipo/taxa do navegador ignorados', forjada.s === 201 && cf.tipo === 'balcao' && cf.entrega === false && Number(cf.taxa_entrega) === 0)

  secao('Pedidos para a cozinha')
  const lRet = await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: cRet.id, chave: uuid(), itens: [{ itemId: agua.id, quantidade: 1, complementos: [] }] })
  const lEnt = await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: cEnt.id, chave: uuid(), itens: [{ itemId: agua.id, quantidade: 2, complementos: [] }] })
  ok('lança na retirada e na entrega', lRet.s === 201 && lEnt.s === 201, `${lRet.s} ${lEnt.s}`)
  const pRet = await um(`select id, numero, tipo, canal, origem from pedidos where comanda_id = $1`, [cRet.id])
  const pEnt = await um(`select id, numero, tipo, canal, origem, endereco_rua, endereco_cidade, taxa_entrega, total from pedidos where comanda_id = $1`, [cEnt.id])
  ok('retirada: PDV, canal balcão, tipo retirada', pRet?.origem === 'pdv' && pRet.canal === 'balcao' && pRet.tipo === 'retirada')
  ok('entrega: PDV, canal balcão, tipo entrega, endereço e taxa no pedido', pEnt?.origem === 'pdv' && pEnt.canal === 'balcao' && pEnt.tipo === 'entrega' && pEnt.endereco_rua === 'Rua E2E' && pEnt.endereco_cidade === 'Vitória/ES' && Number(pEnt.taxa_entrega) === 7.5)
  ok('preço do servidor (2 × água + taxa)', Number(pEnt.total) === Number(agua.preco) * 2 + 7.5, String(pEnt.total))

  secao('Logística LIGADA: entrega pronta vai para a Logística')
  await q(`update restaurantes set usa_logistica = true, entrega_sem_entregador = false where id = $1`, [loja.id])
  const k = await logar('gerente.local')
  await k.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' }); await dispensar(k)
  const card = (n) => k.getByTestId(`pedido-${n}`)
  await card(pEnt.numero).getByRole('button', { name: 'Aceitar' }).click(); await k.waitForTimeout(900)
  await card(pEnt.numero).getByRole('button', { name: 'Pronto' }).click(); await k.waitForTimeout(1500)
  ok('fica em "pronto"', (await um(`select status from pedidos where id = $1`, [pEnt.id])).status === 'pronto')
  ok('card mostra NA LOGÍSTICA com capacete', await card(pEnt.numero).getByTestId('card-na-logistica').isVisible())
  const aud1 = await um(`select dados from eventos_auditoria where entidade_id = $1 and acao = 'pedido.entrega_balcao_destino'`, [pEnt.id])
  ok('auditoria registra caminho "logistica"', aud1?.dados?.caminho === 'logistica')
  const cardTxt = await card(pEnt.numero).innerText()
  ok('card sem forma de pagamento', !/Dinheiro|Pix|Cartão/i.test(cardTxt))
  ok('card com ENTREGA em destaque', await card(pEnt.numero).getByTestId('etiqueta-entrega').isVisible())
  await foto(k, '03-kanban-na-logistica')
  await k.goto(`${BASE}/admin/logistica`, { waitUntil: 'networkidle' }); await dispensar(k); await k.waitForTimeout(1200)
  ok('aparece na Logística para despachar', (await k.locator('body').innerText()).includes(`#${pEnt.numero}`))
  await foto(k, '04-logistica')

  secao('Retirada pronta: conclusão local de sempre')
  await k.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  await card(pRet.numero).getByRole('button', { name: 'Aceitar' }).click(); await k.waitForTimeout(900)
  await card(pRet.numero).getByRole('button', { name: 'Pronto' }).click(); await k.waitForTimeout(1200)
  ok('retirada fica pronta com o botão Entregue', (await um(`select status from pedidos where id = $1`, [pRet.id])).status === 'pronto' && await card(pRet.numero).getByRole('button', { name: 'Entregue' }).isVisible())
  ok('card com RETIRADA em destaque', await card(pRet.numero).getByTestId('etiqueta-retirada').isVisible())

  secao('Detalhes: etiquetas no canto')
  await card(pRet.numero).getByTestId('card-detalhes').click(); await k.waitForTimeout(500)
  const et = await k.getByTestId('etiquetas-pedido').innerText()
  ok('Detalhes mostram PDV e RETIRADA', /PDV/.test(et) && /RETIRADA/.test(et), et.replace(/\s+/g, ' '))
  await foto(k, '05-detalhes')
  await k.keyboard.press('Escape'); await k.mouse.click(5, 300)

  secao('Logística DESLIGADA: entrega pronta é concluída sozinha')
  await q(`update restaurantes set usa_logistica = false, entrega_sem_entregador = false where id = $1`, [loja.id])
  const nome2 = `E2E Balcão Entrega2 ${SUF}`
  const c2 = await api(g, '/api/admin/balcao/comandas', 'POST', { nome: nome2, chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, taxa: '5' } })
  await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: c2.j.id, chave: uuid(), itens: [{ itemId: agua.id, quantidade: 1, complementos: [] }] })
  const p2 = await um(`select id, numero from pedidos where comanda_id = $1`, [c2.j.id])
  await k.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' }); await k.waitForTimeout(800)
  await card(p2.numero).getByRole('button', { name: 'Aceitar' }).click(); await k.waitForTimeout(900)
  await card(p2.numero).getByRole('button', { name: 'Pronto' }).click(); await k.waitForTimeout(2000)
  const s2 = await um(`select status, atendimento_status from pedidos where id = $1`, [p2.id])
  ok('concluída na hora (não fica em Pronto p/ despacho)', s2.status === 'entregue' && s2.atendimento_status === 'concluido', JSON.stringify(s2))
  const aud2 = await um(`select dados from eventos_auditoria where entidade_id = $1 and acao = 'pedido.entrega_balcao_destino'`, [p2.id])
  ok('auditoria registra "conclusao_automatica"', aud2?.dados?.caminho === 'conclusao_automatica')
  await k.reload({ waitUntil: 'networkidle' }); await k.waitForTimeout(800)
  ok('sem "NA LOGÍSTICA" enganoso na tela', (await k.getByTestId('card-na-logistica').count()) === 0)
  await foto(k, '06-kanban-logistica-desligada')

  await k.context().close(); await g.context().close()
} catch (e) {
  ok('execução', false, e.message.split('\n')[0])
} finally {
  await q(`update restaurantes set usa_logistica = $2, entrega_sem_entregador = $3 where id = $1`, [loja.id, flagsOriginais.usa, flagsOriginais.sem])
  await browser.close(); await db.end()
}
const f = res.filter((x) => !x).length
console.log(`\n${res.length - f}/${res.length} passaram`)
process.exit(f ? 1 : 0)
