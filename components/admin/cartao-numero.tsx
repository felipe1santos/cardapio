'use client'

/**
 * Cartão de número do painel — o mesmo desenho do Dashboard: ícone em bolha
 * colorida, rótulo pequeno e o valor em destaque. Cada cartão tem um tom
 * próprio da paleta oficial para a fileira não virar um bloco de uma cor só.
 */
export const TONS_PAINEL = {
  verde: { fundo: '#DCFCE7', cor: '#16A34A' },
  laranja: { fundo: '#FFEDD5', cor: '#EA580C' },
  roxo: { fundo: '#F3E8FF', cor: '#9333EA' },
  azul: { fundo: '#E0F2FE', cor: '#0369A1' },
  ambar: { fundo: '#FEF3C7', cor: '#B45309' },
  vermelho: { fundo: '#FEE2E2', cor: '#DC2626' },
  cinza: { fundo: '#F1F2F4', cor: '#4B5563' },
} as const
export type TomPainel = keyof typeof TONS_PAINEL

export function CartaoNumero({
  icone,
  rotulo,
  valor,
  tom = 'roxo',
  detalhe,
  className = '',
}: {
  icone: string[]
  rotulo: string
  valor: React.ReactNode
  tom?: TomPainel
  /** Linha pequena abaixo do valor ("3 em rota", "R$ 40 de troco"). */
  detalhe?: React.ReactNode
  className?: string
}) {
  const t = TONS_PAINEL[tom]
  return (
    <div className={`flex items-center gap-3 rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white px-4 py-3 ${className}`}>
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: t.fundo, color: t.cor }}>
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
          {icone.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </span>
      <div className="min-w-0">
        <p className="truncate text-[12px] text-[var(--adm-texto-medio)]">{rotulo}</p>
        <p className="text-[20px] font-bold leading-tight text-[var(--adm-texto)]">{valor}</p>
        {detalhe && <p className="truncate text-[11px] text-[var(--adm-texto-suave)]">{detalhe}</p>}
      </div>
    </div>
  )
}
