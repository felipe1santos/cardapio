import { sanearDiagnostico } from './servico'

/**
 * Memória (por processo) do que cada computador pareado já mandou na descoberta de impressoras.
 * O Assistente reenvia a lista a cada ~60 s; só vale gravar quando ela (ou o diagnóstico do
 * driver) mudou, ou a cada 30 min para renovar. `visto_em` das impressoras só é mostrado na tela
 * (nenhuma regra depende dele), então 30 min não atrasa nada. Reinício do servidor = grava de novo.
 */
export const DESCOBERTA_RENOVA_MS = 30 * 60_000
const LIMITE_AGENTES = 2_000
const gravadas = new Map<string, { assinatura: string; em: number }>()

function assinaturaDe(nomes: string[], diagnosticos: unknown): string {
  const diag: Record<string, unknown> = {}
  if (diagnosticos && typeof diagnosticos === 'object' && !Array.isArray(diagnosticos)) {
    for (const nome of Object.keys(diagnosticos).sort().slice(0, 60)) {
      // Mesma limpeza do `descobrir`: campo de ruído não conta como mudança.
      const limpo = sanearDiagnostico((diagnosticos as Record<string, unknown>)[nome])
      if (limpo) diag[nome] = limpo
    }
  }
  return JSON.stringify({ n: [...nomes].sort(), d: diag })
}

export function precisaGravarDescoberta(agenteId: string, nomes: string[], diagnosticos: unknown, agora = Date.now()): boolean {
  const g = gravadas.get(agenteId)
  if (!g) return true
  if (agora - g.em >= DESCOBERTA_RENOVA_MS) return true
  return g.assinatura !== assinaturaDe(nomes, diagnosticos)
}

export function marcarDescobertaGravada(agenteId: string, nomes: string[], diagnosticos: unknown, agora = Date.now()): void {
  if (!gravadas.has(agenteId) && gravadas.size >= LIMITE_AGENTES) {
    const primeiro = gravadas.keys().next().value
    if (primeiro !== undefined) gravadas.delete(primeiro)
  }
  gravadas.set(agenteId, { assinatura: assinaturaDe(nomes, diagnosticos), em: agora })
}

/** Sem argumento esquece todos (botão "Atualizar lista" e testes). */
export function esquecerDescoberta(agenteId?: string): void {
  if (agenteId) gravadas.delete(agenteId)
  else gravadas.clear()
}
