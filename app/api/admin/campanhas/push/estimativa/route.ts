import { NextResponse } from 'next/server'
import { lojaDoPainel } from '@/lib/push/painel'
import { resolverPublico, type PublicoAvulsa } from '@/lib/push/motor'

/** Quantos clientes/aparelhos recebem uma avulsa com este público (antes de enviar). */
export async function POST(request: Request) {
  const c = await lojaDoPainel()
  if ('erro' in c) return c.erro
  const b = (await request.json().catch(() => ({}))) as { publico?: PublicoAvulsa }
  const p = b.publico
  if (!p || !['todos', 'recentes', 'inativos', 'fidelidade'].includes(p.tipo)) return NextResponse.json({ error: 'Público inválido' }, { status: 400 })
  const { clientes, aparelhos } = await resolverPublico(c.admin, c.loja.id, p)
  return NextResponse.json({ clientes, aparelhos: aparelhos.length })
}
