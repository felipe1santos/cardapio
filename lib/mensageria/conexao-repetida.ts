/**
 * Freio dos eventos de conexão do WhatsApp (28/10/2026, varredura — docs/relatorios/2026-10-28-varredura.md).
 * Em 27/10, entre 16h e 18h, a instância da Ponto 400 mandou ~75 mil CONNECTION_UPDATE (connecting/close 440/503). Cada
 * um virava ~5 consultas (config, loja, monitor, auditoria, registro) e, no close, uma reconexão que brigava com a outra
 * sessão (440) e gerava mais eventos — ~375 mil requisições em 2 h, no dia em que o Supabase bloqueou o projeto.
 * Puro (o estado fica com quem chama).
 */
export const JANELA_REPETIDO_MS = 60_000
export const RECONEXOES_POR_HORA = 3

/** O mesmo evento (segredo do webhook + estado + motivo) já chegou nos últimos 60 s? Registra o de agora. */
export function eventoConexaoRepetido(mapa: Map<string, number>, segredo: string, c: { estado: string; motivo: number | string | null }, agora: number): boolean {
  const chave = `${segredo}|${c.estado}|${c.motivo ?? ''}`
  const antes = mapa.get(chave)
  if (antes !== undefined && agora - antes < JANELA_REPETIDO_MS) return true
  mapa.set(chave, agora)
  if (mapa.size > 2000) for (const [k, t] of mapa) if (agora - t >= JANELA_REPETIDO_MS) mapa.delete(k)
  return false
}

/**
 * Reconectar sozinho? Não quando o motivo diz que reconectar não resolve: 440 = a sessão foi aberta em outro lugar
 * (reconectar derruba a outra, que derruba esta…), 401 = deslogado no celular (precisa de QR). E no máximo 3 por hora.
 */
export function podeReconectarSozinho(motivo: number | string | null | undefined, tentativas: number[], agora: number): boolean {
  const m = Number(motivo)
  if (m === 440 || m === 401) return false
  return tentativas.filter((t) => agora - t < 3600_000).length < RECONEXOES_POR_HORA
}
