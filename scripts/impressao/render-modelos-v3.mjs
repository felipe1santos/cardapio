/**
 * Desenha a comanda e a pré-conta do Beta com os DADOS DOS MODELOS v3
 * (docs/referencias/impressao/v3) — para comparar lado a lado. Nunca imprime.
 *   node scripts/impressao/render-modelos-v3.mjs <pasta> [grande|media|pequena] [logo.png]
 */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import QRCode from 'qrcode'
import { renderizarTicket, fecharRender } from './render-ticket.mjs'
import { snapshotCozinhaTeste, snapshotReciboTeste } from '../../lib/impressao/recibo-teste.ts'

const require = createRequire(import.meta.url)
const { montarCozinhaBeta } = require('../../printer-agent/src/cozinha-beta.js')
const { montarPreContaBeta } = require('../../printer-agent/src/pre-conta-beta.js')
const SAIDA = process.argv[2] ?? '.shots/modelos-v3'
const TAM = process.argv[3] ?? 'grande'
const LOGO = process.argv[4] ? `data:image/png;base64,${readFileSync(process.argv[4]).toString('base64')}` : null

export function qr(url, instagram) {
  const q = QRCode.create(url, { errorCorrectionLevel: instagram ? 'H' : 'M' })
  const n = q.modules.size
  return { origem: instagram ? 'instagram' : 'cardapio', url, tamanho: n, linhas: Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => (q.modules.get(y, x) ? '1' : '0')).join('')) }
}
export const LOJA = { nome: 'Pizza do Rosa', telefone: '(27) 99999-0000', endereco: 'Av. Nossa Senhora da Penha, 1500 - Cond. Res. Jardim das Orquídeas' }
export const LOJA_PC = { ...LOJA, endereco: 'Avenida Nossa Senhora da Penha, Condomínio Residencial Jardim das Orquídeas, 1500' }
const CARDAPIO = qr('https://app.menuzia.com.br/loja/pizza-do-rosa', false)
const hora = (h, m) => new Date(Date.UTC(2026, 8, 28, h + 3, m))
const D = { loja: 'Pizza do Rosa', impressora: '', nomeSistema: '', computador: '', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 }

export function docsModelo() {
  const sc = snapshotCozinhaTeste(D, '', CARDAPIO, hora(15, 55))
  const cozinha = montarCozinhaBeta(sc.pedido, { lojaNome: 'Menuzia', loja: { ...LOJA, nome: 'Menuzia' }, extras: sc.extras, qr: sc.qr, teste: true })
  const cozinhaLoja = montarCozinhaBeta(sc.pedido, { lojaNome: 'Menuzia', loja: LOJA, extras: sc.extras, qr: sc.qr, teste: true })
  cozinhaLoja.blocos.find((b) => b.t === 'logo').nome = 'MENUZIA'
  const sp = snapshotReciboTeste(D, '', hora(15, 55))
  const preconta = montarPreContaBeta({ ...sp, qr: CARDAPIO, loja_dados: LOJA_PC })
  return { cozinha: cozinhaLoja, preconta, cozinhaSemLoja: cozinha }
}

if (process.argv[1] && process.argv[1].endsWith('render-modelos-v3.mjs')) {
  const d = docsModelo()
  for (const [n, doc, mm] of [['cozinha-80', d.cozinha, 80], ['preconta-80', d.preconta, 80], ['cozinha-58', d.cozinha, 58], ['preconta-58', d.preconta, 58]]) {
    const r = await renderizarTicket(doc, { larguraMm: mm, tamanhoFonte: TAM, logo: LOGO, imprimirLogo: !!LOGO, saida: join(SAIDA, `${n}-${TAM}.png`) })
    console.log(n, `${r.largura}x${r.altura}`)
  }
  await fecharRender()
}
