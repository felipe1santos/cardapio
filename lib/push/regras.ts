/**
 * Regras das notificações push (2026-10-01) — funções PURAS, sem banco nem relógio próprio
 * (quem chama passa o "agora"), para os testes cobrirem cada caso.
 *
 * Marketing (automações a–g e avulsas) só sai: na janela da loja (aberta, ou até N min antes de
 * abrir) e nunca de madrugada; dentro do limite por cliente; uma por avaliação (a de maior
 * prioridade); sem repetir a mesma chave; e só nas categorias que o cliente deixou ligadas.
 * Status do pedido é transacional: fora de janela e de limite (só respeita a categoria).
 */

export type TipoAutomacao =
  | 'loja_abriu' | 'recompra' | 'inativo' | 'item_novo' | 'cupom_novo' | 'frete_gratis' | 'fidelidade' | 'status_pedido'
export type CategoriaPush = 'pedido' | 'promocoes' | 'novidades' | 'fidelidade'

export const CATEGORIAS: { id: CategoriaPush; rotulo: string }[] = [
  { id: 'pedido', rotulo: 'Status do pedido' },
  { id: 'promocoes', rotulo: 'Promoções e cupons' },
  { id: 'novidades', rotulo: 'Novidades do cardápio' },
  { id: 'fidelidade', rotulo: 'Fidelidade' },
]

export const CATEGORIA_DO_TIPO: Record<TipoAutomacao, CategoriaPush> = {
  loja_abriu: 'promocoes',
  recompra: 'promocoes',
  inativo: 'promocoes',
  item_novo: 'novidades',
  cupom_novo: 'promocoes',
  frete_gratis: 'promocoes',
  fidelidade: 'fidelidade',
  status_pedido: 'pedido',
}

/** Quanto MENOR, mais importante. Várias regras no mesmo cliente → só a primeira sai. */
export const PRIORIDADE: Record<Exclude<TipoAutomacao, 'status_pedido'>, number> = {
  cupom_novo: 1,
  fidelidade: 2,
  loja_abriu: 3,
  frete_gratis: 4,
  item_novo: 5,
  recompra: 6,
  inativo: 7,
}

/** Teto do sistema: a loja escolhe abaixo disso. */
export const TETO_DIA = 3
export const TETO_SEMANA = 10
/** Madrugada: nenhum marketing de 00:00 a 07:59 (horário de Brasília), mesmo com a loja aberta. */
export const INICIO_PERMITIDO = '08:00'

export interface JanelaLoja {
  aberta: boolean
  /** Minutos até a próxima abertura HOJE (null = não abre mais hoje / sem grade). */
  minutosParaAbrir: number | null
  /** "HH:MM" agora, em São Paulo. */
  horaAgora: string
}

/** Pode mandar marketing agora? */
export function podeMarketingAgora(j: JanelaLoja, antecedenciaMin: number): boolean {
  if (j.horaAgora < INICIO_PERMITIDO) return false
  if (j.aberta) return true
  return j.minutosParaAbrir !== null && j.minutosParaAbrir >= 0 && j.minutosParaAbrir <= Math.max(0, antecedenciaMin)
}

/** Minutos entre duas horas "HH:MM" do mesmo dia (b − a). */
export function minutosEntre(a: string, b: string): number {
  const m = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
  return m(b) - m(a)
}

export interface LimitesLoja { limiteDia: number; limiteSemana: number }

/** Limites efetivos: o da loja, preso ao teto do sistema. */
export function limitesEfetivos(l: LimitesLoja): LimitesLoja {
  return {
    limiteDia: Math.max(0, Math.min(TETO_DIA, Math.floor(l.limiteDia))),
    limiteSemana: Math.max(0, Math.min(TETO_SEMANA, Math.floor(l.limiteSemana))),
  }
}

/**
 * Cabe mais um marketing para este cliente? `enviadosEm` = instantes (ms) dos marketings já
 * enviados/na fila para ele (um por notificação, não por aparelho).
 */
export function dentroDoLimite(enviadosEm: number[], agora: number, limites: LimitesLoja): boolean {
  const l = limitesEfetivos(limites)
  const dia = enviadosEm.filter((t) => agora - t < 24 * 3600_000).length
  const semana = enviadosEm.filter((t) => agora - t < 7 * 24 * 3600_000).length
  return dia < l.limiteDia && semana < l.limiteSemana
}

export interface Candidato {
  tipo: Exclude<TipoAutomacao, 'status_pedido'>
  chave: string
  /** Variáveis do texto ({produto}, {cupom}, {desconto}…). */
  vars?: Record<string, string>
  /** Link de destino dentro da loja (sem domínio), ex. "?item=<id>". */
  link?: string
  imagem?: string | null
}

/**
 * Escolhe o que sai para UM cliente nesta avaliação: tira o que já foi (chave repetida) e o que
 * está em categoria desligada; fica com o de maior prioridade. `null` = nada a mandar.
 */
export function escolherCandidato(candidatos: Candidato[], chavesJaUsadas: Set<string>, categoriasDoCliente: string[]): Candidato | null {
  const validos = candidatos
    .filter((c) => !chavesJaUsadas.has(c.chave))
    .filter((c) => categoriasDoCliente.includes(CATEGORIA_DO_TIPO[c.tipo]))
    .sort((a, b) => PRIORIDADE[a.tipo] - PRIORIDADE[b.tipo])
  return validos[0] ?? null
}

// ── gatilhos (datas) ────────────────────────────────────────────────────────
const DIA = 24 * 3600_000

/** Recompra: cliente com exatamente 1 pedido, feito há pelo menos `dias` (e não há mais de dias+7). */
export function gatilhoRecompra(qtdPedidos: number, ultimoPedidoEm: number, agora: number, dias: number): boolean {
  if (qtdPedidos !== 1) return false
  const passou = agora - ultimoPedidoEm
  return passou >= dias * DIA && passou < (dias + 7) * DIA
}

/**
 * Inativo: último pedido há mais de `dias`. Repete a cada `repetirDias` enquanto continuar
 * inativo — a chave muda por "rodada" contada a partir do último pedido.
 */
export function gatilhoInativo(qtdPedidos: number, ultimoPedidoEm: number, agora: number, dias: number, repetirDias: number): { chave: string } | null {
  if (qtdPedidos < 1) return null
  const passou = agora - ultimoPedidoEm
  if (passou <= dias * DIA) return null
  const rodada = Math.floor((passou - dias * DIA) / (Math.max(1, repetirDias) * DIA))
  // Só manda no começo de cada rodada (até 2 dias depois): quem ficou fora do limite não recebe
  // no meio da rodada seguinte uma mensagem "atrasada".
  const dentroDaRodada = (passou - dias * DIA) % (Math.max(1, repetirDias) * DIA)
  if (dentroDaRodada > 2 * DIA) return null
  return { chave: `inativo:${ultimoPedidoEm}:${rodada}` }
}

/** Fidelidade: faltam 1 ou 2 para o prêmio (por quantidade). */
export function faltamParaPremio(meta: number | null, progresso: number): number | null {
  if (!meta || meta <= 0) return null
  const faltam = meta - progresso
  return faltam >= 1 && faltam <= 2 ? faltam : null
}

/** Bairros que passaram a ter frete grátis (estavam pagos ou não existiam antes). */
export function bairrosQueFicaramGratis(antes: string[], agora: string[]): string[] {
  const a = new Set(antes.map(normalizarBairro))
  return agora.filter((b) => !a.has(normalizarBairro(b)))
}

export function normalizarBairro(b: string): string {
  return b.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/** Destinatário para limite/dedup: telefone do cliente; sem telefone, a própria assinatura. */
export function chaveDestinatario(assinatura: { id: string; clienteTelefone: string | null }): string {
  return assinatura.clienteTelefone ? `tel:${assinatura.clienteTelefone}` : `ass:${assinatura.id}`
}
