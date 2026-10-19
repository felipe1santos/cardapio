'use client'

import type { ReactNode } from 'react'
import { ArrowRight, Check, Clock, MoreHorizontal, Pencil, Printer } from 'lucide-react'
import type { Pedido } from '@/lib/queries/pedidos'
import { corTempoPedido, textoTempoPedido } from '@/lib/tempo-pedido'
import { formatarReal } from '@/lib/moeda'
import { origemVisivelNoCard, rotuloOrigemPedido } from '@/lib/pedido-origem'
import { IconeOrigem, IconePix } from '@/components/icones/origens'
import { Dica } from '@/components/ui/flutuante'
import { rotuloForma, statusAReceber } from '@/lib/pdv-pagamento'

/**
 * Card do pedido no Kanban (redesign 18/10/2026, pedido do dono): fundo cinza bem claro, cantos retos,
 * valor no canto superior direito, origem discreta, resumo dos itens e a BARRA DE AÇÕES no rodapé
 * (Imprimir · Editar · Mais informações · ação principal azul). Só visual: cada botão chama o mesmo
 * handler de sempre, passado pela página.
 */
export const CARD_BOTAO = 'inline-flex h-[28px] items-center justify-center gap-1 whitespace-nowrap rounded-[2px] border border-[#D1D5DB] bg-white px-2 text-[11.5px] font-semibold text-[#374151] transition-colors hover:border-[#9CA3AF] hover:text-[#111827] disabled:opacity-50'
export const CARD_BOTAO_PRINCIPAL = 'inline-flex h-[28px] min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-[2px] bg-[#0688D4] px-2.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-[#0570AE] disabled:opacity-50'
const ICONE = 'h-[14px] w-[14px]'

/** "2× X-Tudo, 1× Coca 2L" — até `max` itens, depois "+N itens". */
export function resumoItens(itens: Pedido['itens'], max = 3): { texto: string; resto: number } {
  const partes = itens.slice(0, max).map((i) => `${i.quantidade}× ${i.nome}${i.tamanhoNome ? ` ${i.tamanhoNome}` : ''}`)
  return { texto: partes.join(', '), resto: Math.max(0, itens.length - max) }
}

export interface AcoesCard {
  /** Ação principal (Aceitar / Pronto / Entregue…). Ausente = a página passa `principal` pronto (despacho). */
  avancar?: { rotulo: string; onClick: () => void; testid?: string }
  /** Slot da ação principal quando ela é composta (Despachar + Lalamove no pedido pronto de entrega). */
  principal?: ReactNode
  onImprimir?: () => void
  onEditar?: () => void
  onMais?: (ancora: HTMLButtonElement) => void
  maisAberto?: boolean
}

export function CardPedido({ order, now, selecionado, destaqueNovo, somBloqueado, onAbrir, acoes, rodape }: {
  order: Pedido
  now: number
  selecionado: boolean
  /** Pedido recebido ainda não visto: piscar amarelo como hoje. */
  destaqueNovo: boolean
  somBloqueado: boolean
  onAbrir: () => void
  acoes: AcoesCard
  /** Linha extra abaixo das ações (ex.: corrida da Lalamove em andamento). */
  rodape?: ReactNode
}) {
  const idadeMs = now - new Date(order.criadoEm).getTime()
  const corTempo = { ok: 'text-[#15803D]', atencao: 'text-[#B45309]', atraso: 'text-[#B91C1C]' }[corTempoPedido(idadeMs)]
  const origem = origemVisivelNoCard(order)
  const posto = rotuloOrigemPedido(order).posto
  const tipo = order.canal === 'mesa' ? `Mesa${order.mesa ? ` ${order.mesa}` : ''}` : order.tipo === 'entrega' ? 'Entrega' : 'Retirada'
  const { texto: itens, resto } = resumoItens(order.itens)
  const dicaPag = [rotuloForma(order.formaPagamento, order.cartaoTipo, order.pagamentoOnline), order.pago ? 'Pago' : statusAReceber(order.tipo), order.formaPagamento === 'dinheiro' && order.trocoPara ? `Troco p/ ${formatarReal(order.trocoPara)}` : null].filter(Boolean).join(' · ')
  return (
    <div
      data-testid={`pedido-${order.numero}`}
      data-selecionado={selecionado ? '1' : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={selecionado}
      aria-label={`Pedido #${order.numero}: abrir o painel`}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onAbrir() } }}
      className={[
        'cursor-pointer border bg-[#F7F8FA] shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-[box-shadow,border-color] hover:border-[#C9CED6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688D4]',
        selecionado ? 'border-[#0688D4] ring-1 ring-[#0688D4]/40' : 'border-[#E5E7EB]',
        destaqueNovo ? 'animate-new-order' : '',
        destaqueNovo && somBloqueado ? 'animate-pulse ring-4 ring-[#DC2626]' : '',
      ].join(' ')}
    >
      <div className="px-3 pb-2 pt-2.5">
        {/* Linha 1: nº + origem discreta + tempo · valor à direita */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-[13px] font-semibold text-[#111827]">#{order.numero}</span>
            {origem ? (
              <Dica texto={origem.dica}>
                <span className="inline-flex opacity-70" aria-label={origem.dica} data-testid="card-origem" data-origem={origem.icone}>
                  <IconeOrigem canal={origem.icone} className="h-[13px] w-[13px]" />
                </span>
              </Dica>
            ) : posto === 'Delivery' ? (
              <Dica texto="Pedido do cardápio (direto)"><span className="inline-flex opacity-60" data-testid="card-origem" data-origem="direto"><IconeOrigem canal="direto" className="h-[13px] w-[13px]" /></span></Dica>
            ) : null}
            <span className={`inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-medium tabular-nums ${corTempo}`} data-testid="card-tempo" title="Tempo desde que o pedido chegou">
              <Clock className="h-[11px] w-[11px]" strokeWidth={2.4} aria-hidden /> {textoTempoPedido(idadeMs)}
            </span>
          </div>
          <span className="whitespace-nowrap text-[13.5px] font-semibold tabular-nums text-[#15803D]" data-testid="card-preco">{formatarReal(order.total)}</span>
        </div>
        {/* Linha 2: cliente + tipo */}
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[13px] font-semibold text-[#1F2937]" title={order.clienteNome || undefined}>{order.clienteNome || 'Cliente'}</span>
          <span className="flex flex-shrink-0 items-center gap-1.5 text-[11px] font-medium text-[#6B7280]">
            {order.formaPagamento === 'pix' && order.canal !== 'mesa' && (
              <span className="inline-flex items-center gap-0.5" title={dicaPag} aria-label={dicaPag} data-testid="card-pix" data-pago={order.pago ? '1' : '0'}>
                <IconePix className="h-[13px] w-[13px]" />
                {order.pago ? <Check className="h-[11px] w-[11px] text-[#15803D]" strokeWidth={3} aria-hidden /> : <span className="text-[10px] text-[#B45309]">aguard.</span>}
              </span>
            )}
            <span data-testid="card-tipo">{tipo}</span>
          </span>
        </div>
        {/* Itens */}
        {order.itens.length > 0 && (
          <p className="mt-1 line-clamp-2 text-[12px] leading-[16px] text-[#4B5563]" data-testid="card-itens">
            {itens}{resto > 0 && <span className="text-[#6B7280]"> +{resto} {resto === 1 ? 'item' : 'itens'}</span>}
          </p>
        )}
      </div>
      {/* Barra de ações: não abre o painel */}
      <div className="flex items-center gap-1.5 border-t border-[#E5E7EB] px-2.5 py-2" onClick={(e) => e.stopPropagation()} data-testid="card-acoes">
        {acoes.onImprimir && (
          <button type="button" className={`${CARD_BOTAO} w-[32px] px-0`} onClick={acoes.onImprimir} title="Imprimir o pedido" aria-label="Imprimir o pedido" data-testid="card-imprimir"><Printer className={ICONE} aria-hidden /></button>
        )}
        {acoes.onEditar && (
          <button type="button" className={`${CARD_BOTAO} w-[32px] px-0`} onClick={acoes.onEditar} title="Editar pagamento" aria-label="Editar pagamento" data-testid="card-editar"><Pencil className={ICONE} aria-hidden /></button>
        )}
        {acoes.onMais && (
          <button type="button" className={`${CARD_BOTAO} w-[32px] px-0`} onClick={(e) => acoes.onMais?.(e.currentTarget)} aria-haspopup="menu" aria-expanded={!!acoes.maisAberto} title="Mais informações" aria-label="Mais informações" data-testid="card-mais"><MoreHorizontal className={ICONE} aria-hidden /></button>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          {acoes.principal}
          {acoes.avancar && (
            <button type="button" className={CARD_BOTAO_PRINCIPAL} onClick={acoes.avancar.onClick} data-testid={acoes.avancar.testid ?? 'card-etapa'}>
              {acoes.avancar.rotulo} <ArrowRight className={ICONE} aria-hidden />
            </button>
          )}
        </div>
      </div>
      {rodape && <div className="border-t border-[#E5E7EB] px-3 py-2" onClick={(e) => e.stopPropagation()}>{rodape}</div>}
    </div>
  )
}
