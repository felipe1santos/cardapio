/**
 * E2E LOCAL da tela nova de Impressão (2026-10-05): duas opções, situação, modelos em janela.
 * Servidor e banco LOCAIS (cantina-demo); o estado de impressão da loja é guardado no início e
 * devolvido no fim. Nada imprime.
 *
 *   node scripts/impressao/e2e-tela-impressao.mjs
 *
 * Confere:
 *   · a opção é a do modo de hoje (teste = antigo); trocar pede confirmação e grava auditado;
 *   · Beta sem computador conectado: abre o passo a passo e o "Ativar" fica travado;
 *   · Beta pronto: confirma, grava "cozinha_caixa"; voltar ao antigo grava "teste";
 *   · versão antiga do Beta: aviso "Atualizar para o beta.9"; via da cozinha começa desligada;
 *   · modelos em janela no centro, no tamanho do papel, com abas sem fechar; Esc fecha e o foco
 *     volta; a prévia é IGUAL (pixel a pixel) ao desenho do Assistente com os mesmos dados;
 *   · opção antiga: só "Ver comanda", com o desenho do Assistente antigo;
 *   · contraste dos selos e botões ≥ 4,5:1; celular 360/390/430 sem rolagem lateral.
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import sharp from 'sharp'
import { chromium } from 'playwright'
import { USU } from '../seguranca/e2e-ambiente.mjs'
import { renderizarTicket, fecharRender } from './render-ticket.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE) || !/@(127\.0\.0\.1|localhost):/.test(DB)) throw new Error('só servidor e banco locais')
const SHOTS = 'docs/impressao-tela-nova/e2e'
mkdirSync(SHOTS, { recursive: true })
const require = createRequire(import.meta.url)
const { montarComandaV3, montarPreContaV3 } = require('../../printer-agent/src/v3.js')
const { pedidoDemonstracao, contaDemonstracao } = await import(pathToFileURL(new URL('../../lib/impressao/demonstracao.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href)

let falhas = 0
const ok = (n, c, d = '') => { if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const db = new pg.Client(DB)
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const L = (await um("select id from restaurantes where slug = 'cantina-demo'")).id
const antes = await um('select impressao_beta_modo, impressao_beta_liberado, impressao_cozinha_por_funcao, impressao_via_cozinha from restaurantes where id = $1', [L])
const funcoesAntes = (await db.query('select funcao, dispositivo_id from impressao_funcoes where restaurante_id = $1', [L])).rows
const NOME_AG = 'E2E Tela Impressão'
const limpar = async () => {
  await db.query('delete from impressao_funcoes where restaurante_id = $1', [L])
  for (const f of funcoesAntes) await db.query('insert into impressao_funcoes (restaurante_id, funcao, dispositivo_id) values ($1, $2, $3)', [L, f.funcao, f.dispositivo_id])
  await db.query('delete from impressao_dispositivos where agente_id in (select id from impressao_agentes where restaurante_id = $1 and nome = $2)', [L, NOME_AG])
  await db.query('delete from impressao_agentes where restaurante_id = $1 and nome = $2', [L, NOME_AG])
  await db.query('update restaurantes set impressao_beta_modo = $2, impressao_beta_liberado = $3, impressao_cozinha_por_funcao = $4, impressao_via_cozinha = $5 where id = $1', [L, antes.impressao_beta_modo, antes.impressao_beta_liberado, antes.impressao_cozinha_por_funcao, antes.impressao_via_cozinha])
}
await limpar()
await db.query("update restaurantes set impressao_beta_modo = 'teste', impressao_cozinha_por_funcao = false, impressao_beta_liberado = true where id = $1", [L])
// Sem computador ativo (os da loja demo ficam desconectados durante o teste).
await db.query('delete from impressao_funcoes where restaurante_id = $1', [L])

const contraste = (a, b) => {
  const lum = (h) => { const c = h.match(/\d+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', USU.dono)
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  const abrir = async () => {
    await p.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
    await p.getByTestId('card-opcao').waitFor({ timeout: 20000 })
    await p.waitForTimeout(600)
  }

  console.log('── Opção de hoje e troca ──')
  await abrir()
  ok('loja em "Somente teste" aparece no Assistente antigo', (await p.getByTestId('opcao-antigo').getAttribute('aria-checked')) === 'true' && (await p.getByTestId('opcao-beta').getAttribute('aria-checked')) === 'false')
  ok('antigo: só "Ver comanda" (sem pré-conta e via da cozinha)', (await p.getByTestId('ver-comanda').count()) === 1 && (await p.getByTestId('ver-pre_conta').count()) === 0 && (await p.getByTestId('ver-via_cozinha').count()) === 0)
  ok('situação do antigo com selo e aviso de um botão', (await p.getByTestId('situacao-selo').count()) === 1 && (await p.getByTestId('situacao-acao').count()) <= 1)
  await p.screenshot({ path: `${SHOTS}/antigo-1366.png`, fullPage: false })

  // Beta sem computador: passo a passo, "Ativar" travado; Esc fecha; nada muda.
  await p.getByTestId('opcao-beta').click()
  await p.getByTestId('ativar-beta').waitFor({ timeout: 5000 })
  const passos = await p.getByTestId('ativar-passos').locator('li').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-feito')))
  // A loja demo já tem um computador pareado (sem sinal): 'instalar' conta como feito.
  const temPc = !!(await um('select 1 from impressao_agentes where restaurante_id = $1 and revogado_em is null', [L]))
  ok('Beta sem computador conectado: abre o passo a passo (conectar e impressoras pendentes)', passos.length === 3 && passos[0] === (temPc ? 'sim' : 'nao') && passos[1] === 'nao' && passos[2] === 'nao', passos.join(','))
  ok('"Ativar Assistente Beta" travado enquanto falta passo', await p.getByTestId('ativar-confirmar').isDisabled())
  await p.screenshot({ path: `${SHOTS}/ativar-beta-1366.png` })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  ok('Esc fecha o passo a passo e nada muda no banco', (await p.getByTestId('ativar-beta').count()) === 0 && (await um('select impressao_beta_modo m from restaurantes where id = $1', [L])).m === 'teste')

  // Computador "conectado" (sinal recente) no beta.6 com a impressora da Cozinha.
  const ag = await um("insert into impressao_agentes (restaurante_id, nome, versao, credencial_hash, visto_em) values ($1, $2, '0.2.0-beta.6', encode(sha256(gen_random_uuid()::text::bytea), 'hex'), now()) returning id", [L, NOME_AG])
  const dsp = await um("insert into impressao_dispositivos (restaurante_id, agente_id, nome_sistema, largura_mm, disponivel, visto_em) values ($1, $2, 'POS-80 E2E', 80, true, now()) returning id", [L, ag.id])
  await db.query("insert into impressao_funcoes (restaurante_id, funcao, dispositivo_id) values ($1, 'cozinha', $2), ($1, 'caixa', $2)", [L, dsp.id])
  const sinal = setInterval(() => { db.query('update impressao_agentes set visto_em = now() where id = $1', [ag.id]).catch(() => {}) }, 3000)
  try {
    await abrir()
    await p.getByTestId('opcao-beta').click()
    await p.getByTestId('confirmar-opcao').waitFor({ timeout: 5000 })
    ok('Beta pronto: confirmação simples com o texto combinado', (await p.getByTestId('confirmar-opcao-texto').innerText()).includes('Sua loja vai passar a imprimir pelo Assistente Beta. Ele precisa estar instalado e conectado.'))
    await p.getByTestId('confirmar-opcao-ok').click()
    await p.waitForTimeout(1500)
    const m = await um('select impressao_beta_modo m, impressao_cozinha_por_funcao c from restaurantes where id = $1', [L])
    ok('grava "Cozinha e Caixa" (comanda e pré-conta no Beta)', m.m === 'cozinha_caixa' && m.c === true, JSON.stringify(m))
    const aud = await um("select dados from eventos_auditoria where restaurante_id = $1 and acao = 'impressao.modo_alterado' order by criado_em desc limit 1", [L])
    ok('troca auditada (de teste para cozinha_caixa)', aud?.dados?.de === 'teste' && aud?.dados?.para === 'cozinha_caixa', JSON.stringify(aud?.dados))
    await abrir()
    ok('agora o Beta está "Em uso"', (await p.getByTestId('opcao-beta').getAttribute('aria-checked')) === 'true')
    ok('beta.6: aviso "Atualizar para o beta.9"', (await p.getByTestId('situacao-acao').innerText()).includes('beta.9'))
    ok('versão na situação = 0.2.0-beta.6 com selo âmbar', (await p.getByTestId('sit-versao').innerText()).includes('0.2.0-beta.6') && (await p.getByTestId('situacao-selo').innerText()) !== 'Tudo certo')
    ok('via da cozinha começa DESLIGADA', (await p.getByTestId('opcao-viaCozinha').getAttribute('aria-checked')) === 'false' && (await um('select impressao_via_cozinha v from restaurantes where id = $1', [L])).v === false)
    await p.screenshot({ path: `${SHOTS}/beta-1366.png` })

    console.log('── Modelos em janela ──')
    const dados = await p.evaluate(async () => (await fetch('/api/admin/impressao/previa')).json())
    // Mesmas opções da loja e a mesma logo que a janela usa.
    const r0 = await um('select impressao_mostrar_numero_item a, impressao_mostrar_preco_complementos b, impressao_mostrar_nome_complementos c, impressao_fonte_maior_producao d, impressao_multiplicar_opcoes_qtd e, impressao_logo f from restaurantes where id = $1', [L])
    const cfgLoja = { mostrarNumeroItem: r0.a, mostrarPrecoComplementos: r0.b, mostrarNomeComplementos: r0.c, fonteMaiorProducao: r0.d, multiplicarOpcoesQtd: r0.e, imprimirLogo: r0.f }
    let logoRef = null
    if (dados.logoUrl) { const r = await fetch(dados.logoUrl); logoRef = `data:${r.headers.get('content-type')};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}` }
    for (const [doc, tipo] of [['comanda', 'entrega'], ['pre_conta', 'mesa'], ['via_cozinha', 'entrega']]) {
      await p.getByTestId(`ver-${doc}`).click()
      const modal = p.getByTestId('modal-previa')
      await modal.waitFor({ timeout: 5000 })
      await p.waitForTimeout(900)
      const c = await p.getByTestId('modal-previa-canvas').evaluate((el) => ({ w: el.width, h: el.height, png: el.toDataURL('image/png'), cssW: el.getBoundingClientRect().width }))
      const pap = await p.getByTestId('modal-previa-papel').evaluate((el) => ({ mm: el.getAttribute('data-papel-mm'), largura: el.firstElementChild.getBoundingClientRect().width }))
      // 1 mm de CSS = 96/25,4 px. Bobina de 80 mm e área impressa de 72 mm (576 pontos ÷ 8).
      ok(`${doc}: janela no centro, papel 80 mm e área impressa 72 mm (tamanho real)`, pap.mm === '80' && Math.abs(pap.largura - (80 * 96) / 25.4) < 2 && Math.abs(c.cssW - (72 * 96) / 25.4) < 2, `${pap.largura.toFixed(0)} / ${c.cssW.toFixed(0)} px`)
      // Mesmo desenho do Assistente (render-ticket = ticket.html do instalador), mesmos dados.
      const docT = doc === 'pre_conta'
        ? montarPreContaV3({ ...contaDemonstracao(dados.loja.nome, tipo), qr: dados.qr, loja_dados: dados.loja })
        : montarComandaV3(pedidoDemonstracao(tipo).pedido, { config: cfgLoja, lojaNome: dados.loja.nome, loja: dados.loja, extras: pedidoDemonstracao(tipo).extras, qr: dados.qr, via: doc === 'via_cozinha' ? 'cozinha' : 'cliente' })
      const ref = await renderizarTicket(docT, { larguraMm: 80, logo: logoRef, imprimirLogo: cfgLoja.imprimirLogo !== false, saida: `${SHOTS}/ref-${doc}.png` })
      const a = await sharp(Buffer.from(c.png.split(',')[1], 'base64')).greyscale().raw().toBuffer({ resolveWithObject: true })
      const b = await sharp(`${SHOTS}/ref-${doc}.png`).greyscale().raw().toBuffer({ resolveWithObject: true })
      let dif = 0
      if (a.info.width === b.info.width && a.info.height === b.info.height) for (let i = 0; i < a.data.length; i++) if ((a.data[i] < 128) !== (b.data[i] < 128)) dif++
      ok(`${doc}: prévia = desenho do Assistente (${c.w}×${c.h})`, c.w === ref.largura && c.h === ref.altura && dif / a.data.length < 0.001, `${dif} pontos diferentes`)
      await p.screenshot({ path: `${SHOTS}/modal-${doc}-1366.png` })
      // Abas sem fechar.
      if (doc === 'comanda') {
        await p.getByTestId('modal-tipo-balcao').click()
        await p.waitForTimeout(500)
        await p.getByTestId('modal-doc-pre_conta').click()
        await p.waitForTimeout(500)
        ok('troca tipo e documento sem fechar a janela', (await modal.count()) === 1 && (await p.getByTestId('modal-tipo-entrega').count()) === 0)
        await p.screenshot({ path: `${SHOTS}/modal-pre-conta-balcao-1366.png` })
      }
      await p.keyboard.press('Escape')
      await p.waitForTimeout(300)
      ok(`${doc}: Esc fecha e o foco volta ao botão`, (await modal.count()) === 0 && (await p.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === `ver-${doc}`)
    }
    // Teclado: Tab até "Ver comanda", Enter abre, Tab circula dentro, Esc fecha.
    await p.getByTestId('ver-comanda').focus()
    await p.keyboard.press('Enter')
    await p.getByTestId('modal-previa').waitFor({ timeout: 5000 })
    for (let i = 0; i < 12; i++) await p.keyboard.press('Tab')
    ok('Tab fica dentro da janela', await p.evaluate(() => !!document.activeElement?.closest('[data-testid="modal-previa"]')))
    await p.keyboard.press('Escape')

    console.log('── Contraste ──')
    const cores = await p.evaluate(() => [...document.querySelectorAll('[data-testid="situacao-selo"], [data-testid="opcao-beta"] span span:last-child, .fin-btn-primario')].filter((e) => e.offsetParent).map((e) => { const s = getComputedStyle(e); return [s.color, s.backgroundColor] }))
    const piores = cores.filter(([f, b]) => !b.includes('rgba(0, 0, 0, 0)')).map(([f, b]) => contraste(f, b))
    ok(`selos e botões com contraste ≥ 4,5:1 (${piores.map((x) => x.toFixed(1)).join(', ')})`, piores.length > 0 && piores.every((x) => x >= 4.5))

    console.log('── Voltar ao antigo ──')
    await p.getByTestId('opcao-antigo').click()
    await p.getByTestId('confirmar-opcao-ok').click()
    await p.waitForTimeout(1500)
    ok('voltar ao antigo grava "Somente teste" na hora', (await um('select impressao_beta_modo m from restaurantes where id = $1', [L])).m === 'teste')
    await abrir()
    await p.getByTestId('ver-comanda').click()
    await p.getByTestId('modal-previa').waitFor({ timeout: 5000 })
    await p.waitForTimeout(900)
    ok('antigo: a janela mostra a comanda do Assistente antigo, sem abas de documento', (await p.getByTestId('modal-doc-pre_conta').count()) === 0 && (await p.getByTestId('modal-previa').innerText()).includes('Assistente antigo'))
    await p.screenshot({ path: `${SHOTS}/modal-antigo-1366.png` })
    await p.keyboard.press('Escape')
  } finally {
    clearInterval(sinal)
  }

  console.log('── Celular ──')
  for (const w of [360, 390, 430]) {
    const cx = await browser.newContext({ viewport: { width: w, height: 800 }, locale: 'pt-BR', storageState: await ctx.storageState() })
    const m = await cx.newPage()
    await m.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
    await m.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
    await m.getByTestId('card-opcao').waitFor({ timeout: 20000 })
    const r = await m.evaluate(() => {
      const raiz = document.querySelector('[data-testid="impressao-rolagem"]')
      const a = document.querySelector('[data-testid="opcao-antigo"]').getBoundingClientRect(), b = document.querySelector('[data-testid="opcao-beta"]').getBoundingClientRect()
      return { lateral: raiz.scrollWidth <= raiz.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1, empilhado: b.top >= a.bottom - 1 }
    })
    ok(`${w}px: sem rolagem lateral e opções empilhadas`, r.lateral && r.empilhado, JSON.stringify(r))
    await m.getByTestId('ver-comanda').click()
    await m.getByTestId('modal-previa').waitFor({ timeout: 5000 })
    await m.waitForTimeout(700)
    const jan = await m.getByTestId('modal-previa').evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 0.5 && r.top >= 0 && r.bottom <= window.innerHeight + 0.5 })
    ok(`${w}px: janela da prévia inteira na tela`, jan)
    await m.screenshot({ path: `${SHOTS}/modal-${w}.png` })
    await cx.close()
  }
} finally {
  await limpar()
  await db.end()
  await browser.close()
  await fecharRender()
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
