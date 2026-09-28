/**
 * Desenha documentos do Assistente Beta em PNG com o MESMO ticket-canvas.js / ticket.html
 * do instalador, num Chromium sem janela (Playwright). Nunca imprime.
 *
 *   const r = await renderizarTicket(doc, { larguraMm: 80, tamanhoFonte: 'grande', saida })
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const RAIZ = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const HTML = pathToFileURL(join(RAIZ, 'printer-agent', 'src', 'renderer', 'ticket.html')).href

let navegador = null
let pagina = null
async function paginaPronta() {
  if (pagina) return pagina
  navegador = await chromium.launch()
  pagina = await navegador.newPage()
  await pagina.goto(HTML)
  return pagina
}

/** doc → { png (caminho), largura, altura } */
export async function renderizarTicket(doc, { larguraMm = 80, larguraPontos = null, tamanhoFonte = 'grande', saida }) {
  const p = await paginaPronta()
  const r = await p.evaluate(async ({ doc, o }) => window.renderizarTicket(doc, o), { doc, o: { larguraMm, larguraPontos, tamanhoFonte } })
  mkdirSync(dirname(saida), { recursive: true })
  writeFileSync(saida, Buffer.from(r.png.split(',')[1], 'base64'))
  return { png: saida, largura: r.largura, altura: r.altura }
}

export async function fecharRender() {
  if (navegador) await navegador.close()
  navegador = null
  pagina = null
}
