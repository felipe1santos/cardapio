'use server'

import { redirect } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import { acessoValido, buscarEmailPorUsuario, buscarStatusAcesso, registrarLogin } from '@/lib/queries/lojistas'
import { telaInicialDoPapel } from '@/lib/auth/rotas'

export async function signIn(formData: FormData) {
  const login = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  // O campo aceita e-mail (superadmin/contas antigas) ou o nome de usuário
  // definido no cadastro — usuário não tem '@', então dá pra distinguir.
  let email = login
  if (login && !login.includes('@')) {
    const resolvido = await buscarEmailPorUsuario(getAdminSupabase(), login)
    if (!resolvido) {
      redirect(`/login?error=${encodeURIComponent('Usuário ou senha inválidos.')}`)
    }
    email = resolvido
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    redirect(`/login?error=${encodeURIComponent('Usuário ou senha inválidos.')}`)
  }

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
  redirect(await telaInicialDo(admin, data.user.id))
}

/**
 * Primeira tela depois do login, pelo papel. O Dashboard é faturamento: abrir o garçom
 * nele seria mandá-lo para uma tela que ele não pode usar. Dono continua indo para o
 * Dashboard, como sempre.
 */
async function telaInicialDo(admin: ReturnType<typeof getAdminSupabase>, userId: string): Promise<string> {
  const { data } = await admin.from('usuarios').select('papel').eq('id', userId).maybeSingle()
  const destino = telaInicialDoPapel((data?.papel as string | undefined) ?? null)
  // Papel sem tela nenhuma no painel (ex.: entregador, que entra pelo portal de token).
  return destino === '/login' ? '/admin/dashboard' : destino
}
