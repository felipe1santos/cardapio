import { snapshotCozinhaTeste, snapshotReciboTeste } from './recibo-teste'

/**
 * Dados de DEMONSTRAÇÃO da pré-visualização do Assistente Beta (página Impressão).
 * São os dados dos modelos oficiais (docs/referencias/impressao/v3) — os mesmos do
 * "Testar Cozinha" / "Testar Recibo/Extrato", sem as marcas e avisos de teste. A
 * pré-visualização monta o documento com os MESMOS montadores do Beta (cozinha-beta.js /
 * pre-conta-beta.js) e desenha com o MESMO ticket-canvas.js — o que aparece na tela é o
 * que sai no papel.
 */

const DESTINO = { loja: '', impressora: '', nomeSistema: '', computador: '', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 }

export type TipoDemonstracao = 'mesa' | 'entrega' | 'retirada'

/**
 * Pedido de demonstração da comanda por tipo. Mesa = os dados de
 * docs/referencias/impressao/comanda-padrao.png; entrega com endereço longo, complemento,
 * referência e troco (o pior caso para o motoboy); retirada só com cliente e telefone.
 */
export function pedidoDemonstracao(agora = new Date(), tipo: TipoDemonstracao = 'entrega') {
  const s = snapshotCozinhaTeste(DESTINO, '', null, agora) as { pedido: Record<string, unknown>; extras: Record<string, unknown> }
  const base = { ...s.pedido, id: 'previa' }
  if (tipo === 'mesa') {
    const item = (nome: string, precoUnitario: number, complementos: { nome: string; preco: number }[] = [], observacao = '') =>
      ({ nome, quantidade: 1, precoUnitario, observacao, tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos })
    return {
      pedido: {
        ...base, numero: 133, canal: 'mesa', tipo: 'retirada', origem: 'pdv', mesa: '01', formaPagamento: null, clienteNome: 'Cliente Testes', clienteTelefone: '',
        enderecoRua: '', enderecoNumero: '', enderecoBairro: '', taxaEntrega: 0, subtotal: 59.9, total: 59.9,
        itens: [item('Coca Lata 350ml', 6), item('Bolo Duplo', 14.9), item('Smash', 29), item('X-Tudo', 10, [{ nome: 'item 2', preco: 1 }], 'sem cebola')],
      },
      extras: { ...s.extras, desconto: 0, prontoEm: null, comandaNumero: 21, atendente: 'Administrador' },
    }
  }
  if (tipo === 'retirada') {
    return { pedido: { ...base, tipo: 'retirada', canal: 'delivery', taxaEntrega: 0, total: 42.4, clienteNome: 'Maria Souza', clienteTelefone: '27999887766' }, extras: s.extras }
  }
  // Entrega = exatamente o pedido do "Testar Cozinha" (o que sai no papel no teste).
  return { pedido: base, extras: s.extras }
}

export function contaDemonstracao(loja: string, agora = new Date()) {
  const s = snapshotReciboTeste({ ...DESTINO, loja }, '', agora)
  // Conta de verdade: sem as marcas de teste nem telefone/endereço do cliente.
  const conta: Record<string, unknown> = { ...s }
  for (const k of ['recibo_teste', 'cliente_telefone', 'endereco', 'observacao']) delete conta[k]
  return conta
}
