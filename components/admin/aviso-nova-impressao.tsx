'use client'

import Link from 'next/link'
import { ArrowRight, Printer } from 'lucide-react'

/**
 * Barra vermelha no topo do painel: "Novo sistema de impressão disponível!". Fica no
 * fluxo (empurra o conteúdo, não cobre nada) e não tem botão de fechar — quem desliga é
 * a flag em lib/avisos-painel.ts. O botão navega pelo roteador do app (sem recarregar).
 * Vermelho #DC2626 (o danger do tema, um tom mais escuro): branco sobre ele passa no
 * contraste AA.
 */
export function AvisoNovaImpressao() {
  return (
    <div
      role="region"
      aria-label="Aviso: novo sistema de impressão disponível"
      data-testid="aviso-nova-impressao"
      className="flex min-h-[48px] flex-shrink-0 items-center gap-3 bg-[#DC2626] px-3 py-2 text-white sm:px-5"
    >
      <Printer className="h-5 w-5 flex-shrink-0" strokeWidth={2} aria-hidden />
      <p className="min-w-0 flex-1 text-[13.5px] leading-[18px]">
        <strong className="font-bold">Novo sistema de impressão disponível!</strong>{' '}
        <span className="max-sm:hidden">Mais fácil de configurar e calibrar a sua impressora.</span>
      </p>
      <Link
        href="/admin/impressao"
        data-testid="aviso-nova-impressao-botao"
        className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-white px-3 py-1.5 text-[13px] font-bold text-[#DC2626] hover:bg-[#FEF2F2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Configurar agora <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  )
}
