/**
 * E2E — Financeiro INTEGRADO ao resto do sistema (Fases 1+2). Só caminhos reais: as mesmas rotas
 * e o mesmo acesso (RLS) que as telas usam — nada de inserir pagamento direto no banco.
 *
 * Loja própria e descartável `fin-int` (semear-demo-mesas com E2E_LOJA=fin-int E2E_SUFIXO=finint),
 * com pdv_v2 e o financeiro ligados. Um dia de loja de ponta a ponta:
 *   caixa fechado barra PDV e mesa → abre com fundo → balcão em dinheiro com troco → balcão dividido
 *   pix+crédito com estorno e troca por débito → mesa do garçom → idempotência → delivery em dinheiro
 *   com motoboy (Logística) e acerto → cancelamento com aprovação → sangria → conferência do esperado
 *   contra os pagamentos de verdade → fechamento cego → depois de fechado nada recebe, delivery segue
 *   → relatório bate com os pagamentos → isolamento.
 *
 *   E2E_LOJA=fin-int E2E_VIZINHA=fin-int-viz E2E_SUFIXO=finint node scripts/seguranca/semear-demo-mesas.mjs
 *   node scripts/seguranca/e2e-financeiro-integrado.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

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
if (!loja) { console.error('Rode antes: E2E_LOJA=fin-int E2E_VIZINHA=fin-int-viz E2E_SUFIXO=finint node scripts/seguranca/semear-demo-mesas.mjs'); process.exit(2) }
const viz = await um(`select id from restaurantes where slug='fin-int-viz'`)
const SENHA = 'demo-local-123456'
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const uuid = () => crypto.randomUUID()
const c = (reais) => Math.round(Number(reais) * 100)
const browser = await chromium.launch()
const foto = async (p, nome) => { if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`) }) }

async function logar(login) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return { s: r.status, j: await r.json().catch(() => null) }
}, { url: `${BASE}${url}`, metodo, corpo })
const caixa = (p, corpo) => api(p, '/api/admin/financeiro/caixa', 'POST', corpo)
const conta = (p, id, corpo) => api(p, `/api/admin/comandas/${id}`, 'POST', corpo)
const totalDe = async (comandaId) => Number((await um('select total from comanda_totais($1)', [comandaId])).total)
const restanteDe = async (comandaId) => { const t = await um('select total, pago from comanda_totais($1)', [comandaId]); return Math.round((Number(t.total) - Number(t.pago)) * 100) / 100 }
const livroPag = (pagId) => q(`select carteira, tipo, valor_centavos::bigint v, usuario_nome, turno_id from fin_lancamentos where pagamento_id=$1 order by id`, [pagId])
/** Cozinha de verdade: recebido → preparando → pronto → servido, pelas mesmas ações da tela. */
async function servir(p, comandaId) {
  for (const ped of await q(`select id, status::text s from pedidos where comanda_id=$1 and status <> 'cancelado'`, [comandaId])) {
    let st = ped.s
    if (st === 'recebido') { await conta(p, comandaId, { acao: 'transicionar', pedidoId: ped.id, de: 'recebido', para: 'preparando' }); st = 'preparando' }
    if (st === 'preparando') { await conta(p, comandaId, { acao: 'transicionar', pedidoId: ped.id, de: 'preparando', para: 'pronto' }) }
    await conta(p, comandaId, { acao: 'atender', pedidoId: ped.id })
  }
}
const pid = (r) => r.j?.resultado?.id ?? r.j?.id
const item = async (nome) => um(`select id, preco from itens_cardapio where restaurante_id=$1 and nome=$2`, [loja.id, nome])

let dono, ger, ate, gar
try {
  // ── preparação ───────────────────────────────────────────────────────────
  await db.query(`update restaurantes set financeiro_ativo=true, pdv_v2=true, usa_logistica=true, salao_garcom_recebe=true where id=$1`, [loja.id])
  await db.query(`update caixa_turnos set fechado_em=now(), fechado_por_nome='e2e (limpeza)' where restaurante_id=$1 and fechado_em is null`, [loja.id])
  // Contas que rodadas anteriores desta suíte deixaram abertas (só as "TESTE …").
  await db.query(`update comandas set status='cancelada' where restaurante_id=$1 and status='aberta' and cliente_nome like 'TESTE%'`, [loja.id])
  await db.query(`update mesas set limpeza_desde=null, limpeza_comanda_id=null where restaurante_id=$1`, [loja.id])
  await db.query(`update usuarios set pin_hash=null, pin_falhas=0, pin_bloqueado_ate=null, acessos=null where restaurante_id=$1`, [loja.id])
  const moto = (await um(`insert into entregadores (restaurante_id, nome, telefone, status) values ($1, 'TESTE Moto Fin', '27999990009', 'online') returning id, token`, [loja.id]))
  const FILE = await item('Filé à Parmegiana'); const AGUA = await item('Água com Gás'); const SUCO = await item('Suco de Laranja'); const BURGER = await item('Burger da Casa'); const RISOTO = await item('Risoto de Funghi')
  dono = await logar('dono.finint'); ger = await logar('gerente.finint'); ate = await logar('atendente.finint'); gar = await logar('garcom.finint')
  ok('PINs do dono e do gerente', (await api(dono.p, '/api/sessao/pin', 'POST', { senha: SENHA, pin: '615283' })).s === 200 && (await api(ger.p, '/api/sessao/pin', 'POST', { senha: SENHA, pin: '482913' })).s === 200)
  const [donoId, gerId] = [(await um(`select id from usuarios where usuario='dono.finint'`)).id, (await um(`select id from usuarios where usuario='gerente.finint'`)).id]

  secao('1. Caixa fechado barra o recebimento no PDV e na mesa')
  const b1 = await api(ate.p, '/api/admin/balcao/comandas', 'POST', { nome: 'TESTE Cliente Dinheiro', chave: uuid(), modalidade: 'retirada' })
  ok('balcão: atendente abre a comanda', b1.s === 201, `${b1.s} ${b1.j?.error ?? ''}`)
  const l1 = await api(ate.p, '/api/admin/pdv/lancamento', 'POST', { pagamento: { escolha: 'dinheiro' }, comandaId: b1.j?.id, chave: uuid(), itens: [{ itemId: FILE.id, quantidade: 1, complementos: [] }, { itemId: AGUA.id, quantidade: 1, complementos: [] }] })
  ok('balcão: lança Filé + Água (cozinha recebe normalmente)', l1.s === 201, `${l1.s} ${l1.j?.error ?? ''}`)
  const tot1 = await totalDe(b1.j.id)
  const semCaixa = await conta(ate.p, b1.j.id, { acao: 'pagamento', forma: 'dinheiro', valor: tot1, recebido: 100, chave: uuid() })
  ok('❌ esperado: receber no PDV com o caixa fechado', semCaixa.s === 409 && /Abra o caixa/.test(semCaixa.j?.error ?? ''), `${semCaixa.s} ${semCaixa.j?.error}`)
  // Mesas sem conta aberta (rodadas anteriores podem ter deixado uma); "liberar" tira da limpeza.
  const livres = await q(`select m.id, m.nome from mesas m where m.restaurante_id=$1 and m.ativa and m.bloqueada_em is null and not exists (select 1 from comandas c where c.mesa_id=m.id and c.status='aberta') order by m.ordem`, [loja.id])
  for (const m of livres) await api(gar.p, `/api/admin/mesas/${m.id}/atendimento`, 'POST', { acao: 'liberar' })
  const [mesa, mesa2] = livres
  const vistas = async () => q(`select id, versao from selecoes_mesa where mesa_id=$1 and encerrada_em is null`, [mesa.id])
  const ab = await api(gar.p, `/api/admin/mesas/${mesa.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'TESTE Mesa Fin', chave: uuid() })
  ok('garçom abre a mesa com o nome do cliente', ab.s === 200 || ab.s === 201, `${ab.s} ${ab.j?.error ?? ''}`)
  const lm = await api(gar.p, `/api/admin/mesas/${mesa.id}/lancamento`, 'POST', { chaveIdempotencia: uuid(), selecoesVistas: await vistas(), itens: [{ itemId: RISOTO.id, quantidade: 2, complementos: [], observacao: '' }, { itemId: SUCO.id, quantidade: 2, complementos: [], observacao: '' }] })
  ok('mesa: garçom lança 2 Risoto + 2 Suco', lm.s === 200 || lm.s === 201, `${lm.s} ${lm.j?.error ?? ''}`)
  const comMesa = await um(`select comanda_id from pedidos where restaurante_id=$1 and comanda_id in (select id from comandas where mesa_id=$2 and status='aberta') limit 1`, [loja.id, mesa.id])
  const semCaixaMesa = await api(gar.p, `/api/admin/mesas/${mesa.id}/conta`, 'POST', { acao: 'pagamento', forma: 'dinheiro', valor: 10, chave: uuid() })
  ok('❌ esperado: garçom receber na mesa com o caixa fechado', semCaixaMesa.s === 409 && /caixa/i.test(semCaixaMesa.j?.error ?? ''), `${semCaixaMesa.s} ${semCaixaMesa.j?.error}`)
  ok('nada foi gravado em pagamentos', (await um(`select count(*)::int n from pagamentos_comanda where comanda_id in ($1,$2)`, [b1.j.id, comMesa?.comanda_id])).n === 0)

  secao('2. Abrir o caixa (pela tela, operador de caixa)')
  await ate.p.goto(`${BASE}/admin/financeiro?secao=caixa`, { waitUntil: 'networkidle' })
  await ate.p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  await ate.p.getByTestId('caixa-abrir').click()
  await ate.p.getByTestId('abrir-fundo').fill('150,00')
  await ate.p.getByTestId('abrir-confirmar').click()
  await ate.p.getByTestId('janela-abrir').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  const turno = await um(`select * from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])
  ok('caixa aberto, fundo R$ 150,00, "Atendente Demo"', turno?.valor_inicial_centavos == 15000 && turno?.aberto_por_nome === 'Atendente Demo')

  secao('3. Balcão em dinheiro com troco')
  const p1 = await conta(ate.p, b1.j.id, { acao: 'pagamento', forma: 'dinheiro', valor: tot1, recebido: 100, chave: uuid() })
  ok(`recebe R$ ${tot1.toFixed(2)} em dinheiro, cliente deu R$ 100`, p1.s === 200, `${p1.s} ${p1.j?.error ?? ''}`)
  const lv1 = await livroPag(pid(p1))
  ok('livro-caixa: gaveta + valor da conta (não os R$ 100 recebidos)', lv1.length === 1 && lv1[0].carteira === 'gaveta' && Number(lv1[0].v) === c(tot1) && lv1[0].turno_id === turno.id, JSON.stringify(lv1))
  ok('livro-caixa: quem recebeu = sessão (Atendente Demo)', lv1[0]?.usuario_nome === 'Atendente Demo')
  const trocoReg = await um(`select dados from fin_lancamentos where pagamento_id=$1`, [pid(p1)])
  ok('troco registrado junto (recebido − conta)', Number(trocoReg.dados.troco_centavos) === c(100 - tot1) && Number(trocoReg.dados.recebido_centavos) === 10000, JSON.stringify(trocoReg.dados))
  await servir(ate.p, b1.j.id)
  const fb1 = await conta(ate.p, b1.j.id, { acao: 'fechar' })
  ok('cozinha serve e a conta do balcão fecha', fb1.s === 200, `${fb1.s} ${fb1.j?.error ?? ''}`)

  secao('4. Balcão dividido: pix + crédito, estorno do pix e troca por débito')
  const b2 = await api(ate.p, '/api/admin/balcao/comandas', 'POST', { nome: 'TESTE Cliente Dividido', chave: uuid(), modalidade: 'retirada' })
  await api(ate.p, '/api/admin/pdv/lancamento', 'POST', { pagamento: { escolha: 'dinheiro' }, comandaId: b2.j.id, chave: uuid(), itens: [{ itemId: FILE.id, quantidade: 1, complementos: [] }, { itemId: SUCO.id, quantidade: 3, complementos: [] }] })
  const tot2 = await totalDe(b2.j.id)
  const meia = Math.round((tot2 / 3) * 100) / 100
  const chavePix = uuid()
  const px = await conta(ate.p, b2.j.id, { acao: 'pagamento', forma: 'pix', valor: meia, chave: chavePix })
  const pxDup = await conta(ate.p, b2.j.id, { acao: 'pagamento', forma: 'pix', valor: meia, chave: chavePix })
  ok('pix: a mesma chave duas vezes (clique duplo) = um pagamento e UM lançamento', px.s === 200 && pxDup.s === 200 && (await q(`select 1 from fin_lancamentos where pagamento_id=$1`, [pid(px)])).length === 1)
  ok('pix vai para "a conferir"', (await livroPag(pid(px)))[0]?.carteira === 'pix_conferir')
  const cr = await conta(ate.p, b2.j.id, { acao: 'pagamento', forma: 'credito', valor: await restanteDe(b2.j.id), chave: uuid() })
  ok('crédito do restante vai para "cartão"', cr.s === 200 && (await livroPag(pid(cr)))[0]?.carteira === 'cartao')
  ok('❌ esperado: atendente estornar', (await conta(ate.p, b2.j.id, { acao: 'estorno', pagamentoId: pid(px), motivo: 'Pix não caiu' })).s === 403)
  const es = await conta(ger.p, b2.j.id, { acao: 'estorno', pagamentoId: pid(px), motivo: 'Pix não caiu na conta' })
  const lvPx = await livroPag(pid(px))
  ok('gerente estorna o pix: lançamento negativo no mesmo turno', es.s === 200 && lvPx.length === 2 && Number(lvPx[1].v) === -c(meia) && lvPx[1].tipo === 'estorno' && lvPx[1].turno_id === turno.id, JSON.stringify(lvPx))
  const db2 = await conta(ate.p, b2.j.id, { acao: 'pagamento', forma: 'debito', valor: await restanteDe(b2.j.id), chave: uuid() })
  await servir(ate.p, b2.j.id)
  const fb2 = await conta(ate.p, b2.j.id, { acao: 'fechar' })
  ok('cliente paga a diferença no débito e a conta fecha', db2.s === 200 && fb2.s === 200, `${db2.s} ${fb2.s} ${fb2.j?.error ?? ''}`)

  secao('4b. "Fechar e receber" de uma vez (dinheiro com troco + pix)')
  const b4 = await api(ate.p, '/api/admin/balcao/comandas', 'POST', { nome: 'TESTE Cliente Fecha Tudo', chave: uuid(), modalidade: 'retirada' })
  await api(ate.p, '/api/admin/pdv/lancamento', 'POST', { pagamento: { escolha: 'dinheiro' }, comandaId: b4.j.id, chave: uuid(), itens: [{ itemId: RISOTO.id, quantidade: 1, complementos: [] }] })
  await servir(ate.p, b4.j.id)
  const tot4 = await totalDe(b4.j.id)
  const fc = await conta(ate.p, b4.j.id, { acao: 'fechar_completo', chave: uuid(), acoes: [], pagamentos: [
    { forma: 'dinheiro', valor: 30, recebido: 50, chave: uuid() }, { forma: 'pix', valor: Math.round((tot4 - 30) * 100) / 100, chave: uuid() }] })
  const lv4 = await q(`select carteira, valor_centavos::bigint v from fin_lancamentos where comanda_id=$1 order by id`, [b4.j.id])
  ok('fecha e recebe de uma vez: 2 lançamentos (gaveta R$ 30 + pix)', fc.s === 200 && lv4.length === 2 && Number(lv4[0].v) === 3000 && lv4[1].carteira === 'pix_conferir' && (await um(`select status from comandas where id=$1`, [b4.j.id])).status === 'fechada', `${fc.s} ${fc.j?.error ?? ''} ${JSON.stringify(lv4)}`)

  secao('5. Mesa: garçom recebe (dinheiro vai direto para a gaveta)')
  await servir(ger.p, comMesa.comanda_id)
  const totMesa = await totalDe(comMesa.comanda_id)
  const pm = await api(gar.p, `/api/admin/mesas/${mesa.id}/conta`, 'POST', { acao: 'pagamento', forma: 'dinheiro', valor: totMesa, recebido: Math.ceil(totMesa / 50) * 50, chave: uuid() })
  ok(`garçom recebe R$ ${totMesa.toFixed(2)} na mesa`, pm.s === 200, `${pm.s} ${pm.j?.error ?? ''}`)
  const lvM = pm.j?.id ? await livroPag(pm.j.id) : []
  ok('livro-caixa: gaveta, origem mesa, "Garçom Demo"', lvM[0]?.carteira === 'gaveta' && lvM[0]?.usuario_nome === 'Garçom Demo' && Number(lvM[0]?.v) === c(totMesa), JSON.stringify(lvM))
  ok('mesa: conta fecha', (await api(gar.p, `/api/admin/mesas/${mesa.id}/conta`, 'POST', { acao: 'fechar' })).s === 200)

  secao('6. Delivery em dinheiro com motoboy (Logística) e acerto')
  const pub = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'entrega', cliente: { nome: 'TESTE Cliente Delivery', telefone: '27999990010' }, pagamento: 'dinheiro', trocoPara: 100,
    endereco: { rua: 'Rua Teste', numero: '10', complemento: '', bairro: 'Centro', cep: '29000000', cidade: 'Vitória' },
    itens: [{ itemId: RISOTO.id, quantidade: 1, complementos: [] }],
  }) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }))
  let pedId = pub.j?.id
  if (pub.s !== 201) {
    // Loja sem frete configurado recusa o delivery público: usa o caminho do balcão com entrega.
    console.log(`   (delivery público recusado: ${pub.s} ${pub.j?.error ?? ''} — usando pedido do cardápio pelo telefone)`)
    pedId = null
  }
  ok('delivery do cardápio em dinheiro aceito com o caixa aberto', pub.s === 201, `${pub.s} ${pub.j?.error ?? ''}`)
  if (pedId) {
    const sb = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
    await sb.auth.signInWithPassword({ email: 'gerente.finint@demo.local', password: SENHA })
    // Mesmo caminho da tela: aceitar → pronto → despachar ao motoboy → entregue (RLS do gerente).
    for (const st of ['preparando', 'pronto']) await sb.from('pedidos').update({ status: st }).eq('id', pedId)
    const d1 = await sb.from('pedidos').update({ entregador_id: moto.id, status: 'em_rota' }).eq('id', pedId).select('id')
    const d2 = await sb.from('pedidos').update({ status: 'entregue' }).eq('id', pedId).select('id')
    ok('Logística: despacha ao motoboy e marca entregue (como a tela)', !d1.error && !d2.error && d2.data?.length === 1, d1.error?.message ?? d2.error?.message ?? '')
    const pedTot = Number((await um(`select total from pedidos where id=$1`, [pedId])).total)
    // Fase 3 (0136): o acerto é o do Financeiro › Acerto de Motoboys (contagem cega).
    const painel = await api(ger.p, '/api/admin/financeiro/motoboys')
    const linha = painel.j?.motoboys?.find((l) => l.entregadorId === moto.id)
    ok('acerto: motoboy deve o total do pedido em dinheiro', !!linha && linha.saldoCentavos === c(pedTot), JSON.stringify(linha))
    const ac = await api(ger.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: moto.id, contadoCentavos: c(pedTot), chave: `int-${uuid()}` })
    ok('acerto registrado', ac.s === 200, `${ac.s} ${ac.j?.error ?? ''}`)
    const lvA = await um(`select valor_centavos::bigint v, entregador_id, turno_id from fin_lancamentos where restaurante_id=$1 and tipo='acerto_motoboy' and carteira='gaveta' order by id desc limit 1`, [loja.id])
    ok('acerto entra na gaveta do livro-caixa', Number(lvA?.v) === c(pedTot) && lvA?.entregador_id === moto.id && lvA?.turno_id === turno.id, JSON.stringify(lvA))
  }

  secao('7. Cancelamento com aprovação (garçom pede, gerente aprova)')
  await api(gar.p, `/api/admin/mesas/${mesa2.id}/atendimento`, 'POST', { acao: 'abrir', nome: 'TESTE Mesa Cancela', chave: uuid() })
  const vistas2 = await q(`select id, versao from selecoes_mesa where mesa_id=$1 and encerrada_em is null`, [mesa2.id])
  const lm2 = await api(gar.p, `/api/admin/mesas/${mesa2.id}/lancamento`, 'POST', { chaveIdempotencia: uuid(), selecoesVistas: vistas2, itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [], observacao: '' }] })
  const pedAgua = await um(`select id from pedidos where restaurante_id=$1 and comanda_id in (select id from comandas where mesa_id=$2 and status='aberta') order by criado_em desc limit 1`, [loja.id, mesa2.id])
  const sol = await api(gar.p, `/api/admin/mesas/${mesa2.id}/conta`, 'POST', { acao: 'solicitar_cancelamento', pedidoId: pedAgua?.id, motivo: 'Cliente desistiu' })
  const solId = (await um(`select id from solicitacoes_cancelamento where pedido_id=$1 and status='pendente'`, [pedAgua?.id]))?.id
  ok('garçom pede o cancelamento', (lm2.s === 200 || lm2.s === 201) && (sol.s === 200 || sol.s === 201) && !!solId, `${lm2.s} ${sol.s} ${sol.j?.error ?? ''}`)
  const dec = await api(ger.p, `/api/admin/mesas/${mesa2.id}/conta`, 'POST', { acao: 'decidir_cancelamento', solicitacaoId: solId, aprovar: true })
  ok('gerente aprova; pedido cancelado; nenhum dinheiro mexido', dec.s === 200 && (await um(`select status::text s from pedidos where id=$1`, [pedAgua?.id])).s === 'cancelado', `${dec.s} ${dec.j?.error ?? ''}`)
  await api(gar.p, `/api/admin/mesas/${mesa2.id}/conta`, 'POST', { acao: 'cancelar_comanda', motivo: 'TESTE mesa vazia' }).catch(() => {})

  secao('8. Sangria e conferência do esperado contra os pagamentos de verdade')
  ok('gerente faz sangria de R$ 80 (cofre)', (await caixa(ger.p, { acao: 'movimento', movimento: 'sangria', valorCentavos: 8000, motivo: 'Cofre do meio do dia', chave: `int-${uuid()}` })).s === 200)
  const pags = await q(`select forma, valor from pagamentos_comanda where restaurante_id=$1 and estornado_em is null and criado_em >= $2`, [loja.id, turno.aberto_em])
  const soma = (f) => pags.filter((x) => f.includes(x.forma)).reduce((s, x) => s + c(x.valor), 0)
  const acertos = Number((await um(`select coalesce(sum(valor_declarado),0) v from fechamentos_caixa where turno_id=$1`, [turno.id])).v)
  const esperadoGaveta = 15000 + soma(['dinheiro']) + c(acertos) - 8000
  const vis = await api(ger.p, '/api/admin/financeiro/caixa')
  ok(`gaveta esperada = fundo + dinheiro recebido + acerto − sangria (${(esperadoGaveta / 100).toFixed(2)})`, vis.j.saldos.gaveta === esperadoGaveta, `${vis.j.saldos.gaveta} vs ${esperadoGaveta}`)
  ok('cartão esperado = crédito + débito recebidos', vis.j.saldos.cartao === soma(['credito', 'debito']), `${vis.j.saldos.cartao} vs ${soma(['credito', 'debito'])}`)
  ok('pix a conferir = pix não estornado', vis.j.saldos.pix_conferir === soma(['pix']), `${vis.j.saldos.pix_conferir}`)
  ok('livro-caixa íntegro (cadeia de hash)', (await api(dono.p, '/api/admin/financeiro/auditoria', 'POST', { acao: 'verificar' })).j?.ok === true)

  secao('9. Fechamento cego pelo operador, contando certo')
  await ate.p.goto(`${BASE}/admin/financeiro?secao=caixa`, { waitUntil: 'networkidle' })
  await ate.p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  ok('operador não vê o esperado na tela', (await ate.p.getByTestId('caixa-saldos').count()) === 0)
  await ate.p.getByTestId('caixa-fechar').click()
  await ate.p.getByTestId('fechar-dinheiro').fill((esperadoGaveta / 100).toFixed(2).replace('.', ','))
  await ate.p.getByTestId('fechar-cartao').fill((soma(['credito', 'debito']) / 100).toFixed(2).replace('.', ','))
  await ate.p.getByTestId('fechar-conferir').click()
  await ate.p.waitForTimeout(1500)
  if (await ate.p.getByTestId('fechar-pendencias').count()) { await foto(ate.p, 'int-pendencias'); await ate.p.getByTestId('fechar-mesmo-assim').click() }
  // Fase 6 (regras de PIN no fechamento): pendência que passa de turno pede justificativa; acima do limite, PIN.
  await ate.p.waitForTimeout(1200)
  if (await ate.p.getByTestId('fechar-justificativa').count()) {
    await ate.p.getByTestId('fechar-justificativa').fill('TESTE mesa ainda aberta passa para o próximo turno')
    await ate.p.getByTestId('fechar-com-justificativa').click()
    await ate.p.waitForTimeout(1200)
  }
  if (await ate.p.getByTestId('aprovacao-pin').count()) {
    await ate.p.getByTestId('aprovador').filter({ hasText: 'Gerente' }).first().click()
    for (const d of '482913') await ate.p.getByTestId('aprovacao-pin').getByTestId(`pin-${d}`).click()
  }
  await ate.p.getByTestId('fechar-feito').waitFor({ timeout: 10000 }).catch(() => {})
  await foto(ate.p, 'int-fechado')
  const fz = await um(`select status, diferenca_centavos, diferenca_cartao_centavos, fechado_por_nome from caixa_turnos where id=$1`, [turno.id])
  ok('caixa fechado sem diferença (dinheiro e cartão), por "Atendente Demo"', fz.status === 'fechado' && fz.diferenca_centavos == 0 && fz.diferenca_cartao_centavos == 0 && fz.fechado_por_nome === 'Atendente Demo', JSON.stringify(fz))

  secao('10. Depois de fechado: nada recebe; delivery e cozinha seguem')
  const b3 = await api(ate.p, '/api/admin/balcao/comandas', 'POST', { nome: 'TESTE Depois do Fechamento', chave: uuid(), modalidade: 'retirada' })
  const l3 = await api(ate.p, '/api/admin/pdv/lancamento', 'POST', { pagamento: { escolha: 'dinheiro' }, comandaId: b3.j?.id, chave: uuid(), itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }] })
  ok('balcão ainda abre comanda e lança (cozinha não para)', b3.s === 201 && l3.s === 201)
  ok('❌ esperado: receber depois do fechamento', (await conta(ate.p, b3.j.id, { acao: 'pagamento', forma: 'pix', valor: AGUA.preco, chave: uuid() })).s === 409)
  await servir(ate.p, b3.j.id)
  const fcFechado = await conta(ate.p, b3.j.id, { acao: 'fechar_completo', chave: uuid(), acoes: [], pagamentos: [{ forma: 'dinheiro', valor: Number(AGUA.preco), recebido: 10, chave: uuid() }] })
  ok('❌ esperado: "fechar e receber" com o caixa fechado — desfaz tudo (nada pago, conta segue aberta)', fcFechado.s === 409 &&
    (await um(`select status from comandas where id=$1`, [b3.j.id])).status === 'aberta' && (await um(`select count(*)::int n from pagamentos_comanda where comanda_id=$1`, [b3.j.id])).n === 0, `${fcFechado.s} ${fcFechado.j?.error ?? ''}`)
  const pub2 = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'retirada', cliente: { nome: 'TESTE Online Fechado', telefone: '27999990011' }, pagamento: 'pix', trocoPara: null,
    endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' }, itens: [{ itemId: AGUA.id, quantidade: 1, complementos: [] }],
  }) }).then((r) => r.status)
  ok('pedido online (vitrine) continua entrando com o caixa fechado', pub2 === 201, String(pub2))
  // Delivery entregue com o caixa fechado (0135): o caixa NÃO abre sozinho; o dinheiro vira
  // "a acertar" (pendência do motoboy, sem turno) e aparece no acerto mesmo com o caixa fechado.
  const pub3 = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'entrega', cliente: { nome: 'TESTE Delivery Fechado', telefone: '27999990012' }, pagamento: 'dinheiro', trocoPara: null,
    endereco: { rua: 'Rua Teste', numero: '20', complemento: '', bairro: 'Centro', cep: '29000000', cidade: 'Vitória' }, itens: [{ itemId: RISOTO.id, quantidade: 1, complementos: [] }],
  }) }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }))
  const sb2 = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  await sb2.auth.signInWithPassword({ email: 'gerente.finint@demo.local', password: SENHA })
  for (const st of ['preparando', 'pronto']) await sb2.from('pedidos').update({ status: st }).eq('id', pub3.j?.id)
  await sb2.from('pedidos').update({ entregador_id: moto.id, status: 'em_rota' }).eq('id', pub3.j?.id)
  await sb2.from('pedidos').update({ status: 'entregue' }).eq('id', pub3.j?.id)
  const auto = await um(`select id from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])
  ok('entrega com o caixa fechado: caixa NÃO abre sozinho', pub3.s === 201 && !auto, `${pub3.s} ${auto?.id}`)
  ok('dinheiro vira pendência do motoboy, sem turno', !!(await um(`select 1 from fin_lancamentos where pedido_id=$1 and tipo='pendencia_motoboy' and turno_id is null`, [pub3.j?.id])))
  const linhaAuto = (await api(ger.p, '/api/admin/financeiro/motoboys')).j?.motoboys?.find((l) => l.entregadorId === moto.id)
  ok('aparece "a acertar" mesmo com o caixa fechado', linhaAuto?.pedidos?.some((x) => x.pedidoId === pub3.j?.id), JSON.stringify(linhaAuto))
  ok('❌ esperado: acerto de motoboy sem caixa aberto', (await api(ger.p, '/api/admin/financeiro/motoboys', 'POST', { acao: 'acertar', entregadorId: moto.id, contadoCentavos: 100, chave: `int-${uuid()}` })).j?.codigo === 'caixa_fechado')
  await conta(dono.p, b3.j.id, { acao: 'cancelar_conta', motivo: 'TESTE limpeza' }).catch(() => {})

  secao('11. Relatório bate com os pagamentos; isolamento')
  const rel = await api(dono.p, `/api/admin/financeiro/caixa/${turno.id}`)
  ok('relatório: dinheiro líquido = pagamentos em dinheiro', rel.j?.porForma?.dinheiro === soma(['dinheiro']), `${rel.j?.porForma?.dinheiro} vs ${soma(['dinheiro'])}`)
  ok('relatório: pix líquido (pix − estorno) = pix válido', (rel.j?.porForma?.pix ?? 0) === soma(['pix']))
  const pr = await dono.ctx.newPage(); await pr.goto(`${BASE}/admin/financeiro/caixa/${turno.id}`, { waitUntil: 'networkidle' }); await pr.getByTestId('relatorio-caixa').waitFor({ timeout: 8000 }).catch(() => {}); await foto(pr, 'int-relatorio')
  const donoViz = await logar('dono.vizinha.finint').catch(() => null)
  if (donoViz) {
    ok('❌ esperado: dono da loja vizinha lê o relatório', (await api(donoViz.p, `/api/admin/financeiro/caixa/${turno.id}`)).s >= 403)
    ok('❌ esperado: loja vizinha (sem flag) usa o financeiro', (await api(donoViz.p, '/api/admin/financeiro/caixa')).s === 404)
    await donoViz.ctx.close()
  }
  secao('12. Concorrência: corrente de assinaturas não quebra')
  // 8 transações ao mesmo tempo, cada uma com 2 eventos de auditoria e 1 lançamento, intercaladas
  // (a que começa primeiro termina por último) — o caso que a 0134 corrigiu.
  const clientes = await Promise.all(Array.from({ length: 8 }, async () => { const k = new pg.Client({ connectionString: DB_URL }); await k.connect(); return k }))
  await Promise.all(clientes.map(async (k, i) => {
    await k.query('begin'); await k.query('set local role service_role')
    await k.query(`select pg_sleep($1)`, [(8 - i) * 0.05])
    for (let n = 0; n < 2; n++) await k.query(`select public.auditoria_registrar($1, null, 'TESTE concorrência', 'teste.concorrencia', 'teste', null, $2::jsonb)`, [loja.id, JSON.stringify({ i, n })])
    await k.query(`insert into fin_lancamentos (restaurante_id, grupo_id, carteira, tipo, valor_centavos, origem, usuario_nome, chave_idempotencia, motivo) values ($1, gen_random_uuid(), 'empresa', 'outro', 1, 'sistema', 'TESTE', $2, 'TESTE concorrência')`, [loja.id, `conc-${uuid()}`])
    await k.query('commit'); await k.end()
  }))
  const ver = await api(dono.p, '/api/admin/financeiro/auditoria', 'POST', { acao: 'verificar' })
  ok('8 transações simultâneas + 2 eventos na mesma transação: corrente íntegra', ver.j?.ok === true, JSON.stringify(ver.j?.problemas?.slice(0, 2)))
  ok('auditoria registrou abrir, contar e fechar', (await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao in ('caixa.abriu_turno','caixa.contou','caixa.fechou_turno') and entidade_id=$2`, [loja.id, turno.id])).n >= 3)
} catch (e) {
  ok('execução sem exceção', false, (e.stack ?? e.message).split('\n').slice(0, 3).join(' | '))
} finally {
  await db.query(`update caixa_turnos set fechado_em=now(), fechado_por_nome='e2e (limpeza)' where restaurante_id=$1 and fechado_em is null`, [loja.id]).catch(() => {})
  await db.query(`update restaurantes set financeiro_ativo=false where id=$1`, [loja.id]).catch(() => {})
  await browser.close(); await db.end()
  const falhas = res.filter((x) => !x).length
  console.log(`\n${res.length - falhas}/${res.length} verificações ok`)
  process.exit(falhas ? 1 : 0)
}
