'use strict'
// ─────────────────────────────────────────────────────────────────────────────
// DESENHO do Alfa 1: o HTML da referência (alfa1.js) numa janela OCULTA (offscreen) do Electron,
// com zoom 576/302 — 1 px da página vira 1 ponto do papel — capturado e convertido em preto e
// branco puro (limiar; o cinza do antialiasing vira pontilhado na térmica).
// Saída no formato do escpos.js: { bits (1 = preto, MSB à esquerda), largura, altura, porLinha }.
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path')
const { htmlAlfa1, CSS_ALFA1, ESCALA } = require('./alfa1')

/** Limiar do preto (luminância 0–255): mais alto = traço mais grosso. */
const LIMIAR = { normal: 175, escura: 200, mais_escura: 215 }
/** Altura da janela oculta (px da tela); a folha é capturada em pedaços dessa altura. */
const JANELA_ALTURA = 1200

let janela = null
let pronta = null
let usoEm = 0
const OCIOSO_MS = 20 * 60_000
const relogio = setInterval(() => {
  if (janela && !janela.isDestroyed() && Date.now() - usoEm > OCIOSO_MS) { janela.destroy(); janela = null; pronta = null }
}, 60_000)
if (relogio.unref) relogio.unref()

function abrir() {
  usoEm = Date.now()
  if (pronta && janela && !janela.isDestroyed()) return pronta
  const { BrowserWindow } = require('electron')
  janela = new BrowserWindow({
    show: false, width: 576, height: JANELA_ALTURA, useContentSize: true, enableLargerThanScreen: true,
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  })
  janela.on('closed', () => { janela = null; pronta = null })
  pronta = janela.loadFile(path.join(__dirname, 'renderer', 'alfa1.html')).catch((e) => { pronta = null; throw e })
  return pronta
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms))

/** Escala da tela do Windows (1 = 100%, 1,25 = 125%...). A captura sai em pixels físicos. */
function escalaDaTela() {
  try { return require('electron').screen.getPrimaryDisplay().scaleFactor || 1 } catch { return 1 }
}

/** BGRA (largura `w`) → 1 bit, acumulando em `bits` a partir da linha `y0`; só as `largura` primeiras colunas. */
function binarizar(bgra, w, h, bits, porLinha, y0, limiar, largura = w) {
  const ate = Math.min(w, largura)
  for (let y = 0; y < h; y++) {
    const base = (y0 + y) * porLinha
    for (let x = 0; x < ate; x++) {
      const i = (y * w + x) * 4
      const lum = (bgra[i + 2] * 299 + bgra[i + 1] * 587 + bgra[i] * 114) / 1000
      if (lum < limiar && bgra[i + 3] > 0) bits[base + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
}

/**
 * Documento Alfa 1 → pontos em 1 bit na largura `larguraPontos`.
 * @returns {Promise<{bits: Uint8Array, largura: number, altura: number, porLinha: number}>}
 */
async function desenharAlfa1(doc, { larguraPontos = 576, intensidade = 'normal' } = {}) {
  await abrir()
  const w = Math.max(200, Math.round(larguraPontos))
  const html = htmlAlfa1(doc, { larguraPontos: w })
  const corpo = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  const css = `${CSS_ALFA1}\n.papel{width:${(w / ESCALA).toFixed(4)}px}\nhtml,body{margin:0;overflow:hidden}`
  // Zoom e janela compensam a escala da tela: 1 px da página continua valendo 1 ponto do papel.
  const f = escalaDaTela()
  janela.webContents.setZoomFactor(ESCALA / f)
  janela.setContentSize(Math.ceil(w / f), JANELA_ALTURA)
  const m = await janela.webContents.executeJavaScript(`window.montarAlfa1(${JSON.stringify(css)}, ${JSON.stringify(corpo)})`, true)
  if (!m || !m.altura) throw new Error('desenho vazio')
  if (!m.fonte) throw new Error('fonte Comfortaa não carregou')
  const altura = Math.ceil(m.altura * ESCALA)
  const porLinha = Math.ceil(w / 8)
  const bits = new Uint8Array(porLinha * altura)
  const limiar = LIMIAR[intensidade] || LIMIAR.normal
  // Captura em pedaços: a folha sobe (translateY em px da página) a altura que cada captura devolveu.
  let y = 0
  while (y < altura) {
    await janela.webContents.executeJavaScript(`document.getElementById('papel').style.transform='translateY(${(-y / ESCALA).toFixed(5)}px)'`, true)
    janela.webContents.invalidate()
    await esperar(80)
    const img = await janela.webContents.capturePage()
    const tam = img.getSize()
    const h = Math.min(tam.height, altura - y)
    if (tam.width < w - 2 || h <= 0) throw new Error(`captura com ${tam.width}x${tam.height} (esperado ${w} de largura)`)
    binarizar(img.toBitmap(), tam.width, h, bits, porLinha, y, limiar, w)
    y += h
  }
  usoEm = Date.now()
  return { bits, largura: w, altura, porLinha }
}

/** 1 bit → PNG (driver do Windows e amostras): preto puro no branco. */
function pngDosBits(r) {
  const { nativeImage } = require('electron')
  const buf = Buffer.alloc(r.largura * r.altura * 4, 0xff)
  for (let y = 0; y < r.altura; y++) {
    for (let x = 0; x < r.largura; x++) {
      if (r.bits[y * r.porLinha + (x >> 3)] & (0x80 >> (x & 7))) { const i = (y * r.largura + x) * 4; buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0 }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: r.largura, height: r.altura }).toPNG()
}

module.exports = { desenharAlfa1, pngDosBits, LIMIAR, binarizar }
