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
  // Tempos de cada etapa medidos pelo Assistente (0.2.0-beta.7+): só números conhecidos.
  const tempos = temposValidos(corpo.tempos)
  if (tempos) await admin.from('impressao_trabalhos').update({ tempos }).eq('id', id).eq('agente_id', quem.agenteId).then(() => {}, () => {})
  return NextResponse.json({ ok: true, ...r.valor })
}

const CHAVES_TEMPO = ['esperaMs', 'logoMs', 'desenhoMs', 'envioMs', 'totalMs', 'filaMs']
function temposValidos(v: unknown): Record<string, number | string> | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const t: Record<string, number | string> = {}
  for (const k of CHAVES_TEMPO) {
    const n = Number(o[k])
    if (Number.isFinite(n) && n >= 0 && n < 600_000) t[k] = Math.round(n)
  }
  if (typeof o.via === 'string' && /^(driver|raw_fila|raw_rede)$/.test(o.via)) t.via = o.via
  return Object.keys(t).length ? t : null
}
