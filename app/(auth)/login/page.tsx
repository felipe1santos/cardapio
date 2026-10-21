import Link from 'next/link'
import { AuthShell, authInput, authButton } from '@/components/auth/auth-shell'
import { entrarComGoogle, signIn } from './actions'
import { googleLigado } from '@/lib/auth/google'

const ERROR_MESSAGES: Record<string, string> = {
  pendente: 'Seu cadastro ainda não foi concluído. Acesse o link de primeiro acesso enviado pela Menuzia.',
  'google-sem-conta': 'Não encontramos uma conta Menuzia com este e-mail. Fale com o suporte.',
  'google-falhou': 'Não foi possível entrar com o Google. Tente de novo ou entre com usuário e senha.',
}

const NOTICE_MESSAGES: Record<string, string> = {
  'cadastro-concluido': 'Cadastro concluído! Faça login com seu usuário e senha.',
  'senha-alterada': 'Senha alterada! Faça login com a nova senha.',
  kds: 'A tela da cozinha agora é o KDS. Entre com o usuário da cozinha (a loja cria em Equipe › cargo Cozinha).',
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
  // Escondido até o provedor Google ser ligado no Supabase (o motoboy entra só com login e senha).
  const comGoogle = !voltar && (await googleLigado())

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
      {comGoogle && (
        <form action={entrarComGoogle} className="mt-5">
          <div className="mb-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-text-subtle">
            <span className="h-px flex-1 bg-border" />ou<span className="h-px flex-1 bg-border" />
          </div>
          <button type="submit" data-testid="login-google"
            className="flex h-[44px] w-full items-center justify-center gap-2.5 rounded-menuzia border border-border bg-white text-[14px] font-semibold text-text-main transition-colors hover:bg-page">
            <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Continuar com Google
          </button>
        </form>
      )}
    </AuthShell>
  )
}
