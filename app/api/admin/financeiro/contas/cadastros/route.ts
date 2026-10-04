import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { listarCategorias, listarFornecedores, salvarCategoria, salvarFornecedor } from '@/lib/financeiro/contas'
import type { GrupoCategoria, TipoConta } from '@/lib/financeiro/contas-regras'

/**
 * Plano de contas e fornecedores (Fase 5b). GET: contas_pagar. POST {tipo: 'categoria'|'fornecedor', id?, ...}: contas_lancar.
 * Nada se apaga: categoria e fornecedor só se desativam (ativo: false).
 */
export async function GET() {
  const c = await contextoFinanceiro('contas_pagar')
  if ('erro' in c) return c.erro
  const loja = c.sessao.restauranteId
  const [categorias, fornecedores] = await Promise.all([listarCategorias(c.admin, loja), listarFornecedores(c.admin, loja)])
  return NextResponse.json({ categorias, fornecedores }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const c = await contextoFinanceiro('contas_lancar')
  if ('erro' in c) return c.erro
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const id = typeof b?.id === 'string' ? b.id : null
  const r = b?.cadastro === 'categoria'
    ? await salvarCategoria(c, id, { nome: String(b?.nome ?? ''), tipo: String(b?.tipo ?? '') as TipoConta, grupo: String(b?.grupo ?? '') as GrupoCategoria, ativo: typeof b?.ativo === 'boolean' ? b.ativo : undefined })
    : b?.cadastro === 'fornecedor' ? await salvarFornecedor(c, id, b ?? {})
    : { ok: false as const, erro: 'Cadastro inválido.', status: 400 }
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true, id: r.valor.id }, { status: id ? 200 : 201 })
}
