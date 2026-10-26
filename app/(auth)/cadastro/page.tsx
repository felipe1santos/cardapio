import { AuthShell } from '@/components/auth/auth-shell'
import { CadastroForm } from './cadastro-form'

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; convite?: string }>
}) {
  const { error, convite } = await searchParams

  return (
    <AuthShell heading="Inscrever-se">
      <CadastroForm error={error} convite={convite ?? ''} />
    </AuthShell>
  )
}
