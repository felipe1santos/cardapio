import { canalDaOrigem, CANAIS, ROTULO_CANAL, type CanalOrigem } from '@/lib/origem-visita'

/**
 * "Origem das visitas" do Dashboard (item 55). Regras puras, testadas em dashboard-origem.test.ts.
 *   · Visitas por canal: as visitas da vitrine (origem crua → canal), no período do Dashboard.
 *   · Pedidos e faturamento por canal: os pedidos da VITRINE com a origem gravada (0149), fora os cancelados.
 *     Pedido de antes da 0149 não tem origem: fica de fora e a tela avisa (semOrigem).
 *   · Conversão = pedidos ÷ visitas do canal.
 */
export const COR_CANAL: Record<CanalOrigem, string> = {
  direto: '#7FA6C7', instagram: '#F25268', facebook: '#1877F2', meta: '#8C72CB', google_anuncio: '#F7B928',
  google_busca: '#32CDCD', whatsapp: '#3BA55C', qrcode: '#FF8A3D', outros: '#BABDC2',
}

export interface LinhaOrigem {
  canal: CanalOrigem; rotulo: string; cor: string; visitas: number; pedidos: number; faturamento: number; conversao: number
}

export function resumoPorOrigem(
  visitas: { origem: string; visitas: number }[],
  pedidos: { origemCanal: string | null; total: number; status: string; origemVenda?: string }[],
): { linhas: LinhaOrigem[]; totais: { visitas: number; pedidos: number; faturamento: number }; semOrigem: number } {
  const v = new Map<CanalOrigem, number>(), p = new Map<CanalOrigem, number>(), f = new Map<CanalOrigem, number>()
  for (const x of visitas) {
    const c = canalDaOrigem({ fonte: x.origem === 'Direto' ? null : x.origem, meio: null, clique: x.origem === 'google-ads' ? 'gclid' : x.origem === 'meta-ads' ? 'fbclid' : null })
    v.set(c, (v.get(c) ?? 0) + x.visitas)
  }
  let semOrigem = 0
  for (const x of pedidos) {
    if (x.status === 'cancelado' || x.status === 'aguardando_pagamento') continue
    if (x.origemVenda && x.origemVenda !== 'vitrine') continue
    if (!x.origemCanal || !(CANAIS as readonly string[]).includes(x.origemCanal)) { semOrigem++; continue }
    const c = x.origemCanal as CanalOrigem
    p.set(c, (p.get(c) ?? 0) + 1)
    f.set(c, Math.round(((f.get(c) ?? 0) + Number(x.total)) * 100) / 100)
  }
  const linhas = CANAIS.map((canal) => {
    const visitasC = v.get(canal) ?? 0, pedidosC = p.get(canal) ?? 0
    return { canal, rotulo: ROTULO_CANAL[canal], cor: COR_CANAL[canal], visitas: visitasC, pedidos: pedidosC, faturamento: f.get(canal) ?? 0, conversao: visitasC ? (pedidosC / visitasC) * 100 : 0 }
  }).filter((l) => l.visitas > 0 || l.pedidos > 0)
  const totais = linhas.reduce((t, l) => ({ visitas: t.visitas + l.visitas, pedidos: t.pedidos + l.pedidos, faturamento: Math.round((t.faturamento + l.faturamento) * 100) / 100 }), { visitas: 0, pedidos: 0, faturamento: 0 })
  return { linhas, totais, semOrigem }
}
