'use client'

import { useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import { IconeIaClaude, IconeWhatsapp } from '@/components/icones/origens'

/**
 * Solicitação do cliente no card do Kanban (Fase 2, 18/10): faixa amarela "Cliente pediu: …" com [Aplicar] [Recusar].
 * Aplicar = a mesma edição/cancelamento do painel (POST …/solicitacao); sem proposta estruturada, abre o lápis para a
 * loja fazer à mão e fecha a solicitação ao salvar. Recusar pede um motivo curto opcional (vai ao cliente).
 */
export interface SolicitacaoCard {
  id: string
  pedidoId: string
  origem: 'robo' | 'ia'
  tipo: 'alterar' | 'cancelar'
  texto: string
  temProposta: boolean
  criadoEm: string
}
export const SOLICITACAO_SELECT = 'id, pedido_id, origem, tipo, texto, proposta, status, criado_em'
export function mapSolicitacaoCard(r: Record<string, unknown>): SolicitacaoCard {
  return { id: String(r.id), pedidoId: String(r.pedido_id), origem: r.origem as 'robo' | 'ia', tipo: r.tipo as 'alterar' | 'cancelar', texto: String(r.texto ?? ''), temProposta: !!r.proposta, criadoEm: String(r.criado_em) }
}

const BOTAO = 'inline-flex h-[26px] items-center justify-center whitespace-nowrap rounded-[2px] px-2.5 text-[11.5px] font-semibold transition-colors disabled:opacity-50'

export function SolicitacaoNoCard({ s, onAplicar, onRecusar, onEditarAMao }: {
  s: SolicitacaoCard
  onAplicar: () => Promise<{ ok: boolean; semProposta?: boolean; erro?: string }>
  onRecusar: (motivo: string | null) => Promise<void>
  /** Sem proposta estruturada: a loja edita pelo lápis; ao salvar, a solicitação é fechada. */
  onEditarAMao: () => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const [recusando, setRecusando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const minutos = Math.max(0, Math.round((Date.now() - new Date(s.criadoEm).getTime()) / 60_000))
  async function aplicar() {
    setOcupado(true); setErro(null)
    const r = await onAplicar()
    setOcupado(false)
    if (!r.ok) { if (r.semProposta) onEditarAMao(); else setErro(r.erro ?? 'Não foi possível aplicar.') }
  }
  return (
    <div className="rounded-[2px] border border-[#FCD34D] bg-[#FEF3C7] px-2.5 py-2" data-testid={`solicitacao-${s.tipo}`} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start gap-1.5 text-[12px] text-[#92400E]">
        <span className="mt-[1px] inline-flex flex-shrink-0 items-center gap-1">
          {s.origem === 'ia' ? <IconeIaClaude className="h-[14px] w-[14px]" /> : <IconeWhatsapp className="h-[14px] w-[14px]" />}
          <MessageSquareText className="h-[13px] w-[13px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <b>Cliente pediu {s.tipo === 'cancelar' ? 'para CANCELAR' : 'alteração'}</b>{s.texto ? `: ${s.texto}` : ''}
          <span className="ml-1 text-[11px] font-normal text-[#B45309]">· há {minutos} min{minutos >= 5 ? ' · atendente avisado' : ''}</span>
        </span>
      </div>
      {erro && <p className="mt-1 text-[11.5px] font-semibold text-[#B91C1C]">{erro}</p>}
      {recusando === null ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button type="button" disabled={ocupado} onClick={() => void aplicar()} className={`${BOTAO} bg-[#15803D] text-white hover:bg-[#166534]`} data-testid="solicitacao-aplicar">{ocupado ? 'Aplicando…' : s.tipo === 'cancelar' ? 'Cancelar o pedido' : s.temProposta ? 'Aplicar' : 'Aplicar (editar)'}</button>
          <button type="button" disabled={ocupado} onClick={() => setRecusando('')} className={`${BOTAO} border border-[#D1D5DB] bg-white text-[#B91C1C] hover:bg-[#FEE2E2]`} data-testid="solicitacao-recusar">Recusar</button>
        </div>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          <input autoFocus value={recusando} onChange={(e) => setRecusando(e.target.value.slice(0, 200))} placeholder="Motivo (opcional, vai para o cliente)" className="h-[30px] w-full rounded-[2px] border border-[#D1D5DB] bg-white px-2 text-[12px]" data-testid="solicitacao-motivo" />
          <div className="flex gap-1.5">
            <button type="button" disabled={ocupado} onClick={async () => { setOcupado(true); await onRecusar(recusando.trim() || null); setOcupado(false); setRecusando(null) }} className={`${BOTAO} bg-[#B91C1C] text-white hover:bg-[#991B1B]`} data-testid="solicitacao-recusar-confirmar">Confirmar recusa</button>
            <button type="button" onClick={() => setRecusando(null)} className={`${BOTAO} border border-[#D1D5DB] bg-white text-[#374151]`}>Voltar</button>
          </div>
        </div>
      )}
    </div>
  )
}
