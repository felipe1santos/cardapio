'use client'

import { useState } from 'react'
import { useLeituraPeriodica } from '@/lib/leitura-periodica'
import Link from 'next/link'
import { ArrowRight, MessageCircleOff } from 'lucide-react'

/**
 * Faixa vermelha no topo do painel quando o WhatsApp da loja caiu SOZINHO (Etapa 3, 20/10), no fluxo como os alertas de
 * impressão. Confere a cada minuto em /api/admin/whatsapp/alerta (que checa a Evolution com throttle de 2 min). Desconexão
 * feita de propósito em Integrações não mostra nada.
 */
export function AlertaWhatsapp() {
  const [a, setA] = useState<{ caiu: boolean; desde: string | null } | null>(null)
  // A cada 60 s com a aba visível; escondida, pausa e lê ao voltar (revisão de escala 26/10). O cron segue vigiando.
  useLeituraPeriodica(() => {
    void fetch('/api/admin/whatsapp/alerta', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setA(j))
      .catch(() => {})
  }, 60_000)
  if (!a?.caiu) return null
  const desde = a.desde ? new Date(a.desde).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
  return (
    <div role="alert" data-testid="alerta-whatsapp-caiu" className="flex min-h-[44px] flex-shrink-0 items-center gap-3 bg-[#DC2626] px-3 py-2 text-white sm:px-5">
      <MessageCircleOff className="h-5 w-5 flex-shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 text-[13.5px] leading-[18px]">
        <strong className="font-semibold">WhatsApp desconectado{desde ? ` desde ${desde}` : ''} — reconecte em Integrações.</strong>{' '}
        <span className="max-sm:hidden">Robô, IA e avisos de pedido estão parados até reconectar.</span>
      </p>
      <Link href="/admin/integracoes?abrir=whatsapp" data-testid="alerta-whatsapp-abrir"
        className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#B91C1C] hover:bg-[#FEE2E2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        Reconectar <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  )
}
