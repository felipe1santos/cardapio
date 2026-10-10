/**
 * LINK MÁGICO DO MOTOBOY (link/QR sem senha, /entregador/<token>) — fim agendado (10/10/2026, ordem do dono).
 *   · Vale até o motoboy entrar pela 1ª vez com login e senha (o login troca o token: o link dele para na hora).
 *   · Prazo final para todos: LINK_MAGICO_ATE (Coolify) ou 17/10/2026 23:59 (Brasília) — depois, só login e senha.
 *   · Enquanto vale, o app mostra "Peça seu login e senha ao restaurante. Em breve este link deixa de funcionar."
 * Lista de quem ainda depende do link: docs/motoboy/acesso.md.
 */
export const PRAZO_LINK_MAGICO_PADRAO = '2026-10-17T23:59:59-03:00'

export function prazoLinkMagico(env: Record<string, string | undefined> = process.env): number {
  const t = Date.parse(env.LINK_MAGICO_ATE ?? PRAZO_LINK_MAGICO_PADRAO)
  return Number.isNaN(t) ? Date.parse(PRAZO_LINK_MAGICO_PADRAO) : t
}

export function linkMagicoValido(agora = Date.now(), env: Record<string, string | undefined> = process.env): boolean {
  return agora <= prazoLinkMagico(env)
}
