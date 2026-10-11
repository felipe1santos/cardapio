import { CANAIS, ROTULO_CANAL, type CanalOrigem } from '@/lib/origem-visita'
import { COR_CANAL } from '@/lib/dashboard-origem'

/**
 * "Vendas por origem" do Dashboard (10/10/2026 — só com "Novidades em teste"). Pedidos e faturamento no período do
 * filtro, por origem, sobre a MESMA lista de pedidos do Resumo do período: os totais batem por construção.
 *   · última ("de onde pediu") = origem atribuída gravada no pedido (0149); primeira ("como conheceu") = a 1ª origem do
 *     aparelho (gravada a partir de 10/10 em origem_detalhe.primeira).
 *   · PDV/balcão e Mesa (garçom) são canais próprios; pedido da vitrine sem a origem pedida = "Sem origem".
 */
export type ModoOrigem = 'primeira' | 'ultima'
export type ChaveOrigemVenda = CanalOrigem | 'pdv' | 'mesa' | 'sem_origem'

export const ROTULO_VENDA: Record<ChaveOrigemVenda, string> = { ...ROTULO_CANAL, pdv: 'PDV / balcão', mesa: 'Mesa (salão)', sem_origem: 'Sem origem' }
export const COR_VENDA: Record<ChaveOrigemVenda, string> = { ...COR_CANAL, pdv: '#1D4ED8', mesa: '#7E22CE', sem_origem: '#D1D5DB' }

export interface LinhaVendaOrigem { chave: ChaveOrigemVenda; rotulo: string; cor: string; pedidos: number; faturamento: number }

export function vendasPorOrigem(
  pedidos: { total: number; origemVenda: 'vitrine' | 'pdv' | 'mesa'; origemCanal: string | null; origemPrimeira?: string | null }[],
  modo: ModoOrigem,
): { linhas: LinhaVendaOrigem[]; totais: { pedidos: number; faturamento: number } } {
  const acc = new Map<ChaveOrigemVenda, { pedidos: number; faturamento: number }>()
  let totalPedidos = 0
  let totalFat = 0
  for (const p of pedidos) {
    const canalVitrine = modo === 'primeira' ? p.origemPrimeira : p.origemCanal
    const chave: ChaveOrigemVenda = p.origemVenda === 'pdv' ? 'pdv'
      : p.origemVenda === 'mesa' ? 'mesa'
        : canalVitrine && (CANAIS as readonly string[]).includes(canalVitrine) ? (canalVitrine as CanalOrigem) : 'sem_origem'
    const a = acc.get(chave) ?? { pedidos: 0, faturamento: 0 }
    const v = Number(p.total) || 0
    a.pedidos++
    a.faturamento = Math.round((a.faturamento + v) * 100) / 100
    acc.set(chave, a)
    totalPedidos++
    totalFat = Math.round((totalFat + v) * 100) / 100
  }
  const linhas = [...acc.entries()]
    .map(([chave, a]) => ({ chave, rotulo: ROTULO_VENDA[chave], cor: COR_VENDA[chave], ...a }))
    .sort((x, y) => y.faturamento - x.faturamento || y.pedidos - x.pedidos)
  return { linhas, totais: { pedidos: totalPedidos, faturamento: totalFat } }
}
