import { Montserrat } from "next/font/google";

/**
 * A vitrine usa Montserrat; o painel segue em Inter (app/layout.tsx).
 *
 * Carregar aqui, e não na raiz, é o que impede o PAINEL de baixar uma fonte que
 * ele não usa. A vitrine, porém, continua baixando a Inter: `app/layout.tsx`
 * aplica `inter.variable` no `<html>` de TODA rota, então o CSS e o preload da
 * Inter viajam também na vitrine. Tirar isso exigiria separar as rotas em route
 * groups com layouts raiz distintos, o que está fora do escopo desta mudança:
 * não conte com economia de bytes na vitrine por causa deste arquivo.
 * `next/font` self-hospeda o arquivo, então não há request a terceiro no
 * caminho crítico.
 *
 * Os pesos são os quatro que a referência de tipografia da vitrine usa:
 * 400 (descrição), 500 (badges e nav), 600 (nome de item, preço, títulos de
 * seção) e 700 (nome da loja). Sem o corte real, o navegador sintetiza um
 * "fake bold" esticando o peso mais próximo, visivelmente mais grosseiro.
 *
 * A variável continua se chamando `--font-vitrine` (e não o nome da fonte) para
 * que uma troca futura de família não obrigue a mexer no CSS e no Tailwind.
 */
const fonteVitrine = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-vitrine",
  display: "swap",
});

export default function LayoutVitrine({ children }: { children: React.ReactNode }) {
  return <div className={fonteVitrine.variable}>{children}</div>;
}
