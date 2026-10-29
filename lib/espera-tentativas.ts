/**
 * Espera crescente entre tentativas (28/10/2026, auditoria das travas — os 3 riscos médios). Puras; colunas em 0233.
 */
const MIN = 60_000

/** Status para o canal: espera 1, 2, 4… até 60 min depois do n-ésimo erro; null = desistiu (8 erros na mesma etapa). */
export const MAX_TENTATIVAS_CANAL = 8
export function esperaEnvioCanal(tentativas: number): number | null {
  if (tentativas >= MAX_TENTATIVAS_CANAL) return null
  return Math.min(60, 2 ** Math.max(0, tentativas - 1)) * MIN
}

/**
 * Próxima consulta do Pix que deu erro no Mercado Pago, pela idade em relação ao vencimento: até 1 h depois, a cada
 * minuto; até 24 h, a cada 15 min; até 7 dias, a cada 2 h; depois, 1 vez por dia. Nunca muda o status nem expira sem
 * confirmar — só espaça as consultas; o webhook do Mercado Pago continua confirmando a qualquer hora.
 */
export function proximaVerificacaoPix(expiraEm: number, agora: number): number {
  const passou = agora - expiraEm
  if (passou > 7 * 24 * 60 * MIN) return agora + 24 * 60 * MIN
  if (passou > 24 * 60 * MIN) return agora + 120 * MIN
  if (passou > 60 * MIN) return agora + 15 * MIN
  return agora + MIN
}

/** Corrida ativa: consulta no parceiro a cada ~1 min nos primeiros 30 min, 3 min até 90 min, 10 min depois. */
export function deveConsultarCorrida(criadoEm: string, atualizadoEm: string, consultadoEm: string | null, agora: number): boolean {
  const idade = agora - Date.parse(criadoEm)
  const intervalo = idade < 30 * MIN ? 50_000 : idade < 90 * MIN ? 3 * MIN : 10 * MIN
  const ultima = Math.max(Date.parse(atualizadoEm) || 0, consultadoEm ? Date.parse(consultadoEm) : 0)
  return agora - ultima >= intervalo
}
