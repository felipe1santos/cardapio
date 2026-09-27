// E2E local da estabilidade operacional (2026-09-26): Mesas e Comandas, PDV/Balcão,
// Logística/Rotas com e sem motoboy, fonte única de status/financeiro, impressão,
// permissões e o celular na tela da mesa. Só banco LOCAL, loja ISOLADA; as flags da loja
// voltam ao valor original no fim.
//
//   E2E_LOJA=cantina-e2e E2E_VIZINHA=vizinha-e2e E2E_SUFIXO=e2e node scripts/seguranca/e2e-estabilidade-operacional.mjs [shots]
import { chromium } from 'playwright'
import pg from 'pg'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { E2E_LOJA, E2E_VIZINHA, USU, exigirLojaIsolada } from './e2e-ambiente.mjs'

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
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
async function aguardar(fn, ms = 15000, passo = 400) {
  const fim = Date.now() + ms
  while (Date.now() < fim) { const v = await fn(); if (v) return v; await esperar(passo) }
  return null
}
const SUF = Date.now().toString().slice(-6)

const loja = await um(`select id, usa_logistica, entrega_sem_entregador, pdv_v2, modulo_mesas_ativo, mesa_somente_visualizacao from restaurantes where slug = $1`, [E2E_LOJA])
const vizinha = await um(`select id from restaurantes where slug = $1`, [E2E_VIZINHA])
const original = { ...loja }
await q(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e estabilidade', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja.id])
await q(`update mesas set limpeza_desde=null, limpeza_comanda_id=null, bloqueada_em=null where restaurante_id=$1`, [loja.id])
await q(`update restaurantes set pdv_v2=true, modulo_mesas_ativo=true, status_loja='aberto_manual', aceita_entrega=true,
  usa_logistica=true, entrega_sem_entregador=false, mesa_somente_visualizacao=false where id=$1`, [loja.id])
const mesas = await q(`select id, nome from mesas where restaurante_id=$1 and ativa order by ordem`, [loja.id])
const agua = await um(`select id, nome, preco from itens_cardapio where restaurante_id = $1 and nome = 'Água com Gás'`, [loja.id])
const ENDERECO = { cep: '29050-100', rua: 'Rua E2E', numero: '10', bairro: 'Centro', cidade: 'Vitória', estado: 'ES', complemento: '', referencia: '' }

const browser = await chromium.launch()
async function logar(usuario, w = 1366, h = 900) {
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
const dispensar = (p) => p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 1500 }).catch(() => {})
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}, { url, metodo, corpo })
const foto = async (p, nome) => { if (SHOTS) await p.screenshot({ path: join(SHOTS, `${nome}.png`) }) }
const lancar = (p, alvo, qtd = 1) => api(p, '/api/admin/pdv/lancamento', 'POST', { ...alvo, chave: uuid(), itens: [{ itemId: agua.id, quantidade: qtd, complementos: [] }] })
const totais = async (comandaId) => um(`select total::float, pago::float, restante::float from comanda_totais($1)`, [comandaId])
const elegiveisImpressao = async () => new Set((await q(`select * from impressao_elegiveis($1)`, [loja.id])).map((r) => Object.values(r)[0]))
const brl = (v) => v.toFixed(2).replace('.', ',')

let entregadorId = null
try {
  const ger = await logar(USU.gerente)
  const at = await logar(USU.atendente)

  // ══ A. Mesas e Comandas ══════════════════════════════════════════════════
  secao('A1. Mesa aberta: nome e telefone editáveis depois de aberta')
  const [M1, M2, M3, M4] = mesas
  const ab1 = await api(at, `/api/admin/mesas/${M1.id}/atendimento`, 'POST', { acao: 'abrir', nome: `E2E Mesa ${SUF}`, chave: uuid() })
  const c1 = await um(`select id from comandas where mesa_id=$1 and status='aberta'`, [M1.id])
  ok('mesa abre com nome', ab1.s < 300 && c1, `${ab1.s} ${ab1.j?.error ?? ''}`)
  const idf = await api(at, `/api/admin/comandas/${c1.id}`, 'POST', { acao: 'identificar', nome: `E2E Mesa Editada ${SUF}`, telefone: '27988887777' })
  const c1b = await um(`select cliente_nome, cliente_telefone from comandas where id=$1`, [c1.id])
  ok('atendente troca nome e telefone da mesa aberta', idf.s === 200 && c1b.cliente_nome === `E2E Mesa Editada ${SUF}` && c1b.cliente_telefone?.endsWith('27988887777'), JSON.stringify(c1b))
  ok('  auditado (comanda.identificou)', !!(await um(`select 1 from eventos_auditoria where entidade_id=$1 and acao='comanda.identificou'`, [c1.id])))
  const telaM1 = await api(ger, `/api/admin/mesas/${M1.id}/conta`)
  ok('tela da mesa recebe o cliente e a permissão de editar', telaM1.j?.conta?.clienteNome === `E2E Mesa Editada ${SUF}` && telaM1.j?.permissoes?.identificar === true)

  secao('A2. Mesa com pedido em andamento: cancelar a conta com motivo, auditoria e resumo')
  await lancar(at, { comandaId: c1.id })
  await lancar(at, { comandaId: c1.id }, 2)
  const pedsM1 = await q(`select id, status from pedidos where comanda_id=$1`, [c1.id])
  await q(`update pedidos set status='preparando' where id=$1`, [pedsM1[0].id])
  const antesCanc = await totais(c1.id)
  await ger.goto(`${BASE}/admin/mesas/${M1.id}`, { waitUntil: 'networkidle' }); await dispensar(ger)
  await ger.getByRole('tab', { name: /Conta/ }).click()
  await ger.getByTestId('conta-cliente').waitFor()
  ok('cartão do cliente mostra o nome na conta', (await ger.getByTestId('conta-cliente').innerText()).includes(`E2E Mesa Editada ${SUF}`))
  await ger.getByRole('button', { name: 'Cancelar a conta' }).click()
  const dlgMotivo = ger.getByRole('dialog', { name: 'Cancelar a conta desta mesa' })
  await dlgMotivo.locator('input').fill('Cliente foi embora sem consumir')
  await ger.getByRole('button', { name: /^Confirmar$|^Cancelar a conta$/ }).last().click()
  await ger.getByTestId('resumo-encerramento').waitFor({ timeout: 15000 })
  const txtRes = await ger.getByTestId('resumo-encerramento').innerText()
  ok('resumo: conta cancelada com total, pago, falta, pendentes, cancelados, motivo e autor',
    /Conta cancelada/i.test(txtRes) && txtRes.includes(brl(antesCanc.total)) && /Pedidos pendentes no encerramento\s*2/.test(txtRes)
      && /Pedidos cancelados\s*2/.test(txtRes) && txtRes.includes('Cliente foi embora sem consumir') && /Gerente/i.test(txtRes), txtRes.replace(/\n/g, ' | '))
  await foto(ger, 'a2-resumo-cancelada')
  await ger.getByRole('button', { name: 'Ok' }).click()
  const cc = await um(`select status, cancelada_motivo from comandas where id=$1`, [c1.id])
  const pc = await q(`select status, reimprimir from pedidos where comanda_id=$1`, [c1.id])
  ok('comanda cancelada e todos os pedidos cancelados', cc.status === 'cancelada' && pc.every((p) => p.status === 'cancelado'))
  const fila = await elegiveisImpressao()
  ok('nenhum pedido cancelado entra na fila de impressão', pc.length > 0 && pedsM1.every((p) => !fila.has(p.id)) && pc.every((p) => p.reimprimir === false))
  ok('  auditado (conta.cancelou_comanda com motivo)', (await um(`select dados from eventos_auditoria where entidade_id=$1 and acao='conta.cancelou_comanda'`, [c1.id]))?.dados?.motivo === 'Cliente foi embora sem consumir')

  secao('A3. Mesa antiga SEM nome (legado): fechar pede o nome, resolve pendência, recebe e fecha')
  // Como as contas travadas de produção nasceram: loja ainda sem PDV v2, comanda sem nome.
  await q(`update restaurantes set pdv_v2=false where id=$1`, [loja.id])
  const cLeg = (await um(`insert into comandas (restaurante_id, mesa_id) values ($1,$2) returning id`, [loja.id, M2.id])).id
  const pLeg = (await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, canal, comanda_id, mesa, origem, cliente_nome, impresso)
     values ($1,'retirada','recebido',$2,$2,'mesa',$3,$4,'pdv',$4, true) returning id`, [loja.id, Number(agua.preco), cLeg, M2.nome])).id
  await q(`insert into pedido_itens (pedido_id, item_id, nome, preco_unitario, quantidade) values ($1,$2,$3,$4,1)`, [pLeg, agua.id, agua.nome, agua.preco])
  await q(`update restaurantes set pdv_v2=true where id=$1`, [loja.id])
  const c2 = await um(`select id, cliente_nome from comandas where mesa_id=$1 and status='aberta'`, [M2.id])
  ok('cenário: conta de mesa aberta sem nome (antes do PDV v2)', c2?.id === cLeg && !c2.cliente_nome)
  await q(`update comandas set aberta_em = now() - interval '40 days' where id=$1`, [c2.id])
  const p2 = await um(`select id, numero from pedidos where comanda_id=$1`, [c2.id])
  await ger.goto(`${BASE}/admin/mesas/${M2.id}`, { waitUntil: 'networkidle' }); await dispensar(ger)
  await ger.getByRole('tab', { name: /Conta/ }).click()
  await ger.getByTestId('conta-cliente').waitFor()
  ok('conta antiga: aviso de "aberta há 40 dias"', (await ger.getByTestId('conta-esquecida').innerText()).includes('40 dias'))
  ok('conta antiga: "Sem nome — informe antes de fechar"', (await ger.getByTestId('conta-cliente').innerText()).includes('Sem nome'))
  ok('"Fechar conta" habilitado mesmo com saldo (o fechamento recebe)', !(await ger.getByTestId('mesa-fechar-conta').isDisabled()))
  await ger.getByTestId('mesa-fechar-conta').click()
  await ger.getByTestId('identificar-nome').waitFor({ timeout: 8000 })
  ok('fechar sem nome abre o pedido de nome (não trava)', true)
  await ger.getByTestId('identificar-nome').fill(`E2E Legado ${SUF}`)
  await ger.getByTestId('identificar-salvar').click()
  await ger.getByTestId('fechar-modal').waitFor({ timeout: 15000 })
  ok('depois do nome, segue direto para o fechamento', true)
  await ger.getByTestId(`fechar-pendencia-${p2.numero}-entregue`).click()
  await ger.getByTestId('fechar-simulacao').waitFor()
  await esperar(800)
  const t2 = await totais(c2.id)
  await ger.getByTestId('fechar-pag-0-forma-dinheiro').click()
  await ger.getByTestId('fechar-pag-0-valor').fill(brl(t2.restante))
  await ger.waitForFunction(() => !document.querySelector('[data-testid="fechar-confirmar"]')?.disabled, null, { timeout: 10000 })
  await ger.getByTestId('fechar-confirmar').click()
  await ger.getByTestId('resumo-encerramento').waitFor({ timeout: 20000 })
  const txt2 = await ger.getByTestId('resumo-encerramento').innerText()
  ok('resumo: conta fechada, pago = total, falta 0, em limpeza', /Conta fechada/i.test(txt2) && /Falta pagar\s*R\$\s*0,00/.test(txt2) && /em limpeza/i.test(txt2), txt2.replace(/\n/g, ' | '))
  await foto(ger, 'a3-resumo-fechada')
  await ger.getByRole('button', { name: 'Ok' }).click()
  const c2f = await um(`select status, cliente_nome from comandas where id=$1`, [c2.id])
  const m2 = await um(`select limpeza_desde from mesas where id=$1`, [M2.id])
  ok('comanda fechada com o nome informado; mesa em limpeza', c2f.status === 'fechada' && c2f.cliente_nome === `E2E Legado ${SUF}` && m2.limpeza_desde)

  secao('A4. Mesa paga: liberar para o próximo cliente')
  const lib = await api(at, `/api/admin/mesas/${M2.id}/atendimento`, 'POST', { acao: 'liberar' })
  ok('liberar tira a mesa da limpeza', lib.s < 300 && !(await um(`select limpeza_desde from mesas where id=$1`, [M2.id])).limpeza_desde, `${lib.s} ${lib.j?.error ?? ''}`)
  const reab = await api(at, `/api/admin/mesas/${M2.id}/atendimento`, 'POST', { acao: 'abrir', nome: `E2E Próximo ${SUF}`, chave: uuid() })
  ok('mesa liberada aceita o próximo cliente', reab.s < 300, `${reab.s} ${reab.j?.error ?? ''}`)

  secao('A5. Mesa paga não cancela; atendente não cancela conta; vizinha não enxerga')
  const c3 = await um(`select id from comandas where mesa_id=$1 and status='aberta'`, [M2.id])
  await lancar(at, { comandaId: c3.id })
  const t3 = await totais(c3.id)
  const pg3 = await api(at, `/api/admin/comandas/${c3.id}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: t3.total, chave: uuid() })
  ok('pagamento registrado', pg3.s === 200, `${pg3.s} ${pg3.j?.error ?? ''}`)
  const cancPago = await api(ger, `/api/admin/comandas/${c3.id}`, 'POST', { acao: 'cancelar_conta', motivo: 'Tentativa com pagamento' })
  ok('conta com pagamento não cancela (estorno primeiro)', cancPago.s === 409 && /Estorne/i.test(cancPago.j?.error ?? ''), cancPago.j?.error)
  const cancAt = await api(at, `/api/admin/comandas/${c3.id}`, 'POST', { acao: 'cancelar_conta', motivo: 'Atendente tentando' })
  ok('atendente não cancela a conta inteira (403)', cancAt.s === 403)
  const viz = await logar(USU.donoVizinhaEmail)
  ok('dono da vizinha não acha a conta desta loja (404)', (await api(viz, `/api/admin/comandas/${c3.id}`, 'POST', { acao: 'cancelar_conta', motivo: 'de outra loja' })).s === 404)
  const motivoCurto = await api(ger, `/api/admin/comandas/${c3.id}`, 'POST', { acao: 'cancelar_conta', motivo: 'x' })
  ok('motivo curto recusado', motivoCurto.s === 400)

  secao('A6. PDV: cancelar conta de mesa com pedido na cozinha pelo PDV v2')
  const ab4 = await api(at, `/api/admin/mesas/${M3.id}/atendimento`, 'POST', { acao: 'abrir', nome: `E2E PDV Cancela ${SUF}`, chave: uuid() })
  const c4 = await um(`select id from comandas where mesa_id=$1 and status='aberta'`, [M3.id])
  await lancar(at, { comandaId: c4.id })
  const canc4 = await api(ger, `/api/admin/comandas/${c4.id}`, 'POST', { acao: 'cancelar_conta', motivo: 'Mesa esquecida aberta' })
  const c4f = await um(`select status from comandas where id=$1`, [c4.id])
  const lim4 = await um(`select limpeza_desde from mesas where id=$1`, [M3.id])
  ok('gerente cancela pelo PDV; mesa fica livre', ab4.s < 300 && canc4.s === 200 && c4f.status === 'cancelada' && !lim4.limpeza_desde, `${canc4.s} ${canc4.j?.error ?? ''}`)
  const ler4 = await api(ger, `/api/admin/comandas/${c4.id}`)
  ok('conta lida depois traz motivo, autor e horário do cancelamento', ler4.j?.conta?.canceladaMotivo === 'Mesa esquecida aberta' && !!ler4.j?.conta?.canceladaPorNome && !!ler4.j?.conta?.canceladaEm)
  ok('financeiro da conta cancelada = Cancelado', ler4.j?.conta?.situacao === 'cancelado', ler4.j?.conta?.situacao)

  // ══ E. Balcão: status real e "a acertar" ══════════════════════════════════
  secao('E1. Balcão: status real (saiu p/ entrega, entregue) e financeiro na Central')
  const cb = await api(at, '/api/admin/balcao/comandas', 'POST', { nome: `E2E Acertar ${SUF}`, chave: uuid(), modalidade: 'retirada' })
  await lancar(at, { comandaId: cb.j.id })
  const pb = await um(`select id from pedidos where comanda_id=$1`, [cb.j.id])
  await q(`update pedidos set status='entregue', atendimento_status='entregue_balcao' where id=$1`, [pb.id])
  const senhaB = (await um(`select senha from comandas where id=$1`, [cb.j.id])).senha
  const central = await api(at, '/api/admin/balcao/comandas?escopo=abertas')
  const linhaB = central.j?.linhas?.find((l) => l.id === cb.j.id)
  ok('Central: pedido entregue sem pagamento continua na lista de abertas', !!linhaB && linhaB.pago === 0)
  await at.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' }); await dispensar(at)
  await at.getByTestId('card-balcao').click()
  await at.getByTestId('balcao-filtro-acertar').waitFor({ timeout: 10000 })
  ok('Central mostra o filtro "A acertar"', (await at.getByTestId('balcao-filtro-acertar').innerText()).includes('A acertar'))
  ok('linha mostra "Entregue · a receber"', /entregue · a receber/i.test(await at.getByTestId(`balcao-financeiro-${senhaB}`).innerText()))
  ok('linha mostra status real "Entregue"', (await at.getByTestId(`balcao-linha-${senhaB}`).innerText()).includes('Entregue'))
  await foto(at, 'e1-central-a-acertar')
  await at.getByTestId(`balcao-receber-fechar-${senhaB}`).click()
  await at.getByTestId('fechar-modal').waitFor({ timeout: 15000 })
  ok('"Receber e fechar" abre direto o fechamento', true)
  const tb = await totais(cb.j.id)
  await at.getByTestId('fechar-pag-0-forma-dinheiro').click()
  await at.getByTestId('fechar-pag-0-valor').fill(brl(tb.restante))
  await at.waitForFunction(() => !document.querySelector('[data-testid="fechar-confirmar"]')?.disabled, null, { timeout: 10000 })
  await at.getByTestId('fechar-confirmar').click()
  await at.getByTestId('resumo-encerramento').waitFor({ timeout: 20000 })
  ok('resumo do fechamento aparece', /Conta fechada/i.test(await at.getByTestId('resumo-encerramento').innerText()))
  await at.getByRole('button', { name: 'Ok' }).click()
  ok('comanda fechada e pagamento no caixa', (await um(`select status from comandas where id=$1`, [cb.j.id])).status === 'fechada' && (await totais(cb.j.id)).restante === 0)

  secao('E2. Balcão entrega com motoboy: em rota → "saiu p/ entrega"; já pago no caixa → portal não cobra')
  const ce = await api(at, '/api/admin/balcao/comandas', 'POST', { nome: `E2E Motoboy ${SUF}`, chave: uuid(), modalidade: 'entrega', entrega: { ...ENDERECO, taxa: '5' } })
  await lancar(at, { comandaId: ce.j.id })
  const pe = await um(`select id, numero from pedidos where comanda_id=$1`, [ce.j.id])
  const te = await totais(ce.j.id)
  await api(at, `/api/admin/comandas/${ce.j.id}`, 'POST', { acao: 'pagamento', forma: 'pix', valor: te.total, chave: uuid() })
  const drv = await um(`insert into entregadores (restaurante_id, nome, telefone, status) values ($1, $2, '27999990000', 'online') returning id, token`, [loja.id, `E2E Moto ${SUF}`])
  entregadorId = drv.id
  await q(`update pedidos set status='pronto' where id=$1`, [pe.id])
  await q(`update pedidos set status='em_rota', entregador_id=$2 where id=$1`, [pe.id, drv.id])
  const linhaE = (await api(at, '/api/admin/balcao/comandas?escopo=abertas')).j?.linhas?.find((l) => l.id === ce.j.id)
  ok('Central recebe o pedido em rota (status real)', linhaE?.pedidos?.[0]?.status === 'em_rota')
  const portal = await (await fetch(`${BASE}/api/entregador/${drv.token}`)).json()
  const noPortal = portal.pedidos?.find((p) => p.id === pe.id)
  ok('portal do motoboy: pago no caixa aparece como pago (não "Receber")', noPortal?.pago === true, JSON.stringify({ pago: noPortal?.pago }))
  const entregar = await fetch(`${BASE}/api/entregador/${drv.token}/pedidos/${pe.id}/entregar`, { method: 'POST' })
  ok('motoboy marca entregue pelo app', entregar.ok && (await um(`select status from pedidos where id=$1`, [pe.id])).status === 'entregue')
  const contaE = (await api(at, `/api/admin/comandas/${ce.j.id}`)).j?.conta
  ok('PDV lê o mesmo estado: pedido entregue, conta paga', contaE?.pedidos?.[0]?.status === 'entregue' && contaE?.situacao === 'pago', contaE?.situacao)

  // ══ D/C. Delivery sem e com motoboy ══════════════════════════════════════
  const novoDelivery = async (nome) => um(
    `insert into pedidos (restaurante_id, tipo, status, subtotal, total, canal, origem, cliente_nome, cliente_telefone, forma_pagamento, impresso)
     values ($1,'entrega','pronto',20,20,'delivery','cardapio',$2,'27988880000','dinheiro', true) returning id, numero`, [loja.id, nome])

  secao('D1. Loja SEM motoboy (Logística desligada): Rotas desabilitado, "Saiu p/ entrega" conclui')
  await q(`update restaurantes set usa_logistica=false, entrega_sem_entregador=false where id=$1`, [loja.id])
  const d1 = await novoDelivery(`E2E Sem Moto ${SUF}`)
  await ger.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' }); await dispensar(ger)
  await ger.getByTestId(`pedido-${d1.numero}`).waitFor({ timeout: 10000 })
  ok('botão Rotas desabilitado', (await ger.locator('[data-rotas-desligado]').count()) === 1 && await ger.locator('[data-rotas-desligado]').isDisabled())
  await foto(ger, 'd1-kanban-sem-motoboy')
  await ger.getByTestId(`pedido-${d1.numero}`).getByRole('button', { name: 'Saiu p/ entrega' }).click()
  const s1 = await aguardar(async () => { const r = await um(`select status from pedidos where id=$1`, [d1.id]); return r.status === 'entregue' ? r : null })
  ok('"Saiu p/ entrega" termina o pedido (sem esperar motoboy)', !!s1)
  ok('  nenhum ✓ extra para marcar entregue', (await ger.getByRole('button', { name: '✓' }).count()) === 0)

  secao('D2. Loja COM motoboy: Rotas habilitado, saída pelo Kanban recusada, motoboy conclui')
  await q(`update restaurantes set usa_logistica=true, entrega_sem_entregador=false where id=$1`, [loja.id])
  const d2 = await novoDelivery(`E2E Com Moto ${SUF}`)
  await ger.reload({ waitUntil: 'networkidle' }); await dispensar(ger)
  ok('botão Rotas habilitado', (await ger.locator('[data-rotas-desligado]').count()) === 0 && (await ger.getByRole('button', { name: 'Rotas' }).count()) === 1)
  ok('saída "sem entregador" recusada pela API (409)', (await api(ger, `/api/admin/pedidos/${d2.id}/saiu-entrega`, 'POST')).s === 409)

  secao('C1. Logística: atribuir com o aviso de WhatsApp falhando NÃO mostra "Não foi possível salvar"')
  await ger.route('**/api/pedidos/*/notificar', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Erro ao notificar"}' }))
  await ger.goto(`${BASE}/admin/logistica`, { waitUntil: 'networkidle' }); await dispensar(ger)
  const cartao = ger.locator(`text=#${d2.numero}`).first()
  await cartao.waitFor({ timeout: 10000 })
  const bloco = ger.locator('div').filter({ has: ger.locator(`text=#${d2.numero}`) }).filter({ has: ger.getByRole('button', { name: /Atribuir/ }) }).last()
  let viuErro = false
  const olho = setInterval(async () => { if (await ger.getByText('Não foi possível salvar').count().catch(() => 0)) viuErro = true }, 150)
  await bloco.getByRole('button', { name: /Atribuir/ }).click()
  await ger.getByRole('button', { name: new RegExp(`E2E Moto ${SUF}`) }).click()
  const atrib = await aguardar(async () => { const r = await um(`select status, entregador_id from pedidos where id=$1`, [d2.id]); return r.status === 'em_rota' ? r : null })
  await esperar(2500)
  clearInterval(olho)
  ok('pedido atribuído e em rota', atrib?.entregador_id === drv.id)
  ok('sem o falso "Não foi possível salvar" (aviso de WhatsApp é efeito, não a gravação)', !viuErro)
  await ger.unroute('**/api/pedidos/*/notificar')
  const ent2 = await fetch(`${BASE}/api/entregador/${drv.token}/pedidos/${d2.id}/entregar`, { method: 'POST' })
  ok('motoboy marca entregue pelo app (fluxo completo com motoboy)', ent2.ok && (await um(`select status from pedidos where id=$1`, [d2.id])).status === 'entregue')

  secao('C2. Atribuir pedido que mudou de situação: avisa, não mente')
  const d3 = await novoDelivery(`E2E Mudou ${SUF}`)
  // Tela "velha": sem realtime (o fallback por polling demora), como um operador com a
  // conexão ruim ou outra aba. É a corrida real: o pedido muda e a tela ainda não soube.
  const velha = await logar(USU.gerente)
  await velha.routeWebSocket(/realtime/, (ws) => ws.close())
  await velha.goto(`${BASE}/admin/logistica`, { waitUntil: 'networkidle' }); await dispensar(velha)
  await velha.locator(`text=#${d3.numero}`).first().waitFor({ timeout: 10000 })
  await q(`update pedidos set status='cancelado', cancelado_motivo='outro', cancelado_em=now() where id=$1`, [d3.id])
  const bloco3 = velha.locator('div').filter({ has: velha.locator(`text=#${d3.numero}`) }).filter({ has: velha.getByRole('button', { name: /Atribuir/ }) }).last()
  await bloco3.getByRole('button', { name: /Atribuir/ }).click()
  await velha.getByRole('button', { name: new RegExp(`E2E Moto ${SUF}`) }).click()
  await esperar(2000)
  const d3s = await um(`select status from pedidos where id=$1`, [d3.id])
  ok('cancelado em outra tela não volta para "em rota"', d3s.status === 'cancelado', d3s.status)
  ok('operador é avisado que o pedido mudou', (await velha.getByText(/mudou de situação/).count()) > 0)
  await foto(velha, 'c2-pedido-mudou')

  // ══ B. QR em somente visualização no celular ══════════════════════════════
  secao('B. Aviso de somente visualização no celular: ícone pequeno + modal')
  await q(`update restaurantes set mesa_somente_visualizacao=true where id=$1`, [loja.id])
  const cel = await logar(USU.gerente, 390, 844)
  await cel.goto(`${BASE}/admin/mesas/${M4.id}`, { waitUntil: 'networkidle' }); await dispensar(cel)
  const icone = cel.locator('[data-aviso-somente-visualizacao]')
  await icone.waitFor({ timeout: 10000 })
  const caixa = await icone.boundingBox()
  ok('é um ícone pequeno (≤ 40px), não um card', caixa && caixa.height <= 40 && caixa.width <= 40, JSON.stringify(caixa))
  ok('o texto longo não fica na página', (await cel.getByText('O QR desta loja é só para o cliente ver o cardápio').count()) === 0)
  const larg = await cel.evaluate(() => document.documentElement.scrollWidth)
  ok('sem rolagem horizontal em 390px', larg <= 390, String(larg))
  await foto(cel, 'b-icone-390')
  await icone.click()
  const modal = cel.locator('[data-modal-somente-visualizacao]')
  await modal.waitFor()
  ok('toque abre o modal com a explicação', (await modal.innerText()).includes('só para o cliente ver o cardápio'))
  await foto(cel, 'b-modal-390')
  await cel.getByRole('button', { name: 'Entendi' }).click()
  ok('modal fecha em "Entendi"', (await modal.count()) === 0)
} catch (e) {
  console.error(e)
  ok('suíte terminou sem exceção', false, e.message)
} finally {
  await q(`update restaurantes set usa_logistica=$2, entrega_sem_entregador=$3, pdv_v2=$4, modulo_mesas_ativo=$5, mesa_somente_visualizacao=$6 where id=$1`,
    [loja.id, original.usa_logistica, original.entrega_sem_entregador, original.pdv_v2, original.modulo_mesas_ativo, original.mesa_somente_visualizacao])
  if (entregadorId) await q(`update pedidos set entregador_id=null where entregador_id=$1`, [entregadorId]).then(() => q(`delete from entregadores where id=$1`, [entregadorId])).catch(() => {})
  await browser.close()
  await db.end()
}
const passou = res.filter(Boolean).length
console.log(`\n${passou}/${res.length} verificações passaram`)
process.exit(passou === res.length ? 0 : 1)
