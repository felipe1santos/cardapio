import { redirect } from 'next/navigation'
import { AuthShell, authInput, authButton } from '@/components/auth/auth-shell'
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
      <form action={redefinirSenha}>
        <p className="mb-5 text-center text-xs text-text-subtle">
          Defina sua nova senha de acesso.
        </p>

        {error && (
          <p className="mb-4 rounded-menuzia bg-danger-bg px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <input
          name="senha"
          type="password"
          required
          minLength={6}
          placeholder="Nova senha"
          aria-label="Nova senha"
          className={`mb-3 ${authInput}`}
        />

        <input
          name="confirmarSenha"
          type="password"
          required
          minLength={6}
          placeholder="Confirmar nova senha"
          aria-label="Confirmar nova senha"
          className={`mb-5 ${authInput}`}
        />

        <button type="submit" className={authButton}>
          Salvar nova senha
        </button>
      </form>
    </AuthShell>
  )
}
