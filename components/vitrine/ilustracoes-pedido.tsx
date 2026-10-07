'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { JanelaCrua } from '@/components/ui/flutuante'

/**
 * Ilustrações da vitrine nova (item 57, 2026-10-06): estados vazios de Pedidos e Cupons, a ilustração
 * da última atualização do pedido (ao lado da linha do tempo) e o modal "Seu pedido saiu para entrega".
 * Arquivos em public/vitrine/ilustracoes: os três do dono em WebP e os de status em SVG, no mesmo
 * estilo (scripts/vitrine/ilustracoes-status.mjs). Só a vitrine nova usa (a clássica não muda).
 */
const DIR = '/vitrine/ilustracoes'
export const ILUSTRACOES = {
  pedidosVazio: `${DIR}/pedidos-vazio.webp`,
  cuponsVazio: `${DIR}/cupons-vazio.webp`,
  saiuParaEntrega: `${DIR}/saiu-para-entrega.webp`,
  recebido: `${DIR}/status-recebido.svg`,
  preparando: `${DIR}/status-preparando.svg`,
  pronto: `${DIR}/status-pronto.svg`,
  retirada: `${DIR}/status-retirada.svg`,
  entregue: `${DIR}/status-entregue.svg`,
  cancelado: `${DIR}/status-cancelado.svg`,
} as const

interface StatusDoPedido { status: string; tipo: string; saidaSemConfirmacao?: boolean }

/** A ilustração da ÚLTIMA atualização do pedido (e o texto alternativo). */
export function ilustracaoDoStatus(p: StatusDoPedido): { src: string; alt: string; chave: string } {
  const retirada = p.tipo !== 'entrega'
  switch (p.status) {
    case 'recebido': return { src: ILUSTRACOES.recebido, alt: 'Pedido recebido', chave: 'recebido' }
    case 'preparando': return { src: ILUSTRACOES.preparando, alt: 'Preparando seu pedido', chave: 'preparando' }
    case 'pronto': return retirada
      ? { src: ILUSTRACOES.retirada, alt: 'Pronto para retirada', chave: 'retirada' }
      : { src: ILUSTRACOES.pronto, alt: 'Pronto para despacho', chave: 'pronto' }
    case 'em_rota': return { src: ILUSTRACOES.saiuParaEntrega, alt: 'Saiu para entrega', chave: 'em_rota' }
    case 'entregue':
      // Loja sem entregador: o pedido fecha na saída — para o cliente, ele saiu para entrega.
      if (!retirada && p.saidaSemConfirmacao) return { src: ILUSTRACOES.saiuParaEntrega, alt: 'Saiu para entrega', chave: 'em_rota' }
      return { src: ILUSTRACOES.entregue, alt: retirada ? 'Pedido retirado' : 'Pedido entregue', chave: 'entregue' }
    case 'cancelado': return { src: ILUSTRACOES.cancelado, alt: 'Pedido cancelado', chave: 'cancelado' }
    default: return { src: ILUSTRACOES.recebido, alt: 'Pedido recebido', chave: 'recebido' }
  }
}

/** Ilustração do status; troca sozinha (com um fade curto) quando o status muda. */
export function IlustracaoStatus({ pedido, className = '' }: { pedido: StatusDoPedido; className?: string }) {
  const { src, alt, chave } = ilustracaoDoStatus(pedido)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={chave}
      src={src}
      alt={alt}
      width={140}
      height={140}
      data-testid="ilustracao-status"
      data-status={chave}
      className={`aspect-square flex-shrink-0 select-none object-contain motion-safe:animate-[ilus-entra_.35s_ease-out] ${className}`}
      draggable={false}
    />
  )
}

/** Estado vazio com ilustração (Pedidos e Cupons da vitrine nova). */
export function EstadoVazioIlustrado({ src, titulo, texto, acao, testid }: {
  src: string; titulo: string; texto: string; acao?: { label: string; onClick: () => void }; testid?: string
}) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-6 pb-6 text-center" data-testid={testid}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={220} height={220} className="h-[200px] w-[200px] select-none object-contain min-[400px]:h-[220px] min-[400px]:w-[220px]" draggable={false} />
      <p className="mt-2 text-[18px] font-semibold leading-[24px] text-[#1F1F1F]">{titulo}</p>
      <p className="mt-1.5 max-w-[300px] text-[14px] leading-[20px] text-[#5C5C5C]">{texto}</p>
      {acao && (
        <button
          type="button"
          onClick={acao.onClick}
          className="mt-6 min-h-[48px] rounded-[8px] bg-[var(--tema-dark)] px-8 text-[15px] font-semibold text-white shadow-sm transition-all hover:brightness-95 active:scale-[0.98]"
          data-testid={testid ? `${testid}-acao` : undefined}
        >
          {acao.label}
        </button>
      )}
    </div>
  )
}

/**
 * Foto do item no resumo do pedido, com a quantidade num selo pequeno por cima. Sem foto (ou foto
 * que não carrega): ícone neutro de lanche.
 */
export function FotoItemPedido({ src, quantidade }: { src?: string | null; quantidade: number }) {
  const [falhou, setFalhou] = useState(false)
  const temFoto = !!src && !falhou
  return (
    <span className="relative h-[56px] w-[56px] flex-shrink-0" data-testid="foto-item-pedido" data-tem-foto={temFoto ? 'sim' : 'nao'}>
      {temFoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src!} alt="" loading="lazy" onError={() => setFalhou(true)} className="h-full w-full rounded-[8px] border border-[#EDEDED] object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-[8px] border border-[#EDEDED] bg-[#F5F5F5] text-[#9CA3AF]" aria-hidden>
          <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 10a8 5 0 0 1 16 0z" /><path d="M3.5 13.5h17" /><path d="M4.5 16.5h15a0 0 0 0 1 0 0 2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 1-2.5-2.5z" />
          </svg>
        </span>
      )}
      <span className="absolute -bottom-[6px] -right-[6px] flex h-[22px] min-w-[26px] items-center justify-center rounded-full border-2 border-white bg-[#1F1F1F] px-[6px] text-[11.5px] font-semibold leading-none text-white" data-testid="foto-item-qtd">
        {quantidade}x
      </span>
    </span>
  )
}

/** Pedido que pede o aviso "saiu para entrega": entrega, saiu (ou fechou na saída) e recente (12 h). */
export function pedidoSaiuParaEntrega(p: StatusDoPedido & { criadoEm: string }, agora: number): boolean {
  if (p.tipo !== 'entrega') return false
  const saiu = p.status === 'em_rota' || (p.status === 'entregue' && !!p.saidaSemConfirmacao)
  if (!saiu) return false
  const feito = Date.parse(p.criadoEm)
  return Number.isFinite(feito) && agora - feito < 12 * 60 * 60 * 1000
}

const chaveVistos = (slug: string) => `menuzia_saiu_entrega_vistos_${slug}`
function lerVistos(slug: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(chaveVistos(slug)) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
}
/** Marca o aviso deste pedido como visto neste aparelho (aparece UMA vez por pedido). */
export function marcarSaiuVisto(slug: string, id: string) {
  try { localStorage.setItem(chaveVistos(slug), JSON.stringify([id, ...lerVistos(slug).filter((x) => x !== id)].slice(0, 50))) } catch { /* privado/cheio */ }
}

/**
 * Qual pedido deve abrir o aviso agora (o primeiro que saiu e ainda não foi visto neste aparelho) e a
 * função que o marca como visto. `pausado`: checkout ou ficha abertos — o aviso espera o cliente.
 */
export function usePedidoSaiuParaAvisar<T extends StatusDoPedido & { id: string; criadoEm: string }>(pedidos: T[], slug: string, pausado: boolean): [T | null, (id: string) => void] {
  const [vistos, setVistos] = useState<string[] | null>(null)
  useEffect(() => { setVistos(lerVistos(slug)) }, [slug])
  const marcar = (id: string) => { marcarSaiuVisto(slug, id); setVistos(lerVistos(slug)) }
  if (vistos === null || pausado) return [null, marcar]
  const agora = Date.now()
  return [pedidos.find((p) => pedidoSaiuParaEntrega(p, agora) && !vistos.includes(p.id)) ?? null, marcar]
}

/** Modal central "Seu pedido saiu para entrega!" (portal, camada máxima, via flutuante.tsx). */
export function ModalSaiuParaEntrega({ pedido, onFechar, onVerResumo, tema }: {
  pedido: { numero: number } | null
  onFechar: () => void
  onVerResumo: () => void
  /** Classe e variáveis da vitrine (fonte e cor da loja): o portal fica fora da árvore dela. */
  tema: { className: string; style: CSSProperties }
}) {
  return (
    <JanelaCrua
      aberto={!!pedido}
      onFechar={onFechar}
      rotuloId="saiu-entrega-titulo"
      testid="modal-saiu-entrega"
      classeJanela="w-full max-w-[360px]"
    >
      <div className={`${tema.className} relative overflow-hidden rounded-[16px] bg-white px-6 pb-6 pt-5 text-center shadow-[0_20px_48px_rgba(16,24,40,0.28)]`} style={tema.style}>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          data-testid="modal-saiu-entrega-fechar"
          className="absolute right-3 top-3 flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[#F3F4F6] text-[#3D3D3D] transition-colors hover:bg-[#E5E7EB]"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ILUSTRACOES.saiuParaEntrega} alt="" width={220} height={220} className="mx-auto h-[200px] w-[200px] select-none object-contain" draggable={false} />
        <h2 id="saiu-entrega-titulo" className="mt-1 text-[20px] font-semibold leading-[26px] text-[#1F1F1F]">Seu pedido saiu para entrega!</h2>
        <p className="mt-2 text-[14px] leading-[20px] text-[#5C5C5C]">
          {pedido ? <>O pedido <b className="font-semibold text-[#3D3D3D]">#{pedido.numero}</b> está a caminho. Fique de olho: o entregador chega já.</> : null}
        </p>
        <button
          type="button"
          data-foco-inicial
          onClick={onVerResumo}
          data-testid="modal-saiu-entrega-resumo"
          className="mt-5 min-h-[48px] w-full rounded-[8px] bg-[var(--tema-dark)] px-5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-95 active:scale-[0.98]"
        >
          Ver resumo do pedido
        </button>
      </div>
    </JanelaCrua>
  )
}
