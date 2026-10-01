/**
 * E2E — Cadastro de produto repaginado + hover do Cardápio (2026-10-01). Stack local, loja
 * cantina-e2e (dono.e2e). Cria a categoria "TESTE Repaginação" com 4 produtos (simples,
 * açaí com volumes, pizza com sabores × tamanhos, combo com complementos) e:
 *   · compara CAMPO A CAMPO (item, tamanhos, sabores e preços, grupos, opções, ficha, custo)
 *     antes e depois de abrir o modal e cancelar, e depois de editar um campo e desfazer;
 *   · abas, rótulos flutuantes, Salvar só com alteração, aviso ao fechar com alteração;
 *   · promoção: interruptor, agenda (dias/horas) valendo na lista e no preço do servidor;
 *   · custo e códigos (só gestor; visitante não lê); margem na aba Custo; foto extra;
 *   · produto novo: salva e continua aberto para complementos;
 *   · hover de categoria e produto (alça, ⋮, ações, elevação) e toque (sempre à vista);
 *   · desktop, tablet e celular.
 * No fim apaga só o que criou (categoria e itens TESTE Rep).
 *
 *   node scripts/seguranca/e2e-produto-repaginado.mjs [prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'cantina-e2e'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL, API_URL, ANON_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const foto = async (p, nome, full = false) => { if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome}.png`), fullPage: full }) }

const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
// ── semente ──────────────────────────────────────────────────────────────────
await db.query(`delete from itens_cardapio where restaurante_id=$1 and nome like 'TESTE Rep%'`, [loja.id])
await db.query(`delete from grupos_cardapio where restaurante_id=$1 and nome='TESTE Repaginação'`, [loja.id])
const grupo = await um(`insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1,'TESTE Repaginação',0) returning id`, [loja.id])
const item = (nome, extra = '') => um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, status, tipo_item ${extra ? ',' + extra.split('|')[0] : ''})
  values ($1,$2,$3,'**Pão** brioche e molho da casa',$4,'disponivel',$5 ${extra ? ',' + extra.split('|')[1] : ''}) returning id`, [loja.id, grupo.id, ...arguments[2]])
const simples = await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, promocao_preco, status, tipo_item, dias_disponiveis, novidade_ate, serve_pessoas, disponivel_salao, posicao)
  values ($1,$2,'TESTE Rep Simples','**Pão** brioche e molho da casa',20,18,'disponivel','simples','{1,2,3,4,5}', now() + interval '20 days', 2, false, 0) returning id`, [loja.id, grupo.id])
await db.query(`insert into fichas_preparo (item_id, restaurante_id, ingredientes, passos, tempo_min) values ($1,$2,'Pão, carne','Grelhar',8)`, [simples.id, loja.id]).catch(() => {})
await db.query(`insert into itens_cardapio_gestao (item_id, restaurante_id, preco_custo, codigo_pdv, codigo_interno) values ($1,$2,8,'PDV-01',null)`, [simples.id, loja.id])
const acai = await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, status, tipo_item, posicao) values ($1,$2,'TESTE Rep Açaí','Açaí puro',0,'disponivel','simples',1) returning id`, [loja.id, grupo.id])
await db.query(`insert into tamanhos_item (item_id, nome, preco, posicao) values ($1,'300 ml',15,0),($1,'500 ml',22,1)`, [acai.id])
const pizza = await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, status, tipo_item, posicao) values ($1,$2,'TESTE Rep Pizza','Pizza da casa',0,'disponivel','pizza',2) returning id`, [loja.id, grupo.id])
const tam = await q(`select id from tamanhos_padrao_pizza where restaurante_id=$1 order by posicao limit 2`, [loja.id])
for (const [i, nome] of ['Calabresa', 'Mussarela'].entries()) {
  const s = await um(`insert into pizza_sabores (item_id, nome, posicao) values ($1,$2,$3) returning id`, [pizza.id, nome, i])
  for (const [j, t] of tam.entries()) await db.query(`insert into pizza_sabor_precos (sabor_id, tamanho_padrao_id, preco) values ($1,$2,$3)`, [s.id, t.id, 40 + 10 * j + i])
}
const combo = await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, status, tipo_item, posicao, mais_vendido) values ($1,$2,'TESTE Rep Combo','Lanche + bebida',35,'disponivel','simples',3,true) returning id`, [loja.id, grupo.id])
const gb = await um(`insert into grupos_item_complementos (item_id, nome, obrigatorio, min_escolhas, max_escolhas, posicao) values ($1,'Bebida',true,1,1,0) returning id`, [combo.id])
await db.query(`insert into item_complementos (item_id, nome, preco, posicao, grupo_id) values ($1,'Coca',0,0,$2),($1,'Suco',3,1,$2)`, [combo.id, gb.id])
const PRODUTOS = { simples, acai, pizza, combo }
void item

/** Tudo que o produto tem no banco, para comparar campo a campo. */
async function retrato(id) {
  return um(`select to_jsonb(i) as item,
      (select coalesce(jsonb_agg(to_jsonb(t) order by t.posicao, t.nome), '[]') from tamanhos_item t where t.item_id=i.id) tamanhos,
      (select coalesce(jsonb_agg(jsonb_build_object('s', to_jsonb(s), 'p', (select coalesce(jsonb_agg(to_jsonb(pp) order by pp.tamanho_padrao_id), '[]') from pizza_sabor_precos pp where pp.sabor_id=s.id)) order by s.posicao), '[]') from pizza_sabores s where s.item_id=i.id) sabores,
      (select coalesce(jsonb_agg(to_jsonb(g) order by g.posicao), '[]') from grupos_item_complementos g where g.item_id=i.id) grupos,
      (select coalesce(jsonb_agg(to_jsonb(c) order by c.posicao, c.nome), '[]') from item_complementos c where c.item_id=i.id) complementos,
      (select to_jsonb(f) - 'atualizado_em' from fichas_preparo f where f.item_id=i.id) ficha,
      (select to_jsonb(gg) - 'atualizado_em' from itens_cardapio_gestao gg where gg.item_id=i.id) gestao
    from itens_cardapio i where i.id=$1`, [id])
}
function diferencas(a, b, prefixo = '') {
  const out = []
  const chaves = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  for (const k of chaves) {
    const x = a?.[k], y = b?.[k]
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x)) out.push(...diferencas(x, y, `${prefixo}${k}.`))
    else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${prefixo}${k}`)
  }
  return out
}

const browser = await chromium.launch()
async function logar(viewport = { width: 1366, height: 860 }, extra = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR', ...extra })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.e2e@local.test')
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  const b = p.getByRole('button', { name: /OK, entendi/ }).first()
  await b.waitFor({ timeout: 3000 }).catch(() => {})
  if (await b.isVisible().catch(() => false)) await b.click()
  return { ctx, p }
}
const linhaProduto = (p, nome) => p.locator('[data-testid="produto-linha"]', { hasText: nome })
async function abrirCategoria(p) {
  await p.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' })
  await p.locator('[data-testid="categoria-linha"]', { hasText: 'TESTE Repaginação' }).locator('button').filter({ hasText: 'TESTE Repaginação' }).first().click()
  await espera(500)
}
async function abrirProduto(p, nome) {
  const l = linhaProduto(p, nome)
  await l.hover()
  await l.getByTestId('produto-editar').click()
  await p.getByTestId('modal-produto').waitFor()
  await espera(600) // custo/códigos chegam depois
}
const opacidade = (loc) => loc.evaluate((el) => getComputedStyle(el).opacity)

try {
  const { p } = await logar()
  p.on('console', (m) => { if (m.type() === 'error' && /foto extra/.test(m.text())) console.log('   [console]', m.text()) })
  await abrirCategoria(p)

  secao('1. Hover da lista (mouse)')
  const cat = p.locator('[data-testid="categoria-linha"]').filter({ hasNotText: 'TESTE Repaginação' }).first()
  await p.mouse.move(5, 5)
  await espera(250)
  ok('categoria sem hover: alça e ⋮ escondidos', (await opacidade(cat.getByTestId('categoria-alca'))) === '0' && (await opacidade(cat.locator('.cat-acoes'))) === '0')
  const fundoAntes = await cat.evaluate((el) => getComputedStyle(el).backgroundColor)
  await cat.hover()
  await espera(300)
  ok('categoria no hover: fundo destacado, alça e ⋮ aparecem', (await opacidade(cat.getByTestId('categoria-alca'))) === '1' && (await opacidade(cat.locator('.cat-acoes'))) === '1' && (await cat.evaluate((el) => getComputedStyle(el).backgroundColor)) !== fundoAntes)
  ok('categoria no hover: barra à esquerda colorida', (await cat.evaluate((el) => getComputedStyle(el).borderLeftColor)) !== 'rgba(0, 0, 0, 0)')
  ok('transição de 150 ms', /0\.15s/.test(await cat.evaluate((el) => getComputedStyle(el).transitionDuration)))
  await cat.getByTestId('categoria-menu').click()
  ok('⋮ abre o menu de ações da categoria', (await p.getByTestId('categoria-menu-lista').count()) === 1 && /Editar nome e foto/.test(await p.getByTestId('categoria-menu-lista').innerText()))
  await foto(p, '30-hover-categoria-menu')
  await p.mouse.click(700, 20)
  ok('clique fora fecha o menu', (await p.getByTestId('categoria-menu-lista').count()) === 0)
  const lp = linhaProduto(p, 'TESTE Rep Simples')
  await p.mouse.move(5, 5)
  await espera(250)
  ok('produto sem hover: ações escondidas', (await opacidade(lp.getByTestId('produto-acoes'))) === '0')
  await lp.hover()
  await espera(300)
  ok('produto no hover: ações aparecem e linha destaca', (await opacidade(lp.getByTestId('produto-acoes'))) === '1' && /inset/.test(await lp.evaluate((el) => getComputedStyle(el).boxShadow)))
  await foto(p, '31-hover-produto-tabela')
  await p.getByTitle('Grade').click()
  const card = p.locator('[data-testid="produto-cartao"]', { hasText: 'TESTE Rep Combo' })
  await card.hover()
  await espera(300)
  ok('cartão no hover: elevação (sombra + sobe) e ações', (await card.evaluate((el) => getComputedStyle(el).transform)) !== 'none' && (await opacidade(card.getByTestId('produto-acoes'))) === '1')
  await foto(p, '32-hover-produto-cartao')
  await p.getByTitle('Tabela').click()

  secao('2. Comparação campo a campo (abrir e cancelar não grava)')
  const antes = {}
  for (const [k, v] of Object.entries(PRODUTOS)) antes[k] = await retrato(v.id)
  for (const [k, nome] of [['simples', 'TESTE Rep Simples'], ['acai', 'TESTE Rep Açaí'], ['pizza', 'TESTE Rep Pizza'], ['combo', 'TESTE Rep Combo']]) {
    await abrirProduto(p, nome)
    const salvar = p.getByTestId('produto-salvar')
    ok(`${k}: Salvar desabilitado sem alteração`, await salvar.isDisabled())
    if (k === 'simples') {
      const abas = (await p.locator('[role="tab"][data-testid^="produto-aba-"]').allInnerTexts()).map((t) => t.trim().toLowerCase())
      ok('abas Informações · Complementos · Disponibilidade · Etiquetas · Ficha de preparo · Custo', JSON.stringify(abas) === JSON.stringify(['informações', 'complementos', 'disponibilidade', 'etiquetas', 'ficha de preparo', 'custo']), abas.join(' | '))
      ok('rótulos flutuantes nos campos', (await p.getByTestId('modal-produto').locator('.cf .cf-rotulo').count()) >= 6)
      ok('preço, promocional ligado e valor gravado', (await p.getByTestId('produto-preco').inputValue()) === '20,00' && (await p.getByTestId('produto-promo').inputValue()) === '18,00' && !(await p.getByTestId('produto-promo').isDisabled()))
      ok('custo e código vêm da tabela de gestão', (await p.getByTestId('produto-custo').inputValue()) === '8,00' && (await p.getByTestId('produto-codigo-pdv').inputValue()) === 'PDV-01')
      await foto(p, '33-modal-informacoes')
      for (const a of ['complementos', 'disponibilidade', 'etiquetas', 'ficha', 'custo']) {
        await p.getByTestId(`produto-aba-${a}`).click()
        await espera(300)
        await foto(p, `34-modal-${a}`)
      }
      ok('aba Custo mostra margem (20 − 8 = 60%)', /60%/.test(await p.getByTestId('margens').innerText()))
      await p.getByTestId('produto-aba-disponibilidade').click()
      ok('aba Disponibilidade: só delivery (salão desligado) preservado', (await p.getByTestId('produto-secao-disponibilidade').getByRole('checkbox').nth(1).isChecked()) === false)
      ok('nada mudou ao passear pelas abas', await salvar.isDisabled())
    }
    if (k === 'pizza') ok('pizza: tabela de sabores × tamanhos no modal', (await p.getByTestId('produto-tamanhos').count()) === 1)
    if (k === 'acai') ok('açaí: volumes no modal', /300 ml/.test((await p.getByTestId('produto-tamanhos').innerText()) + (await p.getByTestId('produto-tamanhos').locator('input').evaluateAll((els) => els.map((e) => e.value).join(' ')))))
    if (k === 'combo') {
      await p.getByTestId('produto-aba-complementos').click()
      ok('combo: grupo e opções na aba Complementos', /Bebida/.test(await p.getByTestId('produto-secao-complementos').innerText()))
      ok('combo: Destaque ligado (estrela)', (await p.getByTestId('produto-aba-info').click(), await p.getByRole('switch', { name: 'Destaque' }).getAttribute('aria-checked')) === 'true')
    }
    await p.getByTestId('produto-cancelar').click()
    ok(`${k}: Cancelar sem alteração fecha direto`, (await p.getByTestId('modal-produto').count()) === 0)
    const depois = await retrato(PRODUTOS[k].id)
    const dif = diferencas(antes[k], depois)
    ok(`${k}: banco idêntico campo a campo depois de abrir`, dif.length === 0, dif.join(', '))
  }

  secao('3. Editar um campo, salvar e desfazer: só ele muda')
  for (const [k, nome] of [['simples', 'TESTE Rep Simples'], ['acai', 'TESTE Rep Açaí'], ['pizza', 'TESTE Rep Pizza'], ['combo', 'TESTE Rep Combo']]) {
    await abrirProduto(p, nome)
    await p.getByTestId('produto-nome').fill(`${nome} X`)
    ok(`${k}: Salvar acende com a alteração`, !(await p.getByTestId('produto-salvar').isDisabled()))
    await p.getByTestId('produto-salvar').click()
    await p.getByTestId('modal-produto').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    const meio = await retrato(PRODUTOS[k].id)
    const dif = diferencas(antes[k], meio)
    ok(`${k}: só o nome mudou`, dif.length === 1 && dif[0] === 'item.nome', dif.join(', '))
    await abrirProduto(p, `${nome} X`)
    await p.getByTestId('produto-nome').fill(nome)
    await p.getByTestId('produto-salvar').click()
    await p.getByTestId('modal-produto').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    const fim = await retrato(PRODUTOS[k].id)
    const dif2 = diferencas(antes[k], fim)
    ok(`${k}: desfeito, idêntico ao original`, dif2.length === 0, dif2.join(', '))
  }

  secao('4. Fechar com alteração pergunta')
  await abrirProduto(p, 'TESTE Rep Simples')
  await p.getByTestId('produto-nome').fill('TESTE Rep Simples mudado')
  await p.getByTestId('produto-fechar').click()
  ok('aviso "Sair sem salvar?"', (await p.getByTestId('confirmar-descartar').count()) === 1)
  await foto(p, '35-modal-descartar')
  await p.getByTestId('descartar-voltar').click()
  ok('"Continuar editando" mantém o texto', (await p.getByTestId('produto-nome').inputValue()) === 'TESTE Rep Simples mudado')
  await p.keyboard.press('Escape').catch(() => {})
  await p.getByTestId('produto-cancelar').click()
  await p.getByTestId('descartar-sair').click()
  ok('"Sair sem salvar" fecha sem gravar', (await um(`select nome from itens_cardapio where id=$1`, [simples.id])).nome === 'TESTE Rep Simples')

  secao('5. Promoção, agenda e preço do servidor')
  const hojeDia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay()
  await abrirProduto(p, 'TESTE Rep Simples')
  await p.getByTestId('promo-agenda').getByRole('button').first().click()
  // Só o dia de amanhã: hoje a promoção NÃO vale.
  const amanha = (hojeDia + 1) % 7
  await p.getByTestId('promo-agenda').locator('button', { hasText: /^[DSTQ]$/ }).nth(amanha).click()
  await foto(p, '36-promo-agenda')
  await p.getByTestId('produto-salvar').click()
  await p.getByTestId('modal-produto').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  let row = await um(`select promocao_preco, promocao_dias from itens_cardapio where id=$1`, [simples.id])
  ok('agenda gravada (só amanhã) e preço promocional mantido', JSON.stringify(row.promocao_dias) === JSON.stringify([amanha]) && Number(row.promocao_preco) === 18, JSON.stringify(row))
  await abrirCategoria(p)
  const precoLista = await linhaProduto(p, 'TESTE Rep Simples').locator('td').nth(3).innerText()
  ok('fora da agenda, a lista mostra o preço cheio', /20,00/.test(precoLista) && !/18,00/.test(precoLista), precoLista.replace(/\n/g, ' '))
  const pedido = async () => {
    const r = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'retirada', cliente: { nome: 'TESTE Repag', telefone: '11912349901' }, endereco: {}, pagamento: 'pix', trocoPara: null, itens: [{ itemId: simples.id, quantidade: 1, observacao: '', complementos: [] }] }) })
    const j = await r.json().catch(() => ({}))
    const pi = j.pedidoId || j.id ? await um(`select preco_unitario from pedido_itens where pedido_id=$1`, [j.pedidoId ?? j.id]) : null
    return { st: r.status, j, preco: pi ? Number(pi.preco_unitario) : null }
  }
  let ped = await pedido()
  if (ped.preco !== null) ok('servidor cobra o preço cheio fora da agenda (R$ 20)', ped.preco === 20, JSON.stringify(ped.j).slice(0, 120))
  else ok('pedido de teste pela vitrine (servidor) — resposta', false, `${ped.st} ${JSON.stringify(ped.j).slice(0, 160)}`)
  await db.query(`update itens_cardapio set promocao_dias=$2 where id=$1`, [simples.id, [hojeDia]])
  ped = await pedido()
  if (ped.preco !== null) ok('dentro da agenda o servidor cobra a promoção (R$ 18)', ped.preco === 18, String(ped.preco))
  await db.query(`update itens_cardapio set promocao_dias=null where id=$1`, [simples.id])
  await db.query(`delete from pedido_itens where pedido_id in (select id from pedidos where restaurante_id=$1 and cliente_nome='TESTE Repag')`, [loja.id])
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_nome='TESTE Repag'`, [loja.id])
  // Interruptor Promocional desligado = sem promoção.
  await abrirProduto(p, 'TESTE Rep Simples')
  await p.getByRole('switch', { name: 'Promocional' }).click()
  ok('desligar "Promocional" trava o campo', await p.getByTestId('produto-promo').isDisabled())
  await p.getByTestId('produto-salvar').click()
  await p.getByTestId('modal-produto').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  row = await um(`select promocao_preco from itens_cardapio where id=$1`, [simples.id])
  ok('salvo sem promoção', row.promocao_preco === null)
  await db.query(`update itens_cardapio set promocao_preco=18 where id=$1`, [simples.id])

  secao('6. Custo, códigos e foto extra')
  await abrirCategoria(p)
  await abrirProduto(p, 'TESTE Rep Simples')
  await p.getByTestId('produto-custo').fill('9,50')
  await p.getByTestId('produto-codigo-interno').fill('INT-77')
  // O Storage local está com o esquema adiantado em relação ao contêiner (42P10 em QUALQUER upload,
  // até com service_role): o envio é simulado aqui; tela e gravação no banco são as de verdade.
  await p.route('**/storage/v1/object/cardapio/**', (r) => r.request().method() === 'POST' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'cardapio/x', Id: 'x' }) }) : r.continue())
  await p.getByTestId('produto-fotos').locator('input[type="file"]').nth(1).setInputFiles(join(process.cwd(), 'docs/referencias/repaginacao/Captura de tela 2026-10-01 143301.png'))
  await p.getByTestId('fotos-extras').locator('img').first().waitFor({ timeout: 20000 }).catch(() => {})
  ok('foto extra aparece na grade', (await p.getByTestId('fotos-extras').locator('img').count()) === 1, ((await p.getByTestId('modal-produto').innerText()).match(/Não foi possível.*/) ?? [''])[0])
  await p.getByTestId('produto-salvar').click()
  await p.getByTestId('modal-produto').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  const g = await um(`select preco_custo, codigo_pdv, codigo_interno from itens_cardapio_gestao where item_id=$1`, [simples.id])
  ok('custo e códigos gravados na tabela de gestão', Number(g.preco_custo) === 9.5 && g.codigo_pdv === 'PDV-01' && g.codigo_interno === 'INT-77', JSON.stringify(g))
  const ex = await um(`select jsonb_array_length(imagens_extras) n from itens_cardapio where id=$1`, [simples.id])
  ok('foto extra gravada no produto', ex.n === 1)
  const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: vaz } = await anon.from('itens_cardapio_gestao').select('preco_custo').eq('item_id', simples.id)
  const { error: vazCol } = await anon.from('itens_cardapio').select('preco_custo').eq('id', simples.id)
  ok('visitante não lê custo nem códigos', (!vaz || vaz.length === 0) && !!vazCol)

  secao('7. Produto novo')
  await p.getByTestId('novo-item').click()
  await p.getByTestId('modal-produto').waitFor()
  await p.getByTestId('produto-aba-complementos').click()
  ok('aba que precisa do produto oferece salvar antes', (await p.getByTestId('salvar-antes').count()) === 1)
  await p.getByTestId('produto-aba-info').click()
  await p.getByTestId('produto-nome').fill('TESTE Rep Novo')
  await p.getByTestId('produto-preco').fill('12,5')
  await p.getByTestId('produto-salvar').click()
  await espera(1500)
  const novo = await um(`select id, preco, grupo_id from itens_cardapio where restaurante_id=$1 and nome='TESTE Rep Novo'`, [loja.id])
  ok('produto novo criado na categoria aberta', !!novo && Number(novo.preco) === 12.5 && novo.grupo_id === grupo.id)
  ok('modal continua aberto para complementos', (await p.getByTestId('modal-produto').count()) === 1 && /Editar produto/.test(await p.locator('#produto-titulo').innerText()))
  await p.getByTestId('produto-aba-complementos').click()
  ok('agora a aba Complementos funciona', (await p.getByTestId('salvar-antes').count()) === 0 && /Grupos de complementos|Novo grupo/i.test(await p.getByTestId('produto-secao-complementos').innerText()))
  await p.getByTestId('produto-cancelar').click()

  secao('8. Toque, tablet e celular')
  const toque = await logar({ width: 820, height: 1180 }, { hasTouch: true, isMobile: true })
  await toque.p.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' })
  await toque.p.getByRole('tab', { name: /TESTE Repaginação/ }).click()
  await espera(500)
  const cartaoT = toque.p.locator('[data-testid="produto-cartao"]', { hasText: 'TESTE Rep Combo' })
  ok('tela de toque: ações do cartão sempre à vista', (await opacidade(cartaoT.getByTestId('produto-acoes'))) === '1')
  await foto(toque.p, '37-toque-tablet')
  await cartaoT.getByTestId('produto-editar').click()
  await toque.p.getByTestId('modal-produto').waitFor()
  const rod = await toque.p.getByTestId('produto-salvar').boundingBox()
  ok('tablet: rodapé fixo à vista', !!rod && rod.y + rod.height <= 1180)
  await foto(toque.p, '38-modal-tablet')
  await toque.ctx.close()
  const cel = await logar({ width: 390, height: 844 }, { hasTouch: true, isMobile: true })
  await cel.p.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' })
  await cel.p.getByRole('tab', { name: /TESTE Repaginação/ }).click()
  await espera(500)
  const c2 = cel.p.locator('[data-testid="produto-cartao"]', { hasText: 'TESTE Rep Simples' })
  await c2.getByTestId('produto-editar').click()
  await cel.p.getByTestId('modal-produto').waitFor()
  await espera(500)
  const sobra = await cel.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ok('celular: modal sem rolagem lateral', sobra <= 1, String(sobra))
  const rod2 = await cel.p.getByTestId('produto-salvar').boundingBox()
  ok('celular: rodapé fixo à vista', !!rod2 && rod2.y + rod2.height <= 844)
  await foto(cel.p, '39-modal-celular')
  await cel.p.getByTestId('produto-aba-custo').click()
  await foto(cel.p, '40-modal-celular-custo')
  await cel.ctx.close()
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await db.query(`delete from itens_cardapio where restaurante_id=$1 and nome like 'TESTE Rep%'`, [loja.id])
  await db.query(`delete from grupos_cardapio where restaurante_id=$1 and nome='TESTE Repaginação'`, [loja.id])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
