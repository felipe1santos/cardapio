import { fonteVitrine } from "@/lib/fonte-vitrine";

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
 * A configuração (família e pesos) mora em `lib/fonte-vitrine.ts`, compartilhada com o
 * cardápio da mesa/QR.
 */
export default function LayoutVitrine({ children }: { children: React.ReactNode }) {
  return <div className={fonteVitrine.variable}>{children}</div>;
}
