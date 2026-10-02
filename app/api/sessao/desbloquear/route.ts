import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { travarSessao } from '@/lib/financeiro/sessoes'
import { dispositivoDaRequisicao } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'
import { criarAlerta } from '@/lib/financeiro/alertas'

/**
 * Destravar a PRÓPRIA tela com o PIN (0132).  POST { pin }
 * Outro operador assumindo o terminal usa /api/sessao/pin-entrar (troca de sessão).
 * 5 erros bloqueiam o PIN por 15 min (no banco: usuario_verificar_pin).
 */
export async function POST(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const corpo = await request.json().catch(() => null)
  const pin = typeof corpo?.pin === 'string' ? corpo.pin : ''
  const admin = getAdminSupabase()
  const d = await dispositivoDaRequisicao()
  const { data: r } = await admin.rpc('usuario_verificar_pin', { p_restaurante: sessao.restauranteId, p_usuario: sessao.userId, p_pin: pin })
  if (r !== 'ok') {
    await registrarAuditoria(admin, { restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome, acao: 'sessao.pin_falhou', entidade: 'usuario', entidadeId: sessao.userId, dados: { motivo: r, dispositivo: d.dispositivo } })
    if (r === 'bloqueado') await criarAlerta(admin, { restauranteId: sessao.restauranteId, tipo: 'pin_bloqueado', gravidade: 'atencao', mensagem: `PIN de ${sessao.nome} bloqueado por 15 min após 5 tentativas erradas na tela travada.`, usuario: { id: sessao.userId, nome: sessao.nome }, dedupeMin: 15, dedupeChave: sessao.userId })
    const msg = r === 'bloqueado' ? 'PIN bloqueado por 15 minutos. Entre com a senha.' : r === 'sem_pin' ? 'Você ainda não tem PIN. Entre com a senha.' : 'PIN incorreto.'
    return NextResponse.json({ error: msg, codigo: r }, { status: r === 'bloqueado' ? 423 : 403 })
  }
  await travarSessao(admin, { usuarioId: sessao.userId, usuarioNome: sessao.nome, restauranteId: sessao.restauranteId, ip: d.ip, dispositivo: d.dispositivo, terminal: d.terminal }, false)
  await registrarAuditoria(admin, { restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome, acao: 'sessao.desbloqueou', entidade: 'usuario', entidadeId: sessao.userId, dados: { dispositivo: d.dispositivo } })
  return NextResponse.json({ ok: true })
}
