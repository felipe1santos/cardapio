'use client'

import { Banknote, CreditCard, QrCode } from 'lucide-react'
import { rotuloForma, statusAReceber, trocoLevar } from '@/lib/pdv-pagamento'

/**
 * Forma de pagamento + troco + status, igual em todas as telas (0135): Kanban, detalhe do pedido,
 * cozinha e Logística. "Pago" só quando o pagamento foi registrado de verdade (pedidos.pago);
 * antes disso: "A receber na entrega" / "A pagar na retirada". Mesa não mostra (paga no fechamento).
 */
export interface PagamentoDoPedido {
  formaPagamento: string
  cartaoTipo?: string | null
  trocoPara: number | null
  pago: boolean
  tipo: string
  total: number
  canal?: string | null
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function InfoPagamento({ p, compacto = false, mostrarStatus = true, card = false }: { p: PagamentoDoPedido; compacto?: boolean; mostrarStatus?: boolean; card?: boolean }) {
  if (p.canal === 'mesa') return null
  const Icone = p.formaPagamento === 'dinheiro' ? Banknote : p.formaPagamento === 'pix' ? QrCode : CreditCard
  const troco = p.formaPagamento === 'dinheiro' && p.trocoPara ? p.trocoPara : null
  if (card) {
    // Card do Kanban (2026-10-03): uma linha à direita, logo abaixo do valor, sem fundo —
    // "Pix · A pagar na retirada"; troco (se houver) na linha de baixo.
    return (
      <div className="text-right text-[11.5px] leading-snug" data-testid="info-pagamento">
        <span className="font-semibold text-text-main">{rotuloForma(p.formaPagamento, p.cartaoTipo)}</span>
        <span className="text-text-subtle"> · </span>
        {p.pago ? <span className="font-semibold text-price-text">Pago</span> : <span className="font-semibold text-[#92400E]">{statusAReceber(p.tipo)}</span>}
        {troco && <div className="font-semibold text-[#92400E]" data-testid="info-troco">Troco p/ {brl(troco)}</div>}
      </div>
    )
  }
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 ${compacto ? 'text-[11.5px]' : 'text-[13px]'}`} data-testid="info-pagamento">
      <span className="inline-flex items-center gap-1 font-semibold text-text-main">
        <Icone className={compacto ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden /> {rotuloForma(p.formaPagamento, p.cartaoTipo)}
      </span>
      {troco && <span className="font-semibold text-[#92400E]" data-testid="info-troco">Troco p/ {brl(troco)}</span>}
      {mostrarStatus && (
        p.pago
          ? <span className="rounded-menuzia bg-price-bg px-1.5 py-[1px] text-[11px] font-semibold text-price-text">Pago</span>
          : <span className="rounded-menuzia bg-warn-bg px-1.5 py-[1px] text-[11px] font-semibold text-[#92400E]">{statusAReceber(p.tipo)}</span>
      )}
    </div>
  )
}

/** Alerta para quem sai com o pedido: "Levar R$ 37,00 de troco". Nada se não houver troco a levar. */
export function AlertaTroco({ p }: { p: PagamentoDoPedido }) {
  if (p.pago || p.formaPagamento !== 'dinheiro') return null
  const levar = trocoLevar(p.total, p.trocoPara)
  if (levar <= 0) return null
  return (
    <div className="rounded-menuzia border border-[#F59E0B] bg-[#FEF3C7] px-2.5 py-1.5 text-[13px] font-semibold text-[#92400E]" data-testid="alerta-troco">
      Levar {brl(levar)} de troco <span className="font-semibold">(cliente paga com {brl(p.trocoPara!)})</span>
    </div>
  )
}
