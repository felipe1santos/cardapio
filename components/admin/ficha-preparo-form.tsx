'use client'

import { useEffect, useMemo, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarFicha, salvarFicha, normalizarFicha, type FichaPreparo } from '@/lib/queries/fichas'
import { enviarImagemItem } from '@/lib/queries/cardapio'

/**
 * "Ficha de preparo (cozinha)" no cadastro do item (2026-09-30): ingredientes com
 * quantidade, passos (com foto opcional) e tempo estimado. Aparece na tela da cozinha no
 * "Como fazer". Grava sozinha ao clicar em "Salvar ficha" (independe do resto do item).
 */
export function FichaPreparoForm({ itemId, restauranteId }: { itemId: string | null; restauranteId: string | null }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [ficha, setFicha] = useState<FichaPreparo>({ ingredientes: [], passos: [], tempoMin: null })
  const [carregado, setCarregado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null)
  const [enviandoFoto, setEnviandoFoto] = useState<number | null>(null)

  useEffect(() => {
    if (!itemId) return
    setCarregado(false)
    buscarFicha(supabase, itemId).then((f) => { setFicha(f ?? { ingredientes: [], passos: [], tempoMin: null }); setCarregado(true) }, () => setCarregado(true))
  }, [supabase, itemId])

  if (!itemId) {
    return <p className="mt-4 text-[12px] text-text-subtle">Salve o item para cadastrar a ficha de preparo da cozinha.</p>
  }

  const set = (f: Partial<FichaPreparo>) => { setFicha((prev) => ({ ...prev, ...f })); setMsg(null) }

  async function salvar() {
    if (!restauranteId || !itemId) return
    setSalvando(true)
    try {
      await salvarFicha(supabase, restauranteId, itemId, normalizarFicha(ficha))
      setMsg({ tom: 'ok', texto: 'Ficha de preparo salva.' })
    } catch {
      setMsg({ tom: 'erro', texto: 'Não foi possível salvar a ficha.' })
    } finally {
      setSalvando(false)
    }
  }

  async function foto(i: number, arquivo: File | undefined) {
    if (!arquivo || !restauranteId) return
    setEnviandoFoto(i)
    try {
      const url = await enviarImagemItem(supabase, restauranteId, arquivo, 'thumb')
      setFicha((prev) => ({ ...prev, passos: prev.passos.map((p, j) => (j === i ? { ...p, fotoUrl: url } : p)) }))
    } catch {
      setMsg({ tom: 'erro', texto: 'Não foi possível enviar a foto.' })
    } finally {
      setEnviandoFoto(null)
    }
  }

  const campo = 'rounded-menuzia border border-border px-2 py-1.5 text-[13px] outline-none focus:border-primary'
  return (
    <div className="mt-5" data-testid="ficha-preparo">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Ficha de preparo (cozinha)</div>
      <p className="mb-2 text-[11px] text-text-subtle">Opcional. Aparece na tela da cozinha em “Como fazer”, ao tocar no item do pedido.</p>
      {!carregado ? <div className="h-16 animate-pulse rounded-menuzia bg-page" /> : (
        <>
          <div className="text-[12px] font-semibold text-text-main">Ingredientes</div>
          {ficha.ingredientes.map((ing, i) => (
            <div key={i} className="mt-1.5 flex gap-2">
              <input value={ing.nome} placeholder="Ingrediente" className={`${campo} min-w-0 flex-1`} data-testid={`ficha-ing-nome-${i}`}
                onChange={(e) => set({ ingredientes: ficha.ingredientes.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)) })} />
              <input value={ing.quantidade} placeholder="Qtd. (ex.: 120 g)" className={`${campo} w-[120px]`} data-testid={`ficha-ing-qtd-${i}`}
                onChange={(e) => set({ ingredientes: ficha.ingredientes.map((x, j) => (j === i ? { ...x, quantidade: e.target.value } : x)) })} />
              <button type="button" aria-label="Remover ingrediente" className="px-2 text-text-subtle hover:text-danger" onClick={() => set({ ingredientes: ficha.ingredientes.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button type="button" data-testid="ficha-add-ing" onClick={() => set({ ingredientes: [...ficha.ingredientes, { nome: '', quantidade: '' }] })} className="mt-1.5 text-[12px] font-semibold text-primary">+ Ingrediente</button>

          <div className="mt-3 text-[12px] font-semibold text-text-main">Modo de preparo</div>
          {ficha.passos.map((p, i) => (
            <div key={i} className="mt-1.5 flex gap-2">
              <span className="mt-1.5 w-5 flex-shrink-0 text-right text-[12px] font-semibold text-text-subtle">{i + 1}.</span>
              <textarea value={p.texto} rows={2} placeholder="O que fazer neste passo" className={`${campo} min-w-0 flex-1`} data-testid={`ficha-passo-${i}`}
                onChange={(e) => set({ passos: ficha.passos.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)) })} />
              <label className="flex w-[64px] cursor-pointer flex-col items-center justify-center rounded-menuzia border border-dashed border-border text-[10px] text-text-subtle hover:border-primary">
                {p.fotoUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.fotoUrl} alt="" className="h-[48px] w-[60px] rounded-[2px] object-cover" />
                  : enviandoFoto === i ? 'Enviando…' : '+ Foto'}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => void foto(i, e.target.files?.[0])} />
              </label>
              <button type="button" aria-label="Remover passo" className="px-1 text-text-subtle hover:text-danger" onClick={() => set({ passos: ficha.passos.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button type="button" data-testid="ficha-add-passo" onClick={() => set({ passos: [...ficha.passos, { texto: '', fotoUrl: null }] })} className="mt-1.5 text-[12px] font-semibold text-primary">+ Passo</button>

          <label className="mt-3 flex items-center gap-2 text-[12px] font-semibold text-text-main">
            Tempo estimado
            <input value={ficha.tempoMin ?? ''} inputMode="numeric" placeholder="—" className={`${campo} w-16 text-center`} data-testid="ficha-tempo"
              onChange={(e) => { const n = e.target.value.replace(/\D/g, '').slice(0, 3); set({ tempoMin: n ? Number(n) : null }) }} />
            min
          </label>

          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={() => void salvar()} disabled={salvando} data-testid="ficha-salvar"
              className="rounded-menuzia bg-primary px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark disabled:opacity-50">
              {salvando ? 'Salvando…' : 'Salvar ficha'}
            </button>
            {msg && <span className={['text-[12px]', msg.tom === 'ok' ? 'text-status-ready' : 'text-danger'].join(' ')}>{msg.texto}</span>}
          </div>
        </>
      )}
    </div>
  )
}
