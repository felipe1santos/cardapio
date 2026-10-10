/**
 * Loja fora da atualização automática do Assistente (0172, Villa — ordem do dono 09/10).
 *
 * O atualizador do Assistente busca GET /api/agente/atualizacao/latest.yml SEM credencial, então o servidor
 * reconhece a loja pelo IP: cada computador grava em impressao_agentes.visto_ip de onde buscou pedidos, e o
 * latest.yml responde 404 para os IPs dos computadores (não revogados) das lojas com
 * restaurantes.impressao_sem_atualizacao = true. Regras puras aqui; a consulta fica na rota.
 */

/** IP de quem chamou: o primeiro do x-forwarded-for (proxy do Coolify), senão x-real-ip. Nulo se não houver. */
export function ipDoRequest(h: Pick<Headers, 'get'>): string | null {
  const xff = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim()
  const ip = xff || (h.get('x-real-ip') ?? '').trim()
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null
  return ip
}

/** Este IP é de um computador de loja que não atualiza sozinha? */
export function bloqueiaAtualizacao(ip: string | null, ipsBloqueados: (string | null)[]): boolean {
  if (!ip) return false
  return ipsBloqueados.some((x) => !!x && x === ip)
}

/** Gravar o IP de novo? No máximo a cada 10 min por computador, ou quando o IP mudou. */
export const IP_A_CADA_MS = 10 * 60_000
export function deveGravarIp(anterior: { ip: string; em: number } | undefined, ip: string, agora: number): boolean {
  return !anterior || anterior.ip !== ip || agora - anterior.em >= IP_A_CADA_MS
}
