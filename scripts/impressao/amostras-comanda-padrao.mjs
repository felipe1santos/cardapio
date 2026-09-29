/**
 * Amostras da COMANDA PADRÃO (docs/referencias/impressao/comanda-padrao.png) e da pré-conta
 * em 1 bit, pelo renderizador REAL (ticket-canvas.js / ticket.html num Chromium sem janela).
 * Nunca imprime. Confere também que nada encosta nas bordas (valor cortado).
 *
 *   node scripts/impressao/amostras-comanda-padrao.mjs
 *
 * Saída: docs/referencias/impressao/comparacao/
 *   comanda-<mesa|entrega|retirada>-<80|58>mm-<grande|media|pequena>.png
 *   lado-a-lado-mesa-80mm.png   (referência × nossa, mesma largura)
 *   pre-conta-<384|512|576>.png e pre-conta-576-antes.png (com o cinza de antes)
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { renderizarTicket, fecharRender } from './render-ticket.mjs'
import { snapshotReciboTeste } from '../../lib/impressao/recibo-teste.ts'

const require = createRequire(import.meta.url)
const { montarCozinhaBeta } = require('../../printer-agent/src/cozinha-beta.js')
const { montarPreContaBeta } = require('../../printer-agent/src/pre-conta-beta.js')
const SAIDA = 'docs/referencias/impressao/comparacao'
const REF = 'docs/referencias/impressao/comanda-padrao.png'
mkdirSync(SAIDA, { recursive: true })

let falhas = 0
const ok = (n, c, d = '') => { if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

// Logo da loja do modelo ("SUSHI"), recortada da própria referência.
const logoPng = await sharp(REF).extract({ left: 480, top: 40, width: 300, height: 176 }).flatten({ background: '#fff' }).trim({ threshold: 20 }).png().toBuffer()
const logo = `data:image/png;base64,${logoPng.toString('base64')}`

function qrDe(url) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const linhas = []
  for (let y = 0; y < n; y++) { let s = ''; for (let x = 0; x < n; x++) s += qr.modules.get(y, x) ? '1' : '0'; linhas.push(s) }
  return { origem: 'cardapio', url, tamanho: n, linhas }
}
const qr = qrDe('https://app.menuzia.com.br/loja/dayse-sushi')
const loja = { nome: 'Dayse Brandao Ferreira', telefone: '(27) 99239-9932', endereco: 'Avenida Henrique Moscoso, 2250 - Centro, Vila Velha/ES', linha1: 'Avenida Henrique Moscoso, 2250', cidade: 'Vila Velha/ES' }
const item = (nome, precoUnitario, complementos = [], observacao = '', quantidade = 1) =>
  ({ nome, quantidade, precoUnitario, observacao, tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos })

const PEDIDOS = {
  // Os dados da referência.
  mesa: {
    pedido: {
      id: 'mesa', numero: 133, tipo: 'retirada', canal: 'mesa', origem: 'pdv', mesa: '01', formaPagamento: null, clienteNome: 'Cliente Testes', clienteTelefone: '',
      subtotal: 59.53, taxaEntrega: 0, total: 59.53, criadoEm: '2026-09-29T20:57:00Z',
      itens: [item('Coca Lata 350ml', 5.63), item('Bolo Duplo', 14.9), item('Smash', 29), item('Xtudo', 10, [{ nome: 'item 2', preco: 1 }], 'sadasdasdasd')],
    },
    extras: { desconto: 0, comandaNumero: 21, atendente: 'Administrador' },
  },
  // O pior caso do motoboy: endereço longo, complemento, referência e troco.
  entrega: {
    pedido: {
      id: 'entrega', numero: 134, tipo: 'entrega', canal: 'delivery', origem: 'cardapio', formaPagamento: 'dinheiro', trocoPara: 100, pago: false,
      clienteNome: 'Maria Aparecida dos Santos Oliveira', clienteTelefone: '27999887766',
      enderecoRua: 'Avenida Estudante José Júlio de Souza', enderecoNumero: '4125', enderecoComplemento: 'Apto 1203, bloco B, interfone 1203',
      enderecoBairro: 'Praia de Itaparica', enderecoCidade: 'Vila Velha/ES', enderecoReferencia: 'Em frente à padaria Pão Quente, portão verde ao lado do mercado',
      subtotal: 62.8, taxaEntrega: 7, total: 69.8, criadoEm: '2026-09-29T21:10:00Z',
      itens: [
        item('X-Burguer Duplo com Bacon, Cheddar Cremoso e Cebola Caramelizada', 42.9, [{ nome: 'Bacon extra', preco: 4 }, { nome: 'Maionese da casa', preco: 0 }], 'sem tomate, ponto da carne bem passado'),
        item('Refrigerante Lata 350ml', 5, [], '', 2),
        item('Batata Frita Média', 9.9),
      ],
    },
    extras: { desconto: 0, prontoEm: '2026-09-29T21:28:00Z' },
  },
  retirada: {
    pedido: {
      id: 'retirada', numero: 135, tipo: 'retirada', canal: 'delivery', origem: 'cardapio', formaPagamento: 'pix', clienteNome: 'João Pedro', clienteTelefone: '27988776655',
      subtotal: 29, taxaEntrega: 0, total: 29, criadoEm: '2026-09-29T21:15:00Z', itens: [item('Smash', 29)],
    },
    extras: { desconto: 0 },
  },
}

/** Nada escuro nas 2 colunas de cada borda (texto/valor cortado encostaria nelas). */
async function bordasLimpas(png) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let y = 0; y < info.height; y++) for (const x of [0, 1, info.width - 2, info.width - 1]) if (data[y * info.width + x] < 128) n++
  return n === 0
}
/** Só preto e branco (1 bit)? */
async function umBit(png) {
  const { data } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
  for (const v of data) if (v !== 0 && v !== 255) return false
  return true
}

try {
  console.log('── Comanda padrão: mesa, entrega e retirada × 58/80 mm × letras ──')
  for (const [tipo, { pedido, extras }] of Object.entries(PEDIDOS)) {
    const doc = montarCozinhaBeta(pedido, { config: {}, lojaNome: loja.nome, loja, extras, qr })
    for (const mm of [80, 58]) {
      for (const letra of ['grande', 'media', 'pequena']) {
        const arq = `${SAIDA}/comanda-${tipo}-${mm}mm-${letra}.png`
        const r = await renderizarTicket(doc, { larguraMm: mm, tamanhoFonte: letra, logo, saida: arq })
        ok(`${tipo} ${mm} mm ${letra}: ${r.largura}×${r.altura}, 1 bit, nada encostando nas bordas`, r.largura === (mm === 58 ? 384 : 576) && (await umBit(arq)) && (await bordasLimpas(arq)))
      }
    }
  }

  // Lado a lado: referência (papel recortado, na largura 576) × nossa mesa 80 mm grande.
  const nossa = `${SAIDA}/comanda-mesa-80mm-grande.png`
  const mn = await sharp(nossa).metadata()
  const ref = await sharp(REF).extract({ left: 30, top: 0, width: 1200, height: 2523 }).flatten({ background: '#fff' }).resize(mn.width).png().toBuffer()
  const mr = await sharp(ref).metadata()
  await sharp({ create: { width: mn.width * 2 + 24, height: Math.max(mr.height, mn.height), channels: 3, background: '#bbbbbb' } })
    .composite([{ input: ref, left: 0, top: 0 }, { input: nossa, left: mn.width + 24, top: 0 }]).png().toFile(`${SAIDA}/lado-a-lado-mesa-80mm.png`)
  ok(`lado a lado salvo (referência ${mr.height} px de altura × nossa ${mn.height} px na mesma largura)`, Math.abs(mr.height - mn.height) / mr.height < 0.08, `diferença ${Math.round((100 * (mn.height - mr.height)) / mr.height)}%`)

  console.log('── Pré-conta em 384 / 512 / 576 pontos (correção do "apagado") ──')
  const destino = { loja: loja.nome, impressora: 'Caixa', nomeSistema: 'POS-8370', computador: 'PC', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 }
  const conta = snapshotReciboTeste(destino, 'Operador', new Date('2026-09-29T21:30:00Z'))
  const docConta = montarPreContaBeta({ ...conta, qr, loja_dados: loja })
  for (const pontos of [384, 512, 576]) {
    const arq = `${SAIDA}/pre-conta-${pontos}.png`
    const r = await renderizarTicket(docConta, { larguraMm: pontos === 384 ? 58 : 80, larguraPontos: pontos, logo, saida: arq })
    ok(`pré-conta ${pontos} pontos: ${r.largura}×${r.altura}, 1 bit, bordas limpas`, r.largura === pontos && (await umBit(arq)) && (await bordasLimpas(arq)))
  }
  await renderizarTicket(docConta, { larguraMm: 80, logo, umBit: false, saida: `${SAIDA}/pre-conta-576-antes.png` })
  ok('pré-conta de antes (com cinza) salva para comparar', true)
  await renderizarTicket(docConta, { larguraMm: 80, logo, intensidade: 'mais_escura', saida: `${SAIDA}/pre-conta-576-mais-escura.png` })
  ok('pré-conta "mais escura" salva', true)
} finally {
  await fecharRender()
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
