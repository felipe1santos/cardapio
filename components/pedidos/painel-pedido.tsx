'use client'

import { useEffect } from 'react'
import { AlertTriangle, ArrowLeft, Banknote, Bike, CreditCard, Phone, PrinterCheck, QrCode, X } from 'lucide-react'
import type { Pedido } from '@/lib/queries/pedidos'
import { EtiquetasPedido } from '@/components/pedidos/etiquetas-pedido'
import { EditorPagamento } from '@/components/pedidos/editor-pagamento'
import { referenciaDoLancamento } from '@/lib/pedido-origem'
import { rotuloMotivo, podeCancelar } from '@/lib/cancelamento'
import { textoAgendado } from '@/lib/agendamento'
import { mascararTelefoneBR } from '@/lib/telefone'
import { rotuloForma, statusAReceber, trocoLevar } from '@/lib/pdv-pagamento'
import { textoTempoPedido } from '@/lib/tempo-pedido'

/**
 * Painel do pedido no Painel de Pedidos (2026-10-03). Fica AO LADO do quadro (sem escurecer nem
 * bloquear a tela): dá para clicar em outro card e o painel troca na hora. No celular ocupa a
 * tela toda, com "← Voltar". Tudo do pedido, em letra maior: linha do tempo horizontal, itens com
 * observações em vermelho, totais em verde, cliente/pagamento/entrega e, no rodapé, Reimprimir e
 * Cancelar.
 */
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null)
const VERDE = 'text-status-ready'
const TITULO = 'mb-2 text-[12px] font-bold uppercase tracking-wide text-text-subtle'

type Etapa = { id: string; rotulo: string; quando: string | null }

/** Etapas que existem para o pedido: entrega tem "Em rota"; retirada e mesa não. */
export function etapasDoPedido(p: Pick<Pedido, 'tipo' | 'canal' | 'criadoEm' | 'etapas'>): Etapa[] {
  const e = p.etapas
  const lista: Etapa[] = [
    { id: 'recebido', rotulo: 'Recebido', quando: p.criadoEm },
    { id: 'preparando', rotulo: 'Preparando', quando: e?.preparando ?? null },
    { id: 'pronto', rotulo: 'Pronto', quando: e?.pronto ?? null },
  ]
  if (p.tipo === 'entrega' && p.canal !== 'mesa') lista.push({ id: 'em_rota', rotulo: 'Em rota', quando: e?.emRota ?? null })
  lista.push({ id: 'entregue', rotulo: 'Entregue', quando: e?.entregue ?? null })
  return lista
}

function LinhaDoTempo({ pedido }: { pedido: Pedido }) {
  const etapas = etapasDoPedido(pedido)
  const atual = pedido.status === 'cancelado' ? -1 : Math.max(0, etapas.findIndex((x) => x.id === pedido.status))
  const tudoFeito = pedido.status === 'entregue'
  return (
    <ol className="flex items-start" data-testid="painel-linha-do-tempo">
      {etapas.map((et, i) => {
        const feita = tudoFeito || i < atual
        const corrente = !tudoFeito && i === atual
        const cor = feita ? 'border-status-ready bg-status-ready' : corrente ? 'border-primary bg-primary' : 'border-border bg-white'
        return (
          <li key={et.id} className="relative flex min-w-0 flex-1 flex-col items-center text-center" data-testid={`etapa-${et.id}`} data-estado={feita ? 'feita' : corrente ? 'atual' : 'proxima'}>
            {i > 0 && <span className={`absolute right-1/2 top-[8px] h-[3px] w-full ${feita || corrente ? 'bg-status-ready' : 'bg-border'}`} aria-hidden />}
            <span className={`relative z-10 h-[19px] w-[19px] rounded-full border-[3px] ${cor}`} aria-hidden />
            <span className={`mt-1 text-[12px] font-semibold leading-tight ${feita ? 'text-status-ready' : corrente ? 'text-primary' : 'text-text-subtle'}`}>{et.rotulo}</span>
            {(feita || corrente) && hora(et.quando) && <span className="text-[11.5px] tabular-nums text-text-subtle">{hora(et.quando)}</span>}
          </li>
        )
      })}
    </ol>
  )
}

function Obs({ texto, testid }: { texto: string; testid: string }) {
  return (
    <div className="mt-1.5 flex items-start gap-1.5 rounded-[3px] border border-[#FCA5A5] bg-danger-bg px-2.5 py-1.5 text-[14px] font-bold text-danger" data-testid={testid}>
      <AlertTriangle className="mt-[2px] h-4 w-4 flex-shrink-0" aria-hidden /> <span>{texto}</span>
    </div>
  )
}

export function PainelPedido({
  pedido, agora, onFechar, editandoPag, setEditandoPag, onPagamentoAlterado,
  reimpEstado, onReimprimir, onCancelar, concluirSemEntregador,
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
  /** "Concluir sem entregador" (loja com Logística, pedido de entrega pronto/em rota). */
  concluirSemEntregador?: () => void
}) {
  // Esc fecha (se nenhuma janela estiver por cima).
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  const p = pedido
  const Icone = p.formaPagamento === 'dinheiro' ? Banknote : p.formaPagamento === 'pix' ? QrCode : CreditCard
  const levar = !p.pago && p.formaPagamento === 'dinheiro' ? trocoLevar(p.total, p.trocoPara) : 0
  const idade = textoTempoPedido(agora - new Date(p.criadoEm).getTime())
  const linhaLanc = referenciaDoLancamento(p)

  return (
    <aside
      className="flex flex-col bg-white max-lg:fixed max-lg:inset-0 max-lg:z-[60] lg:w-[460px] lg:flex-shrink-0 lg:border-l lg:border-border lg:shadow-[-4px_0_12px_rgba(16,24,40,0.06)]"
      data-testid="painel-pedido"
      aria-label={`Pedido #${p.numero}`}
    >
      {/* Cabeçalho */}
      <div className="border-b border-border px-4 pb-3 pt-3">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onFechar} className="-ml-1 flex h-[40px] items-center gap-1 rounded-[3px] px-2 text-[14px] font-semibold text-primary hover:bg-primary/10 lg:hidden" data-testid="painel-voltar">
            <ArrowLeft className="h-5 w-5" /> Voltar
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[20px] font-bold leading-tight text-text-main">Pedido #{p.numero}</h2>
              <EtiquetasPedido pedido={p} />
            </div>
            <p className="mt-1 truncate text-[15px] font-semibold text-text-main" title={p.clienteNome || undefined}>{p.clienteNome || 'Cliente'}</p>
            <p className="text-[13px] text-text-subtle" data-testid="painel-horario">
              Feito às {hora(p.criadoEm)} · há {idade}
              {p.agendadoPara && <span className="ml-1 font-semibold text-alert-text">· agendado para {textoAgendado(p.agendadoPara)}</span>}
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar o painel" className="flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-[3px] text-text-subtle hover:bg-page max-lg:hidden" data-testid="painel-fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-3"><LinhaDoTempo pedido={p} /></div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-[14px]">
        {p.status === 'cancelado' && (
          <div className="mb-4 rounded-[3px] border border-danger bg-danger-bg p-3 text-[14px]" data-testid="painel-cancelado">
            <div className="font-bold text-danger">Pedido cancelado · {rotuloMotivo(p.canceladoMotivo)}</div>
            {p.canceladoObservacao && <div className="mt-1 text-text-main">{p.canceladoObservacao}</div>}
            {p.canceladoPor && <div className="mt-1 text-[12.5px] text-text-subtle">por {p.canceladoPor}</div>}
          </div>
        )}

        {/* Itens */}
        <p className={TITULO}>Itens do pedido</p>
        <ul className="mb-4 space-y-2.5 rounded-[3px] border border-border p-3" data-testid="painel-itens">
          {p.itens.map((l) => (
            <li key={l.id}>
              <div className="flex justify-between gap-3 text-[15px] text-text-main">
                <span className="min-w-0">
                  <b>{l.quantidade}x</b> {l.nome}
                  {l.tamanhoNome && <span className="text-text-subtle"> · {l.tamanhoNome}</span>}
                  {l.saborNome && <span className="text-text-subtle"> · {l.saborNome}</span>}
                </span>
                <span className={`flex-shrink-0 font-semibold tabular-nums ${VERDE}`}>{brl(l.precoUnitario * l.quantidade)}</span>
              </div>
              {(l.bordaNome || l.massaNome) && <div className="mt-0.5 text-[13px] text-text-subtle">{[l.bordaNome, l.massaNome].filter(Boolean).join(', ')}</div>}
              {l.complementos.length > 0 && (
                <div className="mt-0.5 text-[13px] text-text-subtle">
                  {l.complementos.map((c) => (c.preco > 0 ? `${c.nome} (+${brl(c.preco)})` : c.nome)).join(', ')}
                </div>
              )}
              {l.observacao && <Obs texto={`Obs.: ${l.observacao}`} testid="painel-obs-item" />}
            </li>
          ))}
          {p.observacao && <li><Obs texto={`Observação do pedido: ${p.observacao}`} testid="painel-obs-pedido" /></li>}
          <li className="space-y-1 border-t border-border pt-2 text-[14px]">
            <div className="flex justify-between text-text-subtle"><span>Subtotal</span><span className={`tabular-nums ${VERDE}`}>{brl(p.subtotal)}</span></div>
            {p.taxaEntrega > 0 && <div className="flex justify-between text-text-subtle"><span>Taxa de entrega</span><span className={`tabular-nums ${VERDE}`}>{brl(p.taxaEntrega)}</span></div>}
            {p.desconto > 0 && <div className="flex justify-between text-text-subtle"><span>Desconto</span><span className={`tabular-nums ${VERDE}`}>−{brl(p.desconto)}</span></div>}
            <div className="flex items-baseline justify-between pt-1"><span className="text-[16px] font-bold text-text-main">Total</span><span className={`text-[20px] font-bold tabular-nums ${VERDE}`} data-testid="painel-total">{brl(p.total)}</span></div>
          </li>
        </ul>

        {/* Cliente e pagamento */}
        <p className={TITULO}>Cliente e pagamento</p>
        <div className="mb-4 space-y-2 rounded-[3px] border border-border p-3">
          <div className="flex justify-between gap-3"><span className="text-text-subtle">Cliente</span><span className="text-right font-semibold">{p.clienteNome || '—'}</span></div>
          {p.clienteTelefone && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="mr-auto text-text-subtle">Telefone</span>
              <a href={`tel:${p.clienteTelefone.replace(/\D/g, '')}`} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline" data-testid="painel-telefone">
                <Phone className="h-4 w-4" aria-hidden /> {mascararTelefoneBR(p.clienteTelefone)}
              </a>
              {!p.telefoneVerificado && p.origem !== 'pdv' && (
                <span className="rounded-[3px] bg-danger-bg px-1.5 py-0.5 text-[11px] font-bold uppercase text-danger" title="Telefone não confirmado por WhatsApp" data-testid="painel-nao-verificado">não verif.</span>
              )}
            </div>
          )}
          {p.tipo === 'entrega' && (
            <div className="flex justify-between gap-3" data-testid="painel-endereco">
              <span className="flex-shrink-0 text-text-subtle">Endereço</span>
              <span className="text-right">
                <span className="font-semibold">{p.enderecoRua}, {p.enderecoNumero}</span>{p.enderecoComplemento && ` · ${p.enderecoComplemento}`}
                <br /><span className="font-semibold">{p.enderecoBairro}</span>{p.enderecoCidade && ` · ${p.enderecoCidade}`}{p.enderecoCep && ` · ${p.enderecoCep}`}
                {p.enderecoReferencia && <><br /><span className="text-text-subtle">Referência: </span>{p.enderecoReferencia}</>}
              </span>
            </div>
          )}
          {linhaLanc && <div className="flex justify-between gap-3" data-testid="detalhes-lancamento"><span className="flex-shrink-0 text-text-subtle">Lançamento</span><span className="text-right font-semibold">{linhaLanc}</span></div>}
          {p.canal === 'mesa' ? (
            <div className="flex justify-between gap-3"><span className="text-text-subtle">Pagamento</span><span className="font-semibold">No fechamento da conta</span></div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3" data-testid="detalhes-pagamento">
                <span className="text-text-subtle">Pagamento</span>
                <span className="text-right">
                  <span className="inline-flex items-center gap-1.5 font-semibold"><Icone className="h-4 w-4" aria-hidden /> {rotuloForma(p.formaPagamento, p.cartaoTipo)}</span>
                  <br />{p.pago ? <span className="font-bold text-price-text">Pago</span> : <span className="font-semibold text-[#92400E]">{statusAReceber(p.tipo)}</span>}
                  {p.formaPagamento === 'dinheiro' && p.trocoPara ? (
                    <><br /><span className="font-semibold text-[#92400E]" data-testid="painel-troco">Troco p/ {brl(p.trocoPara)}{levar > 0 ? ` · levar ${brl(levar)}` : ''}</span></>
                  ) : null}
                </span>
              </div>
              {p.status !== 'cancelado' && (editandoPag
                ? <EditorPagamento pedidoId={p.id} p={p} onCancelar={() => setEditandoPag(false)} onFeito={() => { setEditandoPag(false); onPagamentoAlterado() }} />
                : <button type="button" onClick={() => setEditandoPag(true)} data-testid="detalhes-alterar-pagamento" className="text-[13px] font-semibold text-primary underline">Alterar pagamento</button>)}
            </>
          )}
          {p.status === 'preparando' && p.preparandoPor && <div className="flex justify-between gap-3"><span className="text-text-subtle">Em preparo por</span><span className="font-semibold">{p.preparandoPor}</span></div>}
          {p.preparadoPor && <div className="flex justify-between gap-3"><span className="text-text-subtle">Preparado por</span><span className="font-semibold">{p.preparadoPor}</span></div>}
        </div>

        {/* Entrega */}
        {p.tipo === 'entrega' && (p.entregadorId || p.status === 'em_rota') && (
          <>
            <p className={TITULO}>Entrega</p>
            <div className="mb-4 flex items-center justify-between gap-3 rounded-[3px] border border-border p-3" data-testid="painel-entrega">
              <span className="inline-flex items-center gap-1.5"><Bike className="h-4 w-4 text-text-subtle" aria-hidden /> {p.entregadorNome ?? 'Motoboy'}</span>
              <span className="font-semibold">{p.status === 'em_rota' ? 'Em rota' : p.status === 'entregue' ? 'Entregue' : 'Aguardando saída'}</span>
            </div>
          </>
        )}
      </div>

      {/* Rodapé fixo */}
      {/* lg: espaço à direita para o botão flutuante de atendimento não cobrir o Cancelar. */}
      <div className="space-y-2 border-t border-border p-3 lg:pr-[82px]">
        <button type="button" onClick={onReimprimir} disabled={reimpEstado === 'enviando' || reimpEstado === 'ok'}
          className="flex h-[44px] w-full items-center justify-center gap-2 rounded-[3px] bg-text-main px-4 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-60" data-testid="painel-reimprimir">
          <PrinterCheck className="h-4 w-4" /> {reimpEstado === 'enviando' ? 'Enviando…' : reimpEstado === 'ok' ? 'Enviado p/ impressora' : 'Reimprimir pedido'}
        </button>
        {reimpEstado === 'ok' && <p className="text-center text-[12px] text-text-subtle">Sai na próxima varredura do Assistente (impressão automática precisa estar ligada).</p>}
        {reimpEstado === 'erro' && <p className="text-center text-[12px] text-danger">Não foi possível solicitar a reimpressão. Tente de novo.</p>}
        {concluirSemEntregador && (
          <button type="button" onClick={concluirSemEntregador} className="flex h-[44px] w-full items-center justify-center gap-2 rounded-[3px] border border-status-ready px-4 text-[13px] font-semibold text-status-ready hover:bg-status-ready/10">
            ✓ Concluir sem entregador
          </button>
        )}
        {podeCancelar(p.status) && (
          <button type="button" onClick={onCancelar} className="flex h-[44px] w-full items-center justify-center gap-2 rounded-[3px] bg-[#991B1B] px-4 text-[13px] font-semibold text-white hover:bg-[#7F1D1D]" data-testid="painel-cancelar">
            <X className="h-4 w-4" /> Cancelar pedido
          </button>
        )}
      </div>
    </aside>
  )
}
