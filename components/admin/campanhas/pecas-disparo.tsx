'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Users, X } from 'lucide-react'
import { PUBLICOS } from '@/lib/mensageria/recorrentes'

/** Peças dos cards de disparo (04/11/2026): dias da semana e públicos do Disparo personalizado. */

const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const DIAS_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/**
 * Dias da semana. Ligado: fundo azul-escuro e texto branco. Desligado: sem fundo, texto cinza e um X vermelho por cima.
 * Sem `onChange` é só leitura (cards).
 */
export function DiasSemana({ dias, onChange, mini = false, testId }: { dias: number[]; onChange?: (d: number[]) => void; mini?: boolean; testId?: string }) {
  const alternar = (d: number) => onChange?.(dias.includes(d) ? dias.filter((x) => x !== d) : [...dias, d].sort((a, b) => a - b))
  const tam = mini ? 'h-[24px] min-w-0 flex-1 max-w-[34px] text-[10.5px]' : 'h-[40px] w-[42px] text-[12px]'
  return (
    <div className={mini ? 'flex gap-[3px]' : 'flex flex-wrap gap-[6px]'} role={onChange ? 'group' : 'list'} aria-label="Dias da semana" data-testid={testId}>
      {DIAS_CURTO.map((rot, i) => {
        const on = dias.includes(i)
        const classe = `relative grid ${tam} place-items-center rounded-[4px] border font-semibold ${on ? 'border-[#112f6b] bg-[#112f6b] text-white' : 'border-transparent bg-transparent text-[#9ca3af]'}`
        const x = !on && <X aria-hidden className="pointer-events-none absolute inset-0 m-auto h-[80%] w-[80%] text-[#ea1d2c] opacity-80" strokeWidth={2} />
        return onChange ? (
          <button key={i} type="button" aria-pressed={on} aria-label={`${DIAS_NOME[i]}: ${on ? 'envia' : 'não envia'}`} onClick={() => alternar(i)}
            className={`${classe} hover:border-[#112f6b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0688d4]`} data-dia={i} data-on={on ? '1' : '0'}>
            {rot}{x}
          </button>
        ) : (
          <span key={i} role="listitem" aria-label={`${DIAS_NOME[i]}: ${on ? 'envia' : 'não envia'}`} className={classe} data-dia={i} data-on={on ? '1' : '0'}>{rot}{x}</span>
        )
      })}
    </div>
  )
}

const ROTULO_PUBLICO = new Map<string, string>(PUBLICOS.map((p) => [p.chave, p.rotulo]))
export const rotuloPublico = (chave: string) => ROTULO_PUBLICO.get(chave) ?? chave

/** Etiquetas dos públicos escolhidos (cards e modal). */
export function TagsPublicos({ publicos, max, onRemover }: { publicos: string[]; max?: number; onRemover?: (chave: string) => void }) {
  const vis = max ? publicos.slice(0, max) : publicos
  const resto = publicos.length - vis.length
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Públicos escolhidos">
      {vis.map((p) => (
        <li key={p} className="inline-flex items-center gap-1 rounded-[4px] bg-[#e8edf7] py-[2px] pl-2 pr-1 text-[11.5px] font-semibold text-[#112f6b]">
          {rotuloPublico(p)}
          {onRemover && (
            <button type="button" onClick={() => onRemover(p)} aria-label={`Tirar ${rotuloPublico(p)}`} className="grid h-5 w-5 place-items-center rounded-[3px] hover:bg-[#d3dcee]"><X className="h-3 w-3" /></button>
          )}
        </li>
      ))}
      {resto > 0 && <li className="rounded-[4px] bg-[#f1f3f6] px-2 py-[2px] text-[11.5px] font-semibold text-[#4b5563]" title={publicos.slice(vis.length).map(rotuloPublico).join(', ')}>+{resto}</li>}
    </ul>
  )
}

/**
 * Escolha dos públicos (vários = união, sem repetir pessoa). Cada opção mostra quantas pessoas tem hoje; o total da
 * união vem do servidor depois de 400 ms parado (sem chamada a cada clique).
 */
export function SeletorPublicos({ selecionados, onChange, tamanhos, testId }: {
  selecionados: string[]
  onChange: (p: string[]) => void
  /** Tamanho de cada público (GET /publicos); null = ainda carregando ou indisponível. */
  tamanhos: Record<string, number> | null
  testId?: string
}) {
  const [uniao, setUniao] = useState<number | null>(null)
  const [contando, setContando] = useState(false)
  const chave = [...selecionados].sort().join(',')

  useEffect(() => {
    if (!chave) { setUniao(0); setContando(false); return }
    let vivo = true
    setContando(true)
    const t = setTimeout(() => {
      fetch('/api/admin/campanhas/recorrentes/publicos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicos: chave.split(',') }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (vivo) setUniao(typeof j?.pessoas === 'number' ? j.pessoas : null) })
        .catch(() => { if (vivo) setUniao(null) })
        .finally(() => { if (vivo) setContando(false) })
    }, 400)
    return () => { vivo = false; clearTimeout(t) }
  }, [chave])

  const alternar = (p: string) => onChange(selecionados.includes(p) ? selecionados.filter((x) => x !== p) : [...selecionados, p])

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2 rounded-[6px] bg-[#f4f7fc] px-3 py-2">
        <Users className="h-4 w-4 text-[#112f6b]" aria-hidden />
        <span className="text-[12.5px] font-semibold text-[#112f6b]" aria-live="polite" data-testid={testId ? `${testId}-uniao` : undefined}>
          {selecionados.length === 0 ? 'Nenhum público escolhido' : contando ? 'Contando…' : uniao === null ? 'Total indisponível' : `${uniao} ${uniao === 1 ? 'pessoa' : 'pessoas'} no total hoje`}
        </span>
        {contando && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#112f6b]" aria-hidden />}
        <span className="text-[11.5px] text-[#5b6472]">Quem está em mais de um público recebe uma vez só.</span>
      </div>
      {selecionados.length > 0 && <TagsPublicos publicos={selecionados} onRemover={(p) => alternar(p)} />}
      <div className="grid gap-1.5 sm:grid-cols-2" role="group" aria-label="Públicos">
        {PUBLICOS.map((p) => {
          const on = selecionados.includes(p.chave)
          const n = tamanhos ? tamanhos[p.chave] : undefined
          return (
            <button key={p.chave} type="button" aria-pressed={on} onClick={() => alternar(p.chave)} data-publico={p.chave}
              className={`flex min-h-[44px] items-center justify-between gap-2 rounded-[5px] border px-2.5 py-1.5 text-left text-[12.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688d4] ${on ? 'border-[#112f6b] bg-[#eef2fa] font-semibold text-[#112f6b]' : 'border-[#e5e7eb] bg-white text-[#374151] hover:border-[#9fb0d0]'}`}>
              <span className="flex items-center gap-2">
                <span className={`grid h-4 w-4 flex-shrink-0 place-items-center rounded-[3px] border ${on ? 'border-[#112f6b] bg-[#112f6b] text-white' : 'border-[#c4cad4] bg-white'}`} aria-hidden>{on && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                {p.rotulo}
              </span>
              <span className="flex-shrink-0 rounded-[3px] bg-[#f1f3f6] px-1.5 py-[1px] text-[11px] font-semibold tabular-nums text-[#4b5563]">{n === undefined ? '…' : `~${n}`}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
