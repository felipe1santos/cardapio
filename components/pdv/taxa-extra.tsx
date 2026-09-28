'use client'

import { useState } from 'react'
import { formatBRL, lerValor } from './util'

/**
 * Taxa manual SÓ desta conta (0106): "Couvert", "Taxa de serviço", "Taxa extra"… em R$.
 *
 * Não é item: não entra no cardápio, no catálogo nem em outra conta. O banco grava com a
 * conta aberta, recusa conta fechada/cancelada, confere que o já pago não passa do novo
 * total e audita quem, quando, nome e valor. Usado no PDV, em Mesas e no fechamento.
 */

const SUGESTOES = ['Couvert', 'Taxa de serviço', 'Taxa extra']

export interface TaxaExtraAtual {
  nome: string
  valor: number
}

export function TaxaExtraModal({
  atual,
  onVoltar,
  onSalvar,
}: {
  atual: TaxaExtraAtual | null
  onVoltar: () => void
  /** valor 0 remove. Devolve a mensagem de erro, ou null quando deu certo. */
  onSalvar: (nome: string, valor: number) => Promise<string | null>
}) {
  const [nome, setNome] = useState(atual?.nome ?? '')
  const [valor, setValor] = useState(atual ? atual.valor.toFixed(2).replace('.', ',') : '')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const v = lerValor(valor || '0')
  const valido = nome.trim().length >= 2 && nome.trim().length <= 40 && Number.isFinite(v) && v > 0 && v <= 9999.99

  async function enviar(n: string, val: number) {
    setErro(null)
    setEnviando(true)
    const e = await onSalvar(n, val)
    setEnviando(false)
    if (e) setErro(e)
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onClick={onVoltar}>
      <div
        className="w-full max-w-sm rounded-menuzia bg-main p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={atual ? 'Alterar taxa' : 'Adicionar taxa'}
        data-testid="taxa-extra-modal"
      >
        <h2 className="text-[15px] font-bold text-text-main">{atual ? 'Alterar taxa' : 'Adicionar taxa'}</h2>
        <p className="mt-1 text-[12px] text-text-subtle">Vale só para esta conta. Não vira item do cardápio.</p>

        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Nome da taxa</span>
          <input
            autoFocus
            value={nome}
            maxLength={40}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Couvert"
            data-testid="taxa-extra-nome"
            className="w-full rounded-menuzia border border-border px-3 py-2 text-[13px] focus:border-primary focus:outline-none"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGESTOES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setNome(s)}
              className={['rounded-menuzia border px-2.5 py-1 text-[11.5px] font-semibold', nome === s ? 'border-primary bg-primary text-white' : 'border-border text-text-main hover:border-primary'].join(' ')}
            >
              {s}
            </button>
          ))}
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Valor (R$)</span>
          <input
            value={valor}
            inputMode="decimal"
            onChange={(e) => setValor(e.target.value)}
            placeholder="0,00"
            data-testid="taxa-extra-valor"
            className="w-full rounded-menuzia border border-border px-3 py-2 text-[13px] focus:border-primary focus:outline-none"
          />
        </label>
        {valido && <p className="mt-1.5 text-[12px] text-text-subtle">Entra no total da conta: + {formatBRL(v)}</p>}
        {erro && <p className="mt-2 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger" data-testid="taxa-extra-erro">{erro}</p>}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onVoltar} disabled={enviando} className="flex-1 rounded-menuzia border border-border py-2.5 text-[13px] font-semibold">
            Voltar
          </button>
          <button
            type="button"
            disabled={!valido || enviando}
            onClick={() => void enviar(nome.trim(), v)}
            data-testid="taxa-extra-salvar"
            className="flex-[2] rounded-menuzia bg-primary py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
        {atual && (
          <button
            type="button"
            disabled={enviando}
            onClick={() => void enviar(atual.nome, 0)}
            data-testid="taxa-extra-remover"
            className="mt-2 w-full rounded-menuzia border border-danger py-2 text-[12px] font-bold uppercase tracking-wide text-danger hover:bg-danger-bg disabled:opacity-40"
          >
            Remover taxa
          </button>
        )}
      </div>
    </div>
  )
}
