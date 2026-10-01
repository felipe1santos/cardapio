'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Badge } from '@/components/ui/badge'
import { useRealtimeComFallback } from '@/lib/realtime-fallback'
import { ROTULO_FORMA, type FormaPagamento } from '@/lib/conta'
import {
  atendimentoEfetivo,
  resumirDimensoes,
  ROTULO_ATENDIMENTO,
  ROTULO_COZINHA,
  ROTULO_FINANCEIRO,
  ROTULO_PENDENCIA,
  type AcaoConta,
  type AcaoResolucao,
  type StatusCozinha,
} from '@/lib/pdv-v2'
import type { ContaPresencial, PedidoConta } from '@/lib/servicos/conta-presencial'
import type { EventoHistorico } from '@/lib/queries/conta'
import { chamar, formatBRL, horaCurta, lerValor, mascararTelefone, minutosDesde, novaChave, tempoCurto } from './util'
import { FecharContaModal } from './fechar-conta'
import { FotoItem } from './foto-item'
import { BotaoPdv, CaminhoPilha, ICONES_PDV, RaizPilha, TelaPdv, textoEncerramento, toastPdv } from './tela-pdv'
import { ICONE_FORMA_PDV } from './icones-forma'
import { LinhaAjuste } from './linha-ajuste'
import { SeloAtendimento, SeloCozinha, SeloFinanceiro } from './selos'
import { TaxasModal, taxasIniciais } from './taxas-conta'
import { rotuloTaxa, type TaxaEntrada } from '@/lib/taxas-conta'
import { IdentificarModal } from './atendimento'
import { ResumoEncerramentoModal } from './resumo-encerramento'
import { montarResumoEncerramento, type ResumoEncerramento } from '@/lib/encerramento-conta'

/**
 * Conta presencial no PDV v2 — a mesma tela para mesa e balcão (spec 13.3), com
 * receber (13.4), pendências (13.5), resolução forçada (13.6) e histórico (13.7).
 *
 * A tela nunca decide dinheiro nem estado: toda ação vai ao servidor, que trava a
 * conta e responde. Botões aparecem pela permissão que o servidor calculou; durante
 * uma requisição, todas as ações ficam travadas (clique duplo não duplica nada, e
 * cada intenção leva a sua chave de idempotência).
 */

type Permissoes = Record<AcaoConta | 'lancar' | 'cancelar_qualquer' | 'taxa' | 'pre_conta' | 'resolver_no_fechamento', boolean>

/** Telefone guardado normalizado (55 + DDD + número) → máscara local para a tela. */
const telefoneLocal = (t: string) => mascararTelefone(t.replace(/^55(?=\d{10,11}$)/, ''))

interface Pendencias {
  pedidos: {
    id: string; numero: number; categoria: 'aguardando_aceite' | 'em_preparo' | 'pronto_nao_atendido'; status: string
    atendimento_status: string | null; criado_em: string; preparando_em: string | null; pronto_em: string | null
    total: number; criado_por_nome: string | null; itens: { nome: string; quantidade: number }[]
  }[]
  cancelamentos: { id: string; pedido_id: string; numero: number; item: string | null; motivo: string; solicitado_por_nome: string }[]
  financeiro: { total: number; pago: number; restante: number; situacao: string; formas: { forma: string; valor: number }[] }
  atendido_nao_pago: boolean
  parcialmente_pago: boolean
  bloqueia: boolean
}

interface DadosConta {
  conta: ContaPresencial
  historico: EventoHistorico[]
  pendencias: Pendencias | null
  formasPagamento: string[]
  permissoes: Permissoes
  /** Taxas padrão da loja (Ajustes › Mesas, 0124). */
  taxasPadrao?: TaxaEntrada[]
}

type Subtela =
  | null
  | { tipo: 'receber'; fecharDepois?: boolean }
  | { tipo: 'pendencias'; dados: Pendencias }
  | { tipo: 'resolver'; dados: Pendencias }
  | { tipo: 'historico' }
  | { tipo: 'cancelar'; pedido: PedidoConta }
  | { tipo: 'estorno'; pagamentoId: string }
  | { tipo: 'reabrir' }
  | { tipo: 'ajustar' }
  | { tipo: 'taxa_extra' }
  | { tipo: 'fechar' }
  | { tipo: 'identificar'; aviso?: string; depois?: 'fechar' }
  | { tipo: 'cancelar_conta' }
  | { tipo: 'resumo'; resumo: ResumoEncerramento; emLimpeza?: boolean }
  | { tipo: 'remover_ajuste'; rotulo: string; corpo: Record<string, unknown> }

const TOM_COZINHA: Record<string, 'pending' | 'preparing' | 'ready' | 'ok' | 'danger'> = {
  recebido: 'pending',
  preparando: 'preparing',
  pronto: 'ready',
  entregue: 'ok',
  cancelado: 'danger',
}

export function ContaPresencialModal({
  supabase,
  comandaId,
  onFechar,
  onLancarItens,
  onEncerrada,
  abrirFechando,
}: {
  supabase: SupabaseClient
  comandaId: string
  /** Abrir já no "Fechar conta" (atalho "Receber e fechar" da Central). */
  abrirFechando?: boolean
  onFechar: () => void
  /** Voltar ao cardápio lançando nesta conta. */
  onLancarItens: (c: ContaPresencial) => void
  /** A conta fechou (ou foi cancelada): o PDV volta ao painel. */
  onEncerrada?: () => void
}) {
  const [dados, setDados] = useState<DadosConta | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [sub, setSub] = useState<Subtela>(null)
  const [agora, setAgora] = useState(() => Date.now())
  const seq = useRef(0)

  const carregar = useCallback(async () => {
    const minha = ++seq.current
    const r = await chamar<DadosConta>(`/api/admin/comandas/${comandaId}`)
    if (minha !== seq.current) return
    if (!r.ok || !r.dados) {
      setErro(r.erro)
      return
    }
    setErro(null)
    setDados(r.dados)
  }, [comandaId])

  useEffect(() => {
    void carregar()
  }, [carregar])
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const { intervaloMs } = useRealtimeComFallback({
    supabase,
    canal: `pdv-conta-${comandaId}`,
    tabelas: [
      { tabela: 'comandas', filtro: `id=eq.${comandaId}` },
      { tabela: 'pagamentos_comanda', filtro: `comanda_id=eq.${comandaId}` },
      { tabela: 'pedidos', filtro: `comanda_id=eq.${comandaId}` },
    ],
    aoEvento: () => void carregar(),
    aoSincronizar: () => void carregar(),
  })
  useEffect(() => {
    const t = setInterval(() => void carregar(), intervaloMs)
    return () => clearInterval(t)
  }, [intervaloMs, carregar])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 6000)
    return () => clearTimeout(t)
  }, [aviso])

  /** Toda ação passa por aqui: trava a tela, chama, recarrega, mostra o resultado. */
  const agir = useCallback(
    async (corpo: Record<string, unknown>, sucesso?: string) => {
      if (ocupado) return null
      setOcupado(true)
      const r = await chamar<{ resultado: unknown }>(`/api/admin/comandas/${comandaId}`, { method: 'POST', body: JSON.stringify(corpo) })
      setOcupado(false)
      await carregar()
      if (!r.ok) setAviso({ tom: 'erro', texto: r.erro ?? 'Não foi possível concluir.' })
      else if (sucesso) setAviso({ tom: 'ok', texto: sucesso })
      return r
    },
    [comandaId, carregar, ocupado],
  )

  // "Fechar conta" (0096): decisões da cozinha, pagamentos e fechamento numa tela só,
  // numa transação só. Conta antiga de mesa sem nome pede o nome antes.
  async function fechar() {
    setAviso(null)
    if (dados?.conta.semNome) {
      setSub({ tipo: 'identificar', aviso: 'Esta conta foi aberta sem o nome do cliente. Informe o nome antes de fechar.', depois: 'fechar' })
      return
    }
    setSub({ tipo: 'fechar' })
  }

  // Atalho da Central ("Receber e fechar"): assim que a conta chega, vai direto ao fechamento.
  const atalhoFechar = useRef(Boolean(abrirFechando))
  useEffect(() => {
    if (!atalhoFechar.current || !dados) return
    atalhoFechar.current = false
    if (dados.conta.status === 'aberta' && dados.permissoes.fechar) void fechar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados])

  /** Depois de fechar/cancelar: lê a conta de novo e mostra o resumo antes de sair. */
  async function mostrarResumo(acao: 'fechada' | 'cancelada', antes: ContaPresencial, extra: { motivo?: string; emLimpeza?: boolean } = {}) {
    const r = await chamar<DadosConta>(`/api/admin/comandas/${comandaId}`)
    const depois = r.ok && r.dados ? r.dados.conta : null
    if (depois) setDados(r.dados!)
    setSub({
      tipo: 'resumo',
      resumo: montarResumoEncerramento(acao, antes, depois, { motivo: extra.motivo ?? null, horario: new Date().toISOString() }),
      emLimpeza: extra.emLimpeza,
    })
  }

  async function abrirPendencias() {
    const r = await chamar<{ resultado: Pendencias }>(`/api/admin/comandas/${comandaId}`, { method: 'POST', body: JSON.stringify({ acao: 'pendencias' }) })
    if (r.ok && r.dados) setSub({ tipo: 'pendencias', dados: r.dados.resultado })
    else setAviso({ tom: 'erro', texto: r.erro ?? 'Não foi possível ver as pendências.' })
  }

  const conta = dados?.conta
  const pode = dados?.permissoes
  const aberta = conta?.status === 'aberta'
  const dim = useMemo(() => (conta ? resumirDimensoes(conta.pedidos, conta.tipo) : null), [conta])

  const titulo = conta
    ? conta.tipo === 'balcao'
      ? `${conta.entrega ? 'Entrega' : 'Balcão'} · Senha ${conta.senha} · ${conta.clienteNome}`
      : `${conta.mesaNome ?? 'Mesa'}${conta.numero ? ` · Comanda ${conta.numero}` : ''}${conta.clienteNome ? ` · ${conta.clienteNome}` : ''}`
    : 'Conta'

  // Navegação em pilha (2026-10-01): a conta é uma tela; Receber, Fechar, Taxas… abrem por
  // cima COBRINDO-A (ela fica montada e volta igual). Barra de ações fixa no rodapé.
  const barra = conta && pode && aberta ? (
    <BarraAcoesConta
      conta={conta}
      pode={pode}
      ocupado={ocupado}
      onLancar={() => onLancarItens(conta)}
      onReceber={() => setSub({ tipo: 'receber' })}
      onFechar={() => void fechar()}
      onTaxas={() => setSub({ tipo: pode.taxa_extra ? 'taxa_extra' : 'ajustar' })}
      onAjustar={() => setSub({ tipo: 'ajustar' })}
      onPendencias={() => void abrirPendencias()}
      onCliente={() => setSub({ tipo: 'identificar' })}
      onHistorico={() => setSub({ tipo: 'historico' })}
      onCancelar={() => setSub({ tipo: 'cancelar_conta' })}
    />
  ) : undefined
  return (
    <RaizPilha fecharTudo={onFechar}>
    <TelaPdv titulo={titulo} onVoltar={onFechar} rodape={barra} testid="conta-tela">
      <div className="flex h-full min-h-0 flex-col">
        {/* Identificação da conta */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              {conta?.tipo === 'balcao' ? (conta.entrega ? 'PDV · Entrega manual' : 'Comanda de balcão') : 'Conta da mesa'}
              {conta && !aberta && <span className="ml-2 text-danger">· {conta.status === 'fechada' ? 'Fechada' : conta.status}</span>}
            </p>
            <h2 className="truncate text-[18px] font-bold text-text-main" data-testid="conta-titulo">{titulo}</h2>
            {conta && (
              <p className="text-[12px] text-text-subtle">
                Aberta {horaCurta(conta.abertaEm)} ({tempoCurto(conta.abertaEm, agora)})
                {conta.abertaPorNome ? ` por ${conta.abertaPorNome}` : conta.responsavelNome ? ` · Resp. ${conta.responsavelNome}` : ''}
                {conta.clienteTelefone ? ` · ${telefoneLocal(conta.clienteTelefone)}` : ''}
                {conta.clienteVinculado ? ' · cliente cadastrado' : ''}
                {conta.reabertaEm ? ` · reaberta ${horaCurta(conta.reabertaEm)} por ${conta.reabertaPorNome}` : ''}
              </p>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {conta && !aberta && (
              <button type="button" onClick={() => setSub({ tipo: 'historico' })} className="rounded-menuzia border border-border px-3 py-2 text-[12px] font-semibold text-text-main hover:border-primary hover:text-primary">
                Histórico
              </button>
            )}
          </div>
        </div>

        {/* Dimensões */}
        {conta && dim && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border bg-page/50 px-4 py-2 text-[12px]" data-testid="conta-dimensoes">
            <span className="flex items-center gap-1.5"><span className="text-text-subtle">Cozinha:</span> <SeloCozinha dim={dim} total={conta.pedidos.length} /></span>
            <span className="flex items-center gap-1.5"><span className="text-text-subtle">Atendimento:</span> <SeloAtendimento dim={dim} /></span>
            <span className="flex items-center gap-1.5">
              <span className="text-text-subtle">Financeiro:</span>
              <SeloFinanceiro situacao={conta.situacao} />
            </span>
          </div>
        )}

        {aviso && (
          <p
            role="status"
            className={['pointer-events-none fixed inset-x-0 bottom-28 z-[70] mx-auto w-fit max-w-[min(520px,calc(100vw-32px))] rounded-[10px] px-4 py-3 text-center text-[14px] font-semibold text-white shadow-[0_8px_24px_rgba(15,23,42,0.18)]', aviso.tom === 'ok' ? 'bg-sidebar-bg' : 'bg-danger'].join(' ')}
            data-testid="conta-aviso"
          >
            {aviso.texto}
          </p>
        )}
        {conta?.semNome && aberta && (
          <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-menuzia bg-warn-bg px-3 py-2 text-[12px] font-semibold text-text-main" data-testid="conta-sem-nome">
            <span className="flex-1">Conta aberta sem o nome do cliente. Informe o nome antes de lançar ou fechar.</span>
            {pode?.identificar && (
              <button type="button" onClick={() => setSub({ tipo: 'identificar' })} className="rounded-menuzia bg-white px-2.5 py-1.5 text-[11px] font-bold text-text-main">
                Informar nome
              </button>
            )}
          </div>
        )}
        {erro && !conta && <p className="m-4 rounded-menuzia bg-danger-bg px-3 py-2 text-[13px] text-danger">{erro}</p>}
        {!conta && !erro && <p className="p-8 text-center text-[13px] text-text-subtle">Carregando…</p>}

        {conta && pode && (
          <>
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* Pedidos */}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {conta.solicitacoes.length > 0 && (
                <div className="rounded-menuzia border border-warn/40 bg-warn-bg p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-warn">Cancelamento pedido à gerência</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {conta.solicitacoes.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2 text-[13px] text-text-main">
                        <span className="flex-1">{s.descricao} — “{s.motivo}” <span className="text-text-subtle">({s.solicitadoPorNome})</span></span>
                        {pode.decidir_cancelamento && aberta && (
                          <>
                            <button type="button" disabled={ocupado} onClick={() => void agir({ acao: 'decidir_cancelamento', solicitacaoId: s.id, aprovar: true }, 'Cancelamento aprovado.')} className="rounded-menuzia bg-danger px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">Aprovar</button>
                            <button type="button" disabled={ocupado} onClick={() => void agir({ acao: 'decidir_cancelamento', solicitacaoId: s.id, aprovar: false }, 'Cancelamento recusado.')} className="rounded-menuzia border border-border bg-white px-2.5 py-1.5 text-[11px] font-bold text-text-main disabled:opacity-50">Recusar</button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {conta.pedidos.length === 0 ? (
                <p className="py-10 text-center text-[14px] text-text-subtle">Nenhum pedido lançado ainda.</p>
              ) : (
                conta.pedidos.map((p) => (
                  <CartaoPedido
                    key={p.id}
                    pedido={p}
                    tipo={conta.tipo}
                    aberta={aberta}
                    pode={pode}
                    ocupado={ocupado}
                    agora={agora}
                    onAgir={agir}
                    onCancelar={() => setSub({ tipo: 'cancelar', pedido: p })}
                  />
                ))
              )}
            </div>

            {/* Totais e ações */}
            <div className="flex flex-shrink-0 flex-col gap-3 border-t border-border bg-page/60 px-4 py-3 lg:w-[320px] lg:overflow-y-auto lg:border-l lg:border-t-0">
              <div className="rounded-menuzia border border-border bg-white px-3 py-3 text-[13px]" data-testid="conta-totais">
                <Linha rotulo="Subtotal" valor={conta.totais.subtotal} />
                {(conta.totais.taxaServico > 0 || conta.tipo === 'mesa') && (
                  <LinhaAjuste
                    tipo="taxa"
                    rotulo={`Taxa de serviço (${conta.taxaServicoPercentual}%)`}
                    valor={conta.totais.taxaServico}
                    testid="conta-taxa-servico"
                    onRemover={aberta && pode.ajustar_valores && conta.taxaServicoPercentual > 0 ? () => setSub({
                      tipo: 'remover_ajuste',
                      rotulo: `Taxa de serviço (${conta.taxaServicoPercentual}%)`,
                      corpo: { acao: 'ajustar_valores', taxaServico: 0, descontoTipo: conta.descontoTipo, descontoValor: conta.descontoValor, descontoPercentual: conta.descontoPercentual, motivo: conta.descontoMotivo },
                    }) : undefined}
                  />
                )}
                {/* Valor cobrado agora: sem item ativo (tudo cancelado) a taxa não entra no total (0099). */}
                {conta.entrega && (
                  <LinhaAjuste
                    tipo="taxa"
                    rotulo={conta.entrega.taxa > 0 && conta.totais.taxaEntrega === 0 ? 'Taxa de entrega (não cobrada: sem item ativo)' : `Taxa de entrega${conta.entrega.taxaManual ? ' (manual)' : ''}`}
                    valor={conta.totais.taxaEntrega}
                  />
                )}
                {/* Taxa manual só desta conta (0106). */}
                {/* Cada taxa numa linha (0124); conta de antes só com a taxa manual (0106). */}
                {conta.taxas.length > 0
                  ? conta.taxas.map((t, i) => (
                      <LinhaAjuste
                        key={i}
                        tipo="taxa"
                        rotulo={rotuloTaxa(t)}
                        valor={t.valor}
                        testid="conta-taxa-linha"
                        onRemover={aberta && pode.taxa_extra ? () => setSub({
                          tipo: 'remover_ajuste',
                          rotulo: rotuloTaxa(t),
                          corpo: { acao: 'taxas', taxas: taxasIniciais(conta).filter((_, k) => k !== i) },
                        }) : undefined}
                      />
                    ))
                  : conta.taxaExtra && <LinhaAjuste tipo="taxa" rotulo={conta.taxaExtra.nome} valor={conta.taxaExtra.valor} testid="conta-taxa-extra" />}
                {conta.totais.desconto > 0 && (
                  <LinhaAjuste
                    tipo="desconto"
                    rotulo={conta.cupomCodigo ? `Desconto (cupom ${conta.cupomCodigo})` : conta.descontoTipo === 'percentual' ? `Desconto (${conta.descontoPercentual}%)` : 'Desconto'}
                    valor={conta.totais.desconto}
                    testid="conta-desconto"
                    onRemover={!aberta ? undefined : conta.cupomCodigo
                      ? (pode.aplicar_cupom ? () => setSub({ tipo: 'remover_ajuste', rotulo: `Cupom ${conta.cupomCodigo}`, corpo: { acao: 'remover_cupom' } }) : undefined)
                      : (pode.ajustar_valores ? () => setSub({
                          tipo: 'remover_ajuste',
                          rotulo: 'Desconto',
                          corpo: { acao: 'ajustar_valores', taxaServico: conta.taxaServicoPercentual, descontoTipo: 'valor', descontoValor: 0, descontoPercentual: 0 },
                        }) : undefined)}
                  />
                )}
                <div className="my-1.5 border-t border-border" />
                <Linha rotulo="Total" valor={conta.totais.total} forte />
                <Linha rotulo="Pago" valor={conta.totais.pago} />
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[13px] font-bold text-text-main">Restante</span>
                  <span className={['text-[22px] font-extrabold', conta.totais.restante > 0 ? 'text-text-main' : 'text-price-text'].join(' ')} data-testid="conta-restante">
                    {formatBRL(conta.totais.restante)}
                  </span>
                </div>
              </div>

              {conta.entrega && (
                <div className="rounded-menuzia border border-border bg-white px-3 py-2 text-[12px]" data-testid="conta-entrega">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-text-subtle">Entrega</p>
                  <p className="mt-1 text-text-main">
                    {conta.entrega.rua}, {conta.entrega.numero}
                    {conta.entrega.complemento ? ` · ${conta.entrega.complemento}` : ''}
                  </p>
                  <p className="text-text-subtle">
                    {conta.entrega.bairro}
                    {conta.entrega.cidade ? ` · ${conta.entrega.cidade}` : ''}
                    {conta.entrega.cep ? ` · CEP ${conta.entrega.cep}` : ''}
                  </p>
                  {conta.entrega.referencia && <p className="text-text-subtle">Ref.: {conta.entrega.referencia}</p>}
                  {conta.entrega.observacao && <p className="text-text-subtle">Obs.: {conta.entrega.observacao}</p>}
                </div>
              )}

              {aberta && pode.aplicar_cupom && <CupomBloco conta={conta} ocupado={ocupado} onAgir={agir} />}

              {conta.pagamentos.length > 0 && (
                <div className="rounded-menuzia border border-border bg-white px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-text-subtle">Pagamentos</p>
                  <ul className="mt-1 space-y-1">
                    {conta.pagamentos.map((pg) => (
                      <li key={pg.id} className="flex items-center gap-2 text-[12px]">
                        <span className={['flex-1', pg.estornado ? 'text-text-subtle line-through' : 'text-text-main'].join(' ')}>
                          {ROTULO_FORMA[pg.forma as FormaPagamento] ?? pg.forma} {formatBRL(pg.valor)}
                          {pg.troco > 0 ? ` (troco ${formatBRL(pg.troco)})` : ''}
                          <span className="block text-[10px] text-text-subtle">{horaCurta(pg.criadoEm)} · {pg.criadoPorNome}{pg.estornado ? ` · estornado: ${pg.estornoMotivo}` : ''}</span>
                        </span>
                        {!pg.estornado && pode.estorno && aberta && (
                          <button type="button" disabled={ocupado} onClick={() => setSub({ tipo: 'estorno', pagamentoId: pg.id })} className="text-[11px] font-semibold text-danger hover:underline disabled:opacity-50">
                            Estornar
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {aberta && pode.lancar && (
                <button
                  type="button"
                  onClick={() => onLancarItens(conta)}
                  data-testid="conta-lancar-grande"
                  className="mt-auto flex h-[68px] w-full items-center justify-center gap-2 rounded-menuzia bg-primary text-[17px] font-bold text-white shadow-sm transition-all hover:bg-primary-dark active:scale-[0.98]"
                >
                  <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current" aria-hidden><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
                  Lançar itens
                </button>
              )}

              {/* As ações da conta aberta ficam na barra fixa de baixo (2026-10-01). */}
              {!aberta && (
                <>
                  <p className="rounded-menuzia bg-white px-3 py-2 text-[12px] text-text-subtle">
                    {conta.status === 'fechada' ? `Fechada ${horaCurta(conta.fechadaEm)} por ${conta.fechadaPorNome ?? '—'}.` : 'Conta encerrada.'}
                  </p>
                  {conta.status === 'fechada' && pode.pre_conta && !conta.entrega && <PreContaBloco comandaId={conta.id} />}
                  {conta.status === 'fechada' && pode.reabrir && (
                    <button type="button" onClick={() => setSub({ tipo: 'reabrir' })} data-testid="conta-reabrir" className="w-full rounded-menuzia border-2 border-warn bg-white py-3 text-[13px] font-bold text-warn hover:bg-warn hover:text-white">
                      Reabrir conta
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          </>
        )}
      </div>
    </TelaPdv>
    <CaminhoPilha trecho={titulo}>

      {conta && dados && sub?.tipo === 'receber' && (
        <ReceberModal
          conta={conta}
          formas={dados.formasPagamento}
          podeFechar={Boolean(pode?.fechar)}
          onCancelar={() => setSub(null)}
          onRegistrar={async (corpo, fecharDepois) => {
            const r = await agir({ acao: 'pagamento', ...corpo }, `Pagamento de ${formatBRL(Number(corpo.valor))} registrado`)
            if (!r?.ok) return false
            setSub(null)
            if (fecharDepois) await fechar()
            return true
          }}
        />
      )}
      {conta && dados && sub?.tipo === 'fechar' && (
        <FecharContaModal
          conta={conta}
          formas={dados.formasPagamento}
          podeForcar={Boolean(pode?.resolver_no_fechamento)}
          podePagar={Boolean(pode?.pagamento)}
          podeTaxaExtra={Boolean(pode?.taxa_extra)}
          taxasPadrao={dados?.taxasPadrao ?? []}
          onVoltar={() => {
            setSub(null)
            void carregar()
          }}
          onFechada={(emLimpeza) => {
            void mostrarResumo('fechada', conta, { emLimpeza })
          }}
        />
      )}
      {conta && sub?.tipo === 'identificar' && (
        <IdentificarModal
          comandaId={conta.id}
          titulo="Cliente do atendimento"
          aviso={sub.aviso}
          nomeAtual={conta.clienteNome}
          telefoneAtual={conta.clienteTelefone}
          onFechar={() => setSub(null)}
          onSalvo={(nome) => {
            const seguir = sub.depois
            setAviso({ tom: 'ok', texto: `Cliente: ${nome}.` })
            void carregar().then(() => setSub(seguir === 'fechar' ? { tipo: 'fechar' } : null))
          }}
        />
      )}
      {conta && sub?.tipo === 'pendencias' && (
        <PendenciasModal
          conta={conta}
          dados={sub.dados}
          pode={pode!}
          ocupado={ocupado}
          agora={agora}
          onVoltar={() => setSub(null)}
          onAgir={async (corpo, ok) => {
            const r = await agir(corpo, ok)
            if (r?.ok) await abrirPendencias()
          }}
          onReceber={() => setSub({ tipo: 'receber' })}
          onResolver={() => setSub({ tipo: 'resolver', dados: sub.dados })}
        />
      )}
      {conta && sub?.tipo === 'resolver' && (
        <ResolverModal
          conta={conta}
          dados={sub.dados}
          ocupado={ocupado}
          onVoltar={() => setSub(null)}
          onAplicar={async (acoes, motivo, fecharDepois) => {
            const r = await agir({ acao: 'resolver', acoes, motivo, confirmacao: true, fechar: fecharDepois }, 'Pendências resolvidas.')
            if (!r?.ok) return r?.erro ?? 'Não foi possível resolver.'
            const res = (r.dados?.resultado ?? {}) as { fechamento?: unknown; erroFechamento?: string }
            setSub(null)
            if (fecharDepois && res.fechamento) onEncerrada?.()
            else if (res.erroFechamento) setAviso({ tom: 'erro', texto: `Pendências resolvidas, mas a conta ainda não fechou: ${res.erroFechamento}` })
            return null
          }}
        />
      )}
      {conta && sub?.tipo === 'historico' && dados && <HistoricoModal eventos={dados.historico} titulo={titulo} onVoltar={() => setSub(null)} />}
      {conta && sub?.tipo === 'cancelar' && (
        <CancelarModal
          pedido={sub.pedido}
          podeDireto={Boolean(pode?.cancelar_qualquer) || (Boolean(pode?.cancelar_pedido) && sub.pedido.status === 'recebido' && conta.totais.pago === 0)}
          podeSolicitar={Boolean(pode?.solicitar_cancelamento)}
          ocupado={ocupado}
          onVoltar={() => setSub(null)}
          onConfirmar={async (motivo, direto) => {
            const r = await agir(
              direto ? { acao: 'cancelar_pedido', pedidoId: sub.pedido.id, motivo } : { acao: 'solicitar_cancelamento', pedidoId: sub.pedido.id, motivo },
              direto ? `Pedido #${sub.pedido.numero} cancelado.` : 'Cancelamento pedido à gerência.',
            )
            if (r?.ok) setSub(null)
            return r?.ok ? null : r?.erro ?? 'Não foi possível.'
          }}
        />
      )}
      {sub?.tipo === 'estorno' && (
        <MotivoModal
          titulo="Estornar pagamento"
          descricao="O valor volta a ficar em aberto na conta. Fica registrado com o seu nome e o motivo."
          botao="Estornar"
          perigo
          ocupado={ocupado}
          onVoltar={() => setSub(null)}
          onConfirmar={async (motivo) => {
            const r = await agir({ acao: 'estorno', pagamentoId: sub.pagamentoId, motivo }, 'Pagamento estornado.')
            if (r?.ok) setSub(null)
            return r?.ok ? null : r?.erro ?? 'Não foi possível.'
          }}
        />
      )}
      {conta && sub?.tipo === 'cancelar_conta' && (
        <MotivoModal
          titulo="Cancelar a conta inteira"
          descricao={`Todos os pedidos desta conta são cancelados (inclusive os que estão na cozinha) e nada mais sai na impressora. ${conta.totais.pago > 0 ? 'Esta conta já recebeu dinheiro: estorne antes.' : 'Fica no histórico com o seu nome e o motivo.'}`}
          botao="Cancelar a conta"
          perigo
          ocupado={ocupado}
          onVoltar={() => setSub(null)}
          onConfirmar={async (motivo) => {
            const antes = conta
            const r = await agir({ acao: 'cancelar_conta', motivo })
            if (!r?.ok) return r?.erro ?? 'Não foi possível cancelar.'
            await mostrarResumo('cancelada', antes, { motivo })
            return null
          }}
        />
      )}
      {sub?.tipo === 'resumo' && (
        <ResumoEncerramentoModal
          titulo={titulo}
          resumo={sub.resumo}
          emLimpeza={sub.emLimpeza}
          onOk={() => {
            toastPdv(textoEncerramento(sub.resumo.acao, titulo, sub.resumo.pago))
            setSub(null)
            onEncerrada?.()
          }}
        />
      )}
      {sub?.tipo === 'reabrir' && (
        <MotivoModal
          titulo="Reabrir conta"
          descricao="A conta volta a aceitar lançamentos e pagamentos. Pagamentos já feitos continuam valendo."
          botao="Reabrir"
          ocupado={ocupado}
          onVoltar={() => setSub(null)}
          onConfirmar={async (motivo) => {
            const r = await agir({ acao: 'reabrir', motivo }, 'Conta reaberta.')
            if (r?.ok) setSub(null)
            return r?.ok ? null : r?.erro ?? 'Não foi possível.'
          }}
        />
      )}
      {conta && sub?.tipo === 'taxa_extra' && (
        <TaxasModal
          atuais={taxasIniciais(conta)}
          padrao={dados?.taxasPadrao ?? []}
          subtotal={conta.totais.subtotal}
          onVoltar={() => setSub(null)}
          onSalvar={async (taxas) => {
            const r = await agir({ acao: 'taxas', taxas }, taxas.length ? 'Taxas salvas.' : 'Taxas removidas.')
            if (r?.ok) setSub(null)
            return r?.ok ? null : r?.erro ?? 'Não foi possível.'
          }}
        />
      )}
      {conta && sub?.tipo === 'ajustar' && (
        <AjustarModal
          conta={conta}
          podeTaxa={Boolean(pode?.taxa)}
          ocupado={ocupado}
          onVoltar={() => setSub(null)}
          onSalvar={async (corpo) => {
            const r = await agir({ acao: 'ajustar_valores', ...corpo }, 'Valores ajustados.')
            if (r?.ok) setSub(null)
            return r?.ok ? null : r?.erro ?? 'Não foi possível.'
          }}
        />
      )}
      {conta && sub?.tipo === 'remover_ajuste' && (
        <TelaPdv titulo={`Remover ${sub.rotulo}?`} onVoltar={() => setSub(null)} livre pequena papel="alertdialog" testid="conta-remover-ajuste">
          <div className="p-5">
            <p className="text-[15px] text-text-main">O total da conta será recalculado.</p>
          </div>
          <div className="flex gap-2 border-t border-border px-4 py-3">
            <BotaoPdv icone={ICONES_PDV.voltar} onClick={() => setSub(null)} className="flex-1">Voltar</BotaoPdv>
            <BotaoPdv icone={ICONES_PDV.fechar} tipo="perigo" disabled={ocupado} testid="conta-remover-confirmar" className="flex-1"
              onClick={async () => {
                const r = await agir(sub.corpo, `${sub.rotulo} removido.`)
                if (r?.ok) setSub(null)
              }}>
              Remover
            </BotaoPdv>
          </div>
        </TelaPdv>
      )}
    </CaminhoPilha>
    </RaizPilha>
  )
}

function Linha({ rotulo, valor, forte, testid }: { rotulo: string; valor: number; forte?: boolean; testid?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5" data-testid={testid}>
      <span className={forte ? 'font-bold text-text-main' : 'text-text-subtle'}>{rotulo}</span>
      <span className={forte ? 'font-bold text-text-main' : 'text-text-main'}>{formatBRL(valor)}</span>
    </div>
  )
}

function CartaoPedido({
  pedido: p,
  tipo,
  aberta,
  pode,
  ocupado,
  agora,
  onAgir,
  onCancelar,
}: {
  pedido: PedidoConta
  tipo: 'mesa' | 'balcao'
  aberta: boolean
  pode: Permissoes
  ocupado: boolean
  agora: number
  onAgir: (corpo: Record<string, unknown>, sucesso?: string) => Promise<unknown>
  onCancelar: () => void
}) {
  const at = atendimentoEfetivo(p, tipo)
  const cancelado = p.status === 'cancelado'
  const verboAtender = tipo === 'mesa' ? 'Servido' : 'Entregue no balcão'
  return (
    <div className={['rounded-menuzia border p-3', cancelado ? 'border-border bg-page/50 opacity-70' : 'border-border bg-white'].join(' ')} data-testid={`pedido-${p.numero}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-bold text-text-main">#{p.numero}</span>
        <span className="text-[12px] text-text-subtle">{horaCurta(p.criadoEm)}{p.criadoPorNome ? ` · por ${p.criadoPorNome}` : ''}</span>
        <Badge tone={TOM_COZINHA[p.status] ?? 'alert'}>{ROTULO_COZINHA[p.status as StatusCozinha] ?? p.status}</Badge>
        {at && <Badge tone={at === 'servido' || at === 'entregue_balcao' || at === 'concluido' ? 'ok' : at === 'nao_entregue' ? 'danger' : 'alert'}>{ROTULO_ATENDIMENTO[at]}</Badge>}
        {p.resolvidoForcado && <Badge tone="paused">Resolvido à força</Badge>}
        <span className={['ml-auto text-[15px] font-bold', cancelado ? 'text-text-subtle line-through' : 'text-text-main'].join(' ')}>{formatBRL(p.total)}</span>
      </div>
      {!cancelado && p.status === 'pronto' && p.prontoEm && (
        <p className="mt-0.5 text-[11px] font-semibold text-status-ready">pronto há {minutosDesde(p.prontoEm, agora)} min</p>
      )}
      {cancelado && p.canceladoMotivo && <p className="mt-0.5 text-[11px] text-danger">Cancelado: {p.canceladoMotivo}</p>}
      <ul className="mt-2 space-y-1">
        {p.itens.map((i) => (
          <li key={i.id} className={['flex items-start gap-2.5 text-[13px]', i.cancelado ? 'text-text-subtle line-through' : 'text-text-main'].join(' ')}>
            <FotoItem url={i.imagemUrl} nome={i.nome} tamanho={40} className={i.cancelado ? 'opacity-50' : ''} />
            <span className="min-w-0 flex-1 pt-0.5">
              <span className="font-semibold">{i.quantidade}×</span> {i.nome}
              {(i.detalhe || i.complementos.length > 0) && (
                <span className="text-[12px] text-text-subtle"> — {[i.detalhe, ...i.complementos].filter(Boolean).join(', ')}</span>
              )}
              {i.observacao && <span className="block text-[12px] italic text-text-subtle">“{i.observacao}”</span>}
            </span>
          </li>
        ))}
      </ul>
      {aberta && !cancelado && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {p.status === 'recebido' && pode.transicionar && (
            <button type="button" disabled={ocupado} onClick={() => void onAgir({ acao: 'transicionar', pedidoId: p.id, de: 'recebido', para: 'preparando' }, `#${p.numero} em preparo.`)} className="rounded-menuzia bg-status-preparing px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
              Aceitar (preparar)
            </button>
          )}
          {p.status === 'preparando' && pode.transicionar && (
            <button type="button" disabled={ocupado} onClick={() => void onAgir({ acao: 'transicionar', pedidoId: p.id, de: 'preparando', para: 'pronto' }, `#${p.numero} pronto.`)} className="rounded-menuzia bg-status-ready px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
              Marcar pronto
            </button>
          )}
          {p.status === 'pronto' && pode.atender && (
            <button type="button" disabled={ocupado} onClick={() => void onAgir({ acao: 'atender', pedidoId: p.id }, `#${p.numero}: ${verboAtender.toLowerCase()}.`)} data-testid={`atender-${p.numero}`} className="rounded-menuzia bg-sidebar-bg px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">
              {verboAtender}
            </button>
          )}
          {p.status !== 'entregue' && (pode.cancelar_pedido || pode.solicitar_cancelamento) && (
            <button type="button" disabled={ocupado} onClick={onCancelar} className="ml-auto rounded-menuzia border border-danger/40 px-3 py-2 text-[12px] font-semibold text-danger hover:bg-danger hover:text-white disabled:opacity-50">
              Cancelar…
            </button>
          )}
          {pode.reimprimir && (
            <button type="button" disabled={ocupado} onClick={() => void onAgir({ acao: 'reimprimir', pedidoId: p.id }, `Reimpressão do #${p.numero} pedida.`)} className="rounded-menuzia border border-border px-3 py-2 text-[12px] font-semibold text-text-subtle hover:text-text-main disabled:opacity-50">
              Reimprimir
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Ícone de botão das sub-telas (todo botão tem ícone + texto). */
function Ic({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0 fill-current" aria-hidden><path d={d} /></svg>
}

/** Sub-tela da conta: uma tela da pilha (cobre a conta; "← Voltar" mostra a conta igual). */
function Moldura({ titulo, children, onVoltar, sujo, pequena }: { titulo: string; children: React.ReactNode; onVoltar: () => void; largura?: string; sujo?: boolean; pequena?: boolean }) {
  return (
    <TelaPdv titulo={titulo} onVoltar={onVoltar} livre sujo={sujo} pequena={pequena}>
      {children}
    </TelaPdv>
  )
}

export function ReceberModal({
  conta,
  formas,
  podeFechar,
  onCancelar,
  onRegistrar,
}: {
  conta: ContaPresencial
  formas: string[]
  podeFechar: boolean
  onCancelar: () => void
  onRegistrar: (corpo: Record<string, unknown>, fecharDepois: boolean) => Promise<boolean>
}) {
  const [forma, setForma] = useState<string | null>(formas[0] ?? null)
  const [valor, setValor] = useState(conta.totais.restante.toFixed(2).replace('.', ','))
  const [recebido, setRecebido] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Uma chave por intenção de pagamento: clique duplo e reenvio não cobram duas vezes.
  const chave = useRef(novaChave())

  const v = lerValor(valor)
  const rec = lerValor(recebido)
  const troco = forma === 'dinheiro' && Number.isFinite(rec) && Number.isFinite(v) && rec >= v ? rec - v : 0

  async function registrar(fecharDepois: boolean) {
    if (!forma) return setErro('Escolha a forma de pagamento.')
    if (!Number.isFinite(v) || v <= 0) return setErro('Informe um valor maior que zero.')
    if (v > conta.totais.restante + 0.001) return setErro(`Valor maior que o restante. Máximo: ${formatBRL(conta.totais.restante)}.`)
    if (forma === 'dinheiro' && recebido && (!Number.isFinite(rec) || rec < v)) return setErro('Valor recebido menor que o valor a receber. Confira o valor entregue pelo cliente.')
    if (forma === 'fiado' && !obs.trim()) return setErro('No fiado, informe de quem é a conta.')
    setEnviando(true)
    setErro(null)
    const ok = await onRegistrar(
      { forma, valor: v, recebido: forma === 'dinheiro' && recebido ? rec : null, chave: chave.current, observacao: obs.trim() || null },
      fecharDepois,
    )
    setEnviando(false)
    // Chave nova só depois de registrar. Na falha, a MESMA chave: se a resposta se perdeu
    // com o pagamento já gravado, o reenvio é reconhecido e não paga em dobro.
    if (ok) chave.current = novaChave()
  }

  // Teclado na tela (toque): edita o campo ativo.
  const [campo, setCampo] = useState<'valor' | 'recebido'>('valor')
  const restante = conta.totais.restante
  const fmt = (n: number) => n.toFixed(2).replace('.', ',')
  const sujo = valor !== fmt(restante) || recebido.trim() !== '' || obs.trim() !== ''
  function tecla(t: string) {
    const atual = campo === 'valor' ? valor : recebido
    const novoValor = t === '⌫' ? atual.slice(0, -1) : t === ',' ? (atual.includes(',') ? atual : (atual || '0') + ',') : (/,\d{2}$/.test(atual) ? atual : atual + t)
    if (campo === 'valor') setValor(novoValor)
    else setRecebido(novoValor)
  }
  function atalho(a: number | 'exato') {
    if (a === 'exato') { setValor(fmt(restante)); if (forma === 'dinheiro') setRecebido(fmt(restante)); return }
    // No dinheiro o atalho é o que o cliente entregou (o troco aparece); nas outras, o valor.
    if (forma === 'dinheiro') { setRecebido(fmt(a)); setCampo('recebido') } else setValor(fmt(Math.min(a, restante)))
  }
  const ident = conta.tipo === 'balcao' ? `Senha ${conta.senha}` : conta.mesaNome ?? 'Mesa'

  return (
    <TelaPdv
      titulo="Receber"
      onVoltar={onCancelar}
      sujo={sujo}
      testid="receber-tela"
      rodape={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <BotaoPdv icone={ICONES_PDV.check} tipo={podeFechar ? 'secundario' : 'principal'} disabled={enviando} onClick={() => void registrar(false)} testid="receber-registrar" className="sm:min-w-[240px]">
            {enviando ? 'Registrando…' : 'Registrar pagamento'}
          </BotaoPdv>
          {podeFechar && (
            <BotaoPdv icone={ICONES_PDV.checkDuplo} tipo="sucesso" disabled={enviando} onClick={() => void registrar(true)} testid="receber-registrar-fechar" className="sm:min-w-[260px]">
              Registrar e fechar conta
            </BotaoPdv>
          )}
        </div>
      }
    >
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_420px]">
        {/* Esquerda: valores */}
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-menuzia bg-page px-4 py-3">
            <span className="text-[14px] font-semibold text-text-subtle">Restante a pagar · {ident}</span>
            <span className="text-[28px] font-extrabold text-text-main" data-testid="receber-restante">{formatBRL(restante)}</span>
          </div>
          {/* O que já mexeu no total: taxas (azul) e desconto (verde), como na conta. */}
          {(conta.totais.taxaServico > 0 || conta.taxas.length > 0 || conta.totais.desconto > 0) && (
            <div data-testid="receber-ajustes">
              {conta.totais.taxaServico > 0 && <LinhaAjuste tipo="taxa" rotulo={`Taxa de serviço (${conta.taxaServicoPercentual}%)`} valor={conta.totais.taxaServico} />}
              {conta.taxas.map((t, i) => <LinhaAjuste key={i} tipo="taxa" rotulo={rotuloTaxa(t)} valor={t.valor} />)}
              {conta.totais.desconto > 0 && <LinhaAjuste tipo="desconto" rotulo={conta.cupomCodigo ? `Desconto (cupom ${conta.cupomCodigo})` : 'Desconto'} valor={conta.totais.desconto} />}
            </div>
          )}
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-text-subtle">Valor a receber</span>
            <input value={valor} inputMode="decimal" onFocus={() => setCampo('valor')} onChange={(e) => setValor(e.target.value)} data-testid="receber-valor"
              className={['pdv-campo-valor h-[60px] w-full rounded-menuzia border-2 px-4 text-right text-[26px] font-extrabold text-text-main focus:outline-none', campo === 'valor' ? 'pdv-campo-ativo border-primary' : 'border-border'].join(' ')} />
          </label>
          {forma === 'dinheiro' && (
            <>
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold text-text-subtle">Valor recebido</span>
                <input value={recebido} inputMode="decimal" onFocus={() => setCampo('recebido')} onChange={(e) => setRecebido(e.target.value)} placeholder="0,00" data-testid="receber-recebido"
                  className={['pdv-campo-valor h-[60px] w-full rounded-menuzia border-2 px-4 text-right text-[26px] font-extrabold text-text-main placeholder:font-normal focus:outline-none', campo === 'recebido' ? 'pdv-campo-ativo border-primary' : 'border-border'].join(' ')} />
              </label>
              <div className="flex items-center justify-between rounded-menuzia bg-price-bg px-4 py-3">
                <span className="text-[15px] font-bold text-text-main">Troco</span>
                <strong className="text-[30px] font-extrabold text-price-text" data-testid="receber-troco">{formatBRL(troco)}</strong>
              </div>
            </>
          )}
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-text-subtle">Observação {forma === 'fiado' && <span className="text-danger">(obrigatória no fiado)</span>}</span>
            <input value={obs} maxLength={200} onChange={(e) => setObs(e.target.value)} className="h-[48px] w-full rounded-menuzia border border-border px-3 text-[14px] text-text-main focus:border-primary focus:outline-none" />
          </label>
          {conta.pagamentos.filter((p) => !p.estornado).length > 0 && (
            <p className="text-[13px] text-text-subtle">
              Já pago: {conta.pagamentos.filter((p) => !p.estornado).map((p) => `${ROTULO_FORMA[p.forma] ?? p.forma} ${formatBRL(p.valor)}`).join(' · ')}
            </p>
          )}
          {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2.5 text-[14px] font-semibold text-danger" data-testid="receber-erro">{erro}</p>}
        </div>

        {/* Direita: formas e teclado */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {formas.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => { setForma(f); setCampo('valor') }}
                data-testid={`forma-${f}`}
                aria-pressed={forma === f}
                className={['relative flex h-[64px] items-center gap-2.5 rounded-menuzia border-2 px-3 text-[15px] font-bold transition-colors', forma === f ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-main hover:border-primary'].join(' ')}
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6 flex-shrink-0 fill-current" aria-hidden><path d={ICONE_FORMA_PDV[f] ?? ICONE_FORMA_PDV.outros} /></svg>
                {ROTULO_FORMA[f as FormaPagamento] ?? f}
                {forma === f && <svg viewBox="0 0 24 24" className="absolute right-2 top-2 h-4 w-4 fill-current" aria-hidden><path d={ICONES_PDV.check} /></svg>}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(['exato', 50, 100, 200] as const).map((a) => (
              <button key={String(a)} type="button" onClick={() => atalho(a)} className="h-[56px] rounded-menuzia border border-border bg-white text-[15px] font-bold text-text-main active:scale-[0.97]" data-testid={`receber-atalho-${a}`}>
                {a === 'exato' ? 'Valor exato' : `R$ ${a}`}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2" data-testid="receber-teclado">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map((t) => (
              <button key={t} type="button" onClick={() => tecla(t)} aria-label={t === '⌫' ? 'Apagar' : t}
                className="h-[56px] rounded-menuzia border border-border bg-white text-[22px] font-bold text-text-main active:bg-page">
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
    </TelaPdv>
  )
}

function PendenciasModal({
  conta,
  dados,
  pode,
  ocupado,
  agora,
  onVoltar,
  onAgir,
  onReceber,
  onResolver,
}: {
  conta: ContaPresencial
  dados: Pendencias
  pode: Permissoes
  ocupado: boolean
  agora: number
  onVoltar: () => void
  onAgir: (corpo: Record<string, unknown>, ok: string) => Promise<void>
  onReceber: () => void
  onResolver: () => void
}) {
  const grupos = (['aguardando_aceite', 'em_preparo', 'pronto_nao_atendido'] as const).map((cat) => ({
    cat,
    itens: dados.pedidos.filter((p) => p.categoria === cat),
  }))
  const verbo = conta.tipo === 'mesa' ? 'Marcar servido' : 'Entregue no balcão'
  const temAlgo = dados.pedidos.length > 0 || dados.cancelamentos.length > 0 || dados.financeiro.restante > 0
  return (
    <Moldura titulo={temAlgo ? 'Ainda não dá para fechar' : 'Sem pendências'} onVoltar={onVoltar} largura="max-w-2xl">
      <div className="space-y-3 overflow-y-auto px-4 py-4" data-testid="pendencias">
        {grupos.map(({ cat, itens }) =>
          itens.length === 0 ? null : (
            <div key={cat}>
              <p className="text-[12px] font-bold text-text-main">
                {ROTULO_PENDENCIA[cat]} ({itens.length})
              </p>
              <ul className="mt-1 space-y-1">
                {itens.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-menuzia border border-border px-3 py-2 text-[12px]">
                    <span className="flex-1 text-text-main">
                      <strong>#{p.numero}</strong> · {tempoCurto(cat === 'pronto_nao_atendido' ? p.pronto_em : cat === 'em_preparo' ? p.preparando_em : p.criado_em, agora)} · {formatBRL(Number(p.total))}
                      {p.criado_por_nome ? ` · por ${p.criado_por_nome}` : ''} · {p.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', ')}
                    </span>
                    {cat === 'pronto_nao_atendido' && pode.atender && (
                      <button type="button" disabled={ocupado} onClick={() => void onAgir({ acao: 'atender', pedidoId: p.id }, `#${p.numero} entregue.`)} className="rounded-menuzia bg-sidebar-bg px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">
                        {verbo}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
        {dados.cancelamentos.length > 0 && (
          <div>
            <p className="text-[12px] font-bold text-text-main">{ROTULO_PENDENCIA.cancelamento_pendente} ({dados.cancelamentos.length})</p>
            <ul className="mt-1 space-y-1">
              {dados.cancelamentos.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-menuzia border border-border px-3 py-2 text-[12px]">
                  <span className="flex-1 text-text-main">
                    #{c.numero} · {c.item ?? 'pedido inteiro'} · “{c.motivo}” ({c.solicitado_por_nome})
                  </span>
                  {pode.decidir_cancelamento && (
                    <>
                      <button type="button" disabled={ocupado} onClick={() => void onAgir({ acao: 'decidir_cancelamento', solicitacaoId: c.id, aprovar: true }, 'Cancelamento aprovado.')} className="rounded-menuzia bg-danger px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">Aprovar</button>
                      <button type="button" disabled={ocupado} onClick={() => void onAgir({ acao: 'decidir_cancelamento', solicitacaoId: c.id, aprovar: false }, 'Cancelamento recusado.')} className="rounded-menuzia border border-border px-2.5 py-1.5 text-[11px] font-bold text-text-main disabled:opacity-50">Recusar</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="rounded-menuzia bg-page px-3 py-2 text-[12px] text-text-main" data-testid="pendencias-financeiro">
          <strong>Financeiro:</strong>{' '}
          {dados.atendido_nao_pago
            ? ROTULO_PENDENCIA.atendido_nao_pago
            : dados.parcialmente_pago
              ? ROTULO_PENDENCIA.parcialmente_pago
              : ROTULO_FINANCEIRO[(dados.financeiro.situacao as keyof typeof ROTULO_FINANCEIRO) ?? 'nao_pago']}
          {' · '}Pago {formatBRL(Number(dados.financeiro.pago))} de {formatBRL(Number(dados.financeiro.total))}
          {Number(dados.financeiro.restante) > 0 && <> · falta <strong>{formatBRL(Number(dados.financeiro.restante))}</strong></>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
        <button type="button" onClick={onVoltar} className="rounded-menuzia border border-border px-4 py-2.5 text-[13px] font-semibold text-text-main">
          <Ic d={ICONES_PDV.voltar} />
          Voltar sem fechar
        </button>
        {Number(dados.financeiro.restante) > 0 && pode.pagamento && (
          <button type="button" onClick={onReceber} className="rounded-menuzia bg-primary px-4 py-2.5 text-[13px] font-bold text-white">
            <Ic d={ICONES_PDV.receber} />
            Receber restante
          </button>
        )}
        {pode.resolver && dados.pedidos.length > 0 && (
          <button type="button" onClick={onResolver} data-testid="pendencias-resolver" className="ml-auto rounded-menuzia border-2 border-warn px-4 py-2.5 text-[13px] font-bold text-warn hover:bg-warn hover:text-white">
            <Ic d={ICONES_PDV.alerta} />
            Resolver pendências…
          </button>
        )}
      </div>
    </Moldura>
  )
}

const OPCOES_RESOLUCAO: { acao: AcaoResolucao | 'manter'; rotulo: string; so?: string[] }[] = [
  { acao: 'manter', rotulo: 'Manter' },
  { acao: 'marcar_atendido', rotulo: 'Entregue/servido', so: ['pronto'] },
  { acao: 'forcar_atendido', rotulo: 'Forçar entregue', so: ['recebido', 'preparando'] },
  { acao: 'nao_entregue', rotulo: 'Não entregue' },
  { acao: 'cancelar_pedido', rotulo: 'Cancelar pedido' },
]

function ResolverModal({
  conta,
  dados,
  ocupado,
  onVoltar,
  onAplicar,
}: {
  conta: ContaPresencial
  dados: Pendencias
  ocupado: boolean
  onVoltar: () => void
  onAplicar: (acoes: { pedido_id: string; acao: AcaoResolucao }[], motivo: string, fechar: boolean) => Promise<string | null>
}) {
  const [escolha, setEscolha] = useState<Record<string, AcaoResolucao | 'manter'>>({})
  const [motivo, setMotivo] = useState('')
  const [confirmo, setConfirmo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const acoes = Object.entries(escolha)
    .filter(([, a]) => a !== 'manter')
    .map(([pedido_id, acao]) => ({ pedido_id, acao: acao as AcaoResolucao }))
  const soMarcar = acoes.length > 0 && acoes.every((a) => a.acao === 'marcar_atendido')
  const podeAplicar = acoes.length > 0 && (soMarcar || (motivo.trim().length >= 5 && confirmo))

  // Antecipa o efeito financeiro: cancelar abaixo do que já foi pago exige estorno antes.
  const removido = acoes
    .filter((a) => a.acao === 'cancelar_pedido')
    .reduce((s, a) => s + Number(dados.pedidos.find((p) => p.id === a.pedido_id)?.total ?? 0), 0)
  const novoTotal = Math.max(0, conta.totais.total - removido)
  const excedente = conta.totais.pago - novoTotal

  async function aplicar(fechar: boolean) {
    setErro(null)
    const e = await onAplicar(acoes, motivo.trim(), fechar)
    if (e) setErro(e)
  }

  return (
    <Moldura titulo={`Resolver pendências · ${conta.tipo === 'balcao' ? `Senha ${conta.senha}` : conta.mesaNome}`} onVoltar={onVoltar} largura="max-w-2xl">
      <div className="space-y-3 overflow-y-auto px-4 py-4" data-testid="resolver">
        {dados.pedidos.map((p) => (
          <div key={p.id} className="rounded-menuzia border border-border px-3 py-2">
            <p className="text-[12px] text-text-main">
              <strong>#{p.numero}</strong> · {ROTULO_PENDENCIA[p.categoria]} · {formatBRL(Number(p.total))} · {p.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', ')}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {OPCOES_RESOLUCAO.filter((o) => !o.so || o.so.includes(p.status)).map((o) => (
                <button
                  key={o.acao}
                  type="button"
                  onClick={() => setEscolha((prev) => ({ ...prev, [p.id]: o.acao }))}
                  data-testid={`resolver-${p.numero}-${o.acao}`}
                  className={[
                    'rounded-menuzia border px-2.5 py-1.5 text-[11px] font-semibold',
                    (escolha[p.id] ?? 'manter') === o.acao ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-main',
                  ].join(' ')}
                >
                  {o.rotulo}
                </button>
              ))}
            </div>
          </div>
        ))}
        {excedente > 0.004 && (
          <p className="rounded-menuzia bg-warn-bg px-3 py-2 text-[12px] font-semibold text-warn">
            Cancelar reduz o total para {formatBRL(novoTotal)}, mas já foram pagos {formatBRL(conta.totais.pago)}. Registre antes um estorno de{' '}
            {formatBRL(excedente)} (na lista de pagamentos) ou um ajuste.
          </p>
        )}
        {!soMarcar && (
          <>
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Motivo <span className="text-danger">*</span></span>
              <input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} data-testid="resolver-motivo" className="w-full rounded-menuzia border border-border px-3 py-2 text-[13px] focus:border-primary focus:outline-none" />
            </label>
            <label className="flex items-center gap-2 text-[12px] text-text-main">
              <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} data-testid="resolver-confirmo" />
              Confirmo que estas ações ficam registradas com o meu nome
            </label>
          </>
        )}
        {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
        <button type="button" onClick={onVoltar} className="rounded-menuzia border border-border px-4 py-2.5 text-[13px] font-semibold"><Ic d={ICONES_PDV.voltar} />Voltar</button>
        <button type="button" disabled={!podeAplicar || ocupado} onClick={() => void aplicar(false)} className="ml-auto rounded-menuzia border-2 border-primary px-4 py-2.5 text-[13px] font-bold text-primary disabled:opacity-40">
          <Ic d={ICONES_PDV.check} />
          Aplicar
        </button>
        <button type="button" disabled={!podeAplicar || ocupado} onClick={() => void aplicar(true)} data-testid="resolver-aplicar-fechar" className="rounded-menuzia bg-status-ready px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-40">
          <Ic d={ICONES_PDV.checkDuplo} />
          Aplicar e fechar conta
        </button>
      </div>
    </Moldura>
  )
}

function HistoricoModal({ eventos, titulo, onVoltar }: { eventos: EventoHistorico[]; titulo: string; onVoltar: () => void }) {
  const ordenados = [...eventos].sort((a, b) => a.quando.localeCompare(b.quando))
  return (
    <Moldura titulo={`Histórico · ${titulo}`} onVoltar={onVoltar} largura="max-w-2xl">
      <ul className="divide-y divide-border overflow-y-auto" data-testid="historico">
        {ordenados.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-text-subtle">Nada registrado ainda.</li>}
        {ordenados.map((e, i) => (
          <li key={`${e.quando}-${i}`} className="grid grid-cols-[48px_130px_1fr] gap-2 px-4 py-2 text-[12px]">
            <span className="text-text-subtle">{horaCurta(e.quando)}</span>
            <span className="truncate font-semibold text-text-main">{e.quem}</span>
            <span className="text-text-main">{e.oQue}</span>
          </li>
        ))}
      </ul>
    </Moldura>
  )
}

function CancelarModal({
  pedido,
  podeDireto,
  podeSolicitar,
  ocupado,
  onVoltar,
  onConfirmar,
}: {
  pedido: PedidoConta
  podeDireto: boolean
  podeSolicitar: boolean
  ocupado: boolean
  onVoltar: () => void
  onConfirmar: (motivo: string, direto: boolean) => Promise<string | null>
}) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const direto = podeDireto
  return (
    <Moldura titulo={`${direto ? 'Cancelar' : 'Pedir cancelamento do'} pedido #${pedido.numero}`} onVoltar={onVoltar}>
      <div className="space-y-3 px-4 py-4">
        <p className="text-[13px] text-text-main">
          {direto
            ? 'O pedido sai da cozinha e da conta. Se já houver pagamento acima do novo total, estorne antes.'
            : 'Este pedido já começou a ser preparado ou a conta já recebeu pagamento. A gerência decide o cancelamento.'}
        </p>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Motivo <span className="text-danger">*</span></span>
          <input autoFocus value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} data-testid="cancelar-motivo" className="w-full rounded-menuzia border border-border px-3 py-2 text-[13px] focus:border-primary focus:outline-none" />
        </label>
        {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>}
      </div>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button type="button" onClick={onVoltar} className="flex-1 rounded-menuzia border border-border py-2.5 text-[13px] font-semibold"><Ic d={ICONES_PDV.voltar} />Voltar</button>
        <button
          type="button"
          disabled={!motivo.trim() || ocupado || (!direto && !podeSolicitar)}
          data-testid="cancelar-confirmar"
          onClick={async () => {
            setErro(null)
            const e = await onConfirmar(motivo.trim(), direto)
            if (e) setErro(e)
          }}
          className="flex-[2] rounded-menuzia bg-danger py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
        >
          <Ic d={ICONES_PDV.fechar} />
          {direto ? 'Cancelar pedido' : 'Pedir à gerência'}
        </button>
      </div>
    </Moldura>
  )
}

function MotivoModal({
  titulo,
  descricao,
  botao,
  perigo,
  ocupado,
  onVoltar,
  onConfirmar,
}: {
  titulo: string
  descricao: string
  botao: string
  perigo?: boolean
  ocupado: boolean
  onVoltar: () => void
  onConfirmar: (motivo: string) => Promise<string | null>
}) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  return (
    <Moldura titulo={titulo} onVoltar={onVoltar} pequena>
      <div className="space-y-3 px-4 py-4">
        <p className="text-[13px] text-text-main">{descricao}</p>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Motivo <span className="text-danger">*</span></span>
          <input autoFocus value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} data-testid="motivo" className="w-full rounded-menuzia border border-border px-3 py-2 text-[13px] focus:border-primary focus:outline-none" />
        </label>
        {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>}
      </div>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button type="button" onClick={onVoltar} className="flex-1 rounded-menuzia border border-border py-2.5 text-[13px] font-semibold"><Ic d={ICONES_PDV.voltar} />Voltar</button>
        <button
          type="button"
          disabled={motivo.trim().length < 5 || ocupado}
          data-testid="motivo-confirmar"
          onClick={async () => {
            setErro(null)
            const e = await onConfirmar(motivo.trim())
            if (e) setErro(e)
          }}
          className={['flex-[2] rounded-menuzia py-2.5 text-[13px] font-bold text-white disabled:opacity-40', perigo ? 'bg-danger' : 'bg-warn'].join(' ')}
        >
          <Ic d={ICONES_PDV.alerta} />
          {botao}
        </button>
      </div>
    </Moldura>
  )
}

function AjustarModal({
  conta,
  podeTaxa,
  ocupado,
  onVoltar,
  onSalvar,
}: {
  conta: ContaPresencial
  podeTaxa: boolean
  ocupado: boolean
  onVoltar: () => void
  onSalvar: (corpo: Record<string, unknown>) => Promise<string | null>
}) {
  const [taxa, setTaxa] = useState(String(conta.taxaServicoPercentual).replace('.', ','))
  const [tipo, setTipo] = useState<'valor' | 'percentual'>(conta.descontoTipo)
  const [desconto, setDesconto] = useState(String(conta.descontoTipo === 'percentual' ? conta.descontoPercentual : conta.descontoValor).replace('.', ','))
  const [motivo, setMotivo] = useState(conta.descontoMotivo ?? '')
  const [erro, setErro] = useState<string | null>(null)
  return (
    <Moldura titulo="Desconto e taxa de serviço" onVoltar={onVoltar} pequena>
      <div className="space-y-3 px-4 py-4">
        {podeTaxa ? (
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Taxa de serviço (%)</span>
          <input value={taxa} inputMode="decimal" onChange={(e) => setTaxa(e.target.value)} className="w-full rounded-menuzia border border-border px-3 py-2 text-[13px]" />
          {conta.tipo === 'balcao' && <span className="mt-0.5 block text-[11px] text-text-subtle">Balcão nasce sem taxa de serviço. Taxa manual só gerente ou dono.</span>}
        </label>
        ) : (
          <p className="rounded-menuzia bg-page px-3 py-2 text-[12px] text-text-subtle">
            Taxa de serviço: {String(conta.taxaServicoPercentual).replace('.', ',')}%{conta.tipo === 'balcao' ? ' — no balcão, só gerente ou dono altera.' : '.'}
          </p>
        )}
        <div className="flex gap-2">
          {(['valor', 'percentual'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTipo(t)} className={['flex-1 rounded-menuzia border px-3 py-2 text-[12px] font-semibold', tipo === t ? 'border-primary bg-primary text-white' : 'border-border'].join(' ')}>
              Desconto em {t === 'valor' ? 'R$' : '%'}
            </button>
          ))}
        </div>
        <input value={desconto} inputMode="decimal" onChange={(e) => setDesconto(e.target.value)} className="w-full rounded-menuzia border border-border px-3 py-2 text-[13px]" />
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Motivo do desconto</span>
          <input value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} className="w-full rounded-menuzia border border-border px-3 py-2 text-[13px]" />
        </label>
        {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>}
      </div>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button type="button" onClick={onVoltar} className="flex-1 rounded-menuzia border border-border py-2.5 text-[13px] font-semibold"><Ic d={ICONES_PDV.voltar} />Voltar</button>
        <button
          type="button"
          disabled={ocupado}
          onClick={async () => {
            setErro(null)
            const d = lerValor(desconto || '0')
            const e = await onSalvar({
              taxaServico: podeTaxa ? lerValor(taxa || '0') : undefined,
              descontoTipo: tipo,
              descontoValor: tipo === 'valor' ? d : 0,
              descontoPercentual: tipo === 'percentual' ? d : 0,
              motivo: motivo.trim() || null,
            })
            if (e) setErro(e)
          }}
          className="flex-[2] rounded-menuzia bg-primary py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
        >
          <Ic d={ICONES_PDV.salvar} />
          Salvar
        </button>
      </div>
    </Moldura>
  )
}

interface ViaPreConta {
  id: string
  via: number
  estado: string
  erro: string | null
  criadoEm: string
  enviadoEm: string | null
  criadoPorNome: string
  impressora: string
  computadorOnline: boolean
  total: number
}

const ROTULO_VIA: Record<string, string> = {
  pendente: 'Aguardando o Assistente…',
  reservado: 'Enviado para a impressora',
  enviado_spooler: 'Impresso',
  falhou: 'Erro ao imprimir',
  expirado: 'Expirado (não impresso)',
  cancelado: 'Cancelado',
}

/** Quanto tempo esperar antes de explicar a demora (não trava nada: é só a mensagem). */
const DEMORA_PEGAR_MS = 10_000
const DEMORA_IMPRIMIR_MS = 25_000

/**
 * Recibo/Extrato (a "pré-conta"): documento não fiscal para o cliente conferir a conta.
 * Manual, só por este botão.
 * Não mexe na conta — nem pedido, nem pagamento, nem atendimento, nem cozinha. O
 * servidor monta tudo; a tela manda só a chave. Mostra a última via e o estado real
 * ("aceito pela fila do Windows" não quer dizer papel na mão).
 */
function PreContaBloco({ comandaId, variante = 'bloco' }: { comandaId: string; variante?: 'bloco' | 'barra' }) {
  const [vias, setVias] = useState<ViaPreConta[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<{ texto: string; semCaixa: boolean } | null>(null)
  const chave = useRef(novaChave())

  const carregar = useCallback(async () => {
    const r = await chamar<{ vias: ViaPreConta[] }>(`/api/admin/comandas/${comandaId}/pre-conta`)
    if (r.ok && r.dados) setVias(r.dados.vias)
  }, [comandaId])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const ultima = vias?.[0] ?? null
  const andando = ultima && (ultima.estado === 'pendente' || ultima.estado === 'reservado')
  // Acompanha rápido nos primeiros segundos (o papel sai em ~1–2 s) e depois sem pressa.
  const [agora, setAgora] = useState(() => Date.now())
  const criadoEmUltima = ultima?.criadoEm
  useEffect(() => {
    if (!andando) return
    const criado = new Date(criadoEmUltima ?? Date.now()).getTime()
    const idade = () => Date.now() - criado
    let vivo = true
    let t: ReturnType<typeof setTimeout>
    const passo = () => {
      if (!vivo) return
      void carregar()
      setAgora(Date.now())
      t = setTimeout(passo, idade() < 15_000 ? 700 : 2000)
    }
    t = setTimeout(passo, idade() < 15_000 ? 700 : 2000)
    return () => { vivo = false; clearTimeout(t) }
  }, [andando, carregar, criadoEmUltima, ultima?.estado])
  const idadeUltima = ultima ? agora - new Date(ultima.criadoEm).getTime() : 0

  async function imprimir(reimpressao: boolean) {
    if (enviando) return
    setEnviando(true)
    setErro(null)
    const r = await chamar(`/api/admin/comandas/${comandaId}/pre-conta`, {
      method: 'POST',
      body: JSON.stringify({ chave: chave.current, reimpressao }),
    })
    setEnviando(false)
    // Chave nova só depois do envio: clique duplo e reenvio devolvem o mesmo trabalho.
    chave.current = novaChave()
    if (!r.ok) {
      // Configuração de impressão incompleta: mensagem humana + atalho para a tela Impressão.
      setErro({ texto: r.erro ?? 'Não foi possível enviar o Recibo/Extrato.', semCaixa: ['impressora_caixa_nao_configurada', 'impressora_caixa_indisponivel', 'modo_somente_teste'].includes(r.codigo ?? '') })
      return
    }
    await carregar()
  }

  if (variante === 'barra') {
    const problema = erro?.texto
      ?? (ultima && andando && !ultima.computadorOnline ? 'Assistente desconectado' : null)
      ?? (ultima && (ultima.estado === 'falhou' || ultima.estado === 'expirado') ? 'Falhou' : null)
    return (
      <div className="flex flex-col items-center" data-testid="pre-conta">
        <BotaoAcao
          icone={ICONE_ACAO.imprimir}
          rotulo={enviando ? 'Enviando…' : ultima ? 'Reimprimir' : 'Imprimir'}
          disabled={enviando}
          onClick={() => void imprimir(Boolean(ultima))}
          testid={ultima ? 'pre-conta-reimprimir' : 'pre-conta-imprimir'}
          title={ultima ? `${ultima.via}ª via · ${ROTULO_VIA[ultima.estado] ?? ultima.estado}` : 'Imprimir Recibo/Extrato'}
        />
        {problema && <span className="mt-0.5 max-w-[96px] text-center text-[10px] font-semibold leading-tight text-danger" data-testid="pre-conta-demora">{problema}</span>}
      </div>
    )
  }
  return (
    <div className="rounded-menuzia border border-border bg-white px-3 py-2" data-testid="pre-conta">
      <button
        type="button"
        disabled={enviando}
        onClick={() => void imprimir(Boolean(ultima))}
        data-testid={ultima ? 'pre-conta-reimprimir' : 'pre-conta-imprimir'}
        className="w-full rounded-menuzia border-2 border-sidebar-bg bg-white py-3 text-[14px] font-bold text-sidebar-bg transition-all hover:bg-sidebar-bg hover:text-white disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : ultima ? 'Reimprimir Recibo/Extrato' : 'Imprimir Recibo/Extrato'}
      </button>
      {ultima && (
        <p className="mt-1.5 text-[11px] leading-snug text-text-subtle" data-testid="pre-conta-estado">
          {ultima.via}ª via · {horaCurta(ultima.criadoEm)} · {ultima.impressora} ·{' '}
          <strong className={ultima.estado === 'enviado_spooler' ? 'text-price-text' : ultima.estado === 'falhou' || ultima.estado === 'expirado' ? 'text-danger' : 'text-text-main'}>
            {ROTULO_VIA[ultima.estado] ?? ultima.estado}
          </strong>
          {andando && !ultima.computadorOnline && <span className="block text-danger" data-testid="pre-conta-demora">Assistente desconectado: abra o Assistente Menuzia no computador da impressora. O Recibo/Extrato vence em 10 min.</span>}
          {ultima.estado === 'pendente' && ultima.computadorOnline && idadeUltima > DEMORA_PEGAR_MS && <span className="block text-warn" data-testid="pre-conta-demora">O Assistente ainda não pegou o Recibo/Extrato. Confira se ele está aberto e com internet.</span>}
          {ultima.estado === 'reservado' && idadeUltima > DEMORA_IMPRIMIR_MS && <span className="block text-danger" data-testid="pre-conta-demora">A impressora não respondeu. Confira papel, tampa, cabo e se ela está ligada.</span>}
          {ultima.erro && ultima.estado !== 'enviado_spooler' && <span className="block text-danger">{ultima.erro}</span>}
        </p>
      )}
      {erro && (
        <p className="mt-1.5 text-[11px] font-semibold text-danger" data-testid="pre-conta-erro">
          {erro.texto}
          {erro.semCaixa && (
            <a href="/admin/impressao" className="mt-1.5 inline-flex items-center rounded-menuzia border border-danger/40 bg-white px-2.5 py-1 text-[12px] font-bold text-danger no-underline hover:bg-danger hover:text-white" data-testid="pre-conta-configurar">
              Configurar impressão
            </a>
          )}
        </p>
      )}
    </div>
  )
}

/** Cupom da conta: mesmas regras do delivery, uso contado no fechamento. */
function CupomBloco({ conta, ocupado, onAgir }: {
  conta: ContaPresencial
  ocupado: boolean
  onAgir: (corpo: Record<string, unknown>, sucesso?: string) => Promise<unknown>
}) {
  const [codigo, setCodigo] = useState('')
  if (conta.cupomCodigo) {
    return (
      <div className="flex items-center justify-between rounded-menuzia border border-border bg-white px-3 py-2 text-[12px]" data-testid="conta-cupom">
        <span className="text-text-main">
          Cupom <strong>{conta.cupomCodigo}</strong>
        </span>
        <button type="button" disabled={ocupado} onClick={() => void onAgir({ acao: 'remover_cupom' }, 'Cupom removido.')} className="text-[11px] font-semibold text-danger hover:underline disabled:opacity-50">
          Remover
        </button>
      </div>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!codigo.trim()) return
        void onAgir({ acao: 'aplicar_cupom', codigo }, 'Cupom aplicado.').then(() => setCodigo(''))
      }}
      className="flex gap-2"
    >
      <input
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.toUpperCase())}
        placeholder={conta.clienteTelefone ? 'Cupom' : 'Cupom (exige telefone)'}
        maxLength={40}
        data-testid="conta-cupom-codigo"
        className="min-w-0 flex-1 rounded-menuzia border border-border bg-white px-3 py-2 text-[12px] uppercase focus:border-primary focus:outline-none"
      />
      <button type="submit" disabled={ocupado || !codigo.trim()} data-testid="conta-cupom-aplicar" className="rounded-menuzia border border-border bg-white px-3 py-2 text-[12px] font-semibold text-text-main hover:border-primary hover:text-primary disabled:opacity-50">
        Aplicar
      </button>
    </form>
  )
}

// ─── Barra de ações da conta (2026-10-01) ─────────────────────────────────────
// Toque: botões de 64px, sem depender de hover. Principais grandes à direita; secundárias
// com ícone + legenda à esquerda; "Cancelar a conta" separado, em vermelho (confirma com motivo).
const ICONE_ACAO = {
  lancar: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  imprimir: 'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z',
  taxas: 'M7.5 4C5.57 4 4 5.57 4 7.5S5.57 11 7.5 11 11 9.43 11 7.5 9.43 4 7.5 4zm0 5C6.67 9 6 8.33 6 7.5S6.67 6 7.5 6 9 6.67 9 7.5 8.33 9 7.5 9zm9 4c-1.93 0-3.5 1.57-3.5 3.5s1.57 3.5 3.5 3.5 3.5-1.57 3.5-3.5-1.57-3.5-3.5-3.5zm0 5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5.41 20 4 18.59 18.59 4 20 5.41 5.41 20z',
  pendencias: 'M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
  cliente: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  historico: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  cancelar: 'M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z',
} as const

function BotaoAcao({ icone, rotulo, onClick, disabled, testid, title, perigo = false }: { icone: string; rotulo: string; onClick: () => void; disabled?: boolean; testid?: string; title?: string; perigo?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      title={title ?? rotulo}
      className={[
        'flex h-[84px] w-[88px] flex-shrink-0 flex-col items-center justify-center gap-1.5 rounded-menuzia border bg-white text-[12px] font-semibold leading-tight transition-colors active:scale-[0.97] disabled:opacity-50',
        perigo ? 'border-danger/40 text-danger hover:bg-danger-bg' : 'border-border text-text-main hover:border-primary hover:text-primary',
      ].join(' ')}
    >
      <svg viewBox="0 0 24 24" className="h-[28px] w-[28px] fill-current" aria-hidden><path d={icone} /></svg>
      <span className="max-w-full px-0.5 text-center">{rotulo}</span>
    </button>
  )
}

function BarraAcoesConta({
  conta, pode, ocupado, onLancar, onReceber, onFechar, onTaxas, onAjustar, onPendencias, onCliente, onHistorico, onCancelar,
}: {
  conta: ContaPresencial
  pode: Record<string, boolean>
  ocupado: boolean
  onLancar: () => void
  onReceber: () => void
  onFechar: () => void
  onTaxas: () => void
  onAjustar: () => void
  onPendencias: () => void
  onCliente: () => void
  onHistorico: () => void
  onCancelar: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 bg-white" data-testid="conta-barra-acoes">
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        {pode.lancar && <BotaoAcao icone={ICONE_ACAO.lancar} rotulo="Lançar" onClick={onLancar} disabled={ocupado} testid="conta-lancar" />}
        {pode.pre_conta && !conta.entrega && <PreContaBloco comandaId={conta.id} variante="barra" />}
        {(pode.taxa_extra || pode.ajustar_valores) && <BotaoAcao icone={ICONE_ACAO.taxas} rotulo="Taxas" onClick={onTaxas} disabled={ocupado} testid="conta-adicionar-taxa" />}
        {pode.ajustar_valores && <BotaoAcao icone={ICONE_ACAO.taxas} rotulo="Desconto" onClick={onAjustar} disabled={ocupado} testid="conta-ajustar" />}
        <BotaoAcao icone={ICONE_ACAO.pendencias} rotulo="Pendências" onClick={onPendencias} testid="conta-pendencias" />
        {pode.identificar && <BotaoAcao icone={ICONE_ACAO.cliente} rotulo="Cliente" onClick={onCliente} testid="conta-identificar" />}
        <BotaoAcao icone={ICONE_ACAO.historico} rotulo="Histórico" onClick={onHistorico} testid="conta-historico" />
        {pode.cancelar_conta && <BotaoAcao icone={ICONE_ACAO.cancelar} rotulo="Cancelar" onClick={onCancelar} disabled={ocupado} testid="conta-cancelar-conta" perigo />}
      </div>
      <div className="flex w-full gap-2 sm:w-auto">
        {pode.pagamento && conta.totais.restante > 0 && (
          <button type="button" disabled={ocupado} onClick={onReceber} data-testid="conta-receber"
            className="flex h-[84px] flex-1 items-center justify-center gap-2 rounded-menuzia bg-primary px-7 text-[18px] font-bold text-white transition-all hover:bg-primary-dark active:scale-[0.98] disabled:opacity-50 sm:flex-none">
            <Ic d={ICONES_PDV.receber} />
            Receber
          </button>
        )}
        {pode.fechar && (
          <button type="button" disabled={ocupado} onClick={onFechar} data-testid="conta-fechar"
            className={['flex h-[84px] flex-1 items-center justify-center gap-2 rounded-menuzia border-2 border-status-ready px-7 text-[18px] font-bold transition-all hover:brightness-95 active:scale-[0.98] disabled:opacity-50 sm:flex-none',
              // Uma ação forte por vez: com saldo a receber, o destaque é o Receber.
              pode.pagamento && conta.totais.restante > 0 ? 'bg-white text-status-ready' : 'bg-status-ready text-white'].join(' ')}>
            <Ic d={ICONES_PDV.check} />
            {ocupado ? 'Aguarde…' : 'Fechar conta'}
          </button>
        )}
      </div>
    </div>
  )
}
