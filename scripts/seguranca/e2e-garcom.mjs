/**
 * E2E do painel do garçom, com login real pelo navegador (Playwright).
 *
 * Prova, contra a stack local:
 *  1. garçom lança pela tela → nasce UM pedido oficial, canal 'mesa', na comanda certa,
 *     com quem lançou, na fila de impressão;
 *  2. a seleção do cliente continua separada e não é importada;
 *  3. anônimo, atendente do delivery e mesa de outra loja são recusados;
 *  4. a rota pública do delivery recusa `origem`/`canal` forjados.
 *
 * Só loopback.  node scripts/seguranca/e2e-garcom.mjs
 */

import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)

// Estado conhecido: cada suíte semeia a própria base (as outras deixam contas abertas).
execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
}

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows

const loja = (await q(`select id from restaurantes where slug='cantina-demo'`))[0].id
const mesa01 = (await q(`select id, token from mesas where restaurante_id=$1 and nome='Mesa 01'`, [loja]))[0]
const burger = (await q(`select id from itens_cardapio where restaurante_id=$1 and nome='Risoto de Funghi'`, [loja]))[0].id

const browser = await chromium.launch()

async function logar(usuario) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'pt-BR' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL(/\/admin\//, { timeout: 30000 }), page.click('button[type="submit"]')])
  return { ctx, page }
}

/** POST na rota de lançamento DENTRO da sessão do navegador (cookie de verdade). */
async function lancar(page, mesaId, itemId) {
  return page.evaluate(
    async ({ mesaId, itemId }) => {
      const r = await fetch(`/api/admin/mesas/${mesaId}/lancamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Chave de idempotência obrigatória desde a 0065: sem ela a rota responde 400
        // antes de chegar às checagens que este teste quer ver (403, 404, 409).
        body: JSON.stringify({
          chaveIdempotencia: crypto.randomUUID(),
          itens: [{ itemId, quantidade: 1, observacao: '', complementos: [] }],
        }),
      })
      return { status: r.status, corpo: await r.json().catch(() => ({})) }
    },
    { mesaId, itemId },
  )
}

// ── 0. seleção do cliente na Mesa 01, antes de tudo ─────────────────────────
console.log('\n── cliente marca itens pelo QR ──')
{
  const disp = crypto.randomUUID()
  const r = await fetch(`${BASE}/api/mesa/${mesa01.token}/selecao`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dispositivo: disp, itens: [{ itemId: burger, quantidade: 2, observacao: 'bem quente', opcoes: [] }] }),
  })
  ok('cliente grava a seleção', r.status === 200, `HTTP ${r.status}`)
}

const antes = {
  pedidos: (await q(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja]))[0].n,
  comandasMesa01: (await q(`select count(*)::int n from comandas where mesa_id=$1`, [mesa01.id]))[0].n,
}
ok('a seleção do cliente não criou pedido', antes.comandasMesa01 === 0, `comandas na Mesa 01: ${antes.comandasMesa01}`)

// ── 1. garçom lança pela TELA ───────────────────────────────────────────────
console.log('\n── garçom lança pela tela ──')
const garcom = await logar('garcom.local')
await garcom.page.goto(`${BASE}/admin/mesas/${mesa01.id}`, { waitUntil: 'networkidle' })
await garcom.page.waitForSelector('text=Lançamento', { timeout: 20000 })

const naoLancado = await garcom.page.locator('text=Não lançado').count()
ok('seleção do cliente aparece como "Não lançado"', naoLancado > 0)
ok('a seleção mostra o que o cliente marcou', (await garcom.page.locator('text=bem quente').count()) > 0)

await garcom.page.screenshot({ path: '.shots/garcom-01-mesa-com-selecao.png' })

// O garçom escolhe à mão, no catálogo dele.
await garcom.page.locator('button', { hasText: 'Pratos' }).first().click()
await garcom.page.locator('button', { hasText: 'Risoto de Funghi' }).first().click()
await garcom.page.locator('button', { hasText: 'Risoto de Funghi' }).first().click()
await garcom.page.waitForTimeout(300)
await garcom.page.screenshot({ path: '.shots/garcom-02-lancamento-montado.png' })

await garcom.page.locator('button', { hasText: 'Enviar para a cozinha' }).click()
// Espera o TÍTULO do modal de sucesso. `text=enviado` sozinho casava com "nem enviado
// à cozinha", do bloco da seleção do cliente, e o teste seguia antes da resposta.
await garcom.page.waitForSelector('h2:has-text("Pedido #")', { timeout: 30000 })
await garcom.page.screenshot({ path: '.shots/garcom-03-enviado.png' })

// E confirma no banco, que é o que vale.
for (let i = 0; i < 30; i++) {
  const n = (await q(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja]))[0].n
  if (n > antes.pedidos) break
  await new Promise((r) => setTimeout(r, 500))
}
// Fecha o modal de sucesso, senão ele cobre os próximos cliques.
await garcom.page.locator('button', { hasText: 'Fechar' }).click()
await garcom.page.waitForTimeout(300)

const novos = await q(
  `select id, numero, canal, origem, tipo, comanda_id, mesa, criado_por_nome, impresso, total
     from pedidos where restaurante_id=$1 order by criado_em desc limit 1`, [loja])
const p = novos[0]
const depoisPedidos = (await q(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja]))[0].n
ok('nasceu exatamente UM pedido', depoisPedidos === antes.pedidos + 1, `${antes.pedidos} → ${depoisPedidos}`)
ok('canal = mesa', p.canal === 'mesa', p.canal)
ok('sem entrega: tipo retirada', p.tipo === 'retirada', p.tipo)
ok('vinculado à Mesa 01', p.mesa === 'Mesa 01', p.mesa)
ok('registra quem lançou', p.criado_por_nome === 'Garçom Demo', p.criado_por_nome)
ok('entra na fila de impressão (impresso=false)', p.impresso === false)
ok('quantidade 2 somada numa linha, preço do catálogo', Number(p.total) === 108, `total ${p.total}`)

const comanda = (await q(`select id, mesa_id, status from comandas where id=$1`, [p.comanda_id]))[0]
ok('entrou na comanda da Mesa 01', comanda?.mesa_id === mesa01.id && comanda.status === 'aberta')

const itens = await q(`select nome, quantidade from pedido_itens where pedido_id=$1`, [p.id])
ok('itens do pedido gravados', itens.length === 1 && itens[0].quantidade === 2, JSON.stringify(itens))

const sessao = (await q(`select comanda_id from sessoes_mesa where mesa_id=$1 and status='aberta'`, [mesa01.id]))[0]
ok('a sessão da mesa passou a apontar para a comanda', sessao?.comanda_id === p.comanda_id)

const audit = await q(`select usuario_nome, acao from eventos_auditoria where entidade_id=$1`, [p.id])
ok('auditoria registrou o envio', audit.some((a) => a.acao === 'mesa.enviou_cozinha' && a.usuario_nome === 'Garçom Demo'))

// Regra corrigida no checkpoint da etapa E: depois do envio a seleção ENCERRA (sai da
// tela), mas não é apagada — o histórico fica.
const selecaoEncerrada = (await q(
  `select count(*)::int n from selecoes_mesa where mesa_id=$1 and encerrada_em is not null`, [mesa01.id]))[0].n
const selecaoAberta = (await q(
  `select count(*)::int n from selecoes_mesa where mesa_id=$1 and encerrada_em is null`, [mesa01.id]))[0].n
ok('a seleção do cliente encerrou com o envio (sem ser apagada)', selecaoEncerrada > 0 && selecaoAberta === 0, `encerradas ${selecaoEncerrada}, abertas ${selecaoAberta}`)

// ── 1b. item com etapas obrigatórias ────────────────────────────────────────
console.log('\n── item com opções obrigatórias ──')
{
  const burgerDb = (await q(`select id from itens_cardapio where restaurante_id=$1 and nome='Burger da Casa'`, [loja]))[0].id

  // Sem ponto e sem bebida: o SERVIDOR tem que recusar, mesmo que a tela seja pulada.
  const semPonto = await lancar(garcom.page, mesa01.id, burgerDb)
  ok('servidor recusa burger sem as opções obrigatórias', semPonto.status === 400, `HTTP ${semPonto.status} — ${semPonto.corpo?.error}`)

  // Pela tela: o configurador abre e só libera com as obrigatórias respondidas.
  const antesBurger = (await q(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja]))[0].n
  await garcom.page.locator('button', { hasText: 'Burgers' }).first().click()
  await garcom.page.locator('button', { hasText: 'Burger da Casa' }).first().click()
  await garcom.page.waitForSelector('text=Escolha o ponto', { timeout: 10000 })

  const botaoAdicionar = garcom.page.locator('button', { hasText: 'Adicionar ao lançamento' })
  ok('configurador trava o botão sem as obrigatórias', await botaoAdicionar.isDisabled())
  await garcom.page.screenshot({ path: '.shots/garcom-04-configurador-travado.png' })

  await garcom.page.locator('button[role="radio"]', { hasText: 'Mal passado' }).click()
  await garcom.page.locator('button[role="checkbox"]', { hasText: 'Bacon crocante' }).click()
  await garcom.page.locator('button[role="radio"]', { hasText: 'Suco de laranja' }).click()
  ok('com as obrigatórias respondidas o botão libera', !(await botaoAdicionar.isDisabled()))
  await garcom.page.screenshot({ path: '.shots/garcom-05-configurador-pronto.png' })

  await botaoAdicionar.click()
  await garcom.page.locator('button', { hasText: 'Enviar para a cozinha' }).click()
  await garcom.page.waitForSelector('h2:has-text("Pedido #")', { timeout: 30000 })
  for (let i = 0; i < 30; i++) {
    if ((await q(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja]))[0].n > antesBurger) break
    await new Promise((r) => setTimeout(r, 500))
  }

  const pb = (await q(`select id, total from pedidos where restaurante_id=$1 order by criado_em desc limit 1`, [loja]))[0]
  const itemB = (await q(`select nome, complementos from pedido_itens where pedido_id=$1`, [pb.id]))[0]
  const nomes = (itemB?.complementos ?? []).map((c) => c.nome).sort()
  ok('opções chegaram à cozinha', JSON.stringify(nomes) === JSON.stringify(['Bacon crocante', 'Mal passado', 'Suco de laranja']), nomes.join(', '))
  // 42 + bacon 8 + suco 12 = 62, reprecificado pelo servidor.
  ok('preço das opções recalculado pelo servidor', Number(pb.total) === 62, `total ${pb.total}`)
  await garcom.page.locator('button', { hasText: 'Fechar' }).click().catch(() => {})
}

// ── 1c. o que o garçom enxerga ──────────────────────────────────────────────
console.log('\n── o que o garçom enxerga ──')
{
  const g2 = await logar('garcom.local')
  ok('garçom cai em Mesas depois do login, não no faturamento', g2.page.url().includes('/admin/mesas'), g2.page.url())
  await g2.page.waitForTimeout(1500)
  const menu = await g2.page.locator('nav, aside').first().innerText().catch(() => '')
  for (const proibido of ['Dashboard', 'Clientes', 'Campanhas', 'Fidelidade', 'Ajustes', 'Integrações', 'PDV']) {
    ok(`menu do garçom sem "${proibido}"`, !menu.includes(proibido))
  }
  ok('menu do garçom tem "Mesas e Comandas"', menu.includes('Mesas e Comandas'))
  ok('garçom não vê contador de pendências de configuração', !(await g2.page.locator('text=/\\d+ pendência/').count()))

  // O caminho real: do salão até a mesa, clicando — não digitando URL.
  await g2.page.waitForSelector('text=Mesa 01', { timeout: 15000 })
  ok('garçom não vê "Nova mesa"', (await g2.page.locator('button', { hasText: 'Nova mesa' }).count()) === 0)
  ok('garçom não vê "Desativar"', (await g2.page.locator('button', { hasText: 'Desativar' }).count()) === 0)
  ok('garçom não vê botão de QR', (await g2.page.locator('button[title="Ver QR Code"]').count()) === 0)
  await g2.page.screenshot({ path: '.shots/garcom-06-salao-do-garcom.png' })

  // Escopo no CARTÃO: um `div` com o texto "Varanda 02" casava também com a grade
  // inteira, que contém os atalhos de todas as outras mesas.
  const bloqueadaTemAtalho = await g2.page
    .locator('div.flex-col.rounded-menuzia', {
      has: g2.page.locator('span', { hasText: /^Varanda 02$/ }),
    })
    .locator('a', { hasText: /Lançar pedido|Abrir mesa/ })
    .count()
  ok('mesa bloqueada não oferece atalho de lançamento', bloqueadaTemAtalho === 0)

  await g2.page.locator('a', { hasText: /Abrir mesa|Lançar pedido/ }).first().click()
  await g2.page.waitForURL(/\/admin\/mesas\/[0-9a-f-]{36}$/, { timeout: 20000 })
  await g2.page.waitForSelector('text=Lançamento', { timeout: 20000 })
  ok('garçom chega ao painel da mesa clicando no salão', /\/admin\/mesas\/[0-9a-f-]{36}$/.test(g2.page.url()))
  await g2.ctx.close()

  const d = await logar('dono.local')
  ok('dono continua caindo no Dashboard', d.page.url().includes('/admin/dashboard'), d.page.url())
  await d.page.waitForTimeout(1500)
  const menuDono = await d.page.locator('nav, aside').first().innerText().catch(() => '')
  ok('menu do dono continua completo', ['Dashboard', 'Clientes', 'Ajustes', 'Mesas e Comandas'].every((x) => menuDono.includes(x)))
  await d.ctx.close()
}

// ── 2. quem NÃO pode lançar ─────────────────────────────────────────────────
console.log('\n── quem não pode lançar ──')
{
  const r = await fetch(`${BASE}/api/admin/mesas/${mesa01.id}/lancamento`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itens: [{ itemId: burger, quantidade: 1 }] }),
  })
  ok('anônimo é recusado', r.status === 401, `HTTP ${r.status}`)
}
{
  const atendente = await logar('atendente.local')
  const r = await lancar(atendente.page, mesa01.id, burger)
  ok('atendente do delivery é recusado (sem permissão de mesa)', r.status === 403, `HTTP ${r.status}`)
  await atendente.ctx.close()
}
{
  // Loja vizinha criada aqui mesmo: sem ela o teste seria pulado, e teste pulado não
  // prova nada.
  const vizinha = (await q(
    `insert into restaurantes (nome, slug) values ('Loja Vizinha','loja-vizinha-e2e')
     on conflict (slug) do update set nome = excluded.nome returning id`))[0].id
  const mesaVizinha = (await q(
    `insert into mesas (restaurante_id, nome, ordem) values ($1,'Mesa Vizinha',0) returning id`, [vizinha]))[0].id
  const antesVizinha = (await q(`select count(*)::int n from pedidos where restaurante_id=$1`, [vizinha]))[0].n
  const r = await lancar(garcom.page, mesaVizinha, burger)
  const depoisVizinha = (await q(`select count(*)::int n from pedidos where restaurante_id=$1`, [vizinha]))[0].n
  ok('mesa de outra loja é recusada', r.status === 404 && depoisVizinha === antesVizinha, `HTTP ${r.status}`)
}
{
  const bloqueada = (await q(`select id from mesas where restaurante_id=$1 and bloqueada_em is not null limit 1`, [loja]))[0]
  const r = await lancar(garcom.page, bloqueada.id, burger)
  ok('mesa bloqueada é recusada', r.status === 409, `HTTP ${r.status}`)
}
{
  const r = await lancar(garcom.page, mesa01.id, '00000000-0000-4000-8000-000000000000')
  ok('item inexistente é recusado', r.status === 400, `HTTP ${r.status}`)
}

// ── 3. rota pública do delivery não aceita canal forjado ────────────────────
console.log('\n── delivery não aceita campo interno ──')
// Recontado AQUI: as seções anteriores criam pedidos legítimos (o burger da 1b).
const antesForjados = (await q(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja]))[0].n
for (const [campo, valor] of [['origem', 'pdv'], ['canal', 'mesa'], ['comandaId', p.comanda_id]]) {
  const r = await fetch(`${BASE}/api/loja/cantina-demo/pedido`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tipo: 'retirada', cliente: { nome: 'X', telefone: '5527999990000' },
      endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
      pagamento: 'dinheiro', trocoPara: null, itens: [{ itemId: burger, quantidade: 1 }],
      [campo]: valor,
    }),
  })
  ok(`pedido público com ${campo} forjado → 422`, r.status === 422, `HTTP ${r.status}`)
}
const finalPedidos = (await q(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja]))[0].n
ok('as tentativas recusadas não criaram pedido', finalPedidos === antesForjados, `${antesForjados} → ${finalPedidos}`)

await garcom.ctx.close()
await browser.close()
await db.end()

const falhas = res.filter((r) => !r).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram\n`)
process.exit(falhas ? 1 : 0)
