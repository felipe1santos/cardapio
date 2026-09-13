import { Rubik } from "next/font/google";

/**
 * A vitrine usa Rubik; o painel segue em Inter (app/layout.tsx).
 *
 * Carregar aqui, e não na raiz, é o que impede o painel de baixar uma fonte
 * que ele não usa — e a vitrine de baixar a Inter. `next/font` self-hospeda o
 * arquivo, então não há request a terceiro no caminho crítico.
 */
const rubik = Rubik({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-rubik",
  display: "swap",
});

export default function LayoutVitrine({ children }: { children: React.ReactNode }) {
  return <div className={rubik.variable}>{children}</div>;
}
