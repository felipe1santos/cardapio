// E2E local: card preto com Retirada/Entrega, destino da entrega pronta (Logística
// ligada/desligada), Detalhes com etiquetas e card do Kanban. Só banco LOCAL e só
// dados de teste (clientes "E2E Balcão …"); nada é apagado. As flags de logística da
// loja e a tabela de frete voltam ao valor original no fim.
//   node scripts/seguranca/e2e-balcao-entrega.mjs [pasta-de-screenshots]
import { chromium } from 'playwright'
import pg from 'pg'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { E2E_LOJA, E2E_VIZINHA, USU, exigirLojaIsolada } from './e2e-ambiente.mjs'

// Loja ISOLADA obrigatória: esta suíte escreve na loja (comandas, pedidos, flags). Sem
// E2E_LOJA/E2E_VIZINHA/E2E_SUFIXO ela aborta aqui, antes de qualquer escrita — nunca roda
// na cantina-demo.  E2E_LOJA=cantina-e2e E2E_VIZINHA=vizinha-e2e E2E_SUFIXO=e2e node <script>
exigirLojaIsolada()

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

const loja = await um(`select id, usa_logistica, entrega_sem_entregador, pdv_v2 from restaurantes where slug = '${E2E_LOJA}'`)
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
let bairroCriado = null
const ENDERECO = { cep: '29050-100', rua: 'Rua E2E', numero: '10', bairro: 'Centro', cidade: 'Vitória', estado: 'ES', complemento: '', referencia: 'Perto da praça' }

try {
  const g = await logar(USU.atendente)

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
  const avisoCep = await g.getByTestId('balcao-entrega').innerText()
  // ViaCEP é externo: CEP inexistente ("não encontrado") ou serviço fora (502) → os dois mandam preencher à mão.
  ok('CEP inexistente/ViaCEP fora avisa para preencher à mão', /(CEP não encontrado|Não deu para buscar o CEP agora)\. Preencha o endereço à mão/.test(avisoCep), avisoCep.split('\n').find((l) => l.includes('à mão')))
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
  const retEnd = await api(g, '/api/admin/balcao/comandas', 'POST', { nome: `E2E Balcão RetEnd ${SUF}`, chave: uuid(), modalidade: 'retirada', entrega: { ...ENDERECO, taxa: '9' } })
  const cre = await um(`select entrega, entrega_rua, entrega_cep, taxa_entrega from comandas where id = $1`, [retEnd.j?.id])
  ok('Retirada com endereço forjado: servidor descarta endereço e taxa', retEnd.s === 201 && cre.entrega === false && !cre.entrega_rua && !cre.entrega_cep && Number(cre.taxa_entrega) === 0, JSON.stringify(cre))
  const semTel = await api(g, '/api/admin/balcao/comandas', 'POST', { nome: `E2E Balcão SemTel ${SUF}`, telefone: '', chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, taxa: '3' } })
  ok('telefone vazio é aceito (inclusive na entrega)', semTel.s === 201, `${semTel.s} ${semTel.j?.error ?? ''}`)

  secao('Tentativas inválidas: nenhuma cria comanda nem pedido')
  const contar = async () => um(`select (select count(*) from comandas where restaurante_id = $1)::int c, (select count(*) from pedidos where restaurante_id = $1)::int p`, [loja.id])
  const antes = await contar()
  const INVALIDAS = [
    ['sem nome', { nome: '', chave: uuid(), modalidade: 'retirada' }],
    ['nome só com espaços', { nome: '   ', chave: uuid(), modalidade: 'retirada' }],
    ['sem chave de operação', { nome: 'X', modalidade: 'retirada' }],
    ['entrega sem endereço', { nome: 'X', chave: uuid(), modalidade: 'entrega' }],
    ...['cep', 'rua', 'numero', 'bairro', 'cidade'].map((c) => [`entrega sem ${c}`, { nome: 'X', chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, [c]: '' } }]),
    ['entrega com CEP curto', { nome: 'X', chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, cep: '2905' } }],
    ['entrega com UF inventada', { nome: 'X', chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, estado: 'XX' } }],
    ['taxa negativa', { nome: 'X', chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, taxa: -5 } }],
    ['taxa absurda', { nome: 'X', chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, taxa: 5000 } }],
    ['taxa que não é número', { nome: 'X', chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, taxa: 'abc' } }],
  ]
  for (const [n, corpo] of INVALIDAS) {
    const r = await api(g, '/api/admin/balcao/comandas', 'POST', corpo)
    ok(`abertura ${n}: recusada`, r.s === 400, r.j?.error)
  }
  // Lançamentos inválidos numa comanda de balcão válida.
  const burger = await um(`select id, preco from itens_cardapio where restaurante_id = $1 and nome = 'Burger da Casa'`, [loja.id])
  const itemVizinha = await um(`select i.id from itens_cardapio i join restaurantes r on r.id = i.restaurante_id where r.slug = '${E2E_VIZINHA}' limit 1`)
  const LANC = [
    ['item inexistente', [{ itemId: uuid(), quantidade: 1, complementos: [] }]],
    ['item de outra loja', [{ itemId: itemVizinha?.id ?? uuid(), quantidade: 1, complementos: [] }]],
    ['quantidade zero', [{ itemId: agua.id, quantidade: 0, complementos: [] }]],
    ['quantidade negativa', [{ itemId: agua.id, quantidade: -2, complementos: [] }]],
    ['grupo obrigatório sem resposta', [{ itemId: burger.id, quantidade: 1, complementos: ['Ao ponto'] }]],
    ['acima do máximo do grupo', [{ itemId: burger.id, quantidade: 1, complementos: ['Ao ponto', 'Bem passado', 'Suco de laranja'] }]],
    ['opção que não existe', [{ itemId: burger.id, quantidade: 1, complementos: ['Ao ponto', 'Suco de laranja', 'Caviar'] }]],
    ['sem itens', []],
  ]
  for (const [n, itens] of LANC) {
    const r = await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: forjada.j?.id, chave: uuid(), itens })
    ok(`lançamento ${n}: recusado`, r.s >= 400 && r.s < 500, `${r.s} ${r.j?.error ?? ''}`)
  }
  await q(`update item_complementos set pausado = true where item_id = $1 and nome = 'Mal passado'`, [burger.id])
  const pausada = await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: forjada.j?.id, chave: uuid(), itens: [{ itemId: burger.id, quantidade: 1, complementos: ['Mal passado', 'Suco de laranja'] }] })
  await q(`update item_complementos set pausado = false where item_id = $1 and nome = 'Mal passado'`, [burger.id])
  ok('lançamento com opção pausada: recusado', pausada.s >= 400 && /não está disponível/.test(pausada.j?.error ?? ''), pausada.j?.error)
  // Delivery público: campos internos forjados são recusados (422); preço do navegador não vale.
  const pub = (corpo) => fetch(`${BASE}/api/loja/${E2E_LOJA}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }))
  const basePub = { tipo: 'retirada', cliente: { nome: `E2E Balcão Pub ${SUF}`, telefone: '11977776666' }, pagamento: 'pix' }
  for (const [n, extra] of [['origem', { origem: 'pdv' }], ['canal', { canal: 'balcao' }], ['comanda', { comandaId: forjada.j?.id }], ['destino/status', { status: 'entregue', destino: 'logistica' }]]) {
    const r = await pub({ ...basePub, ...extra, itens: [{ itemId: agua.id, quantidade: 1, complementos: [] }] })
    ok(`delivery com ${n} forjado: recusado`, r.s >= 400 && r.s < 500, `${r.s} ${r.j?.error ?? ''}`)
  }
  const obrigPub = await pub({ ...basePub, itens: [{ itemId: burger.id, quantidade: 1, complementos: [] }] })
  ok('delivery com grupo obrigatório sem resposta: recusado', obrigPub.s >= 400 && obrigPub.s < 500, obrigPub.j?.error)
  const depois = await contar()
  ok('nenhuma tentativa inválida criou comanda ou pedido', depois.c === antes.c && depois.p === antes.p, `comandas ${antes.c}→${depois.c}, pedidos ${antes.p}→${depois.p}`)
  // Preço adulterado: se o corpo passa, o preço é o do catálogo (nunca o do navegador).
  const adult = await pub({ ...basePub, itens: [{ itemId: agua.id, quantidade: 1, complementos: [], preco: 0.01, precoUnitario: 0.01 }], total: 0.01, subtotal: 0.01 })
  if (adult.s === 201) {
    const pa = await um(`select p.total, pi.preco_unitario from pedidos p join pedido_itens pi on pi.pedido_id = p.id where p.id = $1`, [adult.j.id])
    ok('preço adulterado no delivery: vale o do catálogo', Number(pa.preco_unitario) === Number(agua.preco) && Number(pa.total) >= Number(agua.preco), JSON.stringify(pa))
  } else ok('preço adulterado no delivery: recusado', adult.s >= 400 && adult.s < 500, `${adult.s} ${adult.j?.error ?? ''}`)

  secao('Taxa automática (tabela de frete) x manual')
  // Linha temporária na tabela de frete: com a tabela de bairros não vazia e "fora da lista =
  // bloquear", o delivery de outros bairros passaria a ser recusado. Removida no finally.
  bairroCriado = (await q(`insert into taxas_entrega_bairro (restaurante_id, bairro, taxa) select $1, 'E2E Bairro Auto', 4.25 where not exists (select 1 from taxas_entrega_bairro where restaurante_id = $1 and bairro = 'E2E Bairro Auto') returning id`, [loja.id]))[0]?.id ?? null
  const auto = await api(g, '/api/admin/balcao/comandas', 'POST', { nome: `E2E Balcão Auto ${SUF}`, chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, bairro: 'E2E Bairro Auto' } })
  const ca = await um(`select taxa_entrega, taxa_entrega_manual from comandas where id = $1`, [auto.j?.id])
  ok('sem taxa digitada: taxa do bairro, marcada como automática', auto.s === 201 && Number(ca?.taxa_entrega) === 4.25 && ca?.taxa_entrega_manual === false, `${auto.s} ${JSON.stringify(ca)} ${auto.j?.error ?? ''}`)
  const antesFora = await contar()
  const fora = await api(g, '/api/admin/balcao/comandas', 'POST', { nome: `E2E Balcão Fora ${SUF}`, chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, bairro: 'Bairro Que Não Existe' } })
  ok('bairro fora da tabela sem taxa digitada: pede a taxa manual e não abre nada', fora.s === 400 && /manualmente/.test(fora.j?.error ?? '') && (await contar()).c === antesFora.c, fora.j?.error)

  secao('Nome longo (fica no Kanban para a checagem de responsividade)')
  // Nome no limite (60); 61 é recusado pela regra de sempre.
  const NOME60 = `E2E Maria Aparecida dos Santos Figueiredo Albuquerque ${SUF}`
  const n61 = await api(g, '/api/admin/balcao/comandas', 'POST', { nome: NOME60 + 'X', chave: uuid(), modalidade: 'retirada' })
  ok('nome com 61 caracteres recusado', NOME60.length === 60 && n61.s === 400, n61.j?.error)
  const longo = await api(g, '/api/admin/balcao/comandas', 'POST', { nome: NOME60, chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, bairro: 'Jardim da Penha Residencial Parque das Flores', taxa: '6' } })
  const lLongo = await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: longo.j?.id, chave: uuid(), itens: [{ itemId: agua.id, quantidade: 3, complementos: [] }] })
  ok('pedido de nome e bairro longos lançado', longo.s === 201 && lLongo.s === 201, `${longo.s} ${lLongo.s}`)

  secao('Duplo clique, duas abas, dois operadores')
  const chaveDupla = uuid()
  const nomeDup = `E2E Balcão Duplo ${SUF}`
  const [d1, d2] = await Promise.all([1, 2].map(() => api(g, '/api/admin/balcao/comandas', 'POST', { nome: nomeDup, chave: chaveDupla, modalidade: 'retirada' })))
  const nDup = Number((await um(`select count(*) n from comandas where restaurante_id = $1 and cliente_nome = $2`, [loja.id, nomeDup])).n)
  ok('mesma chave em paralelo (duplo clique / duas abas): uma comanda só', nDup === 1 && d1.j?.id === d2.j?.id, `${d1.s}/${d2.s} n=${nDup}`)
  const g2 = await logar(USU.gerente)
  const chaveLanc = uuid()
  const linhaAgua = [{ itemId: agua.id, quantidade: 1, complementos: [] }]
  const [la, lb] = await Promise.all([g, g2].map((p) => api(p, '/api/admin/pdv/lancamento', 'POST', { comandaId: d1.j?.id, chave: chaveLanc, itens: linhaAgua })))
  const nLanc = Number((await um(`select count(*) n from pedidos where comanda_id = $1`, [d1.j?.id])).n)
  ok('dois operadores reenviando o mesmo lançamento: um pedido só', nLanc === 1, `${la.s}/${lb.s} n=${nLanc}`)
  const [o1, o2] = await Promise.all([g, g2].map((p, i) => api(p, '/api/admin/balcao/comandas', 'POST', { nome: `E2E Balcão Op${i + 1} ${SUF}`, chave: uuid(), modalidade: 'retirada' })))
  const s1 = await um(`select senha from comandas where id = $1`, [o1.j?.id]); const s2s = await um(`select senha from comandas where id = $1`, [o2.j?.id])
  ok('dois operadores abrindo juntos: duas comandas com senhas diferentes', o1.s === 201 && o2.s === 201 && s1.senha !== s2s.senha, `${s1?.senha} x ${s2s?.senha}`)
  // A mesa (canal mesa) não passa pelo gatilho do balcão.
  // (O fluxo de mesa inteiro roda nas suítes e2e-garcom / e2e-release-mesas com a 0098 aplicada.)
  const fn = await um(`select prosrc from pg_proc where proname = 'pedido_entrega_balcao_destino'`)
  ok('gatilho da 0098 só olha canal balcão + tipo entrega (mesa e delivery passam direto)', /new\.canal is distinct from 'balcao' or new\.tipo is distinct from 'entrega' then return new/.test(fn?.prosrc ?? ''))
  await g2.context().close()

  secao('Pedidos para a cozinha')
  // Campos forjados no corpo (tipo, canal, origem, taxa, destino, status, preço) não valem nada.
  const lRet = await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: cRet.id, chave: uuid(), itens: [{ itemId: agua.id, quantidade: 1, complementos: [], preco: 0.01, precoUnitario: 0.01 }], tipo: 'entrega', canal: 'delivery', origem: 'cardapio', taxaEntrega: 50, destino: 'logistica', status: 'entregue', total: 0.01 })
  const lEnt = await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: cEnt.id, chave: uuid(), itens: [{ itemId: agua.id, quantidade: 2, complementos: [] }] })
  ok('lança na retirada e na entrega', lRet.s === 201 && lEnt.s === 201, `${lRet.s} ${lEnt.s}`)
  const pRet = await um(`select id, numero, tipo, canal, origem, status, taxa_entrega, total from pedidos where comanda_id = $1`, [cRet.id])
  const pEnt = await um(`select id, numero, tipo, canal, origem, endereco_rua, endereco_cidade, taxa_entrega, total from pedidos where comanda_id = $1`, [cEnt.id])
  ok('retirada (com campos forjados): PDV, canal balcão, tipo retirada, sem taxa, recebido, preço do catálogo', pRet?.origem === 'pdv' && pRet.canal === 'balcao' && pRet.tipo === 'retirada' && Number(pRet.taxa_entrega) === 0 && pRet.status === 'recebido' && Number(pRet.total) === Number(agua.preco), JSON.stringify(pRet))
  ok('entrega: PDV, canal balcão, tipo entrega, endereço e taxa no pedido', pEnt?.origem === 'pdv' && pEnt.canal === 'balcao' && pEnt.tipo === 'entrega' && pEnt.endereco_rua === 'Rua E2E' && pEnt.endereco_cidade === 'Vitória/ES' && Number(pEnt.taxa_entrega) === 7.5)
  ok('preço do servidor (2 × água + taxa)', Number(pEnt.total) === Number(agua.preco) * 2 + 7.5, String(pEnt.total))

  secao('Logística LIGADA: entrega pronta vai para a Logística')
  await q(`update restaurantes set usa_logistica = true, entrega_sem_entregador = false where id = $1`, [loja.id])
  const k = await logar(USU.gerente)
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
  const CAPACETE = 'path[d="M3 16.5V15a9 9 0 0 1 17.6-2.7"]'
  ok('capacete na etiqueta ENTREGA e no "Na logística"', (await card(pEnt.numero).getByTestId('etiqueta-entrega').locator(CAPACETE).count()) === 1 && (await card(pEnt.numero).getByTestId('card-na-logistica').locator(CAPACETE).count()) === 1)
  ok('relógio no cronômetro do card', (await card(pEnt.numero).locator('[title="Tempo desde que o pedido chegou"] svg.lucide-clock').count()) === 1)
  if (adult.s === 201) {
    // Pedido do delivery (Pix, telefone sem OTP): o card não mostra pagamento nem "não verif.";
    // os dois continuam nos Detalhes.
    const nAd = (await um(`select numero from pedidos where id = $1`, [adult.j.id])).numero
    const txtAd = await card(nAd).innerText()
    ok('card do delivery sem forma de pagamento e sem "não verificado"', !/Pix|Dinheiro|Cartão/i.test(txtAd) && !/não verif/i.test(txtAd), txtAd.replace(/\s+/g, ' ').slice(0, 120))
    await card(nAd).getByTestId('card-detalhes').click(); await k.waitForTimeout(600)
    const det = await k.locator("body").innerText()
    ok('Detalhes do delivery mantêm a forma de pagamento e o "não verif."', /Pix/i.test(det) && /não verif/i.test(det), det.replace(/\s+/g, ' ').slice(0, 160))
    await foto(k, '03b-detalhes-delivery-pagamento')
    await k.keyboard.press('Escape'); await k.mouse.click(5, 300); await k.waitForTimeout(300)
  }
  await foto(k, '03-kanban-na-logistica')
  await k.goto(`${BASE}/admin/logistica`, { waitUntil: 'networkidle' }); await dispensar(k); await k.waitForTimeout(1200)
  ok('aparece na Logística para despachar', (await k.locator('body').innerText()).includes(`#${pEnt.numero}`))
  ok('capacete na tela da Logística', (await k.locator(CAPACETE).count()) > 0)
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

  secao('Taxa de entrega com pedido cancelado (0099)')
  {
    const contaDe = async (id) => (await api(g, `/api/admin/comandas/${id}`)).j?.conta
    const cancelarLanc = (comanda, pedidoId) => api(k, `/api/admin/comandas/${comanda}`, 'POST', { acao: 'cancelar_pedido', pedidoId, motivo: 'teste da taxa 0099' })
    // Entrega com um único pedido: cancelado, a taxa sai do total.
    const ct = await api(g, '/api/admin/balcao/comandas', 'POST', { nome: `E2E Balcão Taxa Única ${SUF}`, chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, taxa: '4' } })
    const lt = await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: ct.j.id, chave: uuid(), itens: [{ itemId: agua.id, quantidade: 1, complementos: [] }] })
    let conta = await contaDe(ct.j.id)
    ok('entrega com item: taxa cobrada no total', conta?.totais?.taxaEntrega === 4 && conta.totais.total === Number(agua.preco) + 4, JSON.stringify(conta?.totais))
    const cx = await cancelarLanc(ct.j.id, lt.j.id)
    conta = await contaDe(ct.j.id)
    ok('único pedido cancelado: taxa sai do total (0) e a conta mostra 0', cx.s === 200 && conta?.totais?.taxaEntrega === 0 && conta.totais.total === 0 && conta.entrega?.taxa === 4, `${cx.s} ${JSON.stringify(conta?.totais)}`)
    const audT = await q(`select dados from eventos_auditoria where entidade_id = $1 and acao = 'conta.taxa_entrega_nao_cobrada'`, [ct.j.id])
    ok('  uma auditoria "taxa não cobrada"', audT.length === 1, JSON.stringify(audT.map((a) => a.dados)))
    const fila = await um(`select impresso, reimprimir from pedidos where id = $1`, [lt.j.id])
    ok('  pedido cancelado fora da fila de impressão', fila.reimprimir === false && (await um(`select status from pedidos where id = $1`, [lt.j.id])).status === 'cancelado')
    // Dois pedidos: cancelado o 1º (que carregava a taxa), a taxa continua uma vez.
    const c2t = await api(g, '/api/admin/balcao/comandas', 'POST', { nome: `E2E Balcão Taxa Dupla ${SUF}`, chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, taxa: '4' } })
    const la = await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: c2t.j.id, chave: uuid(), itens: [{ itemId: agua.id, quantidade: 1, complementos: [] }] })
    await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: c2t.j.id, chave: uuid(), itens: [{ itemId: agua.id, quantidade: 2, complementos: [] }] })
    await cancelarLanc(c2t.j.id, la.j.id)
    conta = await contaDe(c2t.j.id)
    ok('dois pedidos, 1º cancelado: taxa continua uma vez', conta?.totais?.taxaEntrega === 4 && conta.totais.total === 2 * Number(agua.preco) + 4, JSON.stringify(conta?.totais))
    const soma = await um(`select coalesce(sum(total), 0) s from pedidos where comanda_id = $1 and status <> 'cancelado'`, [c2t.j.id])
    ok('  Dashboard (pedidos ativos) = total da conta', Number(soma.s) === conta.totais.total, `${soma.s}`)
  }

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

  secao('Logística ligada + "entrega sem entregador": também conclui sozinha')
  await q(`update restaurantes set usa_logistica = true, entrega_sem_entregador = true where id = $1`, [loja.id])
  const c3 = await api(g, '/api/admin/balcao/comandas', 'POST', { nome: `E2E Balcão Entrega3 ${SUF}`, chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, taxa: '5' } })
  await api(g, '/api/admin/pdv/lancamento', 'POST', { comandaId: c3.j.id, chave: uuid(), itens: [{ itemId: agua.id, quantidade: 1, complementos: [] }] })
  const p3 = await um(`select id, numero from pedidos where comanda_id = $1`, [c3.j.id])
  await k.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' }); await k.waitForTimeout(800)
  await card(p3.numero).getByRole('button', { name: 'Aceitar' }).click(); await k.waitForTimeout(900)
  await card(p3.numero).getByRole('button', { name: 'Pronto' }).click(); await k.waitForTimeout(2000)
  const s3 = await um(`select status, atendimento_status, concluido_em, pronto_em from pedidos where id = $1`, [p3.id])
  ok('concluída na hora, com horários de pronto e conclusão', s3.status === 'entregue' && s3.atendimento_status === 'concluido' && !!s3.concluido_em && !!s3.pronto_em, JSON.stringify(s3))
  const aud3 = await um(`select dados from eventos_auditoria where entidade_id = $1 and acao = 'pedido.entrega_balcao_destino'`, [p3.id])
  ok('auditoria: conclusão automática por "entrega sem entregador"', aud3?.dados?.caminho === 'conclusao_automatica' && aud3?.dados?.motivo === 'entrega_sem_entregador', JSON.stringify(aud3?.dados))
  const nAud = Number((await um(`select count(*) n from eventos_auditoria where entidade_id = $1 and acao = 'pedido.entrega_balcao_destino'`, [p3.id])).n)
  ok('um único registro de destino por pedido', nAud === 1, String(nAud))

  await k.context().close(); await g.context().close()
} catch (e) {
  ok('execução', false, e.message.split('\n')[0])
} finally {
  if (bairroCriado) await q(`delete from taxas_entrega_bairro where id = $1`, [bairroCriado])
  await q(`update restaurantes set usa_logistica = $2, entrega_sem_entregador = $3 where id = $1`, [loja.id, flagsOriginais.usa, flagsOriginais.sem])
  await browser.close(); await db.end()
}
const f = res.filter((x) => !x).length
console.log(`\n${res.length - f}/${res.length} passaram`)
process.exit(f ? 1 : 0)
