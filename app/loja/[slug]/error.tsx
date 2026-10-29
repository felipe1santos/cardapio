'use client'

import { useEffect, useState } from 'react'

/**
 * "Voltamos já" da vitrine (29/10/2026): no lugar do erro genérico do Next quando o banco está fora (ou a página falha).
 * Tenta de novo sozinha a cada 20 s e no botão. Visual da vitrine (fonte e paleta --v-*), sem depender do banco.
 */
export default function ErroVitrine({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [segundos, setSegundos] = useState(20)

  useEffect(() => {
    const t = setInterval(() => {
      setSegundos((s) => {
        if (s > 1) return s - 1
        reset()
        return 20
      })
    }, 1000)
    return () => clearInterval(t)
  }, [reset])

  return (
    <main className="font-loja flex min-h-dvh items-center justify-center bg-[var(--v-fundo,#F8FAFC)] px-[16px]" data-testid="vitrine-voltamos-ja">
      <div className="w-full max-w-[400px] rounded-[12px] border border-[#E5E7EB] bg-white px-[24px] py-[32px] text-center">
        <div aria-hidden className="mx-auto mb-[16px] flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[#E0F2FE] text-[28px]">🍽️</div>
        <h1 className="text-[18px] font-semibold leading-[24px] text-[var(--v-titulo,#1F1F1F)]">Voltamos já</h1>
        <p className="mt-[8px] text-[14px] leading-[20px] text-[var(--v-secundario,#5C5C5C)]">
          O cardápio está com uma instabilidade rápida. Seu pedido não foi perdido — é só tentar de novo em instantes.
        </p>
        <button type="button" onClick={() => { setSegundos(20); reset() }}
          className="mt-[20px] h-[44px] w-full rounded-[8px] bg-[var(--v-acao,#1446AB)] text-[14px] font-semibold text-white">
          Tentar de novo
        </button>
        <p className="mt-[12px] text-[12px] text-[var(--v-secundario,#5C5C5C)]" aria-live="polite">Tentando sozinho em {segundos} s</p>
      </div>
    </main>
  )
}
