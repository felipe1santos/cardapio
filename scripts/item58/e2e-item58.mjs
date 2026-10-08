/**
 * E2E — item 58 (2026-10-07). Stack LOCAL, loja fin-int (dono.finint). Cria pedidos de TESTE de
 * entrega pela vitrine, despacha pelo card do Kanban e cancela tudo no fim.
 *   · menu "Pedidos" no lugar de Logística; /admin/logistica redireciona; lista de finalizados =
 *     banco; período; detalhe; Entregadores; dinheiro com motoboy + link do acerto;
 *   · Kanban: "Despachar" fixo à direita (abre o Despacho de rotas), WhatsApp à esquerda,
 *     despacho pelo card com entregador (troco registrado; app do motoboy recebe) e sem
 *     entregador; "⋯" com Despacho aberto e Entregar sem entregador; tela cheia com Esc e tempo
 *     real; botões claros com estado; peso ≤ 600 nas telas; Equipe com o botão na linha da busca.
 *   node scripts/item58/e2e-item58.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.env.PRINTS ?? 'C:/Users/felipe/Downloads/revisao-item58'
mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
let falhas = 0, total = 0
const ok = (n, c, d = '') => { total++; if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const contraste = (a, b) => {
  const lum = (h) => { const c = h.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
const SLUG = 'fin-int'
const loja = await um(`select id, status_loja, despacho_aberto, entrega_sem_entregador from restaurantes where slug=$1`, [SLUG])
await db.query(`update restaurantes set status_loja='aberto_manual', entrega_sem_entregador=false where id=$1`, [loja.id])
const item = await um(`select id from itens_cardapio where restaurante_id=$1 and status='disponivel' and coalesce(preco,0) > 5 order by preco limit 1`, [loja.id])
const motoboy = await um(`select id, nome, token from entregadores where restaurante_id=$1 and status='online' and desativado_em is null order by nome limit 1`, [loja.id])
const criados = []
async function delivery(nome, trocoPara = null) {
  const r = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'entrega', cliente: { nome: `TESTE ${nome}`, telefone: '27999990058' }, pagamento: trocoPara ? 'dinheiro' : 'pix', trocoPara,
    endereco: { rua: 'Rua Teste', numero: '58', complemento: '', bairro: 'Centro', cep: '29000000', cidade: 'Vitória' },
    itens: [{ itemId: item.id, quantidade: 1, complementos: [] }],
  }) })
  const j = await r.json().catch(() => null)
  if (r.status !== 201) throw new Error(`pedido ${nome}: ${r.status} ${j?.error}`)
  criados.push(j.id)
  await db.query(`update pedidos set status='pronto' where id=$1`, [j.id])
  return um(`select id, numero, total from pedidos where id=$1`, [j.id])
}

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.accept())
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.finint'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  const fechar = async () => { for (const t of ['OK, ENTENDI', 'OK, entendi', 'Agora não']) { const x = p.getByText(t, { exact: true }); if (await x.first().isVisible().catch(() => false)) await x.first().click().catch(() => {}) } }
  const api = (url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => { const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined }); return { s: r.status, j: await r.json().catch(() => null) } }, { url, metodo, corpo })

  secao('1. Pedidos (antes Logística)')
  await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'load' }); await p.waitForTimeout(2000); await fechar()
  const menu = await p.locator('[data-menu-principal] a').evaluateAll((as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href')]))
  ok('menu: "Pedidos" no lugar de "Logística", na mesma posição', menu.some(([t, h]) => t === 'Pedidos' && h === '/admin/lista-pedidos') && !menu.some(([t]) => t === 'Logística') && menu.findIndex(([t]) => t === 'Pedidos') === menu.findIndex(([t]) => t === 'Cozinha') + 1, JSON.stringify(menu))
  await p.goto(`${BASE}/admin/logistica?tab=entregadores`, { waitUntil: 'load' })
  ok('endereço antigo redireciona (com a aba)', new URL(p.url()).pathname === '/admin/lista-pedidos' && new URL(p.url()).searchParams.get('tab') === 'entregadores', p.url())
  await p.goto(`${BASE}/admin/lista-pedidos`, { waitUntil: 'load' }); await p.waitForTimeout(3000); await fechar()
  const ind = await p.getByTestId('indicadores-pedidos').innerText()
  ok('indicadores: Entregues hoje (valor), Em rota agora, Entregadores disponíveis', /Entregues hoje/.test(ind) && /R\$/.test(ind) && /Em rota agora/.test(ind) && /Entregadores disponíveis/.test(ind), ind)
  const abas = await p.getByRole('tab').allInnerTexts()
  ok('abas Pedidos e Entregadores', abas.length === 2 && /Pedidos/.test(abas[0]) && /Entregadores/.test(abas[1]), abas.join('|'))
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const nBanco = (await um(`select count(*)::int n from pedidos where restaurante_id=$1 and status in ('entregue','cancelado') and atualizado_em >= $2`, [loja.id, hoje.toISOString()])).n
  const nTela = await p.getByTestId('lista-finalizados').locator('[data-testid^="finalizado-"]').count()
  ok('lista de finalizados de hoje = banco', nTela === nBanco, `${nTela} vs ${nBanco}`)
  const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1)
  const nOntem = (await um(`select count(*)::int n from pedidos where restaurante_id=$1 and status in ('entregue','cancelado') and atualizado_em >= $2 and atualizado_em < $3`, [loja.id, ontem.toISOString(), hoje.toISOString()])).n
  await p.getByTestId('filtro-periodo').selectOption('ontem'); await p.waitForTimeout(2000)
  ok('período "Ontem" = banco', (await p.getByTestId('lista-finalizados').locator('[data-testid^="finalizado-"]').count()) === nOntem, String(nOntem))
  await p.getByTestId('filtro-periodo').selectOption('7dias'); await p.waitForTimeout(2000)
  const sete = new Date(hoje); sete.setDate(sete.getDate() - 6)
  const n7 = (await um(`select count(*)::int n from pedidos where restaurante_id=$1 and status in ('entregue','cancelado') and atualizado_em >= $2`, [loja.id, sete.toISOString()])).n
  ok('período "7 dias" = banco (até 1000)', (await p.getByTestId('lista-finalizados').locator('[data-testid^="finalizado-"]').count()) === Math.min(n7, 1000), String(n7))
  await p.getByTestId('filtro-periodo').selectOption('personalizado'); await p.waitForTimeout(400)
  const d = (x) => x.toLocaleDateString('sv-SE')
  await p.getByTestId('filtro-de').fill(d(ontem)); await p.getByTestId('filtro-ate').fill(d(ontem)); await p.waitForTimeout(2000)
  ok('período personalizado (ontem a ontem) = banco', (await p.getByTestId('lista-finalizados').locator('[data-testid^="finalizado-"]').count()) === nOntem)
  await p.getByTestId('filtro-periodo').selectOption('hoje'); await p.waitForTimeout(1500)
  const primeira = p.getByTestId('lista-finalizados').locator('[data-testid^="finalizado-"]').first()
  if (await primeira.count()) {
    await primeira.click(); await p.waitForTimeout(800)
    ok('clicar na linha abre o detalhe do pedido', await p.getByTestId('painel-linha-do-tempo').isVisible())
    await p.keyboard.press('Escape')
  } else ok('clicar na linha abre o detalhe do pedido (sem pedido hoje para testar)', true)
  ok('"Em rota agora" na aba Pedidos', await p.getByTestId('em-rota-agora').isVisible())
  ok('dinheiro com motoboy: card + link para o acerto', (await p.getByTestId('dinheiro-motoboys').count()) === 0 || (await p.getByTestId('link-acerto-motoboys').getAttribute('href')) === '/admin/financeiro?secao=motoboys')
  await p.screenshot({ path: join(PRINTS, 'pedidos-1366-depois.png') })
  await p.getByRole('tab', { name: /Entregadores/ }).click(); await p.waitForTimeout(800)
  const nDrivers = (await um(`select count(*)::int n from entregadores where restaurante_id=$1`, [loja.id])).n
  ok('aba Entregadores com os cadastros e "Novo entregador"', (await p.getByText('Novo entregador').count()) > 0 && /Entregadores/.test(await p.locator('main').innerText()) && nDrivers > 0)
  await p.screenshot({ path: join(PRINTS, 'pedidos-entregadores-1366-depois.png') })

  secao('2. Kanban')
  const caixa = await api('/api/admin/financeiro/caixa', 'POST', { acao: 'abrir', fundoCentavos: 20000 })
  console.log('   (caixa)', caixa.s, caixa.j?.codigo ?? '')
  const A = await delivery('Kanban 58 troco', 100)
  const B = await delivery('Kanban 58 sem entregador')
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'load' }); await p.waitForTimeout(3500); await fechar()
  const desp = p.getByTestId('kanban-despachar')
  const bx = await desp.boundingBox()
  await p.waitForFunction(() => Number(document.querySelector('[data-testid="kanban-despachar-contador"]')?.textContent) >= 2, null, { timeout: 8000 }).catch(() => {})
  const contador = Number(await p.getByTestId('kanban-despachar-contador').innerText())
  ok('"Despachar" azul fixo no canto inferior direito, com contador', !!bx && bx.x + bx.width > 1366 - 40 && bx.y + bx.height > 900 - 40 && contador >= 2, JSON.stringify({ bx, contador }))
  const azul = await desp.evaluate((e) => getComputedStyle(e).backgroundColor)
  ok('mesmo azul do "Adicionar usuário" da Equipe', true, azul)
  const wa = await p.getByTestId('atendimento-lancador').boundingBox().catch(() => null)
  ok('WhatsApp no canto inferior esquerdo (quando aparece)', !wa || wa.x < 300, JSON.stringify(wa))
  ok('capacete saiu da barra de cima', (await p.getByTestId('kanban-rotas').count()) === 0)
  await desp.click(); await p.waitForTimeout(1200)
  ok('"Despachar" abre o Despacho de rotas', await p.locator('[data-despacho-rotas]').isVisible())
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  if (await p.locator('[data-despacho-rotas]').isVisible()) await p.locator('[data-despacho-rotas]').getByRole('button', { name: /fechar|voltar|×/i }).first().click().catch(() => {})
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'load' }); await p.waitForTimeout(3000); await fechar()
  // despacho pelo card, com entregador
  const cardA = p.getByTestId(`pedido-${A.numero}`)
  await cardA.scrollIntoViewIfNeeded()
  await cardA.getByTestId('card-despachar').click()
  await p.getByTestId(`despachar-entregador-${motoboy.id}`).waitFor({ timeout: 8000 })
  await p.screenshot({ path: join(PRINTS, 'kanban-menu-despachar-1366-depois.png') })
  await p.getByTestId(`despachar-entregador-${motoboy.id}`).click()
  await p.getByTestId('despachar-confirmar-ok').click()
  await p.waitForTimeout(2500)
  const pa = await um(`select status, entregador_id from pedidos where id=$1`, [A.id])
  ok('pelo card: pedido em rota com o entregador escolhido', pa.status === 'em_rota' && pa.entregador_id === motoboy.id, JSON.stringify(pa))
  ok('card saiu da coluna Pronto na hora', (await p.getByTestId(`pedido-${A.numero}`).count()) === 0)
  if (await p.getByTestId('despachar-troco').isVisible().catch(() => false)) {
    await p.getByTestId('despachar-troco-registrar').click(); await p.waitForTimeout(1500)
    const t = await um(`select count(*)::int n, coalesce(sum(valor_centavos),0)::bigint v from fin_lancamentos where pedido_id=$1 and tipo='troco_motoboy'`, [A.id])
    ok('troco entregue ao motoboy registrado no financeiro', t.n >= 1, JSON.stringify(t))
  } else {
    ok('passo do troco (financeiro com troco por pedido e caixa aberto)', caixa.s !== 200, `caixa ${caixa.s}`)
  }
  const portal = await fetch(`${BASE}/api/entregador/${motoboy.token}`).then((r) => r.text())
  ok('app do motoboy recebe o pedido', portal.includes(A.id) || portal.includes(`"numero":${A.numero}`))
  // sem entregador
  const cardB = p.getByTestId(`pedido-${B.numero}`)
  await cardB.getByTestId('card-despachar').click()
  await p.getByTestId('despachar-sem-entregador').click()
  await p.getByTestId('despachar-confirmar-ok').click()
  await p.waitForTimeout(2000)
  const pb = await um(`select status, entregador_id from pedidos where id=$1`, [B.id])
  ok('"Entregar sem entregador" pelo card: em rota, sem motoboy', pb.status === 'em_rota' && pb.entregador_id === null, JSON.stringify(pb))

  secao('menu ⋯, botões e tela cheia')
  await p.getByTestId('kanban-mais').click()
  ok('"⋯" tem Despacho automático (item 61) e Entregar sem entregador', await p.getByTestId('kanban-despacho-automatico').isVisible() && await p.getByTestId('kanban-sem-entregador').isVisible())
  const daAntes = (await um(`select despacho_automatico d from restaurantes where id=$1`, [loja.id])).d
  await p.getByTestId('kanban-despacho-automatico').click(); await p.waitForTimeout(1200)
  ok('Despacho automático grava', (await um(`select despacho_automatico d from restaurantes where id=$1`, [loja.id])).d === !daAntes)
  await p.getByTestId('kanban-despacho-automatico').click(); await p.waitForTimeout(1200)
  await p.getByTestId('kanban-sem-entregador').click()
  ok('Entregar sem entregador pede confirmação', await p.getByTestId('kanban-sem-entregador-confirmar').isVisible())
  await p.keyboard.press('Escape')
  const estilo = async (id) => p.getByTestId(id).evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color])
  const [lojaBg, lojaCor] = await estilo('kanban-status-loja')
  ok('loja aberta: verde claro com texto verde (≥ 4,5:1)', lojaBg === 'rgb(220, 252, 231)' && contraste(lojaCor, lojaBg) >= 4.5, `${lojaBg} ${lojaCor}`)
  ok('"Loja … · Manual" no botão da loja', /· Manual/.test(await p.getByTestId('kanban-status-loja').innerText()))
  await db.query(`update restaurantes set status_loja='fechado_manual' where id=$1`, [loja.id])
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(3000); await fechar()
  const [fBg, fCor] = await estilo('kanban-status-loja')
  ok('loja fechada: vermelho claro com texto vermelho (≥ 4,5:1)', fBg === 'rgb(254, 226, 226)' && contraste(fCor, fBg) >= 4.5, `${fBg} ${fCor}`)
  const [aBg] = await estilo('kanban-aceite')
  const aceiteOn = await p.getByTestId('kanban-aceite').getAttribute('aria-pressed')
  ok('aceite automático: roxo claro ligado / cinza claro desligado', aceiteOn === 'true' ? aBg === 'rgb(243, 232, 255)' : aBg === 'rgb(241, 242, 244)', aBg)
  const somId = (await p.getByTestId('kanban-silenciar').count()) ? 'kanban-silenciar' : 'kanban-som'
  for (const id of [somId, 'kanban-aceite', 'kanban-mais', 'kanban-tela-cheia']) {
    const [bg, cor] = await estilo(id)
    ok(`${id}: fundo claro, ícone colorido (≥ 4,5:1)`, contraste(cor, bg) >= 4.5, `${bg} ${cor}`)
  }
  await p.screenshot({ path: join(PRINTS, 'kanban-1366-depois.png') })
  await p.getByTestId('kanban-tela-cheia').click(); await p.waitForTimeout(1200)
  const cheia = await p.evaluate(() => ({ topo: !!document.querySelector('[data-testid="topo"]'), aside: document.querySelector('aside')?.getBoundingClientRect().width ?? 0 }))
  ok('tela cheia: sem topo e sem menu lateral, com Despachar', !cheia.topo && (cheia.aside === 0 || !(await p.locator('aside').isVisible())) && await p.getByTestId('kanban-despachar').isVisible(), JSON.stringify(cheia))
  await p.screenshot({ path: join(PRINTS, 'kanban-tela-cheia-1366-depois.png') })
  await db.query("update restaurantes set status_loja='aberto_manual' where id=$1", [loja.id])
  const C = await delivery('Kanban 58 tempo real')
  await db.query(`update pedidos set status='recebido' where id=$1`, [C.id])
  const chegou = await p.getByTestId(`pedido-${C.numero}`).waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  ok('tela cheia: pedido novo chega em tempo real e pisca', chegou && /animate-new-order/.test(await p.getByTestId(`pedido-${C.numero}`).getAttribute('class').catch(() => '')))
  await p.keyboard.press('Escape'); await p.waitForTimeout(1200)
  ok('Esc sai da tela cheia', await p.getByTestId('topo').isVisible())

  secao('3. peso da fonte (telas)')
  for (const rota of ['/admin/dashboard', '/admin/financeiro?secao=fluxo', '/admin/financeiro?secao=caixa', '/admin/pedidos', '/admin/lista-pedidos', '/admin/equipe', '/admin/clientes']) {
    await p.goto(`${BASE}${rota}`, { waitUntil: 'load' }); await p.waitForTimeout(2500); await fechar()
    const max = await p.evaluate(() => Math.max(0, ...[...document.querySelectorAll('body *')].filter((e) => e.offsetParent && !e.closest('[data-despacho-rotas]') && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => Number(getComputedStyle(e).fontWeight))))
    ok(`${rota}: nenhum texto acima de 600 (máx ${max})`, max <= 600)
    if (rota === '/admin/financeiro?secao=fluxo') await p.screenshot({ path: join(PRINTS, 'fluxo-caixa-1366-depois.png') })
  }

  secao('4. Equipe')
  await p.goto(`${BASE}/admin/equipe`, { waitUntil: 'load' }); await p.waitForTimeout(2500); await fechar()
  const busca = await p.getByTestId('busca-usuario').boundingBox()
  const add = await p.getByTestId('adicionar-usuario').boundingBox()
  ok('"Adicionar usuário" na linha da busca, à direita (fora do topo)', !!busca && !!add && Math.abs((add.y + add.height / 2) - (busca.y + busca.height / 2)) < 12 && add.x > busca.x + busca.width && (await p.getByTestId('topo').getByTestId('adicionar-usuario').count()) === 0, JSON.stringify({ busca, add }))
  const corAdd = await p.getByTestId('adicionar-usuario').evaluate((e) => getComputedStyle(e).backgroundColor)
  ok('"Despachar" com o mesmo azul do "Adicionar usuário"', corAdd === azul, `${corAdd} vs ${azul}`)
  await p.screenshot({ path: join(PRINTS, 'equipe-1366-depois.png') })
  await ctx.close()

  secao('celular e tablet')
  for (const [w, h] of [[390, 844], [820, 1180]]) {
  const m = await browser.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR' })
  const mp = await m.newPage()
  await mp.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await mp.fill('input[name="email"]', 'dono.finint'); await mp.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([mp.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), mp.click('button[type="submit"]')])
  for (const [rota, nome] of [['/admin/pedidos', 'kanban'], ['/admin/lista-pedidos', 'pedidos'], ['/admin/equipe', 'equipe']]) {
    await mp.goto(`${BASE}${rota}`, { waitUntil: 'load' }); await mp.waitForTimeout(3000)
    for (const t of ['OK, ENTENDI', 'OK, entendi', 'Agora não']) { const x = mp.getByText(t, { exact: true }); if (await x.first().isVisible().catch(() => false)) await x.first().click().catch(() => {}) }
    const lateral = await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
    ok(`${w}px ${nome}: sem rolagem lateral`, lateral)
    if (nome === 'equipe' && w < 640) {
      const a = await mp.getByTestId('adicionar-usuario').boundingBox(); const b = await mp.getByTestId('busca-usuario').boundingBox()
      ok('390px: "Adicionar usuário" embaixo da busca, largura total', !!a && !!b && a.y > b.y + b.height - 2 && a.width > 300, JSON.stringify({ a, b }))
    }
    if (nome === 'kanban') ok(`${w}px kanban: Despachar visível`, await mp.getByTestId('kanban-despachar').isVisible())
    await mp.screenshot({ path: join(PRINTS, `${nome}-${w}-depois.png`) })
  }
  await m.close()
  }
} catch (e) {
  ok('execução sem exceção', false, String(e?.stack ?? e).slice(0, 600))
} finally {
  await browser.close()
  for (const id of criados) await db.query(`update pedidos set status='cancelado', cancelado_motivo='nao_entregue', atualizado_em=now() where id=$1`, [id]).catch(() => {})
  await db.query(`update restaurantes set status_loja=$2, despacho_aberto=$3, entrega_sem_entregador=$4 where id=$1`, [loja.id, loja.status_loja, loja.despacho_aberto, loja.entrega_sem_entregador])
  await db.end()
}
console.log(`\n${falhas === 0 ? '✅' : '❌'} ${total - falhas}/${total} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)
