/**
 * Regras puras do rastreio da vitrine — usadas pela rota que grava
 * (app/api/loja/[slug]/eventos) e pelo rastreador do navegador
 * (lib/vitrine-rastreio.ts). Ficam aqui para serem testadas sem rede.
 */

export const TIPOS_EVENTO = ['visita', 'visualizacao', 'sacola', 'checkout', 'pedido', 'clique'] as const
export type TipoEvento = (typeof TIPOS_EVENTO)[number]

/** O que o navegador manda, por evento. */
export interface EventoCliente {
  tipo: TipoEvento
  itemId?: string | null
  alvo?: string | null
  origem?: string | null
  /** Há quantos ms o evento aconteceu quando o lote saiu. */
  idade?: number
}

/** Linha pronta para `vitrine_eventos` (sem o restaurante_id). */
export interface EventoLinha {
  visitante_id: string
  sessao_id: string
  tipo: TipoEvento
  item_id: string | null
  alvo: string | null
  origem: string | null
  criado_em: string
}

export const MAX_EVENTOS_POR_LOTE = 50
const IDADE_MAX_MS = 15 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_ANONIMO = /^[A-Za-z0-9_-]{8,64}$/

/**
 * Deixa o rótulo de um clique apresentável e sem dado pessoal.
 *
 * O texto do botão às vezes carrega o que o cliente digitou (endereço salvo,
 * telefone, CEP). Sequências de 4+ dígitos viram "#" e o tamanho é cortado —
 * o que interessa ao dono é "qual botão", não o conteúdo dele.
 */
export function limparRotulo(bruto: string | null | undefined): string | null {
  if (!bruto) return null
  const texto = bruto
    .replace(/\s+/g, ' ')
    // Valor e contador mudam a cada sacola ("Continuar para pagamento R$ 17,40",
    // "Sacola 2"): sem tirar, o mesmo botão virava uma linha por preço no painel.
    .replace(/\+?\s*R\$\s*[\d.,]+/g, '')
    .replace(/\s\d{1,3}(?=\s|$)/g, '')
    .replace(/[+(]?\d[\d\s().-]{3,}\d/g, '#')
    .replace(/\S+@\S+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
  if (!texto || texto === '#') return null
  return texto.length > 48 ? `${texto.slice(0, 47)}…` : texto
}

/** Domínio de quem mandou o visitante; "Direto" quando não há referência de fora. */
export function origemDoReferrer(referrer: string, hostAtual: string, utmSource?: string | null): string {
  const utm = (utmSource ?? '').trim().toLowerCase()
  if (utm) return utm.slice(0, 40)
  if (!referrer) return 'Direto'
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '')
    if (!host || host === hostAtual.replace(/^www\./, '')) return 'Direto'
    return host.slice(0, 60)
  } catch {
    return 'Direto'
  }
}

/**
 * Valida o corpo inteiro do lote. Evento inválido é descartado sozinho; lote
 * sem visitante/sessão válidos é descartado todo.
 */
export function normalizarLoteEventos(corpo: unknown, agora: number): EventoLinha[] {
  if (!corpo || typeof corpo !== 'object') return []
  const { visitanteId, sessaoId, eventos } = corpo as Record<string, unknown>
  if (typeof visitanteId !== 'string' || !ID_ANONIMO.test(visitanteId)) return []
  if (typeof sessaoId !== 'string' || !ID_ANONIMO.test(sessaoId)) return []
  if (!Array.isArray(eventos)) return []

  const linhas: EventoLinha[] = []
  for (const bruto of eventos.slice(0, MAX_EVENTOS_POR_LOTE)) {
    if (!bruto || typeof bruto !== 'object') continue
    const e = bruto as Record<string, unknown>
    if (typeof e.tipo !== 'string' || !(TIPOS_EVENTO as readonly string[]).includes(e.tipo)) continue
    const tipo = e.tipo as TipoEvento
    const alvo = tipo === 'clique' ? limparRotulo(typeof e.alvo === 'string' ? e.alvo : null) : null
    if (tipo === 'clique' && !alvo) continue
    const idade = typeof e.idade === 'number' && Number.isFinite(e.idade) ? Math.min(IDADE_MAX_MS, Math.max(0, e.idade)) : 0
    linhas.push({
      visitante_id: visitanteId,
      sessao_id: sessaoId,
      tipo,
      item_id: typeof e.itemId === 'string' && UUID.test(e.itemId) ? e.itemId : null,
      alvo,
      origem: tipo === 'visita' && typeof e.origem === 'string' ? e.origem.slice(0, 60) || null : null,
      criado_em: new Date(agora - idade).toISOString(),
    })
  }
  return linhas
}
