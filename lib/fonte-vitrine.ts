import { Montserrat } from 'next/font/google'

/**
 * A fonte da vitrine — Montserrat — num lugar só, usada pela vitrine do delivery
 * (`app/loja/[slug]/layout.tsx`) e pelo cardápio da mesa/QR (`app/mesa/[token]/layout.tsx`).
 *
 * Uma chamada só do `next/font`: as duas rotas recebem o MESMO arquivo self-hospedado e a
 * mesma variável `--font-vitrine`, sem segundo import nem fonte "parecida". Quem aplica a
 * família é o CSS (`.font-loja` e `.fonte-vitrine` em app/globals.css).
 *
 * Os pesos são os quatro que a referência de tipografia da vitrine usa:
 * 400 (descrição), 500 (badges e nav), 600 (nome de item, preço, títulos de
 * seção) e 700 (nome da loja). Sem o corte real, o navegador sintetiza um
 * "fake bold" esticando o peso mais próximo, visivelmente mais grosseiro — por isso o
 * cardápio da mesa não usa 800.
 *
 * A variável continua se chamando `--font-vitrine` (e não o nome da fonte) para
 * que uma troca futura de família não obrigue a mexer no CSS e no Tailwind.
 */
export const fonteVitrine = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-vitrine',
  display: 'swap',
})
