// Contas de demonstração para o baseline do Recibo/Extrato real (snapshot do servidor).
// Nenhum dado real. Não têm os campos do Recibo/Extrato de TESTE (telefone, endereço…).
const mesa = {
  versao: 1, loja: 'Cantina Demonstração', tipo: 'mesa', mesa: 'Varanda 02', comanda_numero: 57, senha: null, cliente_nome: null,
  aberta_em: '2026-09-23T22:02:00Z', impresso_em: '2026-09-23T22:40:00Z', operador: 'Conceição Atendente', via: 1,
  itens: [
    { quantidade: 2, nome: 'X-Burguer Artesanal com Queijo Coalho Grelhado e Cebola Caramelizada', tamanho: null, sabor: null, borda: null, massa: null,
      complementos: [{ nome: 'Bacon', preco: 4 }, { nome: 'Bacon', preco: 4 }, { nome: 'Ovo', preco: 0 }], preco_unitario: 40, subtotal: 80, observacao: 'Bem passado' },
    { quantidade: 1, nome: 'Pizza', tamanho: 'Média', sabor: 'Calabresa / Frango com Catupiry', borda: 'Cheddar', massa: 'Fina', complementos: [], preco_unitario: 55.9, subtotal: 55.9 },
    { quantidade: 3, nome: 'Água com Gás', tamanho: null, sabor: null, borda: null, massa: null, complementos: [], preco_unitario: 7, subtotal: 21 },
  ],
  cancelados: [{ quantidade: 1, nome: 'Suco de Maçã' }, { quantidade: 2, nome: 'Pão de Queijo' }],
  subtotal: 156.9, taxa_percentual: 10, taxa: 15.69, desconto: 12.5, total: 160.09, pago: 60, restante: 100.09,
  pagamentos: [{ forma: 'dinheiro', valor: 40 }, { forma: 'pix', valor: 20 }],
}
const balcao = { ...mesa, tipo: 'balcao', mesa: null, comanda_numero: 12, senha: 128, cliente_nome: 'João da Conceição', via: 2,
  itens: mesa.itens.slice(1), cancelados: [], subtotal: 76.9, taxa_percentual: 0, taxa: 0, desconto: 0, total: 76.9, pago: 0, restante: 76.9, pagamentos: [] }
const pago = { ...mesa, comanda_numero: 58, pago: 160.09, restante: 0, pagamentos: [{ forma: 'credito', valor: 160.09 }], total: 160.09 }
const milhar = { ...balcao, comanda_numero: 13, senha: 7, itens: [{ quantidade: 4, nome: 'Rodízio Premium Família', complementos: [], preco_unitario: 1022, subtotal: 4088 }],
  subtotal: 4088, total: 4088, restante: 4088 }
module.exports = { CONTAS: { mesa, balcao, pago, milhar } }
