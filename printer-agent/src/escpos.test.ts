import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { imagemEscpos, textoEscpos, codificar, duasColunas, AVANCO_ANTES_DO_CORTE } = require('./escpos.js') as {
  imagemEscpos: (img: { bits: Uint8Array; largura: number; altura: number; porLinha?: number }, o?: Record<string, unknown>) => Buffer
  textoEscpos: (doc: unknown, o?: Record<string, unknown>) => Buffer
  codificar: (s: string) => number[]
  duasColunas: (a: string, b: string, n: number) => string[]
  AVANCO_ANTES_DO_CORTE: number
}

/** Lê os comandos GS v 0 de volta: faixas e a imagem remontada. */
function lerRaster(buf: Buffer) {
  const faixas: { porLinha: number; linhas: number; dados: Buffer }[] = []
  for (let i = 0; i < buf.length - 7; i++) {
    if (buf[i] === 0x1d && buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {
      const porLinha = buf[i + 4]! + buf[i + 5]! * 256
      const linhas = buf[i + 6]! + buf[i + 7]! * 256
      const dados = buf.subarray(i + 8, i + 8 + porLinha * linhas)
      faixas.push({ porLinha, linhas, dados })
      i += 7 + porLinha * linhas
    }
  }
  return faixas
}

function imagem(largura: number, altura: number, preto: (x: number, y: number) => boolean) {
  const porLinha = Math.ceil(largura / 8)
  const bits = new Uint8Array(porLinha * altura)
  for (let y = 0; y < altura; y++) for (let x = 0; x < largura; x++) if (preto(x, y)) bits[y * porLinha + (x >> 3)]! |= 0x80 >> (x & 7)
  return { bits, largura, altura, porLinha }
}

describe('ESC/POS em imagem (envio direto)', () => {
  const img = imagem(576, 1000, (x, y) => x === 0 || x === 575 || y % 50 === 0)

  it('largura EXATA em pontos (576 = 72 bytes por linha), sem redimensionar, em faixas de até 192 linhas', () => {
    const buf = imagemEscpos(img)
    expect([...buf.subarray(0, 2)]).toEqual([0x1b, 0x40])
    const f = lerRaster(buf)
    expect(f.every((x) => x.porLinha === 72)).toBe(true)
    expect(f.map((x) => x.linhas)).toEqual([192, 192, 192, 192, 192, 40])
    expect(Buffer.concat(f.map((x) => x.dados)).equals(Buffer.from(img.bits))).toBe(true)
  })

  it('avança linhas antes do corte e corta (guilhotina acima da cabeça)', () => {
    const buf = imagemEscpos(img)
    expect([...buf.subarray(buf.length - 6)]).toEqual([0x1b, 0x64, AVANCO_ANTES_DO_CORTE, 0x1d, 0x56, 0x01])
    expect(AVANCO_ANTES_DO_CORTE).toBeGreaterThanOrEqual(4)
    expect(AVANCO_ANTES_DO_CORTE).toBeLessThanOrEqual(6)
    expect([...imagemEscpos(img, { cortar: false }).subarray(-3)]).toEqual([0x1b, 0x64, AVANCO_ANTES_DO_CORTE])
  })

  it('intensidade: normal não manda nada (= hoje); escura e mais escura mandam a densidade', () => {
    const densidade = (b: Buffer) => b.indexOf(Buffer.from([0x1d, 0x28, 0x4b, 0x02, 0x00, 0x31]))
    expect(densidade(imagemEscpos(img))).toBe(-1)
    const e = imagemEscpos(img, { intensidade: 'escura' })
    const me = imagemEscpos(img, { intensidade: 'mais_escura' })
    expect(e[densidade(e) + 6]).toBe(3)
    expect(me[densidade(me) + 6]).toBe(6)
  })

  it('58 mm: 384 pontos = 48 bytes por linha', () => {
    const f = lerRaster(imagemEscpos(imagem(384, 10, () => true)))
    expect(f[0]).toMatchObject({ porLinha: 48, linhas: 10 })
  })

  it('deslocamento empurra a imagem sem mudar a largura', () => {
    const umPonto = imagem(576, 1, (x) => x === 0)
    const f = lerRaster(imagemEscpos(umPonto, { deslocamento: 9 }))
    expect(f[0]!.porLinha).toBe(72)
    expect(f[0]!.dados[1]).toBe(0x40) // ponto 9 = byte 1, bit 6
  })
})

describe('ESC/POS em texto (modo compatibilidade)', () => {
  it('página de código WPC1252 (ESC t 16) com os acentos do português (ÇÃÉÕ)', () => {
    expect(codificar('ÇÃÉÕ')).toEqual([0xc7, 0xc3, 0xc9, 0xd5])
    expect(codificar('çãéõ áíóú âêô à ü')).toEqual([...Buffer.from('çãéõ áíóú âêô à ü', 'latin1')])
    expect(codificar('R$ 1,00 • ok – já')).toEqual([...Buffer.from('R$ 1,00 ', 'latin1'), 0x95, ...Buffer.from(' ok ', 'latin1'), 0x96, ...Buffer.from(' já', 'latin1')])
    expect(codificar('a\u00A0b 漢')).toEqual([0x61, 0x20, 0x62, 0x20, 0x3f])
  })

  it('começa com ESC @, FS . e ESC t 16', () => {
    const b = textoEscpos({ modelo: 'cozinha', blocos: [] }, { larguraPontos: 576 })
    expect([...b.subarray(0, 7)]).toEqual([0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 0x10])
  })

  it('modelo v3 em texto: faixas, itens com valor, observação, endereço sem hífen no começo, QR', () => {
    const { montarComandaV3 } = require('./v3.js')
    const linhasQr = Array.from({ length: 21 }, (_, i) => (i % 2 ? '1'.repeat(21) : '0'.repeat(21)))
    const doc = montarComandaV3({
      numero: 135, tipo: 'entrega', canal: 'delivery', formaPagamento: 'pix', pago: true, pagamentoOnline: true, clienteNome: 'Joana', clienteTelefone: '5527992399932',
      enderecoRua: 'Rua Muito Comprida das Flores do Campo', enderecoNumero: '1234', enderecoComplemento: 'Apto 1203 bloco B', enderecoBairro: 'Praia da Costa', enderecoCidade: 'Vila Velha/ES',
      observacao: 'Tocar o interfone', subtotal: 29, taxaEntrega: 0, total: 29, criadoEm: '2026-10-01T23:43:00Z',
      itens: [{ nome: 'Pão de Queijo', quantidade: 1, precoUnitario: 29, observacao: 'sem sal', complementos: [] }],
    }, { loja: { nome: 'Padaria São João', telefone: '2733334444', endereco: 'Rua A, 1 - Centro, Vitória/ES' }, qr: { origem: 'cardapio', url: 'x', linhas: linhasQr } })
    const b = textoEscpos(doc, { larguraPontos: 384 })
    const t = b.toString('latin1')
    for (const s of ['PEDIDO #135', 'ITENS', 'OBSERVAÇÃO', 'PAGAMENTO', 'CLIENTE', 'Pagamento: PIX ONLINE - PAGO', 'Tel.: (27) 99239-9932', 'OBS: sem sal', 'Obrigado pela preferência!', 'feito por Menuzia.com.br']) expect(t).toContain(s) // WPC1252 = Latin-1 nos acentos
    const linhas = t.split('\n').map((l) => l.replace(/[\x00-\x1f]./g, '').replace(/[\x00-\x1f]/g, ''))
    expect(linhas.some((l) => /^\s*-\s*\S/.test(l) && !/^-+$/.test(l.trim()))).toBe(false)
    expect(b.indexOf(Buffer.from([0x1d, 0x76, 0x30]))).toBeGreaterThan(0)
  })

  it('duas colunas: valor sempre inteiro à direita, nome longo quebra sem invadir', () => {
    const ls = duasColunas('1x X-BURGUER DUPLO COM BACON E CHEDDAR CREMOSO', '38,90', 32)
    expect(ls.every((l) => l.length <= 32)).toBe(true)
    expect(ls.at(-1)!.endsWith('38,90')).toBe(true)
  })

  it('comanda em texto: ESC t 16, negrito, tamanho duplo, faixas invertidas, acentos, corte', () => {
    const doc = {
      modelo: 'cozinha',
      blocos: [
        { t: 'logo', nome: 'PADARIA SÃO JOÃO' }, { t: 'titulo', s: 'COMANDA COZINHA' }, { t: 'pedido', numero: '#133', tipo: 'MESA 01' },
        { t: 'faixa', s: 'ITENS DO PEDIDO' }, { t: 'item', texto: '1x PÃO FRANCÊS', valor: '5,00', subs: [{ s: '+ Manteiga', valor: '1,00' }], obs: 'OBS: BEM ASSADO' },
        { t: 'faixa', s: 'VALORES' }, { t: 'par', rotulo: 'Subtotal', valor: 'R$ 6,00' }, { t: 'tracejado' }, { t: 'total', rotulo: 'TOTAL', valor: 'R$ 6,00' },
        { t: 'faixa', s: 'DADOS DA MESA' }, { t: 'dado', rotulo: 'Mesa:', valor: '01' }, { t: 'separador' },
        { t: 'rodape_loja', loja: { nome: 'PADARIA', telefone: '(27) 3333-4444', linha1: 'Rua A, 1', cidade: 'Vitória/ES' }, chamada: ['PEÇA DE NOVO PELO CARDÁPIO:'], final: 'Feito por Sistema Menuzia' },
      ],
    }
    const b = textoEscpos(doc, { larguraPontos: 576 })
    expect(b.indexOf(Buffer.from([0x1b, 0x74, 0x10]))).toBeGreaterThan(0)
    expect(b.indexOf(Buffer.from([0x1d, 0x21, 0x11]))).toBeGreaterThan(0)
    expect(b.indexOf(Buffer.from([0x1d, 0x42, 0x01]))).toBeGreaterThan(0)
    expect(b.indexOf(Buffer.from(codificar('PÃO FRANCÊS')))).toBeGreaterThan(0)
    expect(b.indexOf(Buffer.from(codificar('Vitória/ES')))).toBeGreaterThan(0)
    expect([...b.subarray(b.length - 6)]).toEqual([0x1b, 0x64, AVANCO_ANTES_DO_CORTE, 0x1d, 0x56, 0x01])
    // Nenhuma linha passa de 48 colunas (80 mm) — tirando os comandos, texto puro.
    const texto = b.toString('latin1').split('\n').map((l) => l.replace(/[\x00-\x1f]./g, '').replace(/[\x00-\x1f]/g, ''))
    expect(Math.max(...texto.map((l) => l.length))).toBeLessThanOrEqual(48 + 4)
  })

  it('teste de largura em texto: régua na largura toda e "ÇÃÉÕ"', () => {
    const b = textoEscpos({ modelo: 'largura', linhas: [{ rotulo: 'Largura:', valor: '384 pontos' }], instrucoes: ['Confira as duas bordas.'] }, { larguraPontos: 384 })
    expect(b.indexOf(Buffer.from('|' + '-'.repeat(30) + '|'))).toBeGreaterThan(0)
    expect(b.indexOf(Buffer.from([0xc7, 0xc3, 0xc9, 0xd5]))).toBeGreaterThan(0)
  })
})
