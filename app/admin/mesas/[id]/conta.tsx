'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Ban, Printer, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { centavos, dividirPorPessoas, trocoPara, ROTULO_FORMA, type FormaPagamento } from '@/lib/conta'
import type { ContaDaMesa, EventoHistorico } from '@/lib/queries/conta'

/**
 * Conta da mesa: o que foi lançado, o que foi pago, o que falta — e as operações sobre
 * isso. Valores vêm prontos do servidor (`comanda_totais` no banco); esta tela não soma
 * dinheiro, só mostra e pede.
 */

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

type Permissoes = Record<string, boolean>

interface Resposta {
  conta: ContaDaMesa | null
  historico: EventoHistorico[]
  formasPagamento: FormaPagamento[]
  permissoes: Permissoes
}

export interface MesaOpcao {
  id: string
  nome: string
  ativa: boolean
  bloqueada: boolean
}

export function useConta(mesaId: string) {
  const [dados, setDados] = useState<Resposta | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const recarregar = useCallback(async () => {
    const r = await fetch(`/api/admin/mesas/${mesaId}/conta`, { cache: 'no-store' })
    const corpo = await r.json().catch(() => null)
    if (!r.ok) {
      setErro(corpo?.error ?? 'Não foi possível carregar a conta.')
      return
    }
    setErro(null)
    setDados(corpo)
  }, [mesaId])

  useEffect(() => {
    void recarregar()
    // Outro garçom pode receber pagamento ou cancelar item na mesma mesa.
    const t = setInterval(() => void recarregar(), 5000)
    return () => clearInterval(t)
  }, [recarregar])

  const agir = useCallback(
    async (acao: string, corpo: Record<string, unknown> = {}) => {
      const r = await fetch(`/api/admin/mesas/${mesaId}/conta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao, ...corpo }),
      })
      const json = await r.json().catch(() => ({}))
      if (r.ok) await recarregar()
      return { ok: r.ok, status: r.status, ...json } as { ok: boolean; status: number; error?: string; codigo?: string; [k: string]: unknown }
    },
    [mesaId, recarregar],
  )

  return { dados, erro, recarregar, agir }
}

export type EstadoConta = ReturnType<typeof useConta>

export function PainelConta({
  mesaId,
  mesas,
  estado,
  onContaFechada,
}: {
  mesaId: string
  mesas: MesaOpcao[]
  /** Vem da página, que usa a mesma leitura no histórico e na troca de mesa: uma consulta só. */
  estado: EstadoConta
  onContaFechada: () => void
}) {
  const { dados, erro, agir } = estado
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [motivoPara, setMotivoPara] = useState<null | { titulo: string; acao: (motivo: string) => Promise<void> }>(null)
  const [transferindoItens, setTransferindoItens] = useState(false)
  const [confirmarFechar, setConfirmarFechar] = useState(false)
  // Quanto de cada linha selecionada vai na transferência. Chave ausente = linha inteira.
  const [parcelas, setParcelas] = useState<Record<string, number>>({})

  const conta = dados?.conta ?? null
  const podeFazer = (acao: string) => !!dados?.permissoes?.[acao]

  async function executar(acao: string, corpo: Record<string, unknown>, sucesso: string) {
    const r = await agir(acao, corpo)
    setAviso(r.ok ? { tipo: 'ok', texto: sucesso } : { tipo: 'erro', texto: r.error ?? 'Não foi possível concluir.' })
    return r
  }

  if (erro) return <p className="rounded-menuzia border border-danger bg-danger-bg px-4 py-3 text-[13px] text-danger">{erro}</p>
  if (!dados) return <p className="text-[13px] text-text-subtle">Carregando conta…</p>
  if (!conta) {
    return (
      <div className="rounded-menuzia border border-border bg-main px-6 py-10 text-center">
        <p className="text-[14px] font-semibold text-text-main">Esta mesa não tem conta aberta</p>
        <p className="mt-1 text-[12px] text-text-subtle">A conta abre sozinha no primeiro lançamento enviado para a cozinha.</p>
      </div>
    )
  }

  const pessoas = conta.pessoas ?? 0
  const porPessoa = pessoas > 1 ? dividirPorPessoas(conta.totais.restante, pessoas) : []

  // Dividir por ITEM: soma o que foi marcado para cobrar de quem pediu aquilo. É só a
  // organização do pagamento da MESMA comanda — não duplica item nem cria pedido novo.
  const itensMarcados = conta.lancamentos
    .flatMap((l) => l.itens.map((i) => ({ ...i, lancamentoCancelado: l.status === 'cancelado' })))
    .filter((i) => selecionados.has(i.id) && !i.cancelado && !i.lancamentoCancelado)
  const totalMarcado = centavos(
    itensMarcados.reduce((soma, i) => soma + i.precoUnitario * Math.min(parcelas[i.id] ?? i.quantidade, i.quantidade), 0),
  )
  // A taxa de serviço incide sobre o consumo, então a parte de quem paga por item também
  // a carrega — senão a soma das partes nunca fecha o total.
  const totalMarcadoComTaxa = centavos(totalMarcado * (1 + conta.taxaServicoPercentual / 100))

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        {aviso && (
          <p
            className={`rounded-menuzia px-4 py-2.5 text-[13px] ${aviso.tipo === 'ok' ? 'bg-price-bg text-price-text' : 'bg-danger-bg text-danger'}`}
            role={aviso.tipo === 'erro' ? 'alert' : 'status'}
          >
            {aviso.texto}
          </p>
        )}

        {/* ── Dados da mesa ─────────────────────────────────────────────── */}
        <DadosDaMesa conta={conta} podeAjustar={podeFazer('ajustar_mesa')} executar={executar} />

        {/* ── Lançamentos ───────────────────────────────────────────────── */}
        <div className="rounded-menuzia border border-border bg-main">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h3 className="text-[13px] font-bold text-text-main">Lançamentos</h3>
            {podeFazer('transferir_itens') && selecionados.size > 0 && (
              <Button variant="outline" onClick={() => setTransferindoItens(true)}>
                <ArrowRightLeft className="mr-1.5 inline h-3.5 w-3.5" />
                Transferir {selecionados.size} {selecionados.size === 1 ? 'item' : 'itens'}
              </Button>
            )}
          </div>

          {conta.lancamentos.length === 0 && <p className="px-4 py-6 text-center text-[12px] text-text-subtle">Nenhum lançamento.</p>}

          {conta.lancamentos.map((l) => {
            const cancelado = l.status === 'cancelado'
            return (
              <div key={l.id} className={`border-b border-border last:border-0 ${cancelado ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 bg-page px-4 py-2">
                  <span className="text-[12px]">
                    <strong className="text-text-main">#{l.numero}</strong>
                    <span className="ml-2 text-text-subtle">
                      {hora(l.criadoEm)}
                      {l.criadoPorNome ? ` · ${l.criadoPorNome}` : ''}
                    </span>
                    <Badge tone={cancelado ? 'danger' : l.status === 'pronto' ? 'ready' : l.status === 'preparando' ? 'preparing' : 'pending'} className="ml-2">
                      {l.status}
                    </Badge>
                  </span>
                  {!cancelado && (
                    <span className="flex gap-1.5">
                      {podeFazer('reimprimir') && (
                        <Button variant="ghost" className="!px-2 text-[10px]" title="Reimprimir este lançamento"
                          onClick={() => executar('reimprimir', { pedidoId: l.id }, `Reimpressão do #${l.numero} pedida.`)}>
                          <Printer className="mr-1 inline h-3 w-3" />
                          Reimprimir
                        </Button>
                      )}
                      {podeFazer('cancelar_pedido') && (
                        <Button variant="ghost" className="!px-2 text-[10px] text-danger"
                          onClick={() => setMotivoPara({
                            titulo: `Cancelar o lançamento #${l.numero}`,
                            acao: async (motivo) => { await executar('cancelar_pedido', { pedidoId: l.id, motivo }, `Lançamento #${l.numero} cancelado.`) },
                          })}>
                          <Ban className="mr-1 inline h-3 w-3" />
                          Cancelar
                        </Button>
                      )}
                    </span>
                  )}
                </div>

                <ul>
                  {l.itens.map((i) => (
                    <li key={i.id} className={`flex items-start gap-2.5 px-4 py-2 ${i.cancelado ? 'opacity-50' : ''}`}>
                      {podeFazer('transferir_itens') && !i.cancelado && !cancelado ? (
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${i.nome}`}
                          className="mt-1"
                          checked={selecionados.has(i.id)}
                          onChange={(e) => {
                            const prox = new Set(selecionados)
                            if (e.target.checked) prox.add(i.id)
                            else prox.delete(i.id)
                            setSelecionados(prox)
                          }}
                        />
                      ) : (
                        <span className="w-[13px]" />
                      )}
                      <span className="min-w-0 flex-1 text-[13px]">
                        <span className={i.cancelado ? 'line-through' : ''}>
                          <strong>{i.quantidade}×</strong> {i.nome}
                        </span>
                        {i.complementos.length > 0 && <span className="block text-[11px] text-text-subtle">{i.complementos.join(' · ')}</span>}
                        {i.cancelado && (
                          <span className="block text-[11px] text-danger">
                            Cancelado{i.canceladoPor ? ` por ${i.canceladoPor}` : ''}: {i.canceladoMotivo}
                          </span>
                        )}
                      </span>
                      {selecionados.has(i.id) && i.quantidade > 1 && !i.cancelado && !cancelado && (
                        <span className="flex flex-shrink-0 items-center gap-1 rounded-menuzia border border-border px-1">
                          <button
                            className="px-1 text-[14px] text-primary disabled:text-text-subtle"
                            aria-label={`Transferir menos de ${i.nome}`}
                            disabled={(parcelas[i.id] ?? i.quantidade) <= 1}
                            onClick={() =>
                              setParcelas((a) => ({ ...a, [i.id]: Math.max(1, (a[i.id] ?? i.quantidade) - 1) }))
                            }
                          >
                            −
                          </button>
                          <span className="min-w-[26px] text-center text-[11px] font-bold" title="Quantidade a transferir ou cobrar">
                            {parcelas[i.id] ?? i.quantidade}/{i.quantidade}
                          </span>
                          <button
                            className="px-1 text-[14px] text-primary disabled:text-text-subtle"
                            aria-label={`Transferir mais de ${i.nome}`}
                            disabled={(parcelas[i.id] ?? i.quantidade) >= i.quantidade}
                            onClick={() =>
                              setParcelas((a) => ({ ...a, [i.id]: Math.min(i.quantidade, (a[i.id] ?? i.quantidade) + 1) }))
                            }
                          >
                            +
                          </button>
                        </span>
                      )}
                      <span className="text-[12px] font-semibold text-text-main">{brl(i.precoUnitario * i.quantidade)}</span>
                      {podeFazer('cancelar_item') && !i.cancelado && !cancelado && (
                        <button
                          className="text-text-subtle hover:text-danger"
                          title={`Cancelar ${i.nome}`}
                          aria-label={`Cancelar ${i.nome}`}
                          onClick={() => setMotivoPara({
                            titulo: `Cancelar ${i.quantidade}× ${i.nome}`,
                            acao: async (motivo) => { await executar('cancelar_item', { itemId: i.id, motivo }, `${i.nome} cancelado.`) },
                          })}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Lateral: totais, divisão, pagamento, fechamento ─────────────── */}
      <aside className="space-y-4">
        <div className="rounded-menuzia border border-border bg-main p-4">
          <Linha rotulo="Subtotal" valor={brl(conta.totais.subtotal)} />
          <Linha rotulo={`Taxa de serviço (${conta.taxaServicoPercentual.toLocaleString('pt-BR')}%)`} valor={brl(conta.totais.taxaServico)} />
          {conta.totais.desconto > 0 && (
            <Linha rotulo={`Desconto${conta.descontoMotivo ? ` · ${conta.descontoMotivo}` : ''}`} valor={`− ${brl(conta.totais.desconto)}`} />
          )}
          <div className="mt-2 border-t border-border pt-2">
            <Linha rotulo="Total" valor={brl(conta.totais.total)} forte />
            <Linha rotulo="Pago" valor={brl(conta.totais.pago)} />
          </div>
          <div className={`mt-3 rounded-menuzia px-3 py-2.5 ${conta.totais.restante > 0 ? 'bg-warn-bg' : 'bg-price-bg'}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] font-bold uppercase tracking-wide text-text-subtle">Falta pagar</span>
              <span className={`text-[22px] font-bold ${conta.totais.restante > 0 ? 'text-text-main' : 'text-price-text'}`} data-testid="restante">
                {brl(conta.totais.restante)}
              </span>
            </div>
          </div>

          {conta.totais.pago - conta.totais.total > 0.005 && (
            // Acontece quando item é cancelado depois de pago. O sistema não inventa crédito:
            // avisa para estornar o excedente ou devolver ao cliente.
            <p className="mt-2 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger" role="alert">
              Pago a mais: {brl(conta.totais.pago - conta.totais.total)}. Estorne o pagamento ou devolva a diferença.
            </p>
          )}

          {porPessoa.length > 0 && conta.totais.restante > 0 && (
            <div className="mt-3 text-[12px] text-text-subtle">
              <span className="font-semibold text-text-main">Dividir o que falta por {pessoas}:</span>{' '}
              {porPessoa.every((v) => v === porPessoa[0]) ? `${brl(porPessoa[0])} cada` : porPessoa.map(brl).join(' · ')}
            </div>
          )}

          {itensMarcados.length > 0 && conta.totais.restante > 0 && (
            <div className="mt-3 rounded-menuzia bg-alert-bg px-3 py-2 text-[12px] text-alert-text">
              <span className="font-semibold">
                {itensMarcados.length} {itensMarcados.length === 1 ? 'item marcado' : 'itens marcados'}:{' '}
                {brl(totalMarcadoComTaxa)}
              </span>
              <span className="mt-0.5 block text-[11px]">
                Consumo {brl(totalMarcado)}
                {conta.taxaServicoPercentual > 0 ? ` + ${conta.taxaServicoPercentual}% de serviço` : ''}. Use no
                pagamento para cobrar de quem pediu esses itens.
              </span>
            </div>
          )}

          {podeFazer('ajustar_valores') && <AjusteValores conta={conta} executar={executar} />}
        </div>

        {podeFazer('pagamento') && conta.totais.restante > 0 && (
          <FormPagamento
            restante={conta.totais.restante}
            porPessoa={porPessoa[0] ?? null}
            porItens={itensMarcados.length > 0 ? Math.min(totalMarcadoComTaxa, conta.totais.restante) : null}
            formas={dados.formasPagamento}
            executar={executar}
          />
        )}

        <div className="rounded-menuzia border border-border bg-main">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-[13px] font-bold text-text-main">Pagamentos</h3>
          </div>
          {conta.pagamentos.length === 0 && <p className="px-4 py-5 text-center text-[12px] text-text-subtle">Nenhum pagamento ainda.</p>}
          <ul>
            {conta.pagamentos.map((p) => (
              <li key={p.id} className={`flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 last:border-0 ${p.estornado ? 'opacity-60' : ''}`}>
                <span className="text-[12px]">
                  <span className={`font-semibold text-text-main ${p.estornado ? 'line-through' : ''}`}>{ROTULO_FORMA[p.forma]}</span>
                  <span className="block text-[11px] text-text-subtle">
                    {hora(p.criadoEm)} · {p.criadoPorNome}
                    {p.troco > 0 ? ` · recebeu ${brl(p.valorRecebido ?? 0)}, troco ${brl(p.troco)}` : ''}
                  </span>
                  {p.estornado && <span className="block text-[11px] text-danger">Estornado por {p.estornadoPorNome}: {p.estornoMotivo}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-price-text">{brl(p.valor)}</span>
                  {podeFazer('estorno') && !p.estornado && (
                    <button
                      className="text-text-subtle hover:text-danger"
                      title="Estornar"
                      aria-label={`Estornar pagamento de ${brl(p.valor)}`}
                      onClick={() => setMotivoPara({
                        titulo: `Estornar ${ROTULO_FORMA[p.forma]} de ${brl(p.valor)}`,
                        acao: async (motivo) => { await executar('estorno', { pagamentoId: p.id, motivo }, 'Pagamento estornado.') },
                      })}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {podeFazer('fechar') && (
          <Button
            variant="success"
            className="w-full !py-3"
            disabled={conta.totais.restante > 0}
            title={conta.totais.restante > 0 ? 'Registre os pagamentos antes de fechar' : undefined}
            onClick={() => setConfirmarFechar(true)}
          >
            Fechar conta
          </Button>
        )}
        {conta.totais.restante > 0 && podeFazer('fechar') && (
          <p className="text-center text-[11px] text-text-subtle">A conta só fecha quando não falta nada a receber.</p>
        )}

        {podeFazer('cancelar_comanda') && (
          <div className="rounded-menuzia border border-border bg-main p-4">
            <h3 className="text-[13px] font-bold text-text-main">Cancelar a conta</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-text-subtle">
              Para mesa aberta por engano ou cliente que desistiu antes de consumir. Derruba os lançamentos, libera a
              mesa e <strong>fica no histórico</strong> com motivo e autor. Conta que já recebeu dinheiro precisa do
              estorno primeiro.
            </p>
            <Button
              variant="outline"
              className="mt-3 w-full !text-danger"
              onClick={() =>
                setMotivoPara({
                  titulo: 'Cancelar a conta desta mesa',
                  acao: async (motivo) => {
                    const r = await executar('cancelar_comanda', { motivo }, 'Conta cancelada.')
                    if (r.ok) onContaFechada()
                  },
                })
              }
            >
              <Ban className="mr-1.5 inline h-3.5 w-3.5" />
              Cancelar a conta
            </Button>
          </div>
        )}
      </aside>

      {motivoPara && (
        <ModalMotivo
          titulo={motivoPara.titulo}
          onCancelar={() => setMotivoPara(null)}
          onConfirmar={async (motivo) => {
            await motivoPara.acao(motivo)
            setMotivoPara(null)
          }}
        />
      )}

      {transferindoItens && (
        <ModalDestino
          titulo={`Transferir ${selecionados.size} ${selecionados.size === 1 ? 'item' : 'itens'} para`}
          mesas={mesas.filter((m) => m.id !== mesaId)}
          onCancelar={() => setTransferindoItens(false)}
          onConfirmar={async (destinoMesaId) => {
            const itemIds = [...selecionados]
            const quantidadeDaLinha = new Map(itensMarcados.map((i) => [i.id, i.quantidade]))
            const r = await executar(
              'transferir_itens',
              {
                itemIds,
                destinoMesaId,
                // Quantidade por item, na mesma ordem. Stepper não tocado = a linha inteira.
                quantidades: itemIds.map((id) => parcelas[id] ?? quantidadeDaLinha.get(id) ?? 1),
              },
              'Itens transferidos.',
            )
            if (r.ok) {
              setSelecionados(new Set())
              setParcelas({})
            }
            setTransferindoItens(false)
          }}
        />
      )}

      {confirmarFechar && (
        <Confirmacao
          titulo="Fechar a conta?"
          texto={`Total ${brl(conta.totais.total)}, pago ${brl(conta.totais.pago)}. A mesa fica livre e a conta não recebe mais lançamentos.`}
          botao="Fechar conta"
          onCancelar={() => setConfirmarFechar(false)}
          onConfirmar={async () => {
            const r = await executar('fechar', {}, 'Conta fechada.')
            setConfirmarFechar(false)
            if (r.ok) onContaFechada()
          }}
        />
      )}
    </div>
  )
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between py-0.5 ${forte ? 'text-[15px] font-bold text-text-main' : 'text-[13px] text-text-subtle'}`}>
      <span>{rotulo}</span>
      <span>{valor}</span>
    </div>
  )
}

const INPUT = 'h-9 w-full rounded-menuzia border border-border px-2.5 text-[13px] outline-none focus:border-primary'

function DadosDaMesa({
  conta,
  podeAjustar,
  executar,
}: {
  conta: ContaDaMesa
  podeAjustar: boolean
  executar: (acao: string, corpo: Record<string, unknown>, sucesso: string) => Promise<unknown>
}) {
  const [pessoas, setPessoas] = useState(conta.pessoas ? String(conta.pessoas) : '')
  const [obs, setObs] = useState(conta.observacoes ?? '')

  useEffect(() => {
    setPessoas(conta.pessoas ? String(conta.pessoas) : '')
    setObs(conta.observacoes ?? '')
    // Só quando a conta muda de verdade, não a cada releitura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conta.comandaId])

  return (
    <div className="grid gap-3 rounded-menuzia border border-border bg-main p-4 sm:grid-cols-[110px_1fr_auto]">
      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Pessoas</span>
        <input
          value={pessoas}
          inputMode="numeric"
          disabled={!podeAjustar}
          onChange={(e) => setPessoas(e.target.value.replace(/\D/g, '').slice(0, 2))}
          onBlur={() => podeAjustar && executar('ajustar_mesa', { pessoas: pessoas || null }, 'Pessoas atualizadas.')}
          className={INPUT}
          placeholder="—"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Observações</span>
        <input
          value={obs}
          disabled={!podeAjustar}
          onChange={(e) => setObs(e.target.value)}
          onBlur={() => podeAjustar && obs !== (conta.observacoes ?? '') && executar('ajustar_mesa', { observacoes: obs }, 'Observações salvas.')}
          className={INPUT}
          placeholder="Ex.: aniversário, cadeira de bebê…"
        />
      </label>
      <div>
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Responsável</span>
        <div className="flex h-9 items-center gap-2 text-[13px]">
          <span className="text-text-main">{conta.responsavelNome ?? '—'}</span>
          {podeAjustar && (
            <Button variant="outline" className="!px-2 text-[10px]" onClick={() => executar('ajustar_mesa', { assumir: true }, 'Você assumiu a mesa.')}>
              Assumir
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-text-subtle sm:col-span-3">
        Conta aberta às {hora(conta.abertaEm)}.
      </p>
    </div>
  )
}

function AjusteValores({
  conta,
  executar,
}: {
  conta: ContaDaMesa
  executar: (acao: string, corpo: Record<string, unknown>, sucesso: string) => Promise<unknown>
}) {
  const [aberto, setAberto] = useState(false)
  const [taxa, setTaxa] = useState(String(conta.taxaServicoPercentual))
  const [desconto, setDesconto] = useState(conta.descontoValor ? String(conta.descontoValor) : '')
  const [motivo, setMotivo] = useState(conta.descontoMotivo ?? '')

  if (!aberto) {
    return (
      <button className="mt-3 text-[11px] font-semibold text-primary underline" onClick={() => setAberto(true)}>
        Ajustar taxa de serviço ou desconto
      </button>
    )
  }
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px] text-text-subtle">
          Taxa de serviço (%)
          <input value={taxa} inputMode="decimal" onChange={(e) => setTaxa(e.target.value.replace(',', '.'))} className={INPUT} />
        </label>
        <label className="block text-[11px] text-text-subtle">
          Desconto (R$)
          <input value={desconto} inputMode="decimal" onChange={(e) => setDesconto(e.target.value.replace(',', '.'))} className={INPUT} placeholder="0,00" />
        </label>
      </div>
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className={INPUT} placeholder="Motivo do desconto (obrigatório se houver)" />
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => setAberto(false)}>Cancelar</Button>
        <Button
          className="flex-1"
          onClick={async () => {
            await executar('ajustar_valores', { taxaServico: Number(taxa || 0), desconto: Number(desconto || 0), descontoMotivo: motivo }, 'Valores ajustados.')
            setAberto(false)
          }}
        >
          Aplicar
        </Button>
      </div>
    </div>
  )
}

function FormPagamento({
  restante,
  porPessoa,
  porItens,
  formas,
  executar,
}: {
  restante: number
  porPessoa: number | null
  /** Soma dos itens marcados na lista, quando o pagamento é dividido por item. */
  porItens: number | null
  formas: FormaPagamento[]
  executar: (acao: string, corpo: Record<string, unknown>, sucesso: string) => Promise<{ ok: boolean } & Record<string, unknown>>
}) {
  const [forma, setForma] = useState<FormaPagamento>(formas[0] ?? 'dinheiro')
  const [valor, setValor] = useState('')
  const [recebido, setRecebido] = useState('')
  const [enviando, setEnviando] = useState(false)
  // Uma chave por pagamento em montagem: clique duplo registra UM pagamento só.
  const [chave, setChave] = useState(() => crypto.randomUUID())

  const valorNum = Number((valor || '0').replace(',', '.'))
  const recebidoNum = Number((recebido || '0').replace(',', '.'))
  const troco = useMemo(() => (forma === 'dinheiro' && recebido ? trocoPara(valorNum, recebidoNum) : 0), [forma, recebido, valorNum, recebidoNum])

  return (
    <div className="space-y-3 rounded-menuzia border border-border bg-main p-4">
      <h3 className="text-[13px] font-bold text-text-main">Receber pagamento</h3>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Forma de pagamento">
        {formas.map((f) => (
          <button
            key={f}
            role="radio"
            aria-checked={forma === f}
            onClick={() => setForma(f)}
            className={`rounded-menuzia border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide ${forma === f ? 'border-primary bg-primary text-white' : 'border-border bg-main text-text-subtle'}`}
          >
            {ROTULO_FORMA[f]}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Valor</span>
        <input value={valor} inputMode="decimal" onChange={(e) => setValor(e.target.value)} className={INPUT} placeholder="0,00" aria-label="Valor do pagamento" />
      </label>
      <div className="flex flex-wrap gap-1.5">
        <button className="rounded-menuzia border border-border px-2 py-1 text-[11px]" onClick={() => setValor(restante.toFixed(2))}>
          Tudo ({brl(restante)})
        </button>
        {porPessoa && (
          <button className="rounded-menuzia border border-border px-2 py-1 text-[11px]" onClick={() => setValor(porPessoa.toFixed(2))}>
            1 pessoa ({brl(porPessoa)})
          </button>
        )}
        {porItens !== null && porItens > 0 && (
          <button
            className="rounded-menuzia border border-primary px-2 py-1 text-[11px] font-semibold text-primary"
            onClick={() => setValor(porItens.toFixed(2))}
          >
            Itens marcados ({brl(porItens)})
          </button>
        )}
      </div>

      {forma === 'dinheiro' && (
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Recebido em dinheiro</span>
          <input value={recebido} inputMode="decimal" onChange={(e) => setRecebido(e.target.value)} className={INPUT} placeholder="Opcional, para calcular o troco" aria-label="Valor recebido" />
          {troco > 0 && <span className="mt-1 block text-[13px] font-bold text-price-text">Troco: {brl(troco)}</span>}
        </label>
      )}

      <Button
        className="w-full"
        disabled={enviando || !(valorNum > 0)}
        onClick={async () => {
          setEnviando(true)
          const r = await executar(
            'pagamento',
            { forma, valor: valorNum, recebido: forma === 'dinheiro' && recebido ? recebidoNum : null, chave },
            'Pagamento registrado.',
          )
          setEnviando(false)
          if (r.ok) {
            setValor('')
            setRecebido('')
            setChave(crypto.randomUUID())
          }
        }}
      >
        {enviando ? 'Registrando…' : 'Registrar pagamento'}
      </Button>
      <p className="text-[11px] text-text-subtle">É o registro do que foi recebido — não passa cartão nem gera cobrança.</p>
    </div>
  )
}

export function ModalMotivo({
  titulo,
  onCancelar,
  onConfirmar,
}: {
  titulo: string
  onCancelar: () => void
  onConfirmar: (motivo: string) => Promise<void>
}) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onCancelar}>
      <div className="w-full max-w-sm rounded-menuzia bg-main p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}>
        <h2 className="text-[15px] font-bold text-text-main">{titulo}</h2>
        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Motivo (obrigatório)</span>
          <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} className={INPUT} placeholder="Ex.: cliente desistiu" />
        </label>
        <p className="mt-2 text-[11px] text-text-subtle">Nada é apagado: fica registrado com o motivo e o seu nome.</p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={enviando}>Voltar</Button>
          <Button
            className="flex-1"
            disabled={!motivo.trim() || enviando}
            onClick={async () => {
              setEnviando(true)
              await onConfirmar(motivo.trim())
              setEnviando(false)
            }}
          >
            Confirmar
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ModalDestino({
  titulo,
  mesas,
  onCancelar,
  onConfirmar,
}: {
  titulo: string
  mesas: MesaOpcao[]
  onCancelar: () => void
  onConfirmar: (destinoMesaId: string) => Promise<void>
}) {
  const disponiveis = mesas.filter((m) => m.ativa && !m.bloqueada)
  const [destino, setDestino] = useState(disponiveis[0]?.id ?? '')
  const [enviando, setEnviando] = useState(false)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onCancelar}>
      <div className="w-full max-w-sm rounded-menuzia bg-main p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}>
        <h2 className="text-[15px] font-bold text-text-main">{titulo}</h2>
        <select value={destino} onChange={(e) => setDestino(e.target.value)} className={`${INPUT} mt-3`} aria-label="Mesa de destino">
          {disponiveis.map((m) => (
            <option key={m.id} value={m.id}>{m.nome}</option>
          ))}
        </select>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={enviando}>Voltar</Button>
          <Button
            className="flex-1"
            disabled={!destino || enviando}
            onClick={async () => {
              setEnviando(true)
              await onConfirmar(destino)
              setEnviando(false)
            }}
          >
            Transferir
          </Button>
        </div>
      </div>
    </div>
  )
}

export function Confirmacao({
  titulo,
  texto,
  botao,
  perigo,
  onCancelar,
  onConfirmar,
}: {
  titulo: string
  texto: string
  botao: string
  perigo?: boolean
  onCancelar: () => void
  onConfirmar: () => Promise<void>
}) {
  const [enviando, setEnviando] = useState(false)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onCancelar}>
      <div className="w-full max-w-sm rounded-menuzia bg-main p-5" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-label={titulo}>
        <h2 className="text-[15px] font-bold text-text-main">{titulo}</h2>
        <p className="mt-2 text-[13px] text-text-subtle">{texto}</p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onCancelar} disabled={enviando}>Voltar</Button>
          <Button
            variant={perigo ? 'primary' : 'success'}
            className="flex-1"
            disabled={enviando}
            onClick={async () => {
              setEnviando(true)
              await onConfirmar()
              setEnviando(false)
            }}
          >
            {botao}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function Historico({ eventos }: { eventos: EventoHistorico[] }) {
  if (eventos.length === 0) return <p className="text-[13px] text-text-subtle">Nada registrado ainda nesta conta.</p>
  return (
    <ol className="rounded-menuzia border border-border bg-main">
      {eventos.map((e, i) => (
        <li key={i} className="flex gap-3 border-b border-border px-4 py-2.5 last:border-0">
          <span className="w-12 flex-shrink-0 text-[12px] font-semibold text-text-subtle">{hora(e.quando)}</span>
          <span className="text-[13px] text-text-main">
            {e.oQue}
            <span className="block text-[11px] text-text-subtle">{e.quem}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
