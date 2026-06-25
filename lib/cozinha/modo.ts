// lib/cozinha/modo.ts
// Lógica pura do acesso da cozinha por estação: o que cada modo VÊ e o que pode FAZER.
import type { StatusPedido } from '@/lib/queries/pedidos'

export type ModoEstacao = 'producao' | 'expedicao' | 'completa'
export type AcaoCozinha = 'pegar' | 'devolver' | 'concluir' | 'entregue'

export const MODOS: ModoEstacao[] = ['producao', 'expedicao', 'completa']

export const LABEL_MODO: Record<ModoEstacao, string> = {
  producao: 'Produção',
  expedicao: 'Expedição',
  completa: 'Cozinha completa',
}

const STATUS_POR_MODO: Record<ModoEstacao, StatusPedido[]> = {
  producao: ['recebido', 'preparando'],
  expedicao: ['pronto'],
  completa: ['recebido', 'preparando', 'pronto'],
}

const ACOES_POR_MODO: Record<ModoEstacao, AcaoCozinha[]> = {
  producao: ['pegar', 'devolver', 'concluir'],
  expedicao: ['entregue'],
  completa: ['pegar', 'devolver', 'concluir', 'entregue'],
}

/** Status de origem exigido para cada ação (guarda contra cliques velhos/concorrentes). */
export const ORIGEM_ESPERADA: Record<AcaoCozinha, StatusPedido> = {
  pegar: 'recebido',
  devolver: 'preparando',
  concluir: 'preparando',
  entregue: 'pronto',
}

export function statusVisiveis(modo: ModoEstacao): StatusPedido[] {
  return STATUS_POR_MODO[modo]
}

export function podeExecutar(modo: ModoEstacao, acao: AcaoCozinha): boolean {
  return ACOES_POR_MODO[modo].includes(acao)
}
