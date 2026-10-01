import Link from 'next/link'

/** Para onde vai quem abre uma área do painel que não está nos seus acessos (0120). */
export default function SemAcessoPage() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-[420px] rounded-menuzia border border-border bg-white p-6 text-center" data-testid="sem-acesso">
        <h1 className="text-[16px] font-bold text-text-main">Você não tem acesso a esta área</h1>
        <p className="mt-1 text-[13px] text-text-subtle">Peça ao responsável pela loja para liberar em Equipe › Editar acessos.</p>
        <Link href="/admin" className="mt-4 inline-block rounded-menuzia bg-primary px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark">Ir para o início</Link>
      </div>
    </div>
  )
}
