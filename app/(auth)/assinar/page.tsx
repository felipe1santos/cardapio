import Link from 'next/link'
import { AuthShell, authLink } from '@/components/auth/auth-shell'
import { planoValido } from '@/lib/assinatura/planos'
import { AssinarForm } from './assinar-form'

/**
 * "Adquirir acesso" (docs/ASSINATURA-ASAAS.md): plano + cadastro → fatura do Asaas. O acesso abre quando o
 * pagamento é confirmado; até lá a conta existe bloqueada.
 */
export default async function AssinarPage({ searchParams }: { searchParams: Promise<{ error?: string; plano?: string }> }) {
  const { error, plano } = await searchParams
  return (
    <AuthShell
      heading="Adquirir acesso"
      subtitulo="Escolha o plano, preencha os dados e pague a primeira mensalidade. O acesso é liberado na hora em que o pagamento é confirmado."
      rodape={
        <>
          Já tem uma conta? <Link href="/login" className={authLink}>Entrar</Link>
        </>
      }
    >
      <AssinarForm error={error} planoInicial={planoValido(plano) ? plano : 'completo'} />
    </AuthShell>
  )
}
