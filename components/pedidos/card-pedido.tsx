'use client'

import { Fragment, type ReactNode } from 'react'
import { IcoEditar, IcoEntrega, IcoImprimir, IcoMais, IcoOk, IcoSeguir } from '@/components/icones/sistema'
import type { Pedido } from '@/lib/queries/pedidos'
import { itensAdicionados } from '@/lib/pedido-edicao-regras'
import { Editado, EtiquetaEdicao } from '@/components/pedidos/marcas-edicao'
import { BOTAO_NEUTRO, classeBotao, DINHEIRO, type TomBotao } from '@/components/ui/botoes'
import { corTempoPedido, textoTempoPedido } from '@/lib/tempo-pedido'
import { formatarReal } from '@/lib/moeda'
import { appIntegradoDoPedido, origemVisivelNoCard, rotuloOrigemPedido } from '@/lib/pedido-origem'
import { IconeIaClaude, IconePix, LogoApp, SeloOrigem } from '@/components/icones/origens'
import { Dica } from '@/components/ui/flutuante'
import { rotuloForma, statusAReceber } from '@/lib/pdv-pagamento'
import { etiquetaDiferenca } from '@/lib/pagamentos/diferenca'

/**
 * Card do pedido no Kanban (redesign 18/10/2026, rodada 3 — referência note-imagem.webp do dono): card branco
 * quase cinza, borda fina, cantos retos, SOMBRA embaixo (o card fica um nível acima da coluna), texto pequeno em
 * linhas; nº + cliente em negrito, VALOR no canto superior direito, hora/tempo em cinza à direita da 2ª linha, itens
 * em 2 linhas; rodapé com os ÍCONES DO PEDIDO à esquerda (origem, IA, Pix — os mesmos do painel) e, à direita,
 * imprimir, editar, o botão azul da etapa e o quadradinho "···". Só visual: cada botão chama o mesmo handler.
 */
/** Ação principal azul (Aceitar / Despachar / Saiu p/ entrega) — tokens do Bloco C (components/ui/botoes.ts). */
export const CARD_BOTAO_PRINCIPAL = classeBotao('azul')
const ICONE_BOTAO = BOTAO_NEUTRO
const QUADRADO_CLARO = BOTAO_NEUTRO
const ICONE = 'h-[14px] w-[14px]'
/** Azul de destaque do redesign (lápis e risco da IA, textos do painel). */
const AZUL_IA = '#184F95'
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** "2× X-Tudo, 1× Coca 2L" — até `max` itens, depois "+N itens". */
export function resumoItens(itens: Pedido['itens'], max = 3): { texto: string; resto: number } {
  const partes = itens.slice(0, max).map((i) => `${i.quantidade}× ${i.nome}${i.tamanhoNome ? ` ${i.tamanhoNome}` : ''}`)
  return { texto: partes.join(', '), resto: Math.max(0, itens.length - max) }
}

/** Texto do Pix ao passar o mouse: "Pago online", "Pix pago" ou "Pix · aguardando pagamento". */
export function dicaPix(p: Pick<Pedido, 'pago' | 'pagamentoOnline' | 'tipo'>): string {
  if (p.pago && p.pagamentoOnline) return 'Pago online (Pix)'
  if (p.pago) return 'Pix pago'
  return `Pix · ${statusAReceber(p.tipo).toLowerCase()}`
}

/**
 * Ícones do pedido (DEFINITIVOS depois de aprovados; os mesmos no card e no painel): selo da origem, o ícone da IA
 * quando o pedido foi tirado pelo Agente (com um risco separando), e o Pix com o estado.
 */
export function IconesDoPedido({ order, tamanho = 'card' }: { order: Pedido; tamanho?: 'card' | 'painel' }) {
  const origem = origemVisivelNoCard(order)
  const posto = rotuloOrigemPedido(order).posto
  const ia = order.origemCanal === 'whatsapp_ia'
  // Pela IA: o selo é o do WhatsApp (de onde veio) e o ícone da IA mostra quem tirou.
  const selo = ia ? 'whatsapp' : origem ? origem.icone : posto === 'Delivery' ? 'direto' : null
  const dicaOrigem = ia ? 'Origem: WhatsApp — pedido tirado pelo Agente de IA' : origem?.dica ?? 'Pedido do cardápio (direto)'
  const g = tamanho === 'painel'
  return (
    <span className={`inline-flex items-center ${g ? 'gap-2' : 'gap-1.5'}`} data-testid="icones-pedido">
      {selo && (
        <Dica texto={dicaOrigem}>
          <span className="inline-flex" aria-label={dicaOrigem} data-testid="card-origem" data-origem={ia ? 'whatsapp_ia' : selo}><SeloOrigem canal={selo} /></span>
        </Dica>
      )}
      {ia && (
        <Dica texto="Pedido tirado pelo Agente de IA (Claude)">
          <span className="inline-flex items-center gap-1.5" aria-label="Pedido tirado pelo Agente de IA" data-testid="card-ia">
            <span className="h-[14px] w-px bg-[#D1D5DB]" aria-hidden />
            <IconeIaClaude className={g ? 'h-[20px] w-[20px]' : 'h-[18px] w-[18px]'} />
            {/* Lápis + o "risco" (assinatura) em #184F95, colados: a IA anotou o pedido. */}
            <span className="-ml-0.5 inline-flex items-center gap-[2px]" style={{ color: AZUL_IA }} aria-hidden>
              <IcoEditar className={g ? 'h-[13px] w-[13px]' : 'h-[12px] w-[12px]'} />
              {/* Onda centrada na caixa (nada sai do viewBox) e overflow visível por segurança. */}
              <svg viewBox="0 0 28 14" className={`overflow-visible ${g ? 'h-[14px] w-[28px]' : 'h-[13px] w-[26px]'}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M1.5 7c2.5-5.5 6-5.5 8.5 0s6 5.5 8.5 0 6-5.5 8 0" /></svg>
            </span>
          </span>
        </Dica>
      )}
      {order.formaPagamento === 'pix' && order.canal !== 'mesa' && (
        <Dica texto={dicaPix(order)}>
          <span className="inline-flex items-center gap-0.5" aria-label={dicaPix(order)} data-testid="card-pix" data-pago={order.pago ? '1' : '0'}>
            <IconePix className={g ? 'h-[18px] w-[18px]' : 'h-[16px] w-[16px]'} />
            {order.pago ? <IcoOk className={`h-[11px] w-[11px] ${DINHEIRO}`} /> : <span className="text-[10.5px] font-medium text-[#B45309]">aguard.</span>}
          </span>
        </Dica>
      )}
    </span>
  )
}

export interface AcoesCard {
  /** Ação principal (Aceitar / Pronto / Entregue…). Ausente = a página passa `principal` pronto (despacho). */
  avancar?: { rotulo: string; onClick: () => void; testid?: string; /** azul = seguir (padrão) · verde = concluir (Pronto, Entregue). */ tom?: TomBotao }
  /** Slot da ação principal quando ela é composta (Despachar + Lalamove no pedido pronto de entrega). */
  principal?: ReactNode
  onImprimir?: () => void
  onEditar?: () => void
  onMais?: (ancora: HTMLButtonElement) => void
  maisAberto?: boolean
}

export function CardPedido({ order, now, selecionado, destaqueNovo, atencao = false, somBloqueado, onAbrir, acoes, rodape }: {
  order: Pedido
  now: number
  selecionado: boolean
  /** Pedido recebido ainda não aceito: animação de pedido novo (Bloco F — entrada sutil, amarelo↔verde 3×, verde claro ~15 s). */
  destaqueNovo: boolean
  /** Solicitação do cliente pendente (Aplicar/Recusar): destaque fixo em amarelo, sem piscar. */
  atencao?: boolean
  somBloqueado: boolean
  /** Recebe o card clicado: o painel abre do lado oposto ao card, para não cobrir o que se quer clicar. */
  onAbrir: (card: HTMLElement) => void
  acoes: AcoesCard
  /** Linha extra abaixo das ações (ex.: corrida da Lalamove em andamento). */
  rodape?: ReactNode
}) {
  const idadeMs = now - new Date(order.criadoEm).getTime()
  const corTempo = { ok: 'text-[#6B7280]', atencao: 'text-[#B45309]', atraso: 'text-[#B91C1C]' }[corTempoPedido(idadeMs)]
  const tipo = order.canal === 'mesa' ? `Mesa${order.mesa ? ` ${order.mesa}` : ''}` : order.tipo === 'entrega' ? 'Entrega' : 'Retirada'
  const { resto } = resumoItens(order.itens)
  const adicionados = itensAdicionados(order.edicoes)
  const removidos = order.itensRemovidos ?? []
  const local = order.tipo === 'entrega' ? order.enderecoBairro : null
  const pag = rotuloForma(order.formaPagamento, order.cartaoTipo, order.pagamentoOnline, order.valeBandeira)
  // Fase 3 (19/10): diferença de pedido pago online (Pix pendente / vencido / na entrega).
  const dif = etiquetaDiferenca(order)
  const app = appIntegradoDoPedido(order)
  return (
    <div
      data-testid={`pedido-${order.numero}`}
      data-selecionado={selecionado ? '1' : undefined}
      role="button"
      tabIndex={0}
      aria-pressed={selecionado}
      aria-label={`Pedido #${order.numero}: abrir o painel`}
      onClick={(e) => onAbrir(e.currentTarget)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onAbrir(e.currentTarget) } }}
      className={[
        'cursor-pointer rounded-[2px] border bg-white shadow-[0_2px_4px_rgba(16,24,40,0.10),0_1px_2px_rgba(16,24,40,0.06)] transition-[box-shadow,border-color] hover:shadow-[0_4px_10px_rgba(16,24,40,0.14),0_1px_2px_rgba(16,24,40,0.06)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688D4]',
        selecionado ? 'border-[#0688D4] ring-1 ring-[#0688D4]/40' : 'border-[#DFE3E8]',
        destaqueNovo ? 'animate-new-order' : '',
        atencao ? 'card-atencao' : '',
        destaqueNovo && somBloqueado ? 'animate-pulse ring-4 ring-[#DC2626]' : '',
      ].join(' ')}
    >
      <div className="px-2.5 pb-1.5 pt-2">
        {/* Linha 1: nº + cliente em negrito · valor à direita */}
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-[12.5px] font-semibold leading-[16px] text-[#111827]" title={order.clienteNome || undefined}>
            <span className="text-[#374151]">#{order.numero}</span> · {order.clienteNome || 'Cliente'}
          </span>
          {/* ENTREGA (19/10): a motinha do modal ao lado do nome; retirada e mesa não mostram nada. */}
          {order.tipo === 'entrega' && order.canal !== 'mesa' && <span className="inline-flex flex-shrink-0 items-center text-[#0369A1]" title="Entrega" aria-label="Entrega" data-testid="card-entrega"><IcoEntrega className="h-[15px] w-[15px]" /></span>}
          {/* App integrado (Bloco E): logo GRANDE no espaço entre o nome e o valor. */}
          {app && <span className="ml-auto mr-1 inline-flex flex-shrink-0 items-center" data-testid="card-app" data-app={app.canal}><LogoApp canal={app.canal} altura={24} /></span>}
          <span className={`whitespace-nowrap text-[12.5px] font-semibold leading-[16px] tabular-nums ${DINHEIRO}`} data-testid="card-preco">{formatarReal(order.total)}</span>
        </div>
        {/* Linha 2: tipo · bairro · forma — hora e tempo à direita */}
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11.5px] leading-[15px] text-[#6B7280]">
          <span className="min-w-0 truncate">
            {order.editadoEm && <span className="mr-1 rounded-[2px] border border-[#F59E0B] bg-[#FEF3C7] px-1 text-[10.5px] font-semibold text-[#92400E]" title={`Alterado às ${hora(order.editadoEm)}${order.editadoPorNome ? ` por ${order.editadoPorNome}` : ''}`} data-testid="card-editado">editado</span>}
            <span data-testid="card-tipo">{tipo}</span>
            {local && <> · {local}</>}
            {order.canal !== 'mesa' && <> · {pag}</>}
            {dif && <> · <span className={`font-semibold ${dif.tom === 'vencido' ? 'text-[#B91C1C]' : 'text-[#92400E]'}`} data-testid="card-diferenca" data-tom={dif.tom}>{dif.curto}</span></>}
          </span>
          <span className={`flex-shrink-0 whitespace-nowrap tabular-nums ${corTempo}`} data-testid="card-tempo" title="Hora do pedido · tempo desde que chegou">
            {hora(order.criadoEm)} · há {textoTempoPedido(idadeMs)}
          </span>
        </div>
        {/* Itens — item adicionado por edição em amarelo + "adicionado"; removido riscado + "removido" (Bloco A, 19/10) */}
        {(order.itens.length > 0 || removidos.length > 0) && (
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-[15px] text-[#4B5563]" data-testid="card-itens">
            {order.itens.slice(0, 3).map((i, k) => {
              const nome = `${i.quantidade}× ${i.nome}${i.tamanhoNome ? ` ${i.tamanhoNome}` : ''}`
              return <Fragment key={i.id}>{k > 0 && ', '}{adicionados.has(i.id) ? <><Editado>{nome}</Editado><EtiquetaEdicao tipo="adicionado" /></> : nome}</Fragment>
            })}
            {resto > 0 && <span className="text-[#9CA3AF]"> +{resto} {resto === 1 ? 'item' : 'itens'}</span>}
            {removidos.map((r) => <Fragment key={r.id}>{order.itens.length > 0 && ', '}<s className="text-[#9CA3AF]">{r.quantidade}× {r.nome}{r.tamanhoNome ? ` ${r.tamanhoNome}` : ''}</s><EtiquetaEdicao tipo="removido" /></Fragment>)}
          </p>
        )}
      </div>
      {/* Rodapé: ícones do pedido à esquerda; imprimir, editar, botão azul e "···" à direita. Não abre o painel. */}
      <div className="flex items-center gap-1 px-2 pb-2 pt-0.5" onClick={(e) => e.stopPropagation()} data-testid="card-acoes">
        <IconesDoPedido order={order} />
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {acoes.onImprimir && (
            <button type="button" className={ICONE_BOTAO} onClick={acoes.onImprimir} title="Imprimir o pedido" aria-label="Imprimir o pedido" data-testid="card-imprimir"><IcoImprimir className={ICONE} /></button>
          )}
          {acoes.onEditar && (
            <button type="button" className={ICONE_BOTAO} onClick={acoes.onEditar} title="Editar pagamento" aria-label="Editar pagamento" data-testid="card-editar"><IcoEditar className={ICONE} /></button>
          )}
          {acoes.principal}
          {acoes.avancar && (
            <button type="button" className={classeBotao(acoes.avancar.tom ?? 'azul')} onClick={acoes.avancar.onClick} data-testid={acoes.avancar.testid ?? 'card-etapa'}>
              {acoes.avancar.rotulo} <IcoSeguir className={ICONE} />
            </button>
          )}
          {acoes.onMais && (
            <button type="button" className={QUADRADO_CLARO} onClick={(e) => acoes.onMais?.(e.currentTarget)} aria-haspopup="menu" aria-expanded={!!acoes.maisAberto} title="Mais informações" aria-label="Mais informações" data-testid="card-mais"><IcoMais className={ICONE} /></button>
          )}
        </div>
      </div>
      {rodape && <div className="border-t border-[#E5E7EB] px-2.5 py-1.5" onClick={(e) => e.stopPropagation()}>{rodape}</div>}
    </div>
  )
}
