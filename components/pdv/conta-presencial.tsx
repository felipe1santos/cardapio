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
import { IdentificarModal } from './atendimento'

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
  | { tipo: 'fechar' }
  | { tipo: 'identificar'; aviso?: string }

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
}: {
  supabase: SupabaseClient
  comandaId: string
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
      setSub({ tipo: 'identificar', aviso: 'Esta conta foi aberta sem o nome do cliente. Informe o nome antes de fechar.' })
      return
    }
    setSub({ tipo: 'fechar' })
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-menuzia bg-white shadow-xl">
        {/* Cabeçalho */}
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
            {conta && aberta && pode?.identificar && (
              <button type="button" onClick={() => setSub({ tipo: 'identificar' })} data-testid="conta-identificar" className="rounded-menuzia border border-border px-3 py-2 text-[12px] font-semibold text-text-main hover:border-primary hover:text-primary">
                Cliente
              </button>
            )}
            {conta && (
              <button type="button" onClick={() => setSub({ tipo: 'historico' })} className="rounded-menuzia border border-border px-3 py-2 text-[12px] font-semibold text-text-main hover:border-primary hover:text-primary">
                Histórico
              </button>
            )}
            <button type="button" onClick={onFechar} aria-label="Fechar" className="flex h-10 w-10 items-center justify-center rounded-menuzia bg-page text-text-subtle hover:bg-border hover:text-text-main">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Dimensões */}
        {conta && dim && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border bg-page/50 px-4 py-2 text-[12px]" data-testid="conta-dimensoes">
            <span><span className="text-text-subtle">Cozinha:</span> <strong className="text-text-main">{dim.texto.cozinha}</strong></span>
            <span><span className="text-text-subtle">Atendimento:</span> <strong className="text-text-main">{dim.texto.atendimento}</strong></span>
            <span className="flex items-center gap-1.5">
              <span className="text-text-subtle">Financeiro:</span>
              <Badge tone={conta.situacao === 'pago' ? 'ok' : conta.situacao === 'parcial' ? 'alert' : conta.situacao === 'estornado' ? 'danger' : 'pending'}>
                {ROTULO_FINANCEIRO[conta.situacao]}
              </Badge>
            </span>
          </div>
        )}

        {aviso && (
          <p
            role="status"
            className={['mx-4 mt-3 rounded-menuzia px-3 py-2 text-[12px] font-semibold', aviso.tom === 'ok' ? 'bg-price-bg text-price-text' : 'bg-danger-bg text-danger'].join(' ')}
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
            <div className="flex flex-shrink-0 flex-col gap-3 border-t border-border bg-page/60 px-4 py-3 lg:w-[300px] lg:border-l lg:border-t-0">
              <div className="rounded-menuzia border border-border bg-white px-3 py-3 text-[13px]" data-testid="conta-totais">
                <Linha rotulo="Subtotal" valor={conta.totais.subtotal} />
                {(conta.totais.taxaServico > 0 || conta.tipo === 'mesa') && <Linha rotulo={`Taxa de serviço (${conta.taxaServicoPercentual}%)`} valor={conta.totais.taxaServico} />}
                {/* Valor cobrado agora: sem item ativo (tudo cancelado) a taxa não entra no total (0099). */}
                {conta.entrega && (
                  <Linha
                    rotulo={conta.entrega.taxa > 0 && conta.totais.taxaEntrega === 0 ? 'Taxa de entrega (não cobrada: sem item ativo)' : `Taxa de entrega${conta.entrega.taxaManual ? ' (manual)' : ''}`}
                    valor={conta.totais.taxaEntrega}
                  />
                )}
                {conta.totais.desconto > 0 && <Linha rotulo={conta.cupomCodigo ? `Desconto (cupom ${conta.cupomCodigo})` : 'Desconto'} valor={-conta.totais.desconto} />}
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

              {aberta ? (
                <>
                  {pode.lancar && (
                    <button type="button" disabled={ocupado} onClick={() => onLancarItens(conta)} data-testid="conta-lancar" className="w-full rounded-menuzia border-2 border-primary bg-white py-3.5 text-[14px] font-bold text-primary transition-all hover:bg-primary hover:text-white disabled:opacity-50">
                      + Lançar itens
                    </button>
                  )}
                  {pode.pre_conta && !conta.entrega && <PreContaBloco comandaId={conta.id} />}
                  {pode.pagamento && conta.totais.restante > 0 && (
                    <button type="button" disabled={ocupado} onClick={() => setSub({ tipo: 'receber' })} data-testid="conta-receber" className="w-full rounded-menuzia bg-primary py-3.5 text-[14px] font-bold text-white transition-all hover:bg-primary-dark disabled:opacity-50">
                      Receber
                    </button>
                  )}
                  {pode.fechar && (
                    <button type="button" disabled={ocupado} onClick={() => void fechar()} data-testid="conta-fechar" className="w-full rounded-menuzia bg-status-ready py-3.5 text-[14px] font-bold text-white transition-all hover:brightness-95 disabled:opacity-50">
                      {ocupado ? 'Aguarde…' : 'Fechar conta'}
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void abrirPendencias()} className="flex-1 rounded-menuzia border border-border bg-white py-2 text-[12px] font-semibold text-text-main hover:border-primary hover:text-primary">
                      Pendências
                    </button>
                    {pode.ajustar_valores && (
                      <button type="button" onClick={() => setSub({ tipo: 'ajustar' })} className="flex-1 rounded-menuzia border border-border bg-white py-2 text-[12px] font-semibold text-text-main hover:border-primary hover:text-primary">
                        Desconto/taxa
                      </button>
                    )}
                  </div>
                </>
              ) : (
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
        )}
      </div>

      {conta && dados && sub?.tipo === 'receber' && (
        <ReceberModal
          conta={conta}
          formas={dados.formasPagamento}
          podeFechar={Boolean(pode?.fechar)}
          onCancelar={() => setSub(null)}
          onRegistrar={async (corpo, fecharDepois) => {
            const r = await agir({ acao: 'pagamento', ...corpo }, 'Pagamento registrado.')
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
          onVoltar={() => {
            setSub(null)
            void carregar()
          }}
          onFechada={(emLimpeza) => {
            setSub(null)
            setAviso({ tom: 'ok', texto: emLimpeza ? 'Conta fechada. Mesa em limpeza.' : 'Conta fechada.' })
            onEncerrada?.()
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
            setSub(null)
            setAviso({ tom: 'ok', texto: `Cliente: ${nome}.` })
            void carregar()
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
    </div>
  )
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: number; forte?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
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
          <li key={i.id} className={['text-[13px]', i.cancelado ? 'text-text-subtle line-through' : 'text-text-main'].join(' ')}>
            <span className="font-semibold">{i.quantidade}×</span> {i.nome}
            {(i.detalhe || i.complementos.length > 0) && (
              <span className="text-[12px] text-text-subtle"> — {[i.detalhe, ...i.complementos].filter(Boolean).join(', ')}</span>
            )}
            {i.observacao && <span className="block text-[12px] italic text-text-subtle">“{i.observacao}”</span>}
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

function Moldura({ titulo, children, onVoltar, largura = 'max-w-lg' }: { titulo: string; children: React.ReactNode; onVoltar: () => void; largura?: string }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className={`flex max-h-[94vh] w-full ${largura} flex-col overflow-hidden rounded-menuzia bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-[15px] font-bold text-text-main">{titulo}</h3>
          <button type="button" onClick={onVoltar} aria-label="Fechar" className="rounded p-1 text-text-subtle hover:bg-page hover:text-text-main">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ReceberModal({
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
    if (v > conta.totais.restante + 0.001) return setErro(`O valor passa do que falta pagar (${formatBRL(conta.totais.restante)}).`)
    if (forma === 'dinheiro' && recebido && (!Number.isFinite(rec) || rec < v)) return setErro('O valor recebido é menor que o valor a pagar.')
    if (forma === 'fiado' && !obs.trim()) return setErro('No fiado, informe de quem é a conta.')
    setEnviando(true)
    setErro(null)
    const ok = await onRegistrar(
      { forma, valor: v, recebido: forma === 'dinheiro' && recebido ? rec : null, chave: chave.current, observacao: obs.trim() || null },
      fecharDepois,
    )
    setEnviando(false)
    if (!ok) chave.current = novaChave()
  }

  return (
    <Moldura titulo={`Receber · ${conta.tipo === 'balcao' ? `Senha ${conta.senha} · ${conta.clienteNome}` : conta.mesaNome}`} onVoltar={onCancelar}>
      <div className="space-y-3 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between rounded-menuzia bg-page px-3 py-2">
          <span className="text-[13px] font-semibold text-text-subtle">Restante</span>
          <span className="text-[20px] font-extrabold text-text-main">{formatBRL(conta.totais.restante)}</span>
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Forma</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {formas.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setForma(f)}
                data-testid={`forma-${f}`}
                className={['rounded-menuzia border-2 px-3 py-3 text-[14px] font-bold transition-colors', forma === f ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-main hover:border-primary'].join(' ')}
              >
                {ROTULO_FORMA[f as FormaPagamento] ?? f}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Valor a pagar (máx. {formatBRL(conta.totais.restante)})</span>
          <input value={valor} inputMode="decimal" onChange={(e) => setValor(e.target.value)} data-testid="receber-valor" className="w-full rounded-menuzia border border-border px-3 py-2.5 text-[16px] font-bold text-text-main focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
        </label>
        {forma === 'dinheiro' && (
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Recebido</span>
            <input value={recebido} inputMode="decimal" onChange={(e) => setRecebido(e.target.value)} placeholder="Ex.: 100,00" data-testid="receber-recebido" className="w-full rounded-menuzia border border-border px-3 py-2.5 text-[16px] font-bold text-text-main placeholder:font-normal focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
            <span className="mt-1 flex justify-between text-[13px]">
              <span className="text-text-subtle">Troco</span>
              <strong className="text-price-text" data-testid="receber-troco">{formatBRL(troco)}</strong>
            </span>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Observação {forma === 'fiado' && <span className="text-danger">*</span>}</span>
          <input value={obs} maxLength={200} onChange={(e) => setObs(e.target.value)} className="w-full rounded-menuzia border border-border px-3 py-2 text-[13px] text-text-main focus:border-primary focus:outline-none" />
        </label>
        {conta.pagamentos.filter((p) => !p.estornado).length > 0 && (
          <p className="text-[12px] text-text-subtle">
            Já pago: {conta.pagamentos.filter((p) => !p.estornado).map((p) => `${ROTULO_FORMA[p.forma] ?? p.forma} ${formatBRL(p.valor)}`).join(' · ')}
          </p>
        )}
        <p className="text-[11px] text-text-subtle">Valor, troco e saldo são recalculados no servidor; a tela só antecipa.</p>
        {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>}
      </div>
      <div className="space-y-2 border-t border-border px-4 py-3">
        <button type="button" disabled={enviando} onClick={() => void registrar(false)} data-testid="receber-registrar" className="w-full rounded-menuzia bg-primary py-3.5 text-[14px] font-bold text-white hover:bg-primary-dark disabled:opacity-50">
          {enviando ? 'Registrando…' : 'Registrar pagamento'}
        </button>
        {podeFechar && (
          <button type="button" disabled={enviando} onClick={() => void registrar(true)} data-testid="receber-registrar-fechar" className="w-full rounded-menuzia bg-status-ready py-3.5 text-[14px] font-bold text-white hover:brightness-95 disabled:opacity-50">
            Registrar e fechar conta
          </button>
        )}
      </div>
    </Moldura>
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
          Voltar sem fechar
        </button>
        {Number(dados.financeiro.restante) > 0 && pode.pagamento && (
          <button type="button" onClick={onReceber} className="rounded-menuzia bg-primary px-4 py-2.5 text-[13px] font-bold text-white">
            Receber restante
          </button>
        )}
        {pode.resolver && dados.pedidos.length > 0 && (
          <button type="button" onClick={onResolver} data-testid="pendencias-resolver" className="ml-auto rounded-menuzia border-2 border-warn px-4 py-2.5 text-[13px] font-bold text-warn hover:bg-warn hover:text-white">
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
        <button type="button" onClick={onVoltar} className="rounded-menuzia border border-border px-4 py-2.5 text-[13px] font-semibold">Voltar</button>
        <button type="button" disabled={!podeAplicar || ocupado} onClick={() => void aplicar(false)} className="ml-auto rounded-menuzia border-2 border-primary px-4 py-2.5 text-[13px] font-bold text-primary disabled:opacity-40">
          Aplicar
        </button>
        <button type="button" disabled={!podeAplicar || ocupado} onClick={() => void aplicar(true)} data-testid="resolver-aplicar-fechar" className="rounded-menuzia bg-status-ready px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-40">
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
        <button type="button" onClick={onVoltar} className="flex-1 rounded-menuzia border border-border py-2.5 text-[13px] font-semibold">Voltar</button>
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
    <Moldura titulo={titulo} onVoltar={onVoltar}>
      <div className="space-y-3 px-4 py-4">
        <p className="text-[13px] text-text-main">{descricao}</p>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Motivo <span className="text-danger">*</span></span>
          <input autoFocus value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} data-testid="motivo" className="w-full rounded-menuzia border border-border px-3 py-2 text-[13px] focus:border-primary focus:outline-none" />
        </label>
        {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>}
      </div>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button type="button" onClick={onVoltar} className="flex-1 rounded-menuzia border border-border py-2.5 text-[13px] font-semibold">Voltar</button>
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
    <Moldura titulo="Desconto e taxa de serviço" onVoltar={onVoltar}>
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
        <button type="button" onClick={onVoltar} className="flex-1 rounded-menuzia border border-border py-2.5 text-[13px] font-semibold">Voltar</button>
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
  pendente: 'Pendente',
  reservado: 'Enviando…',
  enviado_spooler: 'Aceito pela fila do Windows',
  falhou: 'Falha ao enviar',
  expirado: 'Expirado (não impresso)',
  cancelado: 'Cancelado',
}

/**
 * Recibo/Extrato (a "pré-conta"): documento não fiscal para o cliente conferir a conta.
 * Manual, só por este botão.
 * Não mexe na conta — nem pedido, nem pagamento, nem atendimento, nem cozinha. O
 * servidor monta tudo; a tela manda só a chave. Mostra a última via e o estado real
 * ("aceito pela fila do Windows" não quer dizer papel na mão).
 */
function PreContaBloco({ comandaId }: { comandaId: string }) {
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
  useEffect(() => {
    if (!andando) return
    const t = setInterval(() => void carregar(), 2000)
    return () => clearInterval(t)
  }, [andando, carregar])

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
      setErro({ texto: r.erro ?? 'Não foi possível enviar o Recibo/Extrato.', semCaixa: r.codigo === 'impressora_caixa_nao_configurada' })
      return
    }
    await carregar()
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
          {andando && !ultima.computadorOnline && <span className="block text-danger">O computador desta impressora está offline. O Recibo/Extrato vence em 10 min.</span>}
          {ultima.erro && ultima.estado !== 'enviado_spooler' && <span className="block text-danger">{ultima.erro}</span>}
        </p>
      )}
      {erro && (
        <p className="mt-1.5 text-[11px] font-semibold text-danger" data-testid="pre-conta-erro">
          {erro.texto}
          {erro.semCaixa && (
            <a href="/admin/impressao" className="ml-1 underline">
              menu Impressão
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
