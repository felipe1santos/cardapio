import { Rubik } from "next/font/google";

/**
 * A vitrine usa Rubik; o painel segue em Inter (app/layout.tsx).
 *
 * Carregar aqui, e não na raiz, é o que impede o painel de baixar uma fonte
 * que ele não usa — e a vitrine de baixar a Inter. `next/font` self-hospeda o
 * arquivo, então não há request a terceiro no caminho crítico.
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
