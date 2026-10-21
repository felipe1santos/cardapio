import type { SupabaseClient, User } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import { acessoValido, buscarStatusAcesso, registrarLogin } from '@/lib/queries/lojistas'
import { telaInicialDoPapel } from '@/lib/auth/rotas'
import { registrarSessao } from '@/lib/financeiro/sessoes'
import { COOKIE_TERMINAL, dispositivoDaRequisicao } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'
import { nivelFinanceiro } from '@/lib/financeiro/nivel'

/**
 * Depois que o Supabase aceitou o login (senha ou Google, 20/10/2026): as mesmas regras para as duas formas — cadastro
 * concluído, acesso válido, funcionário ativo, loja com dono válido — e a primeira tela pelo papel. Devolve o destino;
 * recusou, encerra a sessão e devolve o /login com o motivo. `proximo` = volta para o app do motoboy (já validado).
 */
export async function concluirEntrada(supabase: SupabaseClient, user: User, proximo: string | null): Promise<string> {
  const nx = proximo ? `next=${encodeURIComponent(proximo)}&` : ''
  const admin = getAdminSupabase()

  if (isSuperAdminEmail(user.email)) {
    await registrarLogin(admin, user.id)
    return '/superadmin'
  }

  const status = await buscarStatusAcesso(admin, user.id)
  if (!status?.restauranteId || !status.autorizado) {
    await supabase.auth.signOut()
    return `/login?${nx}error=pendente`
  }
  if (!acessoValido(status)) {
    await supabase.auth.signOut()
    return `/login?${nx}error=${encodeURIComponent('Seu acesso expirou. Fale com a Menuzia para renovar.')}`
  }

  // Funcionário desativado pelo estabelecimento não entra. A RLS e o middleware já o
  // barrariam no primeiro clique; recusar aqui evita a tela vazia e diz o porquê.
  const { data: perfil } = await admin
    .from('usuarios')
    .select('papel, desativado_em, restaurante_id')
    .eq('id', user.id)
    .maybeSingle()
  if (perfil?.desativado_em) {
    await supabase.auth.signOut()
    return `/login?${nx}error=${encodeURIComponent('Seu acesso foi desativado. Fale com o responsável pela loja.')}`
  }

  // Funcionário depende da loja estar válida — e a validade é do DONO. Existência de pelo
  // menos um dono válido, a mesma regra de auth_loja_valida() (0060).
  if (perfil && perfil.papel !== 'dono') {
    const { data: donos } = await admin
      .from('usuarios')
      .select('autorizado, desativado_em, acesso_expira_em')
      .eq('restaurante_id', perfil.restaurante_id)
      .eq('papel', 'dono')
    const lojaValida = (donos ?? []).some(
      (d) =>
        d.autorizado &&
        !d.desativado_em &&
        (!d.acesso_expira_em || new Date(d.acesso_expira_em as string).getTime() > Date.now()),
    )
    if (!lojaValida) {
      await supabase.auth.signOut()
      return `/login?${nx}error=${encodeURIComponent('O acesso desta loja está suspenso. Fale com o responsável.')}`
    }
  }

  await registrarLogin(admin, user.id)
  await registrarEntrada(admin, user.id).catch((e) => console.error('[login] sessão não registrada:', (e as Error).message))
  const destino = await telaInicialDo(admin, user.id)
  return destino === '/motoboy' && proximo ? proximo : destino
}


/**
 * Sessão (0132): cada aparelho ganha um identificador de terminal (cookie httpOnly, 1 ano) e
 * cada entrada fica registrada com IP e dispositivo. Mesmo login aberto em dois terminais gera
 * alerta para o dono (lib/financeiro/sessoes.ts). Só nas lojas com o financeiro ligado; nas
 * outras, só o cookie do terminal (para a loja já ter os aparelhos conhecidos quando ligar).
 */
async function registrarEntrada(admin: ReturnType<typeof getAdminSupabase>, usuarioId: string) {
  const jar = await cookies()
  if (!jar.get(COOKIE_TERMINAL)?.value) {
    jar.set(COOKIE_TERMINAL, crypto.randomUUID(), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 365 * 86400 })
  }
  const d = await dispositivoDaRequisicao()
  const terminal = jar.get(COOKIE_TERMINAL)?.value ?? d.terminal
  const { data: u } = await admin.from('usuarios').select('nome, restaurante_id').eq('id', usuarioId).maybeSingle()
  const nivel = await nivelFinanceiro(admin, u?.restaurante_id as string | undefined)
  if (!nivel.financeiro) return
  // Abertura rápida do caixa (Fase 6): a primeira tela depois do login pergunta se abre o caixa (1 min de validade).
  // Só com o controle de caixa ativo (nível 2, 0167): no nível 1 o caixa é automático.
  if (nivel.controleCaixa) jar.set('menuzia_recem_entrou', '1', { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 })
  await registrarSessao(admin, { usuarioId, usuarioNome: (u?.nome as string) ?? '', restauranteId: (u?.restaurante_id as string) ?? null, ip: d.ip, dispositivo: d.dispositivo, terminal })
  if (u?.restaurante_id) {
    await registrarAuditoria(admin, { restauranteId: u.restaurante_id as string, usuarioId, usuarioNome: (u.nome as string) ?? '', acao: 'sessao.entrou', entidade: 'usuario', entidadeId: usuarioId, dados: { dispositivo: d.dispositivo } })
  }
}

/**
 * Primeira tela depois do login, pelo papel. O Dashboard é faturamento: abrir o garçom
 * nele seria mandá-lo para uma tela que ele não pode usar. Dono continua indo para o
 * Dashboard, como sempre.
 */
async function telaInicialDo(admin: ReturnType<typeof getAdminSupabase>, userId: string): Promise<string> {
  const { data } = await admin.from('usuarios').select('papel').eq('id', userId).maybeSingle()
  const destino = telaInicialDoPapel((data?.papel as string | undefined) ?? null)
  // Motoboy entrou com login e senha (10/10): o link mágico dele para de valer.
  if (destino === '/motoboy') await admin.from('entregadores').update({ token: crypto.randomUUID() }).eq('usuario_id', userId)
  // Papel sem tela nenhuma no painel (ex.: entregador, que entra pelo portal de token).
  return destino === '/login' ? '/admin/dashboard' : destino
}
