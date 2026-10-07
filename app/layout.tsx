import type { Metadata, Viewport } from "next";
import "./fontes.css";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

/**
 * A Inter vinha por `@import` dentro do globals.css, o que criava a pior cadeia
 * possível: baixar o CSS, descobrir o import, buscar o CSS do Google e só então
 * os arquivos da fonte — tudo bloqueando a primeira pintura. O Lighthouse media
 * 945 ms de bloqueio e estimava 2 s de economia.
 *
 * Os arquivos são servidos pelo próprio app (public/fontes): nenhuma ida a
 * fonts.googleapis.com nem a fonts.gstatic.com, nem no navegador nem no build.
 *
 * Os pesos são exatamente os que já vinham (400–800). Existem 8 usos de
 * `font-light` e 1 de `font-black` no código, mas 300 e 900 nunca foram
 * carregados — o navegador já sintetizava. Mantendo o mesmo conjunto, nada muda
 * de aparência.
 */
/*
 * Fontes DENTRO do projeto (2026-10-07): o build do Coolify falhou duas vezes ao baixar o Google
 * Fonts (next/font/google) e o site ficou sem fonte. As regras e os arquivos são os mesmos de antes
 * (app/fontes.css + public/fontes/, gerados por scripts/fontes/extrair-fontes.mjs); as variáveis
 * continuam --font-inter, --font-painel (Mulish, painel) e --font-meta (Figtree, Financeiro).
 * Preload só do corte latino da Inter e da Mulish, como o next/font fazia (a Figtree não tinha).
 */
const PRELOAD_FONTES = ["/fontes/e4af272ccee01ff0-s.p.woff2", "/fontes/3be83a346553616c-s.p.woff2"];

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
    <html lang="pt-BR" className="fonte-inter fonte-painel fonte-meta fonte-submenu">
      <head>
        {PRELOAD_FONTES.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body className="antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
