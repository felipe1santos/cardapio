import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { cadastrar } from './actions'

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <form
        action={cadastrar}
        className="w-full max-w-sm rounded-menuzia border border-border bg-main p-6 shadow-sm"
      >
        <h1 className="mb-1 text-lg font-semibold text-text-main">menuzia</h1>
        <p className="mb-5 text-xs text-text-subtle">Crie sua conta para usar a plataforma</p>

        {error && (
          <p className="mb-4 rounded-menuzia bg-danger-bg px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            Nome da hamburgueria
          </span>
          <input
            name="nomeLoja"
            type="text"
            required
            className="w-full rounded-menuzia border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            Seu nome
          </span>
          <input
            name="nome"
            type="text"
            required
            className="w-full rounded-menuzia border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            Telefone / WhatsApp
          </span>
          <input
            name="telefone"
            type="tel"
            required
            placeholder="(00) 00000-0000"
            className="w-full rounded-menuzia border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            E-mail
          </span>
          <input
            name="email"
            type="email"
            required
            className="w-full rounded-menuzia border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            Senha
          </span>
          <input
            name="senha"
            type="password"
            required
            minLength={6}
            className="w-full rounded-menuzia border border-border px-3 py-2 text-sm"
          />
        </label>

        <label className="mb-5 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle">
            Confirmar senha
          </span>
          <input
            name="confirmarSenha"
            type="password"
            required
            minLength={6}
            className="w-full rounded-menuzia border border-border px-3 py-2 text-sm"
          />
        </label>

        <Button type="submit" className="w-full">
          Cadastrar
        </Button>

        <p className="mt-4 text-center text-xs text-text-subtle">
          Já tem conta?{' '}
          <Link href="/login" className="font-semibold text-primary">
            Entrar
          </Link>
        </p>
      </form>
    </main>
  )
}
