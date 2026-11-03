/**
 * Aviso de assinatura no topo do painel (03/11/2026, regra do dono): a mensalidade venceu e a loja está na carência
 * (ou o Asaas já marcou "atrasada") → "Sua assinatura precisa ser regularizada", com a data limite e a fatura.
 * Vitalícia (sem validade), em dia antes do vencimento, cancelada ou sem assinatura → nada. Pura.
 */
export interface EstadoAssinatura { status: 'aguardando' | 'em_dia' | 'atrasada' | 'cancelada'; proximoVencimento: string | null; acessoExpiraEm: string | null; faturaUrl: string | null }
export interface AvisoAssinatura { tipo: 'carencia'; ateIso: string; faturaUrl: string | null }

export function avisoDaAssinatura(a: EstadoAssinatura | null, agora: number): AvisoAssinatura | null {
  if (!a || !a.acessoExpiraEm) return null
  if (a.status === 'cancelada' || a.status === 'aguardando') return null
  const fim = Date.parse(a.acessoExpiraEm)
  if (!(fim > agora)) return null
  const venceu = a.proximoVencimento ? Date.parse(`${a.proximoVencimento.slice(0, 10)}T23:59:59-03:00`) <= agora : false
  if (a.status !== 'atrasada' && !venceu) return null
  return { tipo: 'carencia', ateIso: a.acessoExpiraEm, faturaUrl: a.faturaUrl }
}
