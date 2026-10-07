'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Printer } from 'lucide-react'

// Uma consulta por carregamento do painel (o aviso aparece em várias telas).
let consulta: Promise<boolean> | null = null
function precisaAtualizar(): Promise<boolean> {
  consulta ??= fetch('/api/admin/impressao/versao', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { precisaAtualizar: false }))
    .then((j: { precisaAtualizar?: boolean }) => j.precisaAtualizar === true)
    .catch(() => { consulta = null; return false })
  return consulta
}

/**
 * Barra vermelha no topo do painel: "Novo sistema de impressão disponível!". Fica no
 * fluxo (empurra o conteúdo, não cobre nada) e não tem botão de fechar — quem desliga é
 * a flag em lib/avisos-painel.ts. O botão navega pelo roteador do app (sem recarregar).
 * Impressão v3: só aparece para a loja que imprime e ainda não tem o Assistente na versão
 * do modelo v3 (rota /api/admin/impressao/versao; dono e gerente). Na dúvida, não aparece.
 * Vermelho #DC2626 (o danger do tema, um tom mais escuro): branco sobre ele passa no
 * contraste AA.
 */
export function AvisoNovaImpressao() {
  const [mostrar, setMostrar] = useState(false)
  useEffect(() => {
    let vivo = true
    void precisaAtualizar().then((v) => { if (vivo) setMostrar(v) })
    return () => { vivo = false }
  }, [])
  if (!mostrar) return null
  return (
    <div
      role="region"
      aria-label="Aviso: novo sistema de impressão disponível"
      data-testid="aviso-nova-impressao"
      className="flex min-h-[48px] flex-shrink-0 items-center gap-3 bg-[#DC2626] px-3 py-2 text-white sm:px-5"
    >
      <Printer className="h-5 w-5 flex-shrink-0" strokeWidth={2} aria-hidden />
      <p className="min-w-0 flex-1 text-[13.5px] leading-[18px]">
        <strong className="font-semibold">Novo sistema de impressão disponível!</strong>{' '}
        <span className="max-sm:hidden">Atualize o Assistente: comanda nova, mais rápida e fácil de calibrar.</span>
      </p>
      <Link
        href="/admin/impressao"
        data-testid="aviso-nova-impressao-botao"
        className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#DC2626] hover:bg-[#FEF2F2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Atualizar agora <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  )
}
