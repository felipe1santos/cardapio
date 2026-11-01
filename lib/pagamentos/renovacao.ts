/**
 * Renovação do token do Mercado Pago (01/11/2026, Fase 5): quais contas o cron tenta renovar nesta rodada. Pura.
 * Antes: toda conta a menos de 30 dias do vencimento, TODO MINUTO; se o MP recusasse, 1.440 tentativas/dia por até
 * 30 dias. Agora: no máximo 1 tentativa por hora por conta (`atualizado_em` é gravado em toda tentativa).
 */
export const RENOVACAO_ESPERA_MS = 3600_000
export const RENOVAR_ANTES_MS = 30 * 86_400_000

export function contasParaRenovar<T extends { expira_em: string; atualizado_em: string | null }>(contas: T[], agora: number): T[] {
  return contas.filter((c) => {
    if (Date.parse(c.expira_em) - agora >= RENOVAR_ANTES_MS) return false
    return !c.atualizado_em || agora - Date.parse(c.atualizado_em) >= RENOVACAO_ESPERA_MS
  })
}
