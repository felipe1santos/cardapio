'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { TecladoPin } from '@/components/admin/teclado-pin'
import { formatarCentavos } from '@/lib/financeiro/centavos'

/**
 * Aprovação pelo celular (Fase 6): faixa por cima de tudo para quem pode aprovar, com os pedidos pendentes da
 * equipe. Aprovar/recusar pede o PIN DA PRÓPRIA pessoa; o servidor confere tudo (inclusive que ninguém aprova
 * o próprio pedido). Consulta a cada 10 s (o push do painel ainda não existe — ponto de troca no servidor).
 */
interface Pedido { id: string; acao: string; rotulo: string; valor_centavos: number | null; motivo: string | null; solicitante_nome: string; dispositivo: string | null; criado_em: string; expira_em: string }

export function FaixaAprovacoes() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [aberto, setAberto] = useState<Pedido | null>(null)
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [montado, setMontado] = useState(false)
  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/financeiro/aprovacoes-remotas', { cache: 'no-store' }).catch(() => null)
    if (!r?.ok) return
    const j = await r.json().catch(() => ({}))
    setPedidos(j.pedidos ?? [])
  }, [])
  useEffect(() => {
    setMontado(true)
    void carregar()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void carregar() }, 10_000)
    return () => clearInterval(t)
  }, [carregar])

  async function decidir(decisao: 'aprovar' | 'recusar', p: string) {
    if (!aberto) return
    setOcupado(true); setErro(null)
    const r = await fetch('/api/admin/financeiro/aprovacoes-remotas', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: aberto.id, decisao, pin: p }) }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    setOcupado(false)
    if (!r?.ok) { setErro(j.error ?? 'Não foi possível.'); setPin(''); return }
    setAberto(null); setPin('')
    void carregar()
  }

  if (!montado || (!pedidos.length && !aberto)) return null
  return createPortal(
    <>
      {!aberto && (
        <button type="button" onClick={() => setAberto(pedidos[0])} data-testid="faixa-aprovacoes"
          className="fin-meta fixed left-1/2 top-[64px] z-[9990] flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#8A4B00] px-4 py-2 text-[14px] font-semibold text-white shadow-lg hover:bg-[#764000] active:bg-[#633600]">
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-semibold text-[#8A4B00]">{pedidos.length}</span>
          {pedidos.length === 1 ? `${pedidos[0].solicitante_nome} pede aprovação` : 'pedidos de aprovação'}
        </button>
      )}
      {aberto && (
        <div className="fin-meta fixed inset-0 z-[9995] flex items-end justify-center !bg-[rgba(28,43,51,0.55)] sm:items-center" data-testid="janela-aprovar-remoto">
          <div className="max-h-[92vh] w-full max-w-[420px] overflow-y-auto rounded-t-[12px] bg-white p-5 shadow-[0_8px_28px_rgba(28,43,51,0.28)] sm:rounded-[8px]">
            <p className="text-[12.5px] font-semibold text-text-subtle">Pedido de aprovação</p>
            <p className="mt-1 text-[16px] font-semibold text-text-main" data-testid="aprovar-remoto-acao">{aberto.rotulo}{aberto.valor_centavos !== null ? ` — ${formatarCentavos(Math.abs(aberto.valor_centavos))}` : ''}</p>
            <p className="mt-1 text-[13px] text-text-main">Quem pede: <b>{aberto.solicitante_nome}</b></p>
            {aberto.motivo && <p className="mt-1 text-[13px] text-text-main">Motivo: {aberto.motivo}</p>}
            <p className="mt-1 text-[12px] text-text-subtle">{aberto.dispositivo ?? ''} · vale até {new Date(aberto.expira_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</p>
            <p className="mb-2 mt-3 text-center text-[13px] text-text-subtle">Digite o SEU PIN para aprovar</p>
            <TecladoPin valor={pin} onMudar={setPin} onCompleto={(p) => void decidir('aprovar', p)} ocupado={ocupado} erro={erro} />
            <div className="mt-3 flex gap-2">
              <button type="button" className="fin-btn fin-btn-contorno flex-1" onClick={() => { setAberto(null); setPin(''); setErro(null) }}>Depois</button>
              <button type="button" className="fin-btn fin-btn-perigo flex-1" disabled={pin.length !== 6 || ocupado}
                onClick={() => void decidir('recusar', pin)} data-testid="aprovar-remoto-recusar">Recusar</button>
            </div>
            {pedidos.length > 1 && <p className="mt-2 text-center text-[12px] text-text-subtle">+{pedidos.length - 1} pedido(s) na fila</p>}
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}
