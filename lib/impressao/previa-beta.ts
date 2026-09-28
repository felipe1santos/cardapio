/**
 * Dados de DEMONSTRAÇÃO da pré-visualização do Assistente Beta (página Impressão).
 * São os dados dos modelos oficiais (docs/referencias/impressao/v2): a comanda do pedido
 * #129 (entrega) e a pré-conta da Mesa 08. A pré-visualização monta o documento com os
 * MESMOS montadores do Beta (cozinha-beta.js / pre-conta-beta.js) e desenha com o MESMO
 * ticket-canvas.js — o que aparece na tela é o que sai no papel.
 */

export function pedidoDemonstracao(agora = new Date()) {
  const recebido = new Date(agora.getTime() - 17 * 60_000)
  const item = (nome: string, quantidade: number, precoUnitario: number, observacao: string, complementos: { nome: string; preco: number }[]) => ({
    nome, quantidade, precoUnitario, observacao, tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos,
  })
  return {
    pedido: {
      id: 'previa', numero: 129, tipo: 'entrega', canal: 'delivery', origem: 'cardapio', formaPagamento: 'pix', trocoPara: null,
      clienteNome: 'teste claude', clienteTelefone: '552799920804', enderecoRua: 'Avenida Henrique Moscoso', enderecoNumero: '1',
      enderecoComplemento: '', enderecoBairro: 'JABURUNA', enderecoCep: '', observacao: '', pago: false, mesa: null, senha: null,
      subtotal: 44.4, taxaEntrega: 3, total: 45.4, criadoEm: recebido.toISOString(),
      itens: [
        item('Bolo Duplo', 1, 19.9, 'cortar ao meio e enviar', [{ nome: 'Calda de chocolate', preco: 2 }, { nome: 'Morango extra', preco: 3 }]),
        item('Coca-Cola Lata 350ml', 1, 5, '', []),
        item('Coxinha', 2, 9.75, '', [{ nome: 'Catupiry', preco: 2 }, { nome: 'Molho especial', preco: 0.75 }]),
      ],
    },
    extras: { desconto: 2, aceitoEm: null, prontoEm: agora.toISOString(), comandaNumero: null, atendente: null },
  }
}

export function contaDemonstracao(loja: string, agora = new Date()) {
  const item = (quantidade: number, nome: string, preco: number) => ({ quantidade, nome, preco_unitario: preco, subtotal: Math.round(quantidade * preco * 100) / 100, complementos: [] })
  return {
    loja, tipo: 'mesa', mesa: '08', comanda_numero: 55, pedido_numero: 102, impresso_em: agora.toISOString(), via: 1,
    itens: [item(1, 'X-Burger Artesanal', 28.9), item(2, 'Coca-Cola Lata', 7), item(1, 'Batata Frita', 18.5), item(1, 'Pudim da Casa', 12)],
    subtotal: 73.4, taxa_percentual: 10, taxa: 7.34, taxa_extra: 0, desconto: 0, total: 80.74, pago: 0, restante: 80.74,
  }
}
