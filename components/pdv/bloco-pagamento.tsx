'use client'

import { useEffect, useMemo, useState } from 'react'
import { Banknote, CreditCard, QrCode } from 'lucide-react'
import {
  atalhosTroco, erroPagamentoPdv, ROTULO_ESCOLHA, statusAReceber, trocoLevar, type EscolhaPdv, type PagamentoPdv,
} from '@/lib/pdv-pagamento'

/**
 * Bloco "PAGAMENTO" do PDV (0135), acima do "Lançar na cozinha". Só para conta de BALCÃO
 * (entrega/retirada); mesa paga no fechamento e não vê nada. Escolher a forma NÃO marca como pago.
 * A tela ajuda; quem confere (troco maior que o total da conta) é o servidor no lançamento.
 */
export interface EstadoPagamentoPdv {
  /** Esta conta exige a escolha antes de lançar? */
  exige: boolean
  pagamento: PagamentoPdv | null
  erro: string | null
}

const ICONE: Record<EscolhaPdv, typeof Banknote> = { dinheiro: Banknote, pix: QrCode, credito: CreditCard, debito: CreditCard }
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function BlocoPagamento({ comandaId, subtotalCarrinho, versao, onMudar }: {
  comandaId: string | null
  subtotalCarrinho: number
  /** Muda depois de cada lançamento: relê o total da conta. */
  versao: number
  onMudar: (e: EstadoPagamentoPdv) => void
}) {
  const [info, setInfo] = useState<{ tipo: string; entrega: boolean; totalAtual: number; taxaPendente: number; formas: EscolhaPdv[]; atual: PagamentoPdv | null } | null>(null)
  const [escolha, setEscolha] = useState<EscolhaPdv | null>(null)
  const [precisaTroco, setPrecisaTroco] = useState<boolean | null>(null)
  const [trocoTxt, setTrocoTxt] = useState('')

  useEffect(() => {
    let vivo = true
    setInfo(null)
    if (!comandaId) return
    void fetch(`/api/admin/pdv/pagamento?comandaId=${comandaId}`, { cache: 'no-store' }).then(async (r) => {
      if (!vivo || !r.ok) return
      const j = await r.json()
      setInfo(j)
      // Pré-preenche com o que a conta já tem (segundo lançamento na mesma conta).
      if (j.atual) {
        setEscolha(j.atual.escolha)
        setPrecisaTroco(j.atual.escolha === 'dinheiro' ? j.atual.trocoPara !== null : null)
        setTrocoTxt(j.atual.trocoPara ? String(j.atual.trocoPara).replace('.', ',') : '')
      } else { setEscolha(null); setPrecisaTroco(null); setTrocoTxt('') }
    }).catch(() => {})
    return () => { vivo = false }
  }, [comandaId, versao])

  const exige = info?.tipo === 'balcao'
  const total = Math.round(((info?.totalAtual ?? 0) + (info?.taxaPendente ?? 0) + subtotalCarrinho) * 100) / 100
  const trocoPara = escolha === 'dinheiro' && precisaTroco ? Number(trocoTxt.replace(/\./g, '').replace(',', '.')) || 0 : null
  const pagamento: PagamentoPdv | null = escolha ? { escolha, trocoPara: escolha === 'dinheiro' && precisaTroco ? trocoPara : null } : null
  const erro = !exige ? null
    : escolha === 'dinheiro' && precisaTroco === null ? 'Diga se precisa de troco.'
    : escolha === 'dinheiro' && precisaTroco && !trocoTxt.trim() ? 'Informe para quanto é o troco.'
    : erroPagamentoPdv(pagamento, total)

  const chaveEstado = `${exige}|${escolha}|${precisaTroco}|${trocoTxt}|${total}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onMudar({ exige, pagamento: exige ? pagamento : null, erro }) }, [chaveEstado])

  const atalhos = useMemo(() => atalhosTroco(total), [total])
  if (!exige || !info) return null
  const levar = trocoLevar(total, trocoPara)
  const formas = info.formas.length ? info.formas : (['dinheiro', 'pix', 'credito', 'debito'] as EscolhaPdv[])

  return (
    <section className="rounded-menuzia border border-border bg-[#f9fafb] p-3" data-testid="pdv-pagamento" aria-label="Pagamento">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pagamento</span>
        <span className="text-[12px] text-text-subtle">{statusAReceber(info.entrega ? 'entrega' : 'retirada')}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {formas.map((f) => {
          const Icone = ICONE[f]
          const sel = escolha === f
          return (
            <button key={f} type="button" data-testid={`pdv-pag-${f}`} aria-pressed={sel}
              onClick={() => { setEscolha(f); if (f !== 'dinheiro') { setPrecisaTroco(null); setTrocoTxt('') } }}
              className={`flex min-h-[52px] items-center gap-2 rounded-menuzia border px-3 text-left text-[14px] font-semibold transition-colors ${sel ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white text-text-main hover:border-primary'}`}>
              <Icone className="h-5 w-5 flex-shrink-0" aria-hidden />
              <span className="leading-tight">{ROTULO_ESCOLHA[f]}</span>
            </button>
          )
        })}
      </div>

      {escolha === 'dinheiro' && (
        <div className="mt-3 space-y-2" data-testid="pdv-troco">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-text-main">Precisa de troco?</span>
            {([['Não', false], ['Sim', true]] as const).map(([r, v]) => (
              <button key={r} type="button" data-testid={`pdv-troco-${v ? 'sim' : 'nao'}`} aria-pressed={precisaTroco === v}
                onClick={() => { setPrecisaTroco(v); if (!v) setTrocoTxt('') }}
                className={`h-[40px] min-w-[64px] rounded-menuzia border px-3 text-[14px] font-semibold ${precisaTroco === v ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white text-text-main'}`}>{r}</button>
            ))}
          </div>
          {precisaTroco && (
            <>
              <p className="text-[13px] font-semibold text-text-main">Troco para quanto?</p>
              <div className="flex flex-wrap gap-2">
                {atalhos.map((v) => (
                  <button key={v} type="button" data-testid={`pdv-troco-atalho-${v}`} onClick={() => setTrocoTxt(String(v))}
                    className={`h-[40px] min-w-[64px] rounded-menuzia border px-3 text-[14px] font-semibold ${trocoTxt === String(v) ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white text-text-main'}`}>R$ {v}</button>
                ))}
                <label className="flex h-[40px] min-w-[120px] flex-1 items-center rounded-menuzia border border-border bg-white px-2 focus-within:border-primary">
                  <span className="mr-1 text-[13px] text-text-subtle">R$</span>
                  <input inputMode="decimal" className="h-full w-full bg-transparent text-[15px] font-semibold outline-none" placeholder="outro valor"
                    value={trocoTxt} onChange={(e) => setTrocoTxt(e.target.value.replace(/[^\d.,]/g, '').slice(0, 9))} data-testid="pdv-troco-valor" />
                </label>
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-3 flex items-baseline justify-between text-[13px]">
        <span className="text-text-subtle">Total da conta</span>
        <span className="font-semibold text-text-main" data-testid="pdv-pag-total">{brl(total)}</span>
      </div>
      {levar > 0 && !erro && (
        <p className="mt-2 rounded-menuzia bg-[#FEF3C7] px-3 py-2 text-[15px] font-semibold text-[#92400E]" data-testid="pdv-levar-troco">
          Levar de troco: {brl(levar)}
        </p>
      )}
      {erro && escolha && <p className="mt-2 text-[12.5px] font-medium text-danger" data-testid="pdv-pag-erro">{erro}</p>}
    </section>
  )
}
