/**
 * E2E — PDV: forma de pagamento e troco antes de lançar + caixa que abre sozinho (0135).
 * Loja descartável `fin-int` (semear-demo-mesas E2E_LOJA=fin-int E2E_VIZINHA=fin-int-viz E2E_SUFIXO=finint).
 *   PDV (tela): bloqueio sem forma, troco por atalho e digitado, troco menor que o total bloqueia, total
 *   que muda depois; matriz entrega/retirada × formas pela API; mesa sem a etapa; mesma forma na conta;
 *   alterar antes e depois de sair (aprovação); exibição no Kanban, cozinha, Logística, motoboy;
 *   impressão virtual (os dados que o Assistente recebe, renderizados pelo próprio código dele);
 *   caixa: com financeiro a entrega não abre o caixa e vira "a acertar"; alerta; acerto no turno de quem
 *   acertou; balcão já pago fora do acerto; sem financeiro o turno vira o dia; vitrine igual.
 *
 *   node scripts/seguranca/e2e-pdv-pagamento.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const require = createRequire(import.meta.url)
const { montarReciboLinhas } = require('../../printer-agent/src/recibo.js')
const { montarCozinhaBeta } = require('../../printer-agent/src/cozinha-beta.js')
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'fin-int'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL, API_URL, ANON_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
if (!loja) { console.error('Rode antes a semente da fin-int.'); process.exit(2) }
const SENHA = 'demo-local-123456'
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const browser = await chromium.launch()
const foto = async (p, nome) => { if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`) }) }
const texto = (v) => JSON.stringify(v)

async function logar(login, viewport = { width: 1366, height: 860 }) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}
async function ir(p, url) { await p.goto(url, { waitUntil: 'networkidle' }); await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {}) }
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return { s: r.status, j: await r.json().catch(() => null) }
}, { url: `${BASE}${url}`, metodo, corpo })
const item = async (nome) => um(`select id, preco from itens_cardapio where restaurante_id=$1 and nome=$2`, [loja.id, nome])
const ENDERECO = { cep: '29050-100', rua: 'Rua Teste', numero: '10', bairro: 'Centro', cidade: 'Vitória', estado: 'ES', complemento: '', referencia: '', taxa: '5' }
const abrirBalcao = (p, modalidade, nome) => api(p, '/api/admin/balcao/comandas', 'POST', { nome, chave: uuid(), modalidade, ...(modalidade === 'entrega' ? { entrega: ENDERECO } : {}) })
const lancar = (p, comandaId, itens, pagamento) => api(p, '/api/admin/pdv/lancamento', 'POST', { comandaId, chave: uuid(), itens, ...(pagamento !== undefined ? { pagamento } : {}) })
const pedidoDa = (comandaId) => um(`select id, numero, forma_pagamento::text forma, cartao_tipo, troco_para, pago, total, tipo::text, status::text from pedidos where comanda_id=$1 order by criado_em desc limit 1`, [comandaId])
const totalConta = async (id) => Number((await um('select total from comanda_totais($1)', [id])).total)

let dono, ger, ate
const tokenAgente = uuid()
try {
  await db.query(`update restaurantes set financeiro_ativo=true, pdv_v2=true, usa_logistica=true, impressao_agente_token=$2, impressao_automatica=true, impressao_ativar_assistente=true, impressao_cozinha_por_funcao=false where id=$1`, [loja.id, tokenAgente])
  await db.query(`update caixa_turnos set fechado_em=now(), fechado_por_nome='e2e (limpeza)' where restaurante_id=$1 and fechado_em is null`, [loja.id])
  await db.query(`update comandas set status='cancelada' where restaurante_id=$1 and status='aberta' and cliente_nome like 'TESTE%'`, [loja.id])
  // Fila de impressão da loja de teste limpa: só os pedidos desta rodada (a fila tem limite).
  await db.query(`update pedidos set impresso=true where restaurante_id=$1 and not impresso`, [loja.id])
  await db.query(`update usuarios set pin_hash=null, pin_falhas=0, pin_bloqueado_ate=null, acessos=null where restaurante_id=$1`, [loja.id])
  const moto = await um(`insert into entregadores (restaurante_id, nome, telefone, status) values ($1, 'TESTE Moto Troco', '27999990019', 'online') returning id, token`, [loja.id])
  const FILE = await item('Filé à Parmegiana'); const AGUA = await item('Água com Gás'); const SUCO = await item('Suco de Laranja'); const RISOTO = await item('Risoto de Funghi')
  dono = await logar('dono.finint'); ger = await logar('gerente.finint'); ate = await logar('atendente.finint')
  await api(dono.p, '/api/sessao/pin', 'POST', { senha: SENHA, pin: '615283' }); await api(ger.p, '/api/sessao/pin', 'POST', { senha: SENHA, pin: '482913' })
  const donoId = (await um(`select id from usuarios where usuario='dono.finint'`)).id
  const gerId = (await um(`select id from usuarios where usuario='gerente.finint'`)).id

  secao('1. Tela do PDV: escolha obrigatória antes de lançar')
  await ir(ate.p, `${BASE}/admin/pdv`)
  await ate.p.getByTestId('card-balcao').click()
  await ate.p.getByTestId('balcao-novo').click()
  await ate.p.getByTestId('balcao-modalidade-retirada').click()
  await ate.p.getByTestId('balcao-nome').fill('TESTE Cliente Tela')
  await ate.p.getByTestId('balcao-abrir').click()
  await ate.p.getByTestId('pdv-lancar').waitFor()
  await ate.p.getByRole('button', { name: /Filé à Parmegiana/ }).first().click()
  await ate.p.getByRole('button', { name: /Água com Gás/ }).first().click()
  await ate.p.getByTestId('pdv-pagamento').waitFor({ timeout: 8000 })
  ok('bloco PAGAMENTO aparece no balcão', await ate.p.getByTestId('pdv-pagamento').isVisible())
  ok('sem forma: "Lançar na cozinha" desabilitado + dica', await ate.p.getByTestId('pdv-lancar').isDisabled() && /Escolha a forma de pagamento/.test(await ate.p.getByTestId('pdv-dica-pagamento').innerText()))
  await foto(ate.p, '01-sem-forma')
  await ate.p.getByTestId('pdv-pag-dinheiro').click()
  ok('dinheiro sem dizer se precisa de troco: ainda bloqueado', await ate.p.getByTestId('pdv-lancar').isDisabled())
  await ate.p.getByTestId('pdv-troco-sim').click()
  await ate.p.getByTestId('pdv-troco-atalho-100').click()
  const tot1 = Number(FILE.preco) + Number(AGUA.preco)
  ok(`troco p/ R$ 100 de ${tot1.toFixed(2)}: "Levar de troco" em destaque`, (await ate.p.getByTestId('pdv-levar-troco').innerText()).includes((100 - tot1).toFixed(2).replace('.', ',')))
  await foto(ate.p, '02-troco-atalho')
  await ate.p.getByTestId('pdv-troco-valor').fill('50')
  await ate.p.getByTestId('pdv-pag-erro').waitFor({ timeout: 4000 }).catch(() => {})
  const erroTroco = await ate.p.getByTestId('pdv-pag-erro').innerText().catch(() => '(sem mensagem)')
  ok('troco menor que o total: mensagem e bloqueio', await ate.p.getByTestId('pdv-lancar').isDisabled() && /mais que o total/.test(erroTroco), erroTroco)
  await foto(ate.p, '03-troco-menor')
  await ate.p.getByTestId('pdv-troco-valor').fill('120')
  await ate.p.getByRole('button', { name: /Suco de Laranja/ }).first().click()
  const tot1b = tot1 + Number(SUCO.preco)
  ok('total mudou depois: "levar" recalculado', (await ate.p.getByTestId('pdv-levar-troco').innerText()).includes((120 - tot1b).toFixed(2).replace('.', ',')))
  ok('com forma e troco válidos: botão liberado', await ate.p.getByTestId('pdv-lancar').isEnabled())
  await ate.p.getByTestId('pdv-lancar').click()
  await ate.p.getByText(/lançado em Balcão/).waitFor({ timeout: 15000 })
  const cTela = await um(`select id from comandas where restaurante_id=$1 and cliente_nome='TESTE Cliente Tela' order by aberta_em desc limit 1`, [loja.id])
  const pTela = await pedidoDa(cTela.id)
  ok('pedido gravado: dinheiro, troco p/ 120, NÃO pago', pTela.forma === 'dinheiro' && Number(pTela.troco_para) === 120 && pTela.pago === false, texto(pTela))

  secao('2. Matriz pela API: entrega e retirada × formas')
  const casos = [
    ['entrega', { escolha: 'pix' }, 'pix', null, null],
    ['entrega', { escolha: 'credito' }, 'cartao', 'credito', null],
    ['entrega', { escolha: 'debito' }, 'cartao', 'debito', null],
    ['entrega', { escolha: 'dinheiro', trocoPara: null }, 'dinheiro', null, null],
    ['entrega', { escolha: 'dinheiro', trocoPara: 200 }, 'dinheiro', null, 200],
    ['retirada', { escolha: 'pix' }, 'pix', null, null],
    ['retirada', { escolha: 'credito' }, 'cartao', 'credito', null],
    ['retirada', { escolha: 'dinheiro', trocoPara: 100 }, 'dinheiro', null, 100],
  ]
  const contas = {}
  for (const [mod, pag, forma, cartao, troco] of casos) {
    const c = await abrirBalcao(ate.p, mod, `TESTE ${mod} ${pag.escolha} ${pag.trocoPara ?? ''}`.trim())
    const l = await lancar(ate.p, c.j?.id, [{ itemId: RISOTO.id, quantidade: 1, complementos: [] }], pag)
    const p = await pedidoDa(c.j?.id)
    ok(`${mod} · ${pag.escolha}${pag.trocoPara ? ` troco ${pag.trocoPara}` : ''}`, l.s === 201 && p.forma === forma && (p.cartao_tipo ?? null) === cartao && (p.troco_para === null ? null : Number(p.troco_para)) === troco && p.pago === false && p.tipo === mod, `${l.s} ${l.j?.error ?? ''} ${texto(p)}`)
    contas[`${mod}-${pag.escolha}-${pag.trocoPara ?? 0}`] = { comandaId: c.j?.id, pedido: p }
  }
  const cSem = await abrirBalcao(ate.p, 'entrega', 'TESTE sem forma')
  const semForma = await lancar(ate.p, cSem.j.id, [{ itemId: AGUA.id, quantidade: 1, complementos: [] }])
  ok('❌ esperado: lançar no balcão sem forma (400)', semForma.s === 400 && semForma.j?.codigo === 'forma_obrigatoria', `${semForma.s} ${semForma.j?.error}`)
  const totSem = Number(AGUA.preco) + 5
  const igual = await lancar(ate.p, cSem.j.id, [{ itemId: AGUA.id, quantidade: 1, complementos: [] }], { escolha: 'dinheiro', trocoPara: totSem })
  ok('❌ esperado: troco IGUAL ao total da conta (com taxa)', igual.s === 400 && /mais que o total/.test(igual.j?.error ?? ''), `${igual.s} ${igual.j?.error}`)
  ok('nada foi lançado nas tentativas recusadas', (await um(`select count(*)::int n from pedidos where comanda_id=$1`, [cSem.j.id])).n === 0)
  const forjada = await lancar(ate.p, cSem.j.id, [{ itemId: AGUA.id, quantidade: 1, complementos: [] }], { escolha: 'fiado' })
  ok('❌ esperado: forma fora da lista', forjada.s === 400)

  secao('3. Mesa sem a etapa; mesma forma na conta inteira')
  const mesa = (await q(`select m.id from mesas m where m.restaurante_id=$1 and m.ativa and m.bloqueada_em is null and not exists (select 1 from comandas c where c.mesa_id=m.id and c.status='aberta') order by m.ordem`, [loja.id]))[0]
  await api(ate.p, `/api/admin/mesas/${mesa.id}/atendimento`, 'POST', { acao: 'liberar' })
  await api(ate.p, `/api/admin/mesas/${mesa.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'TESTE Mesa Pag', chave: uuid() })
  const lm = await api(ate.p, '/api/admin/pdv/lancamento', 'POST', { mesaId: mesa.id, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }] })
  ok('mesa lança sem escolher forma (paga no fechamento)', lm.s === 201, `${lm.s} ${lm.j?.error ?? ''}`)
  const ret = contas['retirada-pix-0']
  const l2 = await lancar(ate.p, ret.comandaId, [{ itemId: AGUA.id, quantidade: 1, complementos: [] }], { escolha: 'debito' })
  const formas = await q(`select forma_pagamento::text f, cartao_tipo c from pedidos where comanda_id=$1`, [ret.comandaId])
  ok('segundo lançamento com débito: a conta inteira fica em débito', l2.s === 201 && formas.length === 2 && formas.every((x) => x.f === 'cartao' && x.c === 'debito'), texto(formas))
  const pre = await api(ate.p, `/api/admin/pdv/pagamento?comandaId=${ret.comandaId}`)
  ok('tela pré-preenche com a forma da conta', pre.j?.atual?.escolha === 'debito')

  secao('4. Alterar depois de lançar (auditado)')
  const ent = contas['entrega-dinheiro-200']
  const a1 = await api(ate.p, `/api/admin/pedidos/${ent.pedido.id}/pagamento`, 'POST', { pagamento: { escolha: 'dinheiro', trocoPara: 100 }, reimprimir: true })
  const p1 = await um(`select troco_para, reimprimir from pedidos where id=$1`, [ent.pedido.id])
  ok('antes de sair: atendente altera o troco (e pede reimpressão)', a1.s === 200 && Number(p1.troco_para) === 100 && p1.reimprimir === true, `${a1.s} ${a1.j?.error ?? ''}`)
  ok('auditoria: quem, de/para', !!(await um(`select 1 from eventos_auditoria where acao='pedido.pagamento_alterado' and entidade_id=$1 and dados->>'de' like '%200.00%' and dados->>'para' like '%100.00%' and usuario_nome='Atendente Demo'`, [ent.pedido.id])))
  // Sai para entrega pelo mesmo caminho da Logística (RLS do gerente).
  const sb = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  await sb.auth.signInWithPassword({ email: 'gerente.finint@demo.local', password: SENHA })
  for (const st of ['preparando', 'pronto']) await sb.from('pedidos').update({ status: st }).eq('id', ent.pedido.id)
  await sb.from('pedidos').update({ entregador_id: moto.id, status: 'em_rota' }).eq('id', ent.pedido.id)
  ok('❌ esperado: atendente altera depois de sair para entrega', (await api(ate.p, `/api/admin/pedidos/${ent.pedido.id}/pagamento`, 'POST', { pagamento: { escolha: 'pix' } })).j?.codigo === 'precisa_gerencia')
  ok('❌ esperado: gerente altera sem aprovação (financeiro ligado)', (await api(ger.p, `/api/admin/pedidos/${ent.pedido.id}/pagamento`, 'POST', { pagamento: { escolha: 'pix' } })).j?.codigo === 'aprovacao_necessaria')
  ok('❌ esperado: gerente aprova com o próprio PIN', (await api(ger.p, `/api/admin/pedidos/${ent.pedido.id}/pagamento`, 'POST', { pagamento: { escolha: 'pix' }, aprovacao: { aprovadorId: gerId, pin: '482913' } })).s === 403)
  const aOk = await api(ger.p, `/api/admin/pedidos/${ent.pedido.id}/pagamento`, 'POST', { pagamento: { escolha: 'dinheiro', trocoPara: 70 }, aprovacao: { aprovadorId: donoId, pin: '615283' } })
  ok('gerente com o PIN do dono: altera, auditado com quem aprovou', aOk.s === 200 && !!(await um(`select 1 from eventos_auditoria where acao='pedido.pagamento_alterado' and entidade_id=$1 and dados->>'aprovado_por' like 'Dono%'`, [ent.pedido.id])), `${aOk.s} ${aOk.j?.error ?? ''}`)
  ok('dono altera direto (sem PIN)', (await api(dono.p, `/api/admin/pedidos/${ent.pedido.id}/pagamento`, 'POST', { pagamento: { escolha: 'dinheiro', trocoPara: 100 } })).s === 200)

  secao('5. Telas: Kanban, detalhe, cozinha, Logística, motoboy')
  const pDin = contas['retirada-dinheiro-100'].pedido
  await ir(ate.p, `${BASE}/admin/pedidos`)
  const card = ate.p.getByTestId(`pedido-${pDin.numero}`)
  await card.waitFor({ timeout: 10000 })
  const tCard = await card.getByTestId('info-pagamento').innerText()
  ok('Kanban: "Dinheiro" + "Troco p/ R$ 100,00" + "A pagar na retirada"', /Dinheiro/.test(tCard) && /Troco p\/ R\$\s?100,00/.test(tCard) && /A pagar na retirada/.test(tCard), tCard)
  await card.scrollIntoViewIfNeeded(); await foto(ate.p, '04-kanban-card')
  await card.getByTestId('card-detalhes').click()
  await ate.p.getByTestId('detalhes-pagamento').waitFor({ timeout: 8000 })
  ok('detalhe: alerta "Levar … de troco" e botão "Alterar pagamento"', (await ate.p.getByTestId('alerta-troco').count()) === 1 && (await ate.p.getByTestId('detalhes-alterar-pagamento').count()) === 1)
  await ate.p.getByTestId('detalhes-alterar-pagamento').click()
  await ate.p.getByTestId('editor-pagamento').waitFor()
  await foto(ate.p, '05-detalhe-alterar')
  await ate.p.keyboard.press('Escape')
  const cred = contas['entrega-credito-0'].pedido
  const est = await um(`insert into estacoes (restaurante_id, nome, modo) values ($1, 'TESTE Cozinha Pag', 'producao') returning token`, [loja.id])
  const coz = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await coz.goto(`${BASE}/cozinha/${est.token}`, { waitUntil: 'networkidle' })
  await coz.waitForTimeout(2500)
  const tCoz = await coz.locator('body').innerText()
  ok('cozinha: forma no ticket ("Cartão crédito") e "Troco p/"', /Cartão crédito/.test(tCoz) && /Troco p\//.test(tCoz))
  await foto(coz, '06-cozinha'); await coz.close()
  for (const st of ['preparando', 'pronto']) await sb.from('pedidos').update({ status: st }).eq('id', pDin.id)
  const pEnt = contas['entrega-dinheiro-0'].pedido
  for (const st of ['preparando', 'pronto']) await sb.from('pedidos').update({ status: st }).eq('id', pEnt.id)
  await ir(ger.p, `${BASE}/admin/logistica`)
  await ger.p.waitForTimeout(2000)
  const nAlertas = await ger.p.getByTestId('alerta-troco').count()
  ok('Logística: alerta "Levar R$ … de troco" em destaque no pedido com troco', nAlertas >= 1, String(nAlertas))
  await foto(ger.p, '07-logistica')
  const motoP = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await motoP.goto(`${BASE}/entregador/${moto.token}`, { waitUntil: 'networkidle' })
  await motoP.waitForTimeout(1500)
  ok('motoboy: "Levar R$ … de troco" no pedido em rota', /levar/i.test(await motoP.locator('body').innerText()))
  await foto(motoP, '08-motoboy'); await motoP.close()

  secao('6. Impressão virtual (dados reais que o Assistente recebe, desenhados pelo código dele)')
  const fila = await fetch(`${BASE}/api/agente/pedidos`, { headers: { Authorization: `Bearer ${tokenAgente}` } }).then((r) => r.json()).then((j) => j.pedidos ?? [])
  const naFila = (id) => fila.find((x) => x.id === id)
  const pr = naFila(contas['retirada-dinheiro-100'].pedido.id)
  const recibo = pr ? texto(montarReciboLinhas(pr, { colunas: 48 }, 'Loja')) : ''
  ok('comanda (recibo): "Pagamento: DINHEIRO", "Troco para: R$ 100,00", "A RECEBER" (nunca PAGO)', /Pagamento: DINHEIRO/.test(recibo) && /Troco para: R\$ ?100,00/.test(recibo) && /A RECEBER/.test(recibo) && !/Status: PAGO/.test(recibo), recibo.slice(0, 0))
  const pc = naFila(contas['retirada-credito-0'].pedido.id)
  const reciboCred = pc ? texto(montarReciboLinhas(pc, { colunas: 48 }, 'Loja')) : ''
  ok('comanda (recibo): "Pagamento: CREDITO"', /Pagamento: CREDITO/.test(reciboCred))
  const beta = pc ? texto(montarCozinhaBeta(pc, {})) : ''
  ok('comanda Beta: "Pagamento: CREDITO"', /Pagamento".{0,40}CREDITO/.test(beta), beta.slice(0, 0))

  secao('7. Caixa (financeiro ligado): entrega com o caixa fechado vira "a acertar"')
  for (const st of ['em_rota']) await sb.from('pedidos').update({ entregador_id: moto.id, status: st }).eq('id', pEnt.id)
  await sb.from('pedidos').update({ status: 'entregue' }).eq('id', pEnt.id)
  ok('caixa NÃO abriu sozinho', !(await um(`select 1 from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])))
  const pend = await um(`select turno_id, valor_centavos::bigint v, entregador_id from fin_lancamentos where pedido_id=$1 and tipo='pendencia_motoboy'`, [pEnt.id])
  ok('livro-caixa: pendência do motoboy, sem turno', !!pend && pend.turno_id === null && Number(pend.v) === Math.round(Number(pEnt.total) * 100) && pend.entregador_id === moto.id, texto(pend))
  const lv = await api(ate.p, '/api/admin/financeiro/caixa?leve=1')
  ok('aviso no topo: valor "a acertar" com o caixa fechado', lv.j?.aberto === false && lv.j?.aAcertarCentavos >= Math.round(Number(pEnt.total) * 100), texto(lv.j))
  await ir(ate.p, `${BASE}/admin/financeiro?secao=caixa`)
  ok('aviso visível: "Caixa fechado · R$ … a acertar"', /a acertar/.test(await ate.p.getByTestId('aviso-caixa').innerText({ timeout: 8000 }).catch(() => '')))
  await foto(ate.p, '09-aviso-a-acertar')
  await db.query(`update pedidos set entregue_em = now() - interval '3 hours' where id=$1`, [pEnt.id])
  await api(ate.p, '/api/admin/financeiro/caixa?leve=1')
  ok('passou de 2 h: alerta ao dono', !!(await um(`select 1 from fin_alertas where restaurante_id=$1 and tipo='dinheiro_a_acertar'`, [loja.id])))
  ok('abre o caixa (operador)', (await api(ate.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'abrir', fundoCentavos: 5000 })).s === 200)
  // Fase 3 (0136): acerto pelo Financeiro › Acerto de Motoboys (contagem cega).
  const painel = await api(ger.p, '/api/admin/financeiro/motoboys')
  const linha = painel.j?.motoboys?.find((l) => l.entregadorId === moto.id)
  ok('a entrega "a acertar" aparece no acerto do caixa novo', !!linha && linha.pedidos?.some((x) => x.pedidoId === pEnt.id), texto(linha))
  const ac = await api(ger.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: moto.id, contadoCentavos: linha?.saldoCentavos ?? 0, chave: `pdv-${uuid()}` })
  const turno = await um(`select id from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])
  const fc = await um(`select turno_id, registrado_por_nome from fechamentos_caixa where entregador_id=$1 order by criado_em desc limit 1`, [moto.id])
  ok('acerto entra no turno aberto, com quem acertou', ac.s === 200 && fc?.turno_id === turno.id && fc?.registrado_por_nome === 'Gerente Demo', `${ac.s} ${texto(fc)}`)
  const saldoMoto = await um(`select coalesce(sum(valor_centavos),0)::bigint s from fin_lancamentos where restaurante_id=$1 and carteira='motoboy' and entregador_id=$2`, [loja.id, moto.id])
  ok('carteira do motoboy zerada depois do acerto (pendência baixada)', Number(saldoMoto.s) === 0, String(saldoMoto.s))

  secao('8. Balcão-entrega já pago no caixa não conta no acerto (antes contava em dobro)')
  const cPago = await abrirBalcao(ate.p, 'entrega', 'TESTE Pago no Caixa')
  await lancar(ate.p, cPago.j.id, [{ itemId: AGUA.id, quantidade: 1, complementos: [] }], { escolha: 'dinheiro', trocoPara: null })
  const totPago = await totalConta(cPago.j.id)
  ok('cliente paga no caixa', (await api(ate.p, `/api/admin/comandas/${cPago.j.id}`, 'POST', { acao: 'pagamento', forma: 'dinheiro', valor: totPago, chave: uuid() })).s === 200)
  const pp = await pedidoDa(cPago.j.id)
  for (const st of ['preparando', 'pronto']) await sb.from('pedidos').update({ status: st }).eq('id', pp.id)
  await sb.from('pedidos').update({ entregador_id: moto.id, status: 'em_rota' }).eq('id', pp.id)
  await sb.from('pedidos').update({ status: 'entregue' }).eq('id', pp.id)
  const linha2 = (await api(ger.p, '/api/admin/financeiro/motoboys')).j?.motoboys?.find((l) => l.entregadorId === moto.id)
  ok('não aparece no acerto do motoboy nem gera pendência', !(linha2?.pedidos ?? []).some((x) => x.pedidoId === pp.id) &&!(await um(`select 1 from fin_lancamentos where pedido_id=$1 and tipo='pendencia_motoboy'`, [pp.id])), texto(linha2))
  await api(dono.p, '/api/admin/financeiro/caixa', 'POST', { acao: 'fechar', contadoDinheiroCentavos: (await api(dono.p, '/api/admin/financeiro/caixa')).j.saldos.gaveta, contadoCartaoCentavos: (await api(dono.p, '/api/admin/financeiro/caixa')).j.saldos.cartao, aceitarPendencias: true })

  secao('9. Loja sem financeiro: "Fechamento de caixa" da Logística separado por dia')
  await db.query(`update restaurantes set financeiro_ativo=false where id=$1`, [loja.id])
  await db.query(`update caixa_turnos set fechado_em=now(), fechado_por_nome='e2e (limpeza)' where restaurante_id=$1 and fechado_em is null`, [loja.id])
  const velho = await um(`insert into caixa_turnos (restaurante_id, aberto_em, aberto_por_nome) values ($1, now() - interval '2 days', 'Automático (1ª entrega)') returning id`, [loja.id])
  const g9 = await api(ger.p, '/api/admin/caixa')
  const fechado = await um(`select fechado_em, fechado_por_nome, (fechado_em = caixa_inicio_dia_operacional(aberto_em) + interval '1 day') no_fim_do_dia from caixa_turnos where id=$1`, [velho.id])
  ok('turno de 2 dias atrás fecha sozinho no fim do dia dele (05:00)', g9.s === 200 && fechado.fechado_por_nome === 'Automático (fim do dia)' && fechado.no_fim_do_dia === true, texto(fechado))
  ok('…e fica na auditoria', !!(await um(`select 1 from eventos_auditoria where acao='caixa.fechou_turno' and entidade_id=$1 and dados->>'automatico'='true'`, [velho.id])))
  const cDia = await abrirBalcao(ate.p, 'entrega', 'TESTE Dia Novo')
  await lancar(ate.p, cDia.j.id, [{ itemId: RISOTO.id, quantidade: 1, complementos: [] }], { escolha: 'dinheiro', trocoPara: null })
  const pd = await pedidoDa(cDia.j.id)
  for (const st of ['preparando', 'pronto']) await sb.from('pedidos').update({ status: st }).eq('id', pd.id)
  await sb.from('pedidos').update({ entregador_id: moto.id, status: 'em_rota' }).eq('id', pd.id)
  await sb.from('pedidos').update({ status: 'entregue' }).eq('id', pd.id)
  const novo = await um(`select id, aberto_por_nome from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])
  ok('entrega abre o turno do dia (regra antiga mantida sem o financeiro)', /Automático/.test(novo?.aberto_por_nome ?? ''))
  const g9b = await api(ger.p, '/api/admin/caixa')
  const l9 = g9b.j?.acerto?.find((l) => l.entregadorId === moto.id)
  ok('acerto do dia: só a entrega de hoje', l9?.pedidos === 1 && Math.abs(l9.valorEsperado - Number(pd.total)) < 0.001, texto(l9))
  ok('sem financeiro: nada vai para o livro-caixa', !(await um(`select 1 from fin_lancamentos where pedido_id=$1`, [pd.id])))

  secao('10. Vitrine continua igual')
  const pub = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'retirada', cliente: { nome: 'TESTE Vitrine', telefone: '27999990021' }, pagamento: 'dinheiro', trocoPara: 100,
    endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' }, itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }],
  }) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }))
  const pv = pub.j?.id ? await um(`select forma_pagamento::text f, troco_para, cartao_tipo, pago from pedidos where id=$1`, [pub.j.id]) : null
  ok('pedido da vitrine: dinheiro troco p/ 100, sem detalhe de cartão, não pago', pub.s === 201 && pv?.f === 'dinheiro' && Number(pv.troco_para) === 100 && pv.cartao_tipo === null && pv.pago === false, `${pub.s} ${texto(pv)}`)

  secao('11. Celular e tablet: bloco de pagamento cabe sem rolagem lateral')
  for (const [nome, vp] of [['celular', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
    const c = await browser.newContext({ viewport: vp, locale: 'pt-BR', storageState: await ate.ctx.storageState(), hasTouch: true })
    const p = await c.newPage()
    await ir(p, `${BASE}/admin/pdv`)
    await p.getByTestId('card-balcao').click()
    await p.getByTestId('balcao-novo').click()
    await p.getByTestId('balcao-modalidade-retirada').click()
    await p.getByTestId('balcao-nome').fill(`TESTE ${nome}`)
    await p.getByTestId('balcao-abrir').click()
    await p.getByRole('button', { name: /Água com Gás/ }).first().click()
    await p.getByRole('button', { name: /Ver pedido/ }).click({ timeout: 3000 }).catch(() => {})
    await p.getByTestId('pdv-pagamento').waitFor({ timeout: 8000 }).catch(() => {})
    await p.getByTestId('pdv-pagamento').scrollIntoViewIfNeeded().catch(() => {})
    const vis = await p.getByTestId('pdv-pagamento').isVisible().catch(() => false)
    ok(`${nome}: bloco visível e sem rolagem lateral`, vis && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await foto(p, `10-${nome}`)
    await c.close()
  }
} catch (e) {
  ok('execução sem exceção', false, (e.stack ?? e.message).split('\n').slice(0, 3).join(' | '))
} finally {
  await db.query(`update restaurantes set financeiro_ativo=false, impressao_agente_token=null, impressao_automatica=false, impressao_ativar_assistente=false where id=$1`, [loja.id]).catch(() => {})
  await db.query(`update caixa_turnos set fechado_em=now(), fechado_por_nome='e2e (limpeza)' where restaurante_id=$1 and fechado_em is null`, [loja.id]).catch(() => {})
  await db.query(`delete from estacoes where restaurante_id=$1 and nome like 'TESTE%'`, [loja.id]).catch(() => {})
  await browser.close(); await db.end()
  const falhas = res.filter((x) => !x).length
  console.log(`\n${res.length - falhas}/${res.length} verificações ok`)
  process.exit(falhas ? 1 : 0)
}
