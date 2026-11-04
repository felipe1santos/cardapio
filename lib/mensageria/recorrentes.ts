/**
 * Cards de disparo recorrente (03/11/2026) — regras puras, sem banco.
 * Desenho: docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md
 *
 * Três cards fixos por loja, sempre ligados quando `ativa`: o cron gera uma rodada por dia programado (0245).
 * Aqui mora o que a API valida e o que a tela mostra; a agenda e o público ficam no banco.
 */
import { MARCADOR_ULTIMO_ITEM, problemasDasVariaveis } from './campanhas'
import { janelaDoDisparo } from './disparo-regras'

export const TIPOS_RECORRENTES = ['recuperacao', 'nunca_compraram', 'promocoes'] as const
export type TipoRecorrente = (typeof TIPOS_RECORRENTES)[number]

export const ROTULO_RECORRENTE: Record<TipoRecorrente, { nome: string; publico: string; mensagemPadrao: string }> = {
  recuperacao: {
    nome: 'Recuperação de clientes',
    publico: 'Quem já pediu, falou com a loja no WhatsApp e está há 30 dias ou mais sem pedir.',
    mensagemPadrao: 'Oi {nome}! Sentimos sua falta na {loja} 😊 Que tal pedir de novo hoje? Dá uma olhada no cardápio: {link}',
  },
  nunca_compraram: {
    nome: 'Quem nunca comprou',
    publico: 'Quem já falou com a loja no WhatsApp, mas nunca fez um pedido.',
    mensagemPadrao: 'Oi {nome}! Aqui é da {loja}. Ainda não experimentou a gente? Veja o cardápio e faça seu primeiro pedido: {link}',
  },
  promocoes: {
    nome: 'Promoções',
    publico: 'Todo mundo que já falou com a loja no WhatsApp, comprador ou não.',
    mensagemPadrao: 'Oi {nome}! Promoção de hoje na {loja} 🔥 Confira no cardápio: {link}',
  },
}

export const IMAGENS_MAX = 5
/** O cron só pergunta "algum card venceu?" a cada 10 min (pedido do dono: menos consulta ao banco). */
export const CHECAGEM_CARDS_MS = 10 * 60_000
/** Média do intervalo de 60–150 s entre mensagens da loja (0245): quanto cabe numa janela. */
const SEGUNDOS_POR_MENSAGEM = 105

/** Está na hora de olhar os cards? Sem lembrança (deploy) olha; depois, só a cada 10 min. Pura. */
export function checagemDevida(ultimaMs: number | null, agoraMs: number, intervaloMs: number = CHECAGEM_CARDS_MS): boolean {
  return ultimaMs === null || agoraMs - ultimaMs >= intervaloMs
}

/** Intervalo da checagem: 10 min; só a suíte local (provedor simulado) encurta, como CAMPANHA_INTERVALO_MS. */
export function intervaloChecagemCards(env: Record<string, string | undefined> = process.env): number {
  if (env.WHATSAPP_PROVEDOR === 'simulado' && env.CAMPANHA_CHECAGEM_CARDS_MS !== undefined) return Math.max(0, Number(env.CAMPANHA_CHECAGEM_CARDS_MS) || 0)
  return CHECAGEM_CARDS_MS
}

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

/** Quantas pessoas cabem numa rodada: o que a janela comporta com 60–150 s por mensagem, nunca acima do teto da loja. */
export function cabemNaJanela(hora: string, janelaFim: string, limiteDia: number): number {
  if (!HORA.test(hora) || !HORA.test(janelaFim)) return 1
  const cabem = Math.floor(((minutos(janelaFim) - minutos(hora)) * 60) / SEGUNDOS_POR_MENSAGEM)
  return Math.max(1, Math.min(limiteDia, cabem))
}

/** Uma imagem do card com a mensagem dela (0246). Mensagem vazia = usa a mensagem padrão do card. */
export interface ImagemCard { url: string; mensagem: string }

/** Data de hoje em Brasília, "YYYY-MM-DD". */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

/**
 * Valida o PATCH de um card e devolve as colunas a gravar (snake_case). Só o que veio no patch entra na linha.
 * Imagens: objeto { url, mensagem } (texto antigo é aceito e convertido). "Pular hoje" não existe mais (0246).
 */
export function validarPatchRecorrente(
  tipo: TipoRecorrente,
  p: unknown,
): { ok: true; row: Record<string, unknown> } | { ok: false; erro: string } {
  if (!p || typeof p !== 'object') return { ok: false, erro: 'Nada para salvar.' }
  const patch = p as Record<string, unknown>
  const row: Record<string, unknown> = {}

  if ('ativa' in patch) {
    if (typeof patch.ativa !== 'boolean') return { ok: false, erro: 'Ligado/desligado inválido.' }
    row.ativa = patch.ativa
  }
  if ('incluirLink' in patch) {
    if (typeof patch.incluirLink !== 'boolean') return { ok: false, erro: 'Opção do link inválida.' }
    row.incluir_link = patch.incluirLink
  }
  if ('mensagem' in patch) {
    if (typeof patch.mensagem !== 'string' || patch.mensagem.length > 4096) return { ok: false, erro: 'Mensagem inválida (até 4096 caracteres).' }
    const incluirLink = typeof patch.incluirLink === 'boolean' ? patch.incluirLink : true
    const problema = problemasDasVariaveis(patch.mensagem, { incluirLink })
    if (problema) return { ok: false, erro: problema }
    if (tipo !== 'recuperacao' && patch.mensagem.includes(MARCADOR_ULTIMO_ITEM)) return { ok: false, erro: 'Esta variável só vale na Recuperação.' }
    row.mensagem = patch.mensagem
  }
  if ('imagens' in patch) {
    const lista = patch.imagens
    if (!Array.isArray(lista) || lista.length > IMAGENS_MAX) return { ok: false, erro: `Até ${IMAGENS_MAX} imagens por card.` }
    const normal: ImagemCard[] = []
    for (const item of lista) {
      const url = typeof item === 'string' ? item : (item as { url?: unknown } | null)?.url
      const mensagem = typeof item === 'string' ? '' : (item as { mensagem?: unknown } | null)?.mensagem ?? ''
      if (typeof url !== 'string' || !/^https:\/\/\S+$/.test(url) || url.length > 1000) return { ok: false, erro: 'Imagem inválida.' }
      if (typeof mensagem !== 'string' || mensagem.length > 4096) return { ok: false, erro: 'Mensagem de cada imagem: até 4096 caracteres.' }
      if (tipo !== 'recuperacao' && mensagem.includes(MARCADOR_ULTIMO_ITEM)) return { ok: false, erro: 'Esta variável só vale na Recuperação.' }
      const problemaImg = problemasDasVariaveis(mensagem, { incluirLink: typeof patch.incluirLink === 'boolean' ? patch.incluirLink : true })
      if (problemaImg) return { ok: false, erro: problemaImg }
      normal.push({ url, mensagem })
    }
    row.imagens = normal
  }
  if ('diasSemana' in patch) {
    const dias = patch.diasSemana
    if (!Array.isArray(dias) || dias.length === 0) return { ok: false, erro: 'Escolha pelo menos um dia.' }
    if (!dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return { ok: false, erro: 'Dia da semana inválido.' }
    row.dias_semana = [...new Set(dias as number[])].sort((a, b) => a - b)
  }
  if ('hora' in patch || 'janelaFim' in patch) {
    const janela = janelaDoDisparo(patch.hora ?? '17:00', patch.janelaFim ?? '19:00')
    if (!janela.ok) return { ok: false, erro: janela.erro }
    row.hora = janela.inicio
    row.janela_fim = janela.fim
  }
  if (Object.keys(row).length === 0) return { ok: false, erro: 'Nada para salvar.' }
  return { ok: true, row }
}

/**
 * Aquecimento do número (0247): limite diário dos 3 cards JUNTOS. 15 nos 5 primeiros dias contados da 1ª rodada de
 * card da loja, +5 a cada 5 dias (20, 25, 30…). O banco aplica a mesma conta em campanha_recorrente_limite_aquecimento.
 */
export function limiteAquecimento(diasDesdeInicio: number): number {
  return 15 + 5 * Math.floor(Math.max(0, diasDesdeInicio) / 5)
}

/** O que falta para o card poder ligar (a trigger 0247 recusa o mesmo). Vazio = pronto. */
export function pendenciasDoCard(c: { imagens: ImagemCard[]; mensagem: string; diasSemana: number[]; hora: string; janelaFim: string }): string[] {
  const falta: string[] = []
  if (c.imagens.length === 0) falta.push('Adicione pelo menos 1 imagem.')
  if (!c.mensagem.trim() && (c.imagens.length === 0 || c.imagens.some((i) => !i.mensagem.trim()))) falta.push('Escreva a mensagem padrão ou uma mensagem em cada imagem.')
  if (c.diasSemana.length === 0) falta.push('Escolha pelo menos um dia.')
  if (!c.hora || !c.janelaFim || c.janelaFim <= c.hora) falta.push('Ajuste o horário (o fim precisa ser depois do início).')
  return falta
}
