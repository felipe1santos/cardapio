import type { Metadata, Viewport } from "next";
import { Inter, Mulish } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

/**
 * A Inter vinha por `@import` dentro do globals.css, o que criava a pior cadeia
 * possível: baixar o CSS, descobrir o import, buscar o CSS do Google e só então
 * os arquivos da fonte — tudo bloqueando a primeira pintura. O Lighthouse media
 * 945 ms de bloqueio e estimava 2 s de economia.
 *
 * Aqui o Next auto-hospeda os arquivos junto com o app: some a ida a
 * fonts.googleapis.com e a fonts.gstatic.com, e o CSS da fonte é inlinado.
 *
 * Os pesos são exatamente os que já vinham (400–800). Existem 8 usos de
 * `font-light` e 1 de `font-black` no código, mas 300 e 900 nunca foram
 * carregados — o navegador já sintetizava. Mantendo o mesmo conjunto, nada muda
 * de aparência.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Mulish: a fonte do painel administrativo (2026-09-23).
 *
 * A referência de layout escolhida pelo dono usa Muli — o nome antigo desta
 * mesma família, hoje publicada como Mulish e sob licença aberta (SIL OFL).
 * Ela vale SÓ dentro de [data-admin-shell], fora do Kanban: a vitrine segue em
 * Montserrat e o restante do sistema em Inter, como manda o CLAUDE.md §3.
 *
 * Auto-hospedada pelo next/font, pelo mesmo motivo da Inter: nada de ida ao
 * fonts.googleapis.com bloqueando a primeira pintura.
 */
const mulish = Mulish({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-painel",
});

export const metadata: Metadata = {
  title: "Menuzia",
  description: "Cardápio digital e gestão de delivery",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Menuzia", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#008fba",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${mulish.variable}`}>
      <body className="antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
