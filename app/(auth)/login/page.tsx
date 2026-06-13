import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { signIn } from './actions'

const ERROR_MESSAGES: Record<string, string> = {
  pendente: 'Seu cadastro ainda não foi concluído. Acesse o link de primeiro acesso enviado pela Menuzia.',
}

const NOTICE_MESSAGES: Record<string, string> = {
  'cadastro-concluido': 'Cadastro concluído! Faça login com seu e-mail e senha.',
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
    <main className="flex min-h-screen items-center justify-center bg-page">
      <form
        action={signIn}
        className="w-full max-w-sm rounded-menuzia border border-border bg-main p-6 shadow-sm"
      >
        <h1 className="mb-1 text-lg font-semibold text-text-main">menuzia</h1>
        <p className="mb-5 text-xs text-text-subtle">Entre com sua conta da loja</p>

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

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            E-mail
          </span>
          <input
            name="email"
            type="text"
            required
            className="w-full rounded-menuzia border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="mb-5 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            Senha
          </span>
          <input
            name="password"
            type="password"
            required
            className="w-full rounded-menuzia border border-border px-3 py-2 text-sm"
          />
        </label>

        <Button type="submit" className="w-full">
          Entrar
        </Button>

        <p className="mt-4 text-center text-xs text-text-subtle">
          Primeiro acesso?{' '}
          <Link href="/cadastro" className="font-semibold text-primary">
            Complete seu cadastro
          </Link>
        </p>
      </form>
    </main>
  )
}
