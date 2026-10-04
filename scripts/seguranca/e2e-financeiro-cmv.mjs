/**
 * E2E — Financeiro Fase 5 (2026-10-04): Precificação / CMV + regra papel × cargo.
 * Loja local `fin-int`. Cria produtos e insumos TESTE (sufixo por rodada). No fim: produtos TESTE apagados (o custo
 * guardado das vendas some junto, em cascata), insumos TESTE DESATIVADOS (o histórico de custos é imutável).
 *
 *   node scripts/seguranca/e2e-financeiro-cmv.mjs [pasta-de-prints]
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
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
const viz = await um(`select id from restaurantes where slug='fin-int-viz'`)
const SENHA = 'demo-local-123456'
const SUF = Math.random().toString(36).slice(2, 6)
const res = [], antifraude = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const af = (n, c, d = '') => { antifraude.push([n, !!c]); ok(`antifraude: ${n}`, c, d) }
const secao = (t) => console.log(`\n── ${t} ──`)
const texto = (v) => JSON.stringify(v)
const uuid = () => crypto.randomUUID()
const browser = await chromium.launch()
await db.query(`update restaurantes set financeiro_ativo=true where id=$1`, [loja.id])

async function logar(login, opcoes = { viewport: { width: 1366, height: 860 } }, senha = SENHA) {
  const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', senha)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
  return { ctx, p }
}
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  const t = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer())
  let j = null; try { j = JSON.parse(t) } catch { /* csv */ }
  return { s: r.status, j, t }
}, { url: `${BASE}${url}`, metodo, corpo })
const semSessao = (url, metodo = 'GET', corpo) => fetch(`${BASE}${url}`, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }))

const dono = await logar('dono.finint')
const ger = await logar('gerente.finint')
const ate = await logar('atendente.finint')

// ── Cardápio TESTE ─────────────────────────────────────────────────────────────────────────
const grupo = await um(`select id from grupos_cardapio where restaurante_id=$1 order by posicao limit 1`, [loja.id])
const criados = { itens: [], tamPizza: [] }
async function item(nome, preco, tipo = 'simples') {
  const r = await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status, tipo_item) values ($1,$2,$3,$4,'disponivel',$5) returning id`, [loja.id, grupo.id, nome, preco, tipo])
  criados.itens.push(r.id); return r.id
}
const BURGER = await item(`TESTE Burger CMV ${SUF}`, 25)
const BACON = (await um(`insert into item_complementos (item_id, nome, preco, posicao) values ($1,$2,4,0) returning id`, [BURGER, `TESTE Bacon ${SUF}`])).id
const ACAI = await item(`TESTE Açaí CMV ${SUF}`, 10)
const ACAI_P = (await um(`insert into tamanhos_item (item_id, nome, preco, posicao) values ($1,'P',10,0) returning id`, [ACAI])).id
const ACAI_G = (await um(`insert into tamanhos_item (item_id, nome, preco, posicao) values ($1,'G',16,1) returning id`, [ACAI])).id
const SEMFICHA = await item(`TESTE Sem Ficha ${SUF}`, 9)
const ERRO = await item(`TESTE Erro CMV ${SUF}`, 9)
const PIZZA = await item(`TESTE Pizza CMV ${SUF}`, 0, 'pizza')
const TAM_M = (await um(`insert into tamanhos_padrao_pizza (restaurante_id, nome, fatias, posicao, max_sabores) values ($1,$2,8,90,2) returning id`, [loja.id, `TESTE M ${SUF}`])).id
criados.tamPizza.push(TAM_M)
const CALA = (await um(`insert into pizza_sabores (item_id, nome, status, posicao) values ($1,'TESTE Calabresa','disponivel',0) returning id`, [PIZZA])).id
const FRANGO = (await um(`insert into pizza_sabores (item_id, nome, status, posicao) values ($1,'TESTE Frango','disponivel',1) returning id`, [PIZZA])).id
await db.query(`insert into pizza_sabor_precos (sabor_id, tamanho_padrao_id, preco) values ($1,$3,40), ($2,$3,44)`, [CALA, FRANGO, TAM_M])
await db.query(`insert into fichas_preparo (item_id, restaurante_id, ingredientes, passos) values ($1,$2,$3,'[]') on conflict (item_id) do update set ingredientes=excluded.ingredientes`,
  [BURGER, loja.id, JSON.stringify([{ nome: `TESTE Tomate ${SUF}`, quantidade: '30 g' }, { nome: 'Sal da casa', quantidade: 'a gosto' }])])

const insumoIds = []
async function insumo(p, corpo) {
  const r = await api(p, '/api/admin/financeiro/cmv/insumos', 'POST', corpo)
  if (r.s !== 201) throw new Error(`insumo ${corpo.nome}: ${r.s} ${texto(r.j)}`)
  insumoIds.push(r.j.id); return r.j.id
}
const insumos = async () => (await api(dono.p, '/api/admin/financeiro/cmv/insumos')).j?.insumos ?? []
const lista = async (p = dono.p) => (await api(p, '/api/admin/financeiro/cmv')).j
const linhaDe = (l, chave) => l?.linhas?.find((x) => x.chave === chave)
const ficha = (p, tipo, id, componentes, tamanho = null) => api(p, '/api/admin/financeiro/cmv/ficha', 'PUT', { tipo, id, tamanho, componentes })

try {
  secao('Parte 0-B. Papel × cargo')
  const usu = `tsa.cmv.${SUF}`
  const cria = await api(dono.p, '/api/admin/equipe', 'POST', { nome: `TESTE Garçom CMV ${SUF}`, usuario: usu, senha: SENHA, cargo: 'garcom', acessos: { areas: ['mesas'], sensiveis: ['financeiro', 'sangria'] } })
  const novoU = await um(`select id, papel::text, cargo from usuarios where usuario=$1`, [usu])
  ok('garçom com sensíveis de gestor: criado com papel de GARÇOM (o cargo define o papel)', cria.s === 201 && novoU?.papel === 'garcom', `${cria.s} ${texto(novoU)}`)
  const sobe = await api(dono.p, `/api/admin/equipe/${novoU.id}`, 'PATCH', { cargo: 'garcom', acessos: { areas: ['mesas', 'pedidos'], sensiveis: [] } })
  ok('garçom com área além do cargo (Painel de Pedidos) → recusado, pede Personalizado', sobe.s === 400 && /Personalizado/.test(sobe.j?.error ?? '') && (await um(`select papel::text from usuarios where id=$1`, [novoU.id])).papel === 'garcom', `${sobe.s} ${sobe.j?.error}`)
  const pers = await api(dono.p, `/api/admin/equipe/${novoU.id}`, 'PATCH', { cargo: 'personalizado', acessos: { areas: ['mesas', 'pedidos'], sensiveis: ['financeiro', 'sangria'] } })
  ok('com o cargo Personalizado, papel diferente é permitido', pers.s === 200 && (await um(`select papel::text from usuarios where id=$1`, [novoU.id])).papel === 'atendente', String(pers.s))
  // Caso garcom123: papel gerente com cargo garçom (dado antigo).
  await db.query(`update usuarios set papel='gerente', cargo='garcom', acessos=$2 where id=$1`, [novoU.id, JSON.stringify({ areas: ['mesas'], sensiveis: ['financeiro', 'sangria', 'estornar'] })])
  await dono.p.goto(`${BASE}/admin/equipe`, { waitUntil: 'networkidle' })
  const aviso = dono.p.locator(`[data-testid="usuario-linha"][data-login="${usu}"] [data-testid="aviso-cargo"]`)
  ok('Equipe avisa: "Papel de Gerente" e permissões de gestor sem ser gerente', await aviso.isVisible().catch(() => false) && /Papel de Gerente/.test(await aviso.innerText()) && /financeiro|sangria|estorno/.test((await aviso.getAttribute('aria-label')) ?? ''), await aviso.getAttribute('aria-label').catch(() => ''))
  if (PRINTS) {
    await dono.p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 4000 }).catch(() => {})
    await aviso.scrollIntoViewIfNeeded().catch(() => {}); await aviso.hover().catch(() => {}); await dono.p.waitForTimeout(400)
    await dono.p.screenshot({ path: join(PRINTS, 'depois-equipe-aviso.png') })
  }
  const ajusta = await api(dono.p, `/api/admin/equipe/${novoU.id}`, 'PATCH', { cargo: 'garcom', acessos: { areas: ['mesas'], sensiveis: [] } })
  const depoisAj = await um(`select papel::text, cargo, acessos from usuarios where id=$1`, [novoU.id])
  ok('ajustar ao cargo (como o garcom123): papel e permissões de garçom, auditado', ajusta.s === 200 && depoisAj.papel === 'garcom' && depoisAj.acessos?.sensiveis?.length === 0
    && !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and entidade_id=$2 and acao like 'equipe.%' order by criado_em desc limit 1`, [loja.id, novoU.id])), texto(depoisAj))
  await db.query(`update usuarios set desativado_em=now(), situacao='excluido' where id=$1`, [novoU.id])

  secao('Parte 1. Insumos: conversões, aproveitamento, sub-receita')
  const T = await insumo(ger.p, { nome: `TESTE Tomate ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 800, aproveitamentoPct: 100 })
  const C = await insumo(ger.p, { nome: `TESTE Carne ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 3200, aproveitamentoPct: 100 })
  const P = await insumo(ger.p, { nome: `TESTE Pão ${SUF}`, unidadeCompra: 'pacote', quantidadeCompra: 1, basePorUnidade: 24, unidadeBase: 'un', custoCompraCentavos: 2400, aproveitamentoPct: 100 })
  const Q = await insumo(ger.p, { nome: `TESTE Queijo ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 4000, aproveitamentoPct: 100 })
  const E = await insumo(ger.p, { nome: `TESTE Embalagem ${SUF}`, unidadeCompra: 'un', quantidadeCompra: 1, custoCompraCentavos: 80, aproveitamentoPct: 100 })
  const B = await insumo(ger.p, { nome: `TESTE Bacon Fatiado ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 4000, aproveitamentoPct: 100 })
  const A = await insumo(ger.p, { nome: `TESTE Azeite ${SUF}`, unidadeCompra: 'l', quantidadeCompra: 1, custoCompraCentavos: 6000, aproveitamentoPct: 100 })
  const T85 = await insumo(ger.p, { nome: `TESTE Tomate 85 ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 800, aproveitamentoPct: 85 })
  const CX = await insumo(ger.p, { nome: `TESTE Leite Caixa ${SUF}`, unidadeCompra: 'caixa', quantidadeCompra: 1, basePorUnidade: 12000, unidadeBase: 'ml', custoCompraCentavos: 6000, aproveitamentoPct: 100 })
  const M = await insumo(ger.p, { nome: `TESTE Molho ${SUF}`, unidadeCompra: 'g', quantidadeCompra: 1, unidadeBase: 'g', custoCompraCentavos: 0, aproveitamentoPct: 100, preparado: true, rendimentoBase: 400, componentes: [{ componenteId: T, quantidadeBase: 500 }, { componenteId: A, quantidadeBase: 50 }] })
  const ins = Object.fromEntries((await insumos()).map((i) => [i.id, i]))
  ok('kg → g: tomate R$ 8,00/kg = 0,8 c/g', Math.abs(ins[T].custoPorBase - 0.8) < 1e-9 && ins[T].unidadeBase === 'g')
  ok('pacote com 24: pão R$ 24,00 = 100 c/un', ins[P].custoPorBase === 100 && ins[P].unidadeBase === 'un')
  ok('L → ml: azeite R$ 60,00/L = 6 c/ml; caixa com 12 L = 0,5 c/ml', ins[A].custoPorBase === 6 && ins[CX].custoPorBase === 0.5 && ins[CX].unidadeBase === 'ml')
  ok('aproveitamento 85% encarece (0,8 ÷ 0,85)', Math.abs(ins[T85].custoPorBase - 0.8 / 0.85) < 1e-9)
  ok('sub-receita: molho (500 g tomate + 50 ml azeite, rende 400 g) = 1,75 c/g', Math.abs(ins[M].custoPorBase - 1.75) < 1e-9 && ins[M].preparado)
  const dup = await api(ger.p, '/api/admin/financeiro/cmv/insumos', 'POST', { nome: `TESTE Tomate ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 1, aproveitamentoPct: 100 })
  ok('nome repetido é recusado', dup.s === 409)

  secao('Parte 2. Fichas: exemplos, tamanhos, pizza meio a meio, adicional, importar da ficha de preparo')
  const fb = await ficha(ger.p, 'item', BURGER, [{ insumoId: T, quantidadeBase: 30 }, { insumoId: C, quantidadeBase: 120 }, { insumoId: P, quantidadeBase: 1 }, { insumoId: Q, quantidadeBase: 40 }, { insumoId: E, quantidadeBase: 1 }])
  await ficha(ger.p, 'complemento', BACON, [{ insumoId: B, quantidadeBase: 30 }])
  await ficha(ger.p, 'tamanho', ACAI_P, [{ insumoId: CX, quantidadeBase: 1500 }]) // 750 c de 1000 → margem 25% (baixa)
  await ficha(ger.p, 'tamanho', ACAI_G, [{ insumoId: CX, quantidadeBase: 1600 }]) // 800 c de 1600 → 50%
  await ficha(ger.p, 'sabor', CALA, [{ insumoId: C, quantidadeBase: 375 }], TAM_M) // 1200 c
  await ficha(ger.p, 'sabor', FRANGO, [{ insumoId: Q, quantidadeBase: 400 }], TAM_M) // 1600 c
  ok('ficha salva', fb.s === 200, texto(fb.j))
  const l1 = await lista()
  const lb = linhaDe(l1, `item:${BURGER}:`)
  ok('exemplo conferido à mão: CMV R$ 7,48, lucro R$ 17,52, margem 70,08%', lb?.custoCentavos === 748 && lb.lucroCentavos === 1752 && lb.margemPct.toFixed(2) === '70.08', texto(lb && [lb.custoCentavos, lb.lucroCentavos, lb.margemPct]))
  const lp = linhaDe(l1, `tamanho:${ACAI_P}:`), lg = linhaDe(l1, `tamanho:${ACAI_G}:`)
  ok('tamanhos: ficha por tamanho (P R$ 7,50 / G R$ 8,00)', lp?.custoCentavos === 750 && lg?.custoCentavos === 800, texto([lp?.custoCentavos, lg?.custoCentavos]))
  ok('margem baixa (< 30%) destacada no P', lp?.margemBaixa === true && lg?.margemBaixa === false)
  const ls = linhaDe(l1, `item:${SEMFICHA}:`)
  ok('item sem ficha aparece como "sem ficha"', ls?.temFicha === false && ls.custoCentavos === null)
  ok('pizza: uma linha por sabor × tamanho, com o custo da ficha', linhaDe(l1, `sabor:${CALA}:${TAM_M}`)?.custoCentavos === 1200 && linhaDe(l1, `sabor:${FRANGO}:${TAM_M}`)?.custoCentavos === 1600)
  ok('resumo: com ficha × sem ficha e margem média', l1.resumo.comFicha >= 5 && l1.resumo.semFicha >= 1 && typeof l1.resumo.margemMediaPct === 'number', texto(l1.resumo))
  const imp = await api(ger.p, `/api/admin/financeiro/cmv/ficha/importar?itemId=${BURGER}`)
  ok('importar da ficha de preparo: casa o insumo pelo nome e lê "30 g"; o resto fica para cadastrar', imp.s === 200 && imp.j.ingredientes.some((x) => x.insumoId === T && x.quantidadeBase === 30) && imp.j.ingredientes.some((x) => !x.insumoId), texto(imp.j))
  const prep = await um(`select ingredientes from fichas_preparo where item_id=$1`, [BURGER])
  ok('a ficha de preparo continua só com nome e quantidade (nenhum custo)', !JSON.stringify(prep.ingredientes).match(/custo|preco|centavos/i))

  secao('Parte 5. Custo guardado na venda')
  const pedido = async (itens) => semSessao(`/api/loja/${SLUG}/pedido`, 'POST', { tipo: 'retirada', cliente: { nome: 'TESTE CMV', telefone: '27999990055' }, pagamento: 'pix', trocoPara: null, endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' }, itens })
  const pd = await pedido([{ itemId: BURGER, quantidade: 2, observacao: '', complementos: [`TESTE Bacon ${SUF}`] }, { itemId: PIZZA, quantidade: 1, observacao: '', complementos: [], tamanhoNome: `TESTE M ${SUF}`, saborNome: 'TESTE Calabresa / TESTE Frango' }, { itemId: ACAI, quantidade: 1, observacao: '', complementos: [], tamanhoNome: 'G' }, { itemId: SEMFICHA, quantidade: 1, observacao: '', complementos: [] }])
  ok('pedido da vitrine entra normalmente', pd.s === 201, `${pd.s} ${pd.j?.error ?? ''}`)
  const custos = await q(`select pi.item_id, pc.situacao, pc.custo_unitario::float c, pc.custo_unitario_centavos::int cc from pedido_itens pi join pedido_itens_custo pc on pc.pedido_item_id=pi.id where pi.pedido_id=$1`, [pd.j?.id])
  const cDe = (id) => custos.find((x) => x.item_id === id)
  ok('burger + bacon: custo guardado = 748 + 120 = R$ 8,68', cDe(BURGER)?.cc === 868 && cDe(BURGER)?.situacao === 'ok', texto(cDe(BURGER)))
  ok('pizza meio a meio: 1/2 de cada sabor no tamanho M = R$ 14,00', cDe(PIZZA)?.cc === 1400, texto(cDe(PIZZA)))
  ok('tamanho G: ficha do tamanho (R$ 8,00)', cDe(ACAI)?.cc === 800)
  ok('produto sem ficha: venda entra "sem custo" (sem_ficha)', cDe(SEMFICHA)?.situacao === 'sem_ficha' && cDe(SEMFICHA)?.cc === null)
  const v1 = (await api(dono.p, '/api/admin/financeiro/cmv/vendas')).j
  // Muda o custo da carne: recalcula a ficha, grava histórico; venda antiga não muda.
  const precoAntes = Number((await um(`select preco from itens_cardapio where id=$1`, [BURGER])).preco)
  const mud = await api(ger.p, `/api/admin/financeiro/cmv/insumos/${C}`, 'PATCH', { acao: 'editar', nome: `TESTE Carne ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 4000, aproveitamentoPct: 100, motivo: 'TESTE reajuste do fornecedor' })
  ok('mudar o custo de um insumo', mud.s === 200, texto(mud.j))
  const l2 = await lista()
  ok('recalcula TODOS os itens que usam o insumo (burger e pizza calabresa)', linhaDe(l2, `item:${BURGER}:`)?.custoCentavos === 844 && linhaDe(l2, `sabor:${CALA}:${TAM_M}`)?.custoCentavos === 1500, texto([linhaDe(l2, `item:${BURGER}:`)?.custoCentavos, linhaDe(l2, `sabor:${CALA}:${TAM_M}`)?.custoCentavos]))
  const hist = (await api(dono.p, `/api/admin/financeiro/cmv/insumos/${C}`)).j?.historico ?? []
  ok('histórico: antigo, novo, quem, quando e motivo', hist[0]?.custo_antigo_centavos === 3200 && hist[0]?.custo_novo_centavos === 4000 && hist[0]?.usuario_nome && /reajuste/.test(hist[0]?.motivo ?? ''), texto(hist[0]))
  ok('venda antiga NÃO muda (custo guardado)', (await um(`select pc.custo_unitario_centavos::int cc from pedido_itens pi join pedido_itens_custo pc on pc.pedido_item_id=pi.id where pi.pedido_id=$1 and pi.item_id=$2`, [pd.j?.id, BURGER])).cc === 868)
  const v2 = (await api(dono.p, '/api/admin/financeiro/cmv/vendas')).j
  ok('CMV do período igual antes e depois da mudança de custo', v1.cmvCentavos === v2.cmvCentavos && v1.cmvCentavos > 0, `${v1.cmvCentavos} × ${v2.cmvCentavos}`)
  ok('vendas antigas sem custo guardado contam como "sem custo registrado"', v2.semCustoRegistrado >= 1, String(v2.semCustoRegistrado))
  ok('o preço NÃO mudou sozinho com o custo', Number((await um(`select preco from itens_cardapio where id=$1`, [BURGER])).preco) === precoAntes)
  // Falha no cálculo (sub-receita em ciclo, criada direto no banco): o pedido entra e o item fica "erro".
  const X = await um(`insert into cmv_insumos (restaurante_id, nome, unidade_compra, unidade_base, preparado, rendimento_base) values ($1,$2,'g','g',true,1) returning id`, [loja.id, `TESTE Ciclo X ${SUF}`])
  const Y = await um(`insert into cmv_insumos (restaurante_id, nome, unidade_compra, unidade_base, preparado, rendimento_base) values ($1,$2,'g','g',true,1) returning id`, [loja.id, `TESTE Ciclo Y ${SUF}`])
  insumoIds.push(X.id, Y.id)
  await db.query(`insert into cmv_insumo_componentes values ($1,$2,1), ($2,$1,1)`, [X.id, Y.id])
  const fx = await um(`insert into cmv_fichas (restaurante_id, alvo_tipo, alvo_id, item_id) values ($1,'item',$2,$2) returning id`, [loja.id, ERRO])
  await db.query(`insert into cmv_ficha_componentes values ($1,$2,1)`, [fx.id, X.id])
  const pe = await pedido([{ itemId: ERRO, quantidade: 1, observacao: '', complementos: [] }])
  const ce = await um(`select pc.situacao, pc.erro from pedido_itens pi join pedido_itens_custo pc on pc.pedido_item_id=pi.id where pi.pedido_id=$1`, [pe.j?.id])
  ok('cálculo do custo falhou: o pedido entra normalmente e o item fica "erro" (registrado)', pe.s === 201 && ce?.situacao === 'erro' && /subreceita/.test(ce?.erro ?? ''), `${pe.s} ${texto(ce)}`)
  await db.query(`delete from cmv_insumo_componentes where insumo_id in ($1,$2)`, [X.id, Y.id])

  secao('Parte 3/4. Lista, filtros, sugestão de preço e "Aplicar novo preço"')
  const cfg = await api(ger.p, '/api/admin/financeiro/cmv/config', 'PUT', { margemAlvoPct: 65, margemBaixaPct: 30, custosVariaveisPct: 5, arredondamento: '90', porCategoria: {} })
  ok('margem-alvo 65%, custos variáveis 5%, arredondar para ,90', cfg.s === 200)
  const l3 = await lista()
  const b3 = linhaDe(l3, `item:${BURGER}:`)
  ok('sugestão = 844 ÷ (1 − 0,65 − 0,05) = R$ 28,13 → R$ 28,90', b3?.sugestaoCentavos === 2890, String(b3?.sugestaoCentavos))
  const cfgCat = await api(ger.p, '/api/admin/financeiro/cmv/config', 'PUT', { margemAlvoPct: 65, margemBaixaPct: 30, custosVariaveisPct: 5, arredondamento: '00', porCategoria: { [grupo.id]: 50 } })
  const b4 = linhaDe(await lista(), `item:${BURGER}:`)
  ok('margem-alvo por categoria (50%) e arredondamento ,00: 844 ÷ 0,45 = 18,76 → R$ 19,00', cfgCat.s === 200 && b4?.margemAlvoPct === 50 && b4?.sugestaoCentavos === 1900, texto(b4 && [b4.margemAlvoPct, b4.sugestaoCentavos]))
  await api(ger.p, '/api/admin/financeiro/cmv/config', 'PUT', { margemAlvoPct: 65, margemBaixaPct: 30, custosVariaveisPct: 5, arredondamento: '90', porCategoria: { [grupo.id]: null } })
  const velho = await api(ger.p, '/api/admin/financeiro/cmv/preco', 'POST', { alvo: { tipo: 'item', id: BURGER }, precoAtualCentavos: 9999, novoCentavos: 2890 })
  af('aplicar com "preço atual" manipulado/antigo → 409 (nada muda)', velho.s === 409 && Number((await um(`select preco from itens_cardapio where id=$1`, [BURGER])).preco) === 25)
  const zero = await api(ger.p, '/api/admin/financeiro/cmv/preco', 'POST', { alvo: { tipo: 'item', id: BURGER }, precoAtualCentavos: 2500, novoCentavos: 0 })
  af('preço novo inválido (0) → 400', zero.s === 400)
  const apl = await api(ger.p, '/api/admin/financeiro/cmv/preco', 'POST', { alvo: { tipo: 'item', id: BURGER }, precoAtualCentavos: 2500, novoCentavos: 2890 })
  ok('"Aplicar novo preço": antigo R$ 25,00 → novo R$ 28,90', apl.s === 200 && apl.j?.antigoCentavos === 2500 && apl.j?.novoCentavos === 2890)
  ok('preço no cardápio (PDV/mesas leem daqui) = R$ 28,90', Number((await um(`select preco from itens_cardapio where id=$1`, [BURGER])).preco) === 28.9)
  const aud = await um(`select dados from eventos_auditoria where restaurante_id=$1 and acao='cmv.preco_aplicado' and entidade_id=$2 order by criado_em desc limit 1`, [loja.id, BURGER])
  ok('aplicação auditada com antigo e novo', aud?.dados?.antigoCentavos === 2500 && aud?.dados?.novoCentavos === 2890, texto(aud?.dados))
  // A vitrine carrega o cardápio no navegador: abre a página e procura o produto com o preço novo.
  const cli = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR' })
  const vp = await cli.newPage()
  await vp.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
  const temNovo = await vp.waitForFunction((n) => { const el = [...document.querySelectorAll('[data-item-id]')].find((e) => e.textContent.includes(n)); return !!el && /28,90/.test(el.textContent) }, `TESTE Burger CMV ${SUF}`, { timeout: 15000 }).then(() => true, () => false)
  ok('vitrine mostra o preço novo', temNovo)
  await cli.close()
  const pd2 = await pedido([{ itemId: BURGER, quantidade: 1, observacao: '', complementos: [] }])
  ok('pedido novo já sai com o preço novo', Number((await um(`select preco_unitario from pedido_itens where pedido_id=$1`, [pd2.j?.id])).preco_unitario) === 28.9)
  const tamApl = await api(ger.p, '/api/admin/financeiro/cmv/preco', 'POST', { alvo: { tipo: 'tamanho', id: ACAI_P }, precoAtualCentavos: 1000, novoCentavos: 2490 })
  const pizApl = await api(ger.p, '/api/admin/financeiro/cmv/preco', 'POST', { alvo: { tipo: 'sabor', id: CALA, tamanhoId: TAM_M }, precoAtualCentavos: 4000, novoCentavos: 4290 })
  ok('aplicar preço de um tamanho e de sabor × tamanho da pizza', tamApl.s === 200 && pizApl.s === 200 && Number((await um(`select preco from tamanhos_item where id=$1`, [ACAI_P])).preco) === 24.9 && Number((await um(`select preco from pizza_sabor_precos where sabor_id=$1 and tamanho_padrao_id=$2`, [CALA, TAM_M])).preco) === 42.9)
  const csv = await api(dono.p, '/api/admin/financeiro/cmv/exportar')
  ok('CSV da precificação (BOM, ";", "Sem ficha de custo", auditado)', csv.s === 200 && csv.t.charCodeAt(0) === 0xFEFF && csv.t.includes('Produto;Variação;Categoria') && csv.t.includes('Sem ficha de custo') && !!(await um(`select 1 from eventos_auditoria where restaurante_id=$1 and acao='cmv.exportou' order by criado_em desc limit 1`, [loja.id])))

  secao('Antifraude')
  const gar = await logar('garcom.finint')
  for (const [nome, p] of [['garçom', gar.p], ['caixa (atendente)', ate.p]]) {
    const r1 = await api(p, '/api/admin/financeiro/cmv'), r2 = await api(p, '/api/admin/financeiro/cmv/insumos'), r3 = await api(p, `/api/admin/financeiro/cmv/ficha?tipo=item&id=${BURGER}`), r4 = await api(p, '/api/admin/financeiro/cmv/vendas')
    af(`${nome} lendo custos pela API → bloqueado (lista, insumos, ficha, CMV)`, [r1, r2, r3, r4].every((r) => [401, 403, 404].includes(r.s) && !JSON.stringify(r.j ?? {}).includes('custoCentavos')), [r1.s, r2.s, r3.s, r4.s].join(','))
  }
  await gar.ctx.close()
  const motoLogin = (await um(`select usuario from usuarios where restaurante_id=$1 and papel='entregador' order by criado_em desc limit 1`, [loja.id]))?.usuario
  if (motoLogin) {
    const mo = await logar(motoLogin, { viewport: { width: 390, height: 844 } }, 'moto-teste-8421')
    af('motoboy lendo custos → bloqueado', [401, 403, 404].includes((await api(mo.p, '/api/admin/financeiro/cmv')).s))
    await mo.ctx.close()
  }
  const acG = (await um(`select acessos from usuarios where usuario='gerente.finint'`)).acessos
  await db.query(`update usuarios set acessos=$1 where usuario='gerente.finint'`, [JSON.stringify({ areas: ['pedidos', 'financeiro'], sensiveis: ['financeiro', 'custos_ver', 'custos_editar'] })])
  const semAplicar = await api(ger.p, '/api/admin/financeiro/cmv/preco', 'POST', { alvo: { tipo: 'item', id: BURGER }, precoAtualCentavos: 2890, novoCentavos: 3090 })
  af('aplicar preço SEM a permissão própria → 403 (preço intacto)', semAplicar.s === 403 && Number((await um(`select preco from itens_cardapio where id=$1`, [BURGER])).preco) === 28.9)
  await db.query(`update usuarios set acessos=$1 where usuario='gerente.finint'`, [JSON.stringify({ areas: ['pedidos', 'financeiro'], sensiveis: ['financeiro', 'custos_ver'] })])
  af('editar insumo SEM "editar insumos" → 403', (await api(ger.p, `/api/admin/financeiro/cmv/insumos/${T}`, 'PATCH', { acao: 'ativar', ativo: false })).s === 403)
  await db.query(`update usuarios set acessos=$1 where usuario='gerente.finint'`, [acG === null ? null : JSON.stringify(acG)])
  const sbServ = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const hUp = await sbServ.from('cmv_custos_historico').update({ custo_novo_centavos: 1 }).eq('insumo_id', C).select('id')
  const hDel = await sbServ.from('cmv_custos_historico').delete().eq('insumo_id', C).select('id')
  af('editar/apagar o histórico de custos (até com o acesso do servidor) → recusado', !!hUp.error && !!hDel.error)
  if (viz) {
    const iv = await um(`insert into cmv_insumos (restaurante_id, nome, unidade_compra, unidade_base, custo_compra_centavos) values ($1,$2,'kg','g',100) returning id`, [viz.id, `TESTE Vizinha ${SUF}`])
    insumoIds.push(iv.id)
    const g1 = await api(dono.p, `/api/admin/financeiro/cmv/insumos/${iv.id}`), g2 = await api(dono.p, `/api/admin/financeiro/cmv/insumos/${iv.id}`, 'PATCH', { acao: 'ativar', ativo: false })
    const g3 = await ficha(dono.p, 'item', BURGER, [{ insumoId: iv.id, quantidadeBase: 1 }])
    af('insumo de OUTRA loja pelo ID → 404 (ler, editar, usar na ficha)', g1.s === 404 && g2.s === 404 && g3.s === 404, [g1.s, g2.s, g3.s].join(','))
  }
  const manip = await api(ger.p, '/api/admin/financeiro/cmv/insumos', 'POST', { nome: `TESTE Manipulado ${SUF}`, unidadeCompra: 'kg', quantidadeCompra: 1, custoCompraCentavos: 100, aproveitamentoPct: 100, restaurante_id: viz?.id, restauranteId: viz?.id, custoPorBase: 0 })
  if (manip.j?.id) insumoIds.push(manip.j.id)
  const mi = manip.j?.id ? await um(`select restaurante_id from cmv_insumos where id=$1`, [manip.j.id]) : null
  af('loja e custo no corpo são ignorados (insumo cai na loja da sessão, custo calculado)', manip.s === 201 && mi?.restaurante_id === loja.id && Math.abs((await insumos()).find((i) => i.id === manip.j.id)?.custoPorBase - 0.1) < 1e-9)
  af('sem sessão → 401', (await semSessao('/api/admin/financeiro/cmv')).s === 401)
  for (const m of ['DELETE']) af(`${m} em insumo (não existe exclusão) → 405`, (await api(dono.p, `/api/admin/financeiro/cmv/insumos/${T}`, m)).s === 405)

  secao('Tela: desktop e celular')
  await dono.p.goto(`${BASE}/admin/financeiro?secao=cmv`, { waitUntil: 'networkidle' })
  await dono.p.getByTestId('cmv-tabela').waitFor({ timeout: 15000 })
  // O checklist de configuração da loja (modal do dono) aparece por cima depois de uns segundos: fecha.
  await dono.p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 4000 }).catch(() => {})
  await dono.p.getByTestId('cmv-busca').fill(`CMV ${SUF}`)
  ok('lista: burger com custo, margem e sugestão; "Sem ficha" destacado', await dono.p.locator(`[data-testid="cmv-linha"][data-chave="item:${BURGER}:"]`).isVisible() && (await dono.p.getByTestId('cmv-sem-ficha-selo').count()) === 0)
  await dono.p.getByTestId('cmv-busca').fill(`Sem Ficha ${SUF}`)
  ok('busca + "Sem ficha"', (await dono.p.getByTestId('cmv-sem-ficha-selo').count()) === 1)
  await dono.p.getByTestId('cmv-busca').fill('')
  await dono.p.getByTestId('cmv-filtro-margem-baixa').click()
  const nBaixa = (await lista()).resumo.margemBaixa
  ok('filtro margem baixa: mesma contagem do resumo, todas abaixo de 30%', (await dono.p.getByTestId('cmv-linha').count()) === nBaixa && (await dono.p.getByTestId('cmv-margem').allInnerTexts()).every((t) => Number(t.replace('%', '').replace(',', '.')) < 30), `${await dono.p.getByTestId('cmv-linha').count()} × ${nBaixa}`)
  await dono.p.getByTestId('cmv-filtro-margem-baixa').click()
  await dono.p.getByTestId('cmv-busca').fill(`Burger CMV ${SUF}`)
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'depois-precificacao-desktop.png') })
  await dono.p.getByTestId('cmv-abrir-ficha').first().click()
  await dono.p.getByTestId('ficha-componente').first().waitFor()
  ok('ficha: componentes com custo e CMV/lucro/margem', (await dono.p.getByTestId('ficha-componente').count()) === 5 && /8,44/.test(await dono.p.getByTestId('ficha-cmv').innerText()))
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'depois-ficha-desktop.png') })
  await dono.p.keyboard.press('Escape')
  const cel = await logar('dono.finint', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await cel.p.goto(`${BASE}/admin/financeiro?secao=cmv`, { waitUntil: 'networkidle' })
  await cel.p.getByTestId('cmv-cartao').first().waitFor({ timeout: 15000 })
  await cel.p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 4000 }).catch(() => {})
  ok('celular: lista em cartões, sem rolagem lateral', (await cel.p.getByTestId('cmv-cartao').count()) > 0 && await cel.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await cel.p.getByTestId('cmv-busca').fill(`Burger CMV ${SUF}`)
  if (PRINTS) await cel.p.screenshot({ path: join(PRINTS, 'depois-precificacao-celular.png') })
  await cel.p.getByTestId('cmv-cartao').first().tap()
  await cel.p.getByTestId('ficha-custo').waitFor()
  ok('celular: ficha em tela cheia', (await cel.p.getByTestId('ficha-custo').evaluate((e) => Math.round(e.getBoundingClientRect().width))) === 390)
  if (PRINTS) await cel.p.screenshot({ path: join(PRINTS, 'depois-ficha-celular.png') })
  await cel.ctx.close()
} catch (e) {
  ok('fluxo sem erro', false, String(e?.stack ?? e).slice(0, 500))
} finally {
  // Limpeza TESTE: produtos apagados (fichas e custo guardado vão junto), tamanho de pizza de teste, insumos desativados.
  await db.query(`update pedidos set status='cancelado', cancelado_motivo='teste', cancelado_em=now() where restaurante_id=$1 and cliente_nome='TESTE CMV' and status <> 'cancelado'`, [loja.id]).catch(() => {})
  await db.query(`delete from fichas_preparo where item_id = any($1)`, [criados.itens]).catch(() => {})
  await db.query(`delete from cmv_fichas where restaurante_id=$1 and (item_id = any($2) or alvo_id = any($2))`, [loja.id, criados.itens]).catch(() => {})
  await db.query(`delete from itens_cardapio where id = any($1)`, [criados.itens]).catch((e) => console.log('limpeza itens:', e.message))
  await db.query(`delete from tamanhos_padrao_pizza where id = any($1)`, [criados.tamPizza]).catch(() => {})
  await db.query(`update cmv_insumos set ativo=false where id = any($1)`, [insumoIds]).catch(() => {})
  await browser.close()
  await db.end()
}
const falhas = res.filter((x) => !x).length
if (antifraude.length) { console.log('\nAntifraude:'); for (const [n, c] of antifraude) console.log(`  ${c ? 'OK ' : 'FALHOU'}  ${n}`) }
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
