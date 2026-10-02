import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { encerrarSessoes, travarSessao } from '@/lib/financeiro/sessoes'
import { dispositivoDaRequisicao } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Sair do painel ou travar a tela (0132).
 *   POST { motivo?: 'saiu' | 'bloqueio' }
 * 'saiu': encerra a sessão deste terminal e audita; o navegador faz o signOut logo depois.
 * 'bloqueio': a sessão CONTINUA (Kanban, tempo real e impressão não param), mas fica marcada
 * como travada — o servidor recusa ações de dinheiro até destravar com PIN (/api/sessao/desbloquear).
 * (Fase 2: sair com caixa aberto exige fechar ou justificar.)
 */
export async function POST(request: Request) {
  const supabase = await getServerSupabase()
  const sessao = await getCurrentSession(supabase)
  if (!sessao) return NextResponse.json({ ok: true })
  const corpo = await request.json().catch(() => null)
  const motivo = corpo?.motivo === 'bloqueio' ? 'bloqueio' : 'saiu'
  const admin = getAdminSupabase()
  const d = await dispositivoDaRequisicao()
  if (motivo === 'bloqueio') {
    await travarSessao(admin, { usuarioId: sessao.userId, usuarioNome: sessao.nome, restauranteId: sessao.restauranteId, ip: d.ip, dispositivo: d.dispositivo, terminal: d.terminal }, true)
  } else {
    await encerrarSessoes(admin, sessao.userId, motivo, d.terminal)
  }
  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
    acao: motivo === 'bloqueio' ? 'sessao.bloqueou_tela' : 'sessao.saiu', entidade: 'usuario', entidadeId: sessao.userId, dados: { dispositivo: d.dispositivo },
  })
  return NextResponse.json({ ok: true })
}
