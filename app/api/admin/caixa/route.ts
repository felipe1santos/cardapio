import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { abrirTurno, acertarEntregador, fecharTurno, painelCaixa } from '@/lib/queries/caixa'
import { lancar } from '@/lib/financeiro/ledger'
import { dispositivoDaRequisicao } from '@/lib/financeiro/contexto'

/**
 * Turno de caixa e acerto do entregador (0114).
 *
 *   GET  ?dia=AAAA-MM-DD            → turno aberto, acerto por entregador e resumo do dia
 *   POST { acao: 'abrir' }
 *   POST { acao: 'fechar', forcar? } → 409 com os pendentes se houver dinheiro a acertar
 *   POST { acao: 'acertar', entregadorId, valorDeclarado }
 *
 * Loja e operador vêm da sessão; esperado e troco são calculados aqui, nunca aceitos da tela.
 */
async function autorizar() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) } as const
  if (!pode(sessao.papel, 'logistica.operar')) return { erro: NextResponse.json({ error: 'Sem permissão para o caixa.' }, { status: 403 }) } as const
  return { sessao, admin: getAdminSupabase() } as const
}

const DIA = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const ctx = await autorizar()
  if ('erro' in ctx) return ctx.erro
  const dia = new URL(request.url).searchParams.get('dia')
  if (dia !== null && !DIA.test(dia)) return NextResponse.json({ error: 'Dia inválido.' }, { status: 400 })
  try {
    return NextResponse.json(await painelCaixa(ctx.admin, ctx.sessao.restauranteId, dia ?? undefined), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[caixa] GET', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro ao carregar o caixa.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const ctx = await autorizar()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const acao = corpo?.acao
  const eu = { userId: sessao.userId, nome: sessao.nome ?? null }
  const auditar = (nome: string, dados: Record<string, unknown>, entidadeId?: string) =>
    registrarAuditoria(admin, { restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome, acao: nome, entidade: 'caixa', entidadeId, dados }).catch(() => {})
  // Financeiro ligado (0133): abrir e fechar o caixa passam pelo Financeiro › Caixa (fundo de troco,
  // contagem cega); aqui fica só o acerto do motoboy, que também entra no livro-caixa.
  const { data: loja } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', sessao.restauranteId).maybeSingle()
  const financeiro = !!loja?.financeiro_ativo
  if (financeiro && (acao === 'abrir' || acao === 'fechar')) {
    return NextResponse.json({ error: 'Abra e feche o caixa em Financeiro › Caixa.', codigo: 'usar_financeiro' }, { status: 409 })
  }
  try {
    if (acao === 'abrir') {
      const r = await abrirTurno(admin, sessao.restauranteId, eu)
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
      await auditar('caixa.abriu_turno', {}, r.turno.id)
      return NextResponse.json({ ok: true, turno: r.turno })
    }
    if (acao === 'fechar') {
      const r = await fecharTurno(admin, sessao.restauranteId, eu, corpo?.forcar === true)
      if (!r.ok) return NextResponse.json({ error: r.erro, pendentes: r.pendentes }, { status: r.status })
      await auditar('caixa.fechou_turno', { forcado: corpo?.forcar === true })
      return NextResponse.json({ ok: true })
    }
    if (acao === 'acertar') {
      const entregadorId = typeof corpo?.entregadorId === 'string' ? corpo.entregadorId : ''
      const valor = typeof corpo?.valorDeclarado === 'number' ? corpo.valorDeclarado : NaN
      if (!UUID.test(entregadorId)) return NextResponse.json({ error: 'Entregador inválido.' }, { status: 400 })
      if (!Number.isFinite(valor) || valor < 0 || valor > 1_000_000) return NextResponse.json({ error: 'Informe o valor declarado.' }, { status: 400 })
      const r = await acertarEntregador(admin, sessao.restauranteId, eu, entregadorId, valor)
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
      if (financeiro) {
        // Gaveta recebe o que ele entregou; a carteira do motoboy baixa o esperado (a pendência
        // lançada na entrega, 0135); a diferença vai para o resultado. Entra no turno de quem acertou.
        const declarado = Math.round(valor * 100)
        const esperado = Math.round(r.linha.valorEsperado * 100)
        const dados = { esperado_centavos: esperado, declarado_centavos: declarado, pedidos: r.linha.pedidos }
        const linhas = [
          ...(declarado > 0 ? [{ carteira: 'gaveta' as const, tipo: 'acerto_motoboy' as const, valorCentavos: declarado, forma: 'dinheiro', entregadorId, dados }] : []),
          ...(esperado > 0 ? [{ carteira: 'motoboy' as const, tipo: 'acerto_motoboy' as const, valorCentavos: -esperado, forma: 'dinheiro', entregadorId, dados }] : []),
          ...(declarado !== esperado ? [{ carteira: 'resultado' as const, tipo: 'acerto_motoboy' as const, valorCentavos: declarado - esperado, forma: 'dinheiro', entregadorId, dados }] : []),
        ]
        if (linhas.length) {
          const l = await lancar(admin, {
            restauranteId: sessao.restauranteId, turnoId: r.turnoId, chave: `acerto:${r.id}`, origem: 'motoboy',
            usuario: { id: sessao.userId, nome: sessao.nome }, motivo: 'Acerto do motoboy', dispositivo: (await dispositivoDaRequisicao()).dispositivo, linhas,
          })
          if (!l.ok) console.error('[caixa] acerto fora do livro-caixa:', l.erro)
        }
      }
      await auditar('caixa.acertou_entregador', { entregadorId, esperado: r.linha.valorEsperado, declarado: valor, pedidos: r.linha.pedidos })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  } catch (err) {
    console.error('[caixa] POST', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro no caixa.' }, { status: 500 })
  }
}
