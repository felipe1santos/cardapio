import { redirect } from 'next/navigation'
import { AuthShell, authAviso, authButton, authInput } from '@/components/auth/auth-shell'
import { getServerSupabase } from '@/lib/supabase/server'
import { redefinirSenha } from './actions'

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  // Só acessível com a sessão de recuperação criada pelo link do e-mail.
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/recuperar-senha?error=sessao-expirada')
  }

  return (
    <AuthShell heading="Nova senha">
      <form action={redefinirSenha} className="pt-[24px]">
        <p className="mb-[24px] text-[14px] leading-[22px] text-[#5B5F65]">
          Defina sua nova senha de acesso. Mínimo de 6 caracteres.
        </p>

        {error && <p role="alert" className={authAviso.erro}>{error}</p>}

        <input
          name="senha"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          placeholder="Nova senha"
          aria-label="Nova senha"
          className={authInput}
        />

        <input
          name="confirmarSenha"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          placeholder="Confirmar nova senha"
          aria-label="Confirmar nova senha"
          className={`mt-[24px] ${authInput}`}
        />

        <button type="submit" className={`mt-[40px] ${authButton}`}>
          Salvar nova senha
        </button>
      </form>
    </AuthShell>
  )
}
