/**
 * Simula o cenário do cliente (POS-8370, 80 mm): DRIVER DE 58 MM + sistema em 80 mm, e o
 * conserto — ENVIO DIRETO ESC/POS por IP (porta 9100) e pela fila do Windows (RAW).
 * Nada vai para impressora de verdade:
 *   • "impressora de rede" = um servidor TCP em 127.0.0.1 que recebe os bytes;
 *   • fila do Windows = print-raw.ps1 com MENUZIA_PRINT_TO_FILE (grava em arquivo) e
 *     -Verificar (só compila a chamada ao spooler).
 *
 *   node scripts/impressao/simular-envio-direto.mjs
 * Saída em docs/referencias/impressao/comparacao/: driver-58mm-cortado.png,
 * raw-rede-recebido.png, raw-texto-80mm.txt
 */
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { bitsDoTicket, fecharRender } from './render-ticket.mjs'
import { avisoDriver } from '../../lib/impressao/regras-calibracao.ts'

const require = createRequire(import.meta.url)
const { montarCozinhaBeta } = require('../../printer-agent/src/cozinha-beta.js')
const { imagemEscpos, textoEscpos, codificar, AVANCO_ANTES_DO_CORTE } = require('../../printer-agent/src/escpos.js')
const { enviarRede } = require('../../printer-agent/src/envio-direto.js')
const SAIDA = 'docs/referencias/impressao/comparacao'

let falhas = 0
const ok = (n, c, d = '') => { if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

function lerRaster(buf) {
  const faixas = []
  for (let i = 0; i < buf.length - 7; i++) {
    if (buf[i] === 0x1d && buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {
      const porLinha = buf[i + 4] + buf[i + 5] * 256, linhas = buf[i + 6] + buf[i + 7] * 256
      faixas.push({ porLinha, linhas, dados: buf.subarray(i + 8, i + 8 + porLinha * linhas) })
      i += 7 + porLinha * linhas
    }
  }
  return faixas
}
async function pngDeBits(bits, largura, altura, porLinha, arq, cortarEm = largura) {
  const px = Buffer.alloc(cortarEm * altura, 255)
  for (let y = 0; y < altura; y++) for (let x = 0; x < cortarEm; x++) if (bits[y * porLinha + (x >> 3)] & (0x80 >> (x & 7))) px[y * cortarEm + x] = 0
  await sharp(px, { raw: { width: cortarEm, height: altura, channels: 1 } }).png().toFile(arq)
}
/** "Impressora de rede" local: guarda o que chegar. */
function impressoraFalsa() {
  return new Promise((resolve) => {
    const recebido = []
    const srv = createServer((s) => { s.on('data', (d) => recebido.push(d)); s.on('end', () => s.end()) })
    srv.listen(0, '127.0.0.1', () => resolve({ porta: srv.address().port, bytes: () => Buffer.concat(recebido), limpar: () => { recebido.length = 0 }, fechar: () => srv.close() }))
  })
}

const qr = (() => { const q = QRCode.create('https://app.menuzia.com.br/loja/cliente', { errorCorrectionLevel: 'M' }); const n = q.modules.size; const l = []; for (let y = 0; y < n; y++) { let s = ''; for (let x = 0; x < n; x++) s += q.modules.get(y, x) ? '1' : '0'; l.push(s) } return { origem: 'cardapio', url: '', tamanho: n, linhas: l } })()
const loja = { nome: 'Lanchonete do Cliente', telefone: '(27) 3333-4444', linha1: 'Rua das Flores, 100', cidade: 'Vila Velha/ES', endereco: '' }
const pedido = {
  id: 'x', numero: 207, tipo: 'retirada', canal: 'mesa', mesa: '05', formaPagamento: null, clienteNome: 'Cliente', clienteTelefone: '',
  subtotal: 71.8, taxaEntrega: 0, total: 71.8, criadoEm: '2026-09-29T20:00:00Z',
  itens: [{ nome: 'Pão com Linguiça Especial', quantidade: 2, precoUnitario: 18.9, observacao: 'bem passado', complementos: [{ nome: 'Queijo', preco: 3 }] }, { nome: 'Açaí 500 ml', quantidade: 1, precoUnitario: 34, observacao: '', complementos: [] }],
}
const doc = montarCozinhaBeta(pedido, { config: {}, lojaNome: loja.nome, loja, extras: { comandaNumero: 12, atendente: 'João' }, qr })

const impressora = await impressoraFalsa()
try {
  console.log('── Cenário: driver de 58 mm numa impressora de 80 mm ──')
  const diag = { driver: 'POS-58 Series', papelLarguraMm: 58, pontosImprimiveis: 384, dpiX: 203 }
  const aviso = avisoDriver({ larguraMm: 80, larguraPontos: null, envio: 'driver', diagnostico: diag })
  ok('Calibrar impressora avisa: driver de 58 mm × impressora de 80 mm', aviso === 'Seu driver está em 58 mm, mas a impressora é de 80 mm. A comanda sai cortada à direita.', aviso ?? '')
  const img = await bitsDoTicket(doc, { larguraMm: 80 })
  ok('comanda desenhada em 576 pontos (80 mm), 1 bit', img.largura === 576 && img.porLinha === 72)
  // O que o driver de 58 mm faz: só os primeiros 384 pontos saem no papel (2/3).
  await pngDeBits(img.bits, img.largura, img.altura, img.porLinha, `${SAIDA}/driver-58mm-cortado.png`, 384)
  let foraDo58 = 0
  for (let y = 0; y < img.altura; y++) for (let x = 384; x < 576; x++) if (img.bits[y * 72 + (x >> 3)] & (0x80 >> (x & 7))) foraDo58++
  ok('pelo driver de 58 mm, a coluna de valores ficaria fora do papel (o "cortado" do cliente)', foraDo58 > 1000, `${foraDo58} pontos pretos depois do ponto 384`)
  ok('com o envio direto o aviso some (quem manda na largura é o sistema)', avisoDriver({ larguraMm: 80, larguraPontos: null, envio: 'raw_rede', diagnostico: diag }) === null)

  console.log('── Envio direto por IP (porta 9100), modo imagem ──')
  const bytes = imagemEscpos(img, { intensidade: 'escura' })
  const r = await enviarRede('127.0.0.1', impressora.porta, bytes)
  await new Promise((ok2) => setTimeout(ok2, 400))
  const chegou = impressora.bytes()
  ok('a impressora recebeu exatamente os bytes enviados', r.bytes === bytes.length && chegou.equals(bytes), `${chegou.length} bytes`)
  const faixas = lerRaster(chegou)
  const junto = Buffer.concat(faixas.map((f) => f.dados))
  ok('imagem inteira em 576 pontos, em faixas de até 192 linhas, sem redimensionar', faixas.every((f) => f.porLinha === 72 && f.linhas <= 192) && junto.equals(Buffer.from(img.bits)), `${faixas.length} faixas`)
  ok('densidade "escura" enviada (GS ( K)', chegou.indexOf(Buffer.from([0x1d, 0x28, 0x4b, 0x02, 0x00, 0x31, 0x03])) > 0)
  ok(`avança ${AVANCO_ANTES_DO_CORTE} linhas antes da guilhotina e corta`, chegou.subarray(-6).equals(Buffer.from([0x1b, 0x64, AVANCO_ANTES_DO_CORTE, 0x1d, 0x56, 0x01])))
  await pngDeBits(junto, 576, img.altura, 72, `${SAIDA}/raw-rede-recebido.png`)
  ok('imagem remontada do que a impressora recebeu: raw-rede-recebido.png', true)

  console.log('── Envio direto por IP, modo texto (compatibilidade) ──')
  impressora.limpar()
  const texto = textoEscpos(doc, { larguraPontos: 576 })
  await enviarRede('127.0.0.1', impressora.porta, texto)
  await new Promise((ok2) => setTimeout(ok2, 400))
  const t = impressora.bytes()
  ok('página de código PC850 selecionada (ESC t 2) e acentos certos (PÃO, AÇAÍ)', t.indexOf(Buffer.from([0x1b, 0x74, 0x02])) >= 0 && t.indexOf(Buffer.from(codificar('PÃO COM LINGUIÇA'))) > 0 && t.indexOf(Buffer.from(codificar('AÇAÍ'))) > 0)
  // Texto legível (PC850 → UTF-8) para conferir.
  const PC = new Map(Object.entries({ 0x80: 'Ç', 0x87: 'ç', 0x82: 'é', 0x90: 'É', 0xc7: 'Ã', 0xc6: 'ã', 0xe5: 'Õ', 0xe4: 'õ', 0xa0: 'á', 0xa1: 'í', 0xa2: 'ó', 0xa3: 'ú', 0xb5: 'Á', 0xd6: 'Í', 0xe0: 'Ó', 0xe9: 'Ú', 0x83: 'â', 0x88: 'ê', 0x93: 'ô', 0xb6: 'Â', 0xd2: 'Ê', 0xe2: 'Ô', 0x85: 'à' }).map(([k, v]) => [Number(k), v]))
  let legivel = ''
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === 0x1b && t[i + 1] === 0x40) { i += 1; continue }
    if (c === 0x1d && t[i + 1] === 0x76) { i += 7 + (t[i + 4] + t[i + 5] * 256) * (t[i + 6] + t[i + 7] * 256); legivel += '[QR]\n'; continue }
    if (c === 0x1b || c === 0x1d) { i += c === 0x1d && t[i + 1] === 0x28 ? 6 : 2; continue }
    legivel += c === 0x0a ? '\n' : PC.get(c) ?? (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '')
  }
  writeFileSync(`${SAIDA}/raw-texto-80mm.txt`, legivel)
  ok('QR impresso como imagem no modo texto', legivel.includes('[QR]'))
  ok('nenhuma linha passa de 48 colunas (80 mm, fonte A)', legivel.split('\n').every((l) => l.length <= 48), `mais longa: ${Math.max(...legivel.split('\n').map((l) => l.length))}`)

  console.log('── Envio direto pela fila do Windows (RAW), sem imprimir ──')
  const bin = join(tmpdir(), `menuzia-raw-${Date.now()}.bin`)
  const saida = join(tmpdir(), `menuzia-raw-saida-${Date.now()}.bin`)
  writeFileSync(bin, bytes)
  const ps = (extra, env = {}) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'printer-agent/src/print-raw.ps1', '-PrinterName', 'POS-8370', '-Arquivo', bin, ...extra], { env: { ...process.env, ...env }, encoding: 'utf8' })
  const s1 = ps([], { MENUZIA_PRINT_TO_FILE: saida })
  ok('print-raw.ps1 entrega os mesmos bytes (modo arquivo de teste)', readFileSync(saida).equals(bytes), s1.trim().split('\n').at(-1))
  const s2 = ps(['-Verificar'])
  ok('chamada ao spooler (winspool, tipo RAW) compila no Windows', /compilada/.test(s2), s2.trim().split('\n').at(-1))
  rmSync(bin, { force: true }); rmSync(saida, { force: true })

  console.log('── Impressora desligada / IP errado ──')
  impressora.fechar()
  let erro = ''
  try { await enviarRede('127.0.0.1', impressora.porta, bytes, { prazoMs: 3000 }) } catch (e) { erro = e.message }
  ok('falha rápida e com motivo (a fila tenta de novo)', /rede 127\.0\.0\.1|não respondeu/.test(erro), erro)
} finally {
  impressora.fechar()
  await fecharRender()
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
