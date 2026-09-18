import { NextResponse } from 'next/server'
import { contextoSalao } from '@/lib/auth/salao'
import { regenerarTokenMesa, revogarQrMesa } from '@/lib/queries/mesas'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Estado operacional e QR de UMA mesa: bloquear, desbloquear, desativar, reativar, rodar
 * o token do QR e revogar o QR sem emitir outro.
 *
 * Por que sair da tela para uma rota: estas ações precisam de três coisas que o
 * `update` client-side não dá — conferir se existe comanda aberta antes de tirar a mesa
 * de operação, gravar auditoria com estado anterior e novo, e exigir `mesas.gerenciar`.
 * Desde a 0071 o navegador nem consegue escrever token, bloqueio ou revogação; e um
 * trigger recusa desativar/bloquear mesa com conta aberta venha a escrita de onde vier.
 *
 * Nada é apagado. Bloquear e desativar são timestamps/flags; rodar o token mantém o id
 * interno da mesa, então comanda, pedido e histórico continuam ligados a ela.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ACOES = ['bloquear', 'desbloquear', 'desativar', 'reativar', 'rodar_qr', 'revogar_qr'] as const
type Acao = (typeof ACOES)[number]

/** Sair de operação com conta aberta na mesa é erro de operação, não de digitação. */
const EXIGEM_MESA_LIVRE: Acao[] = ['bloquear', 'desativar']

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Operar a mesa é do garçom; CONFIGURAR a mesa e o QR é da gestão.
  const ctx = await contextoSalao('mesas.gerenciar')
  if ('erro' in ctx) {
    if (ctx.erro.status === 403) return NextResponse.json({ error: 'Só a gestão configura mesa e QR Code.' }, { status: 403 })
    return ctx.erro
  }
  const { sessao, admin } = ctx
  if (!UUID.test(id)) return NextResponse.json({ error: 'Mesa inválida' }, { status: 400 })

  let corpo: { acao?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const acao = corpo.acao as Acao
  if (!ACOES.includes(acao)) return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })

  // A mesa tem que ser desta loja. Sem isto, um id de mesa vizinha seria bloqueado daqui.
  const { data: mesa } = await admin
    .from('mesas')
    .select('id, nome, ativa, bloqueada_em, qr_revogado_em')
    .eq('id', id)
    .eq('restaurante_id', sessao.restauranteId)
    .maybeSingle()
  if (!mesa) return NextResponse.json({ error: 'Mesa não encontrada nesta loja' }, { status: 404 })

  const estadoAnterior = {
    ativa: (mesa.ativa as boolean | null) ?? true,
    bloqueada: mesa.bloqueada_em !== null,
    qrRevogado: (mesa.qr_revogado_em ?? null) !== null,
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

  /** Sessão e rascunhos da mesa encerram: o celular no token antigo não segue gravando. */
  async function encerrarSessoesAbertas(): Promise<number> {
    const { data: sessoes } = await admin
      .from('sessoes_mesa')
      .select('id')
      .eq('restaurante_id', sessao.restauranteId)
      .eq('mesa_id', id)
      .eq('status', 'aberta')
    const ids = (sessoes ?? []).map((s) => s.id as string)
    if (ids.length > 0) {
      const agora = new Date().toISOString()
      await admin.from('selecoes_mesa').update({ encerrada_em: agora }).in('sessao_id', ids).is('encerrada_em', null)
      await admin.from('sessoes_mesa').update({ status: 'encerrada', encerrada_em: agora }).in('id', ids)
    }
    return ids.length
  }

  if (acao === 'rodar_qr' || acao === 'revogar_qr') {
    // O link antigo morre no mesmo instante: `resolverMesaPorToken` busca por token e o
    // valor anterior deixa de existir. Quem estiver com o QR velho na mão recebe 404.
    if (acao === 'rodar_qr') await regenerarTokenMesa(admin, sessao.restauranteId, id)
    else await revogarQrMesa(admin, sessao.restauranteId, id)
    const encerradas = await encerrarSessoesAbertas()
    // O token NÃO entra na auditoria nem na resposta: trilha com credencial dentro é
    // vazamento com carimbo de data. A tela busca o link novo em /api/admin/mesas/qr.
    await auditar(acao === 'rodar_qr' ? 'mesa.rodou_qr' : 'mesa.revogou_qr', {
      sessoes_encerradas: encerradas,
      de: estadoAnterior.qrRevogado ? 'sem QR' : 'QR válido',
      para: acao === 'rodar_qr' ? 'QR novo' : 'sem QR',
    })
    return NextResponse.json({ ok: true })
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
  if (error) {
    // O trigger da 0071 recusa com conta aberta mesmo que ela tenha surgido entre a
    // conferência acima e este update.
    if (/comanda_aberta/.test(error.message)) {
      return NextResponse.json({ error: 'Esta mesa acabou de receber uma conta. Atualize a tela.', codigo: 'comanda_aberta' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  }

  await auditar(`mesa.${acao}`, {
    de: estadoAnterior.ativa === false ? 'inativa' : estadoAnterior.bloqueada ? 'bloqueada' : 'em operação',
    para: acao === 'bloquear' ? 'bloqueada' : acao === 'desativar' ? 'inativa' : 'em operação',
  })

  return NextResponse.json({ ok: true })
}
