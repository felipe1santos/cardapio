'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ROTULO_FORMA, type FormaPagamento } from '@/lib/conta'
import type { RegrasSalao } from '@/lib/auth/permissoes'

/**
 * Taxa de serviço padrão, formas de pagamento aceitas nas mesas e as regras do salão
 * por papel. Taxa e formas: quem gerencia mesas. Regras: só o dono. A rota confere de novo.
 *
 * O lugar dela é **Ajustes › Mesas** (`embutida`). O salão mantém o mesmo formulário num
 * modal para o gerente, que gerencia mesas mas não entra em Ajustes.
 */

const REGRAS: { chave: keyof RegrasSalao; titulo: string; ajuda: string }[] = [
  {
    chave: 'garcomRecebe',
    titulo: 'Garçom recebe pagamento e fecha a conta',
    ajuda: 'Desligado, só o caixa (atendente) e a gestão cobram. Estorno e fiado continuam com a gestão.',
  },
  {
    chave: 'garcomTransfere',
    titulo: 'Garçom transfere mesa e itens',
    ajuda: 'Sempre com motivo registrado. Desligado, só a gestão transfere.',
  },
  {
    chave: 'caixaDesconto',
    titulo: 'Caixa ajusta taxa de serviço e desconto',
    ajuda: 'Sempre com motivo registrado. Desligado, só a gestão ajusta.',
  },
]

export function ConfigConta({ onFechar, embutida = false }: { onFechar?: () => void; embutida?: boolean }) {
  const [taxa, setTaxa] = useState('')
  const [formas, setFormas] = useState<FormaPagamento[]>([])
  const [disponiveis, setDisponiveis] = useState<FormaPagamento[]>([])
  const [regras, setRegras] = useState<RegrasSalao | null>(null)
  const [podeEditarRegras, setPodeEditarRegras] = useState(false)
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
      setRegras(corpo.regras ?? null)
      setPodeEditarRegras(corpo.podeEditarRegras === true)
    })()
  }, [])

  async function salvar() {
    setSalvando(true)
    setErro(null)
    setSalvo(false)
    const r = await fetch('/api/admin/mesas/configuracao', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taxaServicoPadrao: Number((taxa || '0').replace(',', '.')),
        formasPagamento: formas,
        ...(podeEditarRegras && regras ? { regras } : {}),
      }),
    })
    const corpo = await r.json().catch(() => ({}))
    setSalvando(false)
    if (!r.ok) setErro(corpo.error ?? 'Não foi possível salvar.')
    else setSalvo(true)
  }

  const conteudo = (
    <>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-text-main">Conta e pagamentos</h2>
          {!embutida && (
            <button onClick={onFechar} aria-label="Fechar" className="-mr-2 grid h-[40px] w-[40px] place-items-center text-text-subtle hover:text-text-main">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Taxa de serviço padrão (%)</span>
          <input
            value={taxa}
            inputMode="decimal"
            onChange={(e) => setTaxa(e.target.value.replace(/[^\d,.]/g, ''))}
            className="h-[44px] w-32 rounded-menuzia border border-border px-2.5 text-[13px] outline-none focus:border-primary lg:h-9"
            aria-label="Taxa de serviço padrão"
          />
          <span className="mt-1 block text-[11px] text-text-subtle">
            Vale para contas abertas a partir de agora. Use 0 para não cobrar. A gestão ainda pode ajustar em cada conta.
          </span>
        </label>

        <fieldset className="mt-4">
          <legend className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Formas de pagamento aceitas</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {disponiveis.map((f) => (
              <label key={f} className="flex min-h-[40px] items-center gap-2 rounded-menuzia border border-border px-2.5 py-2 text-[13px] lg:min-h-0">
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
            É só o registro do que o cliente pagou — nenhuma cobrança é feita pelo sistema. Fiado exige autorização da
            gestão e o nome de quem fica devendo.
          </span>
        </fieldset>

        {regras && (
          <fieldset className="mt-4">
            <legend className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
              Quem pode o quê no salão {podeEditarRegras ? '' : '(só o dono altera)'}
            </legend>
            <div className="space-y-1.5">
              {REGRAS.map((r) => (
                <label key={r.chave} className="flex items-start gap-2 rounded-menuzia border border-border px-2.5 py-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-[18px] w-[18px] flex-shrink-0"
                    checked={regras[r.chave]}
                    disabled={!podeEditarRegras}
                    onChange={(e) => setRegras((atual) => (atual ? { ...atual, [r.chave]: e.target.checked } : atual))}
                  />
                  <span>
                    <span className="block text-[13px] text-text-main">{r.titulo}</span>
                    <span className="block text-[11px] text-text-subtle">{r.ajuda}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {erro && <p className="mt-3 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] text-danger" role="alert">{erro}</p>}
        {salvo && <p className="mt-3 rounded-menuzia bg-price-bg px-3 py-2 text-[12px] text-price-text" role="status">Configuração salva.</p>}

        <div className="mt-4 flex gap-2">
          {!embutida && <Button variant="outline" className="flex-1" onClick={onFechar}>Fechar</Button>}
          <Button className="flex-1" disabled={salvando || formas.length === 0} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
    </>
  )

  if (embutida) return <div className="rounded-menuzia border border-border bg-main p-5">{conteudo}</div>

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" onClick={onFechar}>
      <div className="w-full max-w-md rounded-menuzia bg-main p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Conta e pagamentos">
        {conteudo}
      </div>
    </div>
  )
}
