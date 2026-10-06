'use client'

/**
 * Peças da sacola e do checkout no padrão iFood (pendência 9, 2026-10-06).
 *
 * Só apresentação: quem decide preço, cupom, frete e etapa continua sendo a vitrine
 * (app/loja/[slug]/vitrine.tsx). Medidas em px (a raiz do painel é 87,5%), peso de fonte
 * até 600 e cores sólidas com contraste ≥ 4,5:1 sobre o fundo em que aparecem.
 */
import type { ReactNode } from 'react'

/** Verde dos selos de desconto e dos valores economizados (5,4:1 com branco). */
export const VERDE_DESCONTO = '#0B7A3E'
/** Roxo do benefício de clube/fidelidade (6,9:1 com branco). */
export const ROXO_CLUBE = '#6D28D9'

/**
 * Diamante do clube/fidelidade. Desenho próprio da Menuzia (um losango facetado em três
 * tons de roxo) — não é o arquivo do iFood.
 */
export function DiamanteRoxo({ tamanho = 14, className = '' }: { tamanho?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={tamanho} height={tamanho} aria-hidden className={`inline-block flex-shrink-0 ${className}`} data-diamante>
      <path d="M4.2 2h7.6L15 6 8 14.5 1 6z" fill={ROXO_CLUBE} />
      <path d="M1 6h14L8 14.5z" fill="#5B21B6" />
      <path d="M4.2 2 6 6h4l1.8-4z" fill="#8B5CF6" />
      <path d="M6 6 8 14.5 10 6z" fill="#7C3AED" />
    </svg>
  )
}

/** Selo roxo "◆ Clube" / "◆ -44%": benefício exclusivo (prêmio de fidelidade). */
export function SeloRoxo({ children }: { children: ReactNode }) {
  return (
    <span
      data-selo-roxo
      className="inline-flex h-[20px] items-center gap-[4px] whitespace-nowrap rounded-[4px] px-[6px] text-[11.5px] font-semibold leading-[20px] text-white"
      style={{ background: ROXO_CLUBE }}
    >
      <DiamanteRoxoBranco />
      {children}
    </span>
  )
}

/** Versão clara do diamante, para ir dentro do selo roxo. */
function DiamanteRoxoBranco() {
  return (
    <svg viewBox="0 0 16 16" width={11} height={11} aria-hidden className="flex-shrink-0">
      <path d="M4.2 2h7.6L15 6 8 14.5 1 6z" fill="#FFFFFF" />
      <path d="M1 6h14L8 14.5z" fill="#E9D5FF" />
    </svg>
  )
}

/** − 1 + redondo. Com 1 unidade e `lixeiraNoUm`, o − vira lixeira (padrão iFood). */
export function StepperRedondo({
  qtd, onMenos, onMais, lixeiraNoUm = false, desabilitaMenos = false, desabilitaMais = false, rotulo, tamanho = 32,
}: {
  qtd: number; onMenos: () => void; onMais: () => void; lixeiraNoUm?: boolean
  desabilitaMenos?: boolean; desabilitaMais?: boolean; rotulo?: string; tamanho?: number
}) {
  const lixeira = lixeiraNoUm && qtd <= 1
  const botao = 'flex flex-shrink-0 items-center justify-center rounded-full text-[var(--tema-dark)] transition-colors hover:bg-[var(--tema-light)] active:scale-95 disabled:text-[#C4C4C4] disabled:hover:bg-transparent'
  return (
    <div className="flex flex-shrink-0 items-center rounded-full border border-[#E5E5E5] bg-white" data-stepper>
      <button
        type="button"
        onClick={onMenos}
        disabled={desabilitaMenos}
        aria-label={lixeira ? `Remover ${rotulo ?? 'item'}` : `Diminuir ${rotulo ?? ''}`.trim()}
        className={botao}
        style={{ width: tamanho, height: tamanho }}
        data-acao={lixeira ? 'remover' : 'menos'}
      >
        {lixeira ? (
          <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
        ) : (
          <span className="text-[20px] font-semibold leading-none">−</span>
        )}
      </button>
      <span className="min-w-[22px] text-center text-[14px] font-semibold text-[#3D3D3D]" data-qtd>{qtd}</span>
      <button
        type="button"
        onClick={onMais}
        disabled={desabilitaMais}
        aria-label={`Aumentar ${rotulo ?? ''}`.trim()}
        className={botao}
        style={{ width: tamanho, height: tamanho }}
        data-acao="mais"
      >
        <span className="text-[20px] font-semibold leading-none">+</span>
      </button>
    </div>
  )
}

/** Título de seção da sacola/checkout ("Itens adicionados", "Peça também"…). */
export function TituloSecao({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="mb-[12px] flex items-center justify-between gap-2">
      <h3 className="text-[16px] font-semibold leading-[20px] text-[#1F1F1F]">{children}</h3>
      {acao}
    </div>
  )
}

/** Linha de valor do resumo. `verde` = desconto/economia. */
export function LinhaValor({ rotulo, valor, verde = false, forte = false, testid }: { rotulo: ReactNode; valor: ReactNode; verde?: boolean; forte?: boolean; testid?: string }) {
  return (
    <div
      data-testid={testid}
      className={['flex items-center justify-between gap-3 py-[4px]', forte ? 'text-[16px] font-semibold text-[#1F1F1F]' : 'text-[14px] text-[#5C5C5C]'].join(' ')}
      style={verde ? { color: VERDE_DESCONTO, fontWeight: 600 } : undefined}
    >
      <span className="min-w-0">{rotulo}</span>
      <span className="flex-shrink-0">{valor}</span>
    </div>
  )
}

/** Cartão de opção com rádio à direita (entrega, pagamento). */
export function OpcaoRadio({
  ativo, onClick, titulo, subtitulo, direita, icone, testid,
}: { ativo: boolean; onClick: () => void; titulo: ReactNode; subtitulo?: ReactNode; direita?: ReactNode; icone?: ReactNode; testid?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      data-testid={testid}
      className={[
        'mb-[8px] flex w-full items-center gap-[12px] rounded-[8px] border bg-white px-[14px] py-[12px] text-left transition-colors',
        ativo ? 'border-[var(--tema-primaria)] shadow-[0_0_0_1px_var(--tema-primaria)]' : 'border-[#E5E5E5] hover:border-[#BDBDBD]',
      ].join(' ')}
    >
      {icone && <span className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-[8px] bg-[#F5F5F5]">{icone}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold leading-[18px] text-[#3D3D3D]">{titulo}</span>
        {subtitulo && <span className="mt-[2px] block text-[12px] leading-[16px] text-[#5C5C5C]">{subtitulo}</span>}
      </span>
      {direita && <span className="flex-shrink-0 text-[14px] font-semibold text-[#3D3D3D]">{direita}</span>}
      <span className={['flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-full border-2', ativo ? 'border-[var(--tema-primaria)]' : 'border-[#BDBDBD]'].join(' ')}>
        {ativo && <span className="h-[10px] w-[10px] rounded-full bg-[var(--tema-primaria)]" />}
      </span>
    </button>
  )
}

/** Barra fixa do fim: total + economia à esquerda, botão à direita. */
export function BarraTotal({
  total, legenda, economia, botao, onClick, desabilitado = false, testid,
}: { total: string; legenda: string; economia?: string | null; botao: string; onClick: () => void; desabilitado?: boolean; testid?: string }) {
  return (
    <div className="flex items-center gap-[12px]" data-testid={testid}>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] leading-[16px] text-[#5C5C5C]">{legenda}</div>
        <div className="truncate text-[16px] font-semibold leading-[20px] text-[#1F1F1F]" data-total>{total}</div>
        {economia && <div className="truncate text-[12px] font-semibold leading-[16px]" style={{ color: VERDE_DESCONTO }} data-economia>Economia de {economia}</div>}
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={desabilitado}
        className="min-w-[150px] flex-shrink-0 rounded-[8px] bg-[#0B7A3E] px-[20px] py-[14px] text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-[#096634] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {botao}
      </button>
    </div>
  )
}
