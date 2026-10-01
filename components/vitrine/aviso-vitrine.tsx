'use client'

import { Megaphone } from 'lucide-react'
import type { EstiloAviso } from '@/lib/aviso-vitrine'
import { useVisivel } from './use-visivel'

/**
 * Faixa do aviso em texto da vitrine (2026-10-01). Sem cores escolhidas = o visual de
 * sempre (cor do tema da loja). O ícone acompanha a cor do texto. "Pulsar" é só CSS
 * (transform/opacity, app/globals.css .efeito-pulsar), pausa fora da tela e some com
 * "reduzir movimento". Usado na vitrine e na prévia de Ajustes.
 */
export function AvisoVitrine({ texto, estilo }: { texto: string; estilo: EstiloAviso }) {
  const [ref, visivel] = useVisivel<HTMLDivElement>()
  const personalizado = !!(estilo.corTexto || estilo.corFundo)
  return (
    <div
      ref={ref}
      data-testid="aviso-vitrine"
      data-visivel={visivel ? 'sim' : 'nao'}
      data-pulsar={estilo.pulsar ? 'sim' : 'nao'}
      className={[
        'flex min-h-[64px] items-center gap-3 rounded-md border px-4 py-3',
        personalizado ? '' : 'border-[var(--tema-primaria)]/30 bg-[var(--tema-light)]',
        estilo.pulsar ? 'efeito-pulsar' : '',
      ].join(' ')}
      style={personalizado ? { backgroundColor: estilo.corFundo ?? undefined, borderColor: 'rgba(0,0,0,0.08)', color: estilo.corTexto ?? undefined } : undefined}
    >
      <Megaphone
        className={['h-5 w-5 flex-shrink-0', personalizado && estilo.corTexto ? '' : 'text-[var(--tema-primaria)]'].join(' ')}
        style={personalizado && estilo.corTexto ? { color: estilo.corTexto } : undefined}
        strokeWidth={2}
      />
      <p
        className={['text-[13px] font-semibold leading-[18px]', personalizado && estilo.corTexto ? '' : 'text-[var(--v-texto)]'].join(' ')}
        style={personalizado && estilo.corTexto ? { color: estilo.corTexto } : undefined}
      >
        {texto}
      </p>
    </div>
  )
}
