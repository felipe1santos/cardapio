import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { podeFin } from '@/lib/financeiro/permissoes'
import { listaPrecificacao } from '@/lib/financeiro/cmv'

/**
 * Financeiro › Precificação / CMV (Fase 5). Só leitura aqui: lista de precificação, resumo e configuração.
 * Exige "Ver custos e margens" (custos_ver) — garçom, cozinha, caixa e motoboy não veem custo, nem pela API.
 */
export async function GET() {
  const c = await contextoFinanceiro('custos_ver')
  if ('erro' in c) return c.erro
  try {
    const r = await listaPrecificacao(c.admin, c.sessao.restauranteId)
    return NextResponse.json({
      ...r,
      pode: {
        editar: podeFin(c.sessao.papel, c.acessos, 'custos_editar'),
        aplicarPreco: podeFin(c.sessao.papel, c.acessos, 'precos_aplicar'),
        exportar: podeFin(c.sessao.papel, c.acessos, 'financeiro_exportar'),
      },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[cmv] lista', e)
    return NextResponse.json({ error: 'Não foi possível montar a precificação.' }, { status: 500 })
  }
}
