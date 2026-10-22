'use client'

import { useEffect, useMemo, useState } from 'react'
import { Cardholder, CheckCircle, CreditCard, Lightning, Moped, Money, Storefront } from '@phosphor-icons/react'
import { IconePix } from '@/components/icones/origens'
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

// Redesign visual (22/10/2026): blocos grandes com ícone (Phosphor; Pix = o ícone oficial do Kanban). Azul suave →
// azul cheio do PDV com ✓ quando escolhido. Alvo de toque ≥ 48 px e "afundar" ao tocar.
const ICONE: Record<EscolhaPdv, (p: { className?: string }) => React.ReactNode> = {
  dinheiro: (p) => <Money weight="bold" {...p} />,
  pix: (p) => <IconePix {...p} />,
  credito: (p) => <CreditCard weight="bold" {...p} />,
  debito: (p) => <Cardholder weight="bold" {...p} />,
}
const BLOCO = 'relative flex items-center gap-2.5 rounded-[8px] border-2 px-3 text-left font-semibold transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pdv-selecao-borda)] focus-visible:ring-offset-1'
const bloco = (sel: boolean) => `${BLOCO} ${sel ? 'border-[var(--pdv-azul)] bg-[var(--pdv-azul)] text-white shadow-[0_2px_8px_rgba(0,62,131,0.35)]' : 'border-transparent bg-[var(--pdv-azul-suave)] text-[var(--pdv-azul)] hover:border-[var(--pdv-azul)]/40'}`
const MARCA = <CheckCircle weight="fill" className="absolute right-1.5 top-1.5 h-[18px] w-[18px] text-white" aria-hidden />
const PILULA = (sel: boolean) => `h-[48px] min-w-[64px] rounded-[8px] border-2 px-3 text-[15px] font-semibold transition-all active:scale-[0.97] ${sel ? 'border-[var(--pdv-azul)] bg-[var(--pdv-azul)] text-white' : 'border-transparent bg-[var(--pdv-azul-suave)] text-[var(--pdv-azul)]'}`
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
  // "Cobrar agora" registra o pagamento junto com o lançamento; o padrão é receber depois (como sempre foi).
  const [cobrarAgora, setCobrarAgora] = useState(false)

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
      setCobrarAgora(false)
    }).catch(() => {})
    return () => { vivo = false }
  }, [comandaId, versao])

  const exige = info?.tipo === 'balcao'
  const total = Math.round(((info?.totalAtual ?? 0) + (info?.taxaPendente ?? 0) + subtotalCarrinho) * 100) / 100
  const trocoPara = escolha === 'dinheiro' && precisaTroco ? Number(trocoTxt.replace(/\./g, '').replace(',', '.')) || 0 : null
  const pagamento: PagamentoPdv | null = escolha ? { escolha, trocoPara: escolha === 'dinheiro' && precisaTroco ? trocoPara : null, ...(cobrarAgora ? { cobrarAgora: true } : {}) } : null
  const erro = !exige ? null
    : escolha === 'dinheiro' && precisaTroco === null ? 'Diga se precisa de troco.'
    : escolha === 'dinheiro' && precisaTroco && !trocoTxt.trim() ? 'Informe para quanto é o troco.'
    : erroPagamentoPdv(pagamento, total)

  const chaveEstado = `${exige}|${escolha}|${precisaTroco}|${trocoTxt}|${total}|${cobrarAgora}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onMudar({ exige, pagamento: exige ? pagamento : null, erro }) }, [chaveEstado])

  const atalhos = useMemo(() => atalhosTroco(total), [total])
  if (!exige || !info) return null
  const levar = trocoLevar(total, trocoPara)
  const formas = info.formas.length ? info.formas : (['dinheiro', 'pix', 'credito', 'debito'] as EscolhaPdv[])

  return (
    <section className="rounded-[8px] border border-border bg-white p-2.5" data-testid="pdv-pagamento" aria-label="Pagamento">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--pdv-azul)]">Pagamento</span>
        <span className="text-[12px] text-text-subtle">{cobrarAgora ? 'Pago no lançamento' : statusAReceber(info.entrega ? 'entrega' : 'retirada')}</span>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Quando cobrar">
        {([[true, 'Cobrar agora'], [false, info.entrega ? 'Receber na entrega' : 'Receber na retirada']] as const).map(([v, r]) => (
          <button key={r} type="button" role="radio" aria-checked={cobrarAgora === v} data-testid={v ? 'pdv-cobrar-agora' : 'pdv-cobrar-depois'}
            onClick={() => setCobrarAgora(v)}
            className={`${bloco(cobrarAgora === v)} min-h-[48px] text-[14px]`}>
            {v ? <Lightning weight="bold" className="h-6 w-6 flex-shrink-0" aria-hidden /> : info.entrega ? <Moped weight="bold" className="h-6 w-6 flex-shrink-0" aria-hidden /> : <Storefront weight="bold" className="h-6 w-6 flex-shrink-0" aria-hidden />}
            <span className="leading-tight">{r}</span>{cobrarAgora === v && MARCA}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {formas.map((f) => {
          const Icone = ICONE[f]
          const sel = escolha === f
          return (
            <button key={f} type="button" data-testid={`pdv-pag-${f}`} aria-pressed={sel}
              onClick={() => { setEscolha(f); if (f !== 'dinheiro') { setPrecisaTroco(null); setTrocoTxt('') } }}
              className={`${bloco(sel)} min-h-[52px] text-[14px]`}>
              <Icone className={`h-7 w-7 flex-shrink-0 ${sel && f === 'pix' ? 'rounded-[4px] bg-white p-[3px]' : ''}`} />
              <span className="leading-tight">{ROTULO_ESCOLHA[f]}</span>{sel && MARCA}
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
                className={PILULA(precisaTroco === v)}>{r}</button>
            ))}
          </div>
          {precisaTroco && (
            <>
              <p className="text-[13px] font-semibold text-text-main">Troco para quanto?</p>
              <div className="flex flex-wrap gap-2">
                {atalhos.map((v) => (
                  <button key={v} type="button" data-testid={`pdv-troco-atalho-${v}`} onClick={() => setTrocoTxt(String(v))}
                    className={PILULA(trocoTxt === String(v))}>R$ {v}</button>
                ))}
                <label className="flex h-[48px] min-w-[120px] flex-1 items-center rounded-[8px] border-2 border-border bg-white px-2 focus-within:border-[var(--pdv-azul)]">
                  <span className="mr-1 text-[13px] text-text-subtle">R$</span>
                  <input inputMode="decimal" className="h-full w-full bg-transparent text-[15px] font-semibold outline-none" placeholder="outro valor"
                    value={trocoTxt} onChange={(e) => setTrocoTxt(e.target.value.replace(/[^\d.,]/g, '').slice(0, 9))} data-testid="pdv-troco-valor" />
                </label>
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-2 flex items-baseline justify-between rounded-[6px] bg-[var(--pdv-azul-suave)] px-3 py-1.5 text-[14px]">
        <span className="font-semibold text-[var(--pdv-azul)]">Total da conta</span>
        <span className="text-[18px] font-semibold text-[var(--pdv-azul)]" data-testid="pdv-pag-total">{brl(total)}</span>
      </div>
      {levar > 0 && !erro && (
        <p className="mt-2 rounded-menuzia bg-[#FEF3C7] px-3 py-2 text-[15px] font-semibold text-[#92400E]" data-testid="pdv-levar-troco">
          {cobrarAgora ? 'Troco a dar agora' : 'Levar de troco'}: {brl(levar)}
        </p>
      )}
      {erro && escolha && <p className="mt-2 text-[12.5px] font-medium text-danger" data-testid="pdv-pag-erro">{erro}</p>}
    </section>
  )
}
