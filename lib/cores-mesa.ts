import type { EstadoMesa } from '@/lib/queries/mesas'

/**
 * Cores dos cartões de mesa (Mesas e Comandas e PDV), 27/10/2026 — referência do dono (mapa de mesas com fundo
 * claro tingido, borda forte da mesma cor e cronômetro em pílula sólida). Nome e valor em #1F2937 sobre o fundo
 * (≥ 7:1); `forte` é o texto do estado e o fundo da pílula com texto branco (≥ 4,5:1).
 */
export interface CorMesa { fundo: string; borda: string; forte: string }

export const COR_MESA: Record<EstadoMesa, CorMesa> = {
  livre: { fundo: '#9BE7DE', borda: '#14B8A6', forte: '#0F766E' },
  aguardando: { fundo: '#FDE1AE', borda: '#F0A93B', forte: '#B45309' },
  ocupada: { fundo: '#FBB8BD', borda: '#E5566A', forte: '#BE123C' },
  limpeza: { fundo: '#E3D7FC', borda: '#9061F9', forte: '#6D28D9' },
  bloqueada: { fundo: '#E5E7EB', borda: '#6B7280', forte: '#374151' },
  inativa: { fundo: '#F3F4F6', borda: '#D1D5DB', forte: '#6B7280' },
}

export const TEXTO_MESA = '#1F2937'
