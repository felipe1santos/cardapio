import type { CSSProperties } from 'react'
import { Gift, Percent, Truck, type LucideIcon } from 'lucide-react'

/**
 * Peças visuais da aba Cupons da vitrine (26/10/2026): barra de progresso "líquida", selo colorido do
 * prêmio (no lugar da miniatura cinza) e o canhoto do cupom com o valor em destaque.
 * Efeitos só em CSS (globals.css, .barra-fluida*): param com "reduzir movimento" e no design Simples.
 */

export type TipoPremio = 'item_gratis' | 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis'

/**
 * Uma cor por tipo de benefício, igual em todo lugar (aba Cupons, sacola): desconto = roxo, item grátis =
 * âmbar, entrega grátis = azul. `forte` passa 4,5:1 com branco (canhoto, botão); `texto` passa sobre `claro`.
 */
export const COR_BENEFICIO: Record<TipoPremio, { Icone: LucideIcon; forte: string; claro: string; texto: string; degrade: string }> = {
  desconto_percentual: { Icone: Percent, forte: '#6D28D9', claro: '#F3EEFF', texto: '#5B21B6', degrade: 'linear-gradient(135deg,#F3EEFF,#E4D8FF)' },
  desconto_valor: { Icone: Percent, forte: '#6D28D9', claro: '#F3EEFF', texto: '#5B21B6', degrade: 'linear-gradient(135deg,#F3EEFF,#E4D8FF)' },
  item_gratis: { Icone: Gift, forte: '#B45309', claro: '#FFF6E5', texto: '#92400E', degrade: 'linear-gradient(135deg,#FEF3C7,#FDE68A)' },
  entrega_gratis: { Icone: Truck, forte: '#0369A1', claro: '#E8F4FD', texto: '#075985', degrade: 'linear-gradient(135deg,#E0F2FE,#BAE6FD)' },
}

/** Selo do prêmio quando ele não tem foto de item: ícone do tipo sobre um degradê suave. */
export function SeloPremio({ tipo, tamanho = 56 }: { tipo: TipoPremio; tamanho?: number }) {
  const { Icone, degrade: fundo, forte: cor } = COR_BENEFICIO[tipo] ?? COR_BENEFICIO.item_gratis
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
export function BarraFluida({ percentual, rotulo, fina = false }: { percentual: number; rotulo: string; fina?: boolean }) {
  const p = Math.min(100, Math.max(0, percentual))
  return (
    <div
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(p)}
      className={`barra-fluida relative overflow-hidden rounded-full bg-[#E9ECEF] ${fina ? 'h-[6px]' : 'h-[10px]'}`}
    >
      {/* Fina (sacola): só o brilho correndo, como líquido escorrendo. Normal (missões): + bolhas e ponta ondulada. */}
      <div className="barra-fluida-nivel absolute inset-y-0 left-0 overflow-hidden rounded-full" style={{ '--p': `${p}%` } as CSSProperties}>
        <span className="barra-fluida-correr" />
        {!fina && (
          <>
            <span className="barra-fluida-brilho" />
            <span className="barra-fluida-bolha" style={{ left: '22%', animationDelay: '0s' }} />
            <span className="barra-fluida-bolha" style={{ left: '55%', animationDelay: '1.1s' }} />
            <span className="barra-fluida-bolha" style={{ left: '78%', animationDelay: '2.2s' }} />
          </>
        )}
      </div>
    </div>
  )
}

/** Entregador de scooter com a caixa nas costas e linhas de velocidade (desenho próprio). */
export function IconeEntregador({ tamanho = 24, className = '' }: { tamanho?: number; className?: string }) {
  return (
    <svg viewBox="0 0 40 30" width={tamanho * (40 / 30)} height={tamanho} className={className} fill="currentColor" aria-hidden="true">
      {/* linhas de velocidade */}
      <rect x="0" y="12" width="8" height="2" rx="1" opacity="0.55" />
      <rect x="2" y="16.5" width="7" height="2" rx="1" opacity="0.55" />
      <rect x="0" y="21" width="8" height="2" rx="1" opacity="0.55" />
      {/* caixa de entrega */}
      <rect x="10" y="8" width="9.5" height="8.5" rx="1.6" />
      {/* capacete */}
      <circle cx="27" cy="5" r="3.4" />
      {/* piloto: tronco inclinado, braço até o guidão, perna no assoalho */}
      <path d="M23.5 9.6h4.2l3 4.6h4v2.6h-5.3l-1.6-2.5-1 4.4h3.4l1.3 4.4-2.6.7-.9-2.9h-5.2c-1.1 0-1.9-1-1.6-2.1z" />
      {/* scooter: banco/carenagem, assoalho e coluna do guidão */}
      <path d="M11 22.5c0-2 1.6-3.6 3.6-3.6H22l1.3 4.6h7.4l3-9.5h-1.9v-2.4h3.4c.9 0 1.5.9 1.2 1.7l-3.4 10.6H11z" />
      {/* rodas vazadas */}
      <circle cx="15" cy="25.6" r="2.9" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="33" cy="25.6" r="2.9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
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
    <div className="relative flex w-[88px] flex-shrink-0 flex-col items-center justify-center px-[6px] py-[14px] text-center text-white" style={{ background: (COR_BENEFICIO[tipo] ?? COR_BENEFICIO.desconto_percentual).forte }}>
      <span className="text-[24px] font-semibold leading-none tracking-tight">{grande}</span>
      <span className="mt-[4px] text-[11px] font-semibold uppercase tracking-[0.08em] opacity-85">{pequeno}</span>
      {/* picote: tracejado; as meias-luas vêm da máscara do cartão (MASCARA_TICKET) */}
      <span aria-hidden="true" className="absolute bottom-[10px] right-0 top-[10px] border-r-2 border-dashed border-white/40" />
    </div>
  )
}
