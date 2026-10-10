import { pode, type Permissao } from '@/lib/auth/permissoes'
import type { Modulo, ModulosDaLoja } from '@/lib/modulos'

/**
 * Itens do menu lateral do painel, na ordem em que aparecem.
 *
 * "Mesas e Comandas" é item PRÓPRIO do menu principal, junto das áreas de operação
 * (Painel de Pedidos, PDV) — é por ele que se trabalha nas mesas. Ajustes › Mesas é só
 * configuração do módulo.
 *
 * Auditoria não tem item no menu: a tela continua em /admin/auditoria para quem tem
 * permissão (link direto), só não ocupa espaço na barra.
 *
 * O selo "Novo" existe para chamar atenção a uma seção recém-lançada — hoje só
 * Campanhas (disparo de mensagem) o usa. É marcação temporária: quando deixar de
 * ser novidade, tira-se a chave daqui.
 *
 * Reorganização 10/10/2026 (ordem do dono) — SÓ com "Novidades em teste" (0178, hoje só a Menuzia): Agente de IA e
 * Impressão saem do menu principal e viram itens de Ajustes (Ajustes › Agente de IA, /admin/ajustes/impressao). Quem
 * pode configurar a Impressão mas não os Ajustes (gerente) vê "Ajustes" abrindo direto na Impressão. Sem a chave, o
 * menu é exatamente o de antes.
 */
export const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/pedidos', label: 'Painel de Pedidos' },
  { href: '/admin/pdv', label: 'PDV' },
  { href: '/admin/mesas', label: 'Mesas e Comandas' },
  { href: '/admin/cozinha', label: 'Cozinha' },
  { href: '/admin/lista-pedidos', label: 'Pedidos' },
  { href: '/admin/financeiro', label: 'Financeiro' },
  { href: '/admin/cardapio', label: 'Cardápio' },
  { href: '/admin/clientes', label: 'Clientes' },
  { href: '/admin/campanhas', label: 'Campanhas', novidade: true },
  { href: '/admin/agente-ia', label: 'Agente de IA' },
  { href: '/admin/fidelidade', label: 'Fidelidade' },
  { href: '/admin/integracoes', label: 'Integrações' },
  { href: '/admin/equipe', label: 'Equipe' },
  { href: '/admin/impressao', label: 'Impressão' },
  { href: '/admin/ajustes', label: 'Ajustes' },
] as const

/** Impressão dentro de Ajustes (10/10). */
export const HREF_IMPRESSAO = '/admin/ajustes/impressao'

export type ItemMenu = Omit<(typeof NAV_ITEMS)[number], 'href'> & { href: string; /** Módulo pago bloqueado na loja (0176): item meio apagado, com cadeado. */ bloqueado?: Modulo }

/** Item do menu → módulo pago que ele abre (0176). */
const MODULO_DO_ITEM: Record<string, Modulo> = { '/admin/financeiro': 'financeiro', '/admin/campanhas': 'disparos', '/admin/agente-ia': 'agente_ia' }

/** Saem do menu principal com "Novidades em teste" (viram itens de Ajustes). */
const FORA_DO_MENU_NOVO = new Set(['/admin/agente-ia', '/admin/impressao'])

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
  '/admin/cozinha': 'cozinha.gerenciar',
  '/admin/lista-pedidos': 'logistica.operar',
  '/admin/financeiro': 'pedidos.delivery.ver',
  '/admin/cardapio': 'cardapio.editar',
  '/admin/clientes': 'clientes.ver',
  '/admin/campanhas': 'campanhas.gerenciar',
  '/admin/agente-ia': 'integracoes.gerenciar',
  '/admin/fidelidade': 'fidelidade.gerenciar',
  '/admin/integracoes': 'integracoes.gerenciar',
  '/admin/equipe': 'equipe.gerenciar',
  '/admin/impressao': 'impressao.configurar',
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
  /** Módulo financeiro ligado na loja E alguma ação liberada para a pessoa (0132). Padrão: some. */
  financeiro?: boolean
  /**
   * Módulos pagos liberados (0176). Bloqueado: o item NÃO some — fica meio apagado, com cadeado, e abre o
   * "Quero liberar". Sem a informação ainda (carregando): tratado como bloqueado (nunca abre o que não pagou).
   */
  modulos?: ModulosDaLoja | null
  /** "Novidades em teste" (0178): menu reorganizado. Ausente/false = menu de antes. */
  novidades?: boolean
}): ItemMenu[] {
  const lista: ItemMenu[] = []
  for (const item of NAV_ITEMS) {
    if (item.href === '/admin/lista-pedidos' && !opcoes.usaLogistica) continue
    if (item.href === '/admin/mesas' && !opcoes.moduloMesas) continue
    if (opcoes.novidades && FORA_DO_MENU_NOVO.has(item.href)) continue
    if (opcoes.papel !== null) {
      const exigida = PERMISSAO_DO_MENU[item.href]
      if (exigida && !pode(opcoes.papel, exigida)) {
        // Sem os Ajustes, mas com a Impressão (gerente): "Ajustes" abre direto na Impressão — como antes ele tinha o item Impressão.
        if (opcoes.novidades && item.href === '/admin/ajustes' && pode(opcoes.papel, 'impressao.configurar')) lista.push({ ...item, href: HREF_IMPRESSAO })
        continue
      }
    }
    const modulo = MODULO_DO_ITEM[item.href]
    if (modulo && !opcoes.modulos?.[modulo]) { lista.push({ ...item, bloqueado: modulo }); continue }
    if (item.href === '/admin/financeiro' && !opcoes.financeiro) continue
    lista.push(item)
  }
  return lista
}
