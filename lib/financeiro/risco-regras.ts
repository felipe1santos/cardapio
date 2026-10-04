/**
 * Relatório de risco por funcionário (Fase 6) — regras puras. Conta, por pessoa e período, cancelamentos,
 * descontos, estornos, reimpressões, divergências de caixa e ajustes, e destaca quem foge do padrão da equipe.
 *
 * "Fora do padrão" numa métrica: pelo menos MINIMO ocorrências E acima de FATOR × a mediana da equipe (pessoas
 * que tiveram algum movimento no período). Com só uma pessoa ativa, a referência é o próprio mínimo.
 * Não acusa ninguém: é um sinal para o dono olhar (a tela leva à auditoria filtrada).
 */
export const METRICAS = ['cancelamentos', 'descontos', 'estornos', 'reimpressoes', 'divergencias', 'ajustes'] as const
export type Metrica = (typeof METRICAS)[number]
export const ROTULO_METRICA: Record<Metrica, string> = {
  cancelamentos: 'Cancelamentos', descontos: 'Descontos', estornos: 'Estornos', reimpressoes: 'Reimpressões', divergencias: 'Divergências de caixa', ajustes: 'Ajustes e perdas',
}
export const MINIMO = 3
export const FATOR = 2

/** De qual métrica é cada ação da auditoria (null = não conta). */
export function metricaDaAcao(acao: string): Metrica | null {
  if (/^(conta\.cancelou_(item|pedido|comanda)|pedido\.cancelou|conta\.aprovou_cancelamento|pdv_legado\.cancelar|contas\.cancelou|compras\.cancelou)$/.test(acao)) return 'cancelamentos'
  if (acao === 'conta.desconto') return 'descontos'
  if (/^(conta\.estorno|contas\.estornou_baixa|fin\.estorno.*)$/.test(acao)) return 'estornos'
  if (/reimprim/.test(acao)) return 'reimpressoes'
  if (acao === 'caixa.perda' || acao === 'caixa.retirada' || acao === 'motoboy.baixa_pendencia' || acao === 'fin.ajuste') return 'ajustes'
  return null
}

export interface LinhaRisco { usuarioId: string | null; nome: string; papel: string | null; valores: Record<Metrica, number>; valorCentavos: Record<Metrica, number> }
export interface LinhaRiscoAvaliada extends LinhaRisco { foraDoPadrao: Metrica[]; pontos: number }

function mediana(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function avaliarRisco(linhas: LinhaRisco[]): { linhas: LinhaRiscoAvaliada[]; medianas: Record<Metrica, number> } {
  const medianas = Object.fromEntries(METRICAS.map((k) => [k, mediana(linhas.map((l) => l.valores[k]))])) as Record<Metrica, number>
  const out = linhas.map((l) => {
    const fora = METRICAS.filter((k) => l.valores[k] >= MINIMO && l.valores[k] > FATOR * medianas[k])
    // Pontos: quantas vezes acima da mediana em cada métrica fora do padrão (ordena a lista).
    const pontos = fora.reduce((s, k) => s + l.valores[k] / Math.max(1, medianas[k]), 0)
    return { ...l, foraDoPadrao: fora, pontos: Math.round(pontos * 10) / 10 }
  })
  out.sort((a, b) => b.pontos - a.pontos || b.foraDoPadrao.length - a.foraDoPadrao.length || a.nome.localeCompare(b.nome, 'pt-BR'))
  return { linhas: out, medianas }
}
