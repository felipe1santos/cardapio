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

export function pedidoDemonstracao(agora = new Date()) {
  const s = snapshotCozinhaTeste(DESTINO, '', null, agora) as { pedido: Record<string, unknown>; extras: Record<string, unknown> }
  return { pedido: { ...s.pedido, id: 'previa' }, extras: s.extras }
}

export function contaDemonstracao(loja: string, agora = new Date()) {
  const s = snapshotReciboTeste({ ...DESTINO, loja }, '', agora)
  // Conta de verdade: sem as marcas de teste nem telefone/endereço do cliente.
  const conta: Record<string, unknown> = { ...s }
  for (const k of ['recibo_teste', 'cliente_telefone', 'endereco', 'observacao']) delete conta[k]
  return conta
}
