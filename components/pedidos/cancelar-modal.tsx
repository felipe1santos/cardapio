'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  MOTIVOS_CANCELAMENTO,
  cancelarPedidoRequest,
  type MotivoCancelamento,
} from '@/lib/cancelamento'

const STATUS_LABEL: Record<string, string> = {
  recebido: 'Pedido recebido',
  preparando: 'Preparando',
  pronto: 'Pronto p/ despacho',
  em_rota: 'Saiu para entrega',
}

interface Props {
  pedido: { id: string; numero: number; clienteNome: string; total: number; status: string }
  onFechar: () => void
  /** Chamado após o cancelamento dar certo no servidor. */
  onCancelado: (pedidoId: string) => void
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function CancelarPedidoModal({ pedido, onFechar, onCancelado }: Props) {
  const [motivo, setMotivo] = useState<MotivoCancelamento | null>(null)
  const [observacao, setObservacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !enviando) onFechar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enviando, onFechar])

  const faltaDescrever = motivo === 'outro' && !observacao.trim()
  const podeConfirmar = motivo !== null && !faltaDescrever && !enviando

  async function confirmar() {
    if (!motivo || faltaDescrever) return
    setEnviando(true)
    setErro('')
    try {
      await cancelarPedidoRequest(pedido.id, motivo, observacao.trim())
      onCancelado(pedido.id)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível cancelar o pedido.')
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#111827]/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancelar-pedido-titulo"
        className="w-full max-w-[420px] rounded-menuzia border border-border bg-white shadow-2xl"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="cancelar-pedido-titulo" className="text-[15px] font-bold">
            Cancelar pedido #{pedido.numero}
          </h2>
          <p className="mt-0.5 text-xs text-text-subtle">
            {pedido.clienteNome || 'Cliente'} · {brl(pedido.total)} · {STATUS_LABEL[pedido.status] ?? pedido.status}
          </p>
        </div>

        <div className="px-5 py-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
            Motivo do cancelamento
          </div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {MOTIVOS_CANCELAMENTO.map((m) => (
              <button
                key={m.slug}
                type="button"
                onClick={() => setMotivo(m.slug)}
                className={[
                  'rounded-menuzia border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  motivo === m.slug
                    ? 'border-primary bg-alert-bg text-alert-text'
                    : 'border-border text-text-subtle hover:border-primary hover:text-primary',
                ].join(' ')}
              >
                {m.label}
              </button>
            ))}
          </div>

          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
            Observação {motivo === 'outro' ? '(obrigatória)' : '(opcional)'}
          </label>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
            placeholder={motivo === 'outro' ? 'Descreva o motivo…' : 'Alguma informação extra?'}
            className={[
              'w-full resize-none rounded-menuzia border px-3 py-2 text-sm outline-none focus:border-primary',
              faltaDescrever ? 'border-danger' : 'border-border',
            ].join(' ')}
          />

          <p className="mt-3 text-xs text-text-subtle">
            O cliente é avisado do cancelamento e cupom ou recompensa usados no pedido voltam para ele.
          </p>
          {erro && <p className="mt-2 text-xs font-medium text-danger">{erro}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" onClick={onFechar} disabled={enviando}>
            Voltar
          </Button>
          <button
            type="button"
            onClick={confirmar}
            disabled={!podeConfirmar}
            className="rounded-menuzia bg-danger px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:brightness-95 disabled:opacity-50"
          >
            {enviando ? 'Cancelando…' : 'Confirmar cancelamento'}
          </button>
        </div>
      </div>
    </div>
  )
}
