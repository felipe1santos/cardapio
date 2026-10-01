'use client'

import { createContext, useContext } from 'react'
import { ESTILO_PRINCIPAL, etiquetasPrincipais, etiquetasUtilitarias, percentualDesconto, type ItemComEtiquetas } from '@/lib/etiquetas-vitrine'

/**
 * Etiquetas, ícones e preço da vitrine (2026-09-30). Ícones: Microsoft Fluent Emoji
 * (MIT, public/vitrine/emoji/LICENSE-fluentui-emoji.txt), arquivos locais — nada de CDN.
 * Medidas em px (a raiz do painel é 87,5%, ver CLAUDE.md).
 */
export const LojaEtiquetasContext = createContext<{ freteGratisAcima?: number | null }>({})

export function IconeEmoji({ nome, tamanho = 12, className = '' }: { nome: string; tamanho?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/vitrine/emoji/${nome}.svg`} alt="" width={tamanho} height={tamanho} aria-hidden className={`inline-block flex-shrink-0 ${className}`} style={{ width: tamanho, height: tamanho }} />
  )
}

function Pilula({ tipo }: { tipo: keyof typeof ESTILO_PRINCIPAL }) {
  const e = ESTILO_PRINCIPAL[tipo]
  return (
    <span
      data-etiqueta={tipo}
      className="inline-flex w-fit items-center gap-[4px] whitespace-nowrap rounded-full px-[8px] py-[3px] text-[10.5px] font-semibold leading-[14px]"
      style={{ background: e.fundo, color: e.cor }}
    >
      {!e.iconeDepois && <IconeEmoji nome={e.icone} tamanho={12} />}
      {e.texto}
      {e.iconeDepois && <IconeEmoji nome={e.icone} tamanho={12} />}
    </span>
  )
}

/** Pílulas principais (máx. 2). `max` 1 na foto dos destaques. */
export function EtiquetasPrincipais({ item, max = 2, className = '' }: { item: ItemComEtiquetas; max?: number; className?: string }) {
  const lista = etiquetasPrincipais(item).slice(0, max)
  if (!lista.length) return null
  return (
    <span className={`flex flex-wrap gap-[6px] ${className}`} data-etiquetas-principais>
      {lista.map((t) => <Pilula key={t} tipo={t} />)}
    </span>
  )
}

/** Linha discreta acima do preço: Item promocional · Entrega grátis · Serve X pessoas. */
export function EtiquetasUtilitarias({ item, className = '' }: { item: ItemComEtiquetas; className?: string }) {
  const loja = useContext(LojaEtiquetasContext)
  const lista = etiquetasUtilitarias(item, loja)
  if (!lista.length) return null
  return (
    <span className={`flex flex-wrap items-center gap-x-[10px] gap-y-[4px] ${className}`} data-etiquetas-utilitarias>
      {lista.map((e) =>
        e.tipo === 'entrega_gratis' ? (
          // REF-ENTREGA-GRATIS: pílula azul-acinzentada clara, texto azul, ícone à esquerda.
          <span key={e.tipo} data-etiqueta={e.tipo} className="inline-flex items-center gap-[5px] rounded-[6px] bg-[#EEF3F5] px-[7px] py-[3px] text-[12px] font-medium leading-[15px] text-[#2E6788]">
            <IconeEmoji nome="entrega" tamanho={13} />
            {e.texto}
          </span>
        ) : e.tipo === 'item_promocional' ? (
          // REF-PROMOCIONAL: etiqueta + texto azul, sem fundo.
          <span key={e.tipo} data-etiqueta={e.tipo} className="inline-flex items-center gap-[5px] text-[12px] font-medium leading-[15px] text-[#2E6788]">
            <IconeEmoji nome="etiqueta" tamanho={13} />
            {e.texto}
          </span>
        ) : (
          // REF-SERVE: pessoas + texto cinza escuro semi-negrito, sem fundo.
          <span key={e.tipo} data-etiqueta={e.tipo} className="inline-flex items-center gap-[5px] text-[12px] font-semibold leading-[15px] text-[#3E3E3E]">
            <IconeEmoji nome="pessoas" tamanho={13} />
            {e.texto}
          </span>
        ),
      )}
    </span>
  )
}

/**
 * Preço da vitrine. Com desconto: preço antigo riscado, pequeno e cinza EM CIMA; embaixo o
 * preço atual em destaque + pílula verde do desconto com o ticket. "A partir de" pequeno e
 * cinza acima quando o preço depende da escolha.
 */
export function PrecoVitrine({ price, originalPrice, aPartirDe = false }: { price: number; originalPrice?: number | null; aPartirDe?: boolean }) {
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const off = originalPrice ? percentualDesconto(price, originalPrice) : 0
  return (
    <span className="flex flex-col items-start" data-preco>
      {aPartirDe && <span className="text-[11px] leading-[14px] text-[var(--v-secundario)]">A partir de</span>}
      {off > 0 && originalPrice && (
        <span className="text-[12px] font-normal leading-[15px] text-[var(--v-secundario)] line-through" data-preco-antigo>{brl(originalPrice)}</span>
      )}
      <span className="inline-flex items-center gap-[6px]">
        <span className={`text-[14px] font-semibold leading-[20px] ${off > 0 ? 'text-promo' : 'text-[var(--v-texto)]'}`}>{brl(price)}</span>
        {off > 0 && (
          <span className="inline-flex items-center gap-[3px] rounded-full bg-promo-bg px-[7px] py-[1px] text-[10.5px] font-semibold leading-[16px] text-promo" data-desconto>
            <IconeEmoji nome="ticket" tamanho={12} />-{off}%
          </span>
        )}
      </span>
    </span>
  )
}
