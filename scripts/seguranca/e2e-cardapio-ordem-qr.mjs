/**
 * Prova ponta a ponta: ordem do cardápio (0101), favoritos, fonte e preço do QR e fichas
 * responsivas — Gestor, vitrine, QR de visualização e QR ativo.
 *
 * Roda SÓ na loja isolada `ordem-qr-e2e` (e na vizinha `ordem-qr-vizinha`), que ele mesmo
 * semeia do zero. Não toca a cantina-demo nem outra loja. Só loopback.
 *
 *   node scripts/seguranca/servidor-local.mjs start   # em outro terminal
 *   SHOTS=<pasta> node scripts/seguranca/e2e-cardapio-ordem-qr.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { LOJA, SENHA, USUARIOS, VIZINHA, semear } from './semear-cardapio-ordem.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'menuzia-e2e-cardapio-ordem')
const { DB_URL, API_URL, ANON_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
mkdirSync(SHOTS, { recursive: true })

const resultados = []
const ok = (nome, passou, detalhe) => {
  resultados.push({ nome, passou })
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe && !passou ? ` — ${detalhe}` : detalhe ? ` (${detalhe})` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const semente = await semear()
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]
const loja = semente.lojaId
const vizinha = semente.vizinhaId
const mesa = semente.mesa
const grupo = async (nome, rid = loja) => (await um(`select id from grupos_cardapio where restaurante_id=$1 and nome=$2`, [rid, nome])).id
const itemId = async (nome, rid = loja) => (await um(`select id from itens_cardapio where restaurante_id=$1 and nome=$2`, [rid, nome])).id
const ordemDb = async (g) => (await q(`select nome from itens_cardapio where grupo_id=$1 order by posicao, criado_em, id`, [g])).map((r) => r.nome)
const ordemCatDb = async (rid = loja) => (await q(`select nome from grupos_cardapio where restaurante_id=$1 order by posicao, criado_em, id`, [rid])).map((r) => r.nome)
const posicoes = async (rid) => JSON.stringify(await q(`select id, posicao, grupo_id from itens_cardapio where restaurante_id=$1 order by id`, [rid]))
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const G = { lanches: await grupo('Lanches'), bebidas: await grupo('Bebidas'), sobremesas: await grupo('Sobremesas') }
const I = {
  xburger: await itemId('X-Burger'), xsalada: await itemId('X-Salada'), pausado: await itemId('Lanche Pausado'),
  lata: await itemId('Coca Lata 350 ml'), litro: await itemId('Coca 1,5 L'), agua: await itemId('Água sem gás'), pudim: await itemId('Pudim'),
}
const vizGrupo = await grupo('Pratos', vizinha)
const vizItem = await itemId('Prato da Vizinha', vizinha)

const browser = await chromium.launch()

async function logar(usuario, viewport = { width: 1366, height: 768 }, extra = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR', ...extra })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')])
  return { ctx, page }
}
const api = (page, url, metodo = 'GET', corpo) =>
  page.evaluate(async ({ url, metodo, corpo }) => {
    const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
    return { status: r.status, json: await r.json().catch(() => null) }
  }, { url: `${BASE}${url}`, metodo, corpo })
const ordenarItens = (page, grupoId, ids) => api(page, '/api/admin/cardapio/ordem', 'PUT', { tipo: 'itens', grupoId, ids })
const ordenarCategorias = (page, ids) => api(page, '/api/admin/cardapio/ordem', 'PUT', { tipo: 'categorias', ids })

/** O aviso de pendências de configuração do painel abre por cima de tudo: dispensa. */
async function dispensarAvisos(page, espera = 400) {
  const ok = page.getByRole('button', { name: /OK, entendi/ }).first()
  await ok.waitFor({ state: 'visible', timeout: espera }).catch(() => {})
  if (await ok.isVisible().catch(() => false)) await ok.click()
}

async function abrirGestor(page, categoria) {
  await page.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' })
  await dispensarAvisos(page, 4000)
  if (categoria) {
    const lateral = page.locator('aside button', { hasText: categoria }).first()
    if (await lateral.isVisible().catch(() => false)) await lateral.click()
    else await page.getByRole('tab', { name: new RegExp(categoria) }).click()
  }
  await page.waitForTimeout(400)
}
/** Ordem dos itens na tela do Gestor (o que está visível: tabela ou grade). */
const ordemGestor = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-item-ordem]')].filter((e) => e.getClientRects().length > 0).map((e) => e.getAttribute('data-item-ordem')))

/** Arrasta pela alça com o mouse, em passos, e solta sobre o alvo. */
async function arrastarMouse(page, deId, paraId) {
  await dispensarAvisos(page)
  const alca = page.locator(`[data-alca-ordem="${deId}"]`).locator('visible=true').first()
  const alvo = page.locator(`[data-item-ordem="${paraId}"], [data-categoria-ordem="${paraId}"]`).locator('visible=true').first()
  const a = await alca.boundingBox()
  const b = await alvo.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  const passos = 12
  for (let i = 1; i <= passos; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x + 20 - a.x) * i) / passos, a.y + a.height / 2 + ((b.y + b.height * 0.3 - a.y - a.height / 2) * i) / passos)
    await page.waitForTimeout(25)
  }
  await page.mouse.up()
}

/** Arrasto com o DEDO: eventos de toque de verdade pelo protocolo do Chrome. */
async function arrastarToque(page, deId, paraId) {
  await dispensarAvisos(page)
  const cdp = await page.context().newCDPSession(page)
  const alca = await page.locator(`[data-alca-ordem="${deId}"]`).locator('visible=true').first().boundingBox()
  const alvo = await page.locator(`[data-item-ordem="${paraId}"]`).locator('visible=true').first().boundingBox()
  const x0 = alca.x + alca.width / 2
  const y0 = alca.y + alca.height / 2
  const x1 = alvo.x + alvo.width / 2
  const y1 = alvo.y + alvo.height * 0.3
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] })
  for (let i = 1; i <= 14; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 14, y: y0 + ((y1 - y0) * i) / 14 }] })
    await page.waitForTimeout(25)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function esperarAviso(page, re) {
  // Espera o aviso CERTO (o anterior pode ainda estar na tela).
  let t = ''
  for (let i = 0; i < 40; i++) {
    t = (await page.getByTestId('aviso-ordem').textContent({ timeout: 250 }).catch(() => '')) ?? ''
    if (re.test(t)) return t
    await page.waitForTimeout(250)
  }
  return `(aviso: "${t}")`
}

/** Ordem na vitrine: categorias (seções) e itens dentro de cada uma. */
async function ordemVitrine(page) {
  await page.goto(`${BASE}/loja/${LOJA}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[id^="sec-"] [data-item-id]', { timeout: 20000 })
  return page.evaluate(() =>
    [...document.querySelectorAll('[id^="sec-"]')].map((s) => ({ cat: s.querySelector('h2')?.textContent?.trim(), itens: [...s.querySelectorAll('[data-item-id]')].map((e) => e.getAttribute('data-item-id')) })))
}
/** Ordem no QR: trilho de categorias e, em cada uma, os cartões. */
async function ordemQr(page) {
  await page.goto(`${BASE}/mesa/${mesa.token}`, { waitUntil: 'networkidle' })
  const cats = await page.locator('.mesa-categoria').allTextContents()
  const saida = []
  for (let i = 0; i < cats.length; i++) {
    await page.locator('.mesa-categoria').nth(i).click()
    await page.waitForTimeout(150)
    saida.push({ cat: cats[i].trim(), itens: await page.evaluate(() => [...document.querySelectorAll('.mesa-card[data-item-id]')].map((e) => e.getAttribute('data-item-id'))) })
  }
  return saida
}
const nomes = async (ids) => {
  const m = new Map((await q(`select id, nome from itens_cardapio where id = any($1::uuid[])`, [ids])).map((r) => [r.id, r.nome]))
  return ids.map((i) => m.get(i))
}
const modoQr = (vis) => db.query(`update restaurantes set mesa_somente_visualizacao=$2 where id=$1`, [loja, vis])

/** Contadores que o modo visualização NÃO pode mexer. */
async function contadores() {
  const tabelas = (await q(`select table_name from information_schema.columns where table_schema='public' and column_name='restaurante_id'
      and (table_name in ('pedidos','comandas','impressao_trabalhos','selecoes_mesa') or table_name like '%pagamento%' or table_name like '%lancamento%' or table_name like '%financ%' or table_name like '%caixa%')`)).map((r) => r.table_name)
  const saida = {}
  for (const t of tabelas.sort()) saida[t] = (await um(`select count(*)::int n from ${t} where restaurante_id=$1`, [loja])).n
  saida.pedido_itens = (await um(`select count(*)::int n from pedido_itens pi join pedidos p on p.id=pi.pedido_id where p.restaurante_id=$1`, [loja])).n
  return saida
}

try {
  // ═══════════════════════════════════════════════════════════════════════════
  secao('1. Banco: backfill, gatilhos e função de reordenação')
  {
    const semOrdem = await um(`select count(*)::int n from itens_cardapio where posicao is null`)
    ok('0101: nenhum item sem posição (backfill e gatilho)', semOrdem.n === 0)
    // Em todas as outras lojas locais (não tocadas), a posição reproduz a ordem de criação.
    const divergentes = await um(`select count(*)::int n from (
        select id, posicao, row_number() over (partition by restaurante_id, grupo_id order by criado_em, id) - 1 r
          from itens_cardapio where restaurante_id not in ($1, $2)) t where posicao <> r`, [loja, vizinha])
    ok('backfill preserva a ordem de hoje (criado_em, id) nas demais lojas', divergentes.n === 0, `${divergentes.n} divergentes`)
    ok('seed: itens criados em sequência entram no fim da categoria', igual(await ordemDb(G.bebidas), ['Coca Lata 350 ml', 'Coca 1,5 L', 'Água sem gás']))
    ok('seed: categorias criadas com posição 0 entram no fim (gatilho)', igual(await ordemCatDb(), ['Lanches', 'Bebidas', 'Sobremesas']))

    // Categoria nova com posição que colidiria (buracos na numeração) vai para o fim.
    await db.query(`update grupos_cardapio set posicao = posicao * 3 where restaurante_id=$1`, [vizinha])
    const nova = await um(`insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1, 'Nova V', 0) returning posicao`, [vizinha])
    const max = await um(`select max(posicao) m from grupos_cardapio where restaurante_id=$1 and nome <> 'Nova V'`, [vizinha])
    ok('categoria nova entra no final mesmo com buracos na numeração', nova.posicao === max.m + 1, `nova=${nova.posicao} max=${max.m}`)
    await db.query(`delete from grupos_cardapio where restaurante_id=$1 and nome='Nova V'`, [vizinha])

    const p0 = await um(`select posicao from itens_cardapio where id=$1`, [I.litro])
    await db.query(`update itens_cardapio set mais_vendido = true, status='pausado', nome = nome, preco = preco where id=$1`, [I.litro])
    await db.query(`update itens_cardapio set status='disponivel', mais_vendido=false where id=$1`, [I.litro])
    ok('favoritar, pausar, reativar e editar não mudam a posição', (await um(`select posicao from itens_cardapio where id=$1`, [I.litro])).posicao === p0.posicao)

    // Item movido de categoria vai para o fim da nova; voltar põe no fim da antiga.
    await db.query(`update itens_cardapio set grupo_id=$2 where id=$1`, [I.agua, G.sobremesas])
    ok('item movido de categoria entra no final da nova', igual(await ordemDb(G.sobremesas), ['Pudim', 'Água sem gás']))
    await db.query(`update itens_cardapio set grupo_id=$2 where id=$1`, [I.agua, G.bebidas])
    ok('e ao voltar, no final da antiga', igual(await ordemDb(G.bebidas), ['Coca Lata 350 ml', 'Coca 1,5 L', 'Água sem gás']))

    const rpc = async (ids, g = G.bebidas, rid = loja) => {
      try {
        await db.query(`select public.cardapio_ordenar_itens($1, $2, $3::uuid[], null, 'e2e')`, [rid, g, ids])
        return 'ok'
      } catch (e) {
        return e.message
      }
    }
    ok('função recusa id de outra loja', /item_fora_da_categoria/.test(await rpc([I.lata, I.litro, vizItem])))
    ok('função recusa item de outra categoria da mesma loja', /item_fora_da_categoria/.test(await rpc([I.lata, I.litro, I.pudim])))
    ok('função recusa lista incompleta', /ordem_desatualizada/.test(await rpc([I.lata, I.litro])))
    ok('função recusa id repetido', /ordem_repetida/.test(await rpc([I.lata, I.lata, I.agua])))
    ok('função recusa lista vazia e nulo', /ordem_invalida/.test(await rpc([])) && /ordem_invalida/.test(await rpc([I.lata, null, I.agua])))
    ok('função recusa categoria de outra loja', /categoria_de_outra_loja/.test(await rpc([vizItem], vizGrupo, loja)))
    const vizAntes = await posicoes(vizinha)
    ok('função aceita a lista completa', (await rpc([I.agua, I.lata, I.litro])) === 'ok' && igual(await ordemDb(G.bebidas), ['Água sem gás', 'Coca Lata 350 ml', 'Coca 1,5 L']))
    ok('posições gravadas 0..n-1', igual((await q(`select posicao from itens_cardapio where grupo_id=$1 order by posicao`, [G.bebidas])).map((r) => r.posicao), [0, 1, 2]))
    ok('loja vizinha intacta', (await posicoes(vizinha)) === vizAntes)
    const aud = await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao='cardapio.itens_ordenados'`, [loja])
    ok('reordenação registra auditoria', aud.n >= 1)

    // Concorrência: duas conexões gravando ao mesmo tempo — serializa, nada some.
    const c2 = new pg.Client({ connectionString: DB_URL })
    await c2.connect()
    await db.query('begin')
    await db.query(`select public.cardapio_ordenar_itens($1, $2, $3::uuid[], null, 'aba 1')`, [loja, G.bebidas, [I.lata, I.litro, I.agua]])
    const segunda = c2.query(`select public.cardapio_ordenar_itens($1, $2, $3::uuid[], null, 'aba 2')`, [loja, G.bebidas, [I.litro, I.agua, I.lata]])
    await espera(300)
    const presa = await Promise.race([segunda.then(() => 'terminou'), espera(200).then(() => 'esperando')])
    await db.query('commit')
    await segunda
    await c2.end()
    ok('duas gravações simultâneas se enfileiram (a segunda espera o lock)', presa === 'esperando')
    ok('depois das duas, vale a última e nenhum item some', igual(await ordemDb(G.bebidas), ['Coca 1,5 L', 'Água sem gás', 'Coca Lata 350 ml']))

    // Aba desatualizada: outra aba criou item; a lista antiga é recusada inteira.
    const extra = (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco) values ($1,$2,'Guaraná 2 L',12) returning id, posicao`, [loja, G.bebidas]))
    ok('item novo entra no final', extra.posicao === 3)
    ok('lista sem o item novo (aba velha) é recusada: nada some', /ordem_desatualizada/.test(await rpc([I.lata, I.litro, I.agua])) && (await ordemDb(G.bebidas)).length === 4)
    await db.query(`delete from itens_cardapio where id=$1`, [extra.id])
    await rpc([I.lata, I.litro, I.agua])

    // Anônimo e usuário logado não chamam a função direto (só a rota, com service_role).
    const anon = await fetch(`${API_URL}/rest/v1/rpc/cardapio_ordenar_itens`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_restaurante: loja, p_grupo: G.bebidas, p_itens: [I.agua, I.lata, I.litro], p_ator: null, p_ator_nome: 'x' }),
    })
    ok('anônimo não executa a função pelo PostgREST', anon.status >= 400 && igual(await ordemDb(G.bebidas), ['Coca Lata 350 ml', 'Coca 1,5 L', 'Água sem gás']), `HTTP ${anon.status}`)
    const grants = await q(`select grantee from information_schema.routine_privileges where routine_name in ('cardapio_ordenar_itens','cardapio_ordenar_categorias') and grantee in ('anon','authenticated','PUBLIC')`)
    ok('sem grant para anon/authenticated/PUBLIC', grants.length === 0, JSON.stringify(grants))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  secao('2. Rota do servidor: papéis, validação e isolamento')
  const dono = await logar(USUARIOS.dono)
  {
    const semSessao = await fetch(`${BASE}/api/admin/cardapio/ordem`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'itens', grupoId: G.bebidas, ids: [I.lata] }) })
    ok('sem sessão: recusado', [401, 403, 307, 302].includes(semSessao.status) || semSessao.redirected, `HTTP ${semSessao.status}`)
    for (const papel of ['garcom', 'atendente']) {
      const s = await logar(USUARIOS[papel])
      const r = await ordenarItens(s.page, G.bebidas, [I.agua, I.lata, I.litro])
      ok(`${papel}: 403 e nada muda`, r.status === 403 && igual(await ordemDb(G.bebidas), ['Coca Lata 350 ml', 'Coca 1,5 L', 'Água sem gás']), `HTTP ${r.status}`)
      await s.ctx.close()
    }
    const r1 = await ordenarItens(dono.page, G.bebidas, [I.lata, I.litro, vizItem])
    ok('dono: id de outra loja → 400', r1.status === 400 && r1.json?.codigo === 'item_fora_da_categoria', JSON.stringify(r1))
    const r2 = await ordenarItens(dono.page, G.bebidas, [I.lata, I.litro, I.pudim])
    ok('dono: item de categoria errada → 400', r2.status === 400)
    const r3 = await ordenarItens(dono.page, G.bebidas, [I.lata, I.litro])
    ok('dono: lista incompleta → 409 ordem_desatualizada', r3.status === 409 && r3.json?.codigo === 'ordem_desatualizada')
    const r4 = await ordenarItens(dono.page, G.bebidas, [I.lata, I.lata, I.agua])
    ok('dono: id repetido → 400', r4.status === 400)
    const r5 = await ordenarItens(dono.page, G.bebidas, [])
    ok('dono: lista vazia → 400', r5.status === 400)
    const r6 = await ordenarItens(dono.page, vizGrupo, [vizItem])
    ok('dono: categoria da loja vizinha → 400 (loja vem da sessão)', r6.status === 400 && r6.json?.codigo === 'categoria_de_outra_loja')
    const r7 = await api(dono.page, '/api/admin/cardapio/ordem', 'PUT', { tipo: 'itens', grupoId: "x' or 1=1", ids: [I.lata] })
    ok('dono: grupo malformado → 400', r7.status === 400)
    const viz = await logar(USUARIOS.donoVizinha)
    const r8 = await ordenarItens(viz.page, G.bebidas, [I.lata, I.litro, I.agua])
    ok('dono da vizinha não reordena a nossa categoria', r8.status === 400 && igual(await ordemDb(G.bebidas), ['Coca Lata 350 ml', 'Coca 1,5 L', 'Água sem gás']))
    const r9 = await ordenarCategorias(viz.page, [G.sobremesas, G.bebidas, G.lanches])
    ok('dono da vizinha não reordena as nossas categorias', r9.status === 400 && igual(await ordemCatDb(), ['Lanches', 'Bebidas', 'Sobremesas']))
    await viz.ctx.close()
    const gerente = await logar(USUARIOS.gerente)
    const r10 = await ordenarItens(gerente.page, G.bebidas, [I.litro, I.lata, I.agua])
    ok('gerente reordena (cardapio.editar)', r10.status === 200 && igual(await ordemDb(G.bebidas), ['Coca 1,5 L', 'Coca Lata 350 ml', 'Água sem gás']))
    const r11 = await ordenarItens(dono.page, G.bebidas, [I.lata, I.litro, I.agua])
    ok('dois operadores em sequência: vale a última, sem perda', r11.status === 200 && igual(await ordemDb(G.bebidas), ['Coca Lata 350 ml', 'Coca 1,5 L', 'Água sem gás']))
    await gerente.ctx.close()
    const eventos = await q(`select usuario_nome, dados::text d from eventos_auditoria where restaurante_id=$1 and acao like 'cardapio.%ordenad%' order by criado_em desc limit 5`, [loja])
    ok('auditoria com autor e sem dados sensíveis', eventos.length > 0 && eventos.every((e) => !/senha|token|cookie|email|@/i.test(e.d)), eventos.map((e) => `${e.usuario_nome}:${e.d}`).slice(0, 2).join(' | '))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  secao('3. Gestor: arrastar com mouse, teclado, busca, falha e duas abas')
  {
    const page = dono.page
    await abrirGestor(page, 'Bebidas')
    ok('Gestor mostra a ordem salva', igual(await ordemGestor(page), [I.lata, I.litro, I.agua]))
    await arrastarMouse(page, I.litro, I.lata)
    const aviso = await esperarAviso(page, /Ordem salva/)
    ok('mouse: arrastar Coca 1,5 L para cima salva na hora', /Ordem salva/.test(aviso) && igual(await ordemDb(G.bebidas), ['Coca 1,5 L', 'Coca Lata 350 ml', 'Água sem gás']), aviso)
    await page.screenshot({ path: join(SHOTS, 'gestor-arraste-salvo-1366.png') })
    await page.reload({ waitUntil: 'networkidle' })
    await abrirGestor(page, 'Bebidas')
    ok('recarregar: mesma ordem', igual(await ordemGestor(page), [I.litro, I.lata, I.agua]))
    const nova = await logar(USUARIOS.dono)
    await abrirGestor(nova.page, 'Bebidas')
    ok('nova sessão: mesma ordem', igual(await ordemGestor(nova.page), [I.litro, I.lata, I.agua]))

    // Arraste NÃO abre a edição do item.
    ok('arrastar não abre o formulário do item', (await page.getByText('Editar item').count()) === 0 && !(await page.locator('text=Salvar item').isVisible().catch(() => false)))

    // Teclado: foco na alça, seta para baixo.
    await page.locator(`[data-alca-ordem="${I.litro}"]`).locator('visible=true').first().focus()
    await page.keyboard.press('ArrowDown')
    const avTec = await esperarAviso(page, /Ordem salva/)
    ok('teclado: seta para baixo move e salva', igual(await ordemDb(G.bebidas), ['Coca Lata 350 ml', 'Coca 1,5 L', 'Água sem gás']), avTec)
    const foco = await page.evaluate(() => document.activeElement?.getAttribute('data-alca-ordem'))
    ok('teclado: o foco acompanha a alça', foco === I.litro)

    // Busca ativa: arraste desligado, com explicação.
    await page.getByLabel('Buscar item pelo nome').fill('Coca')
    await page.waitForTimeout(300)
    const dica = await page.getByTestId('dica-ordem').textContent().catch(() => '')
    const desab = await page.locator(`[data-alca-ordem="${I.lata}"]`).locator('visible=true').first().getAttribute('aria-disabled')
    const antesBusca = await ordemDb(G.bebidas)
    await arrastarMouse(page, I.litro, I.lata)
    await page.waitForTimeout(600)
    ok('busca ativa: arraste desligado e explicado, nada gravado', /busca ativa/i.test(dica ?? '') && desab === 'true' && igual(await ordemDb(G.bebidas), antesBusca), dica)
    await page.screenshot({ path: join(SHOTS, 'gestor-busca-ativa-1366.png') })
    await page.getByLabel('Buscar item pelo nome').fill('')

    // Falha do servidor: a tela volta e explica.
    await page.route('**/api/admin/cardapio/ordem', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Não foi possível salvar a ordem.' }) }))
    await arrastarMouse(page, I.agua, I.lata)
    const avErro = await esperarAviso(page, /Não foi possível/)
    await page.waitForTimeout(300)
    ok('falha do servidor: erro claro e a lista volta', /Não foi possível/.test(avErro) && igual(await ordemGestor(page), [I.lata, I.litro, I.agua]) && igual(await ordemDb(G.bebidas), ['Coca Lata 350 ml', 'Coca 1,5 L', 'Água sem gás']), avErro)
    await page.screenshot({ path: join(SHOTS, 'gestor-falha-servidor-1366.png') })
    await page.unroute('**/api/admin/cardapio/ordem')

    // Duas abas: a outra criou um item; esta arrasta com a lista velha.
    const novoId = (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco) values ($1,$2,'Guaraná 2 L',12) returning id`, [loja, G.bebidas])).id
    await arrastarMouse(page, I.agua, I.lata)
    const avAba = await esperarAviso(page, /mudou em outra tela/)
    await page.waitForTimeout(800)
    ok('duas abas: 409, aviso e a lista recarrega com o item novo (nada some)', /mudou em outra tela/.test(avAba) && (await ordemGestor(page)).includes(novoId) && (await ordemDb(G.bebidas)).length === 4, avAba)
    await db.query(`delete from itens_cardapio where id=$1`, [novoId])
    await nova.ctx.close()

    // Categorias: arrastar na lateral.
    await abrirGestor(page, 'Bebidas')
    await arrastarMouse(page, G.bebidas, G.lanches)
    const avCat = await esperarAviso(page, /categorias salva/)
    ok('categorias: arrastar Bebidas para o topo salva', igual(await ordemCatDb(), ['Bebidas', 'Lanches', 'Sobremesas']), avCat)
    // Botões de subir/descer continuam (alternativa acessível).
    await page.getByRole('button', { name: 'Descer categoria (ordem na vitrine)' }).first().click()
    await page.waitForTimeout(800)
    ok('categorias: botão descer continua funcionando', igual(await ordemCatDb(), ['Lanches', 'Bebidas', 'Sobremesas']))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  secao('4. Gestor no toque (390 px, dedo)')
  {
    const t = await logar(USUARIOS.dono, { width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    await abrirGestor(t.page, 'Bebidas')
    await t.page.locator(`[data-item-ordem="${I.agua}"]`).locator('visible=true').first().scrollIntoViewIfNeeded()
    await arrastarToque(t.page, I.agua, I.lata)
    const av = await esperarAviso(t.page, /Ordem salva/)
    ok('toque: arrastar Água para o topo salva', igual(await ordemDb(G.bebidas), ['Água sem gás', 'Coca Lata 350 ml', 'Coca 1,5 L']), av)
    await t.page.screenshot({ path: join(SHOTS, 'gestor-toque-390.png') })
    ok('Gestor 390: sem rolagem horizontal', await t.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await t.ctx.close()
    await ordenarItens(dono.page, G.bebidas, [I.lata, I.litro, I.agua])
  }

  // ═══════════════════════════════════════════════════════════════════════════
  secao('5. Mesma ordem na vitrine, QR de visualização e QR ativo')
  const cliente = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  const cp = await cliente.newPage()
  {
    // Ordem nova: Bebidas primeiro, e Coca 1,5 L antes da lata.
    await ordenarCategorias(dono.page, [G.bebidas, G.lanches, G.sobremesas])
    await ordenarItens(dono.page, G.bebidas, [I.litro, I.lata, I.agua])
    const gestor = { cats: await ordemCatDb(), bebidas: await ordemDb(G.bebidas) }
    const vit = await ordemVitrine(cp)
    await modoQr(true)
    const qv = await ordemQr(cp)
    await modoQr(false)
    const qa = await ordemQr(cp)
    const resumo = async (o) => ({ cats: o.map((c) => c.cat), bebidas: await nomes(o.find((c) => c.cat === 'Bebidas')?.itens ?? []) })
    const [rv, rqv, rqa] = [await resumo(vit), await resumo(qv), await resumo(qa)]
    const esperado = { cats: gestor.cats, bebidas: gestor.bebidas }
    ok('vitrine = Gestor', igual(rv, esperado), JSON.stringify(rv))
    ok('QR visualização = Gestor', igual(rqv, esperado), JSON.stringify(rqv))
    ok('QR ativo = Gestor', igual(rqa, esperado), JSON.stringify(rqa))
    ok('as três listas completas são idênticas (todas as categorias)', igual(vit.map((c) => c.itens), qv.map((c) => c.itens)) && igual(qv.map((c) => c.itens), qa.map((c) => c.itens)))

    // Pausado some e, reativado, volta na posição configurada.
    await ordenarItens(dono.page, G.lanches, [I.pausado, I.xburger, I.xsalada, (await itemId('Sanduíche Artesanal Especial da Casa com Nome Muito Comprido Para Testar Quebra de Linha'))])
    const pausadoFora = (await ordemVitrine(cp)).find((c) => c.cat === 'Lanches').itens
    ok('item pausado não aparece', !pausadoFora.includes(I.pausado))
    await db.query(`update itens_cardapio set status='disponivel' where id=$1`, [I.pausado])
    const voltou = (await ordemVitrine(cp)).find((c) => c.cat === 'Lanches').itens
    ok('reativado volta na posição configurada (1º)', voltou[0] === I.pausado)
    await db.query(`update itens_cardapio set status='pausado' where id=$1`, [I.pausado])
    // Categoria fora do horário some da vitrine e mantém a posição ao voltar.
    await db.query(`update grupos_cardapio set horario_ativo_inicio='03:00', horario_ativo_fim='03:01' where id=$1`, [G.sobremesas])
    const semSob = (await ordemVitrine(cp)).map((c) => c.cat)
    await db.query(`update grupos_cardapio set horario_ativo_inicio=null, horario_ativo_fim=null where id=$1`, [G.sobremesas])
    const comSob = (await ordemVitrine(cp)).map((c) => c.cat)
    ok('categoria fora do horário some e volta no mesmo lugar', !semSob.includes('Sobremesas') && igual(comSob, ['Bebidas', 'Lanches', 'Sobremesas']), `${semSob} → ${comSob}`)
    // Item novo aparece no fim nos três canais.
    const novo = (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco) values ($1,$2,'Chá gelado',6) returning id`, [loja, G.bebidas])).id
    const fimV = (await ordemVitrine(cp)).find((c) => c.cat === 'Bebidas').itens
    const fimQ = (await ordemQr(cp)).find((c) => c.cat === 'Bebidas').itens
    ok('item novo aparece no final na vitrine e no QR', fimV.at(-1) === novo && fimQ.at(-1) === novo)
    await db.query(`delete from itens_cardapio where id=$1`, [novo])
    // PDV e garçom continuam na ordem de sempre (criação): não mudam em silêncio.
    const garcomCat = await logar(USUARIOS.garcom)
    await garcomCat.page.goto(`${BASE}/admin/mesas/${mesa.id}`, { waitUntil: 'networkidle' })
    await garcomCat.page.locator('button', { hasText: 'Bebidas' }).first().click().catch(() => {})
    await garcomCat.page.waitForTimeout(500)
    const txt = await garcomCat.page.locator('body').innerText()
    const iLata = txt.indexOf('Coca Lata 350 ml')
    const iLitro = txt.indexOf('Coca 1,5 L')
    ok('garçom: catálogo segue por criação (não mudou com a 0101)', iLata >= 0 && iLitro >= 0 && iLata < iLitro, `lata@${iLata} litro@${iLitro}`)
    await garcomCat.ctx.close()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  secao('6. Favoritos: marcar, ver nos canais, desmarcar, não mexer na ordem')
  {
    const page = dono.page
    await abrirGestor(page, 'Bebidas')
    const posAntes = await ordemDb(G.bebidas)
    await page.locator(`[data-item-ordem="${I.lata}"]`).locator('visible=true').first().getByTestId('favorito-item').click()
    await page.waitForTimeout(700)
    ok('estrela no Gestor grava o favorito', (await um(`select mais_vendido from itens_cardapio where id=$1`, [I.lata])).mais_vendido === true)
    ok('favoritar não muda a ordem', igual(await ordemDb(G.bebidas), posAntes))
    const selo = async (url) => {
      await cp.goto(url, { waitUntil: 'networkidle' })
      if (url.includes('/mesa/')) await cp.locator('.mesa-categoria', { hasText: 'Bebidas' }).click()
      await cp.waitForTimeout(300)
      // Na vitrine, o cartão da categoria (o carrossel "Destaques" já é a vitrine dos favoritos).
      const cartao = url.includes('/mesa/') ? `.mesa-card[data-item-id="${I.lata}"]` : `[id^="sec-"] [data-item-id="${I.lata}"]`
      return cp.locator(cartao).first().locator('[data-selo-favorito]').count()
    }
    ok('vitrine mostra ★ Favorito (recarregando, sem republicar)', (await selo(`${BASE}/loja/${LOJA}`)) === 1)
    await cp.screenshot({ path: join(SHOTS, 'vitrine-favorito-390.png') })
    await modoQr(true)
    ok('QR visualização mostra ★ Favorito', (await selo(`${BASE}/mesa/${mesa.token}`)) === 1)
    await modoQr(false)
    ok('QR ativo mostra ★ Favorito', (await selo(`${BASE}/mesa/${mesa.token}`)) === 1)
    // Selo não cobre foto, nome nem preço.
    const sobre = await cp.evaluate((id) => {
      const card = document.querySelector(`.mesa-card[data-item-id="${id}"]`)
      const s = card.querySelector('[data-selo-favorito]').getBoundingClientRect()
      const cobre = (el) => { const r = el.getBoundingClientRect(); return !(r.right <= s.left || r.left >= s.right || r.bottom <= s.top || r.top >= s.bottom) }
      return ['h3', '.mesa-preco-valor', '.mesa-card-foto'].map((sel) => cobre(card.querySelector(sel)))
    }, I.lata)
    ok('selo não cobre nome, preço nem foto', sobre.every((x) => x === false), JSON.stringify(sobre))
    await page.locator(`[data-item-ordem="${I.lata}"]`).locator('visible=true').first().getByTestId('favorito-item').click()
    await page.waitForTimeout(700)
    ok('desmarcar grava', (await um(`select mais_vendido from itens_cardapio where id=$1`, [I.lata])).mais_vendido === false)
    ok('vitrine sem selo depois de desmarcar', (await selo(`${BASE}/loja/${LOJA}`)) === 0)
    ok('QR sem selo depois de desmarcar', (await selo(`${BASE}/mesa/${mesa.token}`)) === 0)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  secao('7. Fonte e preço do QR')
  {
    await cp.goto(`${BASE}/loja/${LOJA}`, { waitUntil: 'networkidle' })
    const fonteVitrine = await cp.evaluate(() => getComputedStyle(document.querySelector('[data-item-id] .font-semibold, [data-item-id] div')).fontFamily)
    await cp.goto(`${BASE}/mesa/${mesa.token}`, { waitUntil: 'networkidle' })
    await cp.locator('.mesa-categoria', { hasText: 'Lanches' }).click()
    const fontes = await cp.evaluate(() => {
      const f = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).fontFamily : null }
      return {
        loja: f('.mesa-nome-loja'), busca: f('.mesa-busca input'), categoria: f('.mesa-categoria-nome'), nome: f('.mesa-card-texto h3'),
        descricao: f('.mesa-card-texto p'), preco: f('.mesa-preco-valor'), etiqueta: f('.mesa-item-etiqueta'), botao: f('.mesa-botao-selecao, .mesa-chamar, button'),
      }
    })
    const todas = Object.entries(fontes).filter(([, v]) => v)
    ok('fonte computada do QR = fonte da vitrine em todos os elementos', todas.length >= 6 && todas.every(([, v]) => v === fonteVitrine), `${fonteVitrine} · ${JSON.stringify(fontes)}`)
    ok('fonte é Montserrat (next/font) e carregou', /Montserrat/i.test(fonteVitrine) && (await cp.evaluate(() => document.fonts.check('600 14px ' + getComputedStyle(document.querySelector('.mesa-card-texto h3')).fontFamily.split(',')[0]))))
    const preco = await cp.evaluate(() => { const s = getComputedStyle(document.querySelector('.mesa-preco-valor')); return { cor: s.color, peso: s.fontWeight } })
    ok('preço do QR escuro (#111827) e peso 600', preco.cor === 'rgb(17, 24, 39)' && preco.peso === '600', JSON.stringify(preco))
    const nomeItem = await cp.evaluate(() => getComputedStyle(document.querySelector('.mesa-card-texto h3')).fontWeight)
    ok('preço não compete com o nome (mesmo peso, não maior)', Number(nomeItem) >= 600)
    const promo = await cp.evaluate((id) => {
      const card = document.querySelector(`.mesa-card[data-item-id="${id}"]`)
      const antigo = card.querySelector('.mesa-preco-antigo')
      const atual = card.querySelector('.mesa-preco-valor')
      return { antigo: antigo?.textContent, riscado: antigo ? getComputedStyle(antigo).textDecorationLine : null, corAntigo: antigo ? getComputedStyle(antigo).color : null, atual: atual.textContent, corAtual: getComputedStyle(atual).color }
    }, I.xsalada)
    ok('promoção: atual escuro, anterior cinza e riscado', /25,00/.test(promo.atual) && /30,00/.test(promo.antigo) && promo.riscado === 'line-through' && promo.corAtual === 'rgb(17, 24, 39)' && promo.corAntigo === 'rgb(107, 114, 128)', JSON.stringify(promo))
    const rotulo = await cp.evaluate(() => { const s = getComputedStyle(document.querySelector('.mesa-preco-rotulo')); return { t: document.querySelector('.mesa-preco-rotulo').textContent, cor: s.color, tam: s.fontSize } })
    ok('"A partir de" continua pequeno e cinza', /a partir de/i.test(rotulo.t) && rotulo.cor === 'rgb(107, 114, 128)' && parseFloat(rotulo.tam) <= 11, JSON.stringify(rotulo))
    const botoes = await cp.evaluate(() => getComputedStyle(document.querySelector('.mesa-cabecalho')).backgroundColor)
    ok('elementos de ação/cabeçalho vermelhos não mudaram', botoes === 'rgb(203, 0, 15)')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  secao('8. Fichas (modal) em todas as larguras')
  {
    const casos = [
      ['X-Burger', 'horizontal + muitos complementos'], ['Coca Lata 350 ml', 'foto vertical'], ['Pudim', 'foto quadrada'],
      ['Água sem gás', 'sem foto'], ['Sanduíche Artesanal Especial', 'nome e descrição longos'],
    ]
    const categoriaDe = { 'X-Burger': 'Lanches', 'Coca Lata 350 ml': 'Bebidas', Pudim: 'Sobremesas', 'Água sem gás': 'Bebidas', 'Sanduíche Artesanal Especial': 'Lanches' }
    const larguras = [[360, 740, 'retrato'], [390, 844, 'retrato'], [412, 915, 'retrato'], [768, 1024, 'tablet'], [1024, 768, 'tablet'], [1366, 768, 'desktop'], [1920, 1080, 'desktop'], [844, 390, 'paisagem'], [740, 360, 'paisagem']]
    for (const modo of ['visualizacao', 'ativo']) {
      await modoQr(modo === 'visualizacao')
      for (const [w, h, tipo] of larguras) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 900 ? 2 : 1, hasTouch: w < 900, isMobile: w < 900 })
        const p = await ctx.newPage()
        await p.goto(`${BASE}/mesa/${mesa.token}`, { waitUntil: 'networkidle' })
        let falhas = []
        for (const [nome, desc] of casos) {
          await p.locator('.mesa-categoria', { hasText: categoriaDe[nome] }).click()
          await p.locator('.mesa-card', { hasText: nome }).first().click()
          const sel = modo === 'visualizacao' ? '[data-ficha-visualizacao]' : '[data-ficha-escolha]'
          await p.waitForSelector(sel, { timeout: 5000 })
          await p.waitForTimeout(250)
          const m = await p.evaluate((sel) => {
            const d = document.querySelector(sel)
            const foto = d.querySelector('.mesa-ver-foto, .mesa-modal-foto')
            const titulo = d.querySelector('.mesa-modal-etapa') ?? d.querySelector('h2')
            const fechar = d.querySelector('.mesa-fechar')
            const img = foto.querySelector('img')
            const rf = foto.getBoundingClientRect()
            const rt = titulo.getBoundingClientRect()
            const rc = fechar.getBoundingClientRect()
            return {
              fotoEmCima: rf.bottom <= rt.top + 1,
              fotoAEsquerda: rf.right <= rt.left + 1,
              fotoLargura: rf.width, vw: window.innerWidth, vh: window.innerHeight,
              semRolagemHorizontal: d.scrollWidth <= d.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1,
              fecharVisivel: rc.top >= 0 && rc.right <= window.innerWidth + 1 && rc.bottom <= window.innerHeight && rc.width >= 44 && rc.height >= 44,
              imgProporcao: img ? { natural: img.naturalWidth / img.naturalHeight, fit: getComputedStyle(img).objectFit } : null,
              imgCheia: img ? !/thumb|_400/.test(img.currentSrc) : true,
              role: d.getAttribute('role'),
            }
          }, sel)
          const retrato = tipo === 'retrato'
          const lado = tipo === 'desktop' || tipo === 'paisagem' || (tipo === 'tablet')
          if (retrato && !(m.fotoEmCima && m.fotoLargura >= m.vw - 2)) falhas.push(`${nome}: foto não está em cima na largura toda`)
          if (lado && !m.fotoAEsquerda) falhas.push(`${nome}: foto não está à esquerda`)
          if (!m.semRolagemHorizontal) falhas.push(`${nome}: rolagem horizontal`)
          if (!m.fecharVisivel) falhas.push(`${nome}: fechar fora da tela/pequeno`)
          if (m.imgProporcao && !['cover', 'contain'].includes(m.imgProporcao.fit)) falhas.push(`${nome}: foto distorcida (${m.imgProporcao.fit})`)
          if (m.role !== 'dialog') falhas.push(`${nome}: sem role=dialog`)
          // Ativo: o fim (quantidade/observação/botão) é alcançável e o botão está à vista.
          if (modo === 'ativo' && nome === 'X-Burger') {
            await p.locator('.mesa-opcao', { hasText: 'Ao ponto' }).click()
            await p.locator('.mesa-avancar.ativo').click()
            const ultimo = p.locator('.mesa-opcao', { hasText: 'Tomate' })
            await ultimo.scrollIntoViewIfNeeded()
            const vis = await ultimo.isVisible()
            const bot = await p.locator('.mesa-avancar').boundingBox()
            if (!vis || !bot || bot.y + bot.height > h + 1) falhas.push(`X-Burger: 12º adicional ou botão final fora de alcance`)
            if (w === 390) await p.screenshot({ path: join(SHOTS, `qr-ativo-390-muitos-complementos.png`) })
          }
          if ([360, 390, 412, 1366].includes(w) && (nome === 'X-Burger' || nome === 'Sanduíche Artesanal Especial')) {
            await p.screenshot({ path: join(SHOTS, `qr-${modo}-${w}-ficha-${nome.split(' ')[0].toLowerCase()}.png`) })
          }
          if ([844, 768].includes(w) && nome === 'X-Burger') await p.screenshot({ path: join(SHOTS, `qr-${modo}-${w}x${h}-ficha-xburger.png`) })
          // Esc fecha (teclado).
          await p.keyboard.press('Escape')
          await p.waitForTimeout(150)
          if ((await p.locator(sel).count()) > 0) {
            falhas.push(`${nome}: Esc não fechou`)
            await p.locator('.mesa-fechar').click()
          }
        }
        ok(`${modo} ${w}×${h} (${tipo}): ${casos.length} fichas corretas`, falhas.length === 0, falhas.join('; '))
        await ctx.close()
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  secao('9. Modo visualização: navegar e abrir não cria nada')
  {
    await modoQr(true)
    const antes = await contadores()
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
    await p.goto(`${BASE}/mesa/${mesa.token}`, { waitUntil: 'networkidle' })
    for (const cat of ['Bebidas', 'Lanches', 'Sobremesas']) {
      await p.locator('.mesa-categoria', { hasText: cat }).click()
      const n = await p.locator('.mesa-card').count()
      for (let i = 0; i < n; i++) {
        await p.locator('.mesa-card').nth(i).click()
        await p.waitForSelector('[data-ficha-visualizacao]')
        await p.keyboard.press('Escape')
      }
    }
    await p.fill('.mesa-busca input', 'coca')
    await p.waitForTimeout(300)
    ok('visualização: sem botão de adicionar/seleção', (await p.locator('.mesa-card-mais, .mesa-botao-selecao, .mesa-avancar').count()) === 0)
    await p.waitForTimeout(1500)
    const depois = await contadores()
    ok('visualização: zero pedidos, comandas, lançamentos, pagamentos, impressões e seleções', igual(antes, depois), `${JSON.stringify(antes)} → ${JSON.stringify(depois)}`)
    await p.context().close()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  secao('10. QR ativo: seleção e pedido controlado (loja isolada)')
  {
    await modoQr(false)
    // Ordem bem diferente antes, para provar que ela não mexe no pedido.
    await ordenarItens(dono.page, G.lanches, [(await itemId('Sanduíche Artesanal Especial da Casa com Nome Muito Comprido Para Testar Quebra de Linha')), I.xsalada, I.pausado, I.xburger])
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
    await p.goto(`${BASE}/mesa/${mesa.token}`, { waitUntil: 'networkidle' })
    await p.locator('.mesa-categoria', { hasText: 'Lanches' }).click()
    await p.locator('.mesa-card', { hasText: 'X-Burger' }).click()
    await p.locator('.mesa-opcao', { hasText: 'Ao ponto' }).click()
    await p.locator('.mesa-avancar.ativo').click()
    await p.locator('.mesa-opcao', { hasText: 'Bacon' }).click()
    await p.locator('.mesa-opcao', { hasText: 'Cheddar' }).click()
    await p.locator('.mesa-avancar.ativo').click()
    await p.locator('.mesa-observacao textarea').fill('teste controlado e2e')
    await p.screenshot({ path: join(SHOTS, 'qr-ativo-390-quantidade.png') })
    await p.locator('.mesa-avancar.ativo', { hasText: /Adicionar/ }).click()
    // A seleção grava sozinha no servidor (sincroniza).
    let linha
    for (let i = 0; i < 30 && !linha; i++) {
      await espera(400)
      linha = await um(`select si.nome_snapshot, si.quantidade, si.opcoes::text o, si.preco_unitario_snapshot::numeric p from selecao_itens si join selecoes_mesa s on s.id=si.selecao_id where s.mesa_id=$1 and s.encerrada_em is null`, [mesa.id]).catch(async () =>
        um(`select si.nome_snapshot, si.quantidade, si.opcoes::text o from selecao_itens si join selecoes_mesa s on s.id=si.selecao_id where s.mesa_id=$1 and s.encerrada_em is null`, [mesa.id]))
    }
    ok('QR ativo: seleção gravada com X-Burger, ponto e adicionais', !!linha && linha.nome_snapshot === 'X-Burger' && /Ao ponto/.test(linha.o) && /Bacon/.test(linha.o) && /Cheddar/.test(linha.o), JSON.stringify(linha))
    const pedidosAntes = (await um(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja])).n
    ok('seleção não criou pedido', pedidosAntes === 0)
    // Garçom lança o pedido controlado com os mesmos itens.
    const g = await logar(USUARIOS.garcom)
    const comps = ['Ao ponto', 'Bacon', 'Cheddar']
    const vistas = await q(`select id, versao from selecoes_mesa where mesa_id=$1 and encerrada_em is null`, [mesa.id])
    const r = await api(g.page, `/api/admin/mesas/${mesa.id}/lancamento`, 'POST', {
      chaveIdempotencia: crypto.randomUUID(), selecoesVistas: vistas,
      itens: [{ itemId: I.xburger, quantidade: 1, observacao: 'teste controlado e2e', complementos: comps }],
    })
    ok('garçom lança o pedido controlado', r.status === 200 || r.status === 201, JSON.stringify(r).slice(0, 200))
    const ped = await um(`select p.total::numeric t, p.subtotal::numeric s, (select string_agg(nome, ',') from pedido_itens where pedido_id=p.id) itens from pedidos p where restaurante_id=$1 order by criado_em desc limit 1`, [loja])
    ok('pedido com o preço certo (32 + 5 + 4 = 41) e o item certo', ped && Number(ped.s) === 41 && /X-Burger/.test(ped.itens), JSON.stringify(ped))
    ok('ordem do cardápio não entra no pedido (só item, opções e preço)', !/posicao/.test(JSON.stringify(ped)))
    await g.ctx.close()
    await p.context().close()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  secao('11. Vitrine: sem regressão (390 e 1366) e isolamento')
  {
    for (const [w, h] of [[390, 844], [1366, 768]]) {
      const p = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage()
      await p.goto(`${BASE}/loja/${LOJA}`, { waitUntil: 'networkidle' })
      await p.waitForSelector('[data-item-id]')
      ok(`vitrine ${w}: carrega, sem rolagem horizontal`, await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      await p.screenshot({ path: join(SHOTS, `vitrine-${w}.png`), fullPage: w < 500 })
      await p.context().close()
    }
    const vizVit = await (await browser.newContext()).newPage()
    await vizVit.goto(`${BASE}/loja/${VIZINHA}`, { waitUntil: 'networkidle' })
    await vizVit.waitForSelector('[data-item-id]')
    const vizIds = await vizVit.evaluate(() => [...document.querySelectorAll('[data-item-id]')].map((e) => e.getAttribute('data-item-id')))
    ok('vitrine da vizinha só mostra itens dela', vizIds.length > 0 && vizIds.every((id) => !Object.values(I).includes(id)))
    await vizVit.context().close()
  }
} finally {
  // Estado conhecido para a próxima execução e para as capturas.
  await db.query(`update restaurantes set mesa_somente_visualizacao=false where id=$1`, [loja]).catch(() => {})
  await browser.close()
  await db.end()
}

const falhas = resultados.filter((r) => !r.passou)
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram · capturas em ${SHOTS}`)
if (falhas.length) {
  console.log('Falharam:\n' + falhas.map((f) => ` - ${f.nome}`).join('\n'))
  process.exit(1)
}
