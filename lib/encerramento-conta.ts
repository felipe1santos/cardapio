/**
 * Resumo mostrado depois de fechar ou cancelar uma conta (mesa ou balcão): quanto era,
 * quanto entrou, quanto ficou faltando, o que ficou pendente ou foi cancelado, o motivo,
 * quem fez e quando. Regra pura — a tela só desenha.
 *
 * No cancelamento os valores vêm da conta ANTES da ação: depois de cancelada o banco
 * zera o total (os lançamentos caem), e o resumo precisa mostrar o que foi derrubado.
 */

export interface ContaParaResumo {
  status: string
  totais: { total: number; pago: number; restante: number }
  pedidos: { status: string }[]
  fechadaEm?: string | null
  fechadaPorNome?: string | null
  canceladaEm?: string | null
  canceladaPorNome?: string | null
  canceladaMotivo?: string | null
  /** Taxa manual só desta conta (0106). */
  taxaExtra?: { nome: string; valor: number } | null
}

export interface ResumoEncerramento {
  acao: 'fechada' | 'cancelada'
  total: number
  pago: number
  faltaPagar: number
  /** Pedidos que ainda estavam na cozinha/entrega quando a conta foi encerrada. */
  pendentes: number
  cancelados: number
  motivo: string | null
  usuario: string | null
  horario: string | null
  /** Taxa manual que entrou no total (0106). Ausente quando a conta não tem. */
  taxaExtra?: { nome: string; valor: number }
}

const PENDENTES = new Set(['recebido', 'preparando', 'pronto', 'em_rota'])
const r2 = (v: number) => Math.round(v * 100) / 100

export function montarResumoEncerramento(
  acao: 'fechada' | 'cancelada',
  antes: ContaParaResumo,
  depois: ContaParaResumo | null,
  fallback: { usuario?: string | null; motivo?: string | null; horario?: string } = {},
): ResumoEncerramento {
  const base = acao === 'cancelada' ? antes : depois ?? antes
  const final = depois ?? antes
  return {
    acao,
    total: r2(base.totais.total),
    pago: r2(base.totais.pago),
    faltaPagar: r2(Math.max(0, base.totais.total - base.totais.pago)),
    pendentes: antes.pedidos.filter((p) => PENDENTES.has(p.status)).length,
    cancelados: final.pedidos.filter((p) => p.status === 'cancelado').length,
    motivo: (acao === 'cancelada' ? final.canceladaMotivo : null) ?? fallback.motivo ?? null,
    usuario: (acao === 'cancelada' ? final.canceladaPorNome : final.fechadaPorNome) ?? fallback.usuario ?? null,
    horario: (acao === 'cancelada' ? final.canceladaEm : final.fechadaEm) ?? fallback.horario ?? null,
    ...(base.taxaExtra && base.taxaExtra.valor > 0 ? { taxaExtra: { nome: base.taxaExtra.nome, valor: r2(base.taxaExtra.valor) } } : {}),
  }
}
