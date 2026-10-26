import Link from 'next/link'
import { MSG_RECUPERACAO_ENVIADA } from '@/lib/auth/mensagens-acesso'
import { AuthShell, authAviso, authButton, authInput, authLink } from '@/components/auth/auth-shell'
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
      rodape={
        <span>
          Lembrou a senha? <Link href="/login" className={authLink}>Entrar</Link>
        </span>
      }
    >
      <div className="pt-[24px]">
        {sent ? (
          <p className={authAviso.ok}>
            {MSG_RECUPERACAO_ENVIADA} Verifique sua caixa de entrada (e o spam).
          </p>
        ) : (
          <form action={solicitarTroca}>
            <p className="mb-[24px] text-[14px] leading-[22px] text-[#5B5F65]">
              Informe seu e-mail e enviaremos um link para você cadastrar uma nova senha.
            </p>

            {error && <p role="alert" className={authAviso.erro}>{ERROS_CONHECIDOS[error] ?? error}</p>}

            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="E-mail"
              aria-label="E-mail"
              className={authInput}
            />

            <button type="submit" className={`mt-[40px] ${authButton}`}>
              Enviar link
            </button>
          </form>
        )}
      </div>
    </AuthShell>
  )
}
