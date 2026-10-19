'use client'

import type { ReactNode } from 'react'
import { ArrowRight, Check, MoreHorizontal, Pencil, Printer } from 'lucide-react'
import type { Pedido } from '@/lib/queries/pedidos'
import { corTempoPedido, textoTempoPedido } from '@/lib/tempo-pedido'
import { formatarReal } from '@/lib/moeda'
import { origemVisivelNoCard, rotuloOrigemPedido } from '@/lib/pedido-origem'
import { IconePix, SeloOrigem } from '@/components/icones/origens'
import { Dica } from '@/components/ui/flutuante'
import { rotuloForma, statusAReceber } from '@/lib/pdv-pagamento'

/**
 * Card do pedido no Kanban (redesign 18/10/2026, rodada 2 — referência note-imagem.webp do dono): card branco
 * quase cinza, borda fina, cantos retos, texto pequeno em linhas; nº + cliente em negrito, VALOR no canto superior
 * direito, hora/tempo em cinza à direita da 2ª linha, itens em 2 linhas; rodapé com o selo da origem (quadradinho
 * colorido) à esquerda e, à direita, ícones (imprimir, editar) + o botão azul da etapa + o quadradinho "···".
 * Só visual: cada botão chama o mesmo handler de sempre, passado pela página.
 */
export const CARD_BOTAO_PRINCIPAL = 'inline-flex h-[26px] min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-[2px] bg-[#0688D4] px-2.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-[#0570AE] disabled:opacity-50'
const ICONE_BOTAO = 'inline-flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[2px] text-[#6B7280] transition-colors hover:bg-[#E5E7EB] hover:text-[#111827] disabled:opacity-50'
const QUADRADO_CLARO = 'inline-flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[2px] bg-[#E0F2FE] text-[#0369A1] transition-colors hover:bg-[#BAE6FD] disabled:opacity-50'
const ICONE = 'h-[14px] w-[14px]'
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

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
  const corTempo = { ok: 'text-[#6B7280]', atencao: 'text-[#B45309]', atraso: 'text-[#B91C1C]' }[corTempoPedido(idadeMs)]
  const origem = origemVisivelNoCard(order)
  const posto = rotuloOrigemPedido(order).posto
  const seloOrigem = origem ? origem.icone : posto === 'Delivery' ? 'direto' : null
  const dicaOrigem = origem?.dica ?? 'Pedido do cardápio (direto)'
  const tipo = order.canal === 'mesa' ? `Mesa${order.mesa ? ` ${order.mesa}` : ''}` : order.tipo === 'entrega' ? 'Entrega' : 'Retirada'
  const { texto: itens, resto } = resumoItens(order.itens)
  const dicaPag = [rotuloForma(order.formaPagamento, order.cartaoTipo, order.pagamentoOnline), order.pago ? 'Pago' : statusAReceber(order.tipo), order.formaPagamento === 'dinheiro' && order.trocoPara ? `Troco p/ ${formatarReal(order.trocoPara)}` : null].filter(Boolean).join(' · ')
  const local = order.tipo === 'entrega' ? order.enderecoBairro : null
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
        'cursor-pointer rounded-[2px] border bg-[#FBFBFC] transition-[box-shadow,border-color] hover:border-[#C9CED6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688D4]',
        selecionado ? 'border-[#0688D4] ring-1 ring-[#0688D4]/40' : 'border-[#E3E6EA]',
        destaqueNovo ? 'animate-new-order' : '',
        destaqueNovo && somBloqueado ? 'animate-pulse ring-4 ring-[#DC2626]' : '',
      ].join(' ')}
    >
      <div className="px-2.5 pb-1.5 pt-2">
        {/* Linha 1: nº + cliente em negrito · valor à direita */}
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-[12.5px] font-semibold leading-[16px] text-[#111827]" title={order.clienteNome || undefined}>
            <span className="text-[#374151]">#{order.numero}</span> · {order.clienteNome || 'Cliente'}
          </span>
          <span className="whitespace-nowrap text-[12.5px] font-semibold leading-[16px] tabular-nums text-[#15803D]" data-testid="card-preco">{formatarReal(order.total)}</span>
        </div>
        {/* Linha 2: tipo · bairro · pagamento — hora e tempo à direita */}
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11.5px] leading-[15px] text-[#6B7280]">
          <span className="flex min-w-0 items-center gap-1 truncate">
            <span data-testid="card-tipo">{tipo}</span>
            {local && <span className="truncate">· {local}</span>}
            {order.formaPagamento === 'pix' && order.canal !== 'mesa' && (
              <span className="inline-flex flex-shrink-0 items-center gap-0.5" title={dicaPag} aria-label={dicaPag} data-testid="card-pix" data-pago={order.pago ? '1' : '0'}>
                · <IconePix className="h-[12px] w-[12px]" />
                {order.pago ? <Check className="h-[10px] w-[10px] text-[#15803D]" strokeWidth={3} aria-hidden /> : <span className="text-[10.5px] text-[#B45309]">aguard.</span>}
              </span>
            )}
          </span>
          <span className={`flex-shrink-0 whitespace-nowrap tabular-nums ${corTempo}`} data-testid="card-tempo" title="Hora do pedido · tempo desde que chegou">
            {hora(order.criadoEm)} · há {textoTempoPedido(idadeMs)}
          </span>
        </div>
        {/* Itens */}
        {order.itens.length > 0 && (
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-[15px] text-[#4B5563]" data-testid="card-itens">
            {itens}{resto > 0 && <span className="text-[#9CA3AF]"> +{resto} {resto === 1 ? 'item' : 'itens'}</span>}
          </p>
        )}
      </div>
      {/* Rodapé: selo da origem à esquerda; ícones + botão azul + "···" à direita. Não abre o painel. */}
      <div className="flex items-center gap-1 px-2 pb-2 pt-0.5" onClick={(e) => e.stopPropagation()} data-testid="card-acoes">
        {seloOrigem && (
          <Dica texto={dicaOrigem}>
            <span className="inline-flex" aria-label={dicaOrigem} data-testid="card-origem" data-origem={seloOrigem}><SeloOrigem canal={seloOrigem} /></span>
          </Dica>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {acoes.onImprimir && (
            <button type="button" className={ICONE_BOTAO} onClick={acoes.onImprimir} title="Imprimir o pedido" aria-label="Imprimir o pedido" data-testid="card-imprimir"><Printer className={ICONE} aria-hidden /></button>
          )}
          {acoes.onEditar && (
            <button type="button" className={ICONE_BOTAO} onClick={acoes.onEditar} title="Editar pagamento" aria-label="Editar pagamento" data-testid="card-editar"><Pencil className={ICONE} aria-hidden /></button>
          )}
          {acoes.principal}
          {acoes.avancar && (
            <button type="button" className={CARD_BOTAO_PRINCIPAL} onClick={acoes.avancar.onClick} data-testid={acoes.avancar.testid ?? 'card-etapa'}>
              {acoes.avancar.rotulo} <ArrowRight className={ICONE} aria-hidden />
            </button>
          )}
          {acoes.onMais && (
            <button type="button" className={QUADRADO_CLARO} onClick={(e) => acoes.onMais?.(e.currentTarget)} aria-haspopup="menu" aria-expanded={!!acoes.maisAberto} title="Mais informações" aria-label="Mais informações" data-testid="card-mais"><MoreHorizontal className={ICONE} aria-hidden /></button>
          )}
        </div>
      </div>
      {rodape && <div className="border-t border-[#E5E7EB] px-2.5 py-1.5" onClick={(e) => e.stopPropagation()}>{rodape}</div>}
    </div>
  )
}
