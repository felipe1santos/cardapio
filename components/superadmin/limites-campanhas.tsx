'use client'

import { useState, useTransition } from 'react'
import { definirLimitesCampanhasAction } from '@/app/superadmin/actions'

/** Super Admin › tetos das campanhas (12/10): valem para todas as lojas; cada loja escolhe abaixo disso. */
export function LimitesCampanhas({ inicial }: { inicial: { disparoTetoDia: number; frequenciaDias: number; pushTetoDia: number } }) {
  const [v, setV] = useState({ disparoTetoDia: String(inicial.disparoTetoDia), frequenciaDias: String(inicial.frequenciaDias), pushTetoDia: String(inicial.pushTetoDia) })
  const [msg, setMsg] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  const campo = (k: keyof typeof v, rotulo: string, dica: string) => (
    <label className="flex flex-col gap-1 text-[12.5px]">
      <span className="font-semibold text-text-main">{rotulo}</span>
      <input inputMode="numeric" value={v[k]} onChange={(e) => { setV((x) => ({ ...x, [k]: e.target.value })); setMsg(null) }}
        className="h-[34px] w-[96px] rounded-[12px] border border-border px-2 tabular-nums" data-testid={`limite-${k}`} />
      <span className="text-text-subtle">{dica}</span>
    </label>
  )
  return (
    <form className="rounded-[20px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white p-[16px] sm:rounded-[24px] sm:p-[24px]" data-testid="limites-campanhas"
      onSubmit={(e) => { e.preventDefault(); iniciar(async () => { const r = await definirLimitesCampanhasAction(v); setMsg(r.ok ? r.mensagem ?? 'Salvo' : r.erro) }) }}>
      <p className="text-[16px] font-semibold leading-[24px] text-text-main">Limites das campanhas (todas as lojas)</p>
      <div className="mt-3 flex flex-wrap gap-5">
        {campo('disparoTetoDia', 'WhatsApp: máximo por dia', 'Teto do limite diário de cada loja (padrão 150).')}
        {campo('frequenciaDias', 'WhatsApp: 1 disparo a cada', 'dias, por cliente (padrão 3).')}
        {campo('pushTetoDia', 'Push: campanhas por dia', 'Teto por loja (padrão 1).')}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={pendente} className="h-[34px] rounded-[12px] bg-primary px-3 text-[13px] font-bold text-white hover:bg-primary-dark disabled:opacity-50">Salvar limites</button>
        {msg && <span role="status" className="text-[12.5px] text-text-main">{msg}</span>}
      </div>
    </form>
  )
}
