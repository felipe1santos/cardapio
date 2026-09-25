/**
 * Mede onde há tinta em PNGs de impressão (só leitura, Chromium). Linhas em que a ÚLTIMA
 * coluna é escura são faixas de largura total (barras de seção H e réguas de borda K):
 * contam como borda e ficam fora da medida do texto.
 *   { largura, altura, tintaTextoDe, tintaTextoAte, linhasBordaEsquerda, linhasBordaDireita }
 */
import { readFileSync } from 'node:fs'

export async function medirPngs(caminhos) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const out = []
  for (const p of caminhos) {
    const r = await page.evaluate(async (src) => {
      const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src })
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const x = c.getContext('2d'); x.drawImage(img, 0, 0)
      const d = x.getImageData(0, 0, img.width, img.height).data
      const w = img.width, h = img.height
      const escuro = (px, py) => { const i = (py * w + px) * 4; return d[i] + d[i + 1] + d[i + 2] < 384 }
      let de = w, ate = -1, esq = 0, dir = 0
      for (let y = 0; y < h; y++) {
        if (escuro(0, y)) esq++
        if (escuro(w - 1, y)) { dir++; continue }
        for (let px = w - 1; px >= 0; px--) if (escuro(px, y)) { if (px > ate) ate = px; break }
        for (let px = 0; px < w; px++) if (escuro(px, y)) { if (px < de) de = px; break }
      }
      return { largura: w, altura: h, tintaTextoDe: de, tintaTextoAte: ate, linhasBordaEsquerda: esq, linhasBordaDireita: dir }
    }, `data:image/png;base64,${readFileSync(p).toString('base64')}`)
    out.push({ png: p, ...r })
  }
  await browser.close()
  return out
}
