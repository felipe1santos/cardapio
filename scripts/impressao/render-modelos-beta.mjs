/**
 * Renderiza os MODELOS do Assistente Beta em PNG (nunca imprime): comanda da cozinha
 * (entrega, mesa, balcão, 58 mm) e pré-conta (mesa, balcão com taxa manual, 58 mm), com
 * os dados dos modelos oficiais de 2026-09-28. Para comparar lado a lado com
 * mockup-comanda-cozinha-termica-menuzia.png e pre-conta-menuzia-v4.png.
 *
 *   node scripts/impressao/render-modelos-beta.mjs <pasta-de-saida>
 */
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { renderizarCozinhaBeta, renderizarBeta } from './render-beta.mjs'

const require = createRequire(import.meta.url)
const QRCode = require('qrcode')
const SAIDA = process.argv[2] ?? join(process.cwd(), '.shots', 'modelos-beta')

function qr(url, instagram) {
  const q = QRCode.create(url, { errorCorrectionLevel: instagram ? 'H' : 'M' })
  const n = q.modules.size
  const linhas = []
  for (let y = 0; y < n; y++) { let s = ''; for (let x = 0; x < n; x++) s += q.modules.get(y, x) ? '1' : '0'; linhas.push(s) }
  return { origem: instagram ? 'instagram' : 'cardapio', url, tamanho: n, linhas }
}

const agora = new Date('2026-09-28T01:18:00Z')
const recebido = new Date(agora.getTime() - 17 * 60_000).toISOString()
export const PEDIDO_ENTREGA = {
  id: 'modelo', numero: 129, tipo: 'entrega', canal: 'delivery', origem: 'cardapio', formaPagamento: 'pix', trocoPara: null,
  clienteNome: 'teste claude', clienteTelefone: '552799920804', enderecoRua: 'Avenida Henrique Moscoso', enderecoNumero: '1',
  enderecoComplemento: '', enderecoBairro: 'JABURUNA', enderecoCep: '', observacao: '', pago: false, mesa: null, senha: null,
  subtotal: 44.4, taxaEntrega: 3, total: 45.4, criadoEm: recebido,
  itens: [
    { nome: 'Bolo Duplo', quantidade: 1, precoUnitario: 19.9, observacao: 'cortar ao meio e enviar colher', tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '',
      complementos: [{ nome: 'Calda de chocolate', preco: 2 }, { nome: 'Morango extra', preco: 3 }] },
    { nome: 'Coca-Cola Lata 350ml', quantidade: 1, precoUnitario: 5, observacao: '', tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos: [] },
    { nome: 'Coxinha', quantidade: 2, precoUnitario: 9.75, observacao: '', tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '',
      complementos: [{ nome: 'Catupiry', preco: 2 }, { nome: 'Molho especial', preco: 0.75 }] },
  ],
}
const EXTRAS = { desconto: 2, aceitoEm: null, prontoEm: agora.toISOString(), comandaNumero: null, atendente: null }
const CONFIG = { mostrarNomeComplementos: true, mostrarPrecoComplementos: true }
const IG = qr('https://instagram.com/menuzia', true)

export const PEDIDO_MESA = {
  ...PEDIDO_ENTREGA, numero: 130, tipo: 'retirada', canal: 'mesa', origem: 'pdv', mesa: '07', formaPagamento: 'dinheiro', taxaEntrega: 0,
  clienteNome: '', clienteTelefone: '', subtotal: 44.4, total: 44.4,
}
export const PEDIDO_BALCAO = { ...PEDIDO_ENTREGA, numero: 131, tipo: 'retirada', canal: 'balcao', origem: 'pdv', senha: 12, taxaEntrega: 0, total: 44.4, subtotal: 44.4 }

export const CONTA_MESA = {
  versao: 1, loja: 'Menuzia', tipo: 'mesa', mesa: '34', comanda_numero: 175, pedido_numero: 221, atendente: 'Pedro Henrique',
  aberta_em: '2026-09-28T00:40:00Z', impresso_em: '2026-09-28T15:30:00Z', operador: 'Caixa', via: 1,
  itens: [
    { quantidade: 1, nome: 'X-Picanha', preco_unitario: 25, subtotal: 25, complementos: [] },
    { quantidade: 1, nome: 'Coca-Cola Lata 350ml', preco_unitario: 3.5, subtotal: 3.5, complementos: [] },
    { quantidade: 3, nome: 'Coxinha', preco_unitario: 8, subtotal: 24, complementos: [] },
    { quantidade: 1, nome: 'Agua Mineral Copo 200ml', preco_unitario: 4, subtotal: 4, complementos: [] },
    { quantidade: 1, nome: 'Cheesecake de Uva', preco_unitario: 9.9, subtotal: 9.9, complementos: [] },
  ],
  cancelados: [], subtotal: 66.4, taxa_percentual: 10, taxa: 6.64, taxa_extra: 0, taxa_extra_nome: null, taxa_entrega: 0,
  desconto: 0, total: 73.04, pago: 0, restante: 73.04, pagamentos: [],
}
export const CONTA_BALCAO_TAXA = {
  ...CONTA_MESA, tipo: 'balcao', mesa: null, senha: 12, cliente_nome: 'Ana Paula', comanda_numero: 176, pedido_numero: 222,
  taxa_percentual: 0, taxa: 0, taxa_extra: 15, taxa_extra_nome: 'Couvert', desconto: 5, total: 76.4, pago: 20, restante: 56.4,
  itens: [...CONTA_MESA.itens.slice(0, 3), { quantidade: 2, nome: 'Pizza Grande', preco_unitario: 0, subtotal: 0, tamanho: 'Grande', sabor: 'Calabresa / Frango', complementos: [{ nome: 'Borda catupiry', preco: 0 }], observacao: 'sem cebola' }],
}

const r = []
const cz = (nome, pedido, extras = EXTRAS, q = IG, paperMm = 80) =>
  r.push([nome, renderizarCozinhaBeta(pedido, { config: CONFIG, lojaNome: 'Menuzia', extras, qr: q }, { paperMm, saida: join(SAIDA, `${nome}.png`) })])
cz('cozinha-entrega-80', PEDIDO_ENTREGA)
cz('cozinha-mesa-80', PEDIDO_MESA, { ...EXTRAS, desconto: 0, comandaNumero: 175, atendente: 'Pedro' }, qr('https://app.menuzia.com.br/loja/menuzia', false))
cz('cozinha-balcao-80', PEDIDO_BALCAO, { ...EXTRAS, desconto: 0, atendente: 'Caixa 1' })
cz('cozinha-entrega-58', PEDIDO_ENTREGA, EXTRAS, IG, 58)
const LONGO = { ...PEDIDO_ENTREGA, numero: 132, observacao: 'interfone quebrado, ligar ao chegar', itens: [{ nome: 'Combo Família Gigante Especial da Casa com Pizza Meio a Meio e Refrigerante 2 Litros', quantidade: 1, precoUnitario: 109.9, observacao: 'metade sem cebola, a outra metade com borda recheada de catupiry e bem assada', tamanhoNome: 'Gigante', saborNome: 'Portuguesa / Quatro Queijos', bordaNome: 'Catupiry', massaNome: 'Fina', complementos: [{ nome: 'Bacon crocante extra servido à parte', preco: 9 }, { nome: 'Bacon crocante extra servido à parte', preco: 9 }] }], subtotal: 109.9, total: 112.9 }
cz('cozinha-nome-grande-80', LONGO)
cz('cozinha-nome-grande-58', LONGO, EXTRAS, IG, 58)
r.push(['preconta-mesa-80', renderizarBeta(CONTA_MESA, { saida: join(SAIDA, 'preconta-mesa-80.png') })])
r.push(['preconta-balcao-taxa-80', renderizarBeta(CONTA_BALCAO_TAXA, { saida: join(SAIDA, 'preconta-balcao-taxa-80.png') })])
r.push(['preconta-balcao-taxa-58', renderizarBeta(CONTA_BALCAO_TAXA, { paperMm: 58, saida: join(SAIDA, 'preconta-balcao-taxa-58.png') })])
r.push(['preconta-mesa-58', renderizarBeta(CONTA_MESA, { paperMm: 58, saida: join(SAIDA, 'preconta-mesa-58.png') })])
for (const [n, x] of r) console.log(n, x.total?.valor, x.total ? `${x.total.de}..${x.total.ate}/${x.total.papel}` : '', x.sobreposicao ? 'SOBREPOSICAO' : '', x.logo)
