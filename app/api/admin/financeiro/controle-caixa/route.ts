import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'
import { carregarDadosAtivacao, passosAtivacao, podeAtivar } from '@/lib/financeiro/controle-caixa'

/**
 * Controle de caixa (nível 2, 0167). GET: estado + passo a passo (quem vê o financeiro).
 * POST { acao: 'ativar', fundoCentavos, toleranciaCentavos, confirmar: true } | { acao: 'desativar', confirmar: true } — SÓ o dono.
 * Ativar: o caixa automático aberto continua até ser fechado em Financeiro › Caixa; o próximo é aberto à mão com o fundo.
 */
async function estado(c: Exclude<Awaited<ReturnType<typeof contextoFinanceiro>>, { erro: unknown }>) {
  const loja = c.sessao.restauranteId
  const [{ data: r }, dados, { data: turno }] = await Promise.all([
    c.admin.from('restaurantes').select('controle_caixa_ativo, controle_caixa_ativado_em, controle_caixa_ativado_por_nome').eq('id', loja).maybeSingle(),
    carregarDadosAtivacao(c.admin, loja),
    c.admin.from('caixa_turnos').select('id, aberto_em, aberto_por_nome').eq('restaurante_id', loja).is('fechado_em', null).maybeSingle(),
  ])
  const passos = passosAtivacao(dados)
  return {
    ativo: r?.controle_caixa_ativo === true,
    ativadoEm: (r?.controle_caixa_ativado_em as string | null) ?? null,
    ativadoPorNome: (r?.controle_caixa_ativado_por_nome as string | null) ?? null,
    passos, podeAtivar: podeAtivar(passos), souDono: c.sessao.papel === 'dono',
    fundoCentavos: dados.fundoCentavos, toleranciaCentavos: dados.toleranciaCentavos,
    caixaAberto: turno ? { desde: turno.aberto_em as string, por: (turno.aberto_por_nome as string | null) ?? null } : null,
  }
}

export async function GET() {
  const c = await contextoFinanceiro('financeiro')
  if ('erro' in c) return c.erro
  return NextResponse.json(await estado(c), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const c = await contextoFinanceiro()
  if ('erro' in c) return c.erro
  if (c.sessao.papel !== 'dono') return NextResponse.json({ error: 'Só o dono ativa ou desativa o controle de caixa.', codigo: 'sem_permissao_acao' }, { status: 403 })
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (b?.confirmar !== true) return NextResponse.json({ error: 'Confirme para continuar.', codigo: 'confirmar' }, { status: 400 })
  const loja = c.sessao.restauranteId
  const auditar = (acao: string, dados: Record<string, unknown>) =>
    registrarAuditoria(c.admin, { restauranteId: loja, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao, entidade: 'restaurante', entidadeId: loja, dados: { ...dados, dispositivo: c.dispositivo } })

  if (b.acao === 'desativar') {
    const { error } = await c.admin.from('restaurantes').update({ controle_caixa_ativo: false }).eq('id', loja)
    if (error) return NextResponse.json({ error: 'Não foi possível desativar.' }, { status: 500 })
    await auditar('fin.controle_caixa_desativado', { resumo: 'Controle de caixa desativado (volta ao nível 1: caixa automático)' })
    return NextResponse.json({ ok: true, ...(await estado(c)) })
  }
  if (b.acao !== 'ativar') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })

  const fundo = Number(b.fundoCentavos), tol = Number(b.toleranciaCentavos)
  if (!Number.isSafeInteger(fundo) || fundo < 0 || fundo > 10_000_000) return NextResponse.json({ error: 'Fundo de caixa inválido.' }, { status: 400 })
  if (!Number.isSafeInteger(tol) || tol < 0 || tol > 100_000) return NextResponse.json({ error: 'Tolerância inválida.' }, { status: 400 })
  const { error: eCfg } = await c.admin.from('fin_config').upsert({ restaurante_id: loja, fundo_padrao_centavos: fundo, tolerancia_fechamento_centavos: tol, atualizado_por_nome: c.sessao.nome }, { onConflict: 'restaurante_id' })
  if (eCfg) return NextResponse.json({ error: 'Não foi possível salvar o fundo e a tolerância.' }, { status: 500 })
  const antes = await estado(c)
  if (antes.ativo) return NextResponse.json({ ok: true, ...antes })
  if (!antes.podeAtivar) {
    const falta = antes.passos.filter((p) => p.obrigatorio && !p.ok).map((p) => p.titulo)
    return NextResponse.json({ error: `Falta: ${falta.join('; ')}.`, codigo: 'passos_pendentes', ...antes }, { status: 409 })
  }
  const { error } = await c.admin.from('restaurantes').update({ controle_caixa_ativo: true, controle_caixa_ativado_em: new Date().toISOString(), controle_caixa_ativado_por_nome: c.sessao.nome }).eq('id', loja)
  if (error) return NextResponse.json({ error: 'Não foi possível ativar.' }, { status: 500 })
  await auditar('fin.controle_caixa_ativado', { resumo: 'Controle de caixa ativado (nível 2)', fundo_centavos: fundo, tolerancia_centavos: tol, caixa_aberto: antes.caixaAberto })
  return NextResponse.json({ ok: true, ...(await estado(c)) })
}
