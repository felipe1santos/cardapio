'use client'

import { useMemo, useState } from 'react'
import { ROTULO_TIPO_TAXA, TAXAS_SUGERIDAS, calcularTaxas, rotuloTaxa, type TaxaEntrada, type TipoTaxa } from '@/lib/taxas-conta'
import { formatBRL } from './util'
import { BotaoPdv, ICONES_PDV, TelaPdv } from './tela-pdv'

/**
 * Taxas da conta (0124, 2026-10-01): quantas forem precisas — Couvert artístico (por
 * pessoa × quantidade), Taxa de rolha (fixa), uma % do subtotal ou uma personalizada.
 * Atalhos de um toque com as taxas padrão da loja (Ajustes › Mesas). Cada taxa sai como
 * LINHA separada na conta e no fechamento; o servidor recalcula tudo ao salvar.
 */
interface Linha { chave: string; nome: string; tipo: TipoTaxa; base: string; quantidade: string }

let seq = 0
const nova = (t: Partial<TaxaEntrada> = {}): Linha => ({
  chave: `t${++seq}`,
  nome: t.nome ?? '',
  tipo: t.tipo ?? 'fixo',
  base: t.base !== undefined ? String(t.base).replace('.', ',') : '',
  quantidade: String(t.quantidade ?? 1),
})

export function TaxasModal({
  atuais,
  padrao,
  subtotal,
  onVoltar,
  onSalvar,
}: {
  atuais: TaxaEntrada[]
  /** Taxas padrão da loja; vazio = sugestões do sistema. */
  padrao: TaxaEntrada[]
  /** Subtotal usado na prévia das taxas em % (o servidor recalcula ao salvar). */
  subtotal: number
  onVoltar: () => void
  /** Devolve a mensagem de erro, ou null quando salvou. */
  onSalvar: (taxas: TaxaEntrada[]) => Promise<string | null>
}) {
  const [linhas, setLinhas] = useState<Linha[]>(() => atuais.map((t) => nova(t)))
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const atalhos = padrao.length ? padrao : TAXAS_SUGERIDAS

  const entrada = linhas.map((l) => ({ nome: l.nome, tipo: l.tipo, base: l.base, quantidade: Number(l.quantidade) || 1 }))
  const previa = useMemo(() => calcularTaxas(entrada, subtotal), [JSON.stringify(entrada), subtotal]) // eslint-disable-line react-hooks/exhaustive-deps
  const soma = previa.ok ? previa.taxas.reduce((s, t) => s + t.valor, 0) : null
  const set = (chave: string, patch: Partial<Linha>) => setLinhas((x) => x.map((l) => (l.chave === chave ? { ...l, ...patch } : l)))

  async function salvar() {
    if (!previa.ok) { setErro(previa.erro); return }
    setErro(null)
    setEnviando(true)
    const e = await onSalvar(previa.taxas.map(({ nome, tipo, base, quantidade }) => ({ nome, tipo, base, quantidade })))
    setEnviando(false)
    if (e) setErro(e)
  }

  return (
    <TelaPdv
      titulo="Taxas da conta"
      onVoltar={onVoltar}
      testid="taxas-modal"
      larguraMax={560} pequena
      sujo={JSON.stringify(entrada) !== JSON.stringify(atuais.map((t) => ({ nome: t.nome, tipo: t.tipo, base: String(t.base).replace('.', ','), quantidade: t.quantidade ?? 1 })))}
      rodape={
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-[15px] text-text-subtle">Total de taxas: <strong className="text-[18px] text-text-main" data-testid="taxas-soma">{soma !== null ? formatBRL(soma) : '—'}</strong></span>
          <BotaoPdv icone={ICONES_PDV.voltar} onClick={onVoltar}>Voltar</BotaoPdv>
          <BotaoPdv icone={ICONES_PDV.check} tipo="sucesso" onClick={() => void salvar()} disabled={enviando} testid="taxas-salvar" className="min-w-[200px]">
            {enviando ? 'Salvando…' : 'Salvar taxas'}
          </BotaoPdv>
        </div>
      }
    >
        <div className="space-y-3 px-5 py-4">
          <p className="text-[13px] text-text-subtle">Valem só para esta conta. Cada uma aparece como uma linha no resumo, no fechamento e no recibo.</p>
          <div className="flex flex-wrap gap-2">
            {atalhos.map((t) => (
              <button key={t.nome} type="button" onClick={() => setLinhas((x) => [...x, nova(t)])}
                className="min-h-[48px] rounded-menuzia border border-primary/40 bg-primary/5 px-3 text-[13px] font-semibold text-primary active:scale-[0.97]" data-testid="taxa-atalho">
                + {rotuloTaxa({ ...t, quantidade: t.quantidade ?? 1 })}
              </button>
            ))}
            <button type="button" onClick={() => setLinhas((x) => [...x, nova()])} className="min-h-[48px] rounded-menuzia border border-dashed border-border px-3 text-[13px] font-semibold text-text-main active:scale-[0.97]" data-testid="taxa-adicionar">
              + Adicionar taxa
            </button>
          </div>
          {linhas.length === 0 && <p className="rounded-menuzia bg-page px-3 py-4 text-center text-[13px] text-text-subtle">Nenhuma taxa nesta conta.</p>}
          {linhas.map((l, i) => {
            const valor = previa.ok ? previa.taxas[i]?.valor : undefined
            return (
              <div key={l.chave} className="rounded-menuzia border border-border bg-white p-3" data-testid="taxa-linha">
                <div className="flex gap-2">
                  <input value={l.nome} onChange={(e) => set(l.chave, { nome: e.target.value.slice(0, 40) })} placeholder="Nome (ex.: Couvert artístico)" autoComplete="off"
                    className="min-h-[48px] min-w-0 flex-1 rounded-menuzia border border-border px-3 text-[14px] focus:border-primary focus:outline-none" data-testid="taxa-nome" />
                  <button type="button" onClick={() => setLinhas((x) => x.filter((y) => y.chave !== l.chave))} aria-label="Remover taxa"
                    className="flex h-[48px] w-[48px] flex-shrink-0 items-center justify-center rounded-menuzia border border-border text-danger" data-testid="taxa-remover">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {(['percentual', 'fixo', 'por_pessoa'] as TipoTaxa[]).map((tp) => (
                    <button key={tp} type="button" onClick={() => set(l.chave, { tipo: tp })} data-testid={`taxa-tipo-${tp}`}
                      className={['min-h-[44px] rounded-menuzia border text-[12px] font-semibold', l.tipo === tp ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-main'].join(' ')}>
                      {ROTULO_TIPO_TAXA[tp]}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-text-subtle">
                    {l.tipo === 'percentual' ? '%' : 'R$'}
                    <input value={l.base} onChange={(e) => set(l.chave, { base: e.target.value })} inputMode="decimal" placeholder={l.tipo === 'percentual' ? '10' : '0,00'}
                      className="min-h-[48px] w-full rounded-menuzia border border-border px-3 text-[15px] font-semibold text-text-main focus:border-primary focus:outline-none" data-testid="taxa-base" />
                  </label>
                  {l.tipo === 'por_pessoa' && (
                    <label className="flex items-center gap-1.5 text-[13px] text-text-subtle">
                      ×
                      <input value={l.quantidade} onChange={(e) => set(l.chave, { quantidade: e.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric"
                        className="min-h-[48px] w-[64px] rounded-menuzia border border-border px-2 text-center text-[15px] font-semibold text-text-main focus:border-primary focus:outline-none" data-testid="taxa-qtd" />
                      pessoas
                    </label>
                  )}
                  <span className="ml-auto w-[88px] text-right text-[15px] font-semibold text-text-main" data-testid="taxa-valor">{valor !== undefined ? formatBRL(valor) : '—'}</span>
                </div>
              </div>
            )
          })}
          {erro && <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger" data-testid="taxas-erro">{erro}</p>}
        </div>
    </TelaPdv>
  )
}

/** Taxas atuais da conta como entrada do modal (inclui a taxa manual antiga, de antes da 0124). */
export function taxasIniciais(conta: { taxas?: TaxaEntrada[]; taxaExtra: { nome: string; valor: number } | null }): TaxaEntrada[] {
  if (conta.taxas && conta.taxas.length) return conta.taxas.map(({ nome, tipo, base, quantidade }) => ({ nome, tipo, base, quantidade }))
  return conta.taxaExtra ? [{ nome: conta.taxaExtra.nome, tipo: 'fixo', base: conta.taxaExtra.valor }] : []
}
