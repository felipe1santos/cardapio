import Link from 'next/link'
import { AuthShell, authInput, authButton } from '@/components/auth/auth-shell'
import { signIn } from './actions'

const ERROR_MESSAGES: Record<string, string> = {
  pendente: 'Seu cadastro ainda não foi concluído. Acesse o link de primeiro acesso enviado pela Menuzia.',
}

const NOTICE_MESSAGES: Record<string, string> = {
  'cadastro-concluido': 'Cadastro concluído! Faça login com seu usuário e senha.',
  'senha-alterada': 'Senha alterada! Faça login com a nova senha.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; next?: string }>
}) {
  const { error, notice, next } = await searchParams
  // Vindo do app do motoboy (10/10): depois de entrar, volta para lá (no pedido do QR). O servidor valida o destino.
  const voltar = typeof next === 'string' && next.startsWith('/motoboy') ? next : null
  const errorMessage = error ? ERROR_MESSAGES[error] ?? error : null
  const noticeMessage = notice ? NOTICE_MESSAGES[notice] ?? null : null

  return (
    <AuthShell heading="Login" backgroundImage="/login-bg.webp">
      <form action={signIn}>
        {voltar && <input type="hidden" name="next" value={voltar} />}
        {voltar && (
          <p className="mb-4 rounded-menuzia bg-alert-bg px-3 py-2 text-xs text-alert-text" data-testid="login-motoboy-aviso">
            Entregador: entre com o login e a senha que a loja te passou.
          </p>
        )}
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
          autoComplete="username"
          required
          placeholder="Usuário ou e-mail"
          aria-label="Usuário ou e-mail"
          className={`mb-3 ${authInput}`}
        />

        <input
          name="password"
          type="password"
          autoComplete="current-password"
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
