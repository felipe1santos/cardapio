import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { registrarAuditoria } from '@/lib/auditoria'
import { encerrarSessoes, registrarSessao, travarSessao } from '@/lib/financeiro/sessoes'
import { getCurrentSession } from '@/lib/auth/session'
import { dispositivoDaRequisicao } from '@/lib/financeiro/contexto'
import { lojaDoTerminal } from '@/lib/financeiro/terminal'
import { criarLimitador } from '@/lib/limite-taxa'
import { criarAlerta } from '@/lib/financeiro/alertas'
import { nivelDe } from '@/lib/financeiro/nivel'

/**
 * Terminal travado (0132):
 *   GET  → funcionários da loja deste terminal que já têm PIN (nome e id) — para a tela de PIN.
 *   POST { usuarioId, pin } → entra como esse funcionário (troca rápida de operador / desbloqueio).
 * Só funciona em terminal já aberto com senha por alguém da loja (lib/financeiro/terminal.ts),
 * só para lojas com o financeiro ligado, e cada PIN bloqueia após 5 erros.
 */
const porTerminal = criarLimitador({ max: 20, janelaMs: 15 * 60_000 })

async function contexto() {
  const d = await dispositivoDaRequisicao()
  const admin = getAdminSupabase()
  const loja = await lojaDoTerminal(admin, d.terminal)
  if (!loja) return { erro: NextResponse.json({ error: 'Este aparelho ainda não foi aberto com senha. Entre com usuário e senha.' }, { status: 403 }) } as const
  const { data: r } = await admin.from('restaurantes').select('financeiro_ativo, controle_caixa_ativo, nome').eq('id', loja).maybeSingle()
  // Entrada por PIN é do controle de caixa (nível 2, 0167).
  if (!r || !nivelDe(r).controleCaixa) return { erro: NextResponse.json({ error: 'Entrada por PIN não está ativa nesta loja.' }, { status: 403 }) } as const
  return { d, admin, loja, nomeLoja: r.nome as string } as const
}

export async function GET() {
  const c = await contexto()
  if ('erro' in c) return c.erro
  const { data } = await c.admin.from('usuarios').select('id, nome, pin_hash').eq('restaurante_id', c.loja).is('desativado_em', null).order('nome')
  return NextResponse.json({ loja: c.nomeLoja, usuarios: (data ?? []).filter((u) => !!u.pin_hash).map((u) => ({ id: u.id, nome: u.nome })) })
}

export async function POST(request: Request) {
  const c = await contexto()
  if ('erro' in c) return c.erro
  if (porTerminal.excedeu(c.d.terminal ?? '')) return NextResponse.json({ error: 'Muitas tentativas neste aparelho. Aguarde alguns minutos.' }, { status: 429 })
  const corpo = await request.json().catch(() => null)
  const usuarioId = typeof corpo?.usuarioId === 'string' ? corpo.usuarioId : ''
  const pin = typeof corpo?.pin === 'string' ? corpo.pin : ''
  const { data: u } = await c.admin.from('usuarios').select('id, nome, email, papel, restaurante_id, desativado_em').eq('id', usuarioId).eq('restaurante_id', c.loja).maybeSingle()
  if (!u || u.desativado_em) return NextResponse.json({ error: 'Funcionário não encontrado.' }, { status: 404 })
  const { data: r } = await c.admin.rpc('usuario_verificar_pin', { p_restaurante: c.loja, p_usuario: u.id, p_pin: pin })
  if (r !== 'ok') {
    porTerminal.registrar(c.d.terminal ?? '')
    await registrarAuditoria(c.admin, { restauranteId: c.loja, usuarioId: null, usuarioNome: 'Sistema', acao: 'sessao.pin_falhou', entidade: 'usuario', entidadeId: u.id as string, dados: { usuario: u.nome, motivo: r, dispositivo: c.d.dispositivo } })
    if (r === 'bloqueado') await criarAlerta(c.admin, { restauranteId: c.loja, tipo: 'pin_bloqueado', gravidade: 'atencao', mensagem: `PIN de ${u.nome} bloqueado por 15 min após 5 tentativas erradas na troca de operador (${c.d.dispositivo}).`, usuario: { id: u.id as string, nome: u.nome as string }, dedupeMin: 15, dedupeChave: u.id as string })
    const msg = r === 'bloqueado' ? 'PIN bloqueado por 15 minutos.' : r === 'sem_pin' ? 'Este funcionário ainda não tem PIN.' : 'PIN incorreto.'
    return NextResponse.json({ error: msg }, { status: r === 'bloqueado' ? 423 : 403 })
  }
  const supabase = await getServerSupabase()
  const anterior = await getCurrentSession(supabase)
  // O próprio dono da sessão digitou o PIN dele: só destrava, sem trocar de login.
  if (anterior?.userId === u.id) {
    await travarSessao(c.admin, { usuarioId: u.id as string, usuarioNome: u.nome as string, restauranteId: c.loja, ip: c.d.ip, dispositivo: c.d.dispositivo, terminal: c.d.terminal }, false)
    await registrarAuditoria(c.admin, { restauranteId: c.loja, usuarioId: u.id as string, usuarioNome: u.nome as string, acao: 'sessao.desbloqueou', entidade: 'usuario', entidadeId: u.id as string, dados: { dispositivo: c.d.dispositivo } })
    return NextResponse.json({ ok: true, nome: u.nome, papel: u.papel })
  }
  // Sessão do funcionário sem a senha: link mágico gerado e trocado AQUI no servidor (nunca sai).
  const { data: link, error: el } = await c.admin.auth.admin.generateLink({ type: 'magiclink', email: u.email as string })
  if (el || !link.properties?.hashed_token) return NextResponse.json({ error: 'Não foi possível entrar agora.' }, { status: 500 })
  if (anterior) await encerrarSessoes(c.admin, anterior.userId, 'troca_operador', c.d.terminal)
  await supabase.auth.signOut().catch(() => {})
  const { error: ev } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
  if (ev) return NextResponse.json({ error: 'Não foi possível entrar agora.' }, { status: 500 })
  await c.admin.from('usuarios').update({ ultimo_login_em: new Date().toISOString() }).eq('id', u.id)
  await registrarSessao(c.admin, { usuarioId: u.id as string, usuarioNome: u.nome as string, restauranteId: c.loja, ip: c.d.ip, dispositivo: c.d.dispositivo, terminal: c.d.terminal })
  await registrarAuditoria(c.admin, { restauranteId: c.loja, usuarioId: u.id as string, usuarioNome: u.nome as string, acao: 'sessao.entrou_por_pin', entidade: 'usuario', entidadeId: u.id as string, dados: { dispositivo: c.d.dispositivo, ...(anterior ? { substituiu: anterior.nome } : {}) } })
  return NextResponse.json({ ok: true, nome: u.nome, papel: u.papel })
}
