import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Liga e desliga o módulo Mesas e Comandas da loja — só o dono (`ajustes.editar`).
 *
 * Fica FORA de `/api/admin/mesas` de propósito: aquele prefixo responde 404 com o módulo
 * desligado, e é justamente desligado que o dono precisa ligá-lo.
 *
 * Desligar com conta de mesa aberta é recusado: a conta ficaria pendurada numa tela que
 * sumiu, com dinheiro a receber. Feche ou cancele as contas antes.
 *
 * A coluna só muda por aqui: desde a 0071 um trigger recusa a escrita pelo JWT do
 * usuário (o atendente ligava o módulo pelo console).
 */

async function autorizar() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) } as const
  if (!pode(sessao.papel, 'ajustes.editar')) {
    return { erro: NextResponse.json({ error: 'Só o dono liga ou desliga módulos.' }, { status: 403 }) } as const
  }
  return { sessao, admin: getAdminSupabase({ correlacao: crypto.randomUUID() }) } as const
}

async function contasDeMesaAbertas(admin: ReturnType<typeof getAdminSupabase>, restauranteId: string): Promise<number> {
  const { data } = await admin
    .from('comandas')
    .select('id, pedidos!inner ( canal )')
    .eq('restaurante_id', restauranteId)
    .eq('status', 'aberta')
    .eq('pedidos.canal', 'mesa')
  return new Set(((data ?? []) as { id: string }[]).map((c) => c.id)).size
}

export async function GET() {
  const ctx = await autorizar()
  if ('erro' in ctx) return ctx.erro
  const { data } = await ctx.admin.from('restaurantes').select('modulo_mesas_ativo').eq('id', ctx.sessao.restauranteId).maybeSingle()
  return NextResponse.json({
    ativo: data?.modulo_mesas_ativo === true,
    contasAbertas: await contasDeMesaAbertas(ctx.admin, ctx.sessao.restauranteId),
  })
}

export async function PUT(request: Request) {
  const ctx = await autorizar()
  if ('erro' in ctx) return ctx.erro

  let corpo: { ativo?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  if (typeof corpo.ativo !== 'boolean') return NextResponse.json({ error: 'Informe ativo: true ou false.' }, { status: 400 })

  const { data: atual } = await ctx.admin.from('restaurantes').select('modulo_mesas_ativo').eq('id', ctx.sessao.restauranteId).maybeSingle()
  const antes = atual?.modulo_mesas_ativo === true
  if (antes === corpo.ativo) return NextResponse.json({ ok: true, ativo: antes })

  if (!corpo.ativo) {
    const abertas = await contasDeMesaAbertas(ctx.admin, ctx.sessao.restauranteId)
    if (abertas > 0) {
      return NextResponse.json(
        {
          error: `Há ${abertas} ${abertas === 1 ? 'conta de mesa aberta' : 'contas de mesa abertas'}. Feche ou cancele antes de desligar o módulo.`,
          codigo: 'comanda_aberta',
        },
        { status: 409 },
      )
    }
  }

  const { error } = await ctx.admin.from('restaurantes').update({ modulo_mesas_ativo: corpo.ativo }).eq('id', ctx.sessao.restauranteId)
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })

  await registrarAuditoria(ctx.admin, {
    restauranteId: ctx.sessao.restauranteId,
    usuarioId: ctx.sessao.userId,
    usuarioNome: ctx.sessao.nome,
    acao: corpo.ativo ? 'mesas.ligou_modulo' : 'mesas.desligou_modulo',
    entidade: 'restaurante',
    entidadeId: ctx.sessao.restauranteId,
    dados: { de: antes ? 'ligado' : 'desligado', para: corpo.ativo ? 'ligado' : 'desligado' },
  })
  return NextResponse.json({ ok: true, ativo: corpo.ativo })
}
