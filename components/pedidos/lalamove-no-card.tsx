'use client'

import { useCallback, useRef, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'

/** Logo oficial da Lalamove (beija-flor), a mesma do card em Integrações. */
// eslint-disable-next-line @next/next/no-img-element
const Logo = ({ className }: { className: string }) => <img src="/icons/integracoes/lalamove.svg" alt="" className={className} aria-hidden />
import { Flutuante } from '@/components/ui/flutuante'
import { formatarReal } from '@/lib/moeda'
import type { Pedido } from '@/lib/queries/pedidos'
import type { RespostaCotacao } from '@/lib/entregas/lalamove-regras'
import { podeCancelarCorrida, textoStatusLalamove, tomStatusLalamove, type EntregaProvedorLinha } from '@/lib/entregas/lalamove-status'

/**
 * Lalamove no card do Kanban (0199, 18/10). Ao lado do Despachar, em "Pronto p/ Despacho":
 *   Chamar Lalamove → cotação (preço + distância) → o dono confirma → corrida criada. NUNCA chama sem confirmação.
 * Com corrida em andamento o card mostra o status (vindo do webhook, em tempo real), o link de rastreio, "Atualizar"
 * (consulta manual) e "Cancelar" (enquanto a Lalamove permite). Visual do Kanban atual + guia-visual §2 (etiquetas).
 */
type Cotacao = RespostaCotacao & { pedidoNumero: number; pagamentoNaEntrega: boolean; trocoPara: number | null; ambiente: string }

const ETIQUETA: Record<ReturnType<typeof tomStatusLalamove>, string> = {
  azul: 'bg-[#E0F2FE] text-[#0369A1]', roxo: 'bg-[#F3E8FF] text-[#7E22CE]', verde: 'bg-[#DCFCE7] text-[#15803D]', laranja: 'bg-[#FFEDD5] text-[#C2410C]', vermelho: 'bg-[#FEE2E2] text-[#B91C1C]',
}
const BOTAO_MINI = 'inline-flex h-[28px] items-center gap-1 whitespace-nowrap rounded-[4px] border border-border bg-white px-2 text-[11.5px] font-semibold text-text-main hover:border-primary hover:text-primary disabled:opacity-50'

async function post<T>(url: string, corpo: unknown): Promise<{ ok: boolean; status: number; j: T & { error?: string } }> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const j = (await r.json().catch(() => ({}))) as T & { error?: string }
  return { ok: r.ok, status: r.status, j }
}

/** Botão "Lalamove" + janela de cotação/confirmação. */
export function ChamarLalamove({ pedido, onChamada, onErro, className = '' }: { pedido: Pedido; onChamada: (corrida: EntregaProvedorLinha) => void; onErro: (m: string) => void; className?: string }) {
  const botao = useRef<HTMLButtonElement>(null)
  const [aberto, setAberto] = useState(false)
  const [cotacao, setCotacao] = useState<Cotacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const fechar = useCallback(() => { setAberto(false); setCotacao(null); setErro(null) }, [])

  async function cotar() {
    setAberto(true); setErro(null); setCotacao(null); setOcupado(true)
    const r = await post<Cotacao>('/api/admin/entregas/lalamove/cotacao', { pedidoId: pedido.id }).catch(() => null)
    setOcupado(false)
    if (!r) return setErro('Sem conexão com o servidor.')
    if (!r.ok) return setErro(r.j.error ?? 'Não foi possível cotar.')
    setCotacao(r.j)
  }
  async function confirmar() {
    if (!cotacao || ocupado) return
    setOcupado(true)
    const { quotationId, preco, moeda, distanciaM, expiraEm, paradas } = cotacao
    const r = await post<{ corrida: EntregaProvedorLinha }>('/api/admin/entregas/lalamove/chamar', { pedidoId: pedido.id, cotacao: { quotationId, preco, moeda, distanciaM, expiraEm, paradas } }).catch(() => null)
    setOcupado(false)
    if (!r || !r.ok) { const m = r?.j.error ?? 'Não foi possível chamar a Lalamove.'; setErro(m); onErro(m); return }
    onChamada(r.j.corrida)
    fechar()
  }
  const km = cotacao?.distanciaM != null ? `${(cotacao.distanciaM / 1000).toFixed(1).replace('.', ',')} km` : null
  return (
    <>
      <button ref={botao} type="button" onClick={() => (aberto ? fechar() : void cotar())} aria-haspopup="dialog" aria-expanded={aberto} title="Chamar um entregador da Lalamove"
        className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 whitespace-nowrap rounded-menuzia border border-[#F16622] bg-white px-2 text-[11px] font-semibold uppercase tracking-wide text-[#C2410C] hover:bg-[#FFF7ED] lg:min-h-0 lg:py-2 ${className}`}
        data-testid="card-lalamove">
        <Logo className="h-4 w-4" /> Lalamove
      </button>
      <Flutuante ancora={botao} aberto={aberto} onFechar={fechar} alinhar="inicio" largura={300} testid={`lalamove-menu-${pedido.numero}`} rotulo={`Chamar Lalamove para o pedido #${pedido.numero}`} className="p-3">
        {ocupado && !cotacao && <p className="flex items-center gap-2 py-2 text-[13px] text-text-subtle" data-testid="lalamove-cotando"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cotando a corrida…</p>}
        {erro && <p className="rounded-[4px] bg-[#FEF2F2] px-2.5 py-2 text-[12.5px] font-medium text-[#B91C1C]" data-testid="lalamove-erro">{erro}</p>}
        {cotacao && (
          <div className="space-y-2" data-testid="lalamove-cotacao">
            <p className="text-[13px] text-text-main">Corrida para <b>#{cotacao.pedidoNumero}</b>{cotacao.ambiente === 'sandbox' && <span className="ml-1 rounded-[4px] bg-[#FEF3C7] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#92400E]">TESTE</span>}</p>
            <div className="flex items-baseline justify-between rounded-[4px] border border-border px-3 py-2">
              <span className="text-[12px] text-text-subtle">Preço{km ? ` · ${km}` : ''}</span>
              <span className="text-[18px] font-semibold tabular-nums text-price-text" data-testid="lalamove-preco">{formatarReal(cotacao.preco)}</span>
            </div>
            <p className="text-[11.5px] text-text-subtle">O tempo estimado aparece quando um entregador aceitar. O preço vale 5 minutos.</p>
            {cotacao.pagamentoNaEntrega && (
              <p className="rounded-[4px] border border-[#FCD34D] bg-[#FEF3C7] px-2.5 py-2 text-[12px] font-medium text-[#92400E]" data-testid="lalamove-aviso-pagamento">
                Pagamento na entrega{cotacao.trocoPara ? ` (troco p/ ${formatarReal(cotacao.trocoPara)})` : ''}: o entregador da Lalamove <b>não cobra</b> do cliente. Combine o pagamento (Pix, link) antes de chamar.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="h-[32px] rounded-[4px] border border-border px-3 text-[12.5px] font-semibold" onClick={fechar}>Voltar</button>
              <button type="button" className="h-[32px] rounded-[4px] bg-[#F16622] px-3 text-[12.5px] font-semibold text-white hover:brightness-95 disabled:opacity-50" disabled={ocupado} onClick={() => void confirmar()} data-testid="lalamove-confirmar">
                {ocupado ? 'Chamando…' : `Confirmar ${formatarReal(cotacao.preco)}`}
              </button>
            </div>
          </div>
        )}
      </Flutuante>
    </>
  )
}

/** Estado da corrida no card (Pronto ou Em trânsito): etiqueta + rastreio + Atualizar + Cancelar. */
export function CorridaLalamoveNoCard({ corrida, onMudou, onErro, compacto = false }: { corrida: EntregaProvedorLinha; onMudou: () => void; onErro: (m: string) => void; compacto?: boolean }) {
  const [ocupado, setOcupado] = useState<'cancelar' | 'atualizar' | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  async function acao(a: 'cancelar' | 'atualizar') {
    setOcupado(a)
    const r = await post<{ status?: string }>('/api/admin/entregas/lalamove/corrida', { acao: a, corridaId: corrida.id }).catch(() => null)
    setOcupado(null); setConfirmando(false)
    if (!r || !r.ok) return onErro(r?.j.error ?? 'Não foi possível falar com a Lalamove.')
    onMudou()
  }
  const tom = tomStatusLalamove(corrida.status)
  return (
    <div className="space-y-1.5" data-testid={`lalamove-corrida-${corrida.status}`} onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[11.5px] font-semibold ${ETIQUETA[tom]}`}>
          <Logo className="h-3.5 w-3.5" /> Lalamove · {textoStatusLalamove(corrida.status)}
        </span>
        {corrida.motoristaNome && <span className="truncate text-[12px] font-medium text-text-main">{corrida.motoristaNome}{corrida.motoristaPlaca ? ` · ${corrida.motoristaPlaca}` : ''}</span>}
        {corrida.shareLink && (
          <a href={corrida.shareLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline" data-testid="lalamove-rastrear">
            Rastrear <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>
      {!compacto && (
        confirmando ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-[4px] bg-[#FEF2F2] px-2 py-1.5 text-[12px] text-[#991B1B]">
            <span className="min-w-0 flex-1">Cancelar a corrida? A Lalamove pode cobrar taxa se o entregador já aceitou.</span>
            <button type="button" disabled={!!ocupado} onClick={() => void acao('cancelar')} className="h-[26px] rounded-[4px] bg-[#B91C1C] px-2 text-[11.5px] font-semibold text-white disabled:opacity-50" data-testid="lalamove-cancelar-confirmar">{ocupado === 'cancelar' ? 'Cancelando…' : 'Cancelar corrida'}</button>
            <button type="button" onClick={() => setConfirmando(false)} className={BOTAO_MINI}>Voltar</button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <button type="button" disabled={!!ocupado} onClick={() => void acao('atualizar')} className={BOTAO_MINI} title="Consultar a corrida na Lalamove agora" data-testid="lalamove-atualizar">
              <RefreshCw className={`h-3.5 w-3.5 ${ocupado === 'atualizar' ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
            </button>
            {podeCancelarCorrida(corrida.status) && (
              <button type="button" disabled={!!ocupado} onClick={() => setConfirmando(true)} className={`${BOTAO_MINI} text-[#B91C1C] hover:border-[#FCA5A5] hover:text-[#B91C1C]`} data-testid="lalamove-cancelar">Cancelar</button>
            )}
          </div>
        )
      )}
    </div>
  )
}
