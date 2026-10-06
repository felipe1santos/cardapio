/**
 * Prints do PROTÓTIPO aprovado (Downloads\tela-impressao-menuzia.html) para o lado a lado com a
 * tela real: computador (1366) e celular (390), página inteira e com o modal aberto.
 *
 *   node scripts/impressao/shots-prototipo.mjs [caminho-do-html]
 */
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const ORIGEM = process.argv[2] ?? 'C:/Users/felipe/Downloads/tela-impressao-menuzia.html'
const SAIDA = 'docs/impressao-tela-nova/prototipo'
mkdirSync(SAIDA, { recursive: true })
if (existsSync(ORIGEM)) copyFileSync(ORIGEM, `${SAIDA}/tela-impressao-menuzia.html`)
const browser = await chromium.launch()
try {
  for (const [w, h] of [[1366, 900], [390, 844]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h } })
    await p.goto(pathToFileURL(`${SAIDA}/tela-impressao-menuzia.html`).href, { waitUntil: 'networkidle' })
    await p.waitForTimeout(800)
    await p.screenshot({ path: `${SAIDA}/prototipo-${w}.png`, fullPage: true })
    await p.click('#abrirModelo')
    await p.waitForTimeout(600)
    await p.screenshot({ path: `${SAIDA}/prototipo-modal-${w}.png` })
    await p.close()
  }
} finally {
  await browser.close()
}
console.log('ok', SAIDA)
