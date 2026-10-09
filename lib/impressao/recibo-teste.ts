/**
 * Recibo/Extrato de TESTE — dados de demonstração, fixos, montados no servidor.
 *
 * Vai para a fila do Assistente Beta como `teste_impressora` com `recibo_teste: true`
 * e é desenhado pelo MESMO renderizador do Recibo/Extrato de verdade, com o perfil daquela
 * impressora. Não cria pedido, comanda, pagamento, fidelidade nem cupom: é só texto. Os
 * dados são os do modelo docs/referencias/impressao/v3/PRE-CONTA.png: adicionais com
 * preço, observação, "2 L" / "500 ML", taxa de entrega, desconto e pagamento parcial.
 */

export const TOTAL_RECIBO_TESTE = 248.7

interface Destino {
  loja: string
  impressora: string
  nomeSistema: string
  computador: string
  larguraMm: number
  larguraPontos: number | null
  deslocamentoPontos: number
}

export function snapshotReciboTeste(d: Destino, operador: string, agora = new Date()): Record<string, unknown> {
  // preco_unitario já com os adicionais (como no banco); o Beta reparte a linha.
  const item = (quantidade: number, nome: string, precoUnitario: number, complementos: { nome: string; preco: number }[] = [], observacao?: string) => ({
    quantidade, nome, preco_unitario: precoUnitario, subtotal: Math.round(quantidade * precoUnitario * 100) / 100, complementos, ...(observacao ? { observacao } : {}),
  })
  const itens = [
    item(1, 'Pizza Grande Calabresa', 79.9, [{ nome: 'Borda recheada de catupiry', preco: 12 }, { nome: 'Bacon extra', preco: 8 }], 'Sem cebola'),
    item(2, 'Pizza Média Marguerita', 44.9),
    item(1, 'Batata Frita', 40, [{ nome: 'Cheddar cremoso', preco: 6 }, { nome: 'Bacon crocante', preco: 6 }]),
    item(1, 'Coca-Cola 2 L', 14),
    item(3, 'Suco de Laranja 500 ML', 9),
  ]
  const subtotal = 250.7
  const desconto = 10
  const taxaEntrega = 8
  const total = 248.7 // subtotal − desconto + entrega
  const pago = 100
  return {
    versao: 1,
    recibo_teste: true,
    loja: d.loja,
    impressora: d.impressora,
    nome_sistema: d.nomeSistema,
    computador: d.computador,
    largura_mm: d.larguraMm,
    largura_pontos: d.larguraPontos,
    deslocamento_pontos: d.deslocamentoPontos,
    operador,
    impresso_em: agora.toISOString(),
    aberta_em: agora.toISOString(),
    via: 1,
    tipo: 'mesa',
    mesa: '34',
    cliente_nome: 'Maria',
    cliente_telefone: '(27) 99999-0000',
    endereco: {
      rua: 'Avenida Nossa Senhora da Penha, Condomínio Residencial Jardim das Orquídeas',
      numero: '1500',
      complemento: 'Bloco C, apartamento 1203',
      bairro: 'Santa Lúcia',
      cidade: 'Vitória',
      uf: 'ES',
    },
    observacao: 'Entregar na portaria. Não tocar a campainha.',
    itens,
    subtotal,
    taxa: 0,
    taxa_percentual: 0,
    desconto,
    taxa_entrega: taxaEntrega,
    total,
    pago,
    pagamentos: [{ forma: 'pix', valor: pago }],
    restante: Math.round((total - pago) * 100) / 100,
    status_pagamento: 'Pagamento parcial',
    cancelados: [],
  }
}

/**
 * Comanda da COZINHA de teste (Beta 0.2.0-beta.2+): os dados do modelo oficial
 * (docs/referencias/impressao/v3/COMANDA.png; soma da coluna VALOR = 44,40) — item com adicional e observação, desconto,
 * taxa de entrega, Pix e o QR da loja. Mesma fila e mesmas garantias do Recibo/Extrato
 * de teste: não cria pedido, não reserva nada da fila da cozinha, não toca no antigo.
 */
export function snapshotCozinhaTeste(
  d: Destino,
  operador: string,
  qr: { origem: string; url: string; tamanho: number; linhas: string[] } | null,
  agora = new Date(),
): Record<string, unknown> {
  const recebido = new Date(agora.getTime() - 17 * 60_000)
  const pedido = {
    id: 'teste',
    numero: 129,
    tipo: 'entrega',
    canal: 'delivery',
    origem: 'cardapio',
    formaPagamento: 'pix',
    trocoPara: null,
    clienteNome: 'Cliente de teste',
    clienteTelefone: '552799920804',
    enderecoRua: 'Avenida Henrique Moscoso',
    enderecoNumero: '1',
    enderecoComplemento: 'Apto 1203, bloco B',
    enderecoBairro: 'JABURUNA',
    enderecoCep: '',
    // Comanda padrão (0.2.0-beta.7): cidade e referência aparecem nos DADOS DA ENTREGA.
    enderecoCidade: 'Vila Velha/ES',
    enderecoReferencia: 'Em frente à padaria, portão verde',
    observacao: '',
    pago: false,
    mesa: null,
    senha: null,
    subtotal: 44.4,
    taxaEntrega: 3,
    total: 45.4,
    criadoEm: recebido.toISOString(),
    itens: [
      {
        nome: 'Bolo Duplo', quantidade: 1, precoUnitario: 25, observacao: 'cortar ao meio e enviar colher',
        tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '',
        complementos: [{ nome: 'Calda de chocolate', preco: 3 }, { nome: 'Morango extra', preco: 4 }],
      },
      { nome: 'Coca-Cola Lata 350ml', quantidade: 1, precoUnitario: 6, observacao: '', tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos: [] },
      {
        nome: 'Coxinha', quantidade: 2, precoUnitario: 6.7, observacao: '',
        tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '',
        complementos: [{ nome: 'Catupiry', preco: 1 }, { nome: 'Molho especial', preco: 0.5 }],
      },
    ],
  }
  return {
    versao: 2,
    cozinha_teste: true,
    loja: d.loja,
    impressora: d.impressora,
    nome_sistema: d.nomeSistema,
    computador: d.computador,
    largura_mm: d.larguraMm,
    largura_pontos: d.larguraPontos,
    deslocamento_pontos: d.deslocamentoPontos,
    operador,
    impresso_em: agora.toISOString(),
    pedido,
    extras: { desconto: 2, aceitoEm: null, prontoEm: new Date(recebido.getTime() + 17 * 60_000).toISOString(), comandaNumero: null, atendente: null },
    qr,
  }
}
