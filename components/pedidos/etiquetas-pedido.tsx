'use client'

import { ShoppingBag, Utensils } from 'lucide-react'
import { Capacete } from '@/components/icones/capacete'
import { etiquetasDoPedido, type AtendimentoEtiqueta, type PedidoParaRotulo } from '@/lib/pedido-origem'

const TOM_ATENDIMENTO: Record<AtendimentoEtiqueta, string> = {
  ENTREGA: 'border-[#0369A1]/30 bg-alert-bg text-alert-text',
  RETIRADA: 'border-[#16A34A]/30 bg-price-bg text-price-text',
  MESA: 'border-[#A855F7]/30 bg-[#F3E8FF] text-[#7E22CE]',
}

/** Ícone do atendimento: capacete na entrega, sacola na retirada, talheres na mesa. */
export function IconeAtendimento({ atendimento, className = 'h-3.5 w-3.5' }: { atendimento: AtendimentoEtiqueta; className?: string }) {
  if (atendimento === 'ENTREGA') return <Capacete className={className} strokeWidth={2.2} />
  if (atendimento === 'RETIRADA') return <ShoppingBag className={className} strokeWidth={2.2} aria-hidden="true" />
  return <Utensils className={className} strokeWidth={2.2} aria-hidden="true" />
}

/** Etiqueta forte de RETIRADA / ENTREGA / MESA (card do Kanban e Detalhes). */
export function EtiquetaAtendimento({ atendimento, compacta = false }: { atendimento: AtendimentoEtiqueta; compacta?: boolean }) {
  return (
    <span
      data-testid={`etiqueta-${atendimento.toLowerCase()}`}
      className={`inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-menuzia border font-bold uppercase tracking-wide ${
        compacta ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
      } ${TOM_ATENDIMENTO[atendimento]}`}
    >
      <IconeAtendimento atendimento={atendimento} className={compacta ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {atendimento}
    </span>
  )
}

/**
 * Canto superior direito dos Detalhes: origem (PDV, CARDÁPIO, SALÃO), atendimento
 * (RETIRADA, ENTREGA, MESA) e, na mesa, o nome dela.
 */
export function EtiquetasPedido({ pedido }: { pedido: PedidoParaRotulo }) {
  const e = etiquetasDoPedido(pedido)
  return (
    <div className="flex flex-wrap items-center justify-end gap-1" data-testid="etiquetas-pedido">
      <span className="whitespace-nowrap rounded-menuzia border border-border bg-page px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-text-main">
        {e.origem}
      </span>
      <EtiquetaAtendimento atendimento={e.atendimento} />
      {e.mesa && (
        <span className="max-w-[140px] truncate whitespace-nowrap rounded-menuzia border border-border bg-white px-2 py-0.5 text-[11px] font-bold text-text-main" title={e.mesa}>
          {e.mesa}
        </span>
      )}
    </div>
  )
}
