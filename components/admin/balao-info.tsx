'use client'

/**
 * Ícone "i" com balão de explicação (Ajustes › Robô e Agente de IA): por cima de tudo (portal, camada máxima), fecha
 * no X, tocando fora ou com Esc. Funciona no celular (toque abre e fecha).
 */
import { useCallback, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'
import { Flutuante } from '@/components/ui/flutuante'

export function BalaoInfo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const ancora = useRef<HTMLButtonElement>(null)
  const [aberto, setAberto] = useState(false)
  const fechar = useCallback(() => setAberto(false), [])
  return (
    <>
      <button
        ref={ancora}
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label={`Como funciona: ${titulo}`}
        data-testid={`info-${titulo}`}
        className="inline-flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-full text-[#0688D4] hover:bg-[#E0F2FE] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0688D4]"
      >
        <Info className="h-[17px] w-[17px]" />
      </button>
      <Flutuante ancora={ancora} aberto={aberto} onFechar={fechar} alinhar="inicio" largura={380} alturaMax={460} rotulo={titulo} testid="balao-info">
        <div className="relative p-[14px] pr-[40px] text-[13px] font-normal leading-[19px] text-[#374151]">
          <button type="button" onClick={fechar} aria-label="Fechar" className="absolute right-[6px] top-[6px] flex h-[30px] w-[30px] items-center justify-center rounded-full text-[#6B7280] hover:bg-[#EDEEF1]">
            <X className="h-[16px] w-[16px]" />
          </button>
          {children}
        </div>
      </Flutuante>
    </>
  )
}
