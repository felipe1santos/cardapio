import { redirect } from 'next/navigation'
import { AuthShell, authAviso, authButton, authInput, authLabel } from '@/components/auth/auth-shell'
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
    <AuthShell heading="Nova senha" subtitulo="Defina sua nova senha de acesso. Mínimo de 6 caracteres.">
      <form action={redefinirSenha}>

        {error && <p role="alert" className={authAviso.erro}>{error}</p>}

        <label htmlFor="nova-senha" className={authLabel}>Nova senha</label>
        <input
          id="nova-senha"
          name="senha"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          className={authInput}
        />

        <label htmlFor="confirmar-senha" className={`mt-[20px] ${authLabel}`}>Confirmar nova senha</label>
        <input
          id="confirmar-senha"
          name="confirmarSenha"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          className={authInput}
        />

        <button type="submit" className={`mt-[28px] ${authButton}`}>
          Salvar nova senha
        </button>
      </form>
    </AuthShell>
  )
}
