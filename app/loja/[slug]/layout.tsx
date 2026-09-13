import { Rubik } from "next/font/google";

/**
 * A vitrine usa Rubik; o painel segue em Inter (app/layout.tsx).
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
 * O peso 800 entrou porque `vitrine.tsx` usa `font-extrabold` em vários
 * pontos (título da loja, preços, headers de seção) — sem o corte 800 real,
 * o navegador sintetiza um "fake bold" esticando o 700, visivelmente mais
 * grosseiro que o resto da tipografia.
 */
const rubik = Rubik({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-rubik",
  display: "swap",
});

export default function LayoutVitrine({ children }: { children: React.ReactNode }) {
  return <div className={rubik.variable}>{children}</div>;
}
