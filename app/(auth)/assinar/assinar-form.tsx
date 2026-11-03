'use client'

import { useState } from 'react'
import { authLabel } from '@/components/auth/auth-shell'
import { CamposAssinatura } from '@/components/auth/campos-assinatura'
import { BENEFICIOS, PLANOS, type Plano } from '@/lib/assinatura/planos'

/** Página /assinar (link direto): escolha do plano + os mesmos campos do modal do login. */
export function AssinarForm({ error, planoInicial }: { error?: string; planoInicial: Plano }) {
  const [plano, setPlano] = useState<Plano>(planoInicial)
  return (
    <>
      <fieldset className="mb-[20px]">
        <legend className={authLabel}>Plano</legend>
        <div className="grid gap-[8px] sm:grid-cols-2">
          {(Object.keys(PLANOS) as Plano[]).map((p) => {
            const ativo = plano === p
            return (
              <label key={p} className={`block cursor-pointer rounded-[4px] border p-[12px] ${ativo ? 'border-[#0165AD] bg-[#E6F1FA]' : 'border-[#C4C9D0] bg-white'}`}>
                <input type="radio" name="plano-escolha" value={p} checked={ativo} onChange={() => setPlano(p)} className="sr-only" />
                <span className="flex items-baseline justify-between gap-[8px]">
                  <span className="text-[14px] font-semibold text-[#1F2937]">{PLANOS[p].nome.replace('Menuzia ', '')}</span>
                  <span className="text-[14px] font-semibold text-[#0165AD]">R$ {PLANOS[p].valor}<span className="text-[11px] font-medium text-[#6B7280]">/mês</span></span>
                </span>
                <span className="mt-[4px] block text-[12px] leading-[16px] text-[#4B5563]">{BENEFICIOS[p].descricao}</span>
              </label>
            )
          })}
        </div>
      </fieldset>
      <CamposAssinatura plano={plano} origem="pagina" erro={error} />
    </>
  )
}
