import Link from 'next/link'
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
    <main className="flex min-h-screen flex-col bg-[#1D3E73] sm:items-center sm:justify-center sm:py-8">
      {/* Container: tela cheia no mobile, cartão centralizado no desktop */}
      <div className="flex min-h-screen w-full flex-col sm:min-h-0 sm:max-w-[440px] sm:overflow-hidden sm:rounded-[28px] sm:shadow-2xl">
        {/* Marca */}
        <div className="flex flex-1 flex-col items-center justify-center bg-[#1D3E73] px-6 pb-14 pt-20 text-center sm:flex-none sm:py-16">
          <div className="flex items-center gap-2.5">
            <span className="text-4xl font-extrabold tracking-tight text-white">Menuzia</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-menuzia bg-[#E85D2A] text-2xl font-extrabold leading-none text-white">
              +
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-white/80">Peça com facilidade</p>
        </div>

        {/* Sheet de login */}
        <div className="rounded-t-[28px] bg-white px-6 pb-12 pt-9 shadow-[0_-8px_28px_rgba(0,0,0,0.12)] sm:rounded-none sm:shadow-none">
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
              className="mb-3 w-full rounded-menuzia border border-transparent bg-[#EFF0F2] px-4 py-3 text-sm text-text-main placeholder:text-text-subtle focus:border-[#1D3E73] focus:bg-white focus:outline-none"
            />

            <input
              name="password"
              type="password"
              required
              placeholder="Senha"
              aria-label="Senha"
              className="mb-5 w-full rounded-menuzia border border-transparent bg-[#EFF0F2] px-4 py-3 text-sm text-text-main placeholder:text-text-subtle focus:border-[#1D3E73] focus:bg-white focus:outline-none"
            />

            <button
              type="submit"
              className="w-full rounded-menuzia bg-[#21478C] py-3 text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#1D3E73]"
            >
              Entrar
            </button>

            <div className="mt-5 flex items-center justify-between text-xs font-semibold text-[#21478C]">
              <Link href="/recuperar-senha">Recuperar Senha</Link>
              <Link href="/cadastro">Inscrever-se</Link>
            </div>
          </form>
        </div>
      </div>
    </main>
  )
}
