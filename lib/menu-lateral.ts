import { pode, type Permissao } from '@/lib/auth/permissoes'

/**
 * Itens do menu lateral do painel, na ordem em que aparecem.
 *
 * "Mesas e Comandas" é item PRÓPRIO do menu principal, junto das áreas de operação
 * (Painel de Pedidos, PDV) — é por ele que se trabalha nas mesas. Ajustes › Mesas é só
 * configuração do módulo.
 *
 * Auditoria não tem item no menu: a tela continua em /admin/auditoria para quem tem
 * permissão (link direto), só não ocupa espaço na barra. Nenhum item leva selo "novidade".
 */
export const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/pedidos', label: 'Painel de Pedidos' },
  { href: '/admin/pdv', label: 'PDV' },
  { href: '/admin/mesas', label: 'Mesas e Comandas' },
  { href: '/admin/logistica', label: 'Logística' },
  { href: '/admin/cardapio', label: 'Cardápio' },
  { href: '/admin/clientes', label: 'Clientes' },
  { href: '/admin/campanhas', label: 'Campanhas' },
  { href: '/admin/fidelidade', label: 'Fidelidade' },
  { href: '/admin/integracoes', label: 'Integrações' },
  { href: '/admin/equipe', label: 'Equipe' },
  { href: '/admin/ajustes', label: 'Ajustes' },
] as const

export type ItemMenu = (typeof NAV_ITEMS)[number]

/**
 * Permissão que cada tela exige para aparecer no menu.
 *
 * Isto é COSMÉTICO: esconder o item não protege nada. Quem barra é o middleware, as
 * rotas e a RLS. O menu só deixa de oferecer tela que o funcionário não conseguiria usar.
 */
export const PERMISSAO_DO_MENU: Record<string, Permissao> = {
  '/admin/dashboard': 'dashboard.faturamento',
  '/admin/pedidos': 'pedidos.delivery.ver',
  '/admin/pdv': 'pedidos.balcao.criar',
  '/admin/mesas': 'comanda.ver',
  '/admin/logistica': 'logistica.operar',
  '/admin/cardapio': 'cardapio.editar',
  '/admin/clientes': 'clientes.ver',
  '/admin/campanhas': 'campanhas.gerenciar',
  '/admin/fidelidade': 'fidelidade.gerenciar',
  '/admin/integracoes': 'integracoes.gerenciar',
  '/admin/equipe': 'equipe.gerenciar',
  '/admin/ajustes': 'ajustes.editar',
}

/**
 * Itens visíveis para esta sessão. `papel === null` = papel ainda não lido: o menu não
 * filtra por papel (comportamento de sempre), mas o salão só aparece com a flag ligada.
 */
export function itensDoMenu(opcoes: {
  papel: string | null
  moduloMesas: boolean
  usaLogistica: boolean
}): ItemMenu[] {
  return NAV_ITEMS.filter((item) => {
    if (item.href === '/admin/logistica' && !opcoes.usaLogistica) return false
    if (item.href === '/admin/mesas' && !opcoes.moduloMesas) return false
    if (opcoes.papel === null) return true
    const exigida = PERMISSAO_DO_MENU[item.href]
    return exigida ? pode(opcoes.papel, exigida) : true
  })
}
