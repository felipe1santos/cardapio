'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useLeituraPeriodica } from '@/lib/leitura-periodica'
import type { AvisoAssinatura } from '@/lib/assinatura/aviso'

/**
 * Faixa no topo do painel (03/11/2026): mensalidade vencida dentro da carência de 5 dias. Lê 1× ao abrir e a cada 30 min
 * com a aba visível; funcionário e loja sem assinatura recebem nada. Some sozinha quando o pagamento entra.
 */
const LEITURA_MS = 30 * 60_000
const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })

export function AvisoAssinatura() {
  const [aviso, setAviso] = useState<AvisoAssinatura | null>(null)
  useLeituraPeriodica(() => {
    fetch('/api/admin/assinatura/aviso', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => setAviso(j?.aviso ?? null)).catch(() => {})
  }, LEITURA_MS)
  if (!aviso) return null
  return (
    <div role="status" data-testid="aviso-assinatura" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#F59E0B] bg-[#FEF3C7] px-4 py-2 text-[13px] leading-[18px] text-[#92400E]">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">Sua assinatura precisa ser regularizada: pagamento pendente. O acesso continua até {dataCurta(aviso.ateIso)}.</span>
      {aviso.faturaUrl && <a href={aviso.faturaUrl} target="_blank" rel="noreferrer" className="rounded-[3px] bg-[#92400E] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-[#78350F]">Pagar agora</a>}
    </div>
  )
}
