import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Financeiro › Auditoria e Alertas (0132). Tudo da loja da SESSÃO (nunca do corpo).
 *   GET                         → alertas, sessões recentes e aprovações
 *   POST { acao: 'verificar' }  → confere a cadeia de hash do ledger e da auditoria
 *   PATCH { alertaId }          → marca alerta como lido (com o nome de quem leu)
 */
export async function GET() {
  const c = await contextoFinanceiro('auditoria_ver')
  if ('erro' in c) return c.erro
  const loja = c.sessao.restauranteId
  const [alertas, sessoes, aprovacoes, usuarios] = await Promise.all([
    c.admin.from('fin_alertas').select('id, tipo, gravidade, mensagem, usuario_nome, lido_por_nome, lido_em, whatsapp_enviado_em, criado_em')
      .eq('restaurante_id', loja).order('criado_em', { ascending: false }).limit(100),
    c.admin.from('usuarios_sessoes').select('id, usuario_id, ip, dispositivo, criado_em, visto_em, encerrada_em, motivo_encerramento, bloqueada_em')
      .eq('restaurante_id', loja).order('criado_em', { ascending: false }).limit(60),
    c.admin.from('fin_aprovacoes').select('id, acao, solicitante_nome, aprovador_nome, valor_centavos, motivo, criado_em')
      .eq('restaurante_id', loja).order('criado_em', { ascending: false }).limit(60),
    c.admin.from('usuarios').select('id, nome').eq('restaurante_id', loja),
  ])
  const nomes = new Map((usuarios.data ?? []).map((u) => [u.id as string, u.nome as string]))
  return NextResponse.json({
    alertas: alertas.data ?? [],
    sessoes: (sessoes.data ?? []).map((s) => ({ ...s, usuario_nome: nomes.get(s.usuario_id as string) ?? '—' })),
    aprovacoes: aprovacoes.data ?? [],
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const c = await contextoFinanceiro('auditoria_ver')
  if ('erro' in c) return c.erro
  const corpo = await request.json().catch(() => null)
  if (corpo?.acao !== 'verificar') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  const { data, error } = await c.admin.rpc('auditoria_verificar_cadeia', { p_restaurante: c.sessao.restauranteId })
  if (error) return NextResponse.json({ error: 'Não foi possível verificar agora.' }, { status: 500 })
  const problemas = (data ?? []) as { tabela: string; registro: string; motivo: string }[]
  await registrarAuditoria(c.admin, {
    restauranteId: c.sessao.restauranteId, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome,
    acao: 'fin.verificou_integridade', entidade: 'restaurante', entidadeId: c.sessao.restauranteId,
    dados: { problemas: problemas.length, dispositivo: c.dispositivo },
  })
  return NextResponse.json({ ok: problemas.length === 0, problemas: problemas.slice(0, 200), verificadoEm: new Date().toISOString() })
}

export async function PATCH(request: Request) {
  const c = await contextoFinanceiro('auditoria_ver')
  if ('erro' in c) return c.erro
  const corpo = await request.json().catch(() => null)
  const id = typeof corpo?.alertaId === 'string' ? corpo.alertaId : ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Alerta inválido.' }, { status: 400 })
  const { data, error } = await c.admin.from('fin_alertas').update({ lido_em: new Date().toISOString(), lido_por_nome: c.sessao.nome })
    .eq('id', id).eq('restaurante_id', c.sessao.restauranteId).is('lido_em', null).select('id')
  if (error) return NextResponse.json({ error: 'Não foi possível marcar.' }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Alerta não encontrado.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
