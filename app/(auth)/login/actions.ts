'use server'

import { redirect } from 'next/navigation'
import { MSG_LOGIN_INVALIDO } from '@/lib/auth/mensagens-acesso'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEmailPorUsuario } from '@/lib/queries/lojistas'
import { headers } from 'next/headers'
import { criarLimitador, ipDaRequisicao } from '@/lib/limite-taxa'
import { dispositivoDaRequisicao } from '@/lib/financeiro/contexto'
import { concluirEntrada } from '@/lib/auth/entrada'
import { urlPublica } from '@/lib/url-publica'
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
  // Volta do app do motoboy (10/10): /motoboy sem sessão manda para cá com o pedido do QR; erro mantém o destino.
  const proximo = destinoDoMotoboy(formData.get('next'))
  const nx = proximo ? `next=${encodeURIComponent(proximo)}&` : ''
  const chaveIp = `ip:${ipDaRequisicao(await headers())}`
  const chaveLogin = `login:${login.toLowerCase()}`
  if (falhasPorIp.excedeu(chaveIp) || falhasPorLogin.excedeu(chaveLogin)) {
    redirect(`/login?${nx}error=${encodeURIComponent(MSG_MUITAS)}`)
  }
  const falhou = () => { falhasPorIp.registrar(chaveIp); falhasPorLogin.registrar(chaveLogin) }

  // O campo aceita e-mail (superadmin/contas antigas) ou o nome de usuário
  // definido no cadastro — usuário não tem '@', então dá pra distinguir.
  let email = login
  if (login && !login.includes('@')) {
    const resolvido = await buscarEmailPorUsuario(getAdminSupabase(), login)
    if (!resolvido) {
      falhou()
      redirect(`/login?${nx}error=${encodeURIComponent(MSG_LOGIN_INVALIDO)}`)
    }
    email = resolvido
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    falhou()
    // Falha de login vai para a auditoria da loja do usuário (quando o login existe).
    await auditarFalhaDeLogin(email).catch(() => {})
    redirect(`/login?${nx}error=${encodeURIComponent(MSG_LOGIN_INVALIDO)}`)
  }

  falhasPorLogin.limpar(chaveLogin)
  redirect(await concluirEntrada(supabase, data.user, proximo))
}

/** Só caminhos do app do motoboy (com o código do QR, se houver) — nunca um endereço de fora. */
function destinoDoMotoboy(v: FormDataEntryValue | null): string | null {
  const t = typeof v === 'string' ? v.trim() : ''
  return /^\/motoboy(\?qr=[A-Za-z0-9_-]{10,200})?$/.test(t) ? t : null
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
 * "Continuar com Google" (20/10/2026): manda para o Google pelo Supabase Auth e volta em /auth/google, que confere se o
 * e-mail tem conta Menuzia. O endereço de volta precisa estar em Authentication › URL Configuration › Redirect URLs.
 */
export async function entrarComGoogle() {
  // Endereço público fixo, nunca o Origin/Host da requisição (lib/url-publica.ts).
  const origem = urlPublica()
  const supabase = await getServerSupabase()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${origem}/auth/google`, queryParams: { prompt: 'select_account' } },
  })
  if (error || !data.url) redirect('/login?error=google-falhou')
  redirect(data.url)
}
