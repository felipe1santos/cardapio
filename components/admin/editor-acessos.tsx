'use client'

import { AREAS, MODELOS, SENSIVEIS, type Acessos, type Area, type Sensivel } from '@/lib/acessos'

/**
 * Caixas de acesso de um funcionário (Fase 6): áreas do menu + ações sensíveis, com os
 * modelos prontos que preenchem tudo (e podem ser ajustados depois).
 */
export function EditorAcessos({
  acessos,
  onChange,
  papeisPermitidos,
  onModelo,
  podeEquipe = false,
}: {
  acessos: Acessos
  onChange: (a: Acessos) => void
  papeisPermitidos?: string[]
  /** Escolher um modelo também troca o papel base (no cadastro). */
  onModelo?: (papel: string) => void
  /** Só o dono libera a área "Equipe". */
  podeEquipe?: boolean
}) {
  const alterna = <T extends string>(lista: T[], v: T) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v])
  const modelos = MODELOS.filter((m) => !papeisPermitidos || papeisPermitidos.includes(m.papel))
  return (
    <div className="space-y-3" data-testid="editor-acessos">
      {modelos.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Modelos prontos</div>
          <div className="flex flex-wrap gap-1.5">
            {modelos.map((m) => (
              <button key={m.chave} type="button" data-testid={`modelo-${m.chave}`}
                onClick={() => { onChange({ areas: m.acessos.areas.filter((a) => podeEquipe || a !== 'equipe'), sensiveis: [...m.acessos.sensiveis] }); onModelo?.(m.papel) }}
                className="rounded-menuzia border border-border px-2.5 py-1.5 text-[12px] font-semibold text-text-main hover:border-primary hover:text-primary">{m.rotulo}</button>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Acessos (itens do menu)</div>
        <div className="grid grid-cols-2 gap-1.5">
          {AREAS.map((a) => {
            const bloqueada = a.chave === 'equipe' && !podeEquipe
            return (
              <label key={a.chave} className={['flex items-center gap-2 rounded-menuzia border border-border px-2 py-1.5 text-[12.5px]', bloqueada ? 'opacity-50' : 'cursor-pointer hover:bg-page'].join(' ')}>
                <input type="checkbox" disabled={bloqueada} checked={acessos.areas.includes(a.chave)} data-testid={`area-${a.chave}`}
                  onChange={() => onChange({ ...acessos, areas: alterna<Area>(acessos.areas, a.chave) })} className="h-3.5 w-3.5 accent-primary" />
                {a.rotulo}
              </label>
            )
          })}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Permissões sensíveis</div>
        <div className="space-y-1.5">
          {SENSIVEIS.map((s) => (
            <label key={s.chave} className="flex cursor-pointer items-center gap-2 rounded-menuzia border border-border px-2 py-1.5 text-[12.5px] hover:bg-page">
              <input type="checkbox" checked={acessos.sensiveis.includes(s.chave)} data-testid={`sensivel-${s.chave}`}
                onChange={() => onChange({ ...acessos, sensiveis: alterna<Sensivel>(acessos.sensiveis, s.chave) })} className="h-3.5 w-3.5 accent-primary" />
              {s.rotulo}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
