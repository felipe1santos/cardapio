'use client'

import { useCallback, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

/**
 * Avisos rápidos ("toast") do painel: aparecem embaixo, no centro, e somem sozinhos.
 * Uso: const t = useToasts(); t.mostrar('ok', 'Salvo.'); <PilhaToasts itens={t.itens} />
 */
export type TomToast = 'ok' | 'erro'
export interface Toast { id: number; tom: TomToast; texto: string }

export function useToasts() {
  const [itens, setItens] = useState<Toast[]>([])
  const seq = useRef(0)
  const mostrar = useCallback((tom: TomToast, texto: string) => {
    const id = ++seq.current
    setItens((x) => [...x.slice(-2), { id, tom, texto }])
    setTimeout(() => setItens((x) => x.filter((t) => t.id !== id)), tom === 'erro' ? 6500 : 4200)
  }, [])
  return { itens, mostrar }
}

export function PilhaToasts({ itens }: { itens: Toast[] }) {
  if (!itens.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[9998] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {itens.map((t) => (
        <p
          key={t.id}
          role={t.tom === 'erro' ? 'alert' : 'status'}
          data-testid="toast"
          data-tom={t.tom}
          className={['pointer-events-auto flex max-w-[480px] items-start gap-2 rounded-[10px] px-4 py-2.5 text-[13px] font-medium shadow-[0_8px_24px_rgba(15,23,42,0.18)]', t.tom === 'ok' ? 'bg-[#111827] text-white' : 'bg-[#B91C1C] text-white'].join(' ')}
        >
          {t.tom === 'ok' ? <CheckCircle2 className="mt-[1px] h-4 w-4 flex-shrink-0 text-[#34D399]" /> : <AlertTriangle className="mt-[1px] h-4 w-4 flex-shrink-0" />}
          <span>{t.texto}</span>
        </p>
      ))}
    </div>
  )
}
