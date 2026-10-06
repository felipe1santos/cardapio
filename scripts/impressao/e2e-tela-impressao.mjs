/**
 * E2E LOCAL da tela de Impressão (protótipo aprovado, 2026-10-06). Servidor e banco LOCAIS
 * (cantina-demo); o estado de impressão da loja é guardado no início e devolvido no fim. Nada
 * imprime: o "computador" é simulado no banco (sinal recente), sem Assistente rodando.
 *
 *   node scripts/impressao/e2e-tela-impressao.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import pg from 'pg'
import sharp from 'sharp'
import { chromium } from 'playwright'
import { USU } from '../seguranca/e2e-ambiente.mjs'
import { renderizarTicket, fecharRender } from './render-ticket.mjs'
import { prepararBeta } from './shots-tela-v4.mjs'
import { pedidoDemonstracao, contaDemonstracao } from '../../lib/impressao/demonstracao.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE) || !/@(127\.0\.0\.1|localhost):/.test(DB)) throw new Error('só servidor e banco locais')
const SHOTS = 'docs/impressao-tela-nova/v4/e2e'
mkdirSync(SHOTS, { recursive: true })
const require = createRequire(import.meta.url)
const { montarComandaV3, montarPreContaV3 } = require('../../printer-agent/src/v3.js')

let falhas = 0
const ok = (n, c, d = '') => { if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const db = new pg.Client(DB)
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const L = (await um("select id from restaurantes where slug = 'cantina-demo'")).id
const COLS = 'impressao_beta_modo, impressao_beta_liberado, impressao_cozinha_por_funcao, impressao_via_cozinha, impressao_qr, impressao_agente_visto_em'
const antes = await um(`select ${COLS} from restaurantes where id = $1`, [L])
const funcoesAntes = (await db.query('select funcao, dispositivo_id from impressao_funcoes where restaurante_id = $1', [L])).rows
const NOME_AG = 'E2E Tela v4'
const limpar = async () => {
  await db.query('delete from impressao_trabalhos where restaurante_id = $1 and dispositivo_id in (select id from impressao_dispositivos where agente_id in (select id from impressao_agentes where restaurante_id = $1 and nome = $2))', [L, NOME_AG])
  await db.query('delete from impressao_funcoes where restaurante_id = $1', [L])
  for (const f of funcoesAntes) await db.query('insert into impressao_funcoes (restaurante_id, funcao, dispositivo_id) values ($1, $2, $3)', [L, f.funcao, f.dispositivo_id])
  await db.query('delete from impressao_dispositivos where agente_id in (select id from impressao_agentes where restaurante_id = $1 and nome = $2)', [L, NOME_AG])
  await db.query('delete from impressao_agentes where restaurante_id = $1 and nome = $2', [L, NOME_AG])
  await db.query('update restaurantes set impressao_beta_modo = $2, impressao_beta_liberado = $3, impressao_cozinha_por_funcao = $4, impressao_via_cozinha = $5, impressao_qr = $6, impressao_agente_visto_em = $7 where id = $1',
    [L, antes.impressao_beta_modo, antes.impressao_beta_liberado, antes.impressao_cozinha_por_funcao, antes.impressao_via_cozinha, antes.impressao_qr, antes.impressao_agente_visto_em])
}
await limpar()
// Começa no antigo (padrão), com o Beta liberado e sem computador do Beta conectado.
await db.query("update restaurantes set impressao_beta_modo = 'teste', impressao_cozinha_por_funcao = false, impressao_beta_liberado = true, impressao_via_cozinha = false, impressao_qr = true where id = $1", [L])
await db.query('delete from impressao_funcoes where restaurante_id = $1', [L])

const contraste = (a, b) => {
  const lum = (h) => { const c = h.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}
const dif1bit = async (pngA, pngB) => {
  const a = await sharp(pngA).greyscale().raw().toBuffer({ resolveWithObject: true })
  const b = await sharp(pngB).greyscale().raw().toBuffer({ resolveWithObject: true })
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return { mesmo: false, txt: `${a.info.width}×${a.info.height} vs ${b.info.width}×${b.info.height}` }
  let d = 0
  for (let i = 0; i < a.data.length; i++) if ((a.data[i] < 128) !== (b.data[i] < 128)) d++
  return { mesmo: d === 0, txt: `${d} pontos diferentes` }
}

const browser = await chromium.launch()
let sinal = null
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
    await p.getByTestId('passo-1').waitFor({ timeout: 20000 })
    await p.waitForTimeout(900)
  }
  const modo = async () => (await um('select impressao_beta_modo m from restaurantes where id = $1', [L])).m

  console.log('── Assistente antigo (padrão) ──')
  await abrir()
  ok('loja em "Somente teste" = Assistente antigo, com "Em uso na sua loja"', (await p.getByTestId('opcao-antigo').getAttribute('aria-checked')) === 'true' && (await p.getByTestId('opcao-antigo').getByTestId('opcao-em-uso').count()) === 1)
  ok('antigo: instalador do Assistente antigo e sem pílula de Caixa', (await p.getByTestId('instalador-nome').innerText()).includes('0.1.23') && (await p.getByTestId('pill-caixa').count()) === 0)
  ok('antigo: opções do Beta somem (via da cozinha, QR) e o preço dos adicionais aparece', (await p.getByTestId('opcao-viaCozinha').count()) === 0 && (await p.getByTestId('opcao-qr').count()) === 0 && (await p.getByTestId('opcao-mostrarPrecoComplementos').count()) === 1)
  await p.screenshot({ path: `${SHOTS}/antigo-1366.png` })

  // Beta sem computador: guia de instalação, "Ativar" travado; Esc fecha; nada muda.
  await p.getByTestId('opcao-beta').click()
  await p.getByTestId('ativar-beta').waitFor({ timeout: 5000 })
  const passos = await p.getByTestId('ativar-passos').locator('li').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-feito')))
  ok('novo sem computador conectado: guia a instalação (conectar e impressoras pendentes)', passos.length === 3 && passos[1] === 'nao' && passos[2] === 'nao', passos.join(','))
  ok('"Ativar" travado enquanto falta passo', await p.getByTestId('ativar-confirmar').isDisabled())
  await p.screenshot({ path: `${SHOTS}/guia-instalacao-1366.png` })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  ok('Esc fecha o guia e nada muda no banco', (await p.getByTestId('ativar-beta').count()) === 0 && (await modo()) === 'teste')

  console.log('── Ativar o Assistente novo ──')
  const ids = await prepararBeta(db, L, NOME_AG, '0.2.0-beta.7')
  await db.query("update restaurantes set impressao_beta_modo = 'teste', impressao_cozinha_por_funcao = false where id = $1", [L])
  sinal = setInterval(() => db.query('update impressao_agentes set visto_em = now() where id = $1', [ids.ag]).catch(() => {}), 3000)
  await abrir()
  await p.getByTestId('opcao-beta').click()
  await p.getByTestId('confirmar-opcao').waitFor({ timeout: 5000 })
  ok('pronto: confirmação simples com o texto combinado', (await p.getByTestId('confirmar-opcao-texto').innerText()).includes('Sua loja vai passar a imprimir pelo Assistente Beta. Ele precisa estar instalado e conectado.'))
  await p.getByTestId('confirmar-opcao-ok').click()
  await p.waitForTimeout(1500)
  ok('grava "Cozinha e Caixa"', (await modo()) === 'cozinha_caixa')
  const aud = await um("select dados from eventos_auditoria where restaurante_id = $1 and acao = 'impressao.modo_alterado' order by criado_em desc limit 1", [L])
  ok('troca auditada (teste → cozinha_caixa)', aud?.dados?.de === 'teste' && aud?.dados?.para === 'cozinha_caixa')
  await abrir()
  const pil = async (id) => ({ t: await p.getByTestId(id).innerText().catch(() => ''), e: await p.getByTestId(id).getAttribute('data-estado').catch(() => null) })
  const [pa, pc, px] = [await pil('pill-assistente'), await pil('pill-cozinha'), await pil('pill-caixa')]
  ok('pílulas: Assistente conectado, Cozinha pronta, Caixa pronto', pa.t.includes('Assistente conectado') && pc.t.includes('Cozinha pronta') && px.t.includes('Caixa pronto') && [pa.e, pc.e, px.e].every((e) => e === 'ok'))
  ok('beta.7: pílula "Atualização disponível" e aviso amarelo de versão', (await p.getByTestId('pill-atualizacao').count()) === 1 && (await p.getByTestId('aviso-versao').innerText()).includes('0.2.0-beta.7'))
  await p.getByTestId('como-atualizar').click()
  ok('"Como atualizar" abre as instruções', await p.getByTestId('modal-como-atualizar').isVisible())
  await p.keyboard.press('Escape')
  const estados = await p.locator('[data-testid^="passo-"]').evaluateAll((s) => s.map((x) => x.getAttribute('data-estado')))
  ok('passos: 1–3 concluídos (verde), 4 atual (calibração há 32 dias), 5 neutro', estados.join(',') === 'feito,feito,feito,atual,neutro', estados.join(','))
  ok('aviso de calibração antiga no bloco Calibrar', (await p.getByTestId(`aviso-calibrar-${ids.d1}`).innerText()).includes('32 dias'))
  await p.screenshot({ path: `${SHOTS}/novo-1366.png` })

  console.log('── Impressoras: Cozinha / Caixa / Os dois, Testar, Adicionar ──')
  await p.getByTestId(`uso-${ids.d2}-ambos`).click()
  await p.waitForTimeout(1500)
  let f = (await db.query('select funcao, dispositivo_id d from impressao_funcoes where restaurante_id = $1', [L])).rows
  ok('"Os dois": Cozinha e Caixa na mesma impressora', f.find((x) => x.funcao === 'cozinha')?.d === ids.d2 && f.find((x) => x.funcao === 'caixa')?.d === ids.d2)
  await p.getByTestId(`uso-${ids.d1}-cozinha`).click()
  await p.waitForTimeout(1500)
  f = (await db.query('select funcao, dispositivo_id d from impressao_funcoes where restaurante_id = $1', [L])).rows
  ok('"Cozinha" na outra: a Cozinha muda, o Caixa fica', f.find((x) => x.funcao === 'cozinha')?.d === ids.d1 && f.find((x) => x.funcao === 'caixa')?.d === ids.d2)
  ok('seletor reflete o banco', (await p.getByTestId(`uso-${ids.d1}-cozinha`).getAttribute('aria-pressed')) === 'true' && (await p.getByTestId(`uso-${ids.d2}-caixa`).getAttribute('aria-pressed')) === 'true')
  await p.getByTestId(`testar-${ids.d1}`).click()
  await p.waitForTimeout(1200)
  const tr = await um("select tipo, snapshot->>'cozinha_teste' c from impressao_trabalhos where dispositivo_id = $1 order by criado_em desc limit 1", [ids.d1])
  ok('"Testar" da Cozinha cria a comanda de teste para ela (simulado, não imprime)', tr?.tipo === 'teste_impressora' && tr?.c === 'true')
  await p.getByTestId('adicionar-impressora').click()
  ok('"Adicionar impressora" abre as impressoras detectadas no computador', await p.getByTestId('modal-impressoras').waitFor({ timeout: 5000 }).then(() => true).catch(() => false))
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)

  console.log('── Modelo da impressão ──')
  const dados = await p.evaluate(async () => (await fetch('/api/admin/impressao/previa')).json())
  const r0 = await um('select impressao_mostrar_numero_item a, impressao_mostrar_preco_complementos b, impressao_mostrar_nome_complementos c, impressao_fonte_maior_producao d, impressao_multiplicar_opcoes_qtd e, impressao_logo f from restaurantes where id = $1', [L])
  const cfg = { mostrarNumeroItem: r0.a, mostrarPrecoComplementos: r0.b, mostrarNomeComplementos: r0.c, fonteMaiorProducao: r0.d, multiplicarOpcoesQtd: r0.e, imprimirLogo: r0.f }
  let logoRef = null
  if (dados.logoUrl) { const r = await fetch(dados.logoUrl); logoRef = `data:${r.headers.get('content-type')};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}` }
  const abrirModelo = async () => {
    await p.getByTestId('ver-modelo').click()
    await p.getByTestId('modal-previa').waitFor({ timeout: 8000 })
    await p.waitForFunction(() => !document.querySelector('[data-testid="modal-previa-carregando"]') && document.querySelector('[data-testid="modal-previa-canvas"]')?.width >= 256, null, { timeout: 20000 })
    await p.waitForTimeout(300)
  }
  const canvasPng = async (arq) => { const u = await p.getByTestId('modal-previa-canvas').evaluate((c) => c.toDataURL('image/png')); writeFileSync(arq, Buffer.from(u.split(',')[1], 'base64')) }
  await abrirModelo()
  const jan = await p.getByTestId('modal-previa').evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, vh: innerHeight, cx: r.left + r.width / 2, vw: innerWidth } })
  ok('janela vertical no centro, estreita e quase da altura da tela', jan.w <= 440 && jan.h >= jan.vh - 40 && Math.abs(jan.cx - jan.vw / 2) < 2, JSON.stringify(jan))
  const larg = await p.evaluate(() => { const pal = document.querySelector('[data-testid="modal-previa-papel"]'); const pap = pal.firstElementChild; return { palco: pal.clientWidth, papel: pap.getBoundingClientRect().width, z: document.querySelector('[data-testid="modal-zoom-valor"]').innerText } })
  ok('abre na LARGURA da janela (legível)', Math.abs(larg.papel - (larg.palco - 32)) < 3, JSON.stringify(larg))
  for (const [doc, tipo] of [['comanda', 'entrega'], ['pre_conta', 'mesa'], ['via_cozinha', 'entrega']]) {
    await p.getByTestId(`modal-doc-${doc}`).click()
    await p.waitForTimeout(700)
    await canvasPng(`${SHOTS}/modal-${doc}.png`)
    const docT = doc === 'pre_conta'
      ? montarPreContaV3({ ...contaDemonstracao(dados.loja.nome, tipo), qr: dados.qr, loja_dados: dados.loja })
      : montarComandaV3(pedidoDemonstracao(tipo).pedido, { config: cfg, lojaNome: dados.loja.nome, loja: dados.loja, extras: pedidoDemonstracao(tipo).extras, qr: dados.qr, via: doc === 'via_cozinha' ? 'cozinha' : 'cliente' })
    await renderizarTicket(docT, { larguraMm: 80, logo: logoRef, imprimirLogo: cfg.imprimirLogo !== false, saida: `${SHOTS}/ref-${doc}.png` })
    const d = await dif1bit(`${SHOTS}/modal-${doc}.png`, `${SHOTS}/ref-${doc}.png`)
    ok(`${doc}: modelo = desenho do Assistente (renderizador real)`, d.mesmo, d.txt)
  }
  await p.getByTestId('modal-doc-comanda').click()
  await p.getByTestId('modal-tipo').selectOption('balcao')
  await p.waitForTimeout(600)
  ok('troca documento e tipo sem fechar', await p.getByTestId('modal-previa').isVisible())
  // Zoom: "Inteira" cabe tudo; + aumenta; 100% = tamanho real (80 mm).
  await p.getByTestId('modal-zoom-inteira').click()
  await p.waitForTimeout(300)
  const inteira = await p.evaluate(() => { const pal = document.querySelector('[data-testid="modal-previa-papel"]'); const pap = pal.firstElementChild.getBoundingClientRect(); return { cabe: pap.height <= pal.clientHeight - 16 && pap.width <= pal.clientWidth } })
  ok('"Inteira": o papel cabe todo, sem cortar', inteira.cabe)
  const z0 = parseInt(await p.getByTestId('modal-zoom-valor').innerText())
  await p.getByTestId('modal-zoom-mais').click()
  const z1 = parseInt(await p.getByTestId('modal-zoom-valor').innerText())
  ok('"+" aumenta o zoom', z1 > z0, `${z0}% → ${z1}%`)
  for (let i = 0; i < 40 && parseInt(await p.getByTestId('modal-zoom-valor').innerText()) !== 100; i++) await p.getByTestId(parseInt(await p.getByTestId('modal-zoom-valor').innerText()) > 100 ? 'modal-zoom-menos' : 'modal-zoom-mais').click()
  const real = await p.evaluate(() => document.querySelector('[data-testid="modal-previa-papel"]').firstElementChild.getBoundingClientRect().width)
  ok('100% = tamanho real (bobina de 80 mm)', Math.abs(real - (80 * 96) / 25.4) < 2, `${real.toFixed(1)} px`)
  await p.getByTestId('modal-zoom-largura').click()
  await p.screenshot({ path: `${SHOTS}/modal-1366.png` })
  for (let i = 0; i < 14; i++) await p.keyboard.press('Tab')
  ok('Tab fica dentro da janela', await p.evaluate(() => !!document.activeElement?.closest('[data-testid="modal-previa"]')))
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  ok('Esc fecha e o foco volta para "Ver modelo da impressão"', (await p.getByTestId('modal-previa').count()) === 0 && (await p.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'ver-modelo')
  await abrirModelo()
  await p.mouse.click(5, 450)
  await p.waitForTimeout(300)
  ok('clique fora fecha', (await p.getByTestId('modal-previa').count()) === 0)

  console.log('── Opções do papel refletindo no modelo ──')
  await abrirModelo()
  const h1 = await p.getByTestId('modal-previa-canvas').evaluate((c) => c.height)
  await p.keyboard.press('Escape')
  await p.getByTestId('opcao-qr').click()
  await p.waitForTimeout(800)
  ok('QR Code desligado grava impressao_qr = false', (await um('select impressao_qr v from restaurantes where id = $1', [L])).v === false)
  await abrirModelo()
  const h2 = await p.getByTestId('modal-previa-canvas').evaluate((c) => c.height)
  ok('sem o QR, o modelo fica sem ele (mais curto)', h2 < h1, `${h1} → ${h2}`)
  await p.keyboard.press('Escape')
  await p.getByTestId('opcao-qr').click()
  await p.getByTestId('opcao-viaCozinha').click()
  await p.waitForTimeout(800)
  ok('via da cozinha liga e grava (começa desligada)', (await um('select impressao_via_cozinha v from restaurantes where id = $1', [L])).v === true)
  await p.getByTestId('opcao-viaCozinha').click()
  await p.waitForTimeout(600)

  console.log('── Contraste e peso da fonte ──')
  const pesos = await p.evaluate(() => Math.max(...[...document.querySelectorAll('.tela-impressao *')].filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => Number(getComputedStyle(e).fontWeight))))
  ok(`nenhum texto acima de 600 (máximo ${pesos})`, pesos <= 600)
  const pares = await p.evaluate(() => [...document.querySelectorAll('.tela-impressao .ti-btn.pri, .ti-seg button[aria-pressed="true"], .ti-selo, .ti-emuso, .ti-sub, .ti-rot, .ti-aviso span, .ti-resumo > span')].filter((e) => e.offsetParent).map((e) => {
    let b = getComputedStyle(e).backgroundColor, x = e
    while (b === 'rgba(0, 0, 0, 0)' && x.parentElement) { x = x.parentElement; b = getComputedStyle(x).backgroundColor }
    return [getComputedStyle(e).color, b]
  }))
  const piores = pares.map(([c, b]) => contraste(c, b))
  ok(`contraste ≥ 4,5:1 (menor ${Math.min(...piores).toFixed(2)} em ${piores.length} elementos)`, Math.min(...piores) >= 4.5)

  console.log('── Voltar ao antigo ──')
  await db.query('update restaurantes set impressao_agente_visto_em = now() where id = $1', [L])
  await abrir()
  await p.getByTestId('opcao-antigo').click()
  await p.getByTestId('confirmar-opcao-ok').click()
  await p.waitForTimeout(1500)
  ok('voltar ao antigo (conectado) grava "Somente teste" na hora', (await modo()) === 'teste')
  await abrir()
  await abrirModelo()
  ok('antigo: só "Comanda" e o desenho do Assistente antigo', (await p.getByTestId('modal-doc-pre_conta').count()) === 0 && (await p.getByTestId('modal-previa-sub').innerText()).includes('Assistente antigo'))
  await p.screenshot({ path: `${SHOTS}/modal-antigo-1366.png` })
  await p.keyboard.press('Escape')
  clearInterval(sinal); sinal = null

  console.log('── Celular ──')
  for (const w of [360, 390, 430]) {
    const cx = await browser.newContext({ viewport: { width: w, height: 800 }, locale: 'pt-BR', storageState: await ctx.storageState() })
    const m = await cx.newPage()
    await m.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
    await m.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
    await m.getByTestId('passo-1').waitFor({ timeout: 20000 })
    const r = await m.evaluate(() => {
      const raiz = document.querySelector('[data-testid="impressao-rolagem"]')
      const a = document.querySelector('[data-testid="opcao-antigo"]').getBoundingClientRect(), b = document.querySelector('[data-testid="opcao-beta"]').getBoundingClientRect()
      return { lateral: raiz.scrollWidth <= raiz.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1, empilhado: b.top >= a.bottom - 1 }
    })
    ok(`${w}px: sem rolagem lateral e opções empilhadas`, r.lateral && r.empilhado, JSON.stringify(r))
    await m.getByTestId('ver-modelo').click()
    await m.getByTestId('modal-previa').waitFor({ timeout: 8000 })
    await m.waitForTimeout(800)
    const t = await m.getByTestId('modal-previa').evaluate((el) => { const r = el.getBoundingClientRect(); return Math.abs(r.width - innerWidth) < 1 && Math.abs(r.height - innerHeight) < 2 })
    ok(`${w}px: a janela ocupa a tela`, t)
    await m.screenshot({ path: `${SHOTS}/modal-${w}.png` })
    await cx.close()
  }
} finally {
  if (sinal) clearInterval(sinal)
  await limpar()
  await db.end()
  await browser.close()
  await fecharRender()
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
