'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ROTULO_FORMA, type FormaPagamento } from '@/lib/conta'
import { ROTULO_PENDENCIA, type CategoriaPendencia } from '@/lib/pdv-v2'
import type { ContaPresencial } from '@/lib/servicos/conta-presencial'
import { chamar, formatBRL, horaCurta, lerValor, novaChave } from './util'

/**
 * "Fechar conta" (0096): uma tela, quatro passos, e UMA ida ao servidor no fim.
 *
 *  1. Cozinha: cada pedido pendente precisa de decisão explícita — "Marcar como
 *     entregue" ou "Cancelar" (motivo obrigatório). Nada é decidido por omissão.
 *  2. Conta recalculada PELO BANCO com essas decisões (simulação desfeita no servidor).
 *  3. Pagamentos do saldo, em uma ou mais formas da loja.
 *  4. Fechar: decisões + pagamentos + fechamento numa transação — tudo ou nada, com
 *     chave própria (clique duplo, duas abas e dois operadores não duplicam nada).
 */

interface PedidoPendente {
  id: string
  numero: number
  categoria: CategoriaPendencia
  status: string
  criado_em: string
  total: number
  criado_por_nome: string | null
  itens: { id?: string; nome: string; quantidade: number; valor?: number }[]
}

interface Simulacao {
  subtotal: number
  taxa: number
  desconto: number
  total: number
  pago: number
  restante: number
  cancelados: number
  excedente: number
  taxa_entrega: number
}

type Decisao = { acao: 'entregue' | 'cancelar' | null; motivo: string }
type LinhaPag = { forma: string; valor: string; recebido: string; chave: string }

const novaLinha = (forma: string, valor = ''): LinhaPag => ({ forma, valor, recebido: '', chave: novaChave() })

export function FecharContaModal({
  conta,
  formas,
  podeForcar,
  podePagar,
  onVoltar,
  onFechada,
}: {
  conta: ContaPresencial
  formas: string[]
  /** comanda.resolver_forcado: cancelar, ou dar como entregue o que não está pronto. */
  podeForcar: boolean
  podePagar: boolean
  onVoltar: () => void
  onFechada: (emLimpeza: boolean) => void
}) {
  const [pendentes, setPendentes] = useState<PedidoPendente[] | null>(null)
  const [cancelamentosPendentes, setCancelamentosPendentes] = useState(0)
  const [decisoes, setDecisoes] = useState<Record<string, Decisao>>({})
  const [sim, setSim] = useState<Simulacao | null>(null)
  const [pags, setPags] = useState<LinhaPag[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // Uma chave por intenção de fechar esta conta: reenvio devolve o mesmo fechamento.
  const chave = useRef(novaChave())

  // Pendências frescas do banco ao abrir.
  useEffect(() => {
    void (async () => {
      const r = await chamar<{ resultado: { pedidos: PedidoPendente[]; cancelamentos: unknown[] } }>(`/api/admin/comandas/${conta.id}`, {
        method: 'POST',
        body: JSON.stringify({ acao: 'pendencias' }),
      })
      if (!r.ok || !r.dados) return setErro(r.erro)
      setPendentes(r.dados.resultado.pedidos)
      setCancelamentosPendentes(r.dados.resultado.cancelamentos.length)
    })()
  }, [conta.id])

  const acoes = useMemo(
    () =>
      (pendentes ?? [])
        .filter((p) => decisoes[p.id]?.acao)
        .map((p) => {
          const d = decisoes[p.id]!
          return d.acao === 'cancelar' ? { pedido_id: p.id, acao: 'cancelar' as const, motivo: d.motivo } : { pedido_id: p.id, acao: 'entregue' as const }
        }),
    [pendentes, decisoes],
  )
  const todasDecididas = (pendentes ?? []).every((p) => {
    const d = decisoes[p.id]
    return d?.acao === 'entregue' || (d?.acao === 'cancelar' && d.motivo.trim().length >= 5)
  })

  // Recalcula no servidor sempre que as decisões ficam completas.
  const chaveSim = JSON.stringify(acoes)
  useEffect(() => {
    if (!pendentes || !todasDecididas) {
      setSim(null)
      return
    }
    let vivo = true
    void (async () => {
      const r = await chamar<{ resultado: Simulacao }>(`/api/admin/comandas/${conta.id}`, {
        method: 'POST',
        body: JSON.stringify({ acao: 'simular_fechamento', acoes }),
      })
      if (!vivo) return
      if (!r.ok || !r.dados) return setErro(r.erro)
      setErro(null)
      const s = r.dados.resultado
      setSim(s)
      setPags((atual) => (atual.length === 0 && s.restante > 0 ? [novaLinha(formas[0] ?? 'dinheiro', s.restante.toFixed(2).replace('.', ','))] : atual))
    })()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveSim, todasDecididas, pendentes, conta.id])

  const somaPags = pags.reduce((s, p) => s + (Number.isFinite(lerValor(p.valor)) ? lerValor(p.valor) : 0), 0)
  const falta = sim ? Math.round((sim.restante - somaPags) * 100) / 100 : 0
  const excede = sim ? somaPags - sim.restante > 0.004 : false
  const pronto = !!sim && todasDecididas && sim.excedente <= 0 && Math.abs(falta) < 0.005 && !excede && cancelamentosPendentes === 0

  function decidir(id: string, acao: 'entregue' | 'cancelar') {
    setDecisoes((d) => ({ ...d, [id]: { acao, motivo: d[id]?.motivo ?? '' } }))
  }

  async function fechar() {
    if (enviando || !pronto) return
    setEnviando(true)
    setErro(null)
    const r = await chamar<{ resultado: { em_limpeza?: boolean } }>(`/api/admin/comandas/${conta.id}`, {
      method: 'POST',
      body: JSON.stringify({
        acao: 'fechar_completo',
        chave: chave.current,
        acoes,
        pagamentos: pags
          .filter((p) => lerValor(p.valor) > 0)
          .map((p) => ({
            forma: p.forma,
            valor: lerValor(p.valor),
            recebido: p.forma === 'dinheiro' && p.recebido.trim() ? lerValor(p.recebido) : null,
            chave: p.chave,
          })),
      }),
    })
    setEnviando(false)
    if (!r.ok) {
      setErro(r.codigo === 'comanda_nao_aberta' ? 'Esta conta já foi fechada (outra tela ou outro operador).' : r.erro)
      return
    }
    onFechada(Boolean(r.dados?.resultado?.em_limpeza))
  }

  const semDecisaoPossivel = (p: PedidoPendente) => !podeForcar && p.status !== 'pronto'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Fechar conta">
      <div className="flex max-h-[96vh] w-full max-w-2xl flex-col overflow-hidden rounded-menuzia bg-white shadow-xl" data-testid="fechar-modal">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[15px] font-bold text-text-main">Fechar conta</h2>
          <button type="button" onClick={onVoltar} className="rounded p-1 text-text-subtle hover:bg-page hover:text-text-main" aria-label="Voltar">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {pendentes === null && !erro && <p className="text-center text-[13px] text-text-subtle">Conferindo a cozinha…</p>}

          {cancelamentosPendentes > 0 && (
            <p className="rounded-menuzia bg-warn-bg px-3 py-2 text-[12px] font-semibold text-text-main">
              Há pedido de cancelamento aguardando decisão da gestão. Aprove ou recuse na conta antes de fechar.
            </p>
          )}

          {pendentes && pendentes.length > 0 && (
            <section>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">1. Pedidos ainda na cozinha — decida cada um</p>
              <ul className="space-y-2">
                {pendentes.map((p) => {
                  const d = decisoes[p.id]
                  const bloqueado = semDecisaoPossivel(p)
                  return (
                    <li key={p.id} className="rounded-menuzia border border-border p-3" data-testid={`fechar-pendencia-${p.numero}`}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[14px] font-bold text-text-main">#{p.numero}</span>
                        <span className="rounded-menuzia bg-warn-bg px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-text-main">
                          {ROTULO_PENDENCIA[p.categoria] ?? p.status}
                        </span>
                        <span className="text-[13px] font-semibold text-text-main">{formatBRL(Number(p.total))}</span>
                      </div>
                      <p className="mt-1 text-[12px] text-text-subtle">
                        {horaCurta(p.criado_em)}
                        {p.criado_por_nome ? ` · lançado por ${p.criado_por_nome}` : ''}
                      </p>
                      <ul className="mt-1 text-[12px] text-text-main">
                        {p.itens.map((i, k) => (
                          <li key={i.id ?? k}>
                            {i.quantidade}× {i.nome}
                            {i.valor !== undefined ? <span className="text-text-subtle"> · {formatBRL(Number(i.valor))}</span> : null}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={bloqueado}
                          onClick={() => decidir(p.id, 'entregue')}
                          data-testid={`fechar-pendencia-${p.numero}-entregue`}
                          className={[
                            'flex-1 rounded-menuzia border py-2 text-[12px] font-bold disabled:opacity-40',
                            d?.acao === 'entregue' ? 'border-status-ready bg-status-ready text-white' : 'border-border bg-white text-text-main',
                          ].join(' ')}
                        >
                          Marcar como entregue
                        </button>
                        <button
                          type="button"
                          disabled={!podeForcar}
                          onClick={() => decidir(p.id, 'cancelar')}
                          data-testid={`fechar-pendencia-${p.numero}-cancelar`}
                          className={[
                            'flex-1 rounded-menuzia border py-2 text-[12px] font-bold disabled:opacity-40',
                            d?.acao === 'cancelar' ? 'border-danger bg-danger text-white' : 'border-border bg-white text-text-main',
                          ].join(' ')}
                        >
                          Cancelar
                        </button>
                      </div>
                      {d?.acao === 'cancelar' && (
                        <input
                          value={d.motivo}
                          onChange={(e) => setDecisoes((x) => ({ ...x, [p.id]: { acao: 'cancelar', motivo: e.target.value } }))}
                          placeholder="Motivo do cancelamento (obrigatório)"
                          maxLength={300}
                          data-testid={`fechar-motivo-${p.numero}`}
                          className="mt-2 w-full rounded-menuzia border border-border px-3 py-2 text-[13px] focus:border-primary focus:outline-none"
                        />
                      )}
                      {bloqueado && (
                        <p className="mt-1.5 text-[11px] text-text-subtle">Pedido ainda não está pronto: decisão da gerência.</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {sim && (
            <section className="rounded-menuzia border border-border px-3 py-3 text-[13px]" data-testid="fechar-simulacao">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                {pendentes && pendentes.length > 0 ? '2. Conta com as decisões' : 'Conta'}
              </p>
              <Linha rotulo="Subtotal" valor={sim.subtotal} />
              {sim.cancelados > 0 && <Linha rotulo="Itens cancelados (não cobrados)" valor={sim.cancelados} fraco />}
              {sim.taxa > 0 && <Linha rotulo={`Taxa de serviço (${conta.taxaServicoPercentual}%)`} valor={sim.taxa} />}
              {Number(sim.taxa_entrega) > 0 && <Linha rotulo="Taxa de entrega" valor={Number(sim.taxa_entrega)} />}
              {sim.desconto > 0 && <Linha rotulo={conta.cupomCodigo ? `Desconto (cupom ${conta.cupomCodigo})` : 'Desconto'} valor={-sim.desconto} />}
              <div className="my-1.5 border-t border-border" />
              <Linha rotulo="Total" valor={sim.total} forte />
              <Linha rotulo="Já pago" valor={sim.pago} />
              <Linha rotulo="Saldo" valor={sim.restante} forte testid="fechar-restante" />
              {sim.excedente > 0 && (
                <p className="mt-2 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger" data-testid="fechar-excedente">
                  Com esses cancelamentos a conta já recebeu {formatBRL(sim.excedente)} a mais do que vale. Estorne um pagamento (na conta) antes de fechar.
                </p>
              )}
            </section>
          )}

          {sim && sim.restante > 0 && sim.excedente <= 0 && (
            <section>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">3. Pagamento do saldo</p>
              {!podePagar && <p className="text-[12px] text-text-subtle">Sem permissão para receber pagamentos.</p>}
              {podePagar && (
                <div className="space-y-2">
                  {pags.map((p, i) => (
                    <div key={p.chave} className="rounded-menuzia border border-border p-2">
                      <div className="flex flex-wrap gap-1.5">
                        {formas.map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setPags((x) => x.map((l, k) => (k === i ? { ...l, forma: f } : l)))}
                            data-testid={`fechar-pag-${i}-forma-${f}`}
                            className={[
                              'rounded-menuzia border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide',
                              p.forma === f ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-main',
                            ].join(' ')}
                          >
                            {ROTULO_FORMA[f as FormaPagamento] ?? f}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <input
                          inputMode="decimal"
                          value={p.valor}
                          onChange={(e) => setPags((x) => x.map((l, k) => (k === i ? { ...l, valor: e.target.value } : l)))}
                          placeholder="Valor"
                          data-testid={`fechar-pag-${i}-valor`}
                          className="w-full rounded-menuzia border border-border px-3 py-2 text-[14px] focus:border-primary focus:outline-none"
                        />
                        {p.forma === 'dinheiro' && (
                          <input
                            inputMode="decimal"
                            value={p.recebido}
                            onChange={(e) => setPags((x) => x.map((l, k) => (k === i ? { ...l, recebido: e.target.value } : l)))}
                            placeholder="Recebido (troco)"
                            data-testid={`fechar-pag-${i}-recebido`}
                            className="w-full rounded-menuzia border border-border px-3 py-2 text-[14px] focus:border-primary focus:outline-none"
                          />
                        )}
                        {pags.length > 1 && (
                          <button type="button" onClick={() => setPags((x) => x.filter((_, k) => k !== i))} className="px-2 text-[12px] font-semibold text-danger">
                            Remover
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setPags((x) => [...x, novaLinha(formas.find((f) => f !== x[x.length - 1]?.forma) ?? formas[0] ?? 'dinheiro', falta > 0 ? falta.toFixed(2).replace('.', ',') : '')])}
                    data-testid="fechar-add-pagamento"
                    className="w-full rounded-menuzia border border-dashed border-border py-2 text-[12px] font-semibold text-primary"
                  >
                    + Outra forma de pagamento
                  </button>
                  <p className={['text-[12px] font-semibold', Math.abs(falta) < 0.005 ? 'text-price-text' : 'text-danger'].join(' ')} data-testid="fechar-falta">
                    {Math.abs(falta) < 0.005 ? 'Saldo coberto.' : excede ? `Passou ${formatBRL(-falta)} do saldo.` : `Falta ${formatBRL(falta)}.`}
                  </p>
                </div>
              )}
            </section>
          )}

          {erro && (
            <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger" data-testid="fechar-erro">
              {erro}
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onVoltar} className="flex-1 rounded-menuzia border border-border py-3 text-[13px] font-semibold text-text-subtle hover:text-text-main">
            Voltar sem fechar
          </button>
          <button
            type="button"
            disabled={!pronto || enviando}
            onClick={() => void fechar()}
            data-testid="fechar-confirmar"
            className="flex-[2] rounded-menuzia bg-status-ready py-3 text-[14px] font-bold text-white transition-all hover:brightness-95 disabled:opacity-50"
          >
            {enviando ? 'Fechando…' : 'Fechar conta'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Linha({ rotulo, valor, forte, fraco, testid }: { rotulo: string; valor: number; forte?: boolean; fraco?: boolean; testid?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={forte ? 'font-bold text-text-main' : fraco ? 'text-text-subtle' : 'text-text-subtle'}>{rotulo}</span>
      <span className={[forte ? 'font-bold text-text-main' : 'text-text-main', fraco ? 'text-text-subtle line-through' : ''].join(' ')} data-testid={testid}>
        {formatBRL(valor)}
      </span>
    </div>
  )
}
