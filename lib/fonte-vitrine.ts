/**
 * A fonte da vitrine — Montserrat — num lugar só, usada pela vitrine do delivery
 * (`app/loja/[slug]/layout.tsx`) e pelo cardápio da mesa/QR (`app/mesa/[token]/layout.tsx`).
 *
 * Desde 2026-10-07 os arquivos moram no projeto (public/fontes, regras em app/fontes.css), sem
 * Google Fonts no build: são os mesmos que o next/font baixava, com os mesmos pesos (400, 500,
 * 600 e 700) e a mesma fonte de reserva com métricas ajustadas. Quem aplica a família é o CSS
 * (`.font-loja` e `.fonte-vitrine` em app/globals.css).
 *
 * A variável continua se chamando `--font-vitrine` (e não o nome da fonte) para que uma troca
 * futura de família não obrigue a mexer no CSS e no Tailwind.
 */
export const fonteVitrine = { variable: 'fonte-vitrine-var' } as const

/** Corte latino da Montserrat: preload nas rotas da vitrine, como o next/font fazia. */
export const PRELOAD_FONTE_VITRINE = '/fontes/904be59b21bd51cb-s.p.woff2'
