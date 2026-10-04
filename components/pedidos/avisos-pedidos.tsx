'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Dica, Flutuante } from '@/components/ui/flutuante'

/**
 * Avisos do Painel de Pedidos (2026-10-03): o que antes era faixa amarela larga no topo vira um
 * ícone na barra, com badge âmbar e contagem. Pulsa uns segundos quando surge aviso novo.
 * O painel lista cada aviso com explicação curta e ações diretas.
 */
export interface PedidoAviso {
  id: string
  numero: number
  cliente: string
  status: string
  aberto: string
}

export interface Aviso {
  id: string
  titulo: string
  texto: string
  pedidos?: PedidoAviso[]
}

const ROTULO_STATUS: Record<string, string> = { recebido: 'Recebido', preparando: 'Preparando', pronto: 'Pronto', em_rota: 'Em rota' }
const ACAO = 'h-[32px] rounded-[3px] border px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50'

export function AvisosPedidos({ avisos, onEntregue, onNaoEntregue, onCancelar, onVer }: {
  avisos: Aviso[]
  onEntregue: (id: string) => Promise<void> | void
  onNaoEntregue: (id: string) => Promise<void> | void
  onCancelar: (id: string) => void
  onVer: (id: string) => void
}) {
  const total = avisos.reduce((s, a) => s + (a.pedidos?.length || 1), 0)
  const [aberto, setAberto] = useState(false)
  const [pulsando, setPulsando] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [confirmarNao, setConfirmarNao] = useState<string | null>(null)
  const anterior = useRef<number | null>(null)

  // Pulsa por alguns segundos quando aparece aviso novo (não na primeira carga).
  useEffect(() => {
    if (anterior.current !== null && total > anterior.current) {
      setPulsando(true)
      const t = setTimeout(() => setPulsando(false), 4000)
      anterior.current = total
      return () => clearTimeout(t)
    }
    anterior.current = total
  }, [total])

  // Painel por cima de tudo (portal, z 9999): fecha com Esc e com clique fora.
  const botao = useRef<HTMLButtonElement>(null)
  const fechar = useCallback(() => { setAberto(false); setConfirmarNao(null) }, [])
  const dica = total ? `${total} aviso${total > 1 ? 's' : ''} — clique para ver` : 'Nenhum aviso agora'

  async function agir(id: string, fn: () => Promise<void> | void) {
    setOcupado(id)
    try { await fn() } finally { setOcupado(null); setConfirmarNao(null) }
  }

  return (
    <>
      <Dica texto={dica}>
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        aria-label={total ? `${total} aviso${total > 1 ? 's' : ''}` : 'Sem avisos'}
        className={`relative flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-[4px] transition-[filter] sm:h-[44px] sm:w-[44px] ${
          total ? 'bg-[#B45309] text-white hover:brightness-110' : 'bg-[#4B5563] text-white hover:brightness-110'
        } ${pulsando ? 'animate-pulse' : ''}`}
        data-testid="avisos-icone"
      >
        <AlertTriangle className="h-5 w-5" strokeWidth={2.2} />
        {total > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[#B91C1C] px-1 text-[11px] font-bold text-white ring-2 ring-white" data-testid="avisos-badge">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>
      </Dica>
      <Flutuante ancora={botao} aberto={aberto} onFechar={fechar} largura={420} testid="avisos-painel" rotulo="Avisos">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-[14px] font-bold text-text-main">Avisos</p>
          <button type="button" onClick={() => setAberto(false)} className="flex h-[32px] w-[32px] items-center justify-center rounded-[3px] text-text-subtle hover:bg-page" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>
        {avisos.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-text-subtle" data-testid="avisos-vazio">Nenhum aviso agora. Tudo em dia.</p>
        ) : (
          <div>
            {avisos.map((a) => (
              <div key={a.id} className="border-b border-border px-4 py-3 last:border-b-0" data-testid={`aviso-${a.id}`}>
                <p className="text-[13px] font-bold text-[#B45309]">{a.titulo}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-text-subtle">{a.texto}</p>
                {a.pedidos?.map((p) => (
                  <div key={p.id} className="mt-2.5 rounded-[3px] border border-border p-2.5" data-testid="aviso-pedido">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-bold text-text-main">#{p.numero} · {p.cliente || 'Cliente'}</span>
                      <span className="flex-shrink-0 text-[11.5px] text-text-subtle">{ROTULO_STATUS[p.status] ?? p.status} · aberto há {p.aberto}</span>
                    </div>
                    {confirmarNao === p.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[12px] text-text-main">Marcar como não entregue (cancela o pedido)?</span>
                        <button type="button" className={`${ACAO} border-danger bg-danger text-white`} disabled={ocupado === p.id} onClick={() => void agir(p.id, () => onNaoEntregue(p.id))} data-testid="aviso-nao-entregue-confirmar">Confirmar</button>
                        <button type="button" className={`${ACAO} border-border bg-white`} onClick={() => setConfirmarNao(null)}>Voltar</button>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className={`${ACAO} border-[#16A34A] bg-[#16A34A] text-white hover:brightness-95`} disabled={ocupado === p.id} onClick={() => void agir(p.id, () => onEntregue(p.id))} data-testid="aviso-entregue">Entregue</button>
                        <button type="button" className={`${ACAO} border-border bg-white text-text-main hover:border-danger hover:text-danger`} disabled={ocupado === p.id} onClick={() => setConfirmarNao(p.id)} data-testid="aviso-nao-entregue">Não entregue</button>
                        <button type="button" className={`${ACAO} border-border bg-white text-text-main hover:border-danger hover:text-danger`} disabled={ocupado === p.id} onClick={() => { setAberto(false); onCancelar(p.id) }} data-testid="aviso-cancelar">Cancelar</button>
                        <button type="button" className={`${ACAO} ml-auto border-transparent text-primary hover:underline`} onClick={() => { setAberto(false); onVer(p.id) }} data-testid="aviso-ver">Ver no kanban</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Flutuante>
    </>
  )
}
