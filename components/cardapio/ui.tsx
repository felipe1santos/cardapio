'use client'

/**
 * Peças visuais do Gestor de Cardápio no desenho da Logística: cartão branco com
 * borda fina, cabeçalho com ícone em bolha colorida, estado vazio centrado e
 * faixa de erro que se dispensa. Tudo na paleta oficial (TONS_PAINEL).
 */

import { AlertTriangle, X } from 'lucide-react'
import { TONS_PAINEL, type TomPainel } from '@/components/admin/cartao-numero'
import type { ItemCardapio } from '@/lib/queries/cardapio'

export function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** "12,5" → 12.5; vazio/inválido → null (quem chama decide o que fazer). */
export function lerPreco(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.').trim()
  if (!limpo) return null
  const n = Number(limpo)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

export function precoParaCampo(v: number): string {
  return v > 0 ? v.toFixed(2).replace('.', ',') : ''
}

export function CartaoPainel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-[6px] border-[0.8px] border-[var(--adm-borda-cartao)] bg-white ${className}`}>{children}</div>
}

export function CabecalhoSecao({
  icone,
  tom,
  titulo,
  contador,
  descricao,
  acoes,
}: {
  icone: React.ReactNode
  tom: TomPainel
  titulo: React.ReactNode
  contador?: number
  descricao?: React.ReactNode
  acoes?: React.ReactNode
}) {
  const t = TONS_PAINEL[tom]
  return (
    <div className="border-b border-[var(--adm-borda)] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: t.fundo, color: t.cor }}>
            {icone}
          </span>
          <h3 className="min-w-0 truncate text-[14px] font-bold text-[var(--adm-texto-forte)]">{titulo}</h3>
          {contador !== undefined && (
            <span className="rounded-full bg-[#f1f2f4] px-2 py-[1px] text-[11px] font-bold text-[var(--adm-texto-medio)]">{contador}</span>
          )}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {descricao && <div className="mt-1.5 text-[12px] leading-relaxed text-[var(--adm-texto-suave)]">{descricao}</div>}
    </div>
  )
}

export function Vazio({ icone, titulo, texto, acao }: { icone: React.ReactNode; titulo: string; texto: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
      <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-[#f1f2f4] text-[var(--adm-texto-suave)]">{icone}</span>
      <p className="text-[13.5px] font-semibold text-[var(--adm-texto)]">{titulo}</p>
      <div className="max-w-[360px] text-[12px] text-[var(--adm-texto-suave)]">{texto}</div>
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  )
}

/** Faixa de erro. Toda falha de gravação do cardápio passa por aqui — nada de erro engolido. */
export function FaixaErro({ mensagem, onFechar, className = '' }: { mensagem: string | null; onFechar: () => void; className?: string }) {
  if (!mensagem) return null
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-[6px] border-[0.8px] border-danger bg-danger-bg px-3.5 py-2.5 text-[12.8px] font-semibold text-danger ${className}`}>
      <AlertTriangle className="mt-[1px] h-4 w-4 flex-shrink-0" strokeWidth={2.2} />
      <span className="flex-1">{mensagem}</span>
      <button type="button" onClick={onFechar} aria-label="Dispensar aviso" className="toque-icone -my-1 flex h-6 w-6 items-center justify-center rounded-[4px] hover:bg-white/60">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** Aviso amarelo de uma linha (ex.: "tamanho sem preço não aparece para o cliente"). */
export function Aviso({ children, tom = 'ambar', className = '' }: { children: React.ReactNode; tom?: 'ambar' | 'azul'; className?: string }) {
  const cls =
    tom === 'azul'
      ? 'border-[#bae6fd] bg-alert-bg text-alert-text'
      : 'border-[#fcd34d] bg-warn-bg text-[#92400E]'
  return <div className={`rounded-[6px] border-[0.8px] px-3 py-2 text-[12px] font-medium leading-snug ${cls} ${className}`}>{children}</div>
}

/** Botão de ação do painel (texto normal, não caixa alta — o mesmo da Logística). */
export function BotaoPainel({
  children,
  variante = 'contorno',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'contorno' | 'perigo' | 'fantasma' }) {
  const v = {
    primario: 'border-[var(--adm-azul)] bg-[var(--adm-azul)] text-white hover:bg-[var(--adm-azul-escuro)] hover:border-[var(--adm-azul-escuro)]',
    contorno: 'border-[var(--adm-borda)] bg-white text-[var(--adm-texto-medio)] hover:border-[var(--adm-borda-forte)] hover:text-[var(--adm-texto)]',
    perigo: 'border-[#fecaca] bg-white text-danger hover:bg-danger-bg',
    fantasma: 'border-transparent bg-transparent text-[var(--adm-texto-medio)] hover:bg-[var(--adm-hover)] hover:text-[var(--adm-texto)]',
  }[variante]
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-[32px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] border px-3 py-1.5 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
    >
      {children}
    </button>
  )
}

/** Botão só de ícone (28px no desktop, 40px no dedo pela camada `toque-icone`). */
export function BotaoIcone({
  children,
  rotulo,
  perigo = false,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { rotulo: string; perigo?: boolean }) {
  return (
    <button
      type="button"
      title={rotulo}
      aria-label={rotulo}
      {...props}
      className={`toque-icone flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[4px] border border-[var(--adm-borda)] bg-white text-[var(--adm-texto-suave)] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        perigo ? 'hover:border-[#fecaca] hover:bg-danger-bg hover:text-danger' : 'hover:border-[var(--adm-azul)] hover:text-[var(--adm-azul)]'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export const CLASSE_CAMPO =
  'w-full rounded-[4px] border border-[var(--adm-borda)] bg-white px-2.5 py-1.5 text-[13px] text-[var(--adm-texto)] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[var(--adm-azul)] focus:ring-2 focus:ring-[var(--adm-azul)]/15'

/** Chave liga/desliga (role=switch: a camada de toque amplia só a área de clique). */
export function Chave({ ligada, onMudar, rotulo, disabled }: { ligada: boolean; onMudar: (v: boolean) => void; rotulo: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-label={rotulo}
      title={rotulo}
      disabled={disabled}
      onClick={() => onMudar(!ligada)}
      className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${ligada ? 'bg-[var(--adm-azul)]' : 'bg-[#D1D5DB]'}`}
    >
      <span className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${ligada ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

export function ItemThumb({ item, size = 42 }: { item: Pick<ItemCardapio, 'nome' | 'imagemThumbUrl' | 'imagemUrl'>; size?: number }) {
  // Miniatura nas listagens do admin; item sem thumb cai na full.
  const src = item.imagemThumbUrl ?? item.imagemUrl
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={item.nome} loading="lazy" decoding="async" width={size} height={size} className="flex-shrink-0 rounded-[4px] object-cover" style={{ width: size, height: size }} />
    )
  }
  return (
    <div className="flex flex-shrink-0 items-center justify-center rounded-[4px] bg-gradient-to-br from-slate-100 to-slate-200" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" className="h-[55%] w-[55%] fill-text-subtle/60">
        <path d="M12 6c-3.87 0-7 2.46-7 5.5 0 .5.09.98.26 1.43.07.2.27.32.49.27.21-.05.34-.26.3-.47A4 4 0 017 11.5C7 9.57 9.24 8 12 8s5 1.57 5 3.5c0 .42-.07.82-.2 1.2-.05.21.08.42.29.47.22.05.42-.07.49-.27.17-.45.26-.93.26-1.4C19 8.46 15.87 6 12 6zM4 15h16v2H4zm0 3h16v2H4z" />
      </svg>
    </div>
  )
}
