import Link from 'next/link'
import { AuthShell, authLink } from '@/components/auth/auth-shell'
import { CadastroForm } from './cadastro-form'

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; convite?: string }>
}) {
  const { error, convite } = await searchParams

  return (
    <AuthShell
      heading="Cadastro"
      rodape={
        <span>
          Já tem uma conta? <Link href="/login" className={authLink}>Entrar</Link>
        </span>
      }
    >
      <CadastroForm error={error} convite={convite ?? ''} />
    </AuthShell>
  )
}
