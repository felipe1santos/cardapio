import type { CSSProperties } from 'react'
import { Gift, Percent, Truck, type LucideIcon } from 'lucide-react'

/**
 * Peças visuais da aba Cupons da vitrine (26/10/2026): barra de progresso "líquida", selo colorido do
 * prêmio (no lugar da miniatura cinza) e o canhoto do cupom com o valor em destaque.
 * Efeitos só em CSS (globals.css, .barra-fluida*): param com "reduzir movimento" e no design Simples.
 */

type TipoPremio = 'item_gratis' | 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis'

const SELO: Record<TipoPremio, { Icone: LucideIcon; fundo: string; cor: string }> = {
  item_gratis: { Icone: Gift, fundo: 'linear-gradient(135deg,#FEF3C7,#FDE68A)', cor: '#B45309' },
  desconto_percentual: { Icone: Percent, fundo: 'linear-gradient(135deg,#FFE4E6,#FECDD3)', cor: '#BE123C' },
  desconto_valor: { Icone: Percent, fundo: 'linear-gradient(135deg,#FFE4E6,#FECDD3)', cor: '#BE123C' },
  entrega_gratis: { Icone: Truck, fundo: 'linear-gradient(135deg,#E0F2FE,#BAE6FD)', cor: '#0369A1' },
}

/** Selo do prêmio quando ele não tem foto de item: ícone do tipo sobre um degradê suave. */
export function SeloPremio({ tipo, tamanho = 56 }: { tipo: TipoPremio; tamanho?: number }) {
  const { Icone, fundo, cor } = SELO[tipo] ?? SELO.item_gratis
  return (
    <span
      aria-hidden="true"
      data-canto
      className="flex flex-shrink-0 items-center justify-center rounded-[12px]"
      style={{ width: tamanho, height: tamanho, background: fundo }}
    >
      <Icone style={{ width: tamanho * 0.44, height: tamanho * 0.44, color: cor }} strokeWidth={2.2} />
    </span>
  )
}

/**
 * Barra de progresso com cara de líquido: enche ao aparecer, a ponta ondula e sobem bolhas.
 * `percentual` de 0 a 100.
 */
export function BarraFluida({ percentual, rotulo }: { percentual: number; rotulo: string }) {
  const p = Math.min(100, Math.max(0, percentual))
  return (
    <div
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p)}
      className="barra-fluida relative h-[14px] overflow-hidden rounded-full bg-[#ECEFF3]"
    >
      <div className="barra-fluida-nivel absolute inset-y-0 left-0 rounded-full" style={{ '--p': `${p}%` } as CSSProperties}>
        <span className="barra-fluida-brilho" />
        <span className="barra-fluida-bolha" style={{ left: '22%', animationDelay: '0s' }} />
        <span className="barra-fluida-bolha" style={{ left: '55%', animationDelay: '1.1s' }} />
        <span className="barra-fluida-bolha" style={{ left: '78%', animationDelay: '2.2s' }} />
        {p > 0 && p < 100 && <span className="barra-fluida-ponta" />}
      </div>
    </div>
  )
}

/**
 * Máscara do cartão-ticket: recorta meias-luas em cima e embaixo na linha do picote (88px = largura do
 * canhoto), mostrando o fundo real da página, seja ele qual for.
 */
const LUA = 'radial-gradient(circle at 88px VAR, transparent 7px, #000 7.5px)'
export const MASCARA_TICKET: CSSProperties = {
  WebkitMaskImage: `${LUA.replace('VAR', '0')}, ${LUA.replace('VAR', '100%')}`,
  maskImage: `${LUA.replace('VAR', '0')}, ${LUA.replace('VAR', '100%')}`,
  WebkitMaskSize: '100% 51%',
  maskSize: '100% 51%',
  WebkitMaskPosition: 'top, bottom',
  maskPosition: 'top, bottom',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
}

/** Canhoto do cupom: o valor grande, na cor da loja, separado do resto por um picote. */
export function CanhotoCupom({ tipo, valor }: { tipo: TipoPremio; valor: number | null }) {
  const grande =
    tipo === 'desconto_percentual' ? `${valor ?? 0}%`
    : tipo === 'desconto_valor' ? `R$ ${Math.round(valor ?? 0)}`
    : tipo === 'entrega_gratis' ? 'Frete'
    : 'Grátis'
  const pequeno = tipo === 'entrega_gratis' ? 'grátis' : tipo === 'item_gratis' ? 'item' : 'OFF'
  return (
    <div className="relative flex w-[88px] flex-shrink-0 flex-col items-center justify-center bg-[var(--tema-primaria)] px-[6px] py-[14px] text-center text-white">
      <span className="text-[24px] font-semibold leading-none tracking-tight">{grande}</span>
      <span className="mt-[4px] text-[11px] font-semibold uppercase tracking-[0.08em] opacity-85">{pequeno}</span>
      {/* picote: tracejado; as meias-luas vêm da máscara do cartão (MASCARA_TICKET) */}
      <span aria-hidden="true" className="absolute bottom-[10px] right-0 top-[10px] border-r-2 border-dashed border-white/40" />
    </div>
  )
}
