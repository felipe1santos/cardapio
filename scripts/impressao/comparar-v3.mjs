/**
 * CONFERÊNCIA do modelo oficial v3 (comanda_v3.png / preconta_v3.png) pelo renderizador
 * REAL (ticket-canvas.js / ticket.html num Chromium sem janela). Nunca imprime.
 *
 *   node scripts/impressao/comparar-v3.mjs
 *
 * Usa os MESMOS dados das imagens (pedido #135 da Ponto 400 e a pré-conta da mesa 04).
 * Saída: docs/impressao-final/comparacao/
 *   lado-a-lado-<comanda|pre-conta>-<576|512|384>.png   modelo × antes × v3 (mesma largura)
 *   v3-<comanda|pre-conta>-<576|512|384>.png            o v3 sozinho, em 1 bit
 */
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { renderizarTicket, fecharRender } from './render-ticket.mjs'

const require = createRequire(import.meta.url)
const { montarComandaV3, montarPreContaV3 } = require('../../printer-agent/src/v3.js')
const { montarCozinhaBeta } = require('../../printer-agent/src/cozinha-beta.js')
const { montarPreContaBeta } = require('../../printer-agent/src/pre-conta-beta.js')

const SAIDA = 'docs/impressao-final/comparacao'
const REFS = 'docs/impressao-final/referencias'
mkdirSync(SAIDA, { recursive: true })
mkdirSync(REFS, { recursive: true })
for (const f of ['comanda_v3.png', 'preconta_v3.png']) {
  const origem = `C:/Users/felipe/Downloads/${f}`
  if (!existsSync(`${REFS}/${f}`) && existsSync(origem)) copyFileSync(origem, `${REFS}/${f}`)
}
const REF = { comanda: `${REFS}/comanda_v3.png`, pre: `${REFS}/preconta_v3.png` }
// Papel dentro da imagem do modelo (fundo cinza em volta): x 20..451, y 20..1529/1610.
const PAPEL = { comanda: { left: 20, top: 20, width: 432, height: 1510 }, pre: { left: 20, top: 20, width: 432, height: 1591 } }

let falhas = 0
const ok = (n, c, d = '') => { if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

// Logo do modelo (o hambúrguer em chamas), recortada da própria referência.
// (recorte e trim em duas etapas: na mesma cadeia o sharp apara antes de recortar)
const recorte = await sharp(REF.comanda).extract({ left: 160, top: 32, width: 152, height: 178 }).flatten({ background: '#fff' }).png().toBuffer()
const logoPng = await sharp(recorte).trim({ threshold: 20 }).png().toBuffer()
const logo = `data:image/png;base64,${logoPng.toString('base64')}`

function qrDe(url) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const linhas = []
  for (let y = 0; y < n; y++) { let s = ''; for (let x = 0; x < n; x++) s += qr.modules.get(y, x) ? '1' : '0'; linhas.push(s) }
  return { origem: 'cardapio', url, tamanho: n, linhas }
}
const qr = qrDe('https://app.menuzia.com.br/loja/ponto-400')
const loja = { nome: 'Ponto 400 Hamburgueria', telefone: '27999990000', endereco: 'Rua Pedro Alves, 120 - Centro, Vila Velha/ES', linha1: 'Rua Pedro Alves, 120', cidade: 'Vila Velha/ES' }
const item = (nome, precoUnitario, quantidade = 1, complementos = [], observacao = '') =>
  ({ nome, quantidade, precoUnitario, observacao, tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos })

// Os dados de comanda_v3.png.
export const PEDIDO_135 = {
  id: 'p135', numero: 135, tipo: 'entrega', canal: 'delivery', origem: 'cardapio', status: 'recebido',
  formaPagamento: 'pix', pago: false, pagamentoOnline: false, trocoPara: null,
  clienteNome: 'kkk', clienteTelefone: '5527992399932',
  enderecoRua: 'jaburuna', enderecoNumero: '55', enderecoComplemento: '', enderecoBairro: 'DASDAS', enderecoCidade: '', enderecoReferencia: '',
  observacao: '', mesa: null, senha: null,
  subtotal: 94.63, taxaEntrega: 2.4, total: 97.03, criadoEm: '2026-10-01T23:43:00Z',
  itens: [
    item('Acai Grande 500 mL (300)', 19),
    item('X-Egg Bacon', 26, 2, [{ nome: 'Bacon', preco: 4 }]),
    item('Coca Lata 350ml', 5.63),
    item('Batata Frita (G)', 18),
  ],
}
// Os dados de preconta_v3.png.
const ci = (quantidade, nome, preco_unitario, complementos = []) => ({ quantidade, nome, preco_unitario, subtotal: Math.round(quantidade * preco_unitario * 100) / 100, complementos })
export const CONTA_MESA_04 = {
  versao: 1, loja: loja.nome, tipo: 'mesa', mesa: '04', comanda_numero: 26, atendente: 'Carlos', cliente_nome: 'Maria',
  impresso_em: '2026-10-02T00:47:00Z', via: 1,
  itens: [ci(2, 'X-Egg Bacon', 26, [{ nome: 'Bacon', preco: 4 }]), ci(1, 'Acai Grande 500 mL (300)', 19), ci(2, 'Coca Lata 350ml', 5.63)],
  subtotal: 82.26, taxa: 8.23, taxa_percentual: 10, taxas: [{ nome: 'Couvert', detalhe: '1 x R$ 15,00', valor: 15 }],
  desconto: 5, taxa_entrega: 0, total: 100.49, pago: 50, restante: 50.49, pagamentos: [{ forma: 'pix', valor: 50 }], cancelados: [],
}

async function umBit(png) {
  const { data } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
  for (const v of data) if (v !== 0 && v !== 255) return false
  return true
}
/** Nada escuro nas 2 colunas de cada borda FORA das faixas pretas (texto cortado encostaria). */
async function bordasLimpas(png) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let y = 0; y < info.height; y++) {
    let pretos = 0
    for (let x = 0; x < info.width; x++) if (data[y * info.width + x] < 128) pretos++
    const faixa = pretos > info.width * 0.6 // faixa preta de borda a borda (é o modelo)
    if (faixa) continue
    for (const x of [0, 1, info.width - 2, info.width - 1]) if (data[y * info.width + x] < 128) n++
  }
  return n === 0
}

/** Painéis lado a lado (mesma largura), com uma etiqueta em cima de cada um. */
async function ladoALado(paineis, saida) {
  const larg = Math.max(...(await Promise.all(paineis.map(async (p) => (await sharp(p.png).metadata()).width))))
  const imgs = []
  for (const p of paineis) {
    const buf = await sharp(p.png).resize({ width: larg }).flatten({ background: '#fff' }).png().toBuffer()
    imgs.push({ buf, meta: await sharp(buf).metadata(), rotulo: p.rotulo })
  }
  const cab = 40, gap = 24
  const alt = Math.max(...imgs.map((i) => i.meta.height)) + cab
  const W = imgs.length * larg + (imgs.length - 1) * gap
  const svg = Buffer.from(`<svg width="${W}" height="${cab}" xmlns="http://www.w3.org/2000/svg">${imgs.map((i, k) => `<text x="${k * (larg + gap) + larg / 2}" y="27" font-family="Arial" font-size="20" font-weight="700" text-anchor="middle" fill="#111">${i.rotulo}</text>`).join('')}</svg>`)
  await sharp({ create: { width: W, height: alt, channels: 3, background: '#bbbbbb' } })
    .composite([{ input: svg, left: 0, top: 0 }, ...imgs.map((i, k) => ({ input: i.buf, left: k * (larg + gap), top: cab }))])
    .png().toFile(saida)
}

try {
  const docs = {
    comanda: { v3: montarComandaV3(PEDIDO_135, { config: {}, lojaNome: loja.nome, loja, extras: { desconto: 0 }, qr }), antes: montarCozinhaBeta(PEDIDO_135, { config: {}, lojaNome: loja.nome, loja, extras: { desconto: 0 }, qr }) },
    'pre-conta': { v3: montarPreContaV3({ ...CONTA_MESA_04, qr, loja_dados: loja }), antes: montarPreContaBeta({ ...CONTA_MESA_04, qr, loja_dados: loja }) },
  }
  for (const [nome, d] of Object.entries(docs)) {
    console.log(`── ${nome}: modelo × antes × v3 ──`)
    const chave = nome === 'comanda' ? 'comanda' : 'pre'
    const ref = `${SAIDA}/_modelo-${nome}.png`
    await sharp(REF[chave]).extract(PAPEL[chave]).png().toFile(ref)
    for (const pontos of [576, 512, 384]) {
      const mm = pontos === 384 ? 58 : 80
      const v3 = `${SAIDA}/v3-${nome}-${pontos}.png`
      const antes = `${SAIDA}/_antes-${nome}-${pontos}.png`
      const r = await renderizarTicket(d.v3, { larguraMm: mm, larguraPontos: pontos, logo, saida: v3 })
      await renderizarTicket(d.antes, { larguraMm: mm, larguraPontos: pontos, logo, saida: antes })
      ok(`v3 ${nome} ${pontos} pontos: ${r.largura}×${r.altura}, 1 bit, nada encostando nas bordas`, r.largura === pontos && (await umBit(v3)) && (await bordasLimpas(v3)))
      const refAlt = PAPEL[chave].height * (pontos / 432)
      ok(`altura do v3 perto da do modelo na mesma largura (${Math.round(refAlt)} px)`, Math.abs(r.altura - refAlt) / refAlt < 0.08, `diferença ${Math.round((100 * (r.altura - refAlt)) / refAlt)}%`)
      await ladoALado([{ png: ref, rotulo: 'Modelo v3' }, { png: antes, rotulo: 'Antes (beta.8)' }, { png: v3, rotulo: `v3 (${pontos} pontos)` }], `${SAIDA}/lado-a-lado-${nome}-${pontos}.png`)
    }
  }
} finally {
  await fecharRender()
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
