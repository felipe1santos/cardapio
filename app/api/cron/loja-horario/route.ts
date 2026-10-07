import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { lojaEstaAberta } from '@/lib/timezone'
import { registrarAuditoria } from '@/lib/auditoria'

// Cron (Coolify), a cada minuto: POST /api/cron/loja-horario com header "x-cron-secret: <CRON_SECRET>".
// Lojas no modo automático abrem e fecham pela grade de horário — isso não é uma gravação no banco,
// então o trigger da 0156 não vê. Aqui a passagem aberta↔fechada vira 'loja.abriu_horario' /
// 'loja.fechou_horario' na auditoria (compara com o último registro desse tipo da loja).
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const admin = getAdminSupabase()
  const { data: lojas } = await admin.from('restaurantes').select('id, horario_funcionamento').eq('status_loja', 'automatico')
  let registrados = 0
  let falhas = 0
  for (const l of lojas ?? []) {
    try {
      const aberta = lojaEstaAberta({ statusLoja: 'automatico', horarioFuncionamento: l.horario_funcionamento ?? null })
      const acao = aberta ? 'loja.abriu_horario' : 'loja.fechou_horario'
      const { data: ultimo } = await admin.from('eventos_auditoria').select('acao')
        .eq('restaurante_id', l.id).in('acao', ['loja.abriu_horario', 'loja.fechou_horario'])
        .order('criado_em', { ascending: false }).limit(1).maybeSingle()
      if (ultimo?.acao === acao) continue
      await registrarAuditoria(admin, {
        restauranteId: l.id as string, usuarioNome: 'Sistema (horário)', acao, entidade: 'restaurante', entidadeId: l.id as string,
        dados: { origem: 'horario', ...(ultimo ? {} : { primeiro_registro: true }) },
      })
      registrados++
    } catch (e) {
      falhas++
      console.error('[loja-horario] loja', l.id, (e as Error).message?.slice(0, 160))
    }
  }
  return NextResponse.json({ ok: true, lojas: lojas?.length ?? 0, registrados, falhas })
}
