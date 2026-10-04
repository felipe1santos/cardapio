/**
 * Avisos fixos do painel admin, ligados e desligados só por nós (a loja não fecha).
 *
 * AVISO DO NOVO SISTEMA DE IMPRESSÃO (2026-09-28) — convida as lojas a migrarem para o
 * Assistente Beta. Para DESLIGAR em todas as telas: troque AVISO_NOVA_IMPRESSAO_LIGADO
 * para `false` e publique; ou, sem mexer no código, defina NEXT_PUBLIC_AVISO_NOVA_IMPRESSAO=0
 * no ambiente do build (Coolify) e faça Redeploy.
 */
const AVISO_NOVA_IMPRESSAO_LIGADO = false // desligado a pedido do dono em 2026-10-04
export const AVISO_NOVA_IMPRESSAO_ATIVO = AVISO_NOVA_IMPRESSAO_LIGADO && process.env.NEXT_PUBLIC_AVISO_NOVA_IMPRESSAO !== '0'

/** Telas onde o aviso NÃO aparece: o Kanban de pedidos (operação) e a própria Impressão. */
export const ROTAS_SEM_AVISO_NOVA_IMPRESSAO = ['/admin/pedidos', '/admin/impressao']

export function mostrarAvisoNovaImpressao(pathname: string, ativo = AVISO_NOVA_IMPRESSAO_ATIVO): boolean {
  if (!ativo) return false
  return !ROTAS_SEM_AVISO_NOVA_IMPRESSAO.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}
