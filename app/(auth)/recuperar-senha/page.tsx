import Link from 'next/link'
import { AuthShell, authInput, authButton } from '@/components/auth/auth-shell'
import { solicitarTroca } from './actions'

export default async function RecuperarSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>
}) {
  const { error, sent } = await searchParams

  return (
    <AuthShell heading="Trocar Senha">
      {sent ? (
        <div className="text-center">
          <p className="mb-4 rounded-menuzia bg-price-bg px-3 py-2 text-xs text-price-text">
            Se houver uma conta com esse e-mail, enviamos um link para você definir
            uma nova senha. Verifique sua caixa de entrada (e o spam).
          </p>
          <Link href="/login" className="text-xs font-semibold text-[#21478C]">
            Voltar para o login
          </Link>
        </div>
      ) : (
        <form action={solicitarTroca}>
          <p className="mb-5 text-center text-xs text-text-subtle">
            Informe seu e-mail e enviaremos um link para você cadastrar uma nova senha.
          </p>

          {error && (
            <p className="mb-4 rounded-menuzia bg-danger-bg px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <input
            name="email"
            type="email"
            required
            placeholder="E-mail"
            aria-label="E-mail"
            className={`mb-5 ${authInput}`}
          />

          <button type="submit" className={authButton}>
            Enviar link
          </button>

          <p className="mt-4 text-center text-xs text-text-subtle">
            Lembrou a senha?{' '}
            <Link href="/login" className="font-semibold text-[#21478C]">
              Entrar
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  )
}
