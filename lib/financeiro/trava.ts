/**
 * Trava por inatividade (0132) — regra pura.
 *
 * Telas de operação contínua (pedidos chegando, mesas, cozinha, PDV) NUNCA travam sozinhas:
 * o operador olha sem tocar por longos períodos e a sobreposição esconderia pedido novo.
 * Nelas a trava é só manual (menu de conta → Bloquear tela). E só trava sozinho quem já tem
 * PIN — sem PIN, destravar exigiria sair e entrar com senha a cada 5 minutos.
 */
export const ROTAS_SEM_AUTOTRAVA = ['/admin/pedidos', '/admin/lista-pedidos', '/admin/logistica', '/admin/pdv', '/admin/mesas', '/admin/cozinha'] as const

export function autoTravaPermitida(pathname: string): boolean {
  return !ROTAS_SEM_AUTOTRAVA.some((r) => pathname === r || pathname.startsWith(r + '/'))
}

export function deveTravar(p: {
  financeiroAtivo: boolean
  temPin: boolean
  travada: boolean
  inatividadeMin: number
  pathname: string
  ultimaAtividade: number
  agora: number
}): boolean {
  if (!p.financeiroAtivo || !p.temPin || p.travada) return false
  if (!(p.inatividadeMin > 0)) return false
  if (!autoTravaPermitida(p.pathname)) return false
  return p.agora - p.ultimaAtividade >= p.inatividadeMin * 60_000
}
