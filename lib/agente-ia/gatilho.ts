/**
 * Agente de IA — QUANDO a IA entra (puro; decisões D25–D27 em docs/robo-whatsapp/autoatendimento-decisoes.md).
 * O robô padrão vem SEMPRE primeiro: a IA só é chamada se a loja tem o módulo + interruptor (quem chama confere) e:
 *   a) o robô não entendeu; b) o cliente quer pedir pela conversa (palavras de pedido ou nome de item do cardápio);
 *   c) mandou foto; d) a conversa já está em "modo IA".
 * Fora do modo IA, atendente, reclamação, parar e voltar são do robô. EM modo IA, só o pedido EXPLÍCITO de atendente
 * ("atendente", "humano", "falar com…", "0") e parar/voltar vão ao robô: "cancela a coca" e "o endereço tá errado" são
 * da conversa do pedido (a IA chama o atendente se for reclamação de verdade).
 */
import type { Intencao } from '@/lib/robo-auto/classificador'
import { normalizarNomeItem } from './cardapio'
import type { TipoMensagem } from '@/lib/mensageria/provedor'

export type RotaMensagem = 'robo' | 'ia' | 'audio_ia'

/** Modo IA vale até 30 min sem mensagem do cliente (D26). */
export const MODO_IA_SEM_MENSAGEM_MS = 30 * 60_000
/** No máximo 25 respostas da IA por conversa; depois manda o link e devolve ao robô (D26). */
export const MAX_RESPOSTAS_IA = 25

const SO_DO_ROBO: Intencao[] = ['atendente', 'reclamacao', 'parar', 'voltar', 'resumo_pedido']

const ATENDENTE_EXPLICITO = /(^0$)|\b(atendente|humano|pessoa|alguem|gerente|dono|responsavel|falar com|me atende|me liga)\b/

export function rotaDaMensagem(p: {
  intencao: Intencao; tipo: TipoMensagem; emModoIa: boolean; itemCitado: boolean; normalizado?: string
  /** Cliente disse que não consegue/não quer usar o link ou que quer "por aqui mesmo". */
  pedidoSemLink?: boolean
  /** O robô já mandou o link para quem queria pedir (estado pedir_link, 15 min). */
  jaMandouLink?: boolean
}): RotaMensagem {
  if (p.emModoIa && p.tipo === 'texto') {
    // O resumo que a vitrine manda depois do pedido é sempre do robô (confirma o pedido, sem custo; 16/10).
    if (p.intencao === 'parar' || p.intencao === 'voltar' || p.intencao === 'resumo_pedido') return 'robo'
    if (p.intencao === 'atendente' && ATENDENTE_EXPLICITO.test(p.normalizado ?? '')) return 'robo'
    return 'ia'
  }
  if (p.tipo === 'texto' && SO_DO_ROBO.includes(p.intencao)) return 'robo'
  if (p.emModoIa) {
    if (p.tipo === 'texto' || p.tipo === 'imagem') return 'ia'
    if (p.tipo === 'audio') return 'audio_ia'
    return 'robo'
  }
  if (p.tipo === 'imagem') return 'ia'
  if (p.tipo !== 'texto') return 'robo'
  // 12/10: quer pedir SEM citar item → 1ª vez o robô insiste no link (sem custo); insistiu ou não consegue usar o link → IA.
  if (p.intencao === 'pedir') return p.itemCitado || p.pedidoSemLink || p.jaMandouLink ? 'ia' : 'robo'
  if (p.intencao === 'outro') return 'ia'
  // Item do cardápio citado + entrega/pagamento = pedido numa frase só ("1 x-tudo, entrega na rua X, cartão"; teste real
  // 12/10). Status, horário e endereço da loja continuam com o robô.
  if (p.itemCitado && ['cardapio', 'saudacao', 'ok', 'entrega', 'pagamento_pix', 'pix_chave'].includes(p.intencao)) return 'ia'
  return 'robo'
}

/**
 * Depois do pedido criado pela IA, tudo sobre ele ("é cartão, tô sem pix", "quero cancelar") continua com ela por 30 min,
 * ou até o pedido ser entregue/cancelado (teste do Felipe, #287: o robô assumiu e leu a forma de pagamento como bairro).
 */
export const POS_PEDIDO_MS = 30 * 60_000

/** Pedido encerrado (entregue ou cancelado). Pix expirado não encerra: a IA oferece gerar outro ou pagar na entrega. */
export function pedidoFinalizado(p: { status: string; cancelado_motivo: string | null }): boolean {
  return p.status === 'entregue' || (p.status === 'cancelado' && p.cancelado_motivo !== 'pix_expirado')
}

/** A conversa continua em modo IA? (entrou, não passou de 30 min sem o cliente falar e não estourou 25 respostas) */
export function modoIaAtivo(
  c: { iaDesde: string | null; iaRespostas: number; iaPedidoEm?: string | null; iaPedidoFinalizado?: boolean; pedidoEmAndamento?: boolean },
  ultimaDoClienteAntes: string | null, agora: Date,
): boolean {
  if (c.iaPedidoEm && !c.iaPedidoFinalizado && agora.getTime() - Date.parse(c.iaPedidoEm) < POS_PEDIDO_MS) return true
  if (!c.iaDesde || c.iaRespostas >= MAX_RESPOSTAS_IA) return false
  // Pedido em andamento (rascunho válido, até 2 h): quem pediu pelo WhatsApp termina pelo WhatsApp (14/10).
  if (c.pedidoEmAndamento) return true
  const ref = ultimaDoClienteAntes && Date.parse(ultimaDoClienteAntes) > Date.parse(c.iaDesde) ? ultimaDoClienteAntes : c.iaDesde
  return agora.getTime() - Date.parse(ref) < MODO_IA_SEM_MENSAGEM_MS
}

export interface NomeItem { id: string; palavras: string[] }

/** Nomes do cardápio já normalizados (só disponíveis ou não; a ferramenta diz se pode pedir). Nome curto demais fica de fora. */
export function nomesDoCardapio(itens: { id: string; nome: string }[]): NomeItem[] {
  return itens
    .map((i) => ({ id: i.id, palavras: normalizarNomeItem(i.nome).split(' ').filter(Boolean) }))
    .filter((i) => i.palavras.length > 1 || (i.palavras[0]?.length ?? 0) >= 4)
}

/** Mesma palavra com até 1 letra trocada, a mais ou a menos (palavras de 5+ letras). */
export function parecida(a: string, b: string): boolean {
  if (a === b) return true
  if (b.length < 5 || Math.abs(a.length - b.length) > 1) return false
  let dif = 0
  for (let i = 0, j = 0; i < a.length || j < b.length; ) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++dif > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return true
}

/** A mensagem cita algum item do cardápio da loja? Tolera acento, hífen e 1 letra trocada em palavra de 5+ letras. */
export function itemCitado(texto: string, nomes: NomeItem[]): boolean {
  const palavras = normalizarNomeItem(texto).split(' ').filter(Boolean)
  if (!palavras.length) return false
  return nomes.some(({ palavras: n }) => {
    for (let i = 0; i + n.length <= palavras.length; i++) if (n.every((w, k) => parecida(palavras[i + k], w))) return true
    return false
  })
}
