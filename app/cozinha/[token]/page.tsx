'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Check, ChefHat, PackageCheck } from 'lucide-react'
import { LABEL_MODO, type ModoEstacao } from '@/lib/cozinha/modo'
import type { Pedido, FormaPagamento } from '@/lib/queries/pedidos'

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

const PAY_LABEL: Record<FormaPagamento, string> = {
  pix: 'Pix',
  cartao: 'Cartão',
  dinheiro: 'Dinheiro',
}

function playBeep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.4, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.start()
    osc.stop(ctx.currentTime + 0.5)
    osc.onended = () => ctx.close()
  } catch {
    // audio blocked or unsupported — silently ignore
  }
}

interface PortalCozinha {
  estacao: { nome: string; modo: ModoEstacao; restauranteNome: string }
  pedidos: Pedido[]
}

function acaoDoPedido(p: Pedido): { acao: 'aceitar' | 'pronto' | 'entregue'; label: string } | null {
  if (p.status === 'recebido') return { acao: 'aceitar', label: 'Aceitar' }
  if (p.status === 'preparando') return { acao: 'pronto', label: 'Pronto' }
  if (p.status === 'pronto' && p.tipo === 'retirada') return { acao: 'entregue', label: 'Entregue' }
  return null
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  recebido: { label: 'Recebido', className: 'bg-status-pending/10 text-status-pending' },
  preparando: { label: 'Preparando', className: 'bg-status-preparing/10 text-status-preparing' },
  pronto: { label: 'Pronto', className: 'bg-status-ready/10 text-status-ready' },
}

const ACTION_BG: Record<string, string> = {
  aceitar: 'bg-status-pending',
  pronto: 'bg-status-preparing',
  entregue: 'bg-status-ready',
}

export default function CozinhaPortalPage() {
  const { token } = useParams() as { token: string }
  const [data, setData] = useState<PortalCozinha | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const idsAnteriores = useRef<Set<string>>(new Set())

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/cozinha/${token}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Link inválido')
        return
      }

      // Detecta pedidos novos e toca alerta sonoro
      const idsAgora = new Set<string>((json.pedidos as Pedido[]).map((p) => p.id))
      const temNovo = [...idsAgora].some((id) => !idsAnteriores.current.has(id))
      if (temNovo && idsAnteriores.current.size > 0) playBeep()
      idsAnteriores.current = idsAgora

      setData(json)
      setError(null)
    } catch {
      setError('Não foi possível carregar a estação.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    refetch()
    const interval = setInterval(refetch, 6000)
    return () => clearInterval(interval)
  }, [refetch])

  async function executar(p: Pedido, acao: string) {
    setBusy(p.id)
    try {
      const res = await fetch(`/api/cozinha/${token}/pedidos/${p.id}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      })
      if (!res.ok) {
        const j = await res.json()
        setError(j.error ?? 'Falhou')
        return
      }
      await refetch()
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-page text-sm text-text-subtle">
        Carregando estação…
      </div>
    )
  }

  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center bg-page p-6">
        <div className="w-full max-w-sm rounded-menuzia border border-border bg-main p-5 text-center">
          <p className="text-sm font-bold text-danger">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const isExpedicao = data.estacao.modo === 'expedicao'

  return (
    <div className="min-h-dvh bg-page">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between bg-sidebar-bg px-4 py-3 text-white shadow-sm">
        <div className="flex items-center gap-2.5">
          <ChefHat className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-semibold leading-tight">{data.estacao.nome}</p>
            <p className="text-[11px] text-sidebar-text">
              {data.estacao.restauranteNome} · {LABEL_MODO[data.estacao.modo]}
            </p>
          </div>
        </div>
        <span className="rounded-menuzia bg-white/10 px-2.5 py-1 text-[11px] font-semibold">
          {data.pedidos.length} pedido{data.pedidos.length !== 1 ? 's' : ''}
        </span>
      </header>

      {/* Order grid */}
      <main className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.pedidos.map((p) => {
          const acao = acaoDoPedido(p)
          const statusBadge = STATUS_BADGE[p.status]

          return (
            <article key={p.id} className="flex flex-col rounded-menuzia border border-border bg-main shadow-sm">
              {/* Card header: order number + status + type */}
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <span className="text-base font-extrabold text-text-main">#{p.numero}</span>
                <div className="flex items-center gap-1.5">
                  {statusBadge && (
                    <span
                      className={`rounded-menuzia px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadge.className}`}
                    >
                      {statusBadge.label}
                    </span>
                  )}
                  <span className="rounded-menuzia bg-page px-2 py-0.5 text-[10px] font-semibold uppercase text-text-subtle">
                    {p.tipo === 'retirada' ? 'Retirada' : 'Entrega'}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-3">
                {/* Client name */}
                <p className="text-sm font-semibold text-text-main">{p.clienteNome}</p>

                {/* Items list — complementos + observação per item */}
                <ul className="space-y-2 text-[13px]">
                  {p.itens.map((item, idx) => (
                    <li key={idx}>
                      <span className="font-medium text-text-main">
                        {item.quantidade}× {item.nome}
                        {item.tamanhoNome ? ` (${item.tamanhoNome})` : ''}
                        {item.saborNome ? ` — ${item.saborNome}` : ''}
                        {item.bordaNome ? ` · ${item.bordaNome}` : ''}
                      </span>
                      {item.complementos.length > 0 && (
                        <div className="mt-0.5 text-[12px] text-primary">
                          + {item.complementos.map((c) => c.nome).join(', ')}
                        </div>
                      )}
                      {item.observacao && (
                        <div className="mt-0.5 text-[12px] italic text-text-subtle">{item.observacao}</div>
                      )}
                    </li>
                  ))}
                </ul>

                {/* Order-level observation */}
                {p.observacao && (
                  <p className="rounded-menuzia bg-warn-bg px-2.5 py-1.5 text-[12px] text-warn">
                    Obs: {p.observacao}
                  </p>
                )}

                {/* Address + payment info — expedicao mode only */}
                {isExpedicao && (
                  <div className="mt-auto rounded-menuzia border border-border bg-page px-2.5 py-2 text-[12px]">
                    {p.tipo === 'entrega' && (
                      <p className="font-medium text-text-main">
                        {[p.enderecoRua, p.enderecoNumero].filter(Boolean).join(', ')}
                        {p.enderecoBairro ? ` — ${p.enderecoBairro}` : ''}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-menuzia bg-alert-bg px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-alert-text">
                        {PAY_LABEL[p.formaPagamento]}
                      </span>
                      {p.formaPagamento === 'dinheiro' && p.trocoPara !== null && (
                        <span className="rounded-menuzia bg-warn-bg px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warn">
                          Troco p/ {brl(p.trocoPara)}
                        </span>
                      )}
                      <span className="ml-auto text-sm font-bold text-price-text">{brl(p.total)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Action button */}
              <div className="border-t border-border p-3 pt-2">
                {acao ? (
                  <button
                    disabled={busy === p.id}
                    onClick={() => executar(p, acao.acao)}
                    className={`flex w-full items-center justify-center gap-1.5 rounded-menuzia py-3.5 text-[13px] font-extrabold uppercase tracking-wide text-white transition-opacity disabled:opacity-50 ${ACTION_BG[acao.acao]}`}
                  >
                    {acao.acao === 'entregue' ? (
                      <PackageCheck className="h-4 w-4" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    {busy === p.id ? 'Aguarde…' : acao.label}
                  </button>
                ) : p.tipo === 'entrega' && p.status === 'pronto' ? (
                  <p className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                    Na logística
                  </p>
                ) : null}
              </div>
            </article>
          )
        })}

        {data.pedidos.length === 0 && (
          <div className="col-span-full py-16 text-center">
            <ChefHat className="mx-auto mb-3 h-10 w-10 text-text-subtle opacity-40" />
            <p className="text-sm text-text-subtle">Nenhum pedido nesta etapa agora.</p>
          </div>
        )}
      </main>
    </div>
  )
}
