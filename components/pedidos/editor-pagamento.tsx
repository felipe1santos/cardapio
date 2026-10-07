'use client'

import { useState } from 'react'
import { AprovacaoPin, type AprovacaoDada, type PedidoRemoto } from '@/components/financeiro/apoio'
import { atalhosTroco, daPedido, ESCOLHAS_PDV, ROTULO_ESCOLHA, trocoLevar, type EscolhaPdv } from '@/lib/pdv-pagamento'
import type { PagamentoDoPedido } from './info-pagamento'

/**
 * Alterar forma de pagamento / troco de um pedido já lançado (0135). O servidor decide quem pode:
 * até sair para entrega, quem atende; depois (ou pago), gerência — com PIN de outra pessoa quando o
 * financeiro está ligado. Tudo vai para a auditoria; "Reimprimir comanda" opcional.
 */
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function EditorPagamento({ pedidoId, p, onFeito, onCancelar }: { pedidoId: string; p: PagamentoDoPedido; onFeito: () => void; onCancelar: () => void }) {
  const atual = daPedido(p.formaPagamento, p.cartaoTipo, p.trocoPara)
  const [escolha, setEscolha] = useState<EscolhaPdv | null>(atual?.escolha ?? null)
  const [trocoTxt, setTrocoTxt] = useState(atual?.trocoPara ? String(atual.trocoPara) : '')
  const [reimprimir, setReimprimir] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [pin, setPin] = useState(false)
  const [remoto, setRemoto] = useState<PedidoRemoto | null>(null)
  const [erroPin, setErroPin] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const troco = escolha === 'dinheiro' && trocoTxt.trim() ? Number(trocoTxt.replace(',', '.')) : null

  async function salvar(aprovacao?: AprovacaoDada) {
    if (!escolha) return setErro('Escolha a forma de pagamento.')
    setOcupado(true); setErro(null); setErroPin(null)
    const r = await fetch(`/api/admin/pedidos/${pedidoId}/pagamento`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pagamento: { escolha, trocoPara: troco }, reimprimir, aprovacao }),
    })
    const j = await r.json().catch(() => ({}))
    setOcupado(false)
    if (r.ok) return onFeito()
    if (j.codigo === 'aprovacao_necessaria') { setRemoto(j.pedidoRemoto ?? null); setPin(true); return }
    if (aprovacao) return setErroPin(j.error ?? 'Não aprovado.')
    setErro(j.error ?? 'Não foi possível alterar.')
  }

  return (
    <div className="space-y-2 rounded-menuzia border border-border bg-[#f9fafb] p-3" data-testid="editor-pagamento">
      <div className="grid grid-cols-2 gap-2">
        {ESCOLHAS_PDV.map((f) => (
          <button key={f} type="button" aria-pressed={escolha === f} data-testid={`editar-pag-${f}`} onClick={() => { setEscolha(f); if (f !== 'dinheiro') setTrocoTxt('') }}
            className={`min-h-[44px] rounded-menuzia border px-2 text-[13px] font-semibold ${escolha === f ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white text-text-main'}`}>{ROTULO_ESCOLHA[f]}</button>
        ))}
      </div>
      {escolha === 'dinheiro' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-text-subtle">Troco para</span>
          {atalhosTroco(p.total).map((v) => (
            <button key={v} type="button" onClick={() => setTrocoTxt(String(v))} className="h-[36px] rounded-menuzia border border-border bg-white px-2.5 text-[13px] font-semibold">R$ {v}</button>
          ))}
          <input inputMode="decimal" placeholder="sem troco" value={trocoTxt} onChange={(e) => setTrocoTxt(e.target.value.replace(/[^\d.,]/g, '').slice(0, 9))}
            className="h-[36px] w-[110px] rounded-menuzia border border-border bg-white px-2 text-[13px] outline-none focus:border-primary" data-testid="editar-troco" />
          {troco && troco > p.total && <span className="text-[12.5px] font-semibold text-[#92400E]">levar {brl(trocoLevar(p.total, troco))}</span>}
        </div>
      )}
      <label className="flex items-center gap-2 text-[12.5px] text-text-main">
        <input type="checkbox" checked={reimprimir} onChange={(e) => setReimprimir(e.target.checked)} /> Reimprimir comanda
      </label>
      {pin && <AprovacaoPin titulo="O pedido já saiu ou foi pago: outra pessoa precisa aprovar" erro={erroPin} ocupado={ocupado} remoto={remoto} onCancelar={() => setPin(false)} onConfirmar={(a) => void salvar(a)} />}
      {erro && <p className="text-[12.5px] font-medium text-danger" data-testid="editar-pag-erro">{erro}</p>}
      {!pin && (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancelar} className="h-[36px] rounded-menuzia border border-border bg-white px-3 text-[11px] font-semibold uppercase tracking-wide">Cancelar</button>
          <button type="button" disabled={ocupado} onClick={() => void salvar()} data-testid="editar-pag-salvar"
            className="h-[36px] rounded-menuzia bg-primary px-3 text-[11px] font-semibold uppercase tracking-wide text-white disabled:opacity-60">Salvar</button>
        </div>
      )}
    </div>
  )
}
