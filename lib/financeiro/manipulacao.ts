import type { SupabaseClient } from '@supabase/supabase-js'
import { criarAlerta } from './alertas'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * "Valor manipulado" (Fase 6): a vitrine NUNCA manda preço, total ou desconto — o servidor calcula tudo. Se uma
 * requisição chega com esses campos, alguém mexeu no pedido por fora do app. O pedido segue com os valores do
 * SERVIDOR (os enviados são ignorados), e o dono recebe um alerta (uma vez por hora por origem).
 */
const CAMPOS_TOPO = ['total', 'subtotal', 'desconto', 'valorTotal', 'totalCentavos', 'preco', 'valor', 'precoFinal']
const CAMPOS_ITEM = ['preco', 'precoUnitario', 'preco_unitario', 'valor', 'total', 'subtotal', 'precoTotal']

export function camposDeValorEnviados(bruto: unknown): string[] {
  if (!bruto || typeof bruto !== 'object') return []
  const b = bruto as Record<string, unknown>
  const out = CAMPOS_TOPO.filter((k) => b[k] !== undefined)
  if (Array.isArray(b.itens)) {
    for (const it of b.itens as unknown[]) {
      if (it && typeof it === 'object') for (const k of CAMPOS_ITEM) if ((it as Record<string, unknown>)[k] !== undefined) out.push(`itens[].${k}`)
    }
  }
  return [...new Set(out)]
}

export async function alertarValorManipulado(admin: SupabaseClient, restauranteId: string, campos: string[], origem: string) {
  try {
    const { data: loja } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', restauranteId).maybeSingle()
    if (!loja?.financeiro_ativo) return
    await registrarAuditoria(admin, { restauranteId, usuarioNome: 'Vitrine (cliente)', acao: 'seguranca.valor_manipulado', entidade: 'pedido', dados: { campos, origem } })
    await criarAlerta(admin, {
      restauranteId, tipo: 'valor_manipulado', gravidade: 'grave',
      mensagem: `Um pedido chegou com valores enviados de fora do app (${campos.join(', ')}). O sistema ignorou e usou os preços do cardápio — mas alguém tentou mexer no valor.`,
      dados: { campos, origem }, dedupeMin: 60, dedupeChave: origem.slice(0, 80),
    })
  } catch (e) {
    console.error('[seguranca] alerta de valor manipulado falhou', (e as Error).message?.slice(0, 120))
  }
}
