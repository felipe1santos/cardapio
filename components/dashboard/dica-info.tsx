'use client'

import { Dica } from '@/components/ui/flutuante'

/**
 * Ícone ⓘ discreto com um texto de apoio: aparece ao passar o mouse (ou focar pelo teclado) e,
 * no toque, abre e fecha. Fecha no Escape e no toque fora. Por cima de tudo (Dica compartilhada).
 */
export function DicaInfo({ texto }: { texto: string }) {
  return (
    <span className="relative flex-shrink-0">
      <Dica texto={<span data-dashboard-info-texto>{texto}</span>} alternarNoClique tom="claro" largura={300}>
        <button
          type="button"
          aria-label="Sobre as métricas da vitrine"
          className="flex h-[36px] w-[36px] items-center justify-center rounded-full text-[var(--adm-texto-suave)] transition-colors hover:bg-[var(--adm-superficie-2)] hover:text-[var(--adm-texto-medio)]"
          data-dashboard-info
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" aria-hidden="true">
            <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          </svg>
        </button>
      </Dica>
    </span>
  )
}
