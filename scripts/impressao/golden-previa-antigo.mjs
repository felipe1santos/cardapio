/**
 * GOLDEN da prévia do ASSISTENTE ANTIGO: a comanda desenhada pelo print.ps1 DE VERDADE
 * (tag printer-agent-v0.1.23, -DebugPng, nada imprime) × a mesma comanda desenhada pela
 * prévia do painel (lib/impressao/recibo-antigo-canvas.js num Chromium). Mesmos dados (o
 * recibo.js da tag), mesmas colunas, papel e logo.
 *
 *   node scripts/impressao/golden-previa-antigo.mjs
 *
 * Saída: docs/impressao-tela-nova/antigo/<caso>-{ps1,previa,lado}.png e o relatório no console:
 * largura igual, altura a até 1,5%, e pixels diferentes (1 bit) abaixo do limite.
 */
import { execFileSync, execFile } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { chromium } from 'playwright'

const RAIZ = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const SAIDA = join(RAIZ, 'docs', 'impressao-tela-nova', 'antigo')
mkdirSync(SAIDA, { recursive: true })
const TAG = 'printer-agent-v0.1.23'
const DIR_TAG = join(tmpdir(), 'menuzia-golden-antigo')
mkdirSync(DIR_TAG, { recursive: true })
const git = (...a) => execFileSync('git', a, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 1 << 26 })
for (const f of ['print.ps1', 'recibo.js']) writeFileSync(join(DIR_TAG, f), git('show', `${TAG}:printer-agent/src/${f}`))
const require = createRequire(import.meta.url)
const { montarRecibo } = require(join(DIR_TAG, 'recibo.js'))
const { colsParaFonte } = require(join(RAIZ, 'lib', 'impressao', 'recibo-antigo-canvas.js'))
const { pedidoAntigoDemonstracao } = await import(pathToFileURL(join(RAIZ, 'lib', 'impressao', 'demonstracao.mjs')).href)

let falhas = 0
const ok = (n, c, d = '') => { if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

// Logo: o hambúrguer do modelo v3 (recorte da referência), em arquivo para o print.ps1.
const REF = join(RAIZ, 'docs', 'impressao-final', 'referencias', 'comanda_v3.png')
const recorte = await sharp(REF).extract({ left: 160, top: 32, width: 152, height: 178 }).flatten({ background: '#fff' }).png().toBuffer()
const logoBuf = await sharp(recorte).trim({ threshold: 20 }).png().toBuffer()
const LOGO = join(DIR_TAG, 'logo.png')
writeFileSync(LOGO, logoBuf)
const logoDataUrl = `data:image/png;base64,${logoBuf.toString('base64')}`

const ps1 = (txt, png, { cols, paperMm, fonteMaior, logo }) => new Promise((ok2, erro) => execFile('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(DIR_TAG, 'print.ps1'), '-FilePath', txt, '-PrinterName', 'Microsoft Print to PDF',
  '-Cols', String(cols), '-PaperWidthMm', String(paperMm), ...(fonteMaior ? ['-FonteMaior', '1'] : []), ...(logo ? ['-LogoPath', LOGO] : []), '-DebugPng', png,
], { env: { ...process.env, TEMP: DIR_TAG, TMP: DIR_TAG }, windowsHide: true, timeout: 60000 }, (e, out, err) => (e ? erro(new Error(err || e.message)) : ok2(out))))

const config = { mostrarNumeroItem: true, mostrarNomeComplementos: true, mostrarPrecoComplementos: true, multiplicarOpcoesQtd: false, imprimirLogo: true, fonteMaiorProducao: false }
const CASOS = [
  ['entrega-80-grande', 'entrega', 80, 'grande', false, true],
  ['entrega-80-media', 'entrega', 80, 'media', false, true],
  ['entrega-80-pequena', 'entrega', 80, 'pequena', false, false],
  ['mesa-80-grande', 'mesa', 80, 'grande', false, true],
  ['retirada-80-grande-fontemaior', 'retirada', 80, 'grande', true, true],
  ['balcao-80-grande', 'balcao', 80, 'grande', false, true],
  ['entrega-58-grande', 'entrega', 58, 'grande', false, true],
]

async function umBit(buf) {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true })
  return { bits: data.map((v) => (v < 128 ? 1 : 0)), w: info.width, h: info.height }
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><html><body><canvas id="c"></canvas></body></html>')
  await page.addScriptTag({ path: join(RAIZ, 'lib', 'impressao', 'recibo-antigo-canvas.js') })
  for (const [nome, tipo, mm, letra, fonteMaior, comLogo] of CASOS) {
    const pedido = pedidoAntigoDemonstracao(tipo)
    const cols = colsParaFonte(letra, mm <= 58 ? 32 : 48)
    const txt = join(DIR_TAG, `${nome}.txt`)
    writeFileSync(txt, montarRecibo(pedido, config, cols, 'Ponto 400 Hamburgueria', comLogo), 'utf8')
    const pngPs1 = join(SAIDA, `${nome}-ps1.png`)
    await ps1(txt, pngPs1, { cols, paperMm: mm, fonteMaior, logo: comLogo })
    const r = await page.evaluate(async ({ texto, mm, cols, fonteMaior, logo }) => {
      const img = logo ? await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = logo }) : null
      const c = document.getElementById('c')
      const m = window.ReciboAntigo.desenhar(c, texto, { larguraMm: mm, colunas: cols, fonteMaior, logo: img })
      return { ...m, png: c.toDataURL('image/png') }
    }, { texto: readFileSync(txt, 'utf8'), mm, cols, fonteMaior, logo: comLogo ? logoDataUrl : null })
    const pngPrevia = join(SAIDA, `${nome}-previa.png`)
    writeFileSync(pngPrevia, Buffer.from(r.png.split(',')[1], 'base64'))
    const a = await umBit(readFileSync(pngPs1)), b = await umBit(readFileSync(pngPrevia))
    // Pixels diferentes na área comum, contados só onde algum dos dois tem tinta.
    const h = Math.min(a.h, b.h)
    let tinta = 0, dif = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < a.w; x++) {
      const pa = a.bits[y * a.w + x], pb = b.bits[y * b.w + x]
      if (pa || pb) { tinta++; if (pa !== pb) dif++ }
    }
    const pct = (100 * dif) / Math.max(1, tinta)
    ok(`${nome}: ${a.w}×${a.h} (print.ps1) × ${b.w}×${b.h} (prévia), ${cols} colunas`, a.w === b.w && Math.abs(a.h - b.h) / a.h <= 0.015, `altura ${((100 * (b.h - a.h)) / a.h).toFixed(1)}%`)
    ok(`${nome}: pixels de tinta diferentes ${pct.toFixed(1)}%`, pct <= 20, 'mesma letra (Consolas), mesma posição; a diferença é o desenho fino de cada motor de fonte')
    const ma = await sharp(pngPs1).metadata(), mb = await sharp(pngPrevia).metadata()
    await sharp({ create: { width: ma.width * 2 + 20, height: Math.max(ma.height, mb.height), channels: 3, background: '#bbbbbb' } })
      .composite([{ input: pngPs1, left: 0, top: 0 }, { input: pngPrevia, left: ma.width + 20, top: 0 }]).png().toFile(join(SAIDA, `${nome}-lado.png`))
  }
} finally {
  await browser.close()
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
