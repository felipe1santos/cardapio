'use client'

import { useCallback, useRef, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'

/** Provedores de entrega no card (0199 Lalamove; 0208 iFood Sob Demanda e Foody): mesma janela, mesma corrida, muda a marca e a API. */
export type ProvedorNoCard = 'lalamove' | 'ifood' | 'foody' | 'uber'
const MARCA: Record<ProvedorNoCard, { nome: string; curto: string; logo: string; borda: string; texto: string; fundo: string }> = {
  lalamove: { nome: 'Lalamove', curto: 'Lalamove', logo: '/icons/integracoes/lalamove.svg', borda: '#F16622', texto: '#C2410C', fundo: '#F16622' },
  ifood: { nome: 'Entregador iFood', curto: 'iFood', logo: '/origens/ifood.svg', borda: '#EA1D2C', texto: '#B91C1C', fundo: '#EA1D2C' },
  foody: { nome: 'Foody', curto: 'Foody', logo: '/origens/foody.png', borda: '#D3131A', texto: '#B91C1C', fundo: '#D3131A' },
  uber: { nome: 'Uber Direct', curto: 'Uber', logo: '/origens/uber-direct.svg', borda: '#000000', texto: '#111827', fundo: '#000000' },
}
// eslint-disable-next-line @next/next/no-img-element
const Logo = ({ className, provedor = 'lalamove' }: { className: string; provedor?: ProvedorNoCard }) => <img src={MARCA[provedor].logo} alt="" className={className} aria-hidden />
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
type Cotacao = RespostaCotacao & { pedidoNumero: number; pagamentoNaEntrega: boolean; trocoPara: number | null; ambiente: string; prazoMin?: number | null }

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
export function ChamarLalamove({ pedido, onChamada, onErro, className = '', provedor = 'lalamove' }: { pedido: Pedido; onChamada: (corrida: EntregaProvedorLinha) => void; onErro: (m: string) => void; className?: string; provedor?: ProvedorNoCard }) {
  const marca = MARCA[provedor]
  const botao = useRef<HTMLButtonElement>(null)
  const [aberto, setAberto] = useState(false)
  const [cotacao, setCotacao] = useState<Cotacao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const fechar = useCallback(() => { setAberto(false); setCotacao(null); setErro(null) }, [])

  async function cotar() {
    setAberto(true); setErro(null); setCotacao(null); setOcupado(true)
    const r = await post<Cotacao>(`/api/admin/entregas/${provedor}/cotacao`, { pedidoId: pedido.id }).catch(() => null)
    setOcupado(false)
    if (!r) return setErro('Sem conexão com o servidor.')
    if (!r.ok) return setErro(r.j.error ?? 'Não foi possível cotar.')
    setCotacao(r.j)
  }
  async function confirmar() {
    if (!cotacao || ocupado) return
    setOcupado(true)
    const { quotationId, preco, moeda, distanciaM, expiraEm, paradas } = cotacao
    const r = await post<{ corrida: EntregaProvedorLinha }>(`/api/admin/entregas/${provedor}/chamar`, { pedidoId: pedido.id, cotacao: { quotationId, preco, moeda, distanciaM, expiraEm, paradas } }).catch(() => null)
    setOcupado(false)
    if (!r || !r.ok) { const m = r?.j.error ?? `Não foi possível chamar ${marca.nome}.`; setErro(m); onErro(m); return }
    onChamada(r.j.corrida)
    fechar()
  }
  const km = cotacao?.distanciaM != null ? `${(cotacao.distanciaM / 1000).toFixed(1).replace('.', ',')} km` : null
  return (
    <>
      <button ref={botao} type="button" onClick={() => (aberto ? fechar() : void cotar())} aria-haspopup="dialog" aria-expanded={aberto} title={`Chamar um entregador: ${marca.nome}`}
        className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 whitespace-nowrap rounded-menuzia border bg-white px-2 text-[11px] font-semibold uppercase tracking-wide hover:bg-[#FFF7ED] lg:min-h-0 lg:py-2 ${className}`}
        style={{ borderColor: marca.borda, color: marca.texto }} data-testid={`card-${provedor}`}>
        <Logo className="h-4 w-4" provedor={provedor} /> {marca.curto}
      </button>
      <Flutuante ancora={botao} aberto={aberto} onFechar={fechar} alinhar="inicio" largura={300} testid={`lalamove-menu-${pedido.numero}`} rotulo={`Chamar ${marca.nome} para o pedido #${pedido.numero}`} className="p-3">
        {ocupado && !cotacao && <p className="flex items-center gap-2 py-2 text-[13px] text-text-subtle" data-testid="lalamove-cotando"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cotando a corrida…</p>}
        {erro && <p className="rounded-[4px] bg-[#FEF2F2] px-2.5 py-2 text-[12.5px] font-medium text-[#B91C1C]" data-testid="lalamove-erro">{erro}</p>}
        {cotacao && (
          <div className="space-y-2" data-testid="lalamove-cotacao">
            <p className="text-[13px] text-text-main">Corrida para <b>#{cotacao.pedidoNumero}</b>{cotacao.ambiente === 'sandbox' && <span className="ml-1 rounded-[4px] bg-[#FEF3C7] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#92400E]">TESTE</span>}</p>
            <div className="flex items-baseline justify-between rounded-[4px] border border-border px-3 py-2">
              <span className="text-[12px] text-text-subtle">Preço{km ? ` · ${km}` : ''}</span>
              <span className="text-[18px] font-semibold tabular-nums text-price-text" data-testid="lalamove-preco">{formatarReal(cotacao.preco)}</span>
            </div>
            <p className="text-[11.5px] text-text-subtle">{cotacao.prazoMin ? `Prazo estimado: ${cotacao.prazoMin} min. ` : 'O tempo estimado aparece quando um entregador aceitar. '}O preço vale 5 minutos.</p>
            {cotacao.pagamentoNaEntrega && (
              <p className="rounded-[4px] border border-[#FCD34D] bg-[#FEF3C7] px-2.5 py-2 text-[12px] font-medium text-[#92400E]" data-testid="lalamove-aviso-pagamento">
                Pagamento na entrega{cotacao.trocoPara ? ` (troco p/ ${formatarReal(cotacao.trocoPara)})` : ''}: {provedor === 'lalamove' ? <>o entregador da Lalamove <b>não cobra</b> do cliente. Combine o pagamento (Pix, link) antes de chamar.</> : <>confira se o entregador de {marca.nome} <b>recebe</b> na entrega; na dúvida, combine o pagamento (Pix, link) antes de chamar.</>}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="h-[32px] rounded-[4px] border border-border px-3 text-[12.5px] font-semibold" onClick={fechar}>Voltar</button>
              <button type="button" className="h-[32px] rounded-[4px] px-3 text-[12.5px] font-semibold text-white hover:brightness-95 disabled:opacity-50" style={{ backgroundColor: marca.fundo }} disabled={ocupado} onClick={() => void confirmar()} data-testid="lalamove-confirmar">
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
  const provedor: ProvedorNoCard = corrida.provedor === 'ifood' || corrida.provedor === 'foody' || corrida.provedor === 'uber' ? corrida.provedor : 'lalamove'
  const marca = MARCA[provedor]
  const [ocupado, setOcupado] = useState<'cancelar' | 'atualizar' | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  async function acao(a: 'cancelar' | 'atualizar') {
    setOcupado(a)
    const r = await post<{ status?: string }>(`/api/admin/entregas/${provedor}/corrida`, { acao: a, corridaId: corrida.id }).catch(() => null)
    setOcupado(null); setConfirmando(false)
    if (!r || !r.ok) return onErro(r?.j.error ?? `Não foi possível falar com ${marca.nome}.`)
    onMudou()
  }
  const tom = tomStatusLalamove(corrida.status)
  return (
    <div className="space-y-1.5" data-testid={`lalamove-corrida-${corrida.status}`} onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-[11.5px] font-semibold ${ETIQUETA[tom]}`}>
          <Logo className="h-3.5 w-3.5" provedor={provedor} /> {marca.curto} · {textoStatusLalamove(corrida.status).replace('pela Lalamove', `por ${marca.nome}`)}
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
            <span className="min-w-0 flex-1">Cancelar a corrida? {marca.nome} pode cobrar taxa se o entregador já aceitou.</span>
            <button type="button" disabled={!!ocupado} onClick={() => void acao('cancelar')} className="h-[26px] rounded-[4px] bg-[#B91C1C] px-2 text-[11.5px] font-semibold text-white disabled:opacity-50" data-testid="lalamove-cancelar-confirmar">{ocupado === 'cancelar' ? 'Cancelando…' : 'Cancelar corrida'}</button>
            <button type="button" onClick={() => setConfirmando(false)} className={BOTAO_MINI}>Voltar</button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <button type="button" disabled={!!ocupado} onClick={() => void acao('atualizar')} className={BOTAO_MINI} title={`Consultar a corrida em ${marca.nome} agora`} data-testid="lalamove-atualizar">
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
