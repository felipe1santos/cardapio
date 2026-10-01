'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ROTULO_FORMA, type FormaPagamento } from '@/lib/conta'
import { ROTULO_PENDENCIA, type CategoriaPendencia } from '@/lib/pdv-v2'
import type { ContaPresencial } from '@/lib/servicos/conta-presencial'
import { chamar, formatBRL, horaCurta, lerValor, novaChave } from './util'
import { TaxasModal, taxasIniciais } from './taxas-conta'
import { FotoItem } from './foto-item'
import { Selo } from './selos'
import { calcularTaxas, rotuloTaxa, type TaxaCalculada, type TaxaEntrada } from '@/lib/taxas-conta'

/** Ícones das formas de pagamento (botões grandes, toque). */
const ICONE_FORMA: Record<string, string> = {
  dinheiro: 'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z',
  pix: 'M5.28 6.4 2.24 9.45a3.6 3.6 0 0 0 0 5.1l3.04 3.05h2.1l3.54-3.54a1.5 1.5 0 0 1 2.12 0l3.54 3.54h2.1l3.04-3.05a3.6 3.6 0 0 0 0-5.1L18.68 6.4h-2.1l-3.54 3.54a1.5 1.5 0 0 1-2.12 0L7.38 6.4z',
  credito: 'M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z',
  debito: 'M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z',
  vale: 'M20 6h-2.18c.11-.31.18-.65.18-1a2.996 2.996 0 0 0-5.5-1.65l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2z',
  fiado: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  outros: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
}

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
  /** Taxa manual da conta (0106). */
  taxa_extra?: number
  taxa_extra_nome?: string | null
}

type Decisao = { acao: 'entregue' | 'cancelar' | null; motivo: string }
type LinhaPag = { forma: string; valor: string; recebido: string; chave: string }

const novaLinha = (forma: string, valor = ''): LinhaPag => ({ forma, valor, recebido: '', chave: novaChave() })

export function FecharContaModal({
  conta,
  formas,
  podeForcar,
  podePagar,
  podeTaxaExtra = false,
  taxasPadrao = [],
  onVoltar,
  onFechada,
}: {
  conta: ContaPresencial
  formas: string[]
  /** Pode incluir/alterar a taxa manual da conta antes de receber (0106). */
  podeTaxaExtra?: boolean
  /** Taxas padrão da loja (atalhos, 0124). */
  taxasPadrao?: TaxaEntrada[]
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
  const [taxaAberta, setTaxaAberta] = useState(false)
  // Salvar a taxa manual refaz a simulação (o saldo muda).
  const [rodadaSim, setRodadaSim] = useState(0)
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
      // Uma linha só, ainda com o saldo sugerido: acompanha a taxa manual que mudou o saldo.
      setPags((atual) =>
        atual.length === 0 && s.restante > 0
          ? [novaLinha(formas[0] ?? 'dinheiro', s.restante.toFixed(2).replace('.', ','))]
          : atual.length === 1 && rodadaSim > 0
            ? [{ ...atual[0]!, valor: s.restante.toFixed(2).replace('.', ',') }]
            : atual,
      )
    })()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveSim, todasDecididas, pendentes, conta.id, rodadaSim])

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

  const [taxasVistas, setTaxasVistas] = useState<TaxaCalculada[] | null>(null)
  const taxasNaTela = taxasVistas ?? conta.taxas
  // Teclado numérico na tela (toque): edita o campo ativo de uma linha de pagamento.
  const [ativo, setAtivo] = useState<{ i: number; campo: 'valor' | 'recebido' }>({ i: 0, campo: 'valor' })
  const [confirmarZero, setConfirmarZero] = useState(false)
  const linhaAtiva = pags[ativo.i]
  function tecla(t: string) {
    if (!linhaAtiva) return
    const atual = linhaAtiva[ativo.campo]
    const novo = t === '⌫' ? atual.slice(0, -1) : t === ',' ? (atual.includes(',') ? atual : (atual || '0') + ',') : (/,\d{2}$/.test(atual) ? atual : atual + t)
    setPags((x) => x.map((l, k) => (k === ativo.i ? { ...l, [ativo.campo]: novo } : l)))
  }
  function atalho(valor: number | 'exato') {
    if (!linhaAtiva || !sim) return
    const outras = pags.reduce((s, p, k) => s + (k === ativo.i ? 0 : (Number.isFinite(lerValor(p.valor)) ? lerValor(p.valor) : 0)), 0)
    const exato = Math.max(0, Math.round((sim.restante - outras) * 100) / 100)
    const fmt = (v: number) => v.toFixed(2).replace('.', ',')
    if (valor === 'exato') {
      setPags((x) => x.map((l, k) => (k === ativo.i ? { ...l, valor: fmt(exato), recebido: l.forma === 'dinheiro' ? fmt(exato) : l.recebido } : l)))
      return
    }
    // No dinheiro o atalho é o que o cliente entregou (troco calculado); nas outras, o valor.
    setPags((x) => x.map((l, k) => (k === ativo.i ? (l.forma === 'dinheiro' ? { ...l, valor: l.valor || fmt(exato), recebido: fmt(valor) } : { ...l, valor: fmt(valor) }) : l)))
  }
  const troco = linhaAtiva && linhaAtiva.forma === 'dinheiro' && linhaAtiva.recebido.trim()
    ? Math.round((lerValor(linhaAtiva.recebido) - lerValor(linhaAtiva.valor || '0')) * 100) / 100
    : null
  const zero = !!sim && sim.restante <= 0.004 && sim.total <= 0.004
  const itensConta = conta.pedidos
    .filter((p) => p.status !== 'cancelado' && decisoes[p.id]?.acao !== 'cancelar')
    .flatMap((p) => p.itens.filter((i) => !i.cancelado))
  const temPendentes = !!pendentes && pendentes.length > 0

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Fechar conta">
      <div className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-menuzia bg-white shadow-xl" data-testid="fechar-modal">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[16px] font-bold text-text-main">Fechar conta</h2>
            {/* Etapas obrigatórias, nesta ordem: o pagamento só abre com as pendências decididas. */}
            <ol className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold" data-testid="fechar-etapas">
              {[
                { n: 1, t: 'Pendências', ok: !temPendentes || todasDecididas, ativo: temPendentes && !todasDecididas },
                { n: 2, t: 'Taxas', ok: !!sim, ativo: false },
                { n: 3, t: 'Pagamento', ok: pronto, ativo: !!sim && !pronto },
              ].map((e) => (
                <li key={e.n} className={['flex items-center gap-1', e.ok ? 'text-price-text' : e.ativo ? 'text-primary' : 'text-text-subtle'].join(' ')}>
                  <span className={['flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] text-white', e.ok ? 'bg-price-text' : e.ativo ? 'bg-primary' : 'bg-text-subtle/50'].join(' ')}>{e.ok ? '✓' : e.n}</span>
                  {e.t}
                </li>
              ))}
            </ol>
          </div>
          <button type="button" onClick={onVoltar} className="flex h-11 w-11 items-center justify-center rounded-menuzia text-text-subtle hover:bg-page hover:text-text-main" aria-label="Voltar">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* ESQUERDA: pendências, itens (com foto), taxas e resumo */}
          <div className="min-h-0 space-y-4 px-4 py-4 lg:flex-1 lg:overflow-y-auto">
            {pendentes === null && !erro && <p className="text-center text-[13px] text-text-subtle">Conferindo a cozinha…</p>}

            {cancelamentosPendentes > 0 && (
              <p className="rounded-menuzia bg-warn-bg px-3 py-2 text-[12px] font-semibold text-text-main">
                Há pedido de cancelamento aguardando decisão da gestão. Aprove ou recuse na conta antes de fechar.
              </p>
            )}

            {temPendentes && (
              <section>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">1. Pedidos ainda na cozinha — decida cada um</p>
                <ul className="space-y-2">
                  {pendentes!.map((p) => {
                    const d = decisoes[p.id]
                    const bloqueado = semDecisaoPossivel(p)
                    return (
                      <li key={p.id} className={['rounded-menuzia border p-3', d?.acao ? 'border-border' : 'border-warn/60 bg-warn-bg/30'].join(' ')} data-testid={`fechar-pendencia-${p.numero}`}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[14px] font-bold text-text-main">#{p.numero}</span>
                          <Selo tom={p.categoria === 'aguardando_aceite' ? 'ambar' : p.categoria === 'em_preparo' ? 'azul' : 'verde'}>
                            {ROTULO_PENDENCIA[p.categoria] ?? p.status}
                          </Selo>
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
                              'min-h-[48px] flex-1 rounded-menuzia border text-[13px] font-bold disabled:opacity-40',
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
                              'min-h-[48px] flex-1 rounded-menuzia border text-[13px] font-bold disabled:opacity-40',
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
                            className="mt-2 min-h-[48px] w-full rounded-menuzia border border-border px-3 text-[13px] focus:border-primary focus:outline-none"
                          />
                        )}
                        {bloqueado && <p className="mt-1.5 text-[11px] text-text-subtle">Pedido ainda não está pronto: decisão da gerência.</p>}
                      </li>
                    )
                  })}
                </ul>
                {!todasDecididas && <p className="mt-2 text-[12px] font-semibold text-warn">Decida todos os pedidos para continuar.</p>}
              </section>
            )}

            {sim && (
              <section className="rounded-menuzia border border-border px-3 py-3 text-[13px]" data-testid="fechar-simulacao">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">{temPendentes ? '2. Conta com as decisões e taxas' : '2. Conta e taxas'}</p>
                {itensConta.length > 0 && (
                  <ul className="mb-2 max-h-[220px] space-y-1.5 overflow-y-auto border-b border-border pb-2" data-testid="fechar-itens">
                    {itensConta.map((i) => (
                      <li key={i.id} className="flex items-center gap-2.5">
                        <FotoItem url={i.imagemUrl} nome={i.nome} tamanho={40} />
                        <span className="min-w-0 flex-1 truncate text-text-main"><strong>{i.quantidade}×</strong> {i.nome}</span>
                        <span className="text-text-main">{formatBRL(i.precoUnitario * i.quantidade)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Linha rotulo="Subtotal" valor={sim.subtotal} />
                {sim.cancelados > 0 && <Linha rotulo="Itens cancelados (não cobrados)" valor={sim.cancelados} fraco />}
                {sim.taxa > 0 && <Linha rotulo={`Taxa de serviço (${conta.taxaServicoPercentual}%)`} valor={sim.taxa} />}
                {taxasNaTela.length > 0
                  ? taxasNaTela.map((t, k) => <Linha key={k} rotulo={rotuloTaxa(t)} valor={t.valor} testid="fechar-taxa-linha" />)
                  : Number(sim.taxa_extra) > 0 && <Linha rotulo={sim.taxa_extra_nome || 'Taxas'} valor={Number(sim.taxa_extra)} />}
                {Number(sim.taxa_entrega) > 0 && <Linha rotulo="Taxa de entrega" valor={Number(sim.taxa_entrega)} />}
                {sim.desconto > 0 && <Linha rotulo={conta.cupomCodigo ? `Desconto (cupom ${conta.cupomCodigo})` : 'Desconto'} valor={-sim.desconto} />}
                <div className="my-1.5 border-t border-border" />
                <Linha rotulo="Total" valor={sim.total} forte />
                <Linha rotulo="Já pago" valor={sim.pago} />
                <Linha rotulo="Saldo" valor={sim.restante} forte testid="fechar-restante" />
                {podeTaxaExtra && (
                  <button
                    type="button"
                    onClick={() => setTaxaAberta(true)}
                    data-testid="fechar-taxa-extra"
                    className="mt-2 min-h-[48px] w-full rounded-menuzia border border-dashed border-primary text-[13px] font-bold text-primary hover:bg-primary hover:text-white"
                  >
                    {Number(sim.taxa_extra) > 0 ? 'Alterar taxas' : '+ Adicionar taxa'}
                  </button>
                )}
                {sim.excedente > 0 && (
                  <p className="mt-2 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger" data-testid="fechar-excedente">
                    Com esses cancelamentos a conta já recebeu {formatBRL(sim.excedente)} a mais do que vale. O estorno é feito por gerente ou dono, na conta, antes de fechar.
                  </p>
                )}
              </section>
            )}
          </div>

          {/* DIREITA: pagamento (toque) */}
          <div className="flex-shrink-0 border-t border-border bg-page/50 px-4 py-4 lg:w-[400px] lg:overflow-y-auto lg:border-l lg:border-t-0">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">3. Pagamento</p>
            {!sim && <p className="rounded-menuzia bg-white px-3 py-6 text-center text-[13px] text-text-subtle">Decida as pendências para liberar o pagamento.</p>}
            {sim && (
              <div className="mb-3 flex items-center justify-between rounded-menuzia bg-white px-3 py-2.5" data-testid="fechar-restante-topo">
                <span className="text-[13px] font-semibold text-text-subtle">Restante a pagar</span>
                <span className={['text-[24px] font-extrabold', Math.abs(falta) < 0.005 ? 'text-price-text' : 'text-text-main'].join(' ')}>{formatBRL(Math.max(0, falta))}</span>
              </div>
            )}
            {sim && zero && sim.excedente <= 0 && (
              <p className="rounded-menuzia bg-white px-3 py-3 text-[13px] text-text-main" data-testid="fechar-zero">
                Saldo zero: a conta fecha registrando <strong>Recebido R$ 0,00</strong>.
              </p>
            )}
            {sim && sim.restante > 0 && sim.excedente <= 0 && (
              <>
                {!podePagar && <p className="text-[12px] text-text-subtle">Sem permissão para receber pagamentos.</p>}
                {podePagar && (
                  <div className="space-y-2">
                    {pags.map((p, i) => (
                      <div key={p.chave} className={['rounded-menuzia border bg-white p-2', ativo.i === i ? 'border-primary' : 'border-border'].join(' ')} onClick={() => setAtivo((a) => (a.i === i ? a : { i, campo: 'valor' }))}>
                        <div className="grid grid-cols-2 gap-1.5">
                          {formas.map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => { setPags((x) => x.map((l, k) => (k === i ? { ...l, forma: f } : l))); setAtivo({ i, campo: 'valor' }) }}
                              data-testid={`fechar-pag-${i}-forma-${f}`}
                              className={[
                                'flex min-h-[56px] items-center gap-2 rounded-menuzia border px-3 text-[14px] font-bold',
                                p.forma === f ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-main',
                              ].join(' ')}
                            >
                              <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0 fill-current" aria-hidden><path d={ICONE_FORMA[f] ?? ICONE_FORMA.outros} /></svg>
                              {ROTULO_FORMA[f as FormaPagamento] ?? f}
                            </button>
                          ))}
                        </div>
                        <div className="mt-2 flex gap-2">
                          <input
                            inputMode="decimal"
                            value={p.valor}
                            onFocus={() => setAtivo({ i, campo: 'valor' })}
                            onChange={(e) => setPags((x) => x.map((l, k) => (k === i ? { ...l, valor: e.target.value } : l)))}
                            placeholder="Valor"
                            data-testid={`fechar-pag-${i}-valor`}
                            className={['min-h-[52px] w-full rounded-menuzia border px-3 text-[18px] font-bold focus:outline-none', ativo.i === i && ativo.campo === 'valor' ? 'border-primary' : 'border-border'].join(' ')}
                          />
                          {p.forma === 'dinheiro' && (
                            <input
                              inputMode="decimal"
                              value={p.recebido}
                              onFocus={() => setAtivo({ i, campo: 'recebido' })}
                              onChange={(e) => setPags((x) => x.map((l, k) => (k === i ? { ...l, recebido: e.target.value } : l)))}
                              placeholder="Recebido"
                              data-testid={`fechar-pag-${i}-recebido`}
                              className={['min-h-[52px] w-full rounded-menuzia border px-3 text-[18px] font-bold focus:outline-none', ativo.i === i && ativo.campo === 'recebido' ? 'border-primary' : 'border-border'].join(' ')}
                            />
                          )}
                          {pags.length > 1 && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); setPags((x) => x.filter((_, k) => k !== i)); setAtivo({ i: 0, campo: 'valor' }) }} className="min-h-[52px] px-2 text-[12px] font-semibold text-danger">
                              Remover
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Atalhos e teclado numérico grande (toque) */}
                    <div className="grid grid-cols-4 gap-1.5" data-testid="fechar-atalhos">
                      {(['exato', 50, 100, 200] as const).map((v) => (
                        <button key={String(v)} type="button" onClick={() => atalho(v)} className="min-h-[52px] rounded-menuzia border border-border bg-white text-[14px] font-bold text-text-main active:scale-[0.97]">
                          {v === 'exato' ? 'Exato' : `R$ ${v}`}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5" data-testid="fechar-teclado">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map((t) => (
                        <button key={t} type="button" onClick={() => tecla(t)} aria-label={t === '⌫' ? 'Apagar' : t}
                          className="min-h-[56px] rounded-menuzia border border-border bg-white text-[20px] font-bold text-text-main active:bg-page">
                          {t}
                        </button>
                      ))}
                    </div>
                    {troco !== null && (
                      <div className={['flex items-center justify-between rounded-menuzia px-3 py-2.5', troco >= 0 ? 'bg-price-bg' : 'bg-danger-bg'].join(' ')} data-testid="fechar-troco">
                        <span className="text-[13px] font-semibold text-text-main">{troco >= 0 ? 'Troco' : 'Falta receber'}</span>
                        <span className={['text-[22px] font-extrabold', troco >= 0 ? 'text-price-text' : 'text-danger'].join(' ')}>{formatBRL(Math.abs(troco))}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => { setPags((x) => [...x, novaLinha(formas.find((f) => f !== x[x.length - 1]?.forma) ?? formas[0] ?? 'dinheiro', falta > 0 ? falta.toFixed(2).replace('.', ',') : '')]); setAtivo({ i: pags.length, campo: 'valor' }) }}
                      data-testid="fechar-add-pagamento"
                      className="min-h-[48px] w-full rounded-menuzia border border-dashed border-border bg-white text-[13px] font-semibold text-primary"
                    >
                      + Outra forma de pagamento
                    </button>
                    <p className={['text-[12px] font-semibold', Math.abs(falta) < 0.005 ? 'text-price-text' : 'text-danger'].join(' ')} data-testid="fechar-falta">
                      {Math.abs(falta) < 0.005 ? 'Saldo coberto.' : excede ? `Passou ${formatBRL(-falta)} do saldo.` : `Falta ${formatBRL(falta)}.`}
                    </p>
                  </div>
                )}
              </>
            )}
            {erro && (
              <p className="mt-2 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger" data-testid="fechar-erro">
                {erro}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onVoltar} className="min-h-[60px] flex-1 rounded-menuzia border border-border text-[13px] font-semibold text-text-subtle hover:text-text-main">
            Voltar sem fechar
          </button>
          <button
            type="button"
            disabled={!pronto || enviando}
            onClick={() => (zero && !confirmarZero ? setConfirmarZero(true) : void fechar())}
            data-testid="fechar-confirmar"
            className={['min-h-[60px] flex-[2] rounded-menuzia text-[16px] font-bold text-white transition-all hover:brightness-95 disabled:opacity-50', zero && confirmarZero ? 'bg-warn' : 'bg-status-ready'].join(' ')}
          >
            {enviando ? 'Fechando…' : zero ? (confirmarZero ? 'Confirmar: fechar com R$ 0,00' : 'Fechar conta (valor zero)') : 'Fechar conta'}
          </button>
        </div>
      </div>
      {taxaAberta && (
        <TaxasModal
          atuais={taxasVistas ? taxasVistas.map(({ nome, tipo, base, quantidade }) => ({ nome, tipo, base, quantidade })) : taxasIniciais(conta)}
          padrao={taxasPadrao}
          subtotal={sim?.subtotal ?? conta.totais.subtotal}
          onVoltar={() => setTaxaAberta(false)}
          onSalvar={async (taxas) => {
            const r = await chamar(`/api/admin/comandas/${conta.id}`, { method: 'POST', body: JSON.stringify({ acao: 'taxas', taxas, acoes }) })
            if (!r.ok) return r.erro ?? 'Não foi possível salvar as taxas.'
            const c = calcularTaxas(taxas, sim?.subtotal ?? conta.totais.subtotal)
            setTaxasVistas(c.ok ? c.taxas : [])
            setTaxaAberta(false)
            setRodadaSim((n) => n + 1)
            return null
          }}
        />
      )}
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
