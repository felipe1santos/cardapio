'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ROTULO_FORMA, type FormaPagamento } from '@/lib/conta'

/**
 * Taxa de serviço padrão e formas de pagamento aceitas nas mesas. Só para quem gerencia
 * mesas — a rota confere de novo.
 */
export function ConfigConta({ onFechar }: { onFechar: () => void }) {
  const [taxa, setTaxa] = useState('')
  const [formas, setFormas] = useState<FormaPagamento[]>([])
  const [disponiveis, setDisponiveis] = useState<FormaPagamento[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/admin/mesas/configuracao', { cache: 'no-store' })
      const corpo = await r.json().catch(() => null)
      if (!r.ok) {
        setErro(corpo?.error ?? 'Não foi possível carregar.')
        return
      }
      setTaxa(String(corpo.taxaServicoPadrao).replace('.', ','))
      setFormas(corpo.formasPagamento)
      setDisponiveis(corpo.formasDisponiveis)
    })()
  }, [])

  async function salvar() {
    setSalvando(true)
    setErro(null)
    setSalvo(false)
    const r = await fetch('/api/admin/mesas/configuracao', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taxaServicoPadrao: Number((taxa || '0').replace(',', '.')), formasPagamento: formas }),
    })
    const corpo = await r.json().catch(() => ({}))
    setSalvando(false)
    if (!r.ok) setErro(corpo.error ?? 'Não foi possível salvar.')
    else setSalvo(true)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onFechar}>
      <div className="w-full max-w-md rounded-menuzia bg-main p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Conta e pagamentos">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-text-main">Conta e pagamentos</h2>
          <button onClick={onFechar} aria-label="Fechar" className="text-text-subtle hover:text-text-main">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Taxa de serviço padrão (%)</span>
          <input
            value={taxa}
            inputMode="decimal"
            onChange={(e) => setTaxa(e.target.value.replace(/[^\d,.]/g, ''))}
            className="h-9 w-32 rounded-menuzia border border-border px-2.5 text-[13px] outline-none focus:border-primary"
            aria-label="Taxa de serviço padrão"
          />
          <span className="mt-1 block text-[11px] text-text-subtle">
            Vale para contas abertas a partir de agora. Use 0 para não cobrar. O gerente ainda pode ajustar em cada conta.
          </span>
        </label>

        <fieldset className="mt-4">
          <legend className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Formas de pagamento aceitas</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {disponiveis.map((f) => (
              <label key={f} className="flex items-center gap-2 rounded-menuzia border border-border px-2.5 py-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={formas.includes(f)}
                  onChange={(e) => setFormas((atual) => (e.target.checked ? [...atual, f] : atual.filter((x) => x !== f)))}
                />
                {ROTULO_FORMA[f]}
              </label>
            ))}
          </div>
          <span className="mt-1 block text-[11px] text-text-subtle">
            É só o registro do que o cliente pagou — nenhuma cobrança é feita pelo sistema.
          </span>
        </fieldset>

        {erro && <p className="mt-3 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] text-danger" role="alert">{erro}</p>}
        {salvo && <p className="mt-3 rounded-menuzia bg-price-bg px-3 py-2 text-[12px] text-price-text" role="status">Configuração salva.</p>}

        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onFechar}>Fechar</Button>
          <Button className="flex-1" disabled={salvando || formas.length === 0} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
