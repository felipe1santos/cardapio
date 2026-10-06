/**
 * Dados de DEMONSTRAÇÃO das prévias de impressão — os mesmos dos modelos oficiais v3
 * (docs/impressao-final/referencias/comanda_v3.png e preconta_v3.png): pedido #135 (Acai,
 * X-Egg Bacon, Coca, Batata; Pix; cliente kkk, jaburuna 55 - DASDAS) e a conta da mesa 04
 * (comanda 26, Carlos, Maria, serviço 10%, couvert, desconto, já pago).
 *
 * JavaScript puro (.mjs): usado pela prévia do painel (Next), pelos scripts de teste em Node e
 * pelas amostras em Downloads — o que aparece na tela é o que sai nos arquivos de conferência.
 * Só os dados do pedido; nome, endereço, telefone e logo vêm da loja.
 */

const item = (nome, precoUnitario, quantidade = 1, complementos = [], observacao = '') =>
  ({ nome, quantidade, precoUnitario, observacao, tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos })

/** 01/10/2026 20:43 (São Paulo) — a data do modelo. */
export const CRIADO_EM_MODELO = '2026-10-01T23:43:00Z'
export const IMPRESSO_EM_MODELO = '2026-10-02T00:47:00Z'

const BASE = {
  id: 'previa', numero: 135, tipo: 'entrega', canal: 'delivery', origem: 'cardapio', status: 'recebido',
  formaPagamento: 'pix', pago: false, pagamentoOnline: false, trocoPara: null,
  clienteNome: 'kkk', clienteTelefone: '5527992399932',
  enderecoRua: 'jaburuna', enderecoNumero: '55', enderecoComplemento: '', enderecoBairro: 'DASDAS', enderecoCep: '', enderecoCidade: '', enderecoReferencia: '',
  observacao: '', mesa: null, senha: null,
  subtotal: 94.63, taxaEntrega: 2.4, total: 97.03, criadoEm: CRIADO_EM_MODELO,
  itens: [item('Acai Grande 500 mL (300)', 19), item('X-Egg Bacon', 26, 2, [{ nome: 'Bacon', preco: 4 }]), item('Coca Lata 350ml', 5.63), item('Batata Frita (G)', 18)],
}

/**
 * Pedido de demonstração por tipo. Entrega = exatamente o comanda_v3.png; os outros tipos usam
 * os mesmos itens, sem taxa de entrega (mesa: comanda 26 e atendente Carlos; balcão: senha 12).
 * @param {'entrega'|'retirada'|'mesa'|'balcao'} tipo
 */
export function pedidoDemonstracao(tipo = 'entrega') {
  if (tipo === 'entrega') return { pedido: { ...BASE }, extras: { desconto: 0, comandaNumero: null, atendente: null } }
  const semEntrega = { ...BASE, taxaEntrega: 0, total: 94.63 }
  if (tipo === 'retirada') return { pedido: { ...semEntrega, tipo: 'retirada' }, extras: { desconto: 0 } }
  if (tipo === 'mesa') return { pedido: { ...semEntrega, tipo: 'retirada', canal: 'mesa', origem: 'pdv', mesa: '04', formaPagamento: null, clienteNome: 'Maria', clienteTelefone: '' }, extras: { desconto: 0, comandaNumero: 26, atendente: 'Carlos' } }
  return { pedido: { ...semEntrega, tipo: 'retirada', canal: 'balcao', origem: 'pdv', senha: 12, formaPagamento: 'credito', pago: true }, extras: { desconto: 0, atendente: 'Carlos' } }
}

/**
 * O mesmo pedido no formato que o Assistente ANTIGO recebe (recibo.js): forma de pagamento sempre
 * em texto e, no balcão, sem a senha (o 0.1.23 das lojas não imprime a linha "SENHA").
 */
export function pedidoAntigoDemonstracao(tipo = 'entrega') {
  const { pedido } = pedidoDemonstracao(tipo)
  return { ...pedido, formaPagamento: pedido.formaPagamento ?? 'dinheiro', senha: null }
}

const ci = (quantidade, nome, preco_unitario, complementos = []) => ({ quantidade, nome, preco_unitario, subtotal: Math.round(quantidade * preco_unitario * 100) / 100, complementos })

/**
 * Conta de demonstração da pré-conta. Mesa = exatamente o preconta_v3.png; balcão = os mesmos
 * itens e valores, com a senha 7 no lugar da mesa.
 * @param {'mesa'|'balcao'} tipo
 */
export function contaDemonstracao(loja = '', tipo = 'mesa') {
  const conta = {
    versao: 1, loja, tipo: 'mesa', mesa: '04', comanda_numero: 26, atendente: 'Carlos', cliente_nome: 'Maria',
    impresso_em: IMPRESSO_EM_MODELO, via: 1,
    itens: [ci(2, 'X-Egg Bacon', 26, [{ nome: 'Bacon', preco: 4 }]), ci(1, 'Acai Grande 500 mL (300)', 19), ci(2, 'Coca Lata 350ml', 5.63)],
    subtotal: 82.26, taxa: 8.23, taxa_percentual: 10, taxas: [{ nome: 'Couvert', detalhe: '1 x R$ 15,00', valor: 15 }],
    desconto: 5, taxa_entrega: 0, total: 100.49, pago: 50, restante: 50.49, pagamentos: [{ forma: 'pix', valor: 50 }], cancelados: [],
  }
  return tipo === 'balcao' ? { ...conta, tipo: 'balcao', mesa: null, senha: 7 } : conta
}
