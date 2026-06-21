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
    <main className="flex min-h-screen flex-col bg-primary">
      {/* Marca */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-12 pt-20 text-center">
        <div className="flex items-center gap-2.5">
          <span className="text-4xl font-extrabold tracking-tight text-white">Menuzia</span>
          <span className="flex h-9 w-9 items-center justify-center rounded-menuzia bg-white text-2xl font-extrabold leading-none text-primary">
            +
          </span>
        </div>
        <p className="mt-2 text-sm font-medium text-white/80">Peça com facilidade</p>
      </div>

      {/* Sheet de login */}
      <div className="rounded-t-[2rem] bg-main px-6 pb-12 pt-9 shadow-[0_-8px_28px_rgba(0,0,0,0.12)]">
        <form action={signIn} className="mx-auto w-full max-w-sm">
          <h1 className="mb-6 text-center text-xl font-bold text-text-main">Login</h1>

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
            className="mb-3 w-full rounded-menuzia border border-transparent bg-page px-4 py-3 text-sm text-text-main placeholder:text-text-subtle focus:border-primary focus:bg-white focus:outline-none"
          />

          <input
            name="password"
            type="password"
            required
            placeholder="Senha"
            aria-label="Senha"
            className="mb-5 w-full rounded-menuzia border border-transparent bg-page px-4 py-3 text-sm text-text-main placeholder:text-text-subtle focus:border-primary focus:bg-white focus:outline-none"
          />

          <Button type="submit" className="w-full py-3 text-sm">
            Entrar
          </Button>

          <div className="mt-5 flex items-center justify-between text-xs font-semibold text-primary">
            <Link href="/recuperar-senha">Recuperar Senha</Link>
            <Link href="/cadastro">Inscrever-se</Link>
          </div>
        </form>
      </div>
    </main>
  )
}
