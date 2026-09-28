/**
 * Renderização VIRTUAL dos documentos do Assistente Beta — nunca imprime.
 * Documento de pre-conta-beta.js / cozinha-beta.js → PNG pelo MESMO ticket.html /
 * ticket-canvas.js do instalador (render-ticket.mjs, Chromium sem janela).
 */
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { renderizarTicket, fecharRender } from './render-ticket.mjs'

const require = createRequire(import.meta.url)
const RAIZ = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const { montarPreContaBeta, textoDoDocumento } = require(join(RAIZ, 'printer-agent', 'src', 'pre-conta-beta.js'))
const { montarCozinhaBeta } = require(join(RAIZ, 'printer-agent', 'src', 'cozinha-beta.js'))

export { fecharRender }

/** snapshot → PNG. { paperMm, pontos, tamanhoFonte, saida } */
export function renderizarBeta(snapshot, opcoes) {
  return renderizarDocumentoBeta(montarPreContaBeta(snapshot), opcoes)
}

/** Comanda da cozinha do Beta (cozinha-beta.js) → PNG. pedido no formato da fila; o = { config, lojaNome, extras, qr, teste }. */
export function renderizarCozinhaBeta(pedido, o, opcoes) {
  return renderizarDocumentoBeta(montarCozinhaBeta(pedido, o), opcoes)
}

/** Documento em blocos (qualquer modelo do Beta) → { png, doc, texto, total, largura, altura }. */
export async function renderizarDocumentoBeta(doc, { paperMm = 80, pontos = null, tamanhoFonte = 'grande', saida }) {
  const r = await renderizarTicket(doc, { larguraMm: paperMm, larguraPontos: pontos, tamanhoFonte, saida })
  const total = doc.blocos.find((b) => b.t === 'total')
  return { png: r.png, largura: r.largura, altura: r.altura, doc, texto: textoDoDocumento(doc), total: total ? { rotulo: total.rotulo, valor: total.valor } : null }
}
