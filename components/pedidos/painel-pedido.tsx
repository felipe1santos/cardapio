'use client'

import { useEffect } from 'react'
import { AlertTriangle, ArrowLeft, Banknote, Bike, CreditCard, MapPin, Pencil, Phone, PrinterCheck, X } from 'lucide-react'
import type { Pedido } from '@/lib/queries/pedidos'
import { EtiquetasPedido } from '@/components/pedidos/etiquetas-pedido'
import { EditorPagamento } from '@/components/pedidos/editor-pagamento'
import { IconesDoPedido } from '@/components/pedidos/card-pedido'
import { IconePix, IconeWhatsapp } from '@/components/icones/origens'
import { referenciaDoLancamento } from '@/lib/pedido-origem'
import { rotuloMotivo, podeCancelar } from '@/lib/cancelamento'
import { textoAgendado } from '@/lib/agendamento'
import { mascararTelefoneBR } from '@/lib/telefone'
import { rotuloForma, statusAReceber, trocoLevar } from '@/lib/pdv-pagamento'
import { textoTempoPedido } from '@/lib/tempo-pedido'
import { textoStatusLalamove, type EntregaProvedorLinha } from '@/lib/entregas/lalamove-status'

/**
 * Painel do pedido (redesign 18/10/2026, rodada 3): abre POR CIMA do quadro, no lado oposto ao card clicado (não
 * espreme as colunas nem cobre o que se quer clicar); clique fora (que não seja outro card) fecha. Cantos retos,
 * fonte do painel (Mulish), um bloco só com divisórias finas. Ações no topo (Reimprimir, Cancelar); barrinhas de
 * etapa discretas; azul de destaque #184F95; observação do cliente sempre em vermelho; os mesmos ícones do card.
 * Mesmos handlers de sempre.
 */
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null)
export const AZUL_DESTAQUE = '#184F95'
const FONTE = { fontFamily: 'var(--font-painel), var(--font-inter), system-ui, sans-serif' }
const SECAO = 'px-4 py-3'
const TITULO = 'mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8A94A6]'
const LINHA = 'flex items-start justify-between gap-3 py-[3px] text-[13px]'
const ROTULO = 'flex-shrink-0 text-[#6B7280]'
const VALOR = 'min-w-0 text-right font-semibold text-[#1F2937]'
const BOTAO = 'inline-flex h-[32px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[2px] border px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50'

type Etapa = { id: string; rotulo: string; quando: string | null }

/** Etapas que existem para o pedido: entrega tem "Em rota"; retirada e mesa não. */
export function etapasDoPedido(p: Pick<Pedido, 'tipo' | 'canal' | 'criadoEm' | 'etapas'> & { entregueAutomatico?: boolean }): Etapa[] {
  const e = p.etapas
  const lista: Etapa[] = [
    { id: 'recebido', rotulo: 'Recebido', quando: p.criadoEm },
    { id: 'preparando', rotulo: 'Preparando', quando: e?.preparando ?? null },
    { id: 'pronto', rotulo: 'Pronto', quando: e?.pronto ?? null },
  ]
  if (p.tipo === 'entrega' && p.canal !== 'mesa') lista.push({ id: 'em_rota', rotulo: 'Em rota', quando: e?.emRota ?? null })
  lista.push({ id: 'entregue', rotulo: p.entregueAutomatico ? 'Entregue (automático)' : 'Entregue', quando: e?.entregue ?? null })
  return lista
}

/** Barrinhas discretas (3px): verde suave até a etapa atual, cinza depois; vermelho claro se cancelado. */
function BarrasEtapas({ pedido }: { pedido: Pedido }) {
  const etapas = etapasDoPedido(pedido)
  const cancelado = pedido.status === 'cancelado'
  const atual = cancelado ? -1 : Math.max(0, etapas.findIndex((x) => x.id === pedido.status))
  const tudoFeito = pedido.status === 'entregue'
  const corrente = cancelado ? null : etapas[atual]
  return (
    <div className="flex items-center gap-3" data-testid="painel-linha-do-tempo" data-etapa={cancelado ? 'cancelado' : corrente?.id}>
      <div className="flex w-[120px] flex-shrink-0 gap-[3px]" role="img" aria-label={cancelado ? 'Pedido cancelado' : `Etapa ${atual + 1} de ${etapas.length}: ${corrente?.rotulo}`}>
        {etapas.map((et, i) => {
          const feita = !cancelado && (tudoFeito || i <= atual)
          return <span key={et.id} className={`h-[3px] flex-1 rounded-[1px] ${cancelado ? 'bg-[#FCA5A5]' : feita ? 'bg-[#6FBF8F]' : 'bg-[#DDE1E6]'}`} data-testid={`etapa-${et.id}`} data-estado={cancelado ? 'cancelada' : feita ? 'feita' : 'proxima'} title={`${et.rotulo}${hora(et.quando) ? ` · ${hora(et.quando)}` : ''}`} />
        })}
      </div>
      <span className="text-[12px] font-semibold" style={{ color: cancelado ? '#B91C1C' : AZUL_DESTAQUE }}>{cancelado ? 'Cancelado' : corrente?.rotulo}</span>
      {!cancelado && <span className="text-[11.5px] text-[#8A94A6]">{Math.min(atual + 1, etapas.length)} de {etapas.length}{corrente && hora(corrente.quando) ? ` · ${hora(corrente.quando)}` : ''}</span>}
    </div>
  )
}

function Obs({ texto, testid }: { texto: string; testid: string }) {
  return (
    <p className="mt-0.5 flex items-start gap-1.5 text-[12.5px] font-semibold text-[#B91C1C]" data-testid={testid}>
      <AlertTriangle className="mt-[2px] h-3.5 w-3.5 flex-shrink-0" aria-hidden /> <span>{texto}</span>
    </p>
  )
}

export function PainelPedido({
  pedido, agora, onFechar, editandoPag, setEditandoPag, onPagamentoAlterado,
  reimpEstado, onReimprimir, onCancelar, corrida, lado = 'direita', onEditar,
}: {
  pedido: Pedido
  agora: number
  /** Editar pedido (18/10): abre a janela de edição (itens, endereço, pagamento). Ausente = sem botão. */
  onEditar?: () => void
  /** Lalamove (0199): corrida do pedido, quando houve. */
  corrida?: EntregaProvedorLinha | null
  /** Lado em que abre (o oposto ao card clicado). */
  lado?: 'direita' | 'esquerda'
  onFechar: () => void
  editandoPag: boolean
  setEditandoPag: (v: boolean) => void
  onPagamentoAlterado: () => void
  reimpEstado: 'idle' | 'enviando' | 'ok' | 'erro'
  onReimprimir: () => void
  onCancelar: () => void
}) {
  // Esc fecha (se nenhuma janela estiver por cima).
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  const p = pedido
  const Icone = p.formaPagamento === 'dinheiro' ? Banknote : CreditCard
  const levar = !p.pago && p.formaPagamento === 'dinheiro' ? trocoLevar(p.total, p.trocoPara) : 0
  const idade = textoTempoPedido(agora - new Date(p.criadoEm).getTime())
  const linhaLanc = referenciaDoLancamento(p)
  const tel = p.clienteTelefone.replace(/\D/g, '')
  const wa = tel ? `https://wa.me/${tel.startsWith('55') ? tel : `55${tel}`}` : null

  return (
    <aside
      style={FONTE}
      className={[
        'flex flex-col bg-white max-lg:fixed max-lg:inset-0 max-lg:z-[60]',
        'lg:absolute lg:inset-y-0 lg:z-20 lg:w-[440px] lg:border-[#DFE3E8]',
        lado === 'esquerda' ? 'lg:left-0 lg:border-r lg:shadow-[8px_0_24px_rgba(16,24,40,0.14)]' : 'lg:right-0 lg:border-l lg:shadow-[-8px_0_24px_rgba(16,24,40,0.14)]',
      ].join(' ')}
      data-testid="painel-pedido"
      data-lado={lado}
      aria-label={`Pedido #${p.numero}`}
    >
      {/* Topo: nº, etiquetas e ícones; AÇÕES no topo; cliente/horário; barrinhas */}
      <div className="border-b border-[#E5E7EB] px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onFechar} className="-ml-1 flex h-[32px] items-center gap-1 px-2 text-[13px] font-semibold hover:bg-[#E5E7EB] lg:hidden" style={{ color: AZUL_DESTAQUE }} data-testid="painel-voltar">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
          <h2 className="text-[17px] font-bold leading-tight text-[#111827]">Pedido #{p.numero}</h2>
          <IconesDoPedido order={p} tamanho="painel" />
          <div className="ml-auto flex items-center gap-1.5">
            {onEditar && (
              <button type="button" onClick={onEditar} className={`${BOTAO} border-[#D1D5DB] bg-white text-[#1F2937] hover:bg-[#D1D5DB]`} data-testid="painel-editar" title="Editar itens, endereço ou pagamento">
                <Pencil className="h-4 w-4" aria-hidden /> Editar
              </button>
            )}
            <button type="button" onClick={onReimprimir} disabled={reimpEstado === 'enviando' || reimpEstado === 'ok'}
              className={`${BOTAO} border-[#D1D5DB] bg-white text-[#1F2937] hover:bg-[#D1D5DB]`} data-testid="painel-reimprimir" title="Reimprimir o pedido">
              <PrinterCheck className="h-4 w-4" aria-hidden /> {reimpEstado === 'enviando' ? 'Enviando…' : reimpEstado === 'ok' ? 'Enviado' : 'Reimprimir'}
            </button>
            {podeCancelar(p.status) && (
              <button type="button" onClick={onCancelar} className={`${BOTAO} border-[#FCA5A5] bg-white text-[#B91C1C] hover:bg-[#FECACA]`} data-testid="painel-cancelar">
                <X className="h-4 w-4" aria-hidden /> Cancelar
              </button>
            )}
            <button type="button" onClick={onFechar} aria-label="Fechar o painel" className="flex h-[32px] w-[32px] items-center justify-center rounded-[2px] text-[#6B7280] hover:bg-[#D1D5DB] hover:text-[#111827] max-lg:hidden" data-testid="painel-fechar">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[14px] font-semibold text-[#1F2937]" title={p.clienteNome || undefined}>{p.clienteNome || 'Cliente'}</span>
          <EtiquetasPedido pedido={p} />
        </div>
        <p className="mt-0.5 text-[12px] text-[#6B7280]" data-testid="painel-horario">
          Feito às {hora(p.criadoEm)} · há {idade}
          {p.agendadoPara && <span className="ml-1 font-semibold" style={{ color: AZUL_DESTAQUE }}>· agendado para {textoAgendado(p.agendadoPara)}</span>}
        </p>
        <div className="mt-2.5"><BarrasEtapas pedido={p} /></div>
        {p.editadoEm && p.edicoes && p.edicoes.length > 0 && (
          <p className="mt-2 rounded-[2px] bg-[#FEF3C7] px-2 py-1.5 text-[12px] text-[#92400E]" data-testid="painel-editado">
            <b>Alterado às {hora(p.editadoEm)}{p.editadoPorNome ? ` por ${p.editadoPorNome}` : ''}:</b> {p.edicoes[p.edicoes.length - 1].mudancas.join(' · ')}
          </p>
        )}
        {reimpEstado === 'ok' && <p className="mt-1.5 text-[11.5px] text-[#6B7280]">Sai na próxima varredura do Assistente (impressão automática precisa estar ligada).</p>}
        {reimpEstado === 'erro' && <p className="mt-1.5 text-[11.5px] text-[#B91C1C]">Não foi possível solicitar a reimpressão. Tente de novo.</p>}
      </div>

      <div className="flex-1 divide-y divide-[#EEF0F3] overflow-y-auto">
        {p.status === 'cancelado' && (
          <div className={`${SECAO} bg-[#FEF2F2]`} data-testid="painel-cancelado">
            <div className="text-[13px] font-semibold text-[#B91C1C]">Pedido cancelado · {rotuloMotivo(p.canceladoMotivo)}</div>
            {p.canceladoObservacao && <div className="mt-0.5 text-[12.5px] text-[#1F2937]">{p.canceladoObservacao}</div>}
            {p.canceladoPor && <div className="mt-0.5 text-[11.5px] text-[#6B7280]">por {p.canceladoPor}</div>}
          </div>
        )}

        {/* Cliente */}
        <div className={SECAO} data-testid="painel-cliente">
          <p className={TITULO}>Cliente</p>
          <div className={LINHA}><span className={ROTULO}>Nome</span><span className={VALOR}>{p.clienteNome || '—'}</span></div>
          {p.clienteTelefone && (
            <div className={LINHA}>
              <span className={ROTULO}>Telefone</span>
              <span className="flex items-center gap-2">
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-[2px] hover:bg-[#D1FAE5]" title="Abrir conversa no WhatsApp" aria-label="Abrir conversa no WhatsApp" data-testid="painel-whatsapp">
                    <IconeWhatsapp className="h-[18px] w-[18px]" />
                  </a>
                )}
                <a href={`tel:${tel}`} className="inline-flex items-center gap-1 font-semibold hover:underline" style={{ color: AZUL_DESTAQUE }} data-testid="painel-telefone">
                  <Phone className="h-3.5 w-3.5" aria-hidden /> {mascararTelefoneBR(p.clienteTelefone)}
                </a>
                {!p.telefoneVerificado && p.origem !== 'pdv' && (
                  <span className="bg-[#FEE2E2] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[#B91C1C]" title="Telefone não confirmado por WhatsApp" data-testid="painel-nao-verificado">não verif.</span>
                )}
              </span>
            </div>
          )}
          {linhaLanc && <div className={LINHA} data-testid="detalhes-lancamento"><span className={ROTULO}>Lançamento</span><span className={VALOR}>{linhaLanc}</span></div>}
          {p.status === 'preparando' && p.preparandoPor && <div className={LINHA}><span className={ROTULO}>Em preparo por</span><span className={VALOR}>{p.preparandoPor}</span></div>}
          {p.preparadoPor && <div className={LINHA}><span className={ROTULO}>Preparado por</span><span className={VALOR}>{p.preparadoPor}</span></div>}
          {p.observacao && <Obs texto={`Observação do cliente: ${p.observacao}`} testid="painel-obs-pedido" />}
        </div>

        {/* Entrega */}
        {p.tipo === 'entrega' && (
          <div className={SECAO} data-testid={corrida ? 'painel-lalamove' : 'painel-endereco'}>
            <p className={TITULO}>Entrega{corrida ? ` · Lalamove${corrida.ambiente === 'sandbox' ? ' (teste)' : ''}` : ''}</p>
            <div className={LINHA}>
              <span className={`${ROTULO} inline-flex items-center gap-1`}><MapPin className="h-3.5 w-3.5" aria-hidden /> Endereço</span>
              <span className={VALOR}>
                {p.enderecoRua}, {p.enderecoNumero}{p.enderecoComplemento && ` · ${p.enderecoComplemento}`}
                <br /><span className="font-normal text-[#4B5563]">{p.enderecoBairro}{p.enderecoCidade && ` · ${p.enderecoCidade}`}{p.enderecoCep && ` · ${p.enderecoCep}`}</span>
              </span>
            </div>
            {p.enderecoReferencia && <div className={LINHA}><span className={ROTULO}>Referência</span><span className={VALOR}>{p.enderecoReferencia}</span></div>}
            {corrida ? (
              <>
                <div className={LINHA}><span className={ROTULO}>Situação</span><span className="font-semibold" style={{ color: AZUL_DESTAQUE }}>{textoStatusLalamove(corrida.status)}</span></div>
                {corrida.motoristaNome && <div className={LINHA}><span className={ROTULO}>Entregador</span><span className={VALOR}>{corrida.motoristaNome}{corrida.motoristaPlaca ? ` · ${corrida.motoristaPlaca}` : ''}</span></div>}
                {corrida.motoristaTelefone && <div className={LINHA}><span className={ROTULO}>Telefone</span><a href={`tel:${corrida.motoristaTelefone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 font-semibold hover:underline" style={{ color: AZUL_DESTAQUE }}><Phone className="h-3.5 w-3.5" aria-hidden /> {corrida.motoristaTelefone}</a></div>}
                {corrida.preco !== null && <div className={LINHA}><span className={ROTULO}>Custo da corrida</span><span className={`${VALOR} tabular-nums`}>{brl(corrida.preco)}</span></div>}
                {corrida.shareLink && <a href={corrida.shareLink} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[12.5px] font-semibold underline" style={{ color: AZUL_DESTAQUE }} data-testid="painel-lalamove-rastreio">Acompanhar a entrega (Lalamove)</a>}
              </>
            ) : (p.entregadorId || p.status === 'em_rota' || p.status === 'entregue') ? (
              <div className={LINHA} data-testid="painel-entrega">
                <span className={`${ROTULO} inline-flex items-center gap-1`}><Bike className="h-3.5 w-3.5" aria-hidden /> Motoboy</span>
                <span className={VALOR}>{p.entregadorNome ?? 'Sem motoboy'} · <span style={{ color: AZUL_DESTAQUE }}>{p.status === 'em_rota' ? 'Em rota' : p.status === 'entregue' ? (p.entregueAutomatico ? 'Entregue (automático)' : 'Entregue') : 'Aguardando saída'}</span></span>
              </div>
            ) : null}
          </div>
        )}

        {/* Itens */}
        <div className={SECAO}>
          <p className={TITULO}>Itens do pedido</p>
          <ul className="space-y-1.5" data-testid="painel-itens">
            {p.itens.map((l) => (
              <li key={l.id}>
                <div className="flex justify-between gap-3 text-[13px] text-[#1F2937]">
                  <span className="min-w-0">
                    <b>{l.quantidade}×</b> {l.nome}
                    {l.tamanhoNome && <span className="text-[#6B7280]"> · {l.tamanhoNome}</span>}
                    {l.saborNome && <span className="text-[#6B7280]"> · {l.saborNome}</span>}
                  </span>
                  <span className="flex-shrink-0 font-semibold tabular-nums text-[#15803D]">{brl(l.precoUnitario * l.quantidade)}</span>
                </div>
                {(l.bordaNome || l.massaNome) && <div className="text-[12px] text-[#6B7280]">{[l.bordaNome, l.massaNome].filter(Boolean).join(', ')}</div>}
                {l.complementos.length > 0 && <div className="text-[12px] text-[#6B7280]">{l.complementos.map((c) => (c.preco > 0 ? `${c.nome} (+${brl(c.preco)})` : c.nome)).join(', ')}</div>}
                {l.observacao && <Obs texto={`Obs.: ${l.observacao}`} testid="painel-obs-item" />}
              </li>
            ))}
          </ul>
          <div className="mt-2 space-y-0.5 border-t border-[#EEF0F3] pt-2 text-[12.5px]">
            <div className="flex justify-between text-[#6B7280]"><span>Subtotal</span><span className="tabular-nums">{brl(p.subtotal)}</span></div>
            {p.taxaEntrega > 0 && <div className="flex justify-between text-[#6B7280]"><span>Taxa de entrega</span><span className="tabular-nums">{brl(p.taxaEntrega)}</span></div>}
            {p.desconto > 0 && <div className="flex justify-between text-[#6B7280]"><span>Desconto</span><span className="tabular-nums">−{brl(p.desconto)}</span></div>}
            <div className="flex items-baseline justify-between pt-1"><span className="text-[13.5px] font-bold text-[#111827]">Total</span><span className="text-[17px] font-bold tabular-nums text-[#15803D]" data-testid="painel-total">{brl(p.total)}</span></div>
          </div>
        </div>

        {/* Pagamento */}
        <div className={SECAO}>
          <p className={TITULO}>Pagamento</p>
          {p.canal === 'mesa' ? (
            <div className={LINHA}><span className={ROTULO}>Pagamento</span><span className={VALOR}>No fechamento da conta</span></div>
          ) : (
            <>
              <div className={LINHA} data-testid="detalhes-pagamento">
                <span className={ROTULO}>Forma</span>
                <span className={`${VALOR} inline-flex items-center gap-1.5`}>
                  {p.formaPagamento === 'pix' ? <IconePix className="h-4 w-4" /> : <Icone className="h-4 w-4 text-[#6B7280]" aria-hidden />} {rotuloForma(p.formaPagamento, p.cartaoTipo, p.pagamentoOnline)}
                </span>
              </div>
              <div className={LINHA}><span className={ROTULO}>Situação</span>{p.pago ? <span className="font-semibold text-[#15803D]">{p.pagamentoOnline ? 'Pago online' : 'Pago'}</span> : <span className="font-semibold text-[#92400E]">{statusAReceber(p.tipo)}</span>}</div>
              {p.formaPagamento === 'dinheiro' && p.trocoPara ? (
                <div className={LINHA}><span className={ROTULO}>Troco</span><span className="font-semibold text-[#92400E]" data-testid="painel-troco">para {brl(p.trocoPara)}{levar > 0 ? ` · levar ${brl(levar)}` : ''}</span></div>
              ) : null}
              {p.status !== 'cancelado' && (editandoPag
                ? <div className="pt-2"><EditorPagamento pedidoId={p.id} p={p} onCancelar={() => setEditandoPag(false)} onFeito={() => { setEditandoPag(false); onPagamentoAlterado() }} /></div>
                : <button type="button" onClick={() => setEditandoPag(true)} data-testid="detalhes-alterar-pagamento" className="mt-1 text-[12px] font-semibold underline" style={{ color: AZUL_DESTAQUE }}>Alterar pagamento</button>)}
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
