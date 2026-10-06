/**
 * A prévia do painel (dados de lib/impressao/demonstracao.mjs + v3.js + ticket-canvas.js) é a
 * MESMA imagem das amostras entregues em Downloads\impressao-v3-teste\ (Ponto 400, pedido #135 e
 * a mesa 04)? Desenha com o renderizador real e compara pixel a pixel. Nunca imprime.
 *
 *   node scripts/impressao/conferir-downloads.mjs
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { renderizarTicket, fecharRender } from './render-ticket.mjs'
import { pedidoDemonstracao, contaDemonstracao } from '../../lib/impressao/demonstracao.mjs'

const require = createRequire(import.meta.url)
const { montarComandaV3, montarPreContaV3 } = require('../../printer-agent/src/v3.js')
const PASTA = 'C:/Users/felipe/Downloads/impressao-v3-teste'
const REF = 'docs/impressao-final/referencias/comanda_v3.png'
let falhas = 0
const ok = (n, c, d = '') => { if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

const recorte = await sharp(REF).extract({ left: 160, top: 32, width: 152, height: 178 }).flatten({ background: '#fff' }).png().toBuffer()
const logo = `data:image/png;base64,${(await sharp(recorte).trim({ threshold: 20 }).png().toBuffer()).toString('base64')}`
const q = QRCode.create('https://app.menuzia.com.br/loja/ponto-400', { errorCorrectionLevel: 'M' })
const linhas = []
for (let y = 0; y < q.modules.size; y++) { let s = ''; for (let x = 0; x < q.modules.size; x++) s += q.modules.get(y, x) ? '1' : '0'; linhas.push(s) }
const qr = { origem: 'cardapio', url: 'https://app.menuzia.com.br/loja/ponto-400', tamanho: q.modules.size, linhas }
const loja = { nome: 'Ponto 400 Hamburgueria', telefone: '27999990000', endereco: 'Rua Pedro Alves, 120 - Centro, Vila Velha/ES', linha1: 'Rua Pedro Alves, 120', cidade: 'Vila Velha/ES' }

const d = pedidoDemonstracao('entrega')
const casos = [
  ['comanda-entrega', montarComandaV3(d.pedido, { config: {}, lojaNome: loja.nome, loja, extras: d.extras, qr }), 576],
  ['comanda-entrega-58mm', montarComandaV3(d.pedido, { config: {}, lojaNome: loja.nome, loja, extras: d.extras, qr }), 384],
  ['preconta-mesa', montarPreContaV3({ ...contaDemonstracao(loja.nome, 'mesa'), qr, loja_dados: loja }), 576],
  ['preconta-mesa-58mm', montarPreContaV3({ ...contaDemonstracao(loja.nome, 'mesa'), qr, loja_dados: loja }), 384],
]
try {
  for (const [nome, doc, pontos] of casos) {
    const arq = `${PASTA}/${nome}.png`
    if (!existsSync(arq)) { ok(`${nome}: arquivo em Downloads`, false, 'não encontrado'); continue }
    const saida = join(tmpdir(), `conferir-${nome}.png`)
    await renderizarTicket(doc, { larguraMm: pontos === 384 ? 58 : 80, larguraPontos: pontos, logo, saida })
    const a = await sharp(saida).greyscale().raw().toBuffer({ resolveWithObject: true })
    const b = await sharp(arq).greyscale().raw().toBuffer({ resolveWithObject: true })
    let dif = 0
    const mesmo = a.info.width === b.info.width && a.info.height === b.info.height
    if (mesmo) for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) dif++
    ok(`${nome}: prévia = Downloads (${a.info.width}×${a.info.height})`, mesmo && dif === 0, mesmo ? `${dif} pontos diferentes` : `${b.info.width}×${b.info.height} no arquivo`)
  }
} finally {
  await fecharRender()
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
