'use client'

import { useEffect, useRef, useState } from 'react'
import { ICONES } from '@/lib/icones-painel'
import {
  PRESETS,
  intervaloDeCampos,
  intervaloDoPreset,
  paraCampoData,
  rotuloDoIntervalo,
  type Intervalo,
  type PresetPeriodo,
} from '@/lib/dashboard-metricas'

/**
 * Filtro de período do Dashboard.
 *
 * Segue o desenho da referência: uma faixa branca com o intervalo escrito por
 * extenso ("20/09/2026 00:00 ~ 26/09/2026 23:59") e um calendário à direita.
 * Clicar abre a escolha — e ali ficam tanto os atalhos que o painel já tinha
 * (Hoje, 7 dias, …) quanto as duas datas soltas, para quem precisa de um
 * recorte específico.
 *
 * A janela fecha no Escape, no clique fora e depois de escolher: um filtro que
 * fica aberto por cima do número que ele acabou de mudar atrapalha a leitura.
 */
export function FiltroPeriodo({
  intervalo,
  preset,
  agora,
  onEscolher,
}: {
  intervalo: Intervalo
  /** Null quando o intervalo veio das datas soltas, não de um atalho. */
  preset: PresetPeriodo | null
  agora: number
  onEscolher: (intervalo: Intervalo, preset: PresetPeriodo | null) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [de, setDe] = useState(() => paraCampoData(intervalo.inicio || agora))
  const [ate, setAte] = useState(() => paraCampoData(intervalo.fim - 1))
  const caixa = useRef<HTMLDivElement>(null)
  const gatilho = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false)
        gatilho.current?.focus()
      }
    }
    const aoClicar = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false)
    }
    window.addEventListener('keydown', aoTeclar)
    window.addEventListener('mousedown', aoClicar)
    return () => {
      window.removeEventListener('keydown', aoTeclar)
      window.removeEventListener('mousedown', aoClicar)
    }
  }, [aberto])

  const aplicarDatas = () => {
    const novo = intervaloDeCampos(de, ate)
    if (!novo) return
    onEscolher(novo, null)
    setAberto(false)
  }

  return (
    <div ref={caixa} className="relative">
      <button
        ref={gatilho}
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label="Escolher o período do dashboard"
        className="flex w-full items-center gap-2 rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white px-3 py-2.5 text-left transition-colors hover:bg-[var(--adm-superficie-2)]"
      >
        <span className="text-[12.8px] font-semibold text-[var(--adm-texto-medio)]">
          {rotuloDoIntervalo(intervalo, agora)}
        </span>
        <svg viewBox="0 0 24 24" className="ml-auto h-[18px] w-[18px] flex-shrink-0 fill-[var(--adm-texto-suave)]" aria-hidden="true">
          {ICONES.calendario.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </button>

      {aberto && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-[min(520px,calc(100vw-40px))] rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-3 shadow-[0_8px_24px_rgba(16,24,40,0.12)]">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--adm-texto-suave)]">Atalhos</p>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  const novo = intervaloDoPreset(p.id, agora)
                  setDe(paraCampoData(novo.inicio || agora))
                  setAte(paraCampoData(novo.fim - 1))
                  onEscolher(novo, p.id)
                  setAberto(false)
                }}
                className={[
                  'rounded-[4.8px] border-[0.8px] px-3 py-1.5 text-[12.8px] font-bold transition-colors',
                  preset === p.id
                    ? 'border-[var(--adm-grafico)] bg-[var(--adm-grafico)] text-white'
                    : 'border-[var(--adm-borda)] bg-[var(--adm-superficie-2)] text-[var(--adm-texto-medio)] hover:border-[var(--adm-grafico)]',
                ].join(' ')}
              >
                {p.label}
              </button>
            ))}
          </div>

          <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wide text-[var(--adm-texto-suave)]">
            Período específico
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--adm-texto-suave)]">De</span>
              <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-full px-2.5" />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-[11px] font-semibold text-[var(--adm-texto-suave)]">Até</span>
              <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-full px-2.5" />
            </label>
            <button
              type="button"
              onClick={aplicarDatas}
              className="h-[36px] flex-shrink-0 rounded-[4.8px] bg-[var(--adm-grafico)] px-4 text-[12.8px] font-bold text-white transition-colors hover:brightness-95"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
