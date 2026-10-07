'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Route } from 'lucide-react'
import { Flutuante } from '@/components/ui/flutuante'
import { atribuirEntregador, avancarStatusPedido, listarEntregadores, type Entregador, type Pedido } from '@/lib/queries/pedidos'
import { notificarPedido } from '@/lib/notificar'
import { formatarReal } from '@/lib/moeda'

/**
 * Despachar UM pedido pelo card do Kanban (item 58): menu pequeno (Flutuante, por cima de tudo)
 * com os entregadores disponíveis, "Entregar sem entregador" e o Nexta (se a loja usa). Escolhe →
 * confirma → o pedido vai para "Em rota" na hora, pelas MESMAS funções do despacho de hoje
 * (atribuirEntregador / avancarStatusPedido + aviso ao cliente "saiu para entrega"; Nexta pela
 * rota de sempre). Com o Financeiro ligado e troco por pedido, o passo seguinte registra o troco
 * entregue ao motoboy — o mesmo "Registrar troco" da tela Pedidos (/api/admin/caixa).
 */
type Escolha = { tipo: 'entregador'; e: Entregador } | { tipo: 'sem' } | { tipo: 'nexta' }
interface TrocoFin { pedidoId: string; entregadorId: string; trocoCentavos: number }

export function DespacharNoCard({ pedido, supabase, restauranteId, onDespachado, onErro }: {
  pedido: Pedido
  supabase: SupabaseClient
  restauranteId: string
  onDespachado: (p: Pedido, entregadorId: string | null) => void
  onErro: (msg: string) => void
}) {
  const botao = useRef<HTMLButtonElement>(null)
  const [aberto, setAberto] = useState(false)
  const [lista, setLista] = useState<Entregador[] | null>(null)
  const [nexta, setNexta] = useState(false)
  const [escolha, setEscolha] = useState<Escolha | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [troco, setTroco] = useState<TrocoFin | null>(null)
  const [valorTroco, setValorTroco] = useState('')
  const fechar = useCallback(() => { setAberto(false); setEscolha(null); setTroco(null) }, [])

  useEffect(() => {
    if (!aberto) return
    let vivo = true
    listarEntregadores(supabase, restauranteId).then((l) => { if (vivo) setLista(l) }).catch(() => { if (vivo) setLista([]) })
    fetch('/api/admin/nexta/config', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: { ativo: boolean } | null } | null) => { if (vivo) setNexta(Boolean(d?.config?.ativo)) }).catch(() => {})
    return () => { vivo = false }
  }, [aberto, supabase, restauranteId])

  const disponiveis = (lista ?? []).filter((e) => e.status === 'online' && !e.desativado)

  async function confirmar() {
    if (!escolha || enviando) return
    setEnviando(true)
    try {
      if (escolha.tipo === 'entregador') {
        await atribuirEntregador(supabase, pedido.id, escolha.e.id)
        notificarPedido(pedido.id, 'em_rota')
        onDespachado(pedido, escolha.e.id)
        // Troco para levar (Financeiro, troco por pedido): o mesmo passo da tela Pedidos.
        if (pedido.formaPagamento === 'dinheiro' && !pedido.pago && pedido.trocoPara) {
          // A lista de trocos sai do banco já com o pedido em rota; se ainda não veio, tenta mais uma vez.
          let t: TrocoFin | undefined
          for (let tentativa = 0; tentativa < 2 && !t; tentativa++) {
            if (tentativa) await new Promise((ok) => setTimeout(ok, 900))
            const r = await fetch('/api/admin/caixa', { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null) as { financeiro?: { modo: string; trocos: TrocoFin[] } | null } | null
            if (r?.financeiro?.modo !== 'pedido') break
            t = r.financeiro.trocos.find((x) => x.pedidoId === pedido.id)
          }
          if (t) { setTroco(t); setValorTroco((t.trocoCentavos / 100).toFixed(2).replace('.', ',')); setEscolha(null); return }
        }
      } else if (escolha.tipo === 'sem') {
        await avancarStatusPedido(supabase, pedido.id, 'em_rota', 'pronto')
        notificarPedido(pedido.id, 'em_rota')
        onDespachado(pedido, null)
      } else {
        const res = await fetch('/api/admin/nexta/despachar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedidoId: pedido.id }) })
        const j = await res.json().catch(() => ({})) as { error?: string }
        if (!res.ok) throw new Error(j.error ?? 'O Nexta não aceitou a corrida.')
        onDespachado(pedido, null)
      }
      fechar()
    } catch (e) {
      onErro(e instanceof Error ? e.message : 'Não foi possível despachar o pedido.')
    } finally {
      setEnviando(false)
    }
  }

  async function registrarTroco() {
    if (!troco || enviando) return
    setEnviando(true)
    const c = Math.round(Number(valorTroco.replace(/\./g, '').replace(',', '.')) * 100)
    const res = await fetch('/api/admin/caixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'troco', entregadorId: troco.entregadorId, pedidoId: troco.pedidoId, valorCentavos: c, chave: `ped-${troco.pedidoId}` }) }).catch(() => null)
    setEnviando(false)
    if (!res?.ok) { const j = await res?.json().catch(() => ({})) as { error?: string } | undefined; return onErro(j?.error ?? 'Não foi possível registrar o troco.') }
    fechar()
  }

  const ITEM = 'flex w-full items-center gap-2.5 rounded-[4px] px-3 py-2 text-left text-[13px] text-text-main hover:bg-page disabled:opacity-50'
  return (
    <>
      <button ref={botao} type="button" onClick={() => setAberto((v) => !v)} aria-haspopup="menu" aria-expanded={aberto}
        className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-menuzia bg-[var(--adm-azul,#0b78d0)] px-2 text-[11px] font-semibold uppercase tracking-wide text-white hover:brightness-110 lg:min-h-0 lg:py-2"
        data-testid="card-despachar">
        <Route className="h-4 w-4" aria-hidden /> Despachar
      </button>
      <Flutuante ancora={botao} aberto={aberto} onFechar={fechar} alinhar="inicio" largura={280} testid={`despachar-menu-${pedido.numero}`} rotulo={`Despachar o pedido #${pedido.numero}`} className="p-1.5">
        {troco ? (
          <div className="space-y-2 p-1.5" data-testid="despachar-troco">
            <p className="text-[13px] font-semibold text-text-main">Pedido #{pedido.numero} em rota.</p>
            <p className="text-[12.5px] text-text-subtle">Troco para levar: precisa de <b>{formatarReal(troco.trocoCentavos / 100)}</b>.</p>
            <label className="flex h-[34px] items-center rounded-[4px] border border-border px-2 text-[13px]"><span className="mr-1 text-[12px] text-text-subtle">entregue R$</span>
              <input className="w-full border-0 bg-transparent p-0 text-[13px] shadow-none outline-none focus:ring-0" inputMode="decimal" value={valorTroco} onChange={(e) => setValorTroco(e.target.value.replace(/[^\d.,]/g, ''))} data-testid="despachar-troco-valor" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="h-[32px] rounded-[4px] border border-border px-3 text-[12.5px] font-semibold" onClick={fechar}>Depois</button>
              <button type="button" className="h-[32px] rounded-[4px] bg-[var(--adm-azul,#0b78d0)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50" disabled={enviando} onClick={() => void registrarTroco()} data-testid="despachar-troco-registrar">Registrar troco</button>
            </div>
          </div>
        ) : escolha ? (
          <div className="space-y-2 p-1.5" data-testid="despachar-confirmar">
            <p className="text-[13px] text-text-main">
              {escolha.tipo === 'entregador' ? <>Despachar <b>#{pedido.numero}</b> com <b>{escolha.e.nome}</b>?</> : escolha.tipo === 'sem' ? <>Entregar <b>#{pedido.numero}</b> sem entregador?</> : <>Chamar o <b>Nexta</b> para o <b>#{pedido.numero}</b>?</>}
            </p>
            {pedido.formaPagamento === 'dinheiro' && pedido.trocoPara ? <p className="text-[12px] text-[#B45309]">Troco para {formatarReal(pedido.trocoPara)}.</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="h-[32px] rounded-[4px] border border-border px-3 text-[12.5px] font-semibold" onClick={() => setEscolha(null)}>Voltar</button>
              <button type="button" className="h-[32px] rounded-[4px] bg-[var(--adm-azul,#0b78d0)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50" disabled={enviando} onClick={() => void confirmar()} data-testid="despachar-confirmar-ok">Confirmar</button>
            </div>
          </div>
        ) : (
          <div role="menu">
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Entregadores disponíveis</p>
            {lista === null && <p className="px-3 py-2 text-[12.5px] text-text-subtle">Carregando…</p>}
            {lista && disponiveis.length === 0 && <p className="px-3 py-2 text-[12.5px] text-text-subtle">Nenhum entregador disponível agora.</p>}
            {disponiveis.map((e) => (
              <button key={e.id} type="button" role="menuitem" className={ITEM} onClick={() => setEscolha({ tipo: 'entregador', e })} data-testid={`despachar-entregador-${e.id}`}>
                <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-[#E0F2FE] text-[11px] font-semibold text-[#0369A1]">{e.nome.charAt(0).toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate">{e.nome}</span>
                {e.emRota > 0 && <span className="text-[11px] text-text-subtle">{e.emRota} em rota</span>}
              </button>
            ))}
            <div className="mt-1 border-t border-border pt-1">
              {nexta && <button type="button" role="menuitem" className={ITEM} onClick={() => setEscolha({ tipo: 'nexta' })} data-testid="despachar-nexta">Nexta (corrida)</button>}
              <button type="button" role="menuitem" className={ITEM} onClick={() => setEscolha({ tipo: 'sem' })} data-testid="despachar-sem-entregador">Entregar sem entregador</button>
            </div>
          </div>
        )}
      </Flutuante>
    </>
  )
}
