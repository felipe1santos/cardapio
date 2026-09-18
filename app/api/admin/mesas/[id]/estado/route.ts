import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { regenerarTokenMesa } from '@/lib/queries/mesas'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Estado operacional e QR de UMA mesa: bloquear, desbloquear, desativar, reativar e
 * rodar o token do QR.
 *
 * Por que sair da tela para uma rota: estas ações precisam de três coisas que o
 * `update` client-side não dá — conferir se existe comanda aberta antes de tirar a mesa
 * de operação, gravar auditoria com estado anterior e novo, e exigir `mesas.gerenciar`
 * (a RLS já barra o garçom de escrever em `mesas`, mas o motivo e o rastro só existem
 * aqui).
 *
 * Nada é apagado. Bloquear e desativar são timestamps/flags; rodar o token mantém o id
 * interno da mesa, então comanda, pedido e histórico continuam ligados a ela.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ACOES = ['bloquear', 'desbloquear', 'desativar', 'reativar', 'rodar_qr'] as const
type Acao = (typeof ACOES)[number]

/** Sair de operação com conta aberta na mesa é erro de operação, não de digitação. */
const EXIGEM_MESA_LIVRE: Acao[] = ['bloquear', 'desativar']

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  // Operar a mesa é do garçom; CONFIGURAR a mesa e o QR é da gestão.
  if (!pode(sessao.papel, 'mesas.gerenciar')) {
    return NextResponse.json({ error: 'Só a gestão configura mesa e QR Code.' }, { status: 403 })
  }
  if (!UUID.test(id)) return NextResponse.json({ error: 'Mesa inválida' }, { status: 400 })

  let corpo: { acao?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const acao = corpo.acao as Acao
  if (!ACOES.includes(acao)) return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })

  const admin = getAdminSupabase()

  // A mesa tem que ser desta loja. Sem isto, um id de mesa vizinha seria bloqueado daqui.
  const { data: mesa } = await admin
    .from('mesas')
    .select('id, nome, ativa, bloqueada_em')
    .eq('id', id)
    .eq('restaurante_id', sessao.restauranteId)
    .maybeSingle()
  if (!mesa) return NextResponse.json({ error: 'Mesa não encontrada nesta loja' }, { status: 404 })

  const estadoAnterior = {
    ativa: (mesa.ativa as boolean | null) ?? true,
    bloqueada: mesa.bloqueada_em !== null,
  }

  if (EXIGEM_MESA_LIVRE.includes(acao)) {
    const { count } = await admin
      .from('comandas')
      .select('id', { count: 'exact', head: true })
      .eq('restaurante_id', sessao.restauranteId)
      .eq('mesa_id', id)
      .eq('status', 'aberta')
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            acao === 'bloquear'
              ? 'Esta mesa tem conta aberta. Feche, transfira ou cancele a conta antes de bloquear.'
              : 'Esta mesa tem conta aberta. Feche, transfira ou cancele a conta antes de desativar.',
          codigo: 'comanda_aberta',
        },
        { status: 409 },
      )
    }
  }

  const auditar = (acaoAudit: string, dados: Record<string, unknown>) =>
    registrarAuditoria(admin, {
      restauranteId: sessao.restauranteId,
      usuarioId: sessao.userId,
      usuarioNome: sessao.nome,
      acao: acaoAudit,
      entidade: 'mesa',
      entidadeId: id,
      dados: { mesa: mesa.nome, ...dados },
    })

  if (acao === 'rodar_qr') {
    // O link antigo morre no mesmo instante: `resolverMesaPorToken` busca por token e o
    // valor anterior deixa de existir. Quem estiver com o QR velho na mão recebe 404.
    const { token } = await regenerarTokenMesa(admin, sessao.restauranteId, id)
    // Sessão e rascunhos da mesa encerram: o celular que estava no token antigo não
    // continua gravando numa sessão que ninguém mais alcança.
    const { data: sessoes } = await admin
      .from('sessoes_mesa')
      .select('id')
      .eq('restaurante_id', sessao.restauranteId)
      .eq('mesa_id', id)
      .eq('status', 'aberta')
    const ids = (sessoes ?? []).map((s) => s.id as string)
    if (ids.length > 0) {
      await admin.from('selecoes_mesa').update({ encerrada_em: new Date().toISOString() }).in('sessao_id', ids).is('encerrada_em', null)
      await admin.from('sessoes_mesa').update({ status: 'encerrada', encerrada_em: new Date().toISOString() }).in('id', ids)
    }
    // O token NÃO entra na auditoria: trilha com credencial dentro é vazamento com
    // carimbo de data (o helper já derruba a chave, isto é o cinto e a suspensória).
    await auditar('mesa.rodou_qr', { sessoes_encerradas: ids.length })
    return NextResponse.json({ ok: true, token })
  }

  const patch =
    acao === 'bloquear'
      ? { bloqueada_em: new Date().toISOString() }
      : acao === 'desbloquear'
        ? { bloqueada_em: null }
        : acao === 'desativar'
          ? { ativa: false }
          : { ativa: true }

  const { error } = await admin.from('mesas').update(patch).eq('id', id).eq('restaurante_id', sessao.restauranteId)
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })

  await auditar(`mesa.${acao}`, {
    de: estadoAnterior.ativa === false ? 'inativa' : estadoAnterior.bloqueada ? 'bloqueada' : 'em operação',
    para:
      acao === 'bloquear' ? 'bloqueada' : acao === 'desativar' ? 'inativa' : acao === 'desbloquear' ? 'em operação' : 'em operação',
  })

  return NextResponse.json({ ok: true })
}
