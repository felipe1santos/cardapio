// Amostras do Alfa 1 com o MESMO desenho do Assistente: `npx electron ferramentas/amostras-alfa1.js <pasta>`.
// Grava os PNGs em 1 bit (os pontos que vão para a impressora) em 576, 574 e 384 pontos e a simulação do modo
// texto (48 e 32 colunas). Dados: os da referência (docs/impressao/alfa1/referencia) + um caso longo.
const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const { montarComandaAlfa1, montarPreContaAlfa1, textoPlanoAlfa1 } = require('../src/alfa1')
const { desenharAlfa1, pngDosBits } = require('../src/alfa1-render')

const saida = path.resolve(process.argv[2] || 'amostras-alfa1')
// QR real de 25 módulos qualquer (só para as amostras): um padrão fixo com os três olhos.
function qrFalso(n = 29) {
  const m = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => ((x * 7 + y * 13 + x * y) % 5 < 2 ? '1' : '0')))
  const olho = (a, b) => { for (let y = -1; y < 8; y++) for (let x = -1; x < 8; x++) { const yy = b + y, xx = a + x; if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue; const borda = x === 0 || y === 0 || x === 6 || y === 6, miolo = x >= 2 && x <= 4 && y >= 2 && y <= 4; m[yy][xx] = x < 0 || y < 0 || x > 6 || y > 6 ? '0' : borda || miolo ? '1' : '0' } }
  olho(0, 0); olho(n - 7, 0); olho(0, n - 7)
  return m.map((r) => r.join(''))
}
const QR = qrFalso()
const AGORA = '2026-10-10T00:40:00Z'
const loja = { nome: 'Villa Burguer' }
const itens = [
  { nome: 'X-Tudo', quantidade: 1, precoUnitario: 30, complementos: [{ nome: 'Hambúrguer caseiro', preco: 5 }], observacao: 'Carne artesanal, por favor' },
  { nome: 'X-Egg Bacon', quantidade: 2, precoUnitario: 26, complementos: [{ nome: 'Bacon extra', preco: 4 }], observacao: '' },
  { nome: 'Batata Frita (G)', quantidade: 1, precoUnitario: 18, complementos: [], observacao: 'Sem sal' },
  { nome: 'Coca-Cola Lata 350 ml', quantidade: 1, precoUnitario: 6, complementos: [], observacao: '' },
]
const base = { numero: 10, criadoEm: AGORA, clienteNome: 'Maria Souza', clienteTelefone: '5527992390000', itens, subtotal: 106, formaPagamento: 'dinheiro', trocoPara: 150, pago: false, observacao: '' }
const casos = {
  'comanda-entrega': montarComandaAlfa1({ ...base, tipo: 'entrega', canal: 'delivery', taxaEntrega: 3.99, total: 109.99, agendadoPara: '2026-10-10T01:25:00Z', enderecoRua: 'Rua Jaburuna', enderecoNumero: '55', enderecoComplemento: 'Apto 202', enderecoBairro: 'Centro', enderecoReferencia: 'Ao lado da farmácia', enderecoCidade: 'Vila Velha/ES' }, { loja, extras: { qtdPedidosCliente: 3 }, qr: { linhas: QR, url: 'https://app.menuzia.com.br/r/AAAA' } }),
  'comanda-retirada': montarComandaAlfa1({ ...base, tipo: 'retirada', canal: 'delivery', taxaEntrega: 0, total: 106 }, { loja, extras: { qtdPedidosCliente: 3 } }),
  'comanda-balcao': montarComandaAlfa1({ ...base, tipo: 'retirada', canal: 'balcao', taxaEntrega: 0, total: 106, senha: 47 }, { loja, extras: { qtdPedidosCliente: 3, atendente: 'Carlos' } }),
  'comanda-entrega-longa': montarComandaAlfa1({
    ...base, numero: 1234, tipo: 'entrega', canal: 'delivery', taxaEntrega: 7.5, total: 157.4, trocoPara: 200, formaPagamento: 'dinheiro',
    itens: [
      { nome: 'Pizza Gigante Meio a Meio Calabresa Acebolada com Catupiry / Frango com Cheddar Cremoso', quantidade: 1, precoUnitario: 95.9, bordaNome: 'Catupiry', complementos: [{ nome: 'Bacon crocante extra na metade de calabresa', preco: 6 }], observacao: 'Cortar em 12 pedaços, sem cebola na parte de frango, mandar sachês de orégano e ketchup à parte, por favor caprichar' },
      { nome: 'Guaraná Antarctica 2 L', quantidade: 2, precoUnitario: 12, complementos: [], observacao: '' },
      { nome: 'Açaí 500 ml', quantidade: 1, precoUnitario: 30, complementos: [{ nome: 'Leite ninho', preco: 3 }, { nome: 'Morango', preco: 3 }, { nome: 'Paçoca', preco: 2 }], observacao: '' },
    ],
    subtotal: 149.9, observacao: 'Interfone quebrado: ligar quando chegar.',
    enderecoRua: 'Avenida Nossa Senhora da Penha, Condomínio Residencial Jardim das Orquídeas Torre Norte', enderecoNumero: '1500', enderecoComplemento: 'Bloco C, apartamento 1203, entrada pela portaria lateral', enderecoBairro: 'Santa Lúcia', enderecoReferencia: 'Em frente ao posto Shell, portão verde', enderecoCidade: 'Vitória/ES',
  }, { loja: { nome: 'Pizzaria e Hamburgueria Sabor da Ilha Gourmet' }, extras: { qtdPedidosCliente: 27 }, qr: { linhas: QR, url: 'https://app.menuzia.com.br/r/BBBB' } }),
  'pre-conta': montarPreContaAlfa1({
    loja_dados: { nome: 'Villa Burguer', cnpj: '12.345.678/0001-90' }, tipo: 'mesa', mesa: '04', comanda_numero: 123, impresso_em: AGORA,
    itens: itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, preco_unitario: i.precoUnitario, complementos: i.complementos })),
    subtotal: 106, taxa: 10.6, taxa_percentual: 10, desconto: 5, total: 111.6, pago: 50, restante: 61.6, pessoas: 3, atendente: 'Carlos',
    qr: { linhas: QR, origem: 'instagram', url: 'https://instagram.com/villaburguer' },
  }),
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  fs.mkdirSync(saida, { recursive: true })
  try {
    for (const [nome, doc] of Object.entries(casos)) {
      for (const larg of [576, 574, 384]) {
        const t0 = Date.now()
        const r = await desenharAlfa1(doc, { larguraPontos: larg })
        fs.writeFileSync(path.join(saida, `${nome}-${larg}.png`), pngDosBits(r))
        console.log(`${nome} ${larg}: ${r.largura}x${r.altura} pontos (${Date.now() - t0} ms)`)
      }
      for (const col of [48, 32]) fs.writeFileSync(path.join(saida, `${nome}-texto-${col}.txt`), textoPlanoAlfa1(doc, col), 'utf8')
    }
  } catch (e) { console.error('ERRO', e && e.stack || e); process.exitCode = 1 }
  app.quit()
})
