/**
 * Acessos por funcionário (Fase 6, 2026-09-30).
 *
 * `usuarios.acessos` (0120) é OPCIONAL. Nulo = tudo como sempre foi (o papel decide: o
 * garçom de hoje continua igual). Preenchido = o funcionário só entra nas áreas marcadas
 * e só faz as ações sensíveis marcadas — por cima do papel, nunca além dele (a RLS do
 * banco continua sendo a do papel). O dono nunca é limitado.
 *
 * Quem barra é o servidor: o middleware relê os acessos do banco a cada requisição (vale
 * na próxima ação, sem deslogar), as rotas conferem as ações sensíveis.
 */
export const AREAS = [
  { chave: 'dashboard', rotulo: 'Dashboard', href: '/admin/dashboard', prefixos: ['/admin/dashboard', '/api/admin/dashboard'] },
  { chave: 'pedidos', rotulo: 'Painel de Pedidos', href: '/admin/pedidos', prefixos: ['/admin/pedidos', '/api/admin/pedidos'] },
  { chave: 'pdv', rotulo: 'PDV', href: '/admin/pdv', prefixos: ['/admin/pdv', '/api/admin/pdv', '/api/admin/balcao', '/api/admin/comandas'] },
  { chave: 'mesas', rotulo: 'Mesas e Comandas', href: '/admin/mesas', prefixos: ['/admin/mesas', '/api/admin/mesas'] },
  { chave: 'cozinha', rotulo: 'Cozinha', href: '/admin/cozinha', prefixos: ['/admin/cozinha'] },
  { chave: 'logistica', rotulo: 'Logística', href: '/admin/logistica', prefixos: ['/admin/logistica', '/api/admin/caixa', '/api/admin/entregadores'] },
  { chave: 'cardapio', rotulo: 'Cardápio', href: '/admin/cardapio', prefixos: ['/admin/cardapio', '/api/admin/cardapio'] },
  { chave: 'clientes', rotulo: 'Clientes', href: '/admin/clientes', prefixos: ['/admin/clientes', '/api/admin/clientes'] },
  { chave: 'campanhas', rotulo: 'Campanhas', href: '/admin/campanhas', prefixos: ['/admin/campanhas', '/api/admin/campanhas'] },
  { chave: 'fidelidade', rotulo: 'Fidelidade', href: '/admin/fidelidade', prefixos: ['/admin/fidelidade', '/api/admin/fidelidade'] },
  { chave: 'integracoes', rotulo: 'Integrações', href: '/admin/integracoes', prefixos: ['/admin/integracoes', '/api/admin/nexta', '/api/admin/whatsapp/robo', '/api/admin/whatsapp/conectar', '/api/admin/whatsapp/desconectar', '/api/admin/whatsapp/status'] },
  { chave: 'equipe', rotulo: 'Equipe', href: '/admin/equipe', prefixos: ['/admin/equipe', '/api/admin/equipe'] },
  { chave: 'impressao', rotulo: 'Impressão', href: '/admin/impressao', prefixos: ['/admin/impressao', '/api/admin/impressao'] },
  { chave: 'ajustes', rotulo: 'Ajustes', href: '/admin/ajustes', prefixos: ['/admin/ajustes', '/api/admin/modulos'] },
] as const

export type Area = (typeof AREAS)[number]['chave']

export const SENSIVEIS = [
  { chave: 'cancelar_pedido', rotulo: 'Cancelar pedido' },
  { chave: 'desconto', rotulo: 'Dar desconto' },
  { chave: 'taxa', rotulo: 'Aplicar e remover taxas' },
  { chave: 'fechar_caixa', rotulo: 'Fechar caixa' },
  { chave: 'financeiro', rotulo: 'Ver valores e relatórios financeiros' },
  { chave: 'disparar_campanhas', rotulo: 'Disparar campanhas' },
  { chave: 'editar_precos', rotulo: 'Editar preços' },
] as const

export type Sensivel = (typeof SENSIVEIS)[number]['chave']

export interface Acessos { areas: Area[]; sensiveis: Sensivel[] }

const AREAS_VALIDAS = new Set<string>(AREAS.map((a) => a.chave))
const SENSIVEIS_VALIDAS = new Set<string>(SENSIVEIS.map((s) => s.chave))

/** Lê/limpa o que vem do banco ou da tela. Inválido ou vazio de tudo = null (sem limite). */
export function normalizarAcessos(bruto: unknown): Acessos | null {
  if (!bruto || typeof bruto !== 'object') return null
  const b = bruto as { areas?: unknown; sensiveis?: unknown }
  if (!Array.isArray(b.areas)) return null
  const areas = [...new Set(b.areas.filter((a): a is Area => typeof a === 'string' && AREAS_VALIDAS.has(a)))]
  const sensiveis = [...new Set((Array.isArray(b.sensiveis) ? b.sensiveis : []).filter((s): s is Sensivel => typeof s === 'string' && SENSIVEIS_VALIDAS.has(s)))]
  return { areas, sensiveis }
}

function casa(pathname: string, prefixo: string): boolean {
  return pathname === prefixo || pathname.startsWith(`${prefixo}/`)
}

/** Área do painel a que o caminho pertence. Null = neutro (ex.: central de atendimento, conta). */
export function areaDoCaminho(pathname: string): Area | null {
  // O mais específico vence: /api/admin/whatsapp/atendimento é neutro (a central é de quem atende).
  let melhor: { area: Area; tam: number } | null = null
  for (const a of AREAS) for (const p of a.prefixos) {
    if (casa(pathname, p) && (!melhor || p.length > melhor.tam)) melhor = { area: a.chave, tam: p.length }
  }
  return melhor?.area ?? null
}

/** O caminho é permitido para estes acessos? Dono e acessos nulos: sempre. */
export function caminhoPermitido(pathname: string, papel: string | null, acessos: Acessos | null): boolean {
  if (papel === 'dono' || !acessos) return true
  const area = areaDoCaminho(pathname)
  return area === null || acessos.areas.includes(area)
}

/** Pode a ação sensível? Dono e acessos nulos: segue o papel (a rota já confere o papel). */
export function podeSensivel(papel: string | null, acessos: Acessos | null, chave: Sensivel): boolean {
  if (papel === 'dono' || !acessos) return true
  return acessos.sensiveis.includes(chave)
}

/** Primeira tela permitida (para onde vai quem entra ou cai numa área proibida). */
export function primeiraTela(acessos: Acessos | null): string | null {
  if (!acessos) return null
  const a = AREAS.find((x) => acessos.areas.includes(x.chave))
  return a?.href ?? null
}

/** Modelos prontos: papel base + acessos. Ajustáveis depois, caixa por caixa. */
export const MODELOS: { chave: string; rotulo: string; papel: string; acessos: Acessos }[] = [
  { chave: 'garcom', rotulo: 'Garçom', papel: 'garcom', acessos: { areas: ['mesas'], sensiveis: [] } },
  { chave: 'caixa', rotulo: 'Caixa', papel: 'atendente', acessos: { areas: ['pedidos', 'pdv', 'mesas', 'clientes'], sensiveis: ['desconto', 'taxa', 'fechar_caixa'] } },
  // A tela de preparo é o link da estação (sem login); no painel, a cozinha acompanha o Kanban.
  { chave: 'cozinha', rotulo: 'Cozinha', papel: 'atendente', acessos: { areas: ['pedidos'], sensiveis: [] } },
  { chave: 'entregador', rotulo: 'Entregador / Logística', papel: 'logistica', acessos: { areas: ['pedidos', 'logistica'], sensiveis: ['fechar_caixa'] } },
  { chave: 'gerente', rotulo: 'Gerente', papel: 'gerente', acessos: { areas: AREAS.map((a) => a.chave).filter((a) => a !== 'equipe'), sensiveis: SENSIVEIS.map((s) => s.chave) } },
]

/** Resumo curto para a lista da Equipe ("Garçom + PDV"). */
export function resumoAcessos(papel: string, acessos: Acessos | null): string {
  if (papel === 'dono') return 'Acesso total (dono)'
  if (!acessos) return 'Padrão do papel'
  const modelo = MODELOS.find((m) => m.papel === papel && m.acessos.areas.length === acessos.areas.length && m.acessos.areas.every((a) => acessos.areas.includes(a)) && m.acessos.sensiveis.length === acessos.sensiveis.length && m.acessos.sensiveis.every((s) => acessos.sensiveis.includes(s)))
  if (modelo) return modelo.rotulo
  const base = MODELOS.find((m) => m.papel === papel)
  if (base) {
    const extras = acessos.areas.filter((a) => !base.acessos.areas.includes(a)).map((a) => AREAS.find((x) => x.chave === a)!.rotulo)
    const menos = base.acessos.areas.filter((a) => !acessos.areas.includes(a)).length
    if (extras.length && !menos) return `${base.rotulo} + ${extras.join(', ')}`
  }
  if (!acessos.areas.length) return 'Sem acesso a telas'
  return acessos.areas.map((a) => AREAS.find((x) => x.chave === a)!.rotulo).join(', ')
}

/**
 * Ação sensível que a requisição faz (o middleware confere contra os acessos). Lê método,
 * caminho e o `acao` do corpo JSON das rotas do salão/PDV. Null = nada sensível.
 */
export function sensivelDaRequisicao(metodo: string, pathname: string, corpo: unknown): Sensivel | null {
  if (metodo !== 'POST' && metodo !== 'PATCH' && metodo !== 'PUT') return null
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>
  if (/^\/api\/admin\/(pedidos|pdv\/pedido)\/[^/]+\/cancelar\/?$/.test(pathname) || pathname === '/api/admin/nexta/cancelar') return 'cancelar_pedido'
  if (/^\/api\/admin\/(comandas\/[^/]+|mesas\/[^/]+\/conta)\/?$/.test(pathname)) {
    const acao = String(c.acao ?? '')
    if (['cancelar_conta', 'cancelar_comanda', 'cancelar_pedido', 'cancelar_item', 'decidir_cancelamento'].includes(acao)) return 'cancelar_pedido'
    if (acao === 'aplicar_cupom') return 'desconto'
    if (acao === 'ajustar_valores' && (Number(c.descontoValor) > 0 || Number(c.descontoPercentual) > 0)) return 'desconto'
  }
  // Taxas da conta (serviço, couvert, outras — 0124) e a taxa extra (0106).
  if (/^\/api\/admin\/(comandas\/[^/]+|mesas\/[^/]+\/conta)\/?$/.test(pathname) && (c.acao === 'taxas' || c.acao === 'taxa_extra')) return 'taxa'
  if (/^\/api\/admin\/caixa\/?$/.test(pathname) && (c.acao === 'fechar' || c.acao === 'acertar')) return 'fechar_caixa'
  if (/^\/api\/admin\/campanhas(\/[^/]+)?\/?$/.test(pathname) && (c.disparar === true || !!c.agendadoEm)) return 'disparar_campanhas'
  // Notificações push do app (0127): enviar avulsa (agora ou agendada) e o teste também disparam.
  if (metodo === 'POST' && /^\/api\/admin\/campanhas\/push\/(avulsas|teste)\/?$/.test(pathname)) return 'disparar_campanhas'
  return null
}

/** Dashboard mostra faturamento: além da área, exige "ver valores/relatórios financeiros". */
export function caminhoPermitidoCompleto(pathname: string, papel: string | null, acessos: Acessos | null): boolean {
  if (!caminhoPermitido(pathname, papel, acessos)) return false
  if (papel !== 'dono' && acessos && areaDoCaminho(pathname) === 'dashboard') return acessos.sensiveis.includes('financeiro')
  return true
}
