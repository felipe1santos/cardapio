import Link from 'next/link'
import { AuthShell, authInput, authButton } from '@/components/auth/auth-shell'
import { cadastrar } from './actions'

const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle'

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <AuthShell heading="Inscrever-se">
      <form action={cadastrar}>
        <p className="mb-5 text-center text-xs text-text-subtle">
          Primeiro acesso — use o e-mail que a Menuzia cadastrou para você
        </p>

        {error && (
          <p className="mb-4 rounded-menuzia bg-danger-bg px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <label className="mb-3 block">
          <span className={labelClass}>E-mail</span>
          <input name="email" type="email" required className={authInput} />
        </label>

        <label className="mb-3 block">
          <span className={labelClass}>Senha</span>
          <input name="senha" type="password" required minLength={6} className={authInput} />
        </label>

        <label className="mb-3 block">
          <span className={labelClass}>Confirmar senha</span>
          <input name="confirmarSenha" type="password" required minLength={6} className={authInput} />
        </label>

        <label className="mb-3 block">
          <span className={labelClass}>Seu nome</span>
          <input name="nome" type="text" required className={authInput} />
        </label>

        <label className="mb-3 block">
          <span className={labelClass}>Telefone / WhatsApp</span>
          <input name="telefone" type="tel" required placeholder="(00) 00000-0000" className={authInput} />
        </label>

        <label className="mb-5 block">
          <span className={labelClass}>Nome da hamburgueria</span>
          <input name="nomeLoja" type="text" required className={authInput} />
        </label>

        <button type="submit" className={authButton}>
          Concluir cadastro
        </button>

        <p className="mt-4 text-center text-xs text-text-subtle">
          Já tem conta?{' '}
          <Link href="/login" className="font-semibold text-[#21478C]">
            Entrar
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}
