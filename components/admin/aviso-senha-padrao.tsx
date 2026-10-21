'use client'

import { useEffect, useMemo, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { estaComSenhaPadrao } from '@/lib/auth/senha-padrao'
import { EVENTO_ABRIR_MINHA_CONTA, EVENTO_SENHA_TROCADA } from '@/components/admin/modal-minha-conta'

/**
 * Faixa amarela da senha padrão (20/10/2026): o Super Admin resetou a senha para 123456 → até a pessoa trocar, o topo
 * do painel avisa. Não bloqueia nada. Lê o usuário uma vez ao abrir (getUser vai ao Auth e traz o app_metadata atual).
 */
export function AvisoSenhaPadrao() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [mostrar, setMostrar] = useState(false)

  useEffect(() => {
    let vivo = true
    // Dentro do then: qualquer falha da sessão vira "sem faixa", nunca derruba o painel.
    Promise.resolve().then(() => supabase.auth.getUser()).then(({ data }) => { if (vivo) setMostrar(estaComSenhaPadrao(data.user)) }).catch(() => {})
    const trocou = () => setMostrar(false)
    window.addEventListener(EVENTO_SENHA_TROCADA, trocou)
    return () => { vivo = false; window.removeEventListener(EVENTO_SENHA_TROCADA, trocou) }
  }, [supabase])

  if (!mostrar) return null
  return (
    <div role="status" data-testid="aviso-senha-padrao" className="flex min-h-[40px] flex-shrink-0 items-center gap-3 bg-[#FEF3C7] px-3 py-1.5 text-[#B45309] sm:px-5">
      <KeyRound className="h-4 w-4 flex-shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] leading-[18px]"><strong className="font-semibold">Você está com a senha padrão — troque agora.</strong></p>
      <button type="button" onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR_MINHA_CONTA))} data-testid="aviso-senha-padrao-trocar"
        className="inline-flex flex-shrink-0 items-center whitespace-nowrap rounded-[3px] bg-[#B45309] px-3 py-1 text-[12px] font-semibold text-white hover:brightness-110">
        Trocar senha
      </button>
    </div>
  )
}
