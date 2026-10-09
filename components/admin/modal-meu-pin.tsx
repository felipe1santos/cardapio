'use client'

import { useState } from 'react'
import { estadoMudou } from '@/lib/sessao-cliente'

/**
 * "Meu PIN" (0132): cria ou troca o PIN pessoal de 4 a 6 dígitos. Exige a senha atual — quem
 * acha o painel aberto não troca o PIN de ninguém. O PIN serve para destravar a tela, trocar
 * de operador e (Fase 2) aprovar ações de outra pessoa.
 */
export function ModalMeuPin({ temPin, onFechar }: { temPin: boolean; onFechar: () => void }) {
  const [senha, setSenha] = useState('')
  const [pin, setPin] = useState('')
  const [conf, setConf] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setErro(null)
    if (!/^[0-9]{4,6}$/.test(pin)) return setErro('O PIN tem de 4 a 6 números.')
    if (pin !== conf) return setErro('Os dois PINs não batem.')
    if (!senha) return setErro('Digite a sua senha.')
    setSalvando(true)
    try {
      const r = await fetch('/api/sessao/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha, pin }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return setErro(j.error ?? 'Não foi possível salvar.')
      setOk(true); estadoMudou()
    } finally {
      setSalvando(false)
    }
  }

  const campo = 'h-[40px] w-full rounded-[3px] border border-[#E5E7EB] px-[10px] text-[14px] outline-none focus:border-[#0688D4]'
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#111827]/60 p-4" data-testid="modal-meu-pin" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div className="w-full max-w-[380px] rounded-[3px] border border-[#E5E7EB] bg-white shadow-xl">
        <div className="border-b border-[#E5E7EB] px-[16px] py-[12px]">
          <h2 className="text-[15px] font-semibold text-[#1F2937]">{temPin ? 'Trocar meu PIN' : 'Criar meu PIN'}</h2>
          <p className="mt-[2px] text-[12px] leading-relaxed text-[#6B7280]">De 4 a 6 números, só seu. Serve para aprovar sangrias, estornos e diferenças de caixa dos funcionários, destravar a tela e trocar de operador. Ninguém da loja consegue ver.</p>
        </div>
        {ok ? (
          <div className="px-[16px] py-[16px]">
            <p className="text-[13px] font-medium text-[#16A34A]" data-testid="pin-salvo">PIN salvo.</p>
            <div className="mt-[14px] flex justify-end">
              <button type="button" onClick={onFechar} className="h-[36px] rounded-[3px] bg-[#0688D4] px-[14px] text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-[#0570AE]">Fechar</button>
            </div>
          </div>
        ) : (
          <form className="space-y-[10px] px-[16px] py-[14px]" onSubmit={(e) => { e.preventDefault(); void salvar() }}>
            <label className="block">
              <span className="mb-[4px] block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Sua senha</span>
              <input type="password" autoComplete="current-password" className={campo} value={senha} onChange={(e) => setSenha(e.target.value)} data-testid="meu-pin-senha" />
            </label>
            <label className="block">
              <span className="mb-[4px] block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Novo PIN</span>
              <input type="password" inputMode="numeric" maxLength={6} autoComplete="off" className={campo} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} data-testid="meu-pin-novo" />
            </label>
            <label className="block">
              <span className="mb-[4px] block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Repita o PIN</span>
              <input type="password" inputMode="numeric" maxLength={6} autoComplete="off" className={campo} value={conf} onChange={(e) => setConf(e.target.value.replace(/\D/g, '').slice(0, 6))} data-testid="meu-pin-conf" />
            </label>
            {erro && <p role="alert" className="text-[12px] font-medium text-[#EF4444]" data-testid="meu-pin-erro">{erro}</p>}
            <div className="flex justify-end gap-[8px] pt-[4px]">
              <button type="button" onClick={onFechar} className="h-[36px] rounded-[3px] border border-[#E5E7EB] px-[14px] text-[11px] font-semibold uppercase tracking-wide text-[#1F2937] hover:bg-[#EDEEF1]">Cancelar</button>
              <button type="submit" disabled={salvando} className="h-[36px] rounded-[3px] bg-[#0688D4] px-[14px] text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-[#0570AE] disabled:opacity-60" data-testid="meu-pin-salvar">Salvar PIN</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
