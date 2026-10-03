/**
 * E2E da navegação em pilha do PDV/Mesas (2026-10-01): uma tela por vez, "← Voltar" pelo
 * botão, pela tecla Esc e pelo voltar do navegador (a tela de trás volta igual), "X" que
 * só confirma com dado não salvo, toast depois da ação, e os três fluxos do pedido:
 *
 *   1. Mesa → Conta → Receber → Voltar → Fechar → etapas → Pagamento → concluir
 *   2. Balcão → Pedido → Receber e fechar
 *   3. PDV com pagamento dividido
 *
 * Depois, a casca das telas em 1024×768, 1280×800, 1366×768, 1920×1080 e celular.
 * Servidor e banco LOCAIS, loja isolada:
 *
 *   E2E_LOJA=cantina-e2e E2E_VIZINHA=vizinha-e2e E2E_SUFIXO=e2e node scripts/seguranca/e2e-pdv-navegacao.mjs
 */
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { E2E_LOJA, USU, exigirLojaIsolada } from './e2e-ambiente.mjs'

/** Balcão (0135): forma de pagamento antes de lançar — "Dinheiro, sem troco", o que o sistema gravava antes. */
async function escolherPagamentoPdv(p) {
  await p.waitForTimeout(500)
  const bloco = p.getByTestId('pdv-pagamento')
  if (!(await bloco.isVisible().catch(() => false))) return
  await p.getByTestId('pdv-pag-dinheiro').click()
  await p.getByTestId('pdv-troco-nao').click()
}

exigirLojaIsolada()

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== null && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (sql, p = []) => (await db.query(sql, p)).rows
const um = async (sql, p = []) => (await q(sql, p))[0]

const loja = (await um(`select id, pdv_v2 from restaurantes where slug='${E2E_LOJA}'`))
await db.query(`update comandas set status='cancelada', cancelada_motivo='limpeza e2e navegação', fechada_em=now() where restaurante_id=$1 and status='aberta'`, [loja.id])
await db.query(`update mesas set limpeza_desde=null, limpeza_comanda_id=null, bloqueada_em=null where restaurante_id=$1 and nome like 'Mesa%'`, [loja.id])
await db.query(`update restaurantes set pdv_v2=true, modulo_mesas_ativo=true, status_loja='aberto_manual' where id=$1`, [loja.id])
const AGUA = await um(`select id, nome, preco from itens_cardapio where restaurante_id=$1 and nome='Água com Gás'`, [loja.id])
const brl = (n) => `R$ ${Number(n).toFixed(2).replace('.', ',')}`
const virgula = (n) => Number(n).toFixed(2).replace('.', ',')

const browser = await chromium.launch()
async function logar(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', USU.dono)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }), page.click('button[type="submit"]')])
  return page
}
const dispensar = (page) => page.getByRole('button', { name: /ok, entendi/i }).click({ timeout: 2500 }).catch(() => {})
const irPdv = async (page) => { await page.goto(`${BASE}/admin/pdv`, { waitUntil: 'networkidle' }); await dispensar(page) }

/** Uma janela grande por vez: a do TOPO está no ponto central e as grandes de baixo ficam ocultas. */
const telaUnica = (page) =>
  page.evaluate(() => {
    const telas = [...document.querySelectorAll('[data-tela-pdv]')]
    const topo = telas[telas.length - 1]
    if (!topo) return { n: 0, ok: false }
    const noCentro = document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('[data-tela-pdv]')
    // 2026-10-01: o fundo da página aparece escurecido atrás; as janelas GRANDES de baixo ficam ocultas.
    const debaixoOcultas = telas.slice(0, -1).every((t) => t.getAttribute('data-tamanho') === 'pequena' || getComputedStyle(t).visibility === 'hidden')
    return { n: telas.length, ok: noCentro === topo && debaixoOcultas, titulo: topo.querySelector('[data-testid="tela-titulo"]')?.textContent }
  })
const qtdTelas = (page) => page.locator('[data-tela-pdv]').count()

async function lancarAgua(page) {
  await page.getByTestId('pdv-lancar').waitFor()
  await page.getByRole('button', { name: new RegExp(AGUA.nome) }).first().click()
  await escolherPagamentoPdv(page); await page.getByTestId('pdv-lancar').click()
  await page.getByText(/lançado em/).first().waitFor({ timeout: 15000 })
  await esperar(500)
}
async function abrirBalcao(page, nome) {
  await irPdv(page)
  await page.getByTestId('card-balcao').click()
  await page.getByTestId('balcao-novo').click()
  await page.getByTestId('balcao-modalidade-retirada').click()
  await page.getByTestId('balcao-nome').fill(nome)
  await page.getByTestId('balcao-abrir').click()
  await lancarAgua(page)
  await page.getByTestId('pdv-ver-conta').click()
  await page.getByTestId('conta-tela').waitFor()
  return um(`select id, senha from comandas where restaurante_id=$1 and cliente_nome=$2 and status='aberta' order by aberta_em desc limit 1`, [loja.id, nome])
}
/** Decide como entregues as pendências da cozinha na tela "Fechar conta". */
async function entregarPendencias(page) {
  const botoes = page.locator('[data-testid^="fechar-pendencia-"][data-testid$="-entregue"]')
  // As pendências chegam depois da tela: espera a primeira (conta sem pendência segue).
  await botoes.first().waitFor({ timeout: 8000 }).catch(() => {})
  const n = await botoes.count()
  for (let i = 0; i < n; i++) await botoes.nth(i).click()
  await page.getByTestId('fechar-restante-topo').waitFor({ timeout: 15000 })
}

try {
  // ════════════════════════════════════════════════════════════════════════════
  secao('1. Mesa → Conta → Receber → Voltar → Fechar → etapas → Pagamento → concluir')
  const p = await logar({ width: 1366, height: 768 })
  const mesa = await um(
    `select m.id, m.nome from mesas m where m.restaurante_id=$1 and m.ativa and m.bloqueada_em is null
       and not exists (select 1 from comandas c where c.mesa_id=m.id and c.status='aberta') order by m.ordem limit 1`, [loja.id])
  await irPdv(p)
  await p.getByRole('button', { name: new RegExp(mesa.nome) }).first().click()
  await p.getByTestId('mesa-nome').fill('TESTE Navegação Mesa')
  await p.getByTestId('mesa-abrir').click()
  await lancarAgua(p)
  await p.getByTestId('pdv-ver-conta').click()
  await p.getByTestId('conta-tela').waitFor()
  const cm = await um(`select id from comandas where mesa_id=$1 and status='aberta'`, [mesa.id])
  let t = await telaUnica(p)
  ok('conta abre como UMA janela (no topo)', t.n === 1 && t.ok, `${t.n} tela(s)`)

  // dado digitado na conta, para conferir que ela volta igual
  await p.getByTestId('conta-cupom-codigo').fill('PRESERVA1')
  await p.getByTestId('conta-receber').click()
  await p.getByTestId('receber-tela').waitFor()
  t = await telaUnica(p)
  ok('Receber cobre a conta: só uma tela visível', t.n === 2 && t.ok && t.titulo === 'Receber', `${t.n} montadas, topo "${t.titulo}"`)
  const caminho = await p.getByTestId('receber-tela').getByTestId('tela-caminho').innerText()
  ok('caminho com o identificador ("Mesa … › Receber")', caminho.includes(mesa.nome), caminho)
  const bt = await p.getByTestId('receber-registrar').boundingBox()
  ok('botão principal do Receber ≥ 56 px e dentro da tela', bt && bt.height >= 56 && bt.y + bt.height <= 768, bt && `${Math.round(bt.height)} px`)
  const formaBox = await p.getByTestId('forma-pix').boundingBox()
  ok('formas de pagamento em botão grande (≥ 60 px)', formaBox && formaBox.height >= 60, formaBox && `${Math.round(formaBox.height)} px`)

  // Voltar pelo botão
  await p.getByTestId('receber-tela').getByTestId('tela-voltar').click()
  await p.getByTestId('receber-tela').waitFor({ state: 'detached' })
  ok('Voltar (botão) → conta, com o que foi digitado', (await p.getByTestId('conta-cupom-codigo').inputValue()) === 'PRESERVA1')
  // Voltar pelo Esc
  await p.getByTestId('conta-receber').click()
  await p.getByTestId('receber-tela').waitFor()
  await p.keyboard.press('Escape')
  await p.getByTestId('receber-tela').waitFor({ state: 'detached' })
  ok('Voltar (Esc) → conta, sem fechar a conta', (await qtdTelas(p)) === 1 && (await p.getByTestId('conta-cupom-codigo').inputValue()) === 'PRESERVA1')
  // Voltar do navegador
  await p.getByTestId('conta-receber').click()
  await p.getByTestId('receber-tela').waitFor()
  await p.goBack()
  await p.getByTestId('receber-tela').waitFor({ state: 'detached' })
  await esperar(300)
  ok('Voltar (navegador) → conta, na mesma página', (await qtdTelas(p)) === 1 && new URL(p.url()).pathname === '/admin/pdv' && (await p.getByTestId('conta-cupom-codigo').inputValue()) === 'PRESERVA1')

  // X com dado não salvo pede confirmação DENTRO da tela
  await p.getByTestId('conta-receber').click()
  await p.getByTestId('receber-tela').waitFor()
  await p.getByTestId('receber-valor').fill('1,00')
  await p.getByTestId('receber-tela').getByTestId('tela-fechar-tudo').click()
  await p.getByTestId('tela-confirmar-fechar').waitFor()
  ok('X com valor digitado → "Descartar o que não foi salvo?"', (await p.getByTestId('tela-confirmar-fechar').innerText()).includes('Descartar'))
  await p.getByTestId('tela-confirmar-fechar').getByRole('button', { name: /Continuar aqui/ }).click()
  ok('"Continuar aqui" mantém o valor digitado', (await p.getByTestId('receber-valor').inputValue()) === '1,00')
  await p.getByTestId('receber-valor').fill('999,00')
  await p.getByTestId('forma-pix').click()
  await p.getByTestId('receber-registrar').click()
  const erro = await p.getByTestId('receber-erro').innerText()
  ok('erro diz o que fazer ("Valor maior que o restante. Máximo: …")', /Valor maior que o restante\. Máximo: R\$/.test(erro), erro)

  // pagamento parcial → volta à conta com toast
  await p.getByTestId('receber-valor').fill('1,00')
  await p.getByTestId('receber-registrar').click()
  await p.getByTestId('receber-tela').waitFor({ state: 'detached', timeout: 15000 })
  const toast = (await p.getByTestId('conta-aviso').innerText({ timeout: 10000 })).replace(/\s+/g, ' ')
  ok('depois de registrar: volta à conta com "Pagamento de R$ 1,00 registrado"', toast.includes('Pagamento de R$ 1,00 registrado'), toast)
  ok('pagamento gravado', Number((await um(`select count(*) n from pagamentos_comanda where comanda_id=$1 and estornado_em is null`, [cm.id])).n) === 1)

  // X sem dado não salvo: fecha tudo sem perguntar
  await p.getByTestId('conta-receber').click()
  await p.getByTestId('receber-tela').waitFor()
  await p.getByTestId('receber-tela').getByTestId('tela-fechar-tudo').click()
  await esperar(500)
  ok('X sem nada digitado fecha a pilha inteira, sem perguntar', (await qtdTelas(p)) === 0 && (await p.getByTestId('tela-confirmar-fechar').count()) === 0)

  // reabre a conta e fecha pelas etapas
  await p.getByTestId('pdv-ver-conta').click()
  await p.getByTestId('conta-tela').waitFor()
  await p.getByTestId('conta-fechar').click()
  await p.getByTestId('fechar-modal').waitFor()
  t = await telaUnica(p)
  ok('Fechar conta é a tela do topo', t.ok && t.titulo === 'Fechar conta')
  await p.getByTestId('fechar-modal').getByTestId('tela-voltar').click()
  await p.getByTestId('fechar-modal').waitFor({ state: 'detached' })
  ok('Voltar do Fechar → conta', (await qtdTelas(p)) === 1)
  await p.getByTestId('conta-fechar').click()
  await p.getByTestId('fechar-modal').waitFor()
  await entregarPendencias(p, cm.id)
  await p.getByTestId('fechar-pag-0-forma-pix').click()
  await p.getByTestId('fechar-atalhos').getByRole('button', { name: 'Exato' }).click()
  await p.getByTestId('fechar-confirmar').click()
  await p.getByTestId('resumo-encerramento').waitFor({ timeout: 20000 })
  ok('concluir → resumo da conta fechada', /Conta fechada/.test(await p.getByTestId('resumo-encerramento').innerText()))
  await p.getByTestId('resumo-encerramento').getByRole('button', { name: /Ok/ }).click()
  await esperar(800)
  ok('Ok → volta à tela base (nenhuma tela por cima)', (await qtdTelas(p)) === 0)
  const toastFim = (await p.getByTestId('toast-pdv').innerText().catch(() => '')).replace(/\s+/g, ' ')
  ok('volta com toast "Conta fechada · Mesa …"', toastFim.startsWith('Conta fechada') && toastFim.includes(mesa.nome), toastFim)
  ok('comanda da mesa fechada no banco', (await um(`select status from comandas where id=$1`, [cm.id])).status === 'fechada')
  await p.context().close()

  // ════════════════════════════════════════════════════════════════════════════
  secao('2. Balcão → Pedido → Receber e fechar')
  const b = await logar({ width: 1280, height: 800 })
  const cb = await abrirBalcao(b, 'TESTE Navegação Balcão')
  await b.getByTestId('conta-receber').click()
  await b.getByTestId('receber-tela').waitFor()
  const cbCaminho = await b.getByTestId('receber-tela').getByTestId('tela-caminho').innerText()
  ok('caminho do balcão com a senha', cbCaminho.includes(`Senha ${cb.senha}`), cbCaminho)
  await b.getByTestId('forma-dinheiro').click()
  await b.getByTestId('receber-atalho-50').click()
  const troco = (await b.getByTestId('receber-troco').innerText()).replace(/\s+/g, ' ')
  ok('atalho R$ 50 no dinheiro mostra o troco grande', troco.includes(brl(50 - Number(AGUA.preco))), troco)
  await b.getByTestId('receber-valor').fill(virgula(AGUA.preco))
  await b.getByTestId('receber-registrar-fechar').click()
  await b.getByTestId('fechar-modal').waitFor({ timeout: 15000 })
  await entregarPendencias(b, cb.id)
  await b.getByTestId('fechar-confirmar').click()
  await b.getByTestId('resumo-encerramento').waitFor({ timeout: 20000 })
  await b.getByTestId('resumo-encerramento').getByRole('button', { name: /Ok/ }).click()
  await esperar(800)
  const fb = await um(`select status from comandas where id=$1`, [cb.id])
  ok('Receber e fechar: conta fechada e de volta à Central', fb.status === 'fechada' && (await qtdTelas(b)) === 0, fb.status)
  await b.context().close()

  // ════════════════════════════════════════════════════════════════════════════
  secao('3. PDV: pagamento dividido')
  const d = await logar({ width: 1024, height: 768 })
  const cd = await abrirBalcao(d, 'TESTE Navegação Dividido')
  await d.getByTestId('conta-fechar').click()
  await d.getByTestId('fechar-modal').waitFor()
  await entregarPendencias(d, cd.id)
  const parte1 = Math.round(Number(AGUA.preco) * 50) / 100
  await d.getByTestId('fechar-pag-0-forma-pix').click()
  await d.getByTestId('fechar-pag-0-valor').fill(virgula(parte1))
  await d.getByTestId('fechar-add-pagamento').click()
  await d.getByTestId('fechar-pag-1-forma-dinheiro').click()
  await d.getByTestId('fechar-pag-1-valor').fill(virgula(Number(AGUA.preco) - parte1))
  const confirmar = await d.getByTestId('fechar-confirmar').boundingBox()
  ok('1024×768: botão Fechar conta visível sem rolar', confirmar && confirmar.y + confirmar.height <= 768)
  await d.getByTestId('fechar-confirmar').click()
  await d.getByTestId('resumo-encerramento').waitFor({ timeout: 20000 })
  await d.getByTestId('resumo-encerramento').getByRole('button', { name: /Ok/ }).click()
  await esperar(800)
  const pags = await q(`select forma from pagamentos_comanda where comanda_id=$1 and estornado_em is null order by forma`, [cd.id])
  const fd = await um(`select status from comandas where id=$1`, [cd.id])
  ok('dois pagamentos (pix + dinheiro) e conta fechada', fd.status === 'fechada' && pags.map((x) => x.forma).join(',') === 'dinheiro,pix', `${fd.status} · ${pags.map((x) => x.forma).join(',')}`)
  await d.context().close()

  // ════════════════════════════════════════════════════════════════════════════
  secao('4. Casca das telas por resolução')
  for (const [w, h] of [[1024, 768], [1280, 800], [1366, 768], [1920, 1080], [390, 844]]) {
    const r = await logar({ width: w, height: h })
    await irPdv(r)
    await r.getByTestId('card-balcao').click()
    await r.getByTestId('balcao-novo').click()
    await r.locator('[data-tela-pdv]').last().waitFor()
    await esperar(300)
    const m = await r.evaluate(() => {
      const tela = [...document.querySelectorAll('[data-tela-pdv]')].pop()
      const painel = tela.firstElementChild.getBoundingClientRect()
      const voltar = tela.querySelector('[data-testid="tela-voltar"]').getBoundingClientRect()
      const x = tela.querySelector('[data-testid="tela-fechar-tudo"]').getBoundingClientRect()
      const botoes = [...tela.querySelectorAll('button')].filter((b) => b.offsetParent && !b.closest('header'))
      const ultimo = botoes[botoes.length - 1]?.getBoundingClientRect()
      return {
        largura: painel.width, altura: painel.height,
        voltar: voltar.height, x: x.height,
        rodapeDentro: ultimo ? ultimo.bottom <= innerHeight + 1 : false,
        semRolagemLateral: document.documentElement.scrollWidth <= innerWidth,
      }
    })
    const esperado = w < 640 ? m.largura >= w - 1 : m.largura >= Math.min(w * 0.55, 700) && m.largura <= 1200
    ok(`${w}×${h}: tela grande, Voltar/X ≥ 48 px, ações à vista, sem rolagem lateral`,
      esperado && m.voltar >= 48 && m.x >= 48 && m.rodapeDentro && m.semRolagemLateral,
      `${Math.round(m.largura)}×${Math.round(m.altura)} · voltar ${Math.round(m.voltar)} · x ${Math.round(m.x)}`)
    await r.context().close()
  }
} catch (e) {
  console.error(e)
  for (const ctx of browser.contexts()) for (const pg of ctx.pages()) await pg.screenshot({ path: 'docs/pdv-navegacao/prints/erro-e2e.png' }).catch(() => {})
  res.push(false)
} finally {
  await db.query(`update comandas set status='cancelada', cancelada_motivo='TESTE navegação', fechada_em=now() where restaurante_id=$1 and status='aberta' and cliente_nome like 'TESTE Navegação%'`, [loja.id]).catch(() => {})
  await db.query(`update restaurantes set pdv_v2=$2 where id=$1`, [loja.id, loja.pdv_v2])
  await browser.close()
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
