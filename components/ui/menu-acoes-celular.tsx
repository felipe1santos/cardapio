'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { MoreVertical } from 'lucide-react'
import { Flutuante } from '@/components/ui/flutuante'

export interface AcaoDoMenu {
  rotulo: string
  icone?: ReactNode
  onClick: () => void
  desabilitada?: boolean
  perigo?: boolean
  testid?: string
}

/**
 * Menu ⋮ das telas compactas do celular (pendência 7): as ações que no tablet/desktop ficam à
 * vista entram aqui. Abre por cima de tudo (Flutuante, camada máxima); fecha com Esc, clique fora
 * ou depois de escolher. `className` decide em que larguras o botão aparece (ex.: "md:hidden").
 */
export function MenuAcoesCelular({ acoes, rotulo = 'Mais ações', className = '', tamanho = 40, testid, claro = false }: {
  acoes: AcaoDoMenu[]
  rotulo?: string
  className?: string
  tamanho?: number
  testid?: string
  /** Botão branco translúcido, para ir sobre um cartão colorido. */
  claro?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const ancora = useRef<HTMLButtonElement>(null)
  const fechar = useCallback(() => setAberto(false), [])
  if (acoes.length === 0) return null
  return (
    <>
      <button
        ref={ancora}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAberto((v) => !v) }}
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        data-testid={testid}
        className={[
          'flex flex-shrink-0 items-center justify-center rounded-menuzia transition-colors',
          claro ? 'bg-black/25 text-white hover:bg-black/35' : 'border border-border bg-white text-text-main hover:border-primary hover:text-primary',
          className,
        ].join(' ')}
        style={{ width: tamanho, height: tamanho }}
      >
        <MoreVertical className="h-[18px] w-[18px]" aria-hidden />
      </button>
      <Flutuante ancora={ancora} aberto={aberto} onFechar={fechar} largura={232} rotulo={rotulo} testid={testid ? `${testid}-menu` : undefined}>
        <div role="menu" className="py-1">
          {acoes.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              role="menuitem"
              disabled={a.desabilitada}
              data-testid={a.testid}
              onClick={() => { setAberto(false); a.onClick() }}
              className={[
                'flex min-h-[44px] w-full items-center gap-2.5 px-3.5 text-left text-[14px] font-medium transition-colors hover:bg-page disabled:opacity-40',
                a.perigo ? 'text-[#B91C1C]' : 'text-text-main',
              ].join(' ')}
            >
              {a.icone && <span className="flex h-5 w-5 items-center justify-center">{a.icone}</span>}
              {a.rotulo}
            </button>
          ))}
        </div>
      </Flutuante>
    </>
  )
}
