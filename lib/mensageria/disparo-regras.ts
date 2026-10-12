/**
 * Regras do disparo de WhatsApp com segurança (12/10/2026). Puras e testadas (disparo-regras.test.ts); o banco aplica
 * as mesmas na reserva da fila (0190: janela, limite diário, intervalo, frequência).
 *
 * - Público: SÓ clientes que já fizeram pedido na loja (com telefone). Nada de lista importada nem número de fora.
 * - Janela: a loja escolhe (ex.: 17:00–19:00), sempre dentro de 09:00–21:30 (Brasília).
 * - Freio: pausa a campanha com erro > 5% ou pedidos de SAIR > 3% dos enviados (a partir de 20 envios).
 */
export const JANELA_MIN_INICIO = '09:00'
export const JANELA_MAX_FIM = '21:30'
export const FREIO_AMOSTRA_MIN = 20
export const FREIO_ERRO = 0.05
export const FREIO_SAIR = 0.03

export type FiltroPublico =
  | { tipo: 'todos' }
  | { tipo: 'recentes'; ultimos_dias?: number }
  | { tipo: 'inativos'; dias_inativo?: number }
  | { tipo: 'gastou_acima'; valor_total?: number }
  | { tipo: 'frequentes'; compras_por_semana?: number }
  | { tipo: 'dias_semana'; dias_semana?: number[] }
  | { tipo: 'valor_minimo'; valor_minimo?: number }

const DIA = 86_400_000

/** Clientes que entram no disparo. `pedidosPorTelefone` = pedidos não cancelados da loja, em ordem de data. */
export function filtrarPublico<C extends { telefone: string }>(
  clientes: C[],
  pedidosPorTelefone: Map<string, { criado_em: string; total: number }[]>,
  filtro: FiltroPublico & { [k: string]: unknown },
  agora: number,
  normalizar: (t: string) => string = (t) => t.replace(/\D/g, ''),
  diaDaSemana: (iso: string) => number = (iso) => new Date(iso).getDay(),
): C[] {
  return clientes.filter((c) => {
    const ordens = pedidosPorTelefone.get(normalizar(c.telefone)) ?? []
    if (!ordens.length) return false // nunca pediu: nunca recebe disparo
    const ultima = Date.parse(ordens[ordens.length - 1].criado_em)
    const total = ordens.reduce((s, p) => s + Number(p.total), 0)
    switch (filtro.tipo) {
      case 'todos': return true
      case 'recentes': return agora - ultima <= Number(filtro.ultimos_dias ?? 1) * DIA
      case 'inativos': return agora - ultima >= Number(filtro.dias_inativo ?? 7) * DIA
      case 'gastou_acima': return total >= Number(filtro.valor_total ?? 0)
      case 'frequentes': {
        const semanas = Math.max(1, (agora - Date.parse(ordens[0].criado_em)) / (7 * DIA))
        return ordens.length / semanas >= Number(filtro.compras_por_semana ?? 2)
      }
      case 'dias_semana': {
        const alvo = new Set(filtro.dias_semana ?? [])
        return ordens.some((p) => alvo.has(diaDaSemana(p.criado_em)))
      }
      case 'valor_minimo': return total / ordens.length >= Number(filtro.valor_minimo ?? 0)
      default: return true
    }
  })
}

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))

/** Janela escolhida pela loja, encaixada em 09:00–21:30. Pelo menos 30 minutos. */
export function janelaDoDisparo(inicio: unknown, fim: unknown): { ok: true; inicio: string; fim: string } | { ok: false; erro: string } {
  if (typeof inicio !== 'string' || typeof fim !== 'string' || !HORA.test(inicio) || !HORA.test(fim)) return { ok: false, erro: 'Escolha o horário de início e de fim do envio.' }
  const i = minutos(inicio) < minutos(JANELA_MIN_INICIO) ? JANELA_MIN_INICIO : inicio
  const f = minutos(fim) > minutos(JANELA_MAX_FIM) ? JANELA_MAX_FIM : fim
  if (minutos(f) - minutos(i) < 30) return { ok: false, erro: `A janela precisa de pelo menos 30 minutos, entre ${JANELA_MIN_INICIO} e ${JANELA_MAX_FIM}.` }
  return { ok: true, inicio: i, fim: f }
}

export type MotivoFreio = 'erro_alto' | 'sair_alto'

export function decidirFreio(n: { enviados: number; erros: number; sair: number }): MotivoFreio | null {
  const tentados = n.enviados + n.erros
  if (tentados >= FREIO_AMOSTRA_MIN && n.erros / tentados > FREIO_ERRO) return 'erro_alto'
  if (n.enviados >= FREIO_AMOSTRA_MIN && n.sair / n.enviados > FREIO_SAIR) return 'sair_alto'
  return null
}

export const ROTULO_PAUSA: Record<string, string> = {
  whatsapp_desconectado: 'WhatsApp da loja desconectado — volta sozinha quando reconectar',
  erro_alto: 'Pausada pelo freio: muitas mensagens com erro (mais de 5%)',
  sair_alto: 'Pausada pelo freio: muitos clientes pedindo para sair (mais de 3%)',
  manual: 'Pausada pela loja',
}

/** Aviso fixo da tela de disparos (texto do Felipe). */
export const AVISO_DISPAROS = 'O WhatsApp alternativo pode bloquear números que mandam mensagem para quem não quer receber. Envie só para clientes, com moderação.'
