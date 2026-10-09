/**
 * % do CMV — regra única do dashboard, do DRE e da tela de CMV (auditoria 09/10).
 *
 * A % é CMV ÷ vendido DAS VENDAS QUE TÊM CUSTO GRAVADO. Dividir pelo faturamento inteiro (com as
 * vendas sem custo) mostrava 4% quando o real era 33%. Junto vai quanto do vendido está sem custo;
 * sem nenhuma venda com custo não há % — pede o cadastro.
 */
export interface CmvPercentual {
  /** CMV ÷ vendido com custo (0–100+); null sem venda com custo. */
  pct: number | null
  /** Parte do vendido (em valor) sem custo cadastrado (0–100); null sem venda no período. */
  semCustoPct: number | null
  /** Frase para mostrar junto (ou no lugar) da %; null quando está tudo com custo ou não houve venda. */
  aviso: string | null
}

export const AVISO_SEM_CUSTO = 'Cadastre o custo dos itens para ver o CMV'

export function cmvPercentual(p: { cmvCentavos: number; vendidoComCustoCentavos: number; vendidoCentavos: number }): CmvPercentual {
  const vendido = Math.max(0, p.vendidoCentavos)
  const comCusto = Math.max(0, Math.min(p.vendidoComCustoCentavos, vendido))
  if (vendido <= 0) return { pct: null, semCustoPct: null, aviso: null }
  if (comCusto <= 0) return { pct: null, semCustoPct: 100, aviso: AVISO_SEM_CUSTO }
  const semCustoPct = ((vendido - comCusto) / vendido) * 100
  const pct = (p.cmvCentavos / comCusto) * 100
  if (semCustoPct <= 0) return { pct, semCustoPct: 0, aviso: null }
  const txt = semCustoPct < 1 ? 'menos de 1%' : `${Math.round(semCustoPct)}%`
  return { pct, semCustoPct, aviso: `${txt} das vendas do período sem custo cadastrado` }
}
