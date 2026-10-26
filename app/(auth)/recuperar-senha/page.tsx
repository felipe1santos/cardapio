import Link from 'next/link'
import { MSG_RECUPERACAO_ENVIADA } from '@/lib/auth/mensagens-acesso'
import { AuthShell, authAviso, authButton, authInput, authLabel, authLink } from '@/components/auth/auth-shell'
import { solicitarTroca } from './actions'

const ERROS_CONHECIDOS: Record<string, string> = {
  'link-expirado': 'O link expirou ou já foi usado. Peça um novo abaixo.',
  'link-invalido': 'Link inválido. Peça um novo abaixo.',
  'sessao-expirada': 'A sessão de troca expirou. Peça um novo link abaixo.',
}

export default async function RecuperarSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>
}) {
  const { error, sent } = await searchParams

  return (
    <AuthShell
      heading="Trocar senha"
      subtitulo={sent ? undefined : 'Informe seu e-mail e enviaremos um link para você cadastrar uma nova senha.'}
      rodape={
        <>
          Lembrou a senha? <Link href="/login" className={authLink}>Entrar</Link>
        </>
      }
    >
      <div>
        {sent ? (
          <p className={authAviso.ok}>
            {MSG_RECUPERACAO_ENVIADA} Verifique sua caixa de entrada (e o spam).
          </p>
        ) : (
          <form action={solicitarTroca}>
            {error && <p role="alert" className={authAviso.erro}>{ERROS_CONHECIDOS[error] ?? error}</p>}

            <label htmlFor="recuperar-email" className={authLabel}>E-mail</label>
            <input
              id="recuperar-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="seu@email.com"
              className={authInput}
            />

            <button type="submit" className={`mt-[28px] ${authButton}`}>
              Enviar link
            </button>
          </form>
        )}
      </div>
    </AuthShell>
  )
}
