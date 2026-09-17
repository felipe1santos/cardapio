/**
 * Etapa F — conta, pagamentos, cancelamentos e transferências, de ponta a ponta.
 *
 *  1. totais vêm do banco (itens × preço + taxa de serviço − desconto);
 *  2. cancelar item e lançamento: com motivo, sem apagar, só gerente/dono;
 *  3. reimprimir usa a flag que o Assistente já lê — nada de formato novo;
 *  4. transferir itens: parte do lançamento vira lançamento no destino, sem reimprimir;
 *  5. pagamentos: parcial, idempotente, concorrente, troco, estorno com permissão;
 *  6. fechar: bloqueado com saldo, fecha zerado, mesa fica livre;
 *  7. trocar de mesa: livre move; ocupada recusa sem confirmação e junta com ela;
 *     cliente na URL antiga é orientado sem ganhar acesso à mesa nova;
 *  8. permissões por papel na API e no banco;
 *  9. configuração da loja: taxa padrão e formas de pagamento, só para quem gerencia.
 *
 * Refaz a semente da demonstração no começo (estado conhecido a cada execução).
 * Só loopback. Precisa do servidor em BASE e da stack local.
 *   node scripts/seguranca/e2e-etapa-f.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, ANON_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)

execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })
mkdirSync('.shots', { recursive: true })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const uuid = () => crypto.randomUUID()
const n = (v) => Number(v)

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

const loja = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
await q(`update restaurantes set taxa_servico_padrao = 10, formas_pagamento_mesa = array['dinheiro','pix','credito','debito'] where id = $1`, [loja])
const mesa = async (nome) => um(`select id, token from mesas where restaurante_id=$1 and nome=$2`, [loja, nome])
const M01 = await mesa('Mesa 01')
const M02 = await mesa('Mesa 02')
const M03 = await mesa('Mesa 03')
const V01 = await mesa('Varanda 01')
const V02 = await mesa('Varanda 02')
const B01 = await mesa('Balcão 01')
const item = async (nome) => (await um(`select id from itens_cardapio where restaurante_id=$1 and nome=$2`, [loja, nome])).id
const RISOTO = await item('Risoto de Funghi')
const AGUA = await item('Água com Gás')
const SUCO = await item('Suco de Laranja')
const FILE = await item('Filé à Parmegiana')
const outraLoja = await um(`select m.id from mesas m join restaurantes r on r.id = m.restaurante_id where r.slug <> 'cantina-demo' limit 1`)

const browser = await chromium.launch()

async function logar(usuario) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([
    page.waitForURL((u) => u.pathname.startsWith('/admin') || u.searchParams.has('error'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForLoadState('networkidle').catch(() => {})
  return { ctx, page }
}

const api = (page, url, metodo = 'GET', corpo) =>
  page.evaluate(
    async ({ url, metodo, corpo }) => {
      const r = await fetch(url, {
        method: metodo,
        headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
        body: corpo ? JSON.stringify(corpo) : undefined,
        redirect: 'manual',
      })
      let json = null
      try { json = await r.json() } catch { /* sem corpo */ }
      return { status: r.status, json }
    },
    { url, metodo, corpo },
  )

const lancar = (page, mesaId, itens) =>
  api(page, `/api/admin/mesas/${mesaId}/lancamento`, 'POST', {
    chaveIdempotencia: uuid(),
    selecoesVistas: [],
    itens: itens.map(([itemId, quantidade]) => ({ itemId, quantidade, observacao: '', complementos: [] })),
  })
const conta = async (page, mesaId) => (await api(page, `/api/admin/mesas/${mesaId}/conta`)).json
const agir = (page, mesaId, acao, corpo = {}) => api(page, `/api/admin/mesas/${mesaId}/conta`, 'POST', { acao, ...corpo })
const totais = async (page, mesaId) => (await conta(page, mesaId))?.conta?.totais

const dono = await logar('dono.local')
const garcom = await logar('garcom.local')
const atendente = await logar('atendente.local')

// ════════════════════════════════════════════════════════════════════════════
secao('1. conta: totais vindos do banco')
const L1 = await lancar(garcom.page, M01.id, [[RISOTO, 1], [AGUA, 2]])
const L2 = await lancar(garcom.page, M01.id, [[SUCO, 1], [FILE, 1]])
const L3 = await lancar(garcom.page, M01.id, [[AGUA, 1]])
ok('garçom lança 3 vezes na Mesa 01', [L1, L2, L3].every((r) => r.status === 200 || r.status === 201), [L1, L2, L3].map((r) => r.status).join(','))
const comanda01 = (await um(`select id, taxa_servico_percentual from comandas where mesa_id=$1 and status='aberta'`, [M01.id]))
ok('conta nova herda a taxa de serviço padrão da loja (10%)', n(comanda01.taxa_servico_percentual) === 10, comanda01.taxa_servico_percentual)
{
  const t = await totais(garcom.page, M01.id)
  // 54 + 14 + 12 + 68 + 7 = 155; taxa 15,50; total 170,50
  ok('subtotal = soma dos itens', t.subtotal === 155, t.subtotal)
  ok('taxa de serviço 10%', t.taxaServico === 15.5, t.taxaServico)
  ok('total e restante', t.total === 170.5 && t.restante === 170.5, `${t.total} / ${t.restante}`)
}
const idsLanc = async () => (await conta(dono.page, M01.id)).conta.lancamentos
const lancs = await idsLanc()
const itemDe = (l, nome) => l.itens.find((i) => i.nome === nome)
const [l1, l2, l3] = lancs

// ════════════════════════════════════════════════════════════════════════════
secao('2. cancelamentos: motivo, permissão e nada apagado')
{
  const fileId = itemDe(l2, 'Filé à Parmegiana').id
  const g = await agir(garcom.page, M01.id, 'cancelar_item', { itemId: fileId, motivo: 'teste' })
  ok('garçom NÃO cancela item (403)', g.status === 403, g.status)
  const semMotivo = await agir(dono.page, M01.id, 'cancelar_item', { itemId: fileId, motivo: '  ' })
  ok('cancelar item sem motivo é recusado', semMotivo.status === 400, semMotivo.json?.error)
  const d = await agir(dono.page, M01.id, 'cancelar_item', { itemId: fileId, motivo: 'Cliente desistiu' })
  ok('dono cancela o Filé com motivo', d.status === 200, d.status)
  const linha = await um(`select cancelado_em, cancelado_motivo, cancelado_por_nome from pedido_itens where id=$1`, [fileId])
  ok('item continua no banco, marcado com motivo e autor', !!linha && !!linha.cancelado_em && linha.cancelado_motivo === 'Cliente desistiu' && !!linha.cancelado_por_nome, JSON.stringify(linha))
  const p2 = await um(`select total, status from pedidos where id=$1`, [l2.id])
  ok('lançamento recalculado (12,00) e segue ativo', n(p2.total) === 12 && p2.status !== 'cancelado', `${p2.total} ${p2.status}`)

  const gp = await agir(garcom.page, M01.id, 'cancelar_pedido', { pedidoId: l3.id, motivo: 'teste' })
  ok('garçom NÃO cancela lançamento (403)', gp.status === 403, gp.status)
  const dp = await agir(dono.page, M01.id, 'cancelar_pedido', { pedidoId: l3.id, motivo: 'Lançado em duplicidade' })
  ok('dono cancela o lançamento #3 com motivo', dp.status === 200, dp.status)
  const p3 = await um(`select status, cancelado_observacao, cancelado_por, reimprimir from pedidos where id=$1`, [l3.id])
  ok('pedido continua no banco, status cancelado + motivo + autor', p3?.status === 'cancelado' && p3.cancelado_observacao === 'Lançado em duplicidade' && !!p3.cancelado_por, JSON.stringify(p3))
  ok('cancelado não fica com reimpressão pendente', p3.reimprimir === false)
  const t = await totais(dono.page, M01.id)
  // 54 + 14 + 12 = 80; taxa 8; total 88
  ok('conta sem os cancelados: 80 + 8 = 88', t.subtotal === 80 && t.total === 88, `${t.subtotal} / ${t.total}`)
  const dup = await agir(dono.page, M01.id, 'cancelar_pedido', { pedidoId: l3.id, motivo: 'de novo' })
  ok('cancelar de novo não duplica', dup.status === 404 || dup.status === 409, dup.status)
}

// ════════════════════════════════════════════════════════════════════════════
secao('3. reimpressão pelo mecanismo existente')
{
  await q(`update pedidos set reimprimir=false where id=$1`, [l1.id])
  const r = await agir(garcom.page, M01.id, 'reimprimir', { pedidoId: l1.id })
  const p = await um(`select reimprimir from pedidos where id=$1`, [l1.id])
  ok('garçom pede reimpressão → flag reimprimir=true (o Assistente imprime o recibo de sempre)', r.status === 200 && p.reimprimir === true, r.status)
  const c = await agir(garcom.page, M01.id, 'reimprimir', { pedidoId: l3.id })
  ok('lançamento cancelado não é reimpresso', c.status === 409 || c.status === 404, c.status)
  const outro = await agir(garcom.page, M01.id, 'reimprimir', { pedidoId: uuid() })
  ok('id de pedido que não é desta conta é recusado', outro.status === 404, outro.status)
  await q(`update pedidos set reimprimir=false where id=$1`, [l1.id])
}

// ════════════════════════════════════════════════════════════════════════════
secao('4. transferir itens específicos')
{
  const aguaId = itemDe(l1, 'Água com Gás').id
  const sucoId = itemDe(l2, 'Suco de Laranja').id
  const bloq = await agir(garcom.page, M01.id, 'transferir_itens', { itemIds: [aguaId], destinoMesaId: V02.id })
  ok('destino bloqueado é recusado', bloq.status === 400 && /bloqueada/.test(bloq.json?.error ?? ''), bloq.json?.error)
  const alheio = await agir(garcom.page, M01.id, 'transferir_itens', { itemIds: [uuid()], destinoMesaId: M03.id })
  ok('item que não é desta mesa é recusado', alheio.status === 400, alheio.json?.error)

  const qtdAntes = (await um(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja])).n
  const r = await agir(garcom.page, M01.id, 'transferir_itens', { itemIds: [aguaId], destinoMesaId: M03.id })
  ok('garçom transfere as Águas (parte do lançamento #1) para a Mesa 03', r.status === 200, r.json?.error ?? r.status)
  const novo = await um(`select p.id, p.impresso, p.canal, p.total from pedidos p join pedido_itens i on i.pedido_id=p.id where i.id=$1`, [aguaId])
  ok('nasce um lançamento na Mesa 03 com o item', novo && novo.id !== l1.id, novo?.id)
  ok('o lançamento novo NÃO vai para a fila de impressão (já foi feito)', novo?.impresso === true)
  ok('canal mesa e total recalculado (14,00)', novo?.canal === 'mesa' && n(novo.total) === 14, `${novo?.canal} ${novo?.total}`)
  ok('um pedido a mais no banco', (await um(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja])).n === qtdAntes + 1)
  const p1 = await um(`select total from pedidos where id=$1`, [l1.id])
  ok('lançamento de origem recalculado (54,00)', n(p1.total) === 54, p1.total)

  const inteiro = await agir(garcom.page, M01.id, 'transferir_itens', { itemIds: [sucoId], destinoMesaId: M03.id })
  const p2 = await um(`select c.mesa_id from pedidos p join comandas c on c.id=p.comanda_id where p.id=$1`, [l2.id])
  ok('todos os itens de um lançamento → o lançamento inteiro muda de mesa', inteiro.status === 200 && p2.mesa_id === M03.id, inteiro.json?.error)
  ok('lançamento movido inteiro passa a dizer "Mesa 03"', (await um(`select mesa from pedidos where id=$1`, [l2.id])).mesa === 'Mesa 03')

  const t1 = await totais(garcom.page, M01.id)
  const t3 = await totais(garcom.page, M03.id)
  ok('Mesa 01: 54 + 5,40 = 59,40', t1.total === 59.4, t1.total)
  ok('Mesa 03: 26 + 2,60 = 28,60', t3.total === 28.6, t3.total)
  const hist = (await conta(garcom.page, M03.id)).historico
  ok('histórico da Mesa 03 registra a transferência', hist.some((e) => /Transferiu itens/.test(e.oQue)), hist.map((e) => e.oQue).join(' | '))
}

// ════════════════════════════════════════════════════════════════════════════
secao('5. desconto e taxa: só com permissão')
{
  const g = await agir(garcom.page, M01.id, 'ajustar_valores', { desconto: 4.4, descontoMotivo: 'x' })
  ok('garçom NÃO dá desconto (403)', g.status === 403, g.status)
  const sem = await agir(dono.page, M01.id, 'ajustar_valores', { desconto: 4.4, descontoMotivo: '' })
  ok('desconto sem motivo é recusado', sem.status === 400, sem.json?.error)
  const taxa = await agir(dono.page, M01.id, 'ajustar_valores', { taxaServico: 45 })
  ok('taxa acima de 30% é recusada', taxa.status === 400, taxa.json?.error)
  const d = await agir(dono.page, M01.id, 'ajustar_valores', { desconto: 4.4, descontoMotivo: 'Cortesia da casa' })
  const t = await totais(dono.page, M01.id)
  ok('dono aplica desconto de 4,40 com motivo → total 55,00', d.status === 200 && t.total === 55, t.total)
  const ajuste = await agir(garcom.page, M01.id, 'ajustar_mesa', { pessoas: 2, observacoes: 'Aniversário', assumir: true })
  const c = await um(`select pessoas, observacoes, responsavel_nome from comandas where id=$1`, [comanda01.id])
  ok('garçom edita pessoas, observação e assume a mesa', ajuste.status === 200 && c.pessoas === 2 && c.observacoes === 'Aniversário' && !!c.responsavel_nome, JSON.stringify(c))
}

// ════════════════════════════════════════════════════════════════════════════
secao('6. pagamentos')
const pagamentos = async () => q(`select id, forma, valor, valor_recebido, troco, estornado_em from pagamentos_comanda where comanda_id=$1 order by criado_em`, [comanda01.id])
{
  const K1 = uuid()
  const [a, b] = [
    await agir(garcom.page, M01.id, 'pagamento', { forma: 'pix', valor: 30, chave: K1 }),
    await agir(garcom.page, M01.id, 'pagamento', { forma: 'pix', valor: 30, chave: K1 }),
  ]
  ok('pagamento parcial em Pix registrado', a.status === 200, a.json?.error)
  ok('mesma chave de novo = mesmo pagamento (idempotente)', b.status === 200 && b.json?.idempotente === true && b.json?.id === a.json?.id)
  ok('só UMA linha no banco', (await pagamentos()).length === 1)
  let t = await totais(garcom.page, M01.id)
  ok('pago 30, falta 25', t.pago === 30 && t.restante === 25, `${t.pago} / ${t.restante}`)

  const fechar = await agir(garcom.page, M01.id, 'fechar')
  ok('fechar com saldo é bloqueado', fechar.status === 400 && /falta receber/.test(fechar.json?.error ?? ''), fechar.json?.error)
  ok('conta continua aberta', (await um(`select status from comandas where id=$1`, [comanda01.id])).status === 'aberta')

  const acima = await agir(garcom.page, M01.id, 'pagamento', { forma: 'credito', valor: 25.01, chave: uuid() })
  ok('pagamento acima do que falta é recusado', acima.status === 400, acima.json?.error)
  const forma = await agir(garcom.page, M01.id, 'pagamento', { forma: 'bitcoin', valor: 1, chave: uuid() })
  ok('forma que não existe é recusada', forma.status === 400)
  const semChave = await agir(garcom.page, M01.id, 'pagamento', { forma: 'pix', valor: 1 })
  ok('pagamento sem chave de idempotência é recusado', semChave.status === 400)

  // Dois garçons, ao mesmo tempo, recebendo o restante inteiro em aparelhos diferentes.
  const [c1, c2] = await Promise.all([
    agir(garcom.page, M01.id, 'pagamento', { forma: 'debito', valor: 25, chave: uuid() }),
    agir(dono.page, M01.id, 'pagamento', { forma: 'credito', valor: 25, chave: uuid() }),
  ])
  const statuses = [c1.status, c2.status].sort()
  ok('concorrência: um passa, o outro é recusado', statuses[0] === 200 && statuses[1] === 400, statuses.join(','))
  t = await totais(garcom.page, M01.id)
  ok('nunca recebe mais que o total (pago 55, falta 0)', t.pago === 55 && t.restante === 0, `${t.pago} / ${t.restante}`)

  const ultimo = (await pagamentos()).find((p) => n(p.valor) === 25)
  const ge = await agir(garcom.page, M01.id, 'estorno', { pagamentoId: ultimo.id, motivo: 'teste' })
  ok('garçom NÃO estorna (403)', ge.status === 403, ge.status)
  const semMotivo = await agir(dono.page, M01.id, 'estorno', { pagamentoId: ultimo.id, motivo: '' })
  ok('estorno sem motivo é recusado', semMotivo.status === 400, semMotivo.json?.error)
  const de = await agir(dono.page, M01.id, 'estorno', { pagamentoId: ultimo.id, motivo: 'Cartão recusado depois' })
  const est = await um(`select estornado_em, estorno_motivo from pagamentos_comanda where id=$1`, [ultimo.id])
  ok('dono estorna com motivo; o pagamento fica no banco marcado', de.status === 200 && !!est.estornado_em && est.estorno_motivo === 'Cartão recusado depois')
  t = await totais(garcom.page, M01.id)
  ok('estorno devolve o saldo (falta 25)', t.restante === 25, t.restante)
  const de2 = await agir(dono.page, M01.id, 'estorno', { pagamentoId: ultimo.id, motivo: 'de novo' })
  ok('estornar duas vezes não é possível', de2.status === 400, de2.json?.error)

  // Mesma chave em paralelo (rede instável reenviando) pagando o restante inteiro: os dois
  // envios respondem com o MESMO pagamento, e nenhum é recusado por "acima do restante".
  const K2 = uuid()
  const [m1, m2] = await Promise.all([
    agir(garcom.page, M01.id, 'pagamento', { forma: 'credito', valor: 25, chave: K2 }),
    agir(garcom.page, M01.id, 'pagamento', { forma: 'credito', valor: 25, chave: K2 }),
  ])
  ok('mesma chave em paralelo: os dois respondem 200 com o mesmo id', m1.status === 200 && m2.status === 200 && m1.json?.id === m2.json?.id, `${m1.status}/${m2.status} ${m1.json?.error ?? ''}${m2.json?.error ?? ''}`)
  ok('mesma chave em paralelo: uma linha só', (await q(`select 1 from pagamentos_comanda where chave_idempotencia=$1`, [K2])).length === 1)
  const tk = await totais(garcom.page, M01.id)
  ok('pago 55 de novo', tk.pago === 55 && tk.restante === 0, `${tk.pago} / ${tk.restante}`)
  const est2 = await agir(dono.page, M01.id, 'estorno', { pagamentoId: m1.json?.id, motivo: 'Cliente vai pagar em dinheiro' })
  ok('dono estorna para receber em dinheiro', est2.status === 200, est2.json?.error)
}

// ── UI: garçom recebe em dinheiro com troco e fecha a conta ─────────────────
{
  const p = garcom.page
  await p.goto(`${BASE}/admin/mesas/${M01.id}`, { waitUntil: 'networkidle' })
  await p.getByRole('tab', { name: /Conta/ }).click()
  await p.locator('[data-testid="restante"]').waitFor({ timeout: 15000 })
  ok('aba Conta mostra "Falta pagar" R$ 25,00', /25,00/.test(await p.locator('[data-testid="restante"]').innerText()))
  ok('garçom não vê estorno nem ajuste de desconto', (await p.locator('button[title="Estornar"]').count()) === 0 && (await p.getByText('Ajustar taxa de serviço ou desconto').count()) === 0)
  ok('garçom não vê cancelar item', (await p.locator('button[aria-label^="Cancelar "]').count()) === 0)
  ok('botão Fechar conta desabilitado com saldo', await p.getByRole('button', { name: 'Fechar conta' }).isDisabled())

  await p.getByRole('radio', { name: 'Dinheiro' }).click()
  await p.getByLabel('Valor do pagamento').fill('25')
  await p.getByLabel('Valor recebido').fill('50')
  ok('troco calculado na tela: R$ 25,00', (await p.getByText(/Troco: R\$\s?25,00/).count()) === 1)
  await p.screenshot({ path: '.shots/etapa-f-01-conta-pagamento-dinheiro.png' })
  const antes = (await pagamentos()).length
  await p.getByRole('button', { name: 'Registrar pagamento' }).dblclick()
  await p.getByText('Pagamento registrado.').waitFor({ timeout: 15000 })
  await esperar(1500)
  const depois = await pagamentos()
  ok('clique duplo registra UM pagamento', depois.length === antes + 1, `${antes} → ${depois.length}`)
  const din = depois.at(-1)
  ok('dinheiro com recebido 50 e troco 25 gravados', din.forma === 'dinheiro' && n(din.valor_recebido) === 50 && n(din.troco) === 25, JSON.stringify(din))

  await p.locator('[data-testid="restante"]').filter({ hasText: '0,00' }).waitFor({ timeout: 15000 })
  await p.screenshot({ path: '.shots/etapa-f-02-conta-quitada.png' })
  await p.getByRole('button', { name: 'Fechar conta' }).click()
  await p.getByRole('alertdialog').getByRole('button', { name: 'Fechar conta' }).click()
  await p.getByText(/fechada\. A mesa está livre/).waitFor({ timeout: 15000 })
  const c = await um(`select status, total_final, fechada_por_nome from comandas where id=$1`, [comanda01.id])
  ok('conta fechada com total final 55,00 e autor', c.status === 'fechada' && n(c.total_final) === 55 && !!c.fechada_por_nome, JSON.stringify(c))
  const pagos = await um(`select bool_and(pago) ok from pedidos where comanda_id=$1 and status <> 'cancelado'`, [comanda01.id])
  ok('lançamentos marcados como pagos', pagos.ok === true)
  ok('sessão da mesa encerrada', (await um(`select count(*)::int n from sessoes_mesa where mesa_id=$1 and status='aberta'`, [M01.id])).n === 0)
  ok('Mesa 01 sem conta aberta', (await conta(p, M01.id)).conta === null)
  const pagar = await agir(p, M01.id, 'pagamento', { forma: 'pix', valor: 1, chave: uuid() })
  ok('conta fechada não recebe pagamento', pagar.status === 409, pagar.status)
  await p.screenshot({ path: '.shots/etapa-f-03-conta-fechada.png' })

  await p.goto(`${BASE}/admin/mesas/${M03.id}`, { waitUntil: 'networkidle' })
  await p.getByRole('tab', { name: 'Histórico' }).click()
  await p.getByText(/Transferiu itens/).first().waitFor({ timeout: 15000 })
  ok('aba Histórico lista os eventos com autor', (await p.locator('ol').getByText('Garçom Demo').count()) > 0)
}

// Histórico da Mesa 01 (fechada) pelo banco: tudo auditado.
{
  const acoes = (await q(`select acao from eventos_auditoria where restaurante_id=$1 and entidade_id=$2`, [loja, comanda01.id])).map((r) => r.acao)
  for (const a of ['conta.pagamento', 'conta.estorno', 'conta.ajustou', 'conta.fechou', 'conta.cancelou_item', 'conta.cancelou_pedido', 'conta.reimprimiu']) {
    ok(`auditoria: ${a}`, acoes.includes(a))
  }
  const repetido = acoes.filter((a) => a === 'conta.pagamento').length
  ok('pagamento idempotente não gera auditoria duplicada', repetido === 4, `${repetido} eventos (pix, débito/crédito, crédito com chave repetida, dinheiro)`)
}

// ════════════════════════════════════════════════════════════════════════════
secao('7. trocar de mesa')
{
  // Cliente com o cardápio da Mesa 03 aberto no celular.
  const cel = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' })
  const cp = await cel.newPage()
  await cp.goto(`${BASE}/mesa/${M03.token}`, { waitUntil: 'networkidle' })
  await esperar(1500)

  const mesma = await agir(garcom.page, M03.id, 'transferir_mesa', { destinoMesaId: M03.id })
  ok('mesma mesa é recusada', mesma.status === 400)
  const inativa = await agir(garcom.page, M03.id, 'transferir_mesa', { destinoMesaId: B01.id })
  ok('mesa desativada é recusada', inativa.status === 400 && /desativada/.test(inativa.json?.error ?? ''), inativa.json?.error)
  if (outraLoja) {
    const alheia = await agir(garcom.page, M03.id, 'transferir_mesa', { destinoMesaId: outraLoja.id })
    ok('mesa de OUTRA loja é recusada', alheia.status === 400 && /não encontrada/.test(alheia.json?.error ?? ''), alheia.json?.error)
  }

  const comanda03 = (await um(`select id from comandas where mesa_id=$1 and status='aberta'`, [M03.id])).id
  const r = await agir(garcom.page, M03.id, 'transferir_mesa', { destinoMesaId: V01.id })
  ok('Mesa 03 → Varanda 01 (livre)', r.status === 200, r.json?.error)
  const c = await um(`select mesa_id, status from comandas where id=$1`, [comanda03])
  ok('a MESMA conta muda de mesa (lançamentos e histórico juntos)', c.mesa_id === V01.id && c.status === 'aberta')
  const nomes = await q(`select distinct mesa, cliente_nome from pedidos where comanda_id=$1`, [comanda03])
  ok('lançamentos passam a dizer "Varanda 01" (cozinha serve na mesa certa)', nomes.length === 1 && nomes[0].mesa === 'Varanda 01' && nomes[0].cliente_nome === 'Varanda 01', JSON.stringify(nomes))
  ok('Mesa 03 fica livre', (await conta(garcom.page, M03.id)).conta === null)
  ok('Varanda 01 mostra os 28,60', (await totais(garcom.page, V01.id))?.total === 28.6)
  const sessaoAntiga = await um(`select id from sessoes_mesa where mesa_id=$1 and status='encerrada' and transferida_para_mesa_id=$2`, [M03.id, V01.id])
  ok('sessão antiga encerrada apontando a mesa nova', !!sessaoAntiga)
  ok('histórico da conta mantém "Transferiu a mesa"', (await conta(garcom.page, V01.id)).historico.some((e) => /Transferiu a mesa/.test(e.oQue)))

  // O celular faz a leitura periódica (5 s) e descobre a troca.
  await cp.getByText(/Sua conta mudou para a Varanda 01/).waitFor({ timeout: 15000 }).catch(() => {})
  ok('cliente na URL antiga é avisado: "Sua conta mudou para a Varanda 01"', (await cp.getByText(/Sua conta mudou para a Varanda 01/).count()) === 1)
  await cp.screenshot({ path: '.shots/etapa-f-04-cliente-mesa-mudou.png' })
  const corpo = await cp.evaluate(async (token) => {
    const disp = localStorage.getItem('menuzia:mesa:dispositivo')
    const r = await fetch(`/api/mesa/${token}/selecao?dispositivo=${disp}`)
    return await r.text()
  }, M03.token)
  ok('a resposta pública não traz token nem id da Varanda 01', !corpo.includes(V01.token) && !corpo.includes(V01.id))
  const pagina = await cp.content()
  ok('a página pública não traz token nem id da Varanda 01', !pagina.includes(V01.token) && !pagina.includes(V01.id))
  const forjado = await cp.evaluate(async ({ token, sessao }) => {
    const disp = localStorage.getItem('menuzia:mesa:dispositivo')
    const r = await fetch(`/api/mesa/${token}/selecao?dispositivo=${disp}&sessao=${sessao}`)
    return (await r.json()).mesaMudouPara ?? null
  }, { token: M01.token, sessao: sessaoAntiga?.id ?? uuid() })
  ok('id de sessão de OUTRA mesa não revela nada', forjado === null, String(forjado))
  await cel.close()

  // Ocupada: sem confirmação, recusa e não mexe em nada.
  const pedidos02 = (await um(`select count(*)::int n from pedidos p join comandas c on c.id=p.comanda_id where c.mesa_id=$1 and c.status='aberta'`, [M02.id])).n
  const semConfirmar = await agir(garcom.page, M02.id, 'transferir_mesa', { destinoMesaId: V01.id })
  ok('destino ocupado sem confirmação → 409 destino_ocupado', semConfirmar.status === 409 && semConfirmar.json?.codigo === 'destino_ocupado', `${semConfirmar.status} ${semConfirmar.json?.codigo}`)
  ok('nada mudou na Mesa 02', (await um(`select count(*)::int n from pedidos p join comandas c on c.id=p.comanda_id where c.mesa_id=$1 and c.status='aberta'`, [M02.id])).n === pedidos02)

  // Pela tela: pede confirmação explícita e junta.
  const comanda02 = (await um(`select id from comandas where mesa_id=$1 and status='aberta'`, [M02.id])).id
  const comandaV01 = comanda03
  await agir(garcom.page, M02.id, 'pagamento', { forma: 'pix', valor: 10, chave: uuid() })
  const p = dono.page
  await p.goto(`${BASE}/admin/mesas/${M02.id}`, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: 'Trocar de mesa' }).click()
  await p.getByLabel('Mesa de destino').selectOption(V01.id)
  await p.getByRole('dialog').getByRole('button', { name: 'Transferir' }).click()
  await p.getByRole('alertdialog').waitFor({ timeout: 15000 })
  ok('tela pede confirmação: "A Varanda 01 já tem conta aberta"', (await p.getByText('A Varanda 01 já tem conta aberta').count()) === 1)
  await p.screenshot({ path: '.shots/etapa-f-05-confirmar-juntar.png' })
  await p.getByRole('button', { name: 'Juntar contas' }).click()
  await p.waitForURL(`**/admin/mesas/${V01.id}`, { timeout: 15000 }).catch(() => {})
  ok('depois de juntar, a tela vai para a Varanda 01', p.url().endsWith(`/admin/mesas/${V01.id}`), p.url())
  const origem = await um(`select status, transferida_para from comandas where id=$1`, [comanda02])
  ok('conta da Mesa 02 NÃO é apagada: status transferida → conta da Varanda 01', origem.status === 'transferida' && origem.transferida_para === comandaV01, JSON.stringify(origem))
  ok('lançamentos da Mesa 02 agora na conta da Varanda 01', (await um(`select count(*)::int n from pedidos where comanda_id=$1`, [comandaV01])).n === 2 + pedidos02)
  ok('todos os lançamentos juntados dizem "Varanda 01"', (await um(`select count(*)::int n from pedidos where comanda_id=$1 and mesa <> 'Varanda 01'`, [comandaV01])).n === 0)
  ok('pagamento feito na Mesa 02 veio junto', (await um(`select count(*)::int n from pagamentos_comanda where comanda_id=$1`, [comandaV01])).n === 1)
  const tv = await totais(p, V01.id)
  // 28,60 (26 + 10%) + Mesa 02: 68 + 54 + 7 = 129 com a taxa da Varanda (10%) = 141,90 → 170,50; pago 10
  ok('Varanda 01 soma as duas contas: 155 + 15,50 = 170,50, pago 10', tv.total === 170.5 && tv.pago === 10 && tv.restante === 160.5, JSON.stringify(tv))
  const hist = (await conta(p, V01.id)).historico.map((e) => e.oQue)
  ok('histórico da conta juntada inclui a junção e o pagamento feito na Mesa 02', hist.some((h) => /Juntou/.test(h)) && hist.some((h) => /Registrou pagamento/.test(h)), hist.join(' | '))
  await p.getByRole('tab', { name: /Conta/ }).click()
  await p.locator('[data-testid="restante"]').waitFor({ timeout: 15000 })
  await p.screenshot({ path: '.shots/etapa-f-06-conta-juntada.png', fullPage: true })
}

// ════════════════════════════════════════════════════════════════════════════
secao('8. permissões na API e no banco')
{
  const at = await api(atendente.page, `/api/admin/mesas/${V01.id}/conta`)
  ok('atendente (delivery) não lê a conta da mesa', at.status === 403 || at.status === 401, at.status)
  const atp = await api(atendente.page, `/api/admin/mesas/${V01.id}/conta`, 'POST', { acao: 'pagamento', forma: 'pix', valor: 1, chave: uuid() })
  ok('atendente não registra pagamento', atp.status === 403 || atp.status === 401, atp.status)

  const anon = await browser.newContext()
  const ap = await anon.newPage()
  await ap.goto(`${BASE}/login`)
  const an = await api(ap, `/api/admin/mesas/${V01.id}/conta`)
  ok('sem login: barrado', an.status === 401 || an.status === 307 || an.status === 0, an.status)
  await anon.close()

  const desconhecida = await agir(dono.page, V01.id, 'apagar_tudo')
  ok('ação desconhecida é recusada', desconhecida.status === 400)

  // Direto no Supabase, com a sessão de cada papel: sem escrita, sem funções.
  async function clientePorPapel(email) {
    const c = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
    const { error } = await c.auth.signInWithPassword({ email, password: SENHA })
    return error ? null : c
  }
  const emailDono = (await um(`select email from usuarios where usuario='dono.local'`)).email
  const sg = await clientePorPapel('garcom@demo.local')
  const sa = await clientePorPapel('atendente@demo.local')
  const sd = await clientePorPapel(emailDono)
  ok('logins diretos no Supabase local', !!sg && !!sa && !!sd)
  const lerG = await sg.from('pagamentos_comanda').select('id')
  ok('garçom lê pagamentos da loja', !lerG.error && lerG.data.length > 0, lerG.error?.message ?? `${lerG.data.length} linhas`)
  const lerA = await sa.from('pagamentos_comanda').select('id')
  ok('atendente NÃO lê pagamentos', (lerA.data ?? []).length === 0, lerA.error?.message ?? `${lerA.data?.length} linhas`)
  const ins = await sd.from('pagamentos_comanda').insert({ restaurante_id: loja, comanda_id: comandaGenerica(), forma: 'pix', valor: 1, criado_por_nome: 'x' })
  ok('nem o dono insere pagamento direto na tabela', !!ins.error, ins.error?.message)
  const upd = await sd.from('pagamentos_comanda').update({ valor: 0.01 }).eq('restaurante_id', loja).select('id')
  ok('nem o dono altera pagamento direto na tabela', !!upd.error || (upd.data ?? []).length === 0, upd.error?.message ?? `${upd.data?.length} linhas`)
  for (const [fn, args] of [
    ['comanda_registrar_pagamento', { p_restaurante: loja, p_comanda: comandaGenerica(), p_forma: 'pix', p_valor: 1, p_recebido: null, p_chave: uuid(), p_ator: null, p_ator_nome: 'x' }],
    ['comanda_fechar', { p_restaurante: loja, p_comanda: comandaGenerica(), p_ator: null, p_ator_nome: 'x' }],
    ['mesa_transferir', { p_restaurante: loja, p_origem: V01.id, p_destino: M01.id, p_mesclar: true, p_ator: null, p_ator_nome: 'x' }],
    ['item_cancelar', { p_restaurante: loja, p_item: uuid(), p_motivo: 'x', p_ator_nome: 'x' }],
  ]) {
    const r = await sd.rpc(fn, args)
    ok(`função ${fn} não executa com sessão de usuário`, !!r.error && /permission denied|not found|Could not find/i.test(r.error.message), r.error?.message)
  }
  const anonCli = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  const ra = await anonCli.rpc('comanda_totais', { p_comanda: comandaGenerica() })
  ok('anônimo não executa comanda_totais', !!ra.error, ra.error?.message)
  const la = await anonCli.from('pagamentos_comanda').select('id')
  ok('anônimo não lê pagamentos', !!la.error || (la.data ?? []).length === 0, la.error?.message)
}
// ════════════════════════════════════════════════════════════════════════════
secao('9. configuração da conta na loja')
{
  const url = '/api/admin/mesas/configuracao'
  const g = await api(garcom.page, url, 'PUT', { taxaServicoPadrao: 0, formasPagamento: ['pix'] })
  ok('garçom NÃO altera a configuração (403)', g.status === 403, g.status)
  const gl = await api(garcom.page, url)
  ok('garçom nem lê a configuração (403)', gl.status === 403, gl.status)
  const ruim1 = await api(dono.page, url, 'PUT', { taxaServicoPadrao: 31, formasPagamento: ['pix'] })
  const ruim2 = await api(dono.page, url, 'PUT', { taxaServicoPadrao: 5, formasPagamento: ['pix', 'bitcoin'] })
  const ruim3 = await api(dono.page, url, 'PUT', { taxaServicoPadrao: 5, formasPagamento: [] })
  ok('taxa acima de 30%, forma inventada ou nenhuma forma são recusadas', [ruim1, ruim2, ruim3].every((r) => r.status === 400))
  const d = await api(dono.page, url, 'PUT', { taxaServicoPadrao: 12.5, formasPagamento: ['vale', 'dinheiro', 'pix'] })
  const loj = await um(`select taxa_servico_padrao, formas_pagamento_mesa from restaurantes where id=$1`, [loja])
  ok('dono salva 12,5% e Dinheiro/Pix/Vale (ordem oficial)', d.status === 200 && n(loj.taxa_servico_padrao) === 12.5 && loj.formas_pagamento_mesa.join() === 'dinheiro,pix,vale', JSON.stringify(loj))
  ok('conta já aberta mantém a taxa com que nasceu (10%)', (await conta(dono.page, V01.id)).conta.taxaServicoPercentual === 10)
  const novo = await lancar(garcom.page, M01.id, [[SUCO, 1]])
  const c = await conta(garcom.page, M01.id)
  ok('conta aberta depois nasce com 12,5%: 12 + 1,50 = 13,50', (novo.status === 200 || novo.status === 201) && c.conta.taxaServicoPercentual === 12.5 && c.conta.totais.total === 13.5, JSON.stringify(c.conta?.totais))
  ok('a tela da conta oferece só as formas aceitas', c.formasPagamento.join() === 'dinheiro,pix,vale', c.formasPagamento.join())
  const fora = await agir(garcom.page, M01.id, 'pagamento', { forma: 'credito', valor: 1, chave: uuid() })
  ok('forma desligada pela loja é recusada no servidor', fora.status === 400, fora.json?.error)

  await garcom.page.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' })
  ok('garçom não vê o botão "Conta e pagamentos"', (await garcom.page.getByRole('button', { name: 'Conta e pagamentos' }).count()) === 0)
  await dono.page.goto(`${BASE}/admin/mesas`, { waitUntil: 'networkidle' })
  await dono.page.getByRole('button', { name: 'Conta e pagamentos' }).click()
  await dono.page.getByLabel('Taxa de serviço padrão').waitFor({ timeout: 15000 })
  await esperar(800)
  ok('modal mostra 12,5', (await dono.page.getByLabel('Taxa de serviço padrão').inputValue()) === '12,5')
  await dono.page.screenshot({ path: '.shots/etapa-f-07-config-conta.png' })
  const aud = await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao='mesas.configurou_conta'`, [loja])
  ok('mudança de configuração auditada', aud.n >= 1)
}

function comandaGenerica() {
  return '00000000-0000-4000-8000-000000000000'
}

await browser.close()
await db.end()

const falhas = res.filter((r) => !r).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
