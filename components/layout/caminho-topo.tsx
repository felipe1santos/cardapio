import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

export interface AjudaCaminho { href: string; rotulo: string; testid?: string }

/**
 * Caminho na barra do topo: "Financeiro › Contas e DRE (i)". O nome da seção, menor e em cinza, substitui o título
 * que cada tela repetia dentro da página (16/10/2026). O "i" leva à ajuda daquela seção.
 */
export function CaminhoTopo({ titulo, secao, ajuda }: { titulo: string; secao: string; ajuda?: AjudaCaminho }) {
  return (
    <div className="flex min-w-0 items-center gap-[6px]" data-testid="topo-caminho">
      <h1 className="flex-shrink-0 text-[19.2px] font-medium leading-tight text-[var(--adm-texto,#1f2937)] max-sm:sr-only">{titulo}</h1>
      <ChevronRight className="h-[16px] w-[16px] flex-shrink-0 text-[var(--adm-texto-suave,#5b6472)] max-sm:hidden" aria-hidden="true" />
      <span className="truncate text-[15px] font-medium text-[var(--adm-texto-medio,#4b5563)] max-sm:text-[17px] max-sm:text-[var(--adm-texto,#1f2937)]" aria-current="page" data-testid="topo-secao">{secao}</span>
      {ajuda && (
        <Link href={ajuda.href} aria-label={ajuda.rotulo} title={ajuda.rotulo} data-testid={ajuda.testid}
          className="grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-full border border-[#BFD7F2] text-[12px] font-semibold italic leading-none text-[#0B5CAD] hover:bg-[#F5F6F7] focus-visible:!outline-none focus-visible:!shadow-[0_0_0_2px_rgba(6,136,212,0.4)]">
          i
        </Link>
      )}
    </div>
  )
}
