/**
 * Mede, NESTE computador, o custo de cada etapa da impressão do Assistente Beta — sem
 * impressora física e sem imprimir papel:
 *   • desenho (ticket-canvas.js num Chromium, como a janela oculta do Assistente), frio e quente;
 *   • envio pelo DRIVER (print-imagem.ps1 → "Microsoft Print to PDF" gravando em arquivo);
 *   • envio pela FILA RAW (print-raw.ps1: arquivo de teste e compilação do winspool);
 *   • envio pela REDE (IP:9100 → servidor TCP local).
 *
 *   node scripts/impressao/medir-etapas.mjs [--antes]   (10 repetições de cada)
 * Saída: tabela no console e scripts/impressao/medicoes/etapas-<rotulo>.json
 */
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { execFile } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { renderizarTicket, bitsDoTicket, fecharRender } from './render-ticket.mjs'
import { snapshotReciboTeste } from '../../lib/impressao/recibo-teste.ts'

const require = createRequire(import.meta.url)
const { montarCozinhaBeta } = require('../../printer-agent/src/cozinha-beta.js')
const { montarPreContaBeta } = require('../../printer-agent/src/pre-conta-beta.js')
const { imagemEscpos } = require('../../printer-agent/src/escpos.js')
const { enviarRede } = require('../../printer-agent/src/envio-direto.js')
const ROTULO = process.argv.includes('--antes') ? 'antes' : 'depois'
const N = 10
const TMP = join(tmpdir(), `menuzia-medir-${Date.now()}`)
mkdirSync(TMP, { recursive: true })

const qrm = QRCode.create('https://app.menuzia.com.br/loja/x', { errorCorrectionLevel: 'M' })
const qr = { origem: 'cardapio', linhas: Array.from({ length: qrm.modules.size }, (_, y) => Array.from({ length: qrm.modules.size }, (_, x) => (qrm.modules.get(y, x) ? '1' : '0')).join('')) }
const loja = { nome: 'Loja', telefone: '(27) 3333-4444', linha1: 'Rua A, 1', cidade: 'Vila Velha/ES' }
const pedido = { id: 'm', numero: 1, tipo: 'retirada', canal: 'mesa', mesa: '01', clienteNome: 'Cliente', subtotal: 40, taxaEntrega: 0, total: 40, criadoEm: new Date().toISOString(),
  itens: [{ nome: 'X-Tudo', quantidade: 2, precoUnitario: 20, observacao: 'sem cebola', complementos: [{ nome: 'Bacon', preco: 2 }] }] }
const comanda = montarCozinhaBeta(pedido, { config: {}, lojaNome: 'Loja', loja, extras: {}, qr })
const conta = montarPreContaBeta({ ...snapshotReciboTeste({ loja: 'Loja', impressora: 'X', nomeSistema: 'X', computador: 'PC', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 }, 'Op'), qr, loja_dados: loja })

const ms = () => performance.now()
const stats = (xs) => ({ media: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length), max: Math.round(Math.max(...xs)), min: Math.round(Math.min(...xs)) })
const ps = (args, env = {}) => new Promise((ok, erro) => execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { env: { ...process.env, ...env }, windowsHide: true }, (e, out, err) => (e ? erro(new Error(err || e.message)) : ok(out))))
const linhas = []
const medir = async (nome, fn, n = N) => { const xs = []; for (let i = 0; i < n; i++) { const t = ms(); await fn(i); xs.push(ms() - t) } const s = stats(xs); linhas.push({ etapa: nome, ...s, n }); console.log(`${nome.padEnd(58)} média ${String(s.media).padStart(5)} ms   máx ${String(s.max).padStart(5)} ms`) }

try {
  console.log(`── Etapas (${ROTULO}), ${N}× cada ──`)
  let t = ms(); await renderizarTicket(comanda, { larguraMm: 80, saida: join(TMP, 'c.png') })
  linhas.push({ etapa: 'desenho da comanda — FRIO (abre o desenho e carrega fontes)', media: Math.round(ms() - t), max: Math.round(ms() - t), n: 1 })
  console.log(`desenho da comanda — FRIO${' '.repeat(33)} ${Math.round(ms() - t)} ms`)
  await medir('desenho da comanda (PNG) — quente', () => renderizarTicket(comanda, { larguraMm: 80, saida: join(TMP, 'c.png') }))
  await medir('desenho da pré-conta (PNG) — quente', () => renderizarTicket(conta, { larguraMm: 80, saida: join(TMP, 'p.png') }))
  let bits
  await medir('desenho da comanda em bits (ESC/POS) — quente', async () => { bits = await bitsDoTicket(comanda, { larguraMm: 80 }) })
  await medir('montar ESC/POS (imagem, faixas, corte)', async () => { imagemEscpos(bits) })

  await medir('DRIVER: print-imagem.ps1 → PDF (PowerShell novo a cada vez)', (i) => ps(['-File', 'printer-agent/src/print-imagem.ps1', '-PrinterName', 'Microsoft Print to PDF', '-ImagemPng', join(TMP, 'c.png'), '-Titulo', 'medir'], { MENUZIA_PRINT_TO_FILE: join(TMP, `d${i}.pdf`) }))
  const bin = join(TMP, 'c.bin'); writeFileSync(bin, imagemEscpos(bits))
  await medir('FILA RAW: print-raw.ps1 (PowerShell novo + compila winspool)', () => ps(['-File', 'printer-agent/src/print-raw.ps1', '-PrinterName', 'X', '-Arquivo', bin], { MENUZIA_PRINT_TO_FILE: join(TMP, 'r.bin') }))

  // Servidor de impressão residente (0.2.0-beta.7): o mesmo trabalho, sem abrir PowerShell.
  const { ServidorImpressao } = require('../../printer-agent/src/servidor-ps.js')
  process.env.MENUZIA_PRINT_TO_FILE = join(TMP, 'srv.pdf')
  const srv1 = new ServidorImpressao('printer-agent/src/servidor-impressao.ps1', { logNome: 'menuzia-medir.log' })
  let tSobe = ms(); await srv1.pedir({ acao: 'ping' })
  linhas.push({ etapa: 'servidor residente: subir (1× por impressora, no início)', media: Math.round(ms() - tSobe), max: Math.round(ms() - tSobe), n: 1 })
  console.log(`servidor residente: subir (1×)${' '.repeat(29)} ${Math.round(ms() - tSobe)} ms`)
  await medir('DRIVER via servidor residente → PDF', () => srv1.pedir({ acao: 'imagem', impressora: 'Microsoft Print to PDF', arquivo: join(TMP, 'c.png'), copias: 1, desloc: 0, titulo: 'medir' }))
  await medir('FILA RAW via servidor residente', () => srv1.pedir({ acao: 'raw', impressora: 'X', arquivo: bin, titulo: 'medir' }))
  srv1.fechar()
  delete process.env.MENUZIA_PRINT_TO_FILE

  const recebido = []
  const srv = createServer((s) => { s.on('data', (d) => recebido.push(d.length)); s.on('end', () => s.end()) })
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
  const porta = srv.address().port
  const bytes = readFileSync(bin)
  await medir('REDE: IP:9100 (conecta, envia, fecha)', () => enviarRede('127.0.0.1', porta, bytes))
  srv.close()
} finally {
  await fecharRender()
  rmSync(TMP, { recursive: true, force: true })
}
mkdirSync('scripts/impressao/medicoes', { recursive: true })
writeFileSync(`scripts/impressao/medicoes/etapas-${ROTULO}.json`, JSON.stringify({ em: new Date().toISOString(), linhas }, null, 2))
