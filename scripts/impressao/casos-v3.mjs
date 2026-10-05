/**
 * MATRIZ DE CASOS do modelo v3 pelo renderizador REAL (ticket-canvas.js num Chromium sem
 * janela) e uma IMPRESSORA VIRTUAL de rede (servidor TCP local na porta 9100 de mentira).
 * Nunca imprime em papel, nunca fala com produção.
 *
 *   node scripts/impressao/casos-v3.mjs
 *
 * Saída: docs/impressao-final/comparacao/casos/
 *   <caso>-<576|512|384>.png       cada caso em 1 bit
 *   mosaico-<576|512|384>.png      todos os casos lado a lado
 *   texto-<caso>.bin / .txt        modo Texto (ESC/POS, WPC1252) recebido pela impressora virtual
 *   tempos.json                    desenho, conversão e envio pela rede virtual
 */
import { createRequire } from 'node:module'
import { createServer, connect } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { renderizarTicket, bitsDoTicket, fecharRender } from './render-ticket.mjs'

const require = createRequire(import.meta.url)
const { montarComandaV3, montarPreContaV3, textoDoV3 } = require('../../printer-agent/src/v3.js')
const { imagemEscpos, textoEscpos } = require('../../printer-agent/src/escpos.js')

const SAIDA = 'docs/impressao-final/comparacao/casos'
mkdirSync(SAIDA, { recursive: true })
let falhas = 0
const ok = (n, c, d = '') => { if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

function qrDe(url, origem = 'cardapio') {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const linhas = []
  for (let y = 0; y < n; y++) { let s = ''; for (let x = 0; x < n; x++) s += qr.modules.get(y, x) ? '1' : '0'; linhas.push(s) }
  return { origem, url, tamanho: n, linhas }
}
const qr = qrDe('https://app.menuzia.com.br/loja/ponto-400')
const qrInsta = qrDe('https://instagram.com/ponto400', 'instagram')
const logoSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#fff"/><circle cx="150" cy="100" r="80" fill="#000"/><text x="150" y="118" font-size="56" font-family="Arial" font-weight="700" fill="#fff" text-anchor="middle">P400</text></svg>')
const logo = `data:image/png;base64,${(await sharp(logoSvg).png().toBuffer()).toString('base64')}`
const loja = { nome: 'Ponto 400 Hamburgueria', telefone: '27999990000', endereco: 'Rua Pedro Alves, 120 - Centro, Vila Velha/ES' }
const lojaLonga = { nome: 'Hamburgueria e Pizzaria Artesanal do Bairro Jardim Camburi Ltda', telefone: '2733334444', endereco: 'Avenida Nossa Senhora da Penha, 1500 - Loja 3, Galeria Central - Santa Lúcia, Vitória/ES' }
const item = (nome, precoUnitario, quantidade = 1, complementos = [], observacao = '', extra = {}) =>
  ({ nome, quantidade, precoUnitario, observacao, tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos, ...extra })
const base = {
  id: 'c', numero: 135, tipo: 'entrega', canal: 'delivery', status: 'recebido', formaPagamento: 'pix', pago: false, pagamentoOnline: false, trocoPara: null,
  clienteNome: 'kkk', clienteTelefone: '5527992399932', enderecoRua: 'jaburuna', enderecoNumero: '55', enderecoComplemento: '', enderecoBairro: 'DASDAS',
  enderecoCidade: '', enderecoReferencia: '', observacao: '', mesa: null, senha: null, subtotal: 94.63, taxaEntrega: 2.4, total: 97.03, criadoEm: '2026-10-01T23:43:00Z',
  itens: [item('Acai Grande 500 mL (300)', 19), item('X-Egg Bacon', 26, 2, [{ nome: 'Bacon', preco: 4 }]), item('Coca Lata 350ml', 5.63), item('Batata Frita (G)', 18)],
}
const muitos = Array.from({ length: 18 }, (_, i) => item(`Item número ${i + 1} do cardápio`, 10 + i, 1 + (i % 3)))
const somaMuitos = Math.round(muitos.reduce((s, x) => s + x.precoUnitario * x.quantidade, 0) * 100) / 100

const COMANDAS = {
  'comanda-entrega': [base, {}],
  'comanda-retirada': [{ ...base, tipo: 'retirada', taxaEntrega: 0, total: 94.63, formaPagamento: 'credito', pago: true }, {}],
  'comanda-mesa': [{ ...base, canal: 'mesa', tipo: 'retirada', mesa: '04', formaPagamento: null, taxaEntrega: 0, total: 94.63, clienteNome: 'Maria' }, { comandaNumero: 26, atendente: 'Carlos' }],
  'comanda-balcao': [{ ...base, canal: 'balcao', tipo: 'retirada', senha: 12, formaPagamento: 'debito', pago: true, taxaEntrega: 0, total: 94.63 }, { atendente: 'Carlos' }],
  'comanda-pix-online': [{ ...base, pagamentoOnline: true, pago: true }, {}],
  'comanda-dinheiro-troco': [{ ...base, formaPagamento: 'dinheiro', trocoPara: 100, enderecoReferencia: 'Em frente à padaria, portão verde' }, {}],
  'comanda-vale': [{ ...base, formaPagamento: 'vale' }, {}],
  'comanda-desconto-obs': [{
    ...base, observacao: 'Entregar na portaria. Não tocar a campainha, bebê dormindo.', total: 92.03,
    itens: [item('X-Burguer Duplo com Bacon, Cheddar Cremoso e Cebola Caramelizada', 42.9, 1, [{ nome: 'Bacon extra', preco: 4 }, { nome: 'Maionese da casa', preco: 0 }], 'sem tomate, ponto da carne bem passado'), item('Coca Lata 350ml', 5.63, 2), item('Batata Frita (G)', 18, 1, [], 'bem sequinha')],
  }, { desconto: 5 }],
  'comanda-nomes-longos': [{
    ...base, clienteNome: 'Maria Aparecida dos Santos Oliveira de Albuquerque', enderecoRua: 'Avenida Estudante José Júlio de Souza', enderecoNumero: '4125',
    enderecoComplemento: 'Apto 1203, bloco B, interfone 1203', enderecoBairro: 'Praia de Itaparica', enderecoCidade: 'Vila Velha/ES',
    itens: [item('Pizza Grande', 79.9, 1, [{ nome: 'Borda recheada de catupiry', preco: 12 }], '', { saborNome: 'Calabresa / Quatro Queijos / Frango com Catupiry', bordaNome: 'Catupiry' }), item('Refrigerante Guaraná Antarctica Zero Açúcar Garrafa 2 L', 14)],
  }, {}, lojaLonga],
  'comanda-muitos-itens': [{ ...base, itens: muitos, subtotal: somaMuitos, total: somaMuitos + 2.4 }, {}],
  'comanda-sem-logo': [base, {}, loja, false],
  'comanda-instagram': [base, {}, loja, true, qrInsta],
}
const conta = (x = {}) => ({
  tipo: 'mesa', mesa: '04', comanda_numero: 26, atendente: 'Carlos', cliente_nome: 'Maria', impresso_em: '2026-10-02T00:47:00Z', via: 1,
  itens: [{ quantidade: 2, nome: 'X-Egg Bacon', preco_unitario: 26, complementos: [{ nome: 'Bacon', preco: 4 }] }, { quantidade: 1, nome: 'Acai Grande 500 mL (300)', preco_unitario: 19, observacao: 'sem granola' }, { quantidade: 2, nome: 'Coca Lata 350ml', preco_unitario: 5.63 }],
  subtotal: 82.26, taxa: 8.23, taxa_percentual: 10, taxas: [{ nome: 'Couvert', detalhe: '1 x R$ 15,00', valor: 15 }], desconto: 5, taxa_entrega: 0,
  total: 100.49, pago: 50, restante: 50.49, ...x,
})
const CONTAS = {
  'pre-conta-mesa': conta(),
  'pre-conta-mesa-sem-pagamento': conta({ pago: 0, restante: 100.49, desconto: 0, total: 105.49, taxas: [] }),
  'pre-conta-balcao': conta({ tipo: 'balcao', mesa: null, senha: 7, taxa: 0, taxa_percentual: 0, taxas: [], total: 77.26, pago: 0, restante: 77.26 }),
  'pre-conta-2a-via': conta({ via: 2 }),
}

const docs = {}
for (const [nome, [p, extras, l = loja, comLogo = true, q = qr]] of Object.entries(COMANDAS)) docs[nome] = { doc: montarComandaV3(p, { config: {}, loja: l, extras, qr: q }), comLogo }
for (const [nome, s] of Object.entries(CONTAS)) docs[nome] = { doc: montarPreContaV3({ ...s, qr, loja_dados: loja }), comLogo: true }
docs['via-cozinha-entrega'] = { doc: montarComandaV3(COMANDAS['comanda-desconto-obs'][0], { loja, via: 'cozinha', qr }), comLogo: true }
docs['via-cozinha-mesa'] = { doc: montarComandaV3(COMANDAS['comanda-mesa'][0], { loja, extras: { comandaNumero: 26, atendente: 'Carlos' }, via: 'cozinha' }), comLogo: true }

console.log('── Regras no documento ──')
ok('aguardando pagamento não monta comanda', montarComandaV3({ ...base, status: 'aguardando_pagamento', pagamentoOnline: true }, { loja }) === null)
const txt = (n) => textoDoV3(docs[n].doc)
ok('Pix online confirmado: "Pagamento: PIX ONLINE - PAGO"', txt('comanda-pix-online').includes('Pagamento: PIX ONLINE - PAGO'))
ok('Pix comum não pago: sem "PAGO"', !/PAGO/.test(txt('comanda-entrega')))
ok('telefone sem o 55 em todas as comandas', Object.keys(COMANDAS).every((n) => !txt(n).includes('5527992399932')))
ok('nenhuma linha de dado começa com hífen', Object.keys(docs).every((n) => docs[n].doc.blocos.filter((b) => b.t === 'dado').every((b) => b.partes.every((x) => !/^\s*-/.test(x)))))
ok('linhas zeradas omitidas (retirada sem "Taxa de entrega")', !txt('comanda-retirada').includes('Taxa de entrega'))
ok('via da cozinha sem R$ e sem PAGAMENTO', ['via-cozinha-entrega', 'via-cozinha-mesa'].every((n) => !/R\$|PAGAMENTO/.test(txt(n))))
ok('observação geral numa faixa antes de PAGAMENTO', /OBSERVAÇÃO\nEntregar na portaria[^\n]*\nPAGAMENTO/.test(txt('comanda-desconto-obs')))

/** 1 bit e nada encostando nas bordas fora das faixas pretas. */
async function conferir(png) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true })
  let cinza = false, borda = 0
  for (const v of data) if (v !== 0 && v !== 255) { cinza = true; break }
  for (let y = 0; y < info.height; y++) {
    let pretos = 0
    for (let x = 0; x < info.width; x++) if (data[y * info.width + x] < 128) pretos++
    if (pretos > info.width * 0.6) continue
    for (const x of [0, 1, info.width - 2, info.width - 1]) if (data[y * info.width + x] < 128) borda++
  }
  return !cinza && borda === 0
}

// Impressora virtual de rede: recebe os bytes como uma térmica na porta 9100.
const recebidos = []
const servidor = createServer((s) => { const partes = []; s.on('data', (d) => partes.push(d)); s.on('end', () => recebidos.push(Buffer.concat(partes))) })
await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
const porta = servidor.address().port
const enviar = (buf) => new Promise((res, rej) => { const c = connect(porta, '127.0.0.1', () => c.end(buf, res)); c.on('error', rej) })

const tempos = {}
try {
  for (const pontos of [576, 512, 384]) {
    console.log(`── ${pontos} pontos ──`)
    const pngs = []
    for (const [nome, { doc, comLogo }] of Object.entries(docs)) {
      const arq = `${SAIDA}/${nome}-${pontos}.png`
      const r = await renderizarTicket(doc, { larguraMm: pontos === 384 ? 58 : 80, larguraPontos: pontos, logo: comLogo ? logo : null, imprimirLogo: comLogo, saida: arq })
      ok(`${nome}: ${r.largura}×${r.altura}, 1 bit, bordas limpas`, r.largura === pontos && (await conferir(arq)))
      pngs.push({ arq, nome })
    }
    // Mosaico (8 por linha) para olhar tudo de uma vez.
    const metas = await Promise.all(pngs.map(async (p) => ({ ...p, m: await sharp(p.arq).metadata() })))
    const porLinha = 8, gap = 20
    const linhas = []
    for (let i = 0; i < metas.length; i += porLinha) linhas.push(metas.slice(i, i + porLinha))
    const altLinha = linhas.map((l) => Math.max(...l.map((x) => x.m.height)) + 36)
    const W = porLinha * (pontos + gap)
    const comp = []
    let y = 0
    for (const [k, l] of linhas.entries()) {
      l.forEach((x, i) => {
        comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pontos}" height="30"><text x="${pontos / 2}" y="22" font-family="Arial" font-size="18" font-weight="700" text-anchor="middle">${x.nome}</text></svg>`), left: i * (pontos + gap), top: y })
        comp.push({ input: x.arq, left: i * (pontos + gap), top: y + 32 })
      })
      y += altLinha[k]
    }
    await sharp({ create: { width: W, height: y, channels: 3, background: '#cccccc' } }).composite(comp).png().toFile(`${SAIDA}/mosaico-${pontos}.png`)
  }

  console.log('── Tempo (desenho + 1 bit + ESC/POS + envio pela rede virtual), 576 pontos ──')
  for (const nome of ['comanda-entrega', 'comanda-muitos-itens', 'pre-conta-mesa']) {
    const medidas = []
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      const img = await bitsDoTicket(docs[nome].doc, { larguraMm: 80, larguraPontos: 576, logo })
      const t1 = performance.now()
      const bytes = imagemEscpos(img)
      const t2 = performance.now()
      await enviar(bytes)
      const t3 = performance.now()
      medidas.push({ desenhoMs: t1 - t0, escposMs: t2 - t1, envioMs: t3 - t2, bytes: bytes.length })
    }
    const med = (k) => Math.round(medidas.map((m) => m[k]).sort((a, b) => a - b)[2])
    tempos[nome] = { desenhoMs: med('desenhoMs'), escposMs: med('escposMs'), envioMs: med('envioMs'), bytes: medidas[0].bytes }
    ok(`${nome}: desenho ${tempos[nome].desenhoMs} ms, ESC/POS ${tempos[nome].escposMs} ms, envio ${tempos[nome].envioMs} ms (${Math.round(tempos[nome].bytes / 1024)} KB)`, tempos[nome].desenhoMs + tempos[nome].escposMs + tempos[nome].envioMs < 3000)
  }

  // Espera a impressora virtual terminar de receber as imagens antes de contar o texto.
  const esperado = Object.keys(tempos).length * 5
  for (let i = 0; i < 100 && recebidos.length < esperado; i++) await new Promise((r) => setTimeout(r, 20))
  console.log('── Modo Texto (ESC @, FS ., ESC t 16) pela impressora virtual ──')
  for (const nome of ['comanda-entrega', 'comanda-desconto-obs', 'pre-conta-mesa', 'via-cozinha-entrega']) {
    for (const pontos of [576, 384]) {
      const antes = recebidos.length
      await enviar(textoEscpos(docs[nome].doc, { larguraPontos: pontos }))
      for (let i = 0; i < 100 && recebidos.length <= antes; i++) await new Promise((r) => setTimeout(r, 20))
      const b = recebidos[antes]
      writeFileSync(`${SAIDA}/texto-${nome}-${pontos}.bin`, b)
      // Legível: tira os comandos e decodifica como WPC1252 (= Latin-1 nos acentos).
      const legivel = b.toString('latin1').replace(/\x1d\x76\x30[\s\S]{5}/g, '[QR]').replace(/[\x1b\x1d][\x21\x42\x45\x61\x64\x56\x40]./g, '').replace(/\x1c\x2e|\x1b\x74./g, '').replace(/[\x00-\x09\x0b-\x1f]/g, '')
      writeFileSync(`${SAIDA}/texto-${nome}-${pontos}.txt`, legivel, 'latin1')
      ok(`${nome} ${pontos}: começa com ESC @ FS . ESC t 16`, b.subarray(0, 7).equals(Buffer.from([0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 0x10])))
    }
  }
  const acentos = textoEscpos({ modelo: 'largura', linhas: [{ rotulo: 'Modo', valor: 'Texto' }], instrucoes: [] }, { larguraPontos: 576 })
  ok('teste de largura em texto traz "ÇÃÉÕ" em WPC1252', acentos.includes(Buffer.from([0xc7, 0xc3, 0xc9, 0xd5])))
  writeFileSync(`${SAIDA}/tempos.json`, JSON.stringify(tempos, null, 2))
} finally {
  servidor.close()
  await fecharRender()
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)
