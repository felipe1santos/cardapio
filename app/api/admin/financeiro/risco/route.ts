import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'
import { relatorioDeRisco } from '@/lib/financeiro/risco'
import { hojeSP } from '@/lib/financeiro/contas-regras'

/** Relatório de risco por funcionário (Fase 6). Só DONO e GERENTE com "Ver auditoria e alertas". ?de&ate */
export async function GET(request: Request) {
  const c = await contextoFinanceiro('auditoria_ver')
  if ('erro' in c) return c.erro
  if (c.sessao.papel !== 'dono' && c.sessao.papel !== 'gerente') {
    return NextResponse.json({ error: 'Só o dono e o gerente veem o relatório de risco.', codigo: 'sem_permissao_acao' }, { status: 403 })
  }
  const u = new URL(request.url).searchParams
  const hoje = hojeSP()
  const de = u.get('de') ?? `${hoje.slice(0, 8)}01`
  const ate = u.get('ate') ?? hoje
  try {
    const r = await relatorioDeRisco(c.admin, c.sessao.restauranteId, de, ate)
    await registrarAuditoria(c.admin, { restauranteId: c.sessao.restauranteId, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao: 'fin.viu_risco', entidade: 'restaurante', entidadeId: c.sessao.restauranteId, dados: { de, ate, dispositivo: c.dispositivo } })
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if ((e as { status?: number }).status === 400) return NextResponse.json({ error: 'Período inválido.' }, { status: 400 })
    throw e
  }
}
