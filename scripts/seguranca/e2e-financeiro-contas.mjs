/**
 * E2E — Financeiro Fase 5b (2026-10-04): contas a pagar/receber, fornecedores, plano de contas, compras de insumos e DRE.
 * Loja local `fin-int` (vizinha `fin-int-viz` para isolamento). Tudo TESTE com sufixo por rodada. No fim: contas TESTE
 * em aberto canceladas pelo sistema, compras a prazo canceladas, insumos/fornecedores TESTE desativados, produto TESTE
 * apagado. O que foi pago fica no livro-caixa (imutável) — só no banco local.
 *
 *   CRON_SECRET=<o do servidor> node scripts/seguranca/e2e-financeiro-contas.mjs [pasta-de-prints]
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
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
const sbServ = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
const viz = await um(`select id from restaurantes where slug='fin-int-viz'`)
const SENHA = 'demo-local-123456'
const PIN_DONO = '615283', PIN_GER = '482913'
const SUF = Math.random().toString(36).slice(2, 6)
const res = [], antifraude = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const af = (n, c, d = '') => { antifraude.push([n, !!c]); ok(`antifraude: ${n}`, c, d) }
const secao = (t) => console.log(`\n── ${t} ──`)
const texto = (v) => JSON.stringify(v)
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const dia = (n) => { const d = new Date(`${hoje}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const browser = await chromium.launch()
await db.query(`update restaurantes set financeiro_ativo=true where id=$1`, [loja.id])

async function dispensarSetup(p, ms = 6000) {
  const b = p.getByRole('button', { name: 'OK, entendi' })
  try { await b.waitFor({ state: 'visible', timeout: ms }); await b.click(); await b.waitFor({ state: 'detached', timeout: 3000 }) } catch {}
}
async function logar(login, opcoes = { viewport: { width: 1366, height: 860 } }) {
  const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
  return { ctx, p }
}
const api = (p, url, metodo = 'GET', corpo, headers) => p.evaluate(async ({ url, metodo, corpo, headers }) => {
  const r = await fetch(url, { method: metodo, headers: headers ?? (corpo ? { 'Content-Type': 'application/json' } : undefined), body: corpo === undefined ? undefined : (headers ? corpo : JSON.stringify(corpo)) })
  const t = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer())
  let j = null; try { j = JSON.parse(t) } catch { /* csv */ }
  return { s: r.status, j, t }
}, { url: `${BASE}${url}`, metodo, corpo, headers })
const semSessao = (url, metodo = 'GET', corpo, headers = {}) => fetch(`${BASE}${url}`, { method: metodo, headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: corpo ? JSON.stringify(corpo) : undefined }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))

const dono = await logar('dono.finint')
const ger = await logar('gerente.finint')
const ate = await logar('atendente.finint')
const gar = await logar('garcom.finint')
const D = (await um(`select id from usuarios where restaurante_id=$1 and papel='dono' and desativado_em is null order by criado_em limit 1`, [loja.id])).id
const G = (await um(`select id from usuarios where restaurante_id=$1 and email like 'gerente.finint%'`, [loja.id])).id
const A = (await um(`select id, acessos from usuarios where restaurante_id=$1 and email like 'atendente.finint%'`, [loja.id]))
const PDONO = { aprovadorId: D, pin: PIN_DONO }

const contas = (p, qs = '') => api(p, `/api/admin/financeiro/contas${qs}`)
const nova = (p, corpo) => api(p, '/api/admin/financeiro/contas', 'POST', { chave: `e2e-${SUF}-${crypto.randomUUID().slice(0, 8)}`, ...corpo })
const acao = (p, id, corpo) => api(p, `/api/admin/financeiro/contas/${id}`, 'PATCH', corpo)
const conta = (id) => um(`select * from fin_contas where id=$1`, [id])
const linhasDoGrupo = (g) => q(`select carteira, tipo, valor_centavos::int v, forma, turno_id, dados, motivo from fin_lancamentos where grupo_id=$1 order by linha`, [g])
const caixaApi = (p, corpo) => api(p, '/api/admin/financeiro/caixa', 'POST', corpo)
const criados = { contas: [], compras: [], fornecedores: [], categorias: [], insumos: [], itens: [] }

try {
  secao('Cadastros: plano de contas e fornecedores')
  const l0 = await contas(dono.p, '?tipo=pagar&situacao=todas')
  const cat = (nome) => l0.j.categorias.find((c) => c.nome === nome)
  ok('plano de contas padrão criado (9 saídas + 4 entradas)', ['Insumos', 'Embalagens', 'Pessoal', 'Aluguel', 'Contas de consumo', 'Marketing', 'Taxas e impostos', 'Manutenção', 'Outros'].every((n) => cat(n)?.tipo === 'pagar')
    && ['Repasse de marketplace (iFood)', 'Venda avulsa (fora do sistema)', 'Outras receitas', 'Aporte do sócio'].every((n) => cat(n)?.tipo === 'receber'), texto(l0.j.categorias?.length))
  ok('Insumos e Embalagens marcados como "já no CMV"; aporte fora do DRE', cat('Insumos').grupo === 'insumo' && cat('Embalagens').grupo === 'insumo' && cat('Aporte do sócio').grupo === 'fora')
  const fo = await api(ger.p, '/api/admin/financeiro/contas/cadastros', 'POST', { cadastro: 'fornecedor', nome: `TESTE Açougue ${SUF}`, documento: '12345678000199' })
  criados.fornecedores.push(fo.j?.id)
  ok('fornecedor cadastrado (reutilizável)', fo.s === 201)
  ok('fornecedor com o mesmo nome (sem acento/caixa) é recusado', (await api(ger.p, '/api/admin/financeiro/contas/cadastros', 'POST', { cadastro: 'fornecedor', nome: `teste acougue ${SUF}` })).s === 409)
  const cNova = await api(ger.p, '/api/admin/financeiro/contas/cadastros', 'POST', { cadastro: 'categoria', nome: `TESTE Software ${SUF}`, tipo: 'pagar', grupo: 'despesa' })
  criados.categorias.push(cNova.j?.id)
  ok('categoria nova editável', cNova.s === 201)
  ok('categoria de saída não aceita grupo de entrada', (await api(ger.p, '/api/admin/financeiro/contas/cadastros', 'POST', { cadastro: 'categoria', nome: `TESTE X ${SUF}`, tipo: 'pagar', grupo: 'receita' })).s === 400)

  secao('Contas a pagar: recorrência, vencimento e alertas')
  const alu = await nova(ger.p, { tipo: 'pagar', descricao: `TESTE Aluguel ${SUF}`, categoriaId: cat('Aluguel').id, fornecedorId: fo.j.id, valorCentavos: 9000, vencimento: dia(-5), recorrencia: 'mensal', formaPrevista: 'boleto' })
  criados.contas.push(alu.j?.id)
  ok('conta mensal lançada', alu.s === 201, texto(alu.j))
  const serie = await q(`select vencimento::text v, origem from fin_contas where serie_id=$1 order by vencimento`, [alu.j.id])
  ok('próxima do mês gerada sozinha (antecedência de 1 mês)', serie.length === 2 && serie[1].v > hoje && serie[1].origem === 'recorrencia', texto(serie))
  await contas(dono.p); await contas(dono.p)
  ok('gerar de novo não duplica (único por série + vencimento)', (await q(`select 1 from fin_contas where serie_id=$1`, [alu.j.id])).length === 2)
  const sem = await nova(ger.p, { tipo: 'pagar', descricao: `TESTE Gás semanal ${SUF}`, categoriaId: cat('Contas de consumo').id, valorCentavos: 3000, vencimento: hoje, recorrencia: 'semanal' })
  criados.contas.push(sem.j?.id)
  ok('semanal: a da próxima semana já aparece', (await q(`select vencimento::text v from fin_contas where serie_id=$1 order by vencimento`, [sem.j.id])).map((x) => x.v).join(',') === `${hoje},${dia(7)}`)
  const lv = await contas(ger.p, '?tipo=pagar&situacao=vencidas')
  ok('vencida aparece como "vencida" (calculado pela data)', lv.j.contas.some((k) => k.id === alu.j.id && k.statusExibido === 'vencido'), texto(lv.j.contas.map((k) => k.statusExibido)))
  ok('cron sem o segredo → 401', (await semSessao('/api/cron/financeiro-diario', 'POST')).s === 401)
  const cr = await semSessao('/api/cron/financeiro-diario', 'POST', undefined, { 'x-cron-secret': process.env.CRON_SECRET ?? '' })
  const alertas = await q(`select tipo, mensagem from fin_alertas where restaurante_id=$1 and dados->>'conta' = any($2)`, [loja.id, [alu.j.id, sem.j.id]])
  ok('alerta de vencimento no painel (vencida e vence hoje)', cr.s === 200 && alertas.some((a) => a.tipo === 'conta_vencida') && alertas.some((a) => a.tipo === 'conta_vencendo'), texto(alertas))
  await semSessao('/api/cron/financeiro-diario', 'POST', undefined, { 'x-cron-secret': process.env.CRON_SECRET ?? '' })
  ok('alerta não se repete no mesmo dia', (await q(`select 1 from fin_alertas where restaurante_id=$1 and dados->>'conta'=$2`, [loja.id, alu.j.id])).length === 1)

  secao('Baixa pela conta da empresa e estorno')
  const b1 = await acao(ger.p, alu.j.id, { acao: 'baixar', carteira: 'empresa', forma: 'pix' })
  const k1 = await conta(alu.j.id)
  const lb1 = await linhasDoGrupo(k1.pago_grupo_id)
  ok('paga pela empresa: −empresa / −resultado, com a categoria', b1.s === 200 && k1.status === 'pago' && lb1.length === 2 && lb1[0].carteira === 'empresa' && lb1[0].v === -9000 && lb1[1].carteira === 'resultado' && lb1[1].dados?.categoria_id === cat('Aluguel').id, texto(lb1))
  ok('quem pagou vem da sessão', k1.pago_por_nome && (await um(`select usuario_nome from fin_lancamentos where grupo_id=$1 limit 1`, [k1.pago_grupo_id])).usuario_nome === k1.pago_por_nome)
  const b1b = await acao(ger.p, alu.j.id, { acao: 'baixar', carteira: 'empresa', forma: 'pix' })
  ok('pagar de novo (clique duplo) não lança outra vez', b1b.s === 200 && b1b.j.repetido === true && (await q(`select 1 from fin_lancamentos where restaurante_id=$1 and dados->>'conta_id'=$2`, [loja.id, alu.j.id])).length === 2)
  ok('conta paga não se edita (servidor)', (await acao(ger.p, alu.j.id, { acao: 'editar', descricao: 'x', categoriaId: cat('Aluguel').id, valorCentavos: 1, vencimento: hoje })).s === 409)
  ok('conta paga não se cancela sem estornar', (await acao(ger.p, alu.j.id, { acao: 'cancelar', motivo: 'TESTE cancelar paga' })).s === 409)
  const e0 = await acao(ger.p, alu.j.id, { acao: 'estornar', motivo: 'TESTE paguei a conta errada' })
  ok('estorno pede PIN de gerente', e0.s === 409 && e0.j.codigo === 'aprovacao_necessaria')
  af('ninguém aprova o próprio estorno (PIN do próprio gerente)', (await acao(ger.p, alu.j.id, { acao: 'estornar', motivo: 'TESTE paguei a conta errada', aprovacao: { aprovadorId: G, pin: PIN_GER } })).s === 403)
  const e1 = await acao(ger.p, alu.j.id, { acao: 'estornar', motivo: 'TESTE paguei a conta errada', aprovacao: PDONO })
  const est = await q(`select carteira, valor_centavos::int v, referencia_id, aprovado_por_nome from fin_lancamentos where restaurante_id=$1 and chave_idempotencia like $2 order by linha`, [loja.id, `conta:${alu.j.id}:estorno:%`])
  ok('estorno: lançamento oposto ligado ao original, aprovado pelo dono', e1.s === 200 && est.length === 2 && est[0].v === 9000 && !!est[0].referencia_id && !!est[0].aprovado_por_nome, texto(est))
  ok('conta volta para em aberto; alerta ao dono', (await conta(alu.j.id)).status === 'a_pagar' && !!(await um(`select 1 from fin_alertas where restaurante_id=$1 and tipo='conta_estornada' and dados->>'conta'=$2`, [loja.id, alu.j.id])))

  secao('Pago com dinheiro do caixa vira movimentação do turno')
  let turno = await um(`select id from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])
  if (turno) {
    const saldo = await um(`select coalesce(sum(valor_centavos),0)::int g from fin_lancamentos where turno_id=$1 and carteira='gaveta'`, [turno.id])
    const cart = await um(`select coalesce(sum(valor_centavos),0)::int g from fin_lancamentos where turno_id=$1 and carteira='cartao'`, [turno.id])
    const f = await caixaApi(dono.p, { acao: 'fechar', contadoDinheiroCentavos: Math.max(0, saldo.g), contadoCartaoCentavos: Math.max(0, cart.g), aceitarPendencias: true, justificativa: 'TESTE fechamento para o e2e de contas' })
    if (f.s !== 200) console.log('   (fechar caixa:', f.s, texto(f.j), ')')
  }
  const gz = await nova(ger.p, { tipo: 'pagar', descricao: `TESTE Entregador extra ${SUF}`, categoriaId: cat('Pessoal').id, valorCentavos: 15000, vencimento: hoje })
  criados.contas.push(gz.j?.id)
  ok('com o caixa fechado: recusa pagar com dinheiro do caixa', (await acao(ger.p, gz.j.id, { acao: 'baixar', carteira: 'gaveta', forma: 'dinheiro' })).j?.codigo === 'caixa_fechado')
  const ab = await caixaApi(ger.p, { acao: 'abrir', fundoCentavos: 20000 })
  turno = await um(`select id from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [loja.id])
  ok('caixa aberto para o teste', ab.s === 200 || !!turno, `${ab.s}`)
  const g0 = await acao(ger.p, gz.j.id, { acao: 'baixar', carteira: 'gaveta', forma: 'dinheiro' })
  ok('acima do limite de saída do caixa (R$ 100,00) pede PIN', g0.s === 409 && g0.j.codigo === 'aprovacao_necessaria' && g0.j.limiteCentavos === 10000)
  const g1 = await acao(ger.p, gz.j.id, { acao: 'baixar', carteira: 'gaveta', forma: 'dinheiro', aprovacao: PDONO })
  const kg = await conta(gz.j.id)
  const lg = await linhasDoGrupo(kg.pago_grupo_id)
  ok('vira despesa do TURNO aberto (−gaveta), aprovada pelo dono', g1.s === 200 && lg[0].carteira === 'gaveta' && lg[0].tipo === 'despesa' && lg[0].v === -15000 && lg[0].turno_id === turno.id && kg.pago_aprovado_por_nome, texto(lg))
  const ext = await api(ger.p, `/api/admin/financeiro/caixa`)
  ok('aparece no caixa do turno (esperado na gaveta caiu R$ 150,00)', JSON.stringify(ext.j ?? {}).includes('TESTE Entregador extra'), String(ext.s))
  const big = await nova(ger.p, { tipo: 'pagar', descricao: `TESTE Reforma ${SUF}`, categoriaId: cat('Manutenção').id, valorCentavos: 150000, vencimento: hoje })
  criados.contas.push(big.j?.id)
  ok('pela empresa acima de R$ 1.000,00 pede PIN', (await acao(ger.p, big.j.id, { acao: 'baixar', carteira: 'empresa', forma: 'transferencia' })).j?.codigo === 'aprovacao_necessaria')
  ok('o dono paga sem PIN (é ele quem aprovaria)', (await acao(dono.p, big.j.id, { acao: 'baixar', carteira: 'empresa', forma: 'transferencia' })).s === 200)

  secao('Contas a receber: repasse iFood, aporte e venda manual duplicada')
  const ifd = await nova(ger.p, { tipo: 'receber', descricao: `TESTE Repasse iFood semana ${SUF}`, categoriaId: cat('Repasse de marketplace (iFood)').id, valorCentavos: 85000, vencimento: hoje })
  criados.contas.push(ifd.j?.id)
  const ri = await acao(ger.p, ifd.j.id, { acao: 'baixar', carteira: 'empresa', forma: 'transferencia' })
  const li = await linhasDoGrupo((await conta(ifd.j.id)).pago_grupo_id)
  ok('repasse iFood recebido: +empresa / +resultado (outra receita)', ri.s === 200 && li[0].carteira === 'empresa' && li[0].v === 85000 && li[0].tipo === 'conta_receber' && li[1].v === 85000, texto(li))
  const apo = await nova(ger.p, { tipo: 'receber', descricao: `TESTE Aporte ${SUF}`, categoriaId: cat('Aporte do sócio').id, valorCentavos: 100000, vencimento: hoje })
  criados.contas.push(apo.j?.id)
  ok('aporte do sócio recebido', (await acao(ger.p, apo.j.id, { acao: 'baixar', carteira: 'empresa', forma: 'pix' })).s === 200)
  // Pedido de hoje (vitrine) para o teste de duplicidade.
  const ped = await semSessao(`/api/loja/${SLUG}/pedido`, 'POST', { tipo: 'retirada', cliente: { nome: 'TESTE CONTAS', telefone: '27999990056' }, pagamento: 'pix', trocoPara: null, endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
    itens: [{ itemId: (await um(`select id from itens_cardapio where restaurante_id=$1 and status='disponivel' and tipo_item='simples' and preco > 0 order by criado_em limit 1`, [loja.id])).id, quantidade: 1, observacao: '', complementos: [] }] })
  const pe = await um(`select numero, total from pedidos where id=$1`, [ped.j?.id])
  ok('pedido de hoje criado pela vitrine', ped.s === 201 && !!pe, `${ped.s}`)
  const vd1 = await nova(ger.p, { tipo: 'receber', descricao: `TESTE venda do pedido #${pe.numero}`, categoriaId: cat('Venda avulsa (fora do sistema)').id, valorCentavos: 4321, vencimento: hoje })
  af('venda do sistema lançada à mão (cita o #pedido) → bloqueada e avisa', vd1.s === 409 && vd1.j.codigo === 'venda_duplicada' && vd1.j.pedidos?.some((p) => p.numero === pe.numero), texto(vd1.j))
  const vd2 = await nova(ger.p, { tipo: 'receber', descricao: `TESTE venda balcão ${SUF}`, categoriaId: cat('Venda avulsa (fora do sistema)').id, valorCentavos: Math.round(Number(pe.total) * 100), vencimento: hoje })
  af('mesmo valor de um pedido do mesmo dia → bloqueada', vd2.s === 409 && vd2.j.codigo === 'venda_duplicada', texto(vd2.j))
  const vd3 = await nova(ger.p, { tipo: 'receber', descricao: `TESTE venda balcão ${SUF}`, categoriaId: cat('Venda avulsa (fora do sistema)').id, valorCentavos: Math.round(Number(pe.total) * 100), vencimento: hoje, liberarVenda: { justificativa: 'TESTE venda no evento da praça' } })
  ok('lançar mesmo assim exige justificativa + PIN de gerente', vd3.s === 409 && vd3.j.codigo === 'aprovacao_necessaria')
  const vd4 = await nova(ger.p, { tipo: 'receber', descricao: `TESTE venda balcão ${SUF}`, categoriaId: cat('Venda avulsa (fora do sistema)').id, valorCentavos: Math.round(Number(pe.total) * 100), vencimento: hoje, liberarVenda: { justificativa: 'TESTE venda no evento da praça', aprovacao: PDONO } })
  criados.contas.push(vd4.j?.id)
  ok('com justificativa e PIN: entra, fica auditado e o dono é avisado', vd4.s === 201 && !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='contas.venda_avulsa_liberada' and entidade_id=$2`, [loja.id, vd4.j.id]))
    && !!(await um(`select 1 from fin_alertas where restaurante_id=$1 and tipo='venda_manual_suspeita' and dados->>'conta'=$2`, [loja.id, vd4.j.id])))

  secao('Compras de insumos atualizam o custo e o CMV')
  const ins = await api(dono.p, '/api/admin/financeiro/cmv/insumos', 'POST', { nome: `TESTE Carne compra ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 3200, aproveitamentoPct: 100 })
  const pao = await api(dono.p, '/api/admin/financeiro/cmv/insumos', 'POST', { nome: `TESTE Pão compra ${SUF}`, unidadeCompra: 'pacote', quantidadeCompra: 1, basePorUnidade: 24, unidadeBase: 'un', custoCompraCentavos: 2400, aproveitamentoPct: 100 })
  criados.insumos.push(ins.j?.id, pao.j?.id)
  const grupo = await um(`select id from grupos_cardapio where restaurante_id=$1 order by posicao limit 1`, [loja.id])
  const BURGER = (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status, tipo_item) values ($1,$2,$3,30,'disponivel','simples') returning id`, [loja.id, grupo.id, `TESTE Burger compra ${SUF}`])).id
  criados.itens.push(BURGER)
  await api(dono.p, '/api/admin/financeiro/cmv/ficha', 'PUT', { tipo: 'item', id: BURGER, componentes: [{ insumoId: ins.j.id, quantidadeBase: 120 }, { insumoId: pao.j.id, quantidadeBase: 1 }] })
  const custoBurger = async () => (await api(dono.p, '/api/admin/financeiro/cmv')).j.linhas.find((l) => l.chave === `item:${BURGER}:`)?.custoCentavos
  ok('antes da compra: CMV do burger R$ 4,84 (120 g a R$ 32/kg + pão R$ 1,00)', (await custoBurger()) === 484)
  const cp1 = await api(ger.p, '/api/admin/financeiro/contas/compras', 'POST', { chave: `e2e-${SUF}-c1`, fornecedorId: fo.j.id, numeroNota: `T${SUF}1`, dataCompra: hoje, pagamento: 'a_prazo', vencimento: dia(10), forma: 'boleto',
    itens: [{ insumoId: ins.j.id, quantidade: 5, unidade: 'kg', valorCentavos: 18000 }, { insumoId: pao.j.id, quantidade: 3, unidade: 'pacote', valorCentavos: 8100 }] })
  criados.compras.push(cp1.j?.id)
  ok('compra a prazo registrada (2 insumos atualizados)', cp1.s === 201 && cp1.j.insumosAtualizados === 2, texto(cp1.j))
  const custoCarne = await um(`select custo_compra_centavos::int c from cmv_insumos where id=$1`, [ins.j.id])
  const histC = await um(`select custo_antigo_centavos::int a, custo_novo_centavos::int n, motivo, usuario_nome from cmv_custos_historico where insumo_id=$1 order by criado_em desc limit 1`, [ins.j.id])
  ok('custo do insumo: 5 kg por R$ 180,00 → R$ 36,00/kg, com histórico (motivo "Compra nota …")', custoCarne.c === 3600 && histC.a === 3200 && histC.n === 3600 && /Compra nota/.test(histC.motivo), texto(histC))
  ok('CMV do burger recalculado: 120 g a R$ 36/kg + pão R$ 1,125 → R$ 5,45', (await custoBurger()) === 545, String(await custoBurger()))
  const kc = await um(`select status, valor_centavos::int v, origem, vencimento::text venc, categoria_id from fin_contas where id=$1`, [cp1.j.contaId])
  criados.contas.push(cp1.j.contaId)
  ok('gerou a conta a pagar (Insumos, vencimento da nota)', kc.status === 'a_pagar' && kc.v === 26100 && kc.origem === 'compra' && kc.venc === dia(10) && kc.categoria_id === cat('Insumos').id, texto(kc))
  const itensQ = await q(`select quantidade_base::float qb from fin_compra_itens where compra_id=$1 order by quantidade_base`, [cp1.j.id])
  ok('quantidades guardadas na unidade base (estoque futuro): 72 un, 5000 g', itensQ.map((x) => x.qb).join(',') === '72,5000', texto(itensQ))
  const cp2corpo = { chave: `e2e-${SUF}-c2`, numeroNota: `T${SUF}2`, dataCompra: hoje, pagamento: 'caixa', itens: [{ insumoId: ins.j.id, quantidade: 2000, unidade: 'g', valorCentavos: 8000 }] }
  const cp2 = await api(ger.p, '/api/admin/financeiro/contas/compras', 'POST', cp2corpo)
  const lc2 = await q(`select carteira, tipo, valor_centavos::int v, turno_id from fin_lancamentos where restaurante_id=$1 and chave_idempotencia=$2 order by linha`, [loja.id, `compra:${cp2.j?.id}`])
  ok('compra paga com dinheiro do caixa: −gaveta "compra" no turno', cp2.s === 201 && lc2[0]?.carteira === 'gaveta' && lc2[0]?.tipo === 'compra' && lc2[0]?.v === -8000 && lc2[0]?.turno_id === turno.id, texto(lc2))
  const cp2b = await api(ger.p, '/api/admin/financeiro/contas/compras', 'POST', cp2corpo)
  ok('mesma nota de novo (clique duplo) não duplica', cp2b.s === 200 && cp2b.j.repetido === true && (await q(`select 1 from fin_compras where restaurante_id=$1 and numero_nota=$2`, [loja.id, `T${SUF}2`])).length === 1)
  const cp3 = await api(ger.p, '/api/admin/financeiro/contas/compras', 'POST', { chave: `e2e-${SUF}-c3`, numeroNota: `T${SUF}3`, dataCompra: hoje, pagamento: 'empresa', forma: 'pix', itens: [{ insumoId: pao.j.id, quantidade: 1, unidade: 'pacote', valorCentavos: 2700 }] })
  ok('compra paga pela empresa: conta já nasce paga', cp3.s === 201 && (await conta(cp3.j.contaId)).status === 'pago')
  ok('unidade que não é do insumo → recusada', (await api(ger.p, '/api/admin/financeiro/contas/compras', 'POST', { chave: `e2e-${SUF}-c4`, dataCompra: hoje, pagamento: 'a_prazo', vencimento: hoje, itens: [{ insumoId: ins.j.id, quantidade: 1, unidade: 'L', valorCentavos: 100 }] })).s === 400)
  const insViz = (await um(`insert into cmv_insumos (restaurante_id, nome, unidade_compra, quantidade_compra, base_por_unidade, unidade_base, custo_compra_centavos) values ($1,$2,'kg',1,1000,'g',1000) returning id`, [viz.id, `TESTE viz ${SUF}`])).id
  af('insumo de OUTRA loja na nota → 404 (nada gravado)', (await api(ger.p, '/api/admin/financeiro/contas/compras', 'POST', { chave: `e2e-${SUF}-c5`, dataCompra: hoje, pagamento: 'a_prazo', vencimento: hoje, itens: [{ insumoId: insViz, quantidade: 1, unidade: 'kg', valorCentavos: 100 }] })).s === 404)
  const cc = await api(ger.p, '/api/admin/financeiro/contas/compras', 'PATCH', { id: cp1.j.id, motivo: 'TESTE nota lançada errada' })
  ok('cancelar compra a prazo cancela a conta junto (nada some)', cc.s === 200 && (await conta(cp1.j.contaId)).status === 'cancelado' && (await um(`select status from fin_compras where id=$1`, [cp1.j.id])).status === 'cancelada')
  af('item de nota não se altera nem se apaga (até com o acesso do servidor)', !!(await sbServ.from('fin_compra_itens').update({ valor_centavos: 1 }).eq('compra_id', cp1.j.id)).error && !!(await sbServ.from('fin_compra_itens').delete().eq('compra_id', cp1.j.id)).error)
  af('conta não se apaga (até com o acesso do servidor)', !!(await sbServ.from('fin_contas').delete().eq('id', gz.j.id)).error && !!(await conta(gz.j.id)))
  af('conta paga não muda de valor (até com o acesso do servidor)', !!(await sbServ.from('fin_contas').update({ valor_centavos: 1 }).eq('id', gz.j.id)).error && (await conta(gz.j.id)).valor_centavos === '15000')

  secao('DRE batendo com o livro-caixa')
  const dr = await api(dono.p, `/api/admin/financeiro/contas/dre?de=${hoje}&ate=${hoje}`)
  const fatSql = (await um(`select coalesce(sum(valor_centavos),0)::bigint s from fin_lancamentos where restaurante_id=$1 and tipo in ('recebimento','troco','estorno') and carteira not in ('empresa','resultado')
    and (criado_em at time zone 'America/Sao_Paulo')::date = $2::date`, [loja.id, hoje])).s
  const resSql = (await um(`select coalesce(sum(valor_centavos),0)::bigint s from fin_lancamentos where restaurante_id=$1 and carteira='resultado' and (criado_em at time zone 'America/Sao_Paulo')::date = $2::date`, [loja.id, hoje])).s
  const A_ = dr.j?.atual
  ok('faturamento = soma do livro-caixa (recebimentos do dia)', dr.s === 200 && A_.faturamentoCentavos === Number(fatSql), `${A_?.faturamentoCentavos} × ${fatSql}`)
  ok('conferência: resultado do DRE = carteira "resultado" do livro-caixa', dr.j.conferencia.resultadoLedgerCentavos === Number(resSql), `${dr.j.conferencia.resultadoLedgerCentavos} × ${resSql}`)
  const desp = (n) => A_.despesas.find((x) => x.nome === n)?.valorCentavos ?? 0
  ok('despesas por categoria (Pessoal R$ 150, Manutenção R$ 1.500; aluguel estornado some)', desp('Pessoal') >= 15000 && desp('Manutenção') >= 150000 && !A_.despesas.some((x) => x.nome === 'Aluguel' && x.valorCentavos === 9000), texto(A_.despesas))
  ok('repasse iFood como outra receita; aporte fora do resultado', (A_.outrasReceitas.find((x) => x.nome.startsWith('Repasse'))?.valorCentavos ?? 0) >= 85000 && A_.foraDoResultadoCentavos >= 100000)
  ok('compras de insumos fora das despesas (já estão no CMV)', A_.comprasInsumosCentavos >= 8000 + 2700 && !A_.despesas.some((x) => x.nome === 'Insumos'))
  ok('lucro líquido = faturamento − CMV + outras receitas − despesas', A_.lucroLiquidoCentavos === A_.faturamentoCentavos - A_.cmvCentavos + A_.outrasReceitasCentavos - A_.despesasCentavos)
  ok('comparação com o período anterior (ontem)', dr.j.anterior?.de === dia(-1) && dr.j.anterior?.ate === dia(-1) && typeof dr.j.anterior.dre?.faturamentoCentavos === 'number')

  secao('Permissões e antifraude')
  const ccv = await contas(gar.p)
  af('garçom não vê contas (nem pela API)', ccv.s === 403 || ccv.s === 404, String(ccv.s))
  af('caixa/atendente (padrão) não vê contas nem DRE', (await contas(ate.p)).s === 403 && (await api(ate.p, `/api/admin/financeiro/contas/dre`)).s === 403)
  af('atendente não lança conta', (await nova(ate.p, { tipo: 'pagar', descricao: 'TESTE x', categoriaId: cat('Outros').id, valorCentavos: 100, vencimento: hoje })).s === 403)
  await db.query(`update usuarios set acessos=$2 where id=$1`, [A.id, JSON.stringify({ areas: ['financeiro'], sensiveis: ['contas_pagar'] })])
  const soVer = await contas(ate.p)
  const vazio = await nova(ate.p, { tipo: 'pagar', descricao: 'TESTE x', categoriaId: cat('Outros').id, valorCentavos: 100, vencimento: hoje })
  af('só "ver contas": vê, mas não lança nem dá baixa', soVer.s === 200 && soVer.j.pode.lancar === false && vazio.s === 403 && (await acao(ate.p, gz.j.id, { acao: 'estornar', motivo: 'TESTE tentativa sem permissão' })).s === 403)
  await db.query(`update usuarios set acessos=$2 where id=$1`, [A.id, A.acessos ? JSON.stringify(A.acessos) : null])
  await db.query(`select fin_categorias_garantir($1)`, [viz.id])
  const catViz = await um(`select id from fin_categorias where restaurante_id=$1 and nome='Outros'`, [viz.id])
  const contaViz = (await um(`insert into fin_contas (restaurante_id, tipo, descricao, categoria_id, valor_centavos, vencimento, criado_por_nome, chave_idempotencia) values ($1,'pagar',$2,$3,500,$4,'TESTE','e2e-viz-${SUF}') returning id`, [viz.id, `TESTE viz ${SUF}`, catViz.id, hoje])).id
  af('conta de OUTRA loja pelo ID → 404 (baixar, editar, anexo)', (await acao(dono.p, contaViz, { acao: 'baixar', carteira: 'empresa', forma: 'pix' })).s === 404 && (await acao(dono.p, contaViz, { acao: 'cancelar', motivo: 'TESTE invasão' })).s === 404 && (await api(dono.p, `/api/admin/financeiro/contas/${contaViz}`)).s === 404)
  af('categoria de OUTRA loja → 404', (await nova(ger.p, { tipo: 'pagar', descricao: 'TESTE cat viz', categoriaId: catViz.id, valorCentavos: 100, vencimento: hoje })).s === 404)
  const inj = await nova(ger.p, { tipo: 'pagar', descricao: `TESTE injeção ${SUF}`, categoriaId: cat('Outros').id, valorCentavos: 700, vencimento: hoje, restauranteId: viz.id, status: 'pago', criadoPorNome: 'Fulano' })
  const kinj = await conta(inj.j?.id)
  criados.contas.push(inj.j?.id)
  af('loja, status e autor no corpo são ignorados', kinj?.restaurante_id === loja.id && kinj.status === 'a_pagar' && kinj.criado_por_nome !== 'Fulano', texto(kinj && [kinj.restaurante_id === loja.id, kinj.status, kinj.criado_por_nome]))
  const rep = await nova(ger.p, { tipo: 'pagar', descricao: `TESTE dup ${SUF}`, categoriaId: cat('Outros').id, valorCentavos: 700, vencimento: hoje, chave: `e2e-${SUF}-idem` })
  const rep2 = await nova(ger.p, { tipo: 'pagar', descricao: `TESTE dup ${SUF}`, categoriaId: cat('Outros').id, valorCentavos: 700, vencimento: hoje, chave: `e2e-${SUF}-idem` })
  criados.contas.push(rep.j?.id)
  af('mesma chave (clique duplo) → uma conta só', rep.j?.id === rep2.j?.id && rep2.j.repetido === true)
  af('sem sessão → 401', (await semSessao('/api/admin/financeiro/contas')).s === 401)
  const del = await api(dono.p, `/api/admin/financeiro/contas/${gz.j.id}`, 'DELETE')
  af('DELETE em conta (não existe exclusão) → 405', del.s === 405, String(del.s))
  af('valor negativo/zero → 400', (await nova(ger.p, { tipo: 'pagar', descricao: 'TESTE neg', categoriaId: cat('Outros').id, valorCentavos: -500, vencimento: hoje })).s === 400)
  const anx = await api(ger.p, `/api/admin/financeiro/contas/${big.j.id}`, 'POST', '%PDF-1.4 TESTE', { 'Content-Type': 'application/pdf', 'x-nome': 'boleto.pdf' })
  const link = await api(ger.p, `/api/admin/financeiro/contas/${big.j.id}`)
  ok('anexo (PDF) guardado em armazenamento privado; link assinado curto', anx.s === 200 && /token=/.test(link.j?.url ?? ''), `${anx.s} ${link.s}`)
  af('anexo de tipo proibido (texto/HTML) → 415', (await api(ger.p, `/api/admin/financeiro/contas/${big.j.id}`, 'POST', '<script>', { 'Content-Type': 'text/html', 'x-nome': 'x.html' })).s === 415)
  const csv = await api(dono.p, '/api/admin/financeiro/contas/exportar?tipo=pagar')
  ok('CSV das contas (BOM, ";", auditado)', csv.s === 200 && csv.t.charCodeAt(0) === 0xFEFF && csv.t.includes('Descrição;Fornecedor') && !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='contas.exportou' limit 1`, [loja.id])))
  const aud = await q(`select distinct acao from eventos_auditoria where restaurante_id=$1 and criado_em > now() - interval '30 minutes' and (acao like 'contas.%' or acao like 'compras.%')`, [loja.id])
  ok('tudo auditado (criou, pagou, recebeu, estornou, cancelou, anexou, compra)', ['contas.criou', 'contas.pagou', 'contas.recebeu', 'contas.estornou_baixa', 'compras.registrou', 'compras.cancelou', 'contas.anexou'].every((a) => aud.some((x) => x.acao === a)), aud.map((x) => x.acao).join(','))

  secao('Tela: desktop e celular')
  await dono.p.goto(`${BASE}/admin/financeiro?secao=contas`, { waitUntil: 'networkidle' })
  await dispensarSetup(dono.p)
  await dono.p.getByTestId('contas-tabela').waitFor({ timeout: 15000 })
  await dono.p.getByTestId('conta-nova').click()
  await dono.p.getByTestId('conta-descricao').fill(`TESTE Internet ${SUF}`)
  await dono.p.getByTestId('conta-categoria').selectOption({ label: 'Contas de consumo' })
  await dono.p.getByTestId('conta-valor').fill('119,90')
  await dono.p.getByTestId('conta-vencimento').fill(dia(3))
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'contas-nova-desktop.png') })
  await dono.p.getByTestId('conta-salvar').click()
  const linhaNet = dono.p.locator(`[data-testid="conta-linha"][data-descricao="TESTE Internet ${SUF}"]`)
  await linhaNet.waitFor({ timeout: 10000 })
  ok('lançar pela tela', await linhaNet.isVisible())
  criados.contas.push((await um(`select id from fin_contas where restaurante_id=$1 and descricao=$2`, [loja.id, `TESTE Internet ${SUF}`]))?.id)
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'contas-lista-desktop.png') })
  await linhaNet.getByTestId('conta-baixar').click()
  await dono.p.getByTestId('janela-baixa').waitFor()
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'contas-pagar-desktop.png') })
  await dono.p.getByTestId('baixa-confirmar').click()
  await dono.p.getByTestId('janela-baixa').waitFor({ state: 'detached', timeout: 10000 })
  await dono.p.getByTestId('contas-situacao-pagas').click()
  const paga = dono.p.locator(`[data-testid="conta-linha"][data-descricao="TESTE Internet ${SUF}"][data-status="pago"]`)
  await paga.waitFor({ timeout: 10000 })
  ok('pagar pela tela (vai para "Pagas")', await paga.isVisible() && (await um(`select status from fin_contas where restaurante_id=$1 and descricao=$2`, [loja.id, `TESTE Internet ${SUF}`])).status === 'pago')
  await dono.p.getByTestId('contas-aba-dre').click()
  await dono.p.getByTestId('dre-lucro-liquido').waitFor({ timeout: 15000 })
  ok('DRE na tela com o lucro líquido', await dono.p.getByTestId('dre-lucro-liquido').isVisible())
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'dre-desktop.png') })
  await dono.p.getByTestId('contas-aba-compras').click()
  await dono.p.getByTestId('compras-lista').waitFor({ timeout: 10000 })
  await dono.p.getByTestId('compra-nova').click()
  await dono.p.getByTestId('form-compra').waitFor()
  await dono.p.getByTestId('compra-insumo').first().selectOption({ label: `TESTE Carne compra ${SUF}` })
  await dono.p.getByTestId('compra-qtd').first().fill('3')
  await dono.p.getByTestId('compra-valor').first().fill('99,00')
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'compra-nova-desktop.png') })
  await dono.p.getByTestId('compra-salvar').click()
  await dono.p.getByTestId('form-compra').waitFor({ state: 'detached', timeout: 10000 })
  ok('compra pela tela atualiza o custo (3 kg por R$ 99 → R$ 33/kg)', (await um(`select custo_compra_centavos::int c from cmv_insumos where id=$1`, [ins.j.id])).c === 3300)
  const cpTela = await um(`select id, conta_id from fin_compras where restaurante_id=$1 and criado_em > now() - interval '2 minutes' and total_centavos=9900 order by criado_em desc limit 1`, [loja.id])
  if (cpTela) { criados.compras.push(cpTela.id); criados.contas.push(cpTela.conta_id) }
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'compras-desktop.png') })
  await dono.p.getByTestId('contas-aba-cadastros').click()
  await dono.p.getByTestId('secao-cadastros').waitFor()
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'cadastros-desktop.png') })

  const cel = await logar('dono.finint', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await cel.p.goto(`${BASE}/admin/financeiro?secao=contas`, { waitUntil: 'networkidle' })
  await dispensarSetup(cel.p)
  await cel.p.getByTestId('contas-cartoes').waitFor({ timeout: 15000 })
  ok('celular: contas em cartões, sem rolagem lateral', (await cel.p.getByTestId('conta-cartao').count()) > 0 && await cel.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  if (PRINTS) await cel.p.screenshot({ path: join(PRINTS, 'contas-celular.png') })
  await cel.p.getByTestId('conta-nova').tap()
  await cel.p.getByTestId('form-conta').waitFor()
  ok('celular: formulário em tela cheia', (await cel.p.getByTestId('form-conta').evaluate((e) => Math.round(e.getBoundingClientRect().width))) === 390)
  if (PRINTS) await cel.p.screenshot({ path: join(PRINTS, 'contas-nova-celular.png') })
  await cel.p.keyboard.press('Escape')
  await cel.p.getByTestId('contas-aba-dre').tap()
  await cel.p.getByTestId('dre-lucro-liquido').waitFor({ timeout: 15000 })
  if (PRINTS) await cel.p.screenshot({ path: join(PRINTS, 'dre-celular.png') })
  await cel.ctx.close()
} catch (e) {
  ok('fluxo sem erro', false, String(e?.stack ?? e).slice(0, 600))
} finally {
  // Limpeza pelo sistema: contas TESTE em aberto canceladas; compras a prazo canceladas; cadastros desativados; produto apagado.
  for (const id of criados.contas.filter(Boolean)) await api(dono.p, `/api/admin/financeiro/contas/${id}`, 'PATCH', { acao: 'cancelar', motivo: 'TESTE limpeza do e2e', serie: true }).catch(() => {})
  const abertas = await q(`select id from fin_contas where restaurante_id=$1 and descricao like 'TESTE%' and status='a_pagar'`, [loja.id]).catch(() => [])
  for (const k of abertas) await api(dono.p, `/api/admin/financeiro/contas/${k.id}`, 'PATCH', { acao: 'cancelar', motivo: 'TESTE limpeza do e2e', serie: true }).catch(() => {})
  for (const id of criados.compras.filter(Boolean)) await api(dono.p, '/api/admin/financeiro/contas/compras', 'PATCH', { id, motivo: 'TESTE limpeza do e2e' }).catch(() => {})
  for (const id of criados.fornecedores.filter(Boolean)) await db.query(`update fin_fornecedores set ativo=false where id=$1`, [id]).catch(() => {})
  for (const id of criados.categorias.filter(Boolean)) await db.query(`update fin_categorias set ativo=false where id=$1`, [id]).catch(() => {})
  await db.query(`update pedidos set status='cancelado', cancelado_motivo='teste', cancelado_em=now() where restaurante_id=$1 and cliente_nome='TESTE CONTAS' and status <> 'cancelado'`, [loja.id]).catch(() => {})
  await db.query(`delete from cmv_fichas where restaurante_id=$1 and (item_id = any($2) or alvo_id = any($2))`, [loja.id, criados.itens]).catch(() => {})
  await db.query(`delete from itens_cardapio where id = any($1)`, [criados.itens]).catch((e) => console.log('limpeza itens:', e.message))
  await db.query(`update cmv_insumos set ativo=false where id = any($1) or (restaurante_id=$2 and nome like 'TESTE viz%')`, [criados.insumos.filter(Boolean), viz.id]).catch(() => {})
  await db.query(`update usuarios set acessos=$2 where id=$1`, [A.id, A.acessos ? JSON.stringify(A.acessos) : null]).catch(() => {})
  await browser.close()
  await db.end()
}
const falhas = res.filter((x) => !x).length
if (antifraude.length) { console.log('\nAntifraude:'); for (const [n, c] of antifraude) console.log(`  ${c ? 'OK ' : 'FALHOU'}  ${n}`) }
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
