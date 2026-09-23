import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { identificarAgente } from '@/lib/impressao/credenciais'
import { informarResultado } from '@/lib/impressao/servico'
import { ehUuid } from '@/lib/pdv-v2'

/**
 * Resultado do envio: `ok` = o Windows aceitou o trabalho (não garante papel na mão).
 * Erro devolve o trabalho para a fila até 5 tentativas; depois, `falhou`.
 * Só o agente que reservou mexe no trabalho.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ehUuid(id)) return NextResponse.json({ error: 'Trabalho inválido' }, { status: 400 })
  const admin = getAdminSupabase()
  const quem = await identificarAgente(admin, request)
  if (!quem || quem.tipo !== 'agente') return NextResponse.json({ error: 'Credencial inválida' }, { status: 401 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof corpo?.ok !== 'boolean') return NextResponse.json({ error: 'Informe ok: true/false.' }, { status: 400 })
  const erro = typeof corpo.erro === 'string' ? corpo.erro.slice(0, 300) : null
  const r = await informarResultado(admin, quem.agenteId, id, corpo.ok, erro)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true, ...r.valor })
}
