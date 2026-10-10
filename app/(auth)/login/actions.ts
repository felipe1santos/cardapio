'use server'

import { redirect } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import { acessoValido, buscarEmailPorUsuario, buscarStatusAcesso, registrarLogin } from '@/lib/queries/lojistas'
import { telaInicialDoPapel } from '@/lib/auth/rotas'
import { headers } from 'next/headers'
import { criarLimitador, ipDaRequisicao } from '@/lib/limite-taxa'
import { cookies } from 'next/headers'
import { registrarSessao } from '@/lib/financeiro/sessoes'
import { COOKIE_TERMINAL, dispositivoDaRequisicao } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'
import { nivelFinanceiro } from '@/lib/financeiro/nivel'

// Força bruta: 10 senhas erradas em 15 min no mesmo usuário, ou 30 no mesmo IP (a loja
// inteira pode sair pelo mesmo IP), travam novas tentativas até a janela passar (B16).
// Só erro conta; entrar certo zera o usuário.
const falhasPorLogin = criarLimitador({ max: 10, janelaMs: 15 * 60_000 })
const falhasPorIp = criarLimitador({ max: 30, janelaMs: 15 * 60_000 })
const MSG_MUITAS = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'

export async function signIn(formData: FormData) {
  const login = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const chaveIp = `ip:${ipDaRequisicao(await headers())}`
  const chaveLogin = `login:${login.toLowerCase()}`
  if (falhasPorIp.excedeu(chaveIp) || falhasPorLogin.excedeu(chaveLogin)) {
    redirect(`/login?error=${encodeURIComponent(MSG_MUITAS)}`)
  }
  const falhou = () => { falhasPorIp.registrar(chaveIp); falhasPorLogin.registrar(chaveLogin) }

  // O campo aceita e-mail (superadmin/contas antigas) ou o nome de usuário
  // definido no cadastro — usuário não tem '@', então dá pra distinguir.
  let email = login
  if (login && !login.includes('@')) {
    const resolvido = await buscarEmailPorUsuario(getAdminSupabase(), login)
    if (!resolvido) {
      falhou()
      redirect(`/login?error=${encodeURIComponent('Usuário ou senha inválidos.')}`)
    }
    email = resolvido
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    falhou()
    // Falha de login vai para a auditoria da loja do usuário (quando o login existe).
    await auditarFalhaDeLogin(email).catch(() => {})
    redirect(`/login?error=${encodeURIComponent('Usuário ou senha inválidos.')}`)
  }

  falhasPorLogin.limpar(chaveLogin)
  const admin = getAdminSupabase()

  if (isSuperAdminEmail(data.user.email)) {
    await registrarLogin(admin, data.user.id)
    redirect('/superadmin')
  }

  const status = await buscarStatusAcesso(admin, data.user.id)
  if (!status?.restauranteId || !status.autorizado) {
    await supabase.auth.signOut()
    redirect('/login?error=pendente')
  }
  if (!acessoValido(status)) {
    await supabase.auth.signOut()
    redirect(`/login?error=${encodeURIComponent('Seu acesso expirou. Fale com a Menuzia para renovar.')}`)
  }

  // Funcionário desativado pelo estabelecimento não entra. A RLS e o middleware já o
  // barrariam no primeiro clique; recusar aqui evita a tela vazia e diz o porquê.
  const { data: perfil } = await admin
    .from('usuarios')
    .select('papel, desativado_em, restaurante_id')
    .eq('id', data.user.id)
    .maybeSingle()
  if (perfil?.desativado_em) {
    await supabase.auth.signOut()
    redirect(`/login?error=${encodeURIComponent('Seu acesso foi desativado. Fale com o responsável pela loja.')}`)
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
      redirect(`/login?error=${encodeURIComponent('O acesso desta loja está suspenso. Fale com o responsável.')}`)
    }
  }

  await registrarLogin(admin, data.user.id)
  await registrarEntrada(admin, data.user.id).catch((e) => console.error('[login] sessão não registrada:', (e as Error).message))
  redirect(await telaInicialDo(admin, data.user.id))
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

async function financeiroLigado(admin: ReturnType<typeof getAdminSupabase>, restauranteId: string | undefined): Promise<boolean> {
  return (await nivelFinanceiro(admin, restauranteId)).financeiro
}

async function auditarFalhaDeLogin(email: string) {
  const admin = getAdminSupabase()
  const { data: u } = await admin.from('usuarios').select('id, nome, restaurante_id').eq('email', email).maybeSingle()
  if (!u?.restaurante_id || !(await financeiroLigado(admin, u.restaurante_id as string))) return
  const d = await dispositivoDaRequisicao()
  await registrarAuditoria(admin, { restauranteId: u.restaurante_id as string, usuarioId: null, usuarioNome: 'Sistema', acao: 'sessao.login_falhou', entidade: 'usuario', entidadeId: u.id as string, dados: { login: u.nome, dispositivo: d.dispositivo } })
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
