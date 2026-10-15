'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AlertTriangle, ArrowLeft, ArrowRight, Bike, Check, ChevronDown, Copy, MapPin, MessageCircle, Phone, PrinterCheck, Route, X } from 'lucide-react'
import type { Pedido } from '@/lib/queries/pedidos'
import { EditorPagamento } from '@/components/pedidos/editor-pagamento'
import { etapasDoPedido } from '@/components/pedidos/painel-pedido'
import { referenciaDoLancamento } from '@/lib/pedido-origem'
import { rotuloMotivo, podeCancelar } from '@/lib/cancelamento'
import { textoAgendado } from '@/lib/agendamento'
import { mascararTelefoneBR } from '@/lib/telefone'
import { trocoLevar } from '@/lib/pdv-pagamento'
import { nomeLimpo } from '@/lib/nome-item'
import { logoDaOrigem } from '@/lib/kanban-card'
import { estadosDasEtapas, iniciais, linkDoMapa, pagamentoV3, rotuloDaAcao, selosDoCard, situacaoPagamento, type AcaoV3 } from '@/lib/kanban-v3'
import { EtiquetaNumeroV3, LogoOrigemV3, SeloTexto, tempoV3 } from '@/components/pedidos/card-pedido-v3'
import { BOTAO_AZUL, BOTAO_CONTORNO, BOTAO_PERIGO, BOTAO_VERDE, FONTE_CENTRAL, SELO_AZUL, SELO_CINZA, SELO_POR_TOM, SELO_VERDE } from '@/components/ui/tokens-central'

/**
 * Painel do pedido do Kanban v3 (15/10/2026, "Novidades em teste"): mesma posição e largura do painel de hoje, no padrão da
 * central do WhatsApp. Cabeçalho fixo (nº, nome, selos, horário, logo, etapas), conteúdo rolável em cartões (itens,
 * pagamento, entrega, cliente, histórico) e rodapé fixo com a PRÓXIMA AÇÃO + Reimprimir + Cancelar. Todas as funções são as
 * do painel antigo (as mesmas props): alterar pagamento, reimprimir, cancelar com a confirmação/PIN de hoje.
 */
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null)
const CARTAO = 'rounded-[10px] border border-[#E5E7EB] bg-white p-[14px]'
const TITULO = 'mb-[10px] text-[11.5px] font-bold uppercase tracking-wide text-[#6B7280]'

function Cartao({ titulo, children, testid, acao }: { titulo: ReactNode; children: ReactNode; testid?: string; acao?: ReactNode }) {
  return (
    <section className={CARTAO} data-testid={testid}>
      <div className="flex items-center justify-between gap-2"><h3 className={TITULO}>{titulo}</h3>{acao}</div>
      {children}
    </section>
  )
}

function BarraEtapas({ pedido }: { pedido: Pedido }) {
  const etapas = etapasDoPedido(pedido)
  const estados = estadosDasEtapas(etapas, pedido.status)
  return (
    <ol className="flex gap-[4px]" data-testid="painel-linha-do-tempo">
      {etapas.map((et, i) => {
        const e = estados[i]
        const cor = e === 'feita' ? 'bg-[#047857]' : e === 'atual' ? 'bg-[#0688D4]' : 'bg-[#E5E7EB]'
        const texto = e === 'feita' ? 'text-[#047857]' : e === 'atual' ? 'text-[#0688D4]' : 'text-[#9CA3AF]'
        return (
          <li key={et.id} className="min-w-0 flex-1" data-testid={`etapa-${et.id}`} data-estado={e}>
            <span className={`block h-[5px] rounded-full ${cor}`} aria-hidden />
            <span className={`mt-[5px] block truncate text-[11px] font-bold leading-[14px] ${texto}`}>{et.id === 'entregue' ? 'Entregue' : et.rotulo}</span>
            <span className="block h-[14px] text-[10.5px] tabular-nums leading-[14px] text-[#6B7280]">{e !== 'proxima' ? hora(et.quando) ?? '' : ''}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Complemento em etiqueta com emoji; preço só quando > 0. */
function Etiqueta({ texto, preco }: { texto: string; preco?: number }) {
  return (
    <span className="inline-flex items-center gap-[4px] rounded-[6px] bg-[#F3F4F6] px-[7px] py-[2px] text-[12px] font-semibold leading-[16px] text-[#374151]">
      <span aria-hidden>➕</span>{texto}{preco && preco > 0 ? <span className="font-bold text-[#047857]"> +{brl(preco)}</span> : null}
    </span>
  )
}

function Obs({ texto, testid }: { texto: string; testid: string }) {
  return (
    <div className="mt-[8px] flex items-start gap-[6px] rounded-[8px] border border-[#FCD34D] bg-[#FEF3C7] px-[10px] py-[7px] text-[13px] font-bold text-[#92400E]" data-testid={testid}>
      <AlertTriangle className="mt-[2px] h-[15px] w-[15px] flex-shrink-0" aria-hidden /> <span>{texto}</span>
    </div>
  )
}

/** "Nº pedido do cliente": quantos pedidos (não cancelados) este telefone fez na loja até este. Uma contagem só, por pedido aberto. */
function useNumeroDoCliente(supabase: SupabaseClient | null, restauranteId: string | null, telefone: string, criadoEm: string): number | null {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    setN(null)
    const digitos = (telefone ?? '').replace(/\D/g, '')
    if (!supabase || !restauranteId || digitos.length < 8) return
    let vivo = true
    void supabase.from('pedidos').select('id', { count: 'exact', head: true })
      .eq('restaurante_id', restauranteId).eq('cliente_telefone', telefone).neq('status', 'cancelado').lte('criado_em', criadoEm)
      .then(({ count, error }) => { if (vivo && !error && typeof count === 'number') setN(count) })
    return () => { vivo = false }
  }, [supabase, restauranteId, telefone, criadoEm])
  return n
}

export function PainelPedidoV3({
  pedido, agora, onFechar, editandoPag, setEditandoPag, onPagamentoAlterado, reimpEstado, onReimprimir, onCancelar,
  acao, onAcao, renderDespachar, supabase, restauranteId,
}: {
  pedido: Pedido
  agora: number
  onFechar: () => void
  editandoPag: boolean
  setEditandoPag: (v: boolean) => void
  onPagamentoAlterado: () => void
  reimpEstado: 'idle' | 'enviando' | 'ok' | 'erro'
  onReimprimir: () => void
  onCancelar: () => void
  /** Próxima ação (a mesma da seta do card) e a função atual que a faz. */
  acao: AcaoV3 | null
  onAcao: () => void
  /** Despachar: o mesmo menu de motoboy, com o botão principal como gatilho. */
  renderDespachar?: (gatilho: { className: string; children: ReactNode }) => ReactNode
  supabase: SupabaseClient | null
  restauranteId: string | null
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  const p = pedido
  const selos = selosDoCard(p)
  const pg = pagamentoV3(p)
  const sit = situacaoPagamento(p)
  const levar = !p.pago && p.formaPagamento === 'dinheiro' ? trocoLevar(p.total, p.trocoPara) : 0
  const linhaLanc = referenciaDoLancamento(p)
  const nCliente = useNumeroDoCliente(supabase, restauranteId, p.clienteTelefone, p.criadoEm)
  const [copiado, setCopiado] = useState(false)
  const [historico, setHistorico] = useState(false)
  const entrega = p.tipo === 'entrega' && p.canal !== 'mesa'
  const enderecoTexto = [`${p.enderecoRua}, ${p.enderecoNumero}`, p.enderecoComplemento, p.enderecoBairro, p.enderecoCidade].filter((s) => s && s.trim()).join(' · ')
  const qtdItens = p.itens.reduce((s, l) => s + l.quantidade, 0)
  const etapas = etapasDoPedido(p)
  const eventos = [
    ...etapas.filter((e) => e.quando).map((e) => ({ quando: e.quando!, texto: e.rotulo })),
    ...(p.preparandoPor ? [{ quando: p.etapas?.preparando ?? null, texto: `Em preparo por ${p.preparandoPor}` }] : []),
    ...(p.preparadoPor ? [{ quando: p.etapas?.pronto ?? null, texto: `Preparado por ${p.preparadoPor}` }] : []),
    ...(p.entregadorNome ? [{ quando: p.etapas?.emRota ?? null, texto: `Motoboy: ${p.entregadorNome}` }] : []),
    ...(p.status === 'cancelado' ? [{ quando: p.atualizadoEm, texto: `Cancelado · ${rotuloMotivo(p.canceladoMotivo)}${p.canceladoPor ? ` por ${p.canceladoPor}` : ''}` }] : []),
  ]

  const conversar = () => window.dispatchEvent(new CustomEvent('menuzia:abrir-conversa', { detail: { telefone: p.clienteTelefone } }))
  const copiar = () => {
    void navigator.clipboard?.writeText(enderecoTexto).then(() => { setCopiado(true); window.setTimeout(() => setCopiado(false), 1600) }).catch(() => {})
  }

  const principalClasse = `${acao === 'despachar' ? BOTAO_AZUL : BOTAO_VERDE} h-[46px] w-full text-[14px]`
  const principalConteudo = acao ? (
    <>{acao === 'despachar' && <Route className="h-[18px] w-[18px]" aria-hidden />}{rotuloDaAcao(acao)}<ArrowRight className="h-[18px] w-[18px]" aria-hidden /></>
  ) : null

  return (
    <aside
      className="flex flex-col bg-[#F3F4F6] text-[#111827] max-lg:fixed max-lg:inset-0 max-lg:z-[60] lg:w-[480px] lg:flex-shrink-0 lg:border-l lg:border-[#E5E7EB] lg:shadow-[-8px_0_20px_rgba(17,24,39,.08)]"
      style={FONTE_CENTRAL}
      data-visual="v3"
      data-testid="painel-pedido"
      aria-label={`Pedido #${p.numero}`}
    >
      {/* Cabeçalho fixo */}
      <header className="flex-shrink-0 border-b border-[#E5E7EB] bg-white px-[16px] pb-[12px] pt-[14px]">
        <div className="flex items-start gap-[10px]">
          <button type="button" onClick={onFechar} className="-ml-1 flex h-[40px] items-center gap-1 rounded-[8px] px-2 text-[14px] font-semibold text-[#0688D4] hover:bg-[#EFF6FF] lg:hidden" data-testid="painel-voltar">
            <ArrowLeft className="h-5 w-5" aria-hidden /> Voltar
          </button>
          <div className="min-w-0 flex-1" data-testid="painel-cabecalho-novo">
            <div className="flex min-w-0 items-center gap-[8px]">
              <EtiquetaNumeroV3 numero={p.numero} grande />
              <h2 className="min-w-0 truncate text-[19px] font-extrabold leading-tight" title={p.clienteNome || undefined}>{p.clienteNome || 'Cliente'}</h2>
            </div>
            <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
              <SeloTexto classe={SELO_VERDE} emoji={selos.tipo.emoji} texto={selos.tipo.texto} />
              {selos.azul && <SeloTexto classe={SELO_AZUL} emoji={selos.azul.emoji} texto={selos.azul.texto} />}
              <SeloTexto classe={SELO_CINZA} texto={logoDaOrigem(p).rotulo} titulo={`Origem: ${logoDaOrigem(p).rotulo}${p.origemCampanha ? ` · ${p.origemCampanha}` : ''}`} testid="painel-origem" />
            </div>
            <p className="mt-[6px] text-[13px] font-semibold text-[#4B5563]" data-testid="painel-horario">
              Feito às {hora(p.criadoEm)} · há {tempoV3(agora - new Date(p.criadoEm).getTime())}
              {p.agendadoPara && <span className="text-[#1D4ED8]"> · agendado para {textoAgendado(p.agendadoPara)}</span>}
            </p>
          </div>
          <LogoOrigemV3 pedido={p} tamanho={42} />
          <button type="button" onClick={onFechar} aria-label="Fechar o painel" className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[8px] border border-[#D1D5DB] bg-white text-[#4B5563] hover:border-[#0688D4] hover:text-[#0688D4] max-lg:hidden" data-testid="painel-fechar">
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
        <div className="mt-[12px]"><BarraEtapas pedido={p} /></div>
      </header>

      {/* Conteúdo rolável */}
      <div className="min-h-0 flex-1 space-y-[12px] overflow-y-auto px-[14px] py-[14px] text-[14px]">
        {p.status === 'cancelado' && (
          <div className="rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] p-[12px] text-[14px]" data-testid="painel-cancelado">
            <div className="font-bold text-[#B91C1C]">Pedido cancelado · {rotuloMotivo(p.canceladoMotivo)}</div>
            {p.canceladoObservacao && <div className="mt-1 text-[#1F2937]">{p.canceladoObservacao}</div>}
            {p.canceladoPor && <div className="mt-1 text-[12.5px] text-[#6B7280]">por {p.canceladoPor}</div>}
          </div>
        )}

        {/* a) Itens */}
        <Cartao titulo={`Itens · ${qtdItens}`} testid="painel-itens">
          <ul className="divide-y divide-[#F3F4F6]">
            {p.itens.map((l) => {
              const extras = [l.tamanhoNome, l.saborNome, l.bordaNome, l.massaNome].filter(Boolean)
              return (
                <li key={l.id} className="py-[10px] first:pt-0">
                  <div className="flex items-start gap-[10px]">
                    <span className="flex h-[26px] min-w-[26px] flex-shrink-0 items-center justify-center rounded-[6px] bg-[#F3F4F6] px-[4px] text-[13px] font-extrabold tabular-nums">{l.quantidade}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-[10px]">
                        <span className="min-w-0 pt-[3px] text-[14.5px] font-bold leading-[19px]">{nomeLimpo(l.nome)}</span>
                        <span className="flex-shrink-0 pt-[3px] font-bold tabular-nums">{brl(l.precoUnitario * l.quantidade)}</span>
                      </div>
                      {extras.length > 0 && <div className="mt-[2px] text-[12.5px] text-[#6B7280]">{extras.join(' · ')}</div>}
                      {l.complementos.length > 0 && (
                        <div className="mt-[6px] flex flex-wrap gap-[4px]">
                          {l.complementos.map((c, i) => <Etiqueta key={`${c.nome}-${i}`} texto={c.nome} preco={c.preco} />)}
                        </div>
                      )}
                      {l.observacao && <Obs texto={`Obs.: ${l.observacao}`} testid="painel-obs-item" />}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          {p.observacao && <Obs texto={`Observação do pedido: ${p.observacao}`} testid="painel-obs-pedido" />}
          <div className="mt-[10px] space-y-[4px] border-t border-dashed border-[#D1D5DB] pt-[10px] text-[13.5px]">
            <div className="flex justify-between text-[#4B5563]"><span>Subtotal</span><span className="tabular-nums">{brl(p.subtotal)}</span></div>
            {p.taxaEntrega > 0 && <div className="flex justify-between text-[#4B5563]"><span>Taxa de entrega</span><span className="tabular-nums">{brl(p.taxaEntrega)}</span></div>}
            {p.desconto > 0 && <div className="flex justify-between text-[#047857]"><span>Descontos</span><span className="tabular-nums">−{brl(p.desconto)}</span></div>}
            <div className="flex items-baseline justify-between pt-[4px]"><span className="text-[15px] font-bold">Total</span><span className="text-[22px] font-extrabold tabular-nums" data-testid="painel-total">{brl(p.total)}</span></div>
          </div>
        </Cartao>

        {/* b) Pagamento */}
        <Cartao titulo="Pagamento">
          <div className="flex flex-wrap items-center gap-[6px]" data-testid="detalhes-pagamento">
            {p.canal === 'mesa'
              ? <SeloTexto classe={SELO_VERDE} emoji="🧾" texto="No fechamento da conta" />
              : <>
                  <SeloTexto classe={SELO_POR_TOM[pg.tom]} emoji={pg.emoji} texto={pg.texto.replace(/ · troco p\/.*$/, '')} testid="painel-forma" />
                  <SeloTexto classe={SELO_POR_TOM[sit.tom]} texto={sit.texto} testid="painel-situacao" />
                </>}
          </div>
          {p.canal !== 'mesa' && p.formaPagamento === 'dinheiro' && p.trocoPara && !p.pago ? (
            <div className="mt-[10px] grid grid-cols-2 gap-[8px]" data-testid="painel-troco">
              <div className="rounded-[8px] bg-[#F9FAFB] px-[10px] py-[8px]"><div className="text-[11.5px] font-semibold text-[#6B7280]">Cliente paga com</div><div className="text-[16px] font-extrabold tabular-nums">{brl(p.trocoPara)}</div></div>
              <div className="rounded-[8px] bg-[#FEF3C7] px-[10px] py-[8px]"><div className="text-[11.5px] font-semibold text-[#92400E]">Levar de troco</div><div className="text-[16px] font-extrabold tabular-nums text-[#92400E]" data-testid="painel-troco-levar">{brl(levar)}</div></div>
            </div>
          ) : null}
          {/* A hora exata do pagamento fica em pagamentos_online, que o navegador não lê (só o servidor): sem hora inventada. */}
          {p.pagamentoOnline && p.pago && <p className="mt-[8px] text-[12.5px] text-[#4B5563]" data-testid="painel-pago-as">Pago no app · confirmado pelo Mercado Pago</p>}
          {p.canal !== 'mesa' && p.status !== 'cancelado' && (editandoPag
            ? <div className="mt-[10px]"><EditorPagamento pedidoId={p.id} p={p} onCancelar={() => setEditandoPag(false)} onFeito={() => { setEditandoPag(false); onPagamentoAlterado() }} /></div>
            : <button type="button" onClick={() => setEditandoPag(true)} data-testid="detalhes-alterar-pagamento" className="mt-[10px] text-[13px] font-semibold text-[#0688D4] hover:underline">Alterar pagamento</button>)}
        </Cartao>

        {/* c) Entrega */}
        {entrega && (
          <Cartao titulo="Entrega" testid="painel-entrega">
            <div data-testid="painel-endereco">
              <p className="text-[14.5px] font-bold">{p.enderecoRua}, {p.enderecoNumero}{p.enderecoComplemento ? ` · ${p.enderecoComplemento}` : ''}</p>
              <p className="text-[13px] text-[#4B5563]">{[p.enderecoBairro, p.enderecoCidade, p.enderecoCep].filter(Boolean).join(' · ')}</p>
              {p.enderecoReferencia && <p className="mt-[2px] text-[13px] text-[#4B5563]">Referência: {p.enderecoReferencia}</p>}
            </div>
            {p.status === 'em_rota' && p.etapas?.emRota && (
              <div className="mt-[8px]"><SeloTexto classe={SELO_AZUL} emoji="⏱️" texto={`Saiu às ${hora(p.etapas.emRota)} · há ${tempoV3(agora - new Date(p.etapas.emRota).getTime())}`} /></div>
            )}
            <div className="mt-[10px] grid grid-cols-2 gap-[8px]">
              <a href={linkDoMapa(p)} target="_blank" rel="noopener noreferrer" className={`${BOTAO_CONTORNO} h-[36px] text-[12.5px]`} data-testid="painel-mapa"><MapPin className="h-[15px] w-[15px]" aria-hidden /> Abrir no mapa</a>
              <button type="button" onClick={copiar} className={`${BOTAO_CONTORNO} h-[36px] text-[12.5px]`} data-testid="painel-copiar-endereco">
                {copiado ? <><Check className="h-[15px] w-[15px]" aria-hidden /> Copiado</> : <><Copy className="h-[15px] w-[15px]" aria-hidden /> Copiar endereço</>}
              </button>
            </div>
            <div className="mt-[10px] flex items-center justify-between gap-[8px] border-t border-[#F3F4F6] pt-[10px] text-[13.5px]" data-testid="painel-motoboy">
              <span className="inline-flex items-center gap-[6px] text-[#4B5563]"><Bike className="h-[16px] w-[16px]" aria-hidden /> Motoboy</span>
              <span className={p.entregadorNome ? 'font-bold' : 'text-[#6B7280]'}>{p.entregadorNome ?? 'ainda não definido'}</span>
            </div>
          </Cartao>
        )}

        {/* d) Cliente */}
        <Cartao titulo="Cliente" testid="painel-cliente">
          <div className="flex items-center gap-[12px]">
            <span className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-full bg-[#DBEAFE] text-[14px] font-extrabold text-[#1D4ED8]" aria-hidden>{iniciais(p.clienteNome)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-bold">{p.clienteNome || '—'}</p>
              {p.clienteTelefone && (
                <p className="flex flex-wrap items-center gap-[6px] text-[13px] text-[#4B5563]">
                  <a href={`tel:${p.clienteTelefone.replace(/\D/g, '')}`} className="inline-flex items-center gap-[4px] font-semibold text-[#0688D4] hover:underline" data-testid="painel-telefone"><Phone className="h-[13px] w-[13px]" aria-hidden /> {mascararTelefoneBR(p.clienteTelefone)}</a>
                  {!p.telefoneVerificado && p.origem !== 'pdv' && <span className="rounded-full bg-[#FEF2F2] px-[6px] text-[11px] font-semibold text-[#B91C1C]" title="Telefone não confirmado por WhatsApp" data-testid="painel-nao-verificado">não verificado</span>}
                </p>
              )}
              {nCliente !== null && <p className="text-[12.5px] text-[#6B7280]" data-testid="painel-n-cliente">{nCliente === 1 ? '1º pedido do cliente' : `${nCliente}º pedido do cliente`}</p>}
            </div>
            {p.clienteTelefone && (
              <button type="button" onClick={conversar} className={`${BOTAO_VERDE} h-[36px] px-[12px] text-[12.5px]`} data-testid="painel-conversar">
                <MessageCircle className="h-[15px] w-[15px]" aria-hidden /> Conversar
              </button>
            )}
          </div>
          {linhaLanc && <p className="mt-[10px] text-[13px] text-[#4B5563]" data-testid="detalhes-lancamento">Lançamento: <span className="font-semibold text-[#111827]">{linhaLanc}</span></p>}
        </Cartao>

        {/* e) Histórico (recolhido) */}
        {eventos.length > 0 && (
          <section className={CARTAO} data-testid="painel-historico">
            <button type="button" onClick={() => setHistorico((v) => !v)} aria-expanded={historico} className="flex w-full items-center justify-between text-left">
              <span className={`${TITULO} mb-0`}>Histórico</span>
              <ChevronDown className={`h-[16px] w-[16px] text-[#6B7280] transition-transform ${historico ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            {historico && (
              <ul className="mt-[10px] space-y-[6px] text-[13px]">
                {eventos.map((ev, i) => (
                  <li key={i} className="flex gap-[10px]"><span className="w-[42px] flex-shrink-0 tabular-nums text-[#6B7280]">{hora(ev.quando) ?? '—'}</span><span>{ev.texto}</span></li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {/* Rodapé fixo. lg: espaço à direita para o botão do atendimento e embaixo para o "Despachar" flutuante. */}
      <footer className="flex-shrink-0 space-y-[8px] border-t border-[#E5E7EB] bg-white p-[12px] lg:pb-[76px] lg:pr-[82px]">
        {acao && principalConteudo && (acao === 'despachar' && renderDespachar
          ? renderDespachar({ className: principalClasse, children: principalConteudo })
          : <button type="button" onClick={onAcao} className={principalClasse} data-testid="painel-acao" data-acao={acao}>{principalConteudo}</button>)}
        <div className="grid grid-cols-2 gap-[8px]">
          <button type="button" onClick={onReimprimir} disabled={reimpEstado === 'enviando' || reimpEstado === 'ok'} className={`${BOTAO_CONTORNO} h-[38px] text-[12.5px] ${podeCancelar(p.status) ? '' : 'col-span-2'}`} data-testid="painel-reimprimir">
            <PrinterCheck className="h-[15px] w-[15px]" aria-hidden /> {reimpEstado === 'enviando' ? 'Enviando…' : reimpEstado === 'ok' ? 'Enviado' : 'Reimprimir'}
          </button>
          {podeCancelar(p.status) && (
            <button type="button" onClick={onCancelar} className={`${BOTAO_PERIGO} h-[38px] text-[12.5px]`} data-testid="painel-cancelar">
              <X className="h-[15px] w-[15px]" aria-hidden /> Cancelar pedido
            </button>
          )}
        </div>
        {reimpEstado === 'ok' && <p className="text-center text-[12px] text-[#6B7280]">Sai na próxima varredura do Assistente (impressão automática precisa estar ligada).</p>}
        {reimpEstado === 'erro' && <p className="text-center text-[12px] text-[#B91C1C]">Não foi possível solicitar a reimpressão. Tente de novo.</p>}
      </footer>
    </aside>
  )
}
