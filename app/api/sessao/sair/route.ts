import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { encerrarSessoes, travarSessao } from '@/lib/financeiro/sessoes'
import { dispositivoDaRequisicao } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'
import { criarAlerta } from '@/lib/financeiro/alertas'
import { controleCaixaAtivo } from '@/lib/financeiro/nivel'

/**
 * Sair do painel ou travar a tela (0132).
 *   POST { motivo?: 'saiu' | 'bloqueio' }
 * 'saiu': encerra a sessão deste terminal e audita; o navegador faz o signOut logo depois.
 * 'bloqueio': a sessão CONTINUA (Kanban, tempo real e impressão não param), mas fica marcada
 * como travada — o servidor recusa ações de dinheiro até destravar com PIN (/api/sessao/desbloquear).
 * Financeiro ligado (Fase 2): quem abriu o caixa e vai sair com ele aberto precisa justificar
 * (409 'caixa_aberto' sem justificativa); a saída justificada vai para a auditoria e alerta o dono.
 */
export async function POST(request: Request) {
  const supabase = await getServerSupabase()
  const sessao = await getCurrentSession(supabase)
  if (!sessao) return NextResponse.json({ ok: true })
  const corpo = await request.json().catch(() => null)
  const motivo = corpo?.motivo === 'bloqueio' ? 'bloqueio' : 'saiu'
  const admin = getAdminSupabase()
  const d = await dispositivoDaRequisicao()
  let justificativa: string | null = null
  if (motivo === 'saiu') {
    // Sair com o caixa aberto só pede justificativa com o controle de caixa ativo (nível 2, 0167).
    if (await controleCaixaAtivo(admin, sessao.restauranteId)) {
      const { data: t } = await admin.from('caixa_turnos').select('id, aberto_por').eq('restaurante_id', sessao.restauranteId).is('fechado_em', null).maybeSingle()
      if (t?.aberto_por === sessao.userId) {
        const j = typeof corpo?.justificativa === 'string' ? corpo.justificativa.trim().slice(0, 500) : ''
        justificativa = j
        if (j.length < 5) return NextResponse.json({ error: 'Você abriu o caixa e ele continua aberto. Feche o caixa ou explique por que vai sair.', codigo: 'caixa_aberto' }, { status: 409 })
        await criarAlerta(admin, { restauranteId: sessao.restauranteId, tipo: 'saiu_com_caixa_aberto', gravidade: 'atencao', mensagem: `${sessao.nome} saiu do painel com o caixa aberto. Motivo: ${justificativa}`, usuario: { id: sessao.userId, nome: sessao.nome }, dados: { turno: t.id } })
      }
    }
  }
  if (motivo === 'bloqueio') {
    await travarSessao(admin, { usuarioId: sessao.userId, usuarioNome: sessao.nome, restauranteId: sessao.restauranteId, ip: d.ip, dispositivo: d.dispositivo, terminal: d.terminal }, true)
  } else {
    await encerrarSessoes(admin, sessao.userId, motivo, d.terminal)
  }
  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
    acao: motivo === 'bloqueio' ? 'sessao.bloqueou_tela' : 'sessao.saiu', entidade: 'usuario', entidadeId: sessao.userId, dados: { dispositivo: d.dispositivo, ...(justificativa ? { caixa_aberto: true, justificativa } : {}) },
  })
  return NextResponse.json({ ok: true })
}
