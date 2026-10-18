/** Texto e tom dos status da Lalamove para o painel. Client-safe (sem node). */
export const TEXTO_STATUS_LALAMOVE: Record<string, string> = {
  ASSIGNING_DRIVER: 'Procurando entregador',
  ON_GOING: 'Entregador a caminho da loja',
  PICKED_UP: 'Coletado · em rota',
  COMPLETED: 'Entregue pela Lalamove',
  CANCELED: 'Corrida cancelada',
  REJECTED: 'Entregadores recusaram',
  EXPIRED: 'Nenhum entregador aceitou',
}
export const textoStatusLalamove = (s: string) => TEXTO_STATUS_LALAMOVE[s] ?? s
/** Tom (guia visual §2): azul = andamento, roxo = em rota, verde = entregue, vermelho/laranja = parou. */
export function tomStatusLalamove(s: string): 'azul' | 'roxo' | 'verde' | 'laranja' | 'vermelho' {
  if (s === 'ASSIGNING_DRIVER' || s === 'ON_GOING') return 'azul'
  if (s === 'PICKED_UP') return 'roxo'
  if (s === 'COMPLETED') return 'verde'
  if (s === 'CANCELED') return 'vermelho'
  return 'laranja'
}
export const CORRIDA_ATIVA: readonly string[] = ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP']
/** Cancelar pela Lalamove só vale até 5 min depois do aceite; o servidor confirma, a tela só esconde depois da coleta. */
export const podeCancelarCorrida = (s: string) => s === 'ASSIGNING_DRIVER' || s === 'ON_GOING'

export interface EntregaProvedorLinha {
  id: string
  restauranteId: string
  pedidoId: string
  provedor: string
  ambiente: string
  externoId: string | null
  status: string
  preco: number | null
  distanciaM: number | null
  shareLink: string | null
  motoristaNome: string | null
  motoristaTelefone: string | null
  motoristaPlaca: string | null
  erro: string | null
  criadoEm: string
  atualizadoEm: string
}

export function mapEntregaProvedor(r: Record<string, unknown>): EntregaProvedorLinha {
  return {
    id: String(r.id), restauranteId: String(r.restaurante_id), pedidoId: String(r.pedido_id), provedor: String(r.provedor ?? 'lalamove'),
    ambiente: String(r.ambiente ?? 'sandbox'), externoId: (r.externo_id as string | null) ?? null, status: String(r.status),
    preco: r.preco === null || r.preco === undefined ? null : Number(r.preco), distanciaM: (r.distancia_m as number | null) ?? null,
    shareLink: (r.share_link as string | null) ?? null, motoristaNome: (r.motorista_nome as string | null) ?? null,
    motoristaTelefone: (r.motorista_telefone as string | null) ?? null, motoristaPlaca: (r.motorista_placa as string | null) ?? null,
    erro: (r.erro as string | null) ?? null, criadoEm: String(r.criado_em), atualizadoEm: String(r.atualizado_em),
  }
}
export const ENTREGA_PROVEDOR_SELECT = 'id, restaurante_id, pedido_id, provedor, ambiente, externo_id, status, preco, distancia_m, share_link, motorista_nome, motorista_telefone, motorista_placa, erro, criado_em, atualizado_em'
