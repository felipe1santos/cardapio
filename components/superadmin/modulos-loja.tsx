'use client'

import { useState, useTransition } from 'react'
import { alternarModuloAction } from '@/app/superadmin/actions'
import { INFO_MODULO, MODULOS, type Modulo, type ModulosDaLoja } from '@/lib/modulos'

/**
 * Coluna "Módulos" do Super Admin (0176): um interruptor por módulo pago da loja. Só o superadmin vê (a página e a
 * ação conferem no servidor); liberar e bloquear vão para a auditoria da loja e da plataforma.
 */
const CURTO: Record<Modulo, string> = { financeiro: 'Financeiro', agente_ia: 'Agente de IA', disparos: 'Disparos' }

export function ModulosLoja({ restauranteId, loja, inicial }: { restauranteId: string; loja: string; inicial: ModulosDaLoja }) {
  const [estado, setEstado] = useState<ModulosDaLoja>(inicial)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  const alternar = (m: Modulo) => {
    const liberar = !estado[m]
    setErro(null)
    setEstado((e) => ({ ...e, [m]: liberar }))
    iniciar(async () => {
      const r = await alternarModuloAction(restauranteId, m, liberar)
      if (!r.ok) { setEstado((e) => ({ ...e, [m]: !liberar })); setErro(r.erro) }
    })
  }

  return (
    <div className="flex w-[150px] flex-col gap-1" data-testid="modulos-loja" aria-busy={pendente}>
      {MODULOS.map((m) => (
        <label key={m} className="flex cursor-pointer items-center justify-between gap-2 text-[11.5px]" title={INFO_MODULO[m].frase}>
          <span className={estado[m] ? 'font-semibold text-text-main' : 'text-text-subtle'}>{CURTO[m]}</span>
          <button
            type="button"
            role="switch"
            aria-checked={estado[m]}
            aria-label={`${INFO_MODULO[m].nome} em ${loja}`}
            disabled={pendente}
            onClick={() => alternar(m)}
            className={`relative h-[18px] w-[32px] flex-shrink-0 rounded-full transition-colors disabled:opacity-60 ${estado[m] ? 'bg-[#16A34A]' : 'bg-[#D1D5DB]'}`}
            data-testid={`modulo-${m}`}
            data-liberado={estado[m] ? '1' : '0'}
          >
            <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-[left] ${estado[m] ? 'left-[16px]' : 'left-[2px]'}`} />
          </button>
        </label>
      ))}
      {erro && <p className="text-[11px] text-[#B91C1C]" role="alert">{erro}</p>}
    </div>
  )
}
