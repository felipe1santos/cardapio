/**
 * Mensagens automáticas de status do pedido no WhatsApp (0129, repaginação 2026-10).
 *
 * `restaurantes.mensagens_status` NULO = exatamente o que já saía: todas as etapas, para
 * todos os tipos de pedido, com os textos padrão de lib/whatsapp.ts. A loja pode desligar
 * tudo, um tipo de pedido ou uma etapa, e trocar o texto de uma etapa. O texto padrão nunca
 * é reescrito por aqui — sem texto próprio, quem monta a mensagem continua sendo a função
 * original (montarMensagemStatus / montarResumoPedido).
 */

export const ETAPAS = ['recebido', 'agendado', 'aceito', 'pronto_retirada', 'pronto_entrega', 'em_rota', 'entregue'] as const
export type Etapa = (typeof ETAPAS)[number]

export type TipoAutomatico = 'entrega' | 'retirada' | 'local'

export interface ConfigEtapa { ativo?: boolean; texto?: string | null }
export interface ConfigMensagens {
  ativo?: boolean
  tipos?: Partial<Record<TipoAutomatico, boolean>>
  etapas?: Partial<Record<Etapa, ConfigEtapa>>
}

export const INFO_ETAPA: Record<Etapa, { titulo: string; quando: string; personalizavel: boolean }> = {
  recebido: { titulo: 'Pedido recebido', quando: 'Assim que o pedido chega na loja.', personalizavel: true },
  agendado: { titulo: 'Pedido agendado recebido', quando: 'Quando o cliente agenda o pedido para outro horário.', personalizavel: true },
  aceito: { titulo: 'Pedido aceito (resumo)', quando: 'Quando a loja aceita: vai o resumo completo com itens, total e pagamento.', personalizavel: false },
  pronto_retirada: { titulo: 'Pronto para retirada', quando: 'Pedido de retirada marcado como pronto.', personalizavel: true },
  pronto_entrega: { titulo: 'Pronto (entrega)', quando: 'Pedido de entrega marcado como pronto, antes de sair.', personalizavel: true },
  em_rota: { titulo: 'Saiu para entrega', quando: 'Quando o entregador sai com o pedido.', personalizavel: true },
  entregue: { titulo: 'Pedido entregue', quando: 'Quando o pedido é marcado como entregue.', personalizavel: true },
}

/** Textos padrão em forma de modelo — renderizados dão exatamente o texto de lib/whatsapp.ts. */
export const PADRAO: Record<Exclude<Etapa, 'aceito'>, string> = {
  recebido: '📥 Recebemos seu pedido *#{numero}*! Aguarde a confirmação da loja 🙌',
  agendado: '🗓️ Recebemos seu pedido agendado *#{numero}* para *{horario}* ({tipo}). A loja começa a preparar perto do horário 🙌',
  pronto_retirada: '✅ Seu pedido *#{numero}* está *pronto* para retirada!',
  pronto_entrega: '✅ Seu pedido *#{numero}* está *pronto* e logo sairá para entrega!',
  em_rota: '🛵 Seu pedido *#{numero}* *saiu para entrega*! Chega rapidinho 🚀',
  entregue: '🎉 Pedido *#{numero}* entregue! Bom apetite 😋',
}

export const VARIAVEIS: { chave: string; rotulo: string; exemplo: string }[] = [
  { chave: 'nome', rotulo: 'Primeiro nome do cliente', exemplo: 'Maria' },
  { chave: 'numero', rotulo: 'Número do pedido', exemplo: '1234' },
  { chave: 'loja', rotulo: 'Nome da loja', exemplo: 'Sua loja' },
  { chave: 'tipo', rotulo: 'entrega ou retirada', exemplo: 'entrega' },
  { chave: 'horario', rotulo: 'Horário agendado (só no agendado)', exemplo: 'hoje às 19:30' },
]

const CHAVES = new Set(VARIAVEIS.map((v) => v.chave))
const MAX_TEXTO = 1000

/** Lê/limpa o que vem do banco ou da tela. Inválido = null (padrão). */
export function normalizarConfig(bruto: unknown): ConfigMensagens | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null
  const b = bruto as Record<string, unknown>
  const cfg: ConfigMensagens = {}
  if (typeof b.ativo === 'boolean') cfg.ativo = b.ativo
  if (b.tipos && typeof b.tipos === 'object') {
    const t = b.tipos as Record<string, unknown>
    cfg.tipos = {}
    for (const k of ['entrega', 'retirada', 'local'] as const) if (typeof t[k] === 'boolean') cfg.tipos[k] = t[k] as boolean
  }
  if (b.etapas && typeof b.etapas === 'object') {
    const e = b.etapas as Record<string, unknown>
    cfg.etapas = {}
    for (const k of ETAPAS) {
      const v = e[k]
      if (!v || typeof v !== 'object') continue
      const ve = v as Record<string, unknown>
      const c: ConfigEtapa = {}
      if (typeof ve.ativo === 'boolean') c.ativo = ve.ativo
      if (typeof ve.texto === 'string' && ve.texto.trim() && INFO_ETAPA[k].personalizavel) c.texto = ve.texto.slice(0, MAX_TEXTO)
      cfg.etapas[k] = c
    }
  }
  return cfg
}

/** Problema no texto (variável desconhecida, vazio, longo). Null = ok. */
export function problemaNoTexto(texto: string): string | null {
  if (!texto.trim()) return 'A mensagem não pode ficar vazia.'
  if (texto.length > MAX_TEXTO) return `A mensagem passa de ${MAX_TEXTO} caracteres.`
  const desconhecidas = [...texto.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((v) => !CHAVES.has(v))
  if (desconhecidas.length) return `Variável desconhecida: {${desconhecidas[0]}}. Use ${VARIAVEIS.map((v) => `{${v.chave}}`).join(', ')}.`
  return null
}

export function renderizar(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{(nome|numero|loja|tipo|horario)\}/g, (_, k: string) => vars[k] ?? '')
}

/** Etapa da mensagem para a transição de status. Null = nenhuma mensagem nessa transição. */
export function etapaDoStatus(status: string, tipo: string, agendado: boolean): Etapa | null {
  if (status === 'recebido') return agendado ? 'agendado' : 'recebido'
  if (status === 'preparando') return 'aceito'
  if (status === 'pronto') return tipo === 'retirada' ? 'pronto_retirada' : 'pronto_entrega'
  if (status === 'em_rota') return 'em_rota'
  if (status === 'entregue') return 'entregue'
  return null
}

export function tipoAutomatico(canal: string, tipo: string): TipoAutomatico {
  if (canal === 'mesa' || canal === 'balcao') return 'local'
  return tipo === 'retirada' ? 'retirada' : 'entrega'
}

/**
 * Decide se a etapa sai e com qual texto próprio. `{ sai: false }` = desligada;
 * `{ sai: true, texto: null }` = sai com o texto padrão (função original).
 */
export function decidirMensagem(cfg: ConfigMensagens | null, etapa: Etapa, tipo: TipoAutomatico): { sai: boolean; texto: string | null } {
  if (!cfg) return { sai: true, texto: null }
  if (cfg.ativo === false) return { sai: false, texto: null }
  if (cfg.tipos?.[tipo] === false) return { sai: false, texto: null }
  const e = cfg.etapas?.[etapa]
  if (e?.ativo === false) return { sai: false, texto: null }
  return { sai: true, texto: INFO_ETAPA[etapa].personalizavel && e?.texto?.trim() ? e.texto : null }
}

/** Estado efetivo para a tela (com os padrões preenchidos). */
export function configEfetiva(cfg: ConfigMensagens | null) {
  return {
    ativo: cfg?.ativo !== false,
    tipos: { entrega: cfg?.tipos?.entrega !== false, retirada: cfg?.tipos?.retirada !== false, local: cfg?.tipos?.local !== false },
    etapas: Object.fromEntries(ETAPAS.map((k) => [k, { ativo: cfg?.etapas?.[k]?.ativo !== false, texto: cfg?.etapas?.[k]?.texto ?? null }])) as Record<Etapa, { ativo: boolean; texto: string | null }>,
  }
}
