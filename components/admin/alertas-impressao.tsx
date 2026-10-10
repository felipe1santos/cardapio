'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Printer } from 'lucide-react'

/**
 * Alertas de impressão no topo do painel (Alfa 1, 09/10), no fluxo como o AvisoNovaImpressao:
 *   · vermelho — nenhum computador está buscando os pedidos há mais de 2 min (loja aberta);
 *   · laranja — "A impressão automática está desligada" com pedido chegando.
 * Confere a cada minuto. Sem resposta do servidor, não mostra nada.
 */
export function AlertasImpressao() {
  const [a, setA] = useState<{ imprimirSozinhoDesligado: boolean; semAssistente: boolean } | null>(null)
  useEffect(() => {
    let vivo = true
    const ler = () => fetch('/api/admin/impressao/alerta', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setA(j) })
      .catch(() => {})
    void ler()
    const t = setInterval(ler, 60_000)
    return () => { vivo = false; clearInterval(t) }
  }, [])
  if (!a || (!a.semAssistente && !a.imprimirSozinhoDesligado)) return null
  const vermelho = a.semAssistente
  return (
    <div role="alert" data-testid={vermelho ? 'alerta-sem-assistente' : 'alerta-imprimir-sozinho'}
      className={`flex min-h-[44px] flex-shrink-0 items-center gap-3 px-3 py-2 sm:px-5 ${vermelho ? 'bg-[#DC2626] text-white' : 'bg-[#FEF3C7] text-[#92400E]'}`}>
      {vermelho ? <Printer className="h-5 w-5 flex-shrink-0" aria-hidden /> : <AlertTriangle className="h-5 w-5 flex-shrink-0" aria-hidden />}
      <p className="min-w-0 flex-1 text-[13.5px] leading-[18px]">
        <strong className="font-semibold">{vermelho ? 'Nenhum computador está imprimindo os pedidos.' : 'A impressão automática está desligada.'}</strong>{' '}
        <span className="max-sm:hidden">{vermelho ? 'O Assistente não busca pedidos há mais de 2 minutos. Confira se o computador da impressora está ligado.' : 'Os pedidos estão chegando e não estão saindo na impressora.'}</span>
      </p>
      <Link href="/admin/impressao" data-testid="alerta-impressao-abrir"
        className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${vermelho ? 'bg-white text-[#DC2626] focus-visible:outline-white' : 'bg-[#92400E] text-white focus-visible:outline-[#92400E]'}`}>
        Ver impressão <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  )
}
