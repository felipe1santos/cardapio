'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { ChefHat, Clock, PackageCheck } from 'lucide-react'
import { LABEL_MODO, type ModoEstacao } from '@/lib/cozinha/modo'
import type { Pedido, PedidoItem } from '@/lib/queries/pedidos'

// ─────────────────────────────────────────────────────────────────────────────
// Audio beep (keep from original)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Timer helpers
// ─────────────────────────────────────────────────────────────────────────────

function elapsedMs(criadoEm: string, now: number): number {
  return now - new Date(criadoEm).getTime()
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const totalMin = Math.floor(totalSec / 60)
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return `${h}:${String(m).padStart(2, '0')}`
  }
  const m = totalMin
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function timerColor(ms: number): string {
  const min = ms / 60000
  if (min <= 10) return 'text-status-ready'
  if (min <= 20) return 'text-status-pending'
  return 'text-danger'
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PortalCozinha {
  estacao: { nome: string; modo: ModoEstacao; restauranteNome: string }
  pedidos: Pedido[]
}

// ─────────────────────────────────────────────────────────────────────────────
// ElapsedTimer — inline blinking clock + mm:ss counter
// ─────────────────────────────────────────────────────────────────────────────

function ElapsedTimer({ criadoEm, now }: { criadoEm: string; now: number }) {
  const ms = elapsedMs(criadoEm, now)
  const color = timerColor(ms)
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[12px] font-bold ${color}`}>
      <Clock className="h-3.5 w-3.5 animate-pulse" />
      {formatElapsed(ms)}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NameOverlay — blocks interaction until cook enters their name
// ─────────────────────────────────────────────────────────────────────────────

function NameOverlay({ onSave }: { onSave: (name: string) => void }) {
  const [input, setInput] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed) return
    onSave(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-sm rounded-menuzia border border-border bg-main p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2.5">
          <ChefHat className="h-5 w-5 text-primary" />
          <h2 className="text-base font-extrabold text-text-main">Quem está na cozinha?</h2>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            autoFocus
            type="text"
            placeholder="Seu nome"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="mb-3 w-full rounded-menuzia border border-border bg-page px-3 py-2.5 text-[14px] text-text-main placeholder:text-text-subtle focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-full rounded-menuzia bg-primary py-3 text-[13px] font-extrabold uppercase tracking-wide text-white transition-opacity disabled:opacity-40"
          >
            Entrar
          </button>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PrepModal — full-screen on mobile, large centered modal on desktop
// Only closes via Devolver or Concluir — no X / backdrop click
// ─────────────────────────────────────────────────────────────────────────────

interface PrepModalProps {
  pedido: Pedido
  cozinheiro: string
  token: string
  now: number
  onClose: () => void
  onRefetch: () => Promise<void>
}

function PrepModal({ pedido, cozinheiro, token, now, onClose, onRefetch }: PrepModalProps) {
  const [busy, setBusy] = useState<'devolver' | 'concluir' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmandoDevolver, setConfirmandoDevolver] = useState(false)

  async function executarDevolver() {
    setConfirmandoDevolver(false)
    setBusy('devolver')
    try {
      const res = await fetch(`/api/cozinha/${token}/pedidos/${pedido.id}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'devolver', cozinheiro }),
      })
      if (res.status === 409) {
        setNotice('Este pedido já foi alterado — atualizando…')
        await onRefetch()
        onClose()
        return
      }
      if (!res.ok) {
        const j = await res.json()
        setNotice(j.error ?? 'Falhou ao devolver')
        return
      }
      await onRefetch()
      onClose()
    } finally {
      setBusy(null)
    }
  }

  async function concluir() {
    setBusy('concluir')
    try {
      const res = await fetch(`/api/cozinha/${token}/pedidos/${pedido.id}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'concluir', cozinheiro }),
      })
      if (res.status === 409) {
        setNotice('Este pedido já foi alterado — atualizando…')
        await onRefetch()
        onClose()
        return
      }
      if (!res.ok) {
        const j = await res.json()
        setNotice(j.error ?? 'Falhou ao concluir')
        return
      }
      await onRefetch()
      onClose()
    } finally {
      setBusy(null)
    }
  }

  return (
    /* Full-screen overlay on mobile; dark backdrop on sm+ */
    <div className="fixed inset-0 z-50 flex flex-col bg-main sm:items-center sm:justify-center sm:bg-black/60">

      {/* Popup centralizado de confirmação de devolução — vermelho, alerta */}
      {confirmandoDevolver && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onClick={() => setConfirmandoDevolver(false)}>
          <div className="w-full max-w-sm rounded-menuzia border-2 border-danger bg-main p-5 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg">
              <span className="text-2xl font-black text-danger">!</span>
            </div>
            <h3 className="mb-2 text-base font-extrabold uppercase tracking-wide text-danger">Devolver pedido #{pedido.numero}?</h3>
            <p className="mb-5 text-[13px] leading-relaxed text-text-main">
              O pedido volta para a fila e fica liberado para <b>qualquer cozinheiro</b> pegar.
              Você perde o preparo dele. O cliente <b>não</b> recebe nova mensagem.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmandoDevolver(false)}
                className="flex-1 rounded-menuzia border border-border bg-page py-3 text-[13px] font-extrabold uppercase tracking-wide text-text-main hover:bg-border"
              >
                Cancelar
              </button>
              <button
                onClick={executarDevolver}
                className="flex-1 rounded-menuzia bg-danger py-3 text-[13px] font-extrabold uppercase tracking-wide text-white hover:brightness-95"
              >
                Devolver
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal card — fills screen on mobile, max-w-2xl centered on desktop */}
      <div className="flex h-full w-full flex-col overflow-hidden bg-main sm:h-auto sm:max-h-[90dvh] sm:w-full sm:max-w-2xl sm:rounded-menuzia sm:border sm:border-border sm:shadow-xl">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-border bg-sidebar-bg px-4 py-3 text-white sm:rounded-t-menuzia">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-extrabold">#{pedido.numero}</span>
              <span className="rounded-menuzia bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
                {pedido.tipo === 'retirada' ? 'Retirada' : 'Entrega'}
              </span>
            </div>
            <p className="mt-0.5 text-[13px] font-medium text-sidebar-text">{pedido.clienteNome}</p>
          </div>
          <ElapsedTimer criadoEm={pedido.criadoEm} now={now} />
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto bg-main p-4">
          {/* API error / 409 notice */}
          {notice && (
            <div className="mb-3 rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">
              {notice}
            </div>
          )}

          {/* Order-level restriction — RED UPPERCASE BOLD in highlighted block */}
          {pedido.observacao && (
            <div className="mb-4 rounded-menuzia bg-danger-bg px-3.5 py-3">
              <p className="text-[14px] font-bold uppercase text-danger">{pedido.observacao}</p>
            </div>
          )}

          {/* Item list */}
          <div className="space-y-3">
            {pedido.itens.map((item: PedidoItem, idx: number) => (
              <div key={idx} className="rounded-menuzia border border-border bg-page p-3">
                {/* Quantity + name */}
                <p className="text-[15px] font-extrabold text-text-main">
                  {item.quantidade}× {item.nome}
                </p>

                {/* Variants (tamanho / sabor / borda / massa) */}
                {(item.tamanhoNome || item.saborNome || item.bordaNome || item.massaNome) && (
                  <p className="mt-1 text-[12px] text-text-subtle">
                    {[item.tamanhoNome, item.saborNome, item.bordaNome, item.massaNome]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}

                {/* Descrição do item — lembrete de como montar (fonte menor) */}
                {item.descricao && (
                  <p className="mt-1 text-[11px] italic leading-snug text-text-subtle">{item.descricao}</p>
                )}

                {/* Complementos (adicionais) — ALWAYS GREEN */}
                {item.complementos.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {item.complementos.map((c, ci) => (
                      <p key={ci} className="text-[13px] font-semibold text-status-ready">
                        + {c.nome}
                      </p>
                    ))}
                  </div>
                )}

                {/* Item-level restriction — RED UPPERCASE BOLD */}
                {item.observacao && (
                  <p className="mt-2 text-[13px] font-bold uppercase text-danger">{item.observacao}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer — fixed at bottom, only these two buttons close the modal */}
        <div className="flex gap-3 border-t border-border bg-main px-4 py-3 sm:rounded-b-menuzia">
          <button
            disabled={busy !== null}
            onClick={() => setConfirmandoDevolver(true)}
            className="flex-1 rounded-menuzia border border-border bg-page py-3.5 text-[13px] font-extrabold uppercase tracking-wide text-text-main transition-colors hover:bg-border disabled:opacity-50"
          >
            {busy === 'devolver' ? 'Devolvendo…' : 'Devolver'}
          </button>
          <button
            disabled={busy !== null}
            onClick={concluir}
            className="flex-1 rounded-menuzia bg-status-ready py-3.5 text-[13px] font-extrabold uppercase tracking-wide text-white transition-colors hover:brightness-95 disabled:opacity-50"
          >
            {busy === 'concluir' ? 'Concluindo…' : 'Concluir pedido'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DisponiveisCard — card for 'recebido' orders in the left column
// ─────────────────────────────────────────────────────────────────────────────

interface DisponiveisCardProps {
  pedido: Pedido
  now: number
  onPegar: (p: Pedido) => void
  busy: string | null
}

function DisponiveisCard({ pedido, now, onPegar, busy }: DisponiveisCardProps) {
  const isBusy = busy === pedido.id
  return (
    <article className="flex flex-col rounded-menuzia border border-border bg-main shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-base font-extrabold text-text-main">#{pedido.numero}</span>
        <div className="flex items-center gap-2">
          <ElapsedTimer criadoEm={pedido.criadoEm} now={now} />
          <span className="rounded-menuzia bg-status-pending/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-status-pending">
            Aguardando
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-sm font-semibold text-text-main">{pedido.clienteNome}</p>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
          {pedido.tipo === 'retirada' ? 'Retirada' : 'Entrega'}
        </p>

        {/* Items summary */}
        <ul className="space-y-0.5 text-[12px] text-text-subtle">
          {pedido.itens.map((item, idx) => (
            <li key={idx}>
              {item.quantidade}× {item.nome}
            </li>
          ))}
        </ul>

        {/* Order-level restriction preview — RED UPPERCASE */}
        {pedido.observacao && (
          <p className="text-[11px] font-bold uppercase text-danger">{pedido.observacao}</p>
        )}
      </div>

      <div className="border-t border-border p-3">
        <button
          disabled={isBusy}
          onClick={() => onPegar(pedido)}
          className="flex w-full items-center justify-center gap-1.5 rounded-menuzia bg-status-preparing py-3.5 text-[13px] font-extrabold uppercase tracking-wide text-white transition-opacity disabled:opacity-50"
        >
          <ChefHat className="h-4 w-4" />
          {isBusy ? 'Pegando…' : 'Pegar para fazer'}
        </button>
      </div>
    </article>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EmPreparoCard — card for 'preparando' orders; clicking reopens prep modal
// ─────────────────────────────────────────────────────────────────────────────

interface EmPreparoCardProps {
  pedido: Pedido
  now: number
  cozinheiro: string
  onOpen: (p: Pedido) => void
}

function EmPreparoCard({ pedido, now, cozinheiro, onOpen }: EmPreparoCardProps) {
  // Só quem pegou pode abrir/mexer — ninguém interfere no preparo do outro.
  // Pedido sem dono (ex.: aceito pelo Kanban) fica livre para qualquer um.
  const isOwner = !pedido.preparandoPor || pedido.preparandoPor === cozinheiro
  return (
    <article
      className={[
        'flex flex-col rounded-menuzia border bg-main shadow-sm transition-shadow',
        isOwner ? 'cursor-pointer border-status-preparing/40 hover:shadow-md' : 'cursor-not-allowed border-border opacity-80',
      ].join(' ')}
      onClick={isOwner ? () => onOpen(pedido) : undefined}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-base font-extrabold text-text-main">#{pedido.numero}</span>
        <div className="flex items-center gap-2">
          <ElapsedTimer criadoEm={pedido.criadoEm} now={now} />
          <span className="rounded-menuzia bg-status-preparing/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-status-preparing">
            Preparando
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-sm font-semibold text-text-main">{pedido.clienteNome}</p>
        {pedido.preparandoPor && (
          <span className="inline-flex w-fit items-center gap-1 rounded-menuzia bg-alert-bg px-2 py-0.5 text-[11px] font-bold text-alert-text">
            <ChefHat className="h-3 w-3" />
            {pedido.preparandoPor}
          </span>
        )}

        {/* Items summary */}
        <ul className="space-y-0.5 text-[12px] text-text-subtle">
          {pedido.itens.map((item, idx) => (
            <li key={idx}>
              {item.quantidade}× {item.nome}
            </li>
          ))}
        </ul>

        {/* Order-level restriction preview — RED UPPERCASE */}
        {pedido.observacao && (
          <p className="text-[11px] font-bold uppercase text-danger">{pedido.observacao}</p>
        )}
      </div>

      <div
        className={[
          'border-t border-border px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide',
          isOwner ? 'text-primary' : 'text-text-subtle',
        ].join(' ')}
      >
        {isOwner ? 'Toque para abrir' : 'Em preparo por outro cozinheiro'}
      </div>
    </article>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ExpedicaoView — simple list of 'pronto' orders; Entregue for retirada,
// "Na logística" label for entrega. Used by expedicao mode and completa mode.
// Does NOT use cozinheiro / pegar / concluir.
// ─────────────────────────────────────────────────────────────────────────────

interface ExpedicaoViewProps {
  pedidos: Pedido[]
  token: string
  onRefetch: () => Promise<void>
}

function ExpedicaoView({ pedidos, token, onRefetch }: ExpedicaoViewProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const prontos = pedidos.filter((p) => p.status === 'pronto')

  async function marcarEntregue(p: Pedido) {
    setBusy(p.id)
    setNotice(null)
    try {
      const res = await fetch(`/api/cozinha/${token}/pedidos/${p.id}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'entregue' }),
      })
      if (res.status === 409) {
        setNotice('Pedido já foi alterado — atualizando…')
        await onRefetch()
        return
      }
      if (!res.ok) {
        const j = await res.json()
        setNotice(j.error ?? 'Falhou')
        return
      }
      await onRefetch()
    } finally {
      setBusy(null)
    }
  }

  if (prontos.length === 0) {
    return (
      <div className="py-10 text-center">
        <PackageCheck className="mx-auto mb-3 h-8 w-8 text-text-subtle opacity-30" />
        <p className="text-[13px] text-text-subtle">Nenhum pedido pronto para expedição.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <div className="rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">
          {notice}
        </div>
      )}
      {prontos.map((p) => (
        <article key={p.id} className="flex flex-col rounded-menuzia border border-border bg-main shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="text-base font-extrabold text-text-main">#{p.numero}</span>
            <div className="flex items-center gap-1.5">
              <span className="rounded-menuzia bg-status-ready/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-status-ready">
                Pronto
              </span>
              <span className="rounded-menuzia bg-page px-2 py-0.5 text-[10px] font-semibold uppercase text-text-subtle">
                {p.tipo === 'retirada' ? 'Retirada' : 'Entrega'}
              </span>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-2 p-3">
            <p className="text-sm font-semibold text-text-main">{p.clienteNome}</p>
            <ul className="space-y-0.5 text-[12px] text-text-subtle">
              {p.itens.map((item, idx) => (
                <li key={idx}>
                  {item.quantidade}× {item.nome}
                </li>
              ))}
            </ul>
            {p.observacao && (
              <p className="text-[11px] font-bold uppercase text-danger">{p.observacao}</p>
            )}
          </div>

          <div className="border-t border-border p-3">
            {p.tipo === 'retirada' ? (
              <button
                disabled={busy === p.id}
                onClick={() => marcarEntregue(p)}
                className="flex w-full items-center justify-center gap-1.5 rounded-menuzia bg-status-ready py-3.5 text-[13px] font-extrabold uppercase tracking-wide text-white transition-opacity disabled:opacity-50"
              >
                <PackageCheck className="h-4 w-4" />
                {busy === p.id ? 'Aguarde…' : 'Entregue'}
              </button>
            ) : (
              <p className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                Na logística
              </p>
            )}
          </div>
        </article>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function CozinhaPortalPage() {
  const { token } = useParams() as { token: string }

  // Cook name (per-token key in localStorage)
  const storageKey = `cozinha:nome:${token}`
  const [cozinheiro, setCozinheiro] = useState<string | null>(null)
  const [showNameOverlay, setShowNameOverlay] = useState(false)

  // Portal data
  const [data, setData] = useState<PortalCozinha | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Prep modal
  const [modalPedido, setModalPedido] = useState<Pedido | null>(null)

  // Single shared clock state — drives all ElapsedTimer instances at 1 Hz
  const [now, setNow] = useState(() => Date.now())

  // Tracks ids seen so far — used for new-order beep detection
  const idsAnteriores = useRef<Set<string>>(new Set())

  // ── Initialize cook name from localStorage ──────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      setCozinheiro(saved)
    } else {
      setShowNameOverlay(true)
    }
  }, [storageKey])

  function saveName(name: string) {
    localStorage.setItem(storageKey, name)
    setCozinheiro(name)
    setShowNameOverlay(false)
  }

  function trocarNome() {
    localStorage.removeItem(storageKey)
    setCozinheiro(null)
    setShowNameOverlay(true)
  }

  // ── Data fetching ────────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/cozinha/${token}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Link inválido')
        return
      }

      // Beep when a new order appears in the feed
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

  // 6-second polling
  useEffect(() => {
    refetch()
    const interval = setInterval(refetch, 6000)
    return () => clearInterval(interval)
  }, [refetch])

  // 1-second clock for all timers
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Sync modal pedido with latest data (keeps timer fresh; auto-closes if pedido vanishes)
  useEffect(() => {
    if (!data) return
    setModalPedido((prev) => {
      if (!prev) return null
      const updated = data.pedidos.find((p) => p.id === prev.id)
      return updated ?? null
    })
  }, [data])

  // ── Pegar action (producao / completa) ───────────────────────────────────
  async function pegarPedido(p: Pedido) {
    if (!cozinheiro) {
      setShowNameOverlay(true)
      return
    }
    setBusy(p.id)
    setNotice(null)
    try {
      const res = await fetch(`/api/cozinha/${token}/pedidos/${p.id}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'pegar', cozinheiro }),
      })
      if (res.status === 409) {
        setNotice('Este pedido já foi pego por outro cozinheiro.')
        await refetch()
        return
      }
      if (!res.ok) {
        const j = await res.json()
        setNotice(j.error ?? 'Falhou ao pegar o pedido')
        return
      }
      // Open modal immediately; sync effect will update it once refetch settles
      setModalPedido(p)
      await refetch()
    } finally {
      setBusy(null)
    }
  }

  // ── Loading / error / empty guards ───────────────────────────────────────
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

  // Split into columns for producao / completa
  const disponiveis = data.pedidos
    .filter((p) => p.status === 'recebido')
    .sort((a, b) => new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime())

  const emPreparo = data.pedidos.filter((p) => p.status === 'preparando')

  return (
    <div className="min-h-dvh bg-page">
      {/* Cook name overlay — blocks until name is set (producao/completa only) */}
      {showNameOverlay && !isExpedicao && <NameOverlay onSave={saveName} />}

      {/* Prep modal */}
      {modalPedido && cozinheiro && (
        <PrepModal
          pedido={modalPedido}
          cozinheiro={cozinheiro}
          token={token}
          now={now}
          onClose={() => setModalPedido(null)}
          onRefetch={refetch}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
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
        <div className="flex items-center gap-2">
          {/* Cook name badge + swap button (producao/completa only) */}
          {!isExpedicao && cozinheiro && (
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-semibold text-sidebar-text">{cozinheiro}</span>
              <button
                onClick={trocarNome}
                className="rounded-menuzia bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-text hover:bg-white/20"
              >
                trocar
              </button>
            </div>
          )}
          <span className="rounded-menuzia bg-white/10 px-2.5 py-1 text-[11px] font-semibold">
            {data.pedidos.length} pedido{data.pedidos.length !== 1 ? 's' : ''}
          </span>
        </div>
      </header>

      {/* Global 409 / pegar error notice */}
      {notice && (
        <div className="border-b border-danger bg-danger-bg px-4 py-2.5 text-[13px] font-medium text-danger">
          {notice}
        </div>
      )}

      {/* ── Expedicao mode: simple pronto list ─────────────────────────── */}
      {isExpedicao && (
        <main className="p-3">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">
              Prontos para expedição
            </h2>
            <span className="rounded-full bg-status-ready px-1.5 py-0.5 text-[10px] font-bold text-white">
              {data.pedidos.filter((p) => p.status === 'pronto').length}
            </span>
          </div>
          <ExpedicaoView pedidos={data.pedidos} token={token} onRefetch={refetch} />
        </main>
      )}

      {/* ── Producao / Completa mode: two-column layout ────────────────── */}
      {!isExpedicao && (
        <main className="p-3">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Left column: Disponíveis (status === 'recebido', oldest first) */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                  Disponíveis
                </h2>
                <span className="rounded-full bg-status-pending px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {disponiveis.length}
                </span>
              </div>
              {disponiveis.length === 0 ? (
                <div className="rounded-menuzia border border-dashed border-border bg-main py-10 text-center">
                  <ChefHat className="mx-auto mb-2 h-8 w-8 text-text-subtle opacity-30" />
                  <p className="text-[13px] text-text-subtle">Nenhum pedido aguardando.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {disponiveis.map((p) => (
                    <DisponiveisCard
                      key={p.id}
                      pedido={p}
                      now={now}
                      onPegar={pegarPedido}
                      busy={busy}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Right column: Em preparo (status === 'preparando') */}
            <section>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                  Em preparo
                </h2>
                <span className="rounded-full bg-status-preparing px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {emPreparo.length}
                </span>
              </div>
              {emPreparo.length === 0 ? (
                <div className="rounded-menuzia border border-dashed border-border bg-main py-10 text-center">
                  <ChefHat className="mx-auto mb-2 h-8 w-8 text-text-subtle opacity-30" />
                  <p className="text-[13px] text-text-subtle">Nenhum pedido em preparo.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {emPreparo.map((p) => (
                    <EmPreparoCard
                      key={p.id}
                      pedido={p}
                      now={now}
                      cozinheiro={cozinheiro ?? ''}
                      onOpen={setModalPedido}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Pronto section — completa mode only (shows 'pronto' pedidos below the two columns) */}
          {data.estacao.modo === 'completa' && (
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                  Pronto p/ Despacho
                </h2>
                <span className="rounded-full bg-status-ready px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {data.pedidos.filter((p) => p.status === 'pronto').length}
                </span>
              </div>
              <ExpedicaoView pedidos={data.pedidos} token={token} onRefetch={refetch} />
            </div>
          )}
        </main>
      )}
    </div>
  )
}
