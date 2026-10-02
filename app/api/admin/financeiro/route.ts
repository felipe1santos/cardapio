import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { acoesFin } from '@/lib/financeiro/permissoes'

/** O que esta pessoa pode no financeiro (a tela monta seções e botões; o servidor decide de novo em cada ação). */
export async function GET() {
  const c = await contextoFinanceiro()
  if ('erro' in c) return c.erro
  return NextResponse.json({ nome: c.sessao.nome, papel: c.sessao.papel, acoes: acoesFin(c.sessao.papel, c.acessos) }, { headers: { 'Cache-Control': 'no-store' } })
}
