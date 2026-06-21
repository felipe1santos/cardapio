import Link from 'next/link'
import { AuthShell, authInput, authButton } from '@/components/auth/auth-shell'
import { signIn } from './actions'

const ERROR_MESSAGES: Record<string, string> = {
  pendente: 'Seu cadastro ainda não foi concluído. Acesse o link de primeiro acesso enviado pela Menuzia.',
}

const NOTICE_MESSAGES: Record<string, string> = {
  'cadastro-concluido': 'Cadastro concluído! Faça login com seu e-mail e senha.',
  'senha-alterada': 'Senha alterada! Faça login com a nova senha.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>
}) {
  const { error, notice } = await searchParams
  const errorMessage = error ? ERROR_MESSAGES[error] ?? error : null
  const noticeMessage = notice ? NOTICE_MESSAGES[notice] ?? null : null

  return (
    <AuthShell heading="Login">
      <form action={signIn}>
        {noticeMessage && (
          <p className="mb-4 rounded-menuzia bg-price-bg px-3 py-2 text-xs text-price-text">
            {noticeMessage}
          </p>
        )}

        {errorMessage && (
          <p className="mb-4 rounded-menuzia bg-danger-bg px-3 py-2 text-xs text-danger">
            {errorMessage}
          </p>
        )}

        <input
          name="email"
          type="text"
          required
          placeholder="E-mail"
          aria-label="E-mail"
          className={`mb-3 ${authInput}`}
        />

        <input
          name="password"
          type="password"
          required
          placeholder="Senha"
          aria-label="Senha"
          className={`mb-5 ${authInput}`}
        />

        <button type="submit" className={authButton}>
          Entrar
        </button>

        <div className="mt-5 flex items-center justify-between text-xs font-semibold text-[#21478C]">
          <Link href="/recuperar-senha">Trocar Senha</Link>
          <Link href="/cadastro">Inscrever-se</Link>
        </div>
      </form>
    </AuthShell>
  )
}
