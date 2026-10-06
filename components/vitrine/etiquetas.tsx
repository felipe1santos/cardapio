'use client'

import { createContext, useContext, type ReactNode } from 'react'
import {
  COR_PRECO_ANTIGO,
  COR_PRECO_ANTIGO_NOVO,
  COR_PRECO_PROMO,
  ESTILO_DESCONTO_NOVO,
  ESTILO_DESCONTO,
  ESTILO_SELO_MAIS_PEDIDOS,
  ROTULO_MAIS_PEDIDOS,
  ESTILO_TOPO,
  ESTILO_UTIL,
  etiquetasTopo,
  etiquetasUtilitarias,
  percentualDesconto,
  type EtiquetaTopo,
  type ItemComEtiquetas,
} from '@/lib/etiquetas-vitrine'
import { IconeTagSvg } from './icones-tags'

/**
 * Tags e preço da vitrine (2026-10-01). Medidas da REF-TAGS
 * (docs/referencias/vitrine-tags/cardapio-tags-menuzia.png), em px — a raiz do painel é
 * 87,5% (ver CLAUDE.md). Ícones: Phosphor fill (MIT), embutidos.
 *
 * Todas as tags têm a mesma caixa: 22px de altura, canto de 6px, 7px de respiro lateral,
 * ícone de 14px a 5px do texto de 12px.
 */
/**
 * Selo "Mais Pedidos" sobre a foto (P8, 2026-10-04): canto superior esquerdo, colado no topo, com o
 * canto de cima acompanhando o da foto (`raio`). O pai precisa ser `relative`. O desconto fica no preço,
 * fora da foto — os dois nunca se cobrem.
 */
export function SeloMaisPedidos({ raio = 8 }: { raio?: number }) {
  return (
    <span
      data-selo-mais-pedidos
      className="pointer-events-none absolute left-0 top-0 z-[1] inline-flex h-[20px] items-center gap-[3px] whitespace-nowrap pl-[6px] pr-[7px] text-[10.5px] font-bold leading-[20px]"
      style={{ background: ESTILO_SELO_MAIS_PEDIDOS.fundo, color: ESTILO_SELO_MAIS_PEDIDOS.cor, borderRadius: `${raio}px 0 6px 0` }}
    >
      <IconeTagSvg nome="fogo" tamanho={12} />
      {ROTULO_MAIS_PEDIDOS}
    </span>
  )
}

/** Mantido por compatibilidade (a "Entrega grátis" saiu das tags em 2026-10-01). */
export const LojaEtiquetasContext = createContext<{ freteGratisAcima?: number | null }>({})

const CAIXA = 'inline-flex h-[22px] w-fit max-w-full items-center gap-[5px] whitespace-nowrap rounded-[6px] px-[7px] text-[12px] leading-[22px]'

function TagTopo({ tipo }: { tipo: EtiquetaTopo }) {
  const e = ESTILO_TOPO[tipo]
  return (
    <span data-etiqueta={tipo} className={CAIXA} style={{ background: e.fundo, color: e.cor, fontWeight: e.peso, ...(e.raio !== undefined ? { borderRadius: e.raio } : {}) }}>
      {e.icone && <span style={{ color: e.corIcone ?? e.cor }} className="inline-flex"><IconeTagSvg nome={e.icone} tamanho={14} /></span>}
      {e.texto}
    </span>
  )
}

/** Tags de topo (máx. 2). `max` 1 sobre a foto dos destaques. */
export function EtiquetasPrincipais({ item, max = 2, className = '' }: { item: ItemComEtiquetas; max?: number; className?: string }) {
  const lista = etiquetasTopo(item, max)
  if (!lista.length) return null
  return (
    <span className={`inline-flex flex-wrap gap-[6px] ${className}`} data-etiquetas-principais>
      {lista.map((t) => <TagTopo key={t} tipo={t} />)}
    </span>
  )
}

/**
 * Nome do produto com as tags de topo na MESMA linha, à direita (REF-TAGS "X - BURGUER
 * [Mais vendido]"). Nome que não deixa espaço empurra as tags para a linha de baixo — nada
 * é cortado e a foto não se mexe (o bloco só ocupa a coluna de texto).
 */
export function NomeComEtiquetas({ item, children, className = '' }: { item: ItemComEtiquetas; children: ReactNode; className?: string }) {
  const temTopo = etiquetasTopo(item).length > 0
  if (!temTopo) return <div className={className}>{children}</div>
  return (
    <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[6px]" data-nome-com-etiquetas>
      <div className={`w-fit min-w-0 max-w-full ${className}`}>{children}</div>
      <EtiquetasPrincipais item={item} />
    </div>
  )
}

/** Tags utilitárias: abaixo da descrição, logo acima do preço, lado a lado. */
export function EtiquetasUtilitarias({ item, className = '' }: { item: ItemComEtiquetas; className?: string }) {
  const lista = etiquetasUtilitarias(item)
  if (!lista.length) return null
  return (
    <span className={`flex flex-wrap items-center gap-[8px] ${className}`} data-etiquetas-utilitarias>
      {lista.map((e) => {
        if (e.tipo === 'serve') {
          return (
            <span key={e.tipo} data-etiqueta="serve" className={CAIXA} style={{ background: ESTILO_UTIL.serve.fundo, color: ESTILO_UTIL.serve.cor, fontWeight: 500 }}>
              <IconeTagSvg nome="pessoas" tamanho={14} />
              {e.texto}
            </span>
          )
        }
        if (e.tipo === 'item_promocional') {
          return (
            <span key={e.tipo} data-etiqueta="item_promocional" className={CAIXA} style={{ background: ESTILO_UTIL.item_promocional.fundo, color: ESTILO_UTIL.item_promocional.cor, fontWeight: 500 }}>
              <IconeTagSvg nome="etiqueta" tamanho={14} />
              {e.texto}
            </span>
          )
        }
        // Personalizada: sem ícone (fica mais limpa ao lado das outras). Azul = estilo do promocional.
        const est = e.cor === 'azul' ? ESTILO_UTIL.item_promocional : ESTILO_UTIL.personalizada_preta
        return (
          <span key={`p-${e.texto}`} data-etiqueta="personalizada" data-cor={e.cor} className={CAIXA} style={{ background: est.fundo, color: est.cor, fontWeight: 500 }}>
            {e.texto}
          </span>
        )
      })}
    </span>
  )
}

/**
 * Vitrine nova (pendência 9): só as lojas com a chave vitrine_nova ligada a renderizam com este
 * contexto em true. Sem ele (todas as outras lojas), selo e preço ficam exatamente como hoje.
 */
export const VitrineNovaContext = createContext(false)

/** Pílula verde do desconto com o ticket (REF-CORES "R$ 5 off"); na vitrine nova, selo verde sólido "-39%". */
export function PilulaDesconto({ percentual }: { percentual: number }) {
  const nova = useContext(VitrineNovaContext)
  if (nova) {
    return (
      <span
        data-desconto
        className="inline-flex h-[20px] items-center whitespace-nowrap rounded-[4px] px-[6px] text-[12px] font-semibold leading-[20px]"
        style={{ background: ESTILO_DESCONTO_NOVO.fundo, color: ESTILO_DESCONTO_NOVO.cor }}
      >
        -{percentual}%
      </span>
    )
  }
  return (
    <span
      data-desconto
      className="inline-flex h-[20px] items-center gap-[4px] whitespace-nowrap rounded-[6px] px-[6px] text-[11.5px] font-bold leading-[20px]"
      style={{ background: ESTILO_DESCONTO.fundo, color: ESTILO_DESCONTO.cor }}
    >
      <span className="inline-flex -rotate-45"><IconeTagSvg nome="ticket" tamanho={13} /></span>-{percentual}%
    </span>
  )
}

/**
 * Preço da vitrine. Com desconto: preço ORIGINAL cinza claro, riscado e menor EM CIMA;
 * embaixo o preço atual (no estilo de sempre) + pílula verde do desconto. "A partir de"
 * pequeno acima quando o preço depende da escolha.
 */
export function PrecoVitrine({ price, originalPrice, aPartirDe = false }: { price: number; originalPrice?: number | null; aPartirDe?: boolean }) {
  const nova = useContext(VitrineNovaContext)
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const off = originalPrice ? percentualDesconto(price, originalPrice) : 0
  return (
    <span className="flex flex-col items-start" data-preco>
      {aPartirDe && <span className="text-[11px] leading-[14px] text-[var(--v-secundario)]">A partir de</span>}
      {off > 0 && originalPrice && (
        <span className="text-[12px] font-medium leading-[15px] line-through" style={{ color: nova ? COR_PRECO_ANTIGO_NOVO : COR_PRECO_ANTIGO }} data-preco-antigo>{brl(originalPrice)}</span>
      )}
      {/* Quebra de linha permitida: no cartão estreito (destaque de 120px) a pílula do desconto desce para
          baixo do preço em vez de passar da borda e ser cortada (P8, 2026-10-04). */}
      <span className="inline-flex max-w-full flex-wrap items-center gap-x-[6px] gap-y-[4px]">
        <span className="whitespace-nowrap text-[14px] font-semibold leading-[20px] text-[var(--v-texto)]" style={nova && off > 0 ? { color: COR_PRECO_PROMO } : undefined} data-preco-atual>{brl(price)}</span>
        {off > 0 && <PilulaDesconto percentual={off} />}
      </span>
    </span>
  )
}
