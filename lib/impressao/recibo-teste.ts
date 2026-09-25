/**
 * Recibo/Extrato de TESTE — dados de demonstração, fixos, montados no servidor.
 *
 * Vai para a fila do Assistente Beta como `teste_impressora` com `recibo_teste: true`
 * e é desenhado pelo MESMO renderizador do Recibo/Extrato de verdade (pre-conta.js +
 * print.ps1), com o perfil daquela impressora. Não cria pedido, comanda, pagamento,
 * fidelidade nem cupom: é só texto. Os dados forçam o que costuma cortar no papel —
 * nome longo, endereço longo, muitos complementos, valores de quatro dígitos.
 */

export const TOTAL_RECIBO_TESTE = 4088

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
  const complementos = [
    { nome: 'Borda recheada de catupiry', preco: 12 },
    { nome: 'Bacon crocante extra', preco: 9 },
    { nome: 'Bacon crocante extra', preco: 9 },
    { nome: 'Cheddar cremoso', preco: 8 },
    { nome: 'Cebola caramelizada', preco: 6 },
    { nome: 'Azeitonas pretas', preco: 0 },
    { nome: 'Molho especial da casa', preco: 26 },
  ]
  // 2 × (1.890,00 + 70,00 de complementos) = 3.920,00
  const combo = {
    quantidade: 2,
    nome: 'Combo Família Gigante Especial da Casa com Pizza Meio a Meio e Refrigerante 2 L',
    tamanho: 'Gigante',
    sabor: 'Portuguesa / Quatro Queijos',
    preco_unitario: 1960,
    subtotal: 3920,
    complementos,
    observacao: 'Cortar em 16 pedaços, sem cebola na metade Quatro Queijos',
  }
  const porcao = { quantidade: 1, nome: 'Porção de Batata Rústica com Cheddar e Bacon', preco_unitario: 188, subtotal: 188, complementos: [] }
  const subtotal = 4108
  const desconto = 45
  const taxaEntrega = 25
  const total = subtotal - desconto + taxaEntrega // 4.088,00
  const pago = 1000
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
    tipo: 'teste',
    cliente_nome: 'Maria Aparecida dos Santos Conceição de Albuquerque Figueiredo',
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
    itens: [combo, porcao],
    subtotal,
    taxa: 0,
    taxa_percentual: 0,
    desconto,
    taxa_entrega: taxaEntrega,
    total,
    pago,
    pagamentos: [{ forma: 'pix', valor: pago }],
    restante: total - pago,
    status_pagamento: 'Pagamento parcial',
    cancelados: [],
  }
}
