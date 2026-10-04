/**
 * E2E — Dashboard e DRE na mesma base (0145, 2026-10-04).
 *  1) Diferenças de caixa (sobras − faltas) fora de "Despesas", numa linha própria, com o detalhe por turno;
 *     o lucro líquido as soma de forma explícita.
 *  2) Produtos, CMV, origens e formas: só vendas que estão no livro-caixa do período. Pedido sem lançamento,
 *     pedido estornado e item cancelado não entram. Conciliação: produtos + taxas − descontos + outros = faturamento.
 *  3) Celular (390 px): 1 card por linha, título sem cortar, valor sem quebrar, status do caixa no topo.
 * Loja PRÓPRIA nova a cada rodada (`base-e2e-<hora>`): o livro-caixa é imutável.
 *
 *   node scripts/seguranca/e2e-financeiro-mesma-base.mjs [pasta-de-prints]
 * Parte 1 é só banco (stack local). As partes de API e tela rodam se o servidor local (BASE) responder.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const SENHA = 'demo-local-123456'
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const texto = (v) => JSON.stringify(v)
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

// ── semente: loja nova, itens, turnos, pedidos e livro-caixa ─────────────────────────────────────
secao('Semente (loja nova)')
const slug = `base-e2e-${Date.now().toString(36)}`
const L = (await um(`insert into restaurantes (nome, slug, status_loja, telefone, financeiro_ativo, pdv_v2) values ('Lanchonete Mesma Base', $1, 'aberto_manual', '27999990000', true, true) returning id`, [slug])).id
await q(`insert into fin_config (restaurante_id) values ($1) on conflict do nothing`, [L])
const grupo = (await um(`insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1, 'TESTE Base', 0) returning id`, [L])).id
const item = async (nome, preco) => (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status, tipo_item) values ($1,$2,$3,$4,'disponivel','simples') returning id`, [L, grupo, nome, preco])).id
const I = { prato: await item('TESTE Prato Base', 30), suco: await item('TESTE Suco Base', 10), lanche: await item('TESTE Lanche Base', 25),
  velho: await item('TESTE Velho Sem Caixa', 40), porcao: await item('TESTE Porção Base', 20), bebida: await item('TESTE Bebida Base', 15), cancelado: await item('TESTE Cancelado Base', 50), estorno: await item('TESTE Estornado Base', 15) }
const turno = async () => (await um(`insert into caixa_turnos (restaurante_id, aberto_por_nome, valor_inicial_centavos, status) values ($1, 'TESTE Caixa', 0, 'aberto') returning id`, [L])).id
const fechar = (t) => q(`update caixa_turnos set fechado_em = now(), status = 'fechado', fechado_por_nome = 'TESTE Caixa', justificativa = 'TESTE diferença' where id = $1`, [t])
const pedido = async ({ itens, taxa = 0, desconto = 0, comanda = null, status = 'entregue' }) => {
  const subtotal = itens.reduce((s, [, p, qn]) => s + p * qn, 0)
  const p = (await um(`insert into pedidos (restaurante_id, status, tipo, cliente_nome, subtotal, taxa_entrega, desconto, total, comanda_id, forma_pagamento)
    values ($1, $2, 'retirada', 'TESTE Cliente', $3, $4, $5, $6, $7, 'dinheiro') returning id`, [L, status, subtotal, taxa, desconto, subtotal + taxa - desconto, comanda])).id
  const ids = []
  for (const [itemId, preco, qtd, cancelado] of itens) {
    ids.push((await um(`insert into pedido_itens (pedido_id, item_id, nome, preco_unitario, quantidade, cancelado_em) values ($1, $2, (select nome from itens_cardapio where id = $2), $3, $4, $5) returning id`,
      [p, itemId, preco, qtd, cancelado ? new Date() : null])).id)
  }
  return { id: p, itens: ids }
}
const custo = (pedidoItem, centavos) => q(`insert into pedido_itens_custo (pedido_item_id, restaurante_id, pedido_id, situacao, custo_unitario, custo_unitario_centavos)
  select pi.id, $2, pi.pedido_id, 'ok', $3::numeric, $3::bigint from pedido_itens pi where pi.id = $1
  on conflict (pedido_item_id) do update set situacao = 'ok', custo_unitario = excluded.custo_unitario, custo_unitario_centavos = excluded.custo_unitario_centavos`, [pedidoItem, L, centavos])
let n = 0
const lancar = (turnoId, linhas) => q(`select public.fin_lancar_grupo($1, $2, $3, 'manual', null, 'TESTE', 'TESTE base', null, null, 'e2e', $4::jsonb)`,
  [L, turnoId, `base-e2e:${slug}:${++n}`, JSON.stringify(linhas)])
const receb = (carteira, forma, v, ref = {}) => ({ carteira, tipo: 'recebimento', valor_centavos: v, forma, ...ref })

const T1 = await turno()
// P1: 2 pratos + 1 suco = 70, taxa 5, desconto 7 → total 68 (dinheiro). Custo guardado: prato 12,00, suco 3,00.
const P1 = await pedido({ itens: [[I.prato, 30, 2], [I.suco, 10, 1]], taxa: 5, desconto: 7 })
await custo(P1.itens[0], 1200); await custo(P1.itens[1], 300)
await lancar(T1, [receb('gaveta', 'dinheiro', 6800, { pedido_id: P1.id })])
// P2: 1 lanche = 25, no cartão. Sem custo (sem ficha).
const P2 = await pedido({ itens: [[I.lanche, 25, 1]] })
await lancar(T1, [receb('cartao', 'cartao', 2500, { pedido_id: P2.id })])
// P3: pedido ANTIGO, entregue, SEM lançamento no livro-caixa (de antes do financeiro). Tem custo — não pode entrar.
const P3 = await pedido({ itens: [[I.velho, 40, 3]] })
await custo(P3.itens[0], 2000)
// P4: pago e estornado (líquido zero) → não é venda.
const P4 = await pedido({ itens: [[I.estorno, 15, 1]] })
await lancar(T1, [receb('gaveta', 'dinheiro', 1500, { pedido_id: P4.id })])
await lancar(T1, [{ carteira: 'gaveta', tipo: 'estorno', valor_centavos: -1500, forma: 'dinheiro', pedido_id: P4.id }])
// Comanda: 2 porções (40) + 1 bebida (15) + 1 pedido CANCELADO (50, não entra); paga 60,50 (55 + 10% de serviço).
const mesa = (await um(`insert into mesas (restaurante_id, nome) values ($1, 'TESTE Mesa 1') returning id`, [L])).id
const C1 = (await um(`insert into comandas (restaurante_id, tipo, mesa_id, cliente_nome) values ($1, 'mesa', $2, 'TESTE Cliente') returning id`, [L, mesa])).id
await pedido({ itens: [[I.porcao, 20, 2]], comanda: C1 })
await pedido({ itens: [[I.bebida, 15, 1], [I.prato, 30, 1, true]], comanda: C1 })
await pedido({ itens: [[I.cancelado, 50, 1]], comanda: C1, status: 'cancelado' })
await lancar(T1, [receb('pix_conferir', 'pix', 6050, { comanda_id: C1 })])
// Venda lançada à mão, sem pedido.
await lancar(T1, [receb('gaveta', 'dinheiro', 1000)])
// Despesa paga no caixa: R$ 20.
await lancar(T1, [{ carteira: 'gaveta', tipo: 'despesa', valor_centavos: -2000, forma: 'dinheiro' }, { carteira: 'resultado', tipo: 'despesa', valor_centavos: -2000, forma: 'dinheiro' }])
// Fechamento com SOBRA de R$ 11 (T1) e outro turno com FALTA de R$ 3 (T2).
await lancar(T1, [{ carteira: 'gaveta', tipo: 'ajuste', valor_centavos: 1100, forma: 'dinheiro', dados: { motivo: 'sobra no fechamento' } }, { carteira: 'resultado', tipo: 'ajuste', valor_centavos: 1100, forma: 'dinheiro' }])
await fechar(T1)
const T2 = await turno()
await lancar(T2, [{ carteira: 'gaveta', tipo: 'ajuste', valor_centavos: -300, forma: 'dinheiro', dados: { motivo: 'falta no fechamento' } }, { carteira: 'resultado', tipo: 'ajuste', valor_centavos: -300, forma: 'dinheiro' }])
await fechar(T2)
ok('semente gravada (loja nova, 2 turnos fechados)', !!L && !!T1 && !!T2, slug)

// ── 1. banco ───────────────────────────────────────────────────────────────────────────────────
secao('Banco: fin_vendas_base, fin_dashboard e fin_diferencas_caixa')
const base = (await um(`select public.fin_vendas_base($1, $2::date, $2::date, 'dia') b`, [L, hoje])).b
const c = base.conciliacao
const FAT = 6800 + 2500 + 1500 - 1500 + 6050 + 1000
ok('faturamento da conciliação = soma do livro-caixa', Number(c.faturamento) === FAT, `${c.faturamento} × ${FAT}`)
ok('produtos = só itens de vendas no livro-caixa (70 + 25 + 40 + 15)', Number(c.itens) === 15000, String(c.itens))
ok('taxas e descontos explicados (5 e 7)', Number(c.taxas) === 500 && Number(c.descontos) === 700, texto([c.taxas, c.descontos]))
ok('serviço da comanda em "outros" (5,50)', Number(c.outros) === 550, String(c.outros))
ok('venda lançada sem pedido à parte (10,00)', Number(c.sem_pedido) === 1000 && Number(c.outro_periodo) === 0, texto([c.sem_pedido, c.outro_periodo]))
ok('a conta fecha: produtos + taxas − descontos + outros + outro período + sem pedido = faturamento',
  Number(c.itens) + Number(c.taxas) - Number(c.descontos) + Number(c.outros) + Number(c.outro_periodo) + Number(c.sem_pedido) === Number(c.faturamento))
const somaProdutos = base.itens.reduce((s, i) => s + Number(i.receita), 0)
ok('TESTE NOVO: soma dos produtos = faturamento − taxas + descontos − outros − sem pedido',
  Math.round(somaProdutos) === FAT - Number(c.taxas) + Number(c.descontos) - Number(c.outros) - Number(c.sem_pedido), `${somaProdutos} × ${FAT}`)
const nomes = base.itens.map((i) => i.nome)
ok('pedido sem lançamento (antigo) NÃO entra', !nomes.includes('TESTE Velho Sem Caixa'))
ok('pedido estornado (líquido zero) NÃO entra', !nomes.includes('TESTE Estornado Base'))
ok('item cancelado e pedido cancelado da comanda NÃO entram', !nomes.includes('TESTE Cancelado Base') && Number(base.itens.find((i) => i.nome === 'TESTE Prato Base')?.qtd) === 2)
ok('vendas = 3 (2 pedidos + a comanda; o estornado fica de fora)', Number(c.vendas) === 3, String(c.vendas))
ok('CMV só das vendas do livro-caixa (2 × 12 + 3; o antigo de 3 × 20 fica de fora)', Math.round(Number(base.cmv)) === 2700, String(base.cmv))
ok('CMV por dia na mesma base', Math.round(Number(base.cmv_por_bucket?.[hoje] ?? 0)) === 2700, texto(base.cmv_por_bucket))
ok('sem custo contado só na base (lanche, porção, bebida)', Number(base.sem_custo) === 3, String(base.sem_custo))

const dash = (await um(`select public.fin_dashboard($1, $2::date, $2::date, 'dia') d`, [L, hoje])).d
ok('dashboard: faturamento = conciliação', Number(dash.faturamento) === FAT)
ok('vendas do card = vendas da base (estornada não conta) — ticket médio coerente', Number(dash.vendas) === Number(c.vendas) && Number(dash.serie[0].vendas) === Number(c.vendas), texto([dash.vendas, dash.serie[0].vendas, c.vendas]))
ok('despesas SEM as diferenças de caixa (só os R$ 20)', Number(dash.despesas) === 2000, String(dash.despesas))
ok('diferenças de caixa = sobras − faltas (11 − 3 = 8)', Number(dash.diferencas_caixa) === 800 && Number(dash.sobras) === 1100 && Number(dash.faltas) === 300, texto([dash.diferencas_caixa, dash.sobras, dash.faltas]))
ok('série: despesas sem diferenças; diferenças numa chave própria', Number(dash.serie[0].despesas) === 2000 && Number(dash.serie[0].diferencas) === 800, texto(dash.serie[0]))
const soma = (o) => Object.values(o ?? {}).reduce((s, v) => s + Number(v), 0)
ok('origens e formas somam o faturamento (mesma base)', soma(dash.por_origem) === FAT && soma(dash.por_forma) === FAT)
const turnos = await q(`select * from public.fin_diferencas_caixa($1, $2::date, $2::date)`, [L, hoje])
ok('detalhe por turno: 2 turnos (+11 e −3)', turnos.length === 2 && turnos.some((t) => t.turno_id === T1 && Number(t.diferenca_centavos) === 1100) && turnos.some((t) => t.turno_id === T2 && Number(t.diferenca_centavos) === -300), texto(turnos.map((t) => t.diferenca_centavos)))
ok('detalhe por turno soma a linha do resultado', turnos.reduce((s, t) => s + Number(t.diferenca_centavos), 0) === Number(dash.diferencas_caixa))
const vizinha = (await um(`select public.fin_vendas_base(gen_random_uuid(), $1::date, $1::date, 'dia') b`, [hoje])).b
ok('outra loja não enxerga nada', Number(vizinha.conciliacao.faturamento) === 0 && vizinha.itens.length === 0)
const fx = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fin_vendas_base', 'fin_diferencas_caixa', 'fin_dashboard')`)
ok('funções novas fechadas para anon e authenticated', fx.length === 3 && fx.every((f) => !f.anon && !f.auth), texto(fx))

// ── 2 e 3. API e tela (com o servidor local) ────────────────────────────────────────────────────
const servidor = await fetch(`${BASE}/login`).then((r) => r.ok).catch(() => false)
if (!servidor) {
  console.log('\n(servidor local fora do ar: API e tela não rodaram)')
} else {
  const sb = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const email = `dono+${slug}@base.local`
  const { data: u, error } = await sb.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error) throw error
  await q(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,'dono','Dono Base',$3,$4,true)`, [u.user.id, L, email, `dono.${slug}`])
  const browser = await chromium.launch()
  const logar = async (opcoes) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, ...opcoes, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', `dono.${slug}`); await p.fill('input[name="password"]', SENHA)
    await Promise.all([p.waitForURL((x) => !x.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
    await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
    return { ctx, p }
  }
  const api = (p, url) => p.evaluate(async (u) => { const r = await fetch(u); return { s: r.status, j: await r.json().catch(() => null) } }, `${BASE}${url}`)
  try {
    secao('API: dashboard e DRE')
    const dono = await logar()
    const d = await api(dono.p, `/api/admin/financeiro/dashboard?de=${hoje}&ate=${hoje}&grupo=dia`)
    const C = d.j?.cards
    const r = await api(dono.p, `/api/admin/financeiro/contas/dre?de=${hoje}&ate=${hoje}`)
    const A = r.j?.atual
    ok('dashboard responde', d.s === 200 && !!C, String(d.s))
    ok('card Despesas sem as diferenças (R$ 20)', C.despesasCentavos === 2000, String(C.despesasCentavos))
    ok('card Diferenças de caixa = +R$ 8 (sobras 11, faltas 3)', C.diferencasCaixaCentavos === 800 && C.sobrasCentavos === 1100 && C.faltasCentavos === 300)
    ok('DRE: linha própria "diferenças de caixa" e nenhuma despesa com esse nome', A.diferencasCaixaCentavos === 800 && A.despesasCentavos === 2000 && !A.despesas.some((x) => /Diferen/.test(x.nome)), texto(A.despesas))
    ok('lucro líquido explícito = bruto + outras receitas − despesas + diferenças', A.lucroLiquidoCentavos === A.lucroBrutoCentavos + A.outrasReceitasCentavos - A.despesasCentavos + A.diferencasCaixaCentavos, String(A.lucroLiquidoCentavos))
    ok('dashboard e DRE com o mesmo lucro líquido e CMV', C.lucroLiquidoCentavos === A.lucroLiquidoCentavos && C.cmvCentavos === A.cmvCentavos && C.cmvCentavos === 2700)
    ok('DRE com o detalhe por turno', r.j.diferencasPorTurno?.length === 2)
    ok('dashboard: produtos = conciliação; mais vendido na base do caixa (Prato e Porção empatam com 2 un)', d.j.itens.receitaCentavos === 15000 && d.j.conciliacao.itensCentavos === 15000 && ['TESTE Prato Base', 'TESTE Porção Base'].includes(d.j.itens.maisVendido?.nome) && d.j.itens.maisVendido?.quantidade === 2, texto(d.j.itens.maisVendido))
    ok('sem custo registrado contado na mesma base', C.semCustoRegistrado === 3, String(C.semCustoRegistrado))

    secao('Tela: desktop')
    await dono.p.goto(`${BASE}/admin/financeiro?secao=dashboard`, { waitUntil: 'networkidle' })
    await dono.p.getByTestId('dash-cards').waitFor({ timeout: 15000 })
    await dono.p.getByTestId('dash-atalho-filtro').click().catch(() => {})
    await dono.p.getByTestId('dash-atalho-hoje').click().catch(() => {})
    await dono.p.getByTestId('dash-conciliacao').waitFor()
    await dono.p.waitForTimeout(1200)
    ok('card "Diferenças de caixa" e detalhe por turno na tela', (await dono.p.getByTestId('dash-diferencas-caixa').getAttribute('data-valor')) === '800' && (await dono.p.getByTestId('dash-diferenca-turno').count()) === 2)
    ok('conciliação na tela fecha com o faturamento', (await dono.p.getByTestId('dash-conc-faturamento').getAttribute('data-valor')) === String(FAT))
    ok('lucro líquido avisa a sobra incluída', /sobra de caixa/.test(await dono.p.getByTestId('dash-lucro-inclui-diferencas').innerText()))
    if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'mesma-base-dashboard-desktop.png'), fullPage: true })
    await dono.p.goto(`${BASE}/admin/financeiro?secao=contas`, { waitUntil: 'networkidle' })
    await dono.p.getByTestId('contas-aba-dre').click()
    await dono.p.getByTestId('dre-atalho-hoje').click().catch(() => {})
    const temDre = await dono.p.getByTestId('dre-diferencas-caixa').waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
    ok('DRE na tela: linha "(±) Diferenças de caixa"', temDre && /Diferenças de caixa/.test(await dono.p.getByTestId('dre-diferencas-caixa').innerText()))
    if (PRINTS && temDre) await dono.p.screenshot({ path: join(PRINTS, 'mesma-base-dre-desktop.png'), fullPage: true })
    await dono.ctx.close()

    secao('Tela: celular (390 px)')
    const cel = await logar({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await cel.p.goto(`${BASE}/admin/financeiro?secao=dashboard`, { waitUntil: 'networkidle' })
    await cel.p.getByTestId('dash-cards').waitFor({ timeout: 15000 })
    await cel.p.waitForTimeout(1200)
    const medida = () => cel.p.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-testid$="-cards"] > div, [data-testid$="-resumo"] > div, [data-testid="fluxo-totais"] > div')]
      const rot = cards.map((cd) => cd.querySelector('p'))
      const val = cards.map((cd) => cd.querySelectorAll('p')[1])
      return {
        n: cards.length,
        colunas: new Set(cards.map((cd) => Math.round(cd.getBoundingClientRect().left))).size,
        rotuloCortado: rot.filter((p) => p && p.scrollHeight > p.clientHeight + 1).map((p) => p.textContent),
        valorQuebrado: val.filter((p) => p && p.getBoundingClientRect().height > parseFloat(getComputedStyle(p).fontSize) * 1.6).map((p) => p.textContent),
        estouro: document.documentElement.scrollWidth - window.innerWidth,
      }
    })
    const m = await medida()
    ok('dashboard no celular: 1 card por linha', m.n > 0 && m.colunas === 1, texto(m))
    ok('títulos sem cortar e valores sem quebrar', !m.rotuloCortado.length && !m.valorQuebrado.length, texto([m.rotuloCortado, m.valorQuebrado]))
    ok('sem rolagem lateral', m.estouro <= 0, String(m.estouro))
    const st = cel.p.getByTestId('aviso-caixa-celular')
    const caixaBox = await st.boundingBox()
    ok('status do caixa no topo do celular (compacto, cor viva, à direita)', await st.isVisible() && !!caixaBox && caixaBox.y < 60 && caixaBox.x > 195
      && (await st.evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(21, 128, 61)' === ((await st.getAttribute('data-aberto')) === '1'), texto(caixaBox))
    ok('status do caixa com dica e rótulo acessível', /Caixa (aberto|fechado)/.test((await st.getAttribute('aria-label')) ?? ''))
    if (PRINTS) await cel.p.screenshot({ path: join(PRINTS, 'mesma-base-dashboard-celular.png'), fullPage: true })
    for (const s of ['caixa', 'fluxo', 'cmv', 'contas', 'movimentacoes', 'motoboys', 'pix', 'auditoria', 'risco', 'regras']) {
      await cel.p.goto(`${BASE}/admin/financeiro?secao=${s}`, { waitUntil: 'networkidle' })
      await cel.p.waitForTimeout(900)
      const x = await medida()
      ok(`celular › ${s}: sem rolagem lateral, título e valor inteiros${x.n ? `, ${x.colunas === 1 ? '1 card por linha' : 'COLUNAS: ' + x.colunas}` : ''}`,
        x.estouro <= 0 && !x.rotuloCortado.length && !x.valorQuebrado.length && (!x.n || x.colunas === 1), texto(x))
      if (PRINTS) await cel.p.screenshot({ path: join(PRINTS, `mesma-base-celular-${s}.png`) })
    }
    await cel.ctx.close()
  } finally {
    await browser.close()
  }
}

const passou = res.filter(Boolean).length
console.log(`\nResultado: ${passou}/${res.length}`)
await db.end()
process.exit(passou === res.length ? 0 : 1)
