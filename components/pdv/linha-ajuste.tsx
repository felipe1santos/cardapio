'use client'

import { formatBRL } from './util'

/**
 * Linha de DESCONTO (verde) ou TAXA (azul) no resumo da conta, do Receber e do Fechar conta
 * (2026-10-01): pílula de largura total, para o operador ver de relance o que mexe no total.
 * Taxa zerada continua à vista, em tom mais claro. O "x" (quando há permissão) pede confirmação.
 */
const TOM = {
  desconto: { texto: '#1AA764', fundo: '#EBFDF5' },
  taxa: { texto: '#0369A1', fundo: '#E0F2FE' },
} as const

const ICONE = {
  // ticket
  desconto: 'M22 10V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v4a2 2 0 0 1 0 4v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 1 0-4zm-9 7.5h-2v-2h2v2zm0-4.5h-2v-2h2v2zm0-4.5h-2v-2h2v2z',
  // recibo com +
  taxa: 'M19 3H5a2 2 0 0 0-2 2v14l3-2 3 2 3-2 3 2 3-2 3 2V5a2 2 0 0 0-2-2zm-3 9h-3v3h-2v-3H8v-2h3V7h2v3h3v2z',
} as const

export function LinhaAjuste({
  tipo,
  rotulo,
  valor,
  onRemover,
  testid,
}: {
  tipo: 'desconto' | 'taxa'
  rotulo: string
  /** Positivo; o desconto aparece com o sinal de menos. */
  valor: number
  onRemover?: () => void
  testid?: string
}) {
  const t = TOM[tipo]
  const zerada = tipo === 'taxa' && Math.abs(valor) < 0.005
  return (
    <div
      className={['my-1 flex min-h-[34px] items-center gap-2 rounded-full py-1 pl-3 text-[12.5px] font-semibold', onRemover ? 'pr-1' : 'pr-3', zerada ? 'opacity-55' : ''].join(' ')}
      style={{ color: t.texto, backgroundColor: t.fundo }}
      data-testid={testid}
      data-ajuste={tipo}
      data-zerada={zerada ? '' : undefined}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 fill-current" aria-hidden><path d={ICONE[tipo]} /></svg>
      <span className="min-w-0 flex-1 truncate" title={rotulo}>{rotulo}</span>
      <span className="flex-shrink-0 tabular-nums">{tipo === 'desconto' ? `− ${formatBRL(Math.abs(valor))}` : formatBRL(valor)}</span>
      {onRemover && (
        <button
          type="button"
          onClick={onRemover}
          aria-label={`Remover ${rotulo}`}
          data-testid={testid ? `${testid}-remover` : undefined}
          className="flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-full hover:bg-white/70"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
        </button>
      )}
    </div>
  )
}
