// Pedidos de demonstração para o baseline do recibo da cozinha. Nenhum dado real.
const base = {
  numero: 101, tipo: 'retirada', formaPagamento: 'dinheiro', trocoPara: null, clienteNome: 'Cliente Demonstração',
  clienteTelefone: '', enderecoRua: '', enderecoNumero: '', enderecoComplemento: '', enderecoBairro: '', enderecoCep: '',
  observacao: '', pago: false, origem: 'cardapio', mesa: null, subtotal: 0, taxaEntrega: 0, total: 0,
  criadoEm: '2026-09-23T15:30:00.000Z', itens: [],
}
const item = (o) => ({ quantidade: 1, nome: 'Item', precoUnitario: 10, observacao: '', tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos: [], ...o })

const FIXTURES = {
  delivery_completo: {
    ...base, numero: 201, tipo: 'entrega', formaPagamento: 'dinheiro', trocoPara: 100, clienteNome: 'João da Silva Demonstração',
    clienteTelefone: '(27) 90000-0000', enderecoRua: 'Rua das Acácias', enderecoNumero: '123', enderecoComplemento: 'Apto 402',
    enderecoBairro: 'Praia do Canto', enderecoCep: '29000-000', observacao: 'Tocar o interfone', subtotal: 81, taxaEntrega: 7, total: 88,
    canal: 'delivery', senha: null,
    itens: [
      item({ quantidade: 2, nome: 'X-Burguer Artesanal com Queijo Coalho Grelhado', precoUnitario: 32, complementos: [{ nome: 'Bacon', preco: 4 }, { nome: 'Bacon', preco: 4 }, { nome: 'Cebola caramelizada', preco: 3 }], observacao: 'Sem tomate, pão bem tostado' }),
      item({ nome: 'Pizza', precoUnitario: 17, tamanhoNome: 'Média', saborNome: 'Calabresa / Frango com Catupiry', bordaNome: 'Cheddar', massaNome: 'Fina' }),
    ],
  },
  mesa: { ...base, numero: 202, origem: 'pdv', mesa: 'Mesa 01', clienteNome: 'Mesa 01', canal: 'mesa', senha: null, subtotal: 75, total: 75,
    itens: [item({ nome: 'Filé à Parmegiana', precoUnitario: 68 }), item({ nome: 'Água com Gás', precoUnitario: 7, observacao: 'Com gelo e limão' })] },
  balcao_antigo: { ...base, numero: 203, origem: 'pdv', mesa: null, clienteNome: 'Cliente Balcão', subtotal: 12, total: 12, itens: [item({ nome: 'Suco de Laranja', precoUnitario: 12 })] },
  balcao_v2: { ...base, numero: 204, origem: 'pdv', mesa: null, clienteNome: 'Ana Conceição', canal: 'balcao', senha: 12, subtotal: 42, total: 42,
    itens: [item({ nome: 'Açaí', precoUnitario: 42, tamanhoNome: '500 ml', complementos: [{ nome: 'Granola', preco: 2 }, { nome: 'Leite condensado', preco: 3 }] })] },
  acentos: { ...base, numero: 205, clienteNome: 'Conceição Araújo Ümläut', canal: 'delivery', senha: null, subtotal: 30, total: 30, observacao: 'Pão, maçã, coração, ação, ÇÃÉÕÍÚ',
    itens: [item({ nome: 'Pão de Queijo Mineiro — Porção', precoUnitario: 30, observacao: 'Não esquecer o açúcar' })] },
}

const CONFIGS = {
  padrao: { mostrarNumeroItem: true, mostrarPrecoComplementos: true, mostrarNomeComplementos: true, multiplicarOpcoesQtd: false, imprimirLogo: false, fonteMaiorProducao: false },
  enxuta: { mostrarNumeroItem: false, mostrarPrecoComplementos: false, mostrarNomeComplementos: true, multiplicarOpcoesQtd: true, imprimirLogo: true, fonteMaiorProducao: true },
}

module.exports = { FIXTURES, CONFIGS }
