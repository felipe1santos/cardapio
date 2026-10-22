/**
 * Formas de pagamento aceitas por canal (0217, 21/10/2026) — fonte única no Perfil para vitrine, servidor, robô e
 * Agente de IA. Regras puras (testadas). `restaurantes.formas_pagamento` NULO = como sempre foi (padrão legado):
 * Pix online e cartão online quando conectados, Pix pela chave só sem o Pix online, cartão na entrega e dinheiro.
 * A Mesa fica em `formas_pagamento_mesa` (0067, valores de lib/conta.ts) — aqui só a entrega e a retirada.
 */
export const OPCOES_PAGAMENTO = ['pix_online', 'pix', 'cartao_online', 'credito', 'debito', 'dinheiro', 'vale'] as const
export type OpcaoPagamento = (typeof OPCOES_PAGAMENTO)[number]
export type CanalPagamento = 'entrega' | 'retirada'

export const ROTULO_OPCAO: Record<OpcaoPagamento, string> = {
  pix_online: 'Pix online',
  pix: 'Pix pela chave',
  cartao_online: 'Cartão online',
  credito: 'Cartão de crédito na entrega',
  debito: 'Cartão de débito na entrega',
  dinheiro: 'Dinheiro (com troco)',
  vale: 'Vale-refeição / alimentação',
}

export const BANDEIRAS_VALE = ['Alelo', 'Pluxee (Sodexo)', 'VR', 'Ticket', 'Ben', 'Caju', 'Flash'] as const

export interface ConfigFormas { entrega: OpcaoPagamento[]; retirada: OpcaoPagamento[]; vale_bandeiras: string[] }
/** O que a loja tem conectado agora (Mercado Pago). */
export interface Conectados { pixOnline: boolean; cartaoOnline: boolean }

const ehOpcao = (v: unknown): v is OpcaoPagamento => typeof v === 'string' && (OPCOES_PAGAMENTO as readonly string[]).includes(v)
const ordenar = (l: OpcaoPagamento[]) => OPCOES_PAGAMENTO.filter((o) => l.includes(o))

/** Lê a coluna; qualquer coisa inválida vira NULO (padrão legado), nunca "nenhuma forma". */
export function lerFormas(raw: unknown): ConfigFormas | null {
  const v = raw as Partial<Record<keyof ConfigFormas, unknown>> | null
  if (!v || typeof v !== 'object' || !Array.isArray(v.entrega) || !Array.isArray(v.retirada)) return null
  const entrega = ordenar(v.entrega.filter(ehOpcao))
  const retirada = ordenar(v.retirada.filter(ehOpcao))
  if (!entrega.length && !retirada.length) return null
  const vale_bandeiras = Array.isArray(v.vale_bandeiras) ? [...new Set(v.vale_bandeiras.filter((b): b is string => typeof b === 'string').map((b) => b.trim().slice(0, 40)).filter(Boolean))] : []
  return { entrega, retirada, vale_bandeiras }
}

/** Padrão legado (coluna nula): exatamente o que a vitrine mostrava antes da 0217. */
export function formasPadrao(c: Conectados): OpcaoPagamento[] {
  return ordenar([...(c.pixOnline ? ['pix_online' as const] : ['pix' as const]), ...(c.cartaoOnline ? ['cartao_online' as const] : []), 'credito', 'debito', 'dinheiro'])
}

/** Config da tela do Perfil (coluna nula → o legado marcado, com o online que estiver conectado). */
export function configParaTela(cfg: ConfigFormas | null, c: Conectados): ConfigFormas {
  if (cfg) return cfg
  const p = formasPadrao(c)
  return { entrega: p, retirada: p, vale_bandeiras: [] }
}

/** O que o cliente pode escolher AGORA neste canal (online some quando a conta do MP não está conectada). */
export function formasDoCanal(cfg: ConfigFormas | null, canal: CanalPagamento, c: Conectados): OpcaoPagamento[] {
  if (!cfg) return formasPadrao(c)
  return cfg[canal].filter((o) => (o === 'pix_online' ? c.pixOnline : o === 'cartao_online' ? c.cartaoOnline : o === 'vale' ? cfg.vale_bandeiras.length > 0 : true))
}

/** Erros da tela antes de salvar (vazio = pode salvar). */
export function errosConfig(cfg: ConfigFormas, mesa: string[] | null): string[] {
  const e: string[] = []
  if (!cfg.entrega.length) e.push('Marque ao menos uma forma para a Entrega.')
  if (!cfg.retirada.length) e.push('Marque ao menos uma forma para a Retirada.')
  if (mesa && !mesa.length) e.push('Marque ao menos uma forma para a Mesa.')
  if ((cfg.entrega.includes('vale') || cfg.retirada.includes('vale')) && !cfg.vale_bandeiras.length) e.push('Escolha as bandeiras de vale aceitas.')
  return e
}

/** "Somente pagamento online": entrega e retirada só com o que está conectado no Mercado Pago. */
export function somenteOnline(cfg: ConfigFormas, c: Conectados): ConfigFormas {
  const on = ordenar([...(c.pixOnline ? ['pix_online' as const] : []), ...(c.cartaoOnline ? ['cartao_online' as const] : [])])
  return { ...cfg, entrega: on, retirada: on }
}

/** Pedido que chega (vitrine, IA): a forma escolhida é aceita neste canal? */
export function opcaoDoPedido(p: { pagamento: string; pixOnline?: boolean; cartaoOnline?: boolean; cartaoTipo?: string | null }): OpcaoPagamento[] {
  if (p.pagamento === 'pix') return [p.pixOnline ? 'pix_online' : 'pix']
  if (p.pagamento === 'cartao') return p.cartaoOnline ? ['cartao_online'] : p.cartaoTipo === 'credito' ? ['credito'] : p.cartaoTipo === 'debito' ? ['debito'] : ['credito', 'debito']
  if (p.pagamento === 'dinheiro') return ['dinheiro']
  if (p.pagamento === 'vale') return ['vale']
  return []
}

export function pedidoAceito(cfg: ConfigFormas | null, canal: CanalPagamento, p: { pagamento: string; pixOnline?: boolean; cartaoOnline?: boolean; cartaoTipo?: string | null; valeBandeira?: string | null }): boolean {
  if (!cfg) return true // legado: o servidor nunca filtrou (Pix online/cartão online seguem com a checagem própria)
  const aceitas = cfg[canal]
  if (!opcaoDoPedido(p).some((o) => aceitas.includes(o))) return false
  if (p.pagamento === 'vale') return !!p.valeBandeira && cfg.vale_bandeiras.includes(p.valeBandeira)
  return true
}

/** "VR · Alelo" (Kanban, comanda e resumo). */
export function rotuloVale(bandeira: string | null | undefined): string {
  return bandeira ? `VR · ${bandeira}` : 'Vale-refeição'
}

/** Texto curto das formas aceitas (robô e Agente de IA): "Pix, cartão de crédito ou débito na entrega, dinheiro…". */
export function textoFormas(lista: OpcaoPagamento[], bandeiras: string[], canal: CanalPagamento | 'ambos' = 'ambos'): string[] {
  const onde = canal === 'retirada' ? 'na retirada' : canal === 'entrega' ? 'na entrega' : 'na entrega/retirada'
  const f: string[] = []
  if (lista.includes('pix_online')) f.push('Pix (pelo cardápio, na hora do pedido)')
  if (lista.includes('pix')) f.push('Pix')
  if (lista.includes('cartao_online')) f.push('Cartão online (pelo cardápio)')
  const cred = lista.includes('credito'), deb = lista.includes('debito')
  if (cred || deb) f.push(`Cartão de ${cred && deb ? 'crédito ou débito' : cred ? 'crédito' : 'débito'} (${onde})`)
  if (lista.includes('dinheiro')) f.push('Dinheiro (com troco, se precisar)')
  if (lista.includes('vale') && bandeiras.length) f.push(`Vale-refeição/alimentação: ${bandeiras.join(', ')}`)
  return f
}

/** Formas que a conversa (robô e Agente de IA) pode fechar num canal — o vocabulário do pedido (pix/dinheiro/cartao/vale). */
export type FormaConversa = 'pix' | 'dinheiro' | 'cartao' | 'vale'
export function formasConversa(cfg: ConfigFormas | null, canal: CanalPagamento, l: { pixOnline: boolean; pixChave: boolean }): FormaConversa[] {
  if (!cfg) return [...(l.pixChave || l.pixOnline ? ['pix' as const] : []), 'dinheiro', 'cartao']
  const f = formasDoCanal(cfg, canal, { pixOnline: l.pixOnline, cartaoOnline: false })
  const out: FormaConversa[] = []
  if (f.includes('pix_online') || (f.includes('pix') && l.pixChave)) out.push('pix')
  if (f.includes('dinheiro')) out.push('dinheiro')
  if (f.includes('credito') || f.includes('debito')) out.push('cartao')
  if (f.includes('vale')) out.push('vale')
  return out
}
