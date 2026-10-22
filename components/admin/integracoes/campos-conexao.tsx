'use client'

import { useState } from 'react'
import { CheckCircle2, ChevronDown } from 'lucide-react'

/**
 * Peças comuns das integrações simplificadas (21/10/2026): só os campos obrigatórios à vista; o que já está salvo
 * aparece como "•••••• salvo ✓ · Trocar" (nunca volta o valor); o resto fica no "Modo avançado", fechado por padrão.
 */
export const CAMPO_CONEXAO = 'h-[38px] w-full rounded-[8px] border border-[#D1D5DB] bg-white px-3 font-mono text-[13px] text-[#1F2937] outline-none focus:border-[#0688D4]'

export function CampoConexao({ rotulo, dica, valor, onChange, salvo, final, segredo = false, testid }: {
  rotulo: string
  dica?: string
  valor: string
  onChange: (v: string) => void
  /** Já existe valor salvo no servidor. */
  salvo: boolean
  /** Últimos caracteres do valor salvo, quando não é segredo (ex.: "…abcd"). */
  final?: string
  segredo?: boolean
  testid?: string
}) {
  const [trocando, setTrocando] = useState(false)
  return (
    <label className="block text-[12px] font-semibold text-[#374151]">
      <span className="flex items-center justify-between gap-2">{rotulo}{dica && <span className="font-normal text-[#9CA3AF]">{dica}</span>}</span>
      {salvo && !trocando ? (
        <span className="mt-1 flex h-[38px] items-center justify-between gap-2 rounded-[8px] border border-[#BBF7D0] bg-[#F0FDF4] px-3 text-[13px] text-[#15803D]" data-testid={testid ? `${testid}-salvo` : undefined}>
          <span className="flex items-center gap-1.5 font-mono">••••••{final ? final : ''} <span className="font-sans font-semibold">salvo</span> <CheckCircle2 className="h-4 w-4" aria-hidden /></span>
          <button type="button" onClick={() => setTrocando(true)} className="font-sans text-[12.5px] font-semibold text-[#0688D4] hover:underline">Trocar</button>
        </span>
      ) : (
        <input type={segredo ? 'password' : 'text'} autoComplete={segredo ? 'new-password' : 'off'} value={valor} onChange={(e) => onChange(e.target.value.trim())} className={`${CAMPO_CONEXAO} mt-1`} data-testid={testid} />
      )}
    </label>
  )
}

export function ModoAvancado({ children, testid }: { children: React.ReactNode; testid?: string }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div data-testid={testid}>
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}
        className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#6B7280] hover:text-[#1F2937]">
        Modo avançado <ChevronDown className={`h-3.5 w-3.5 transition-transform ${aberto ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {aberto && <div className="mt-2 space-y-2 rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12.5px] text-[#374151]">{children}</div>}
    </div>
  )
}

/** Resultado do "Conectar": verde com o que ficou pronto, ou vermelho com o erro em português. */
export function ResultadoConexao({ ok, erro }: { ok: string | null; erro: string | null }) {
  if (erro) return <p className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]" data-testid="conexao-erro">{erro}</p>
  if (ok) return <p className="flex items-center gap-2 rounded-[8px] border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2 text-[13px] font-semibold text-[#15803D]" data-testid="conexao-ok"><CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden />{ok}</p>
  return null
}
