import { fonteVitrine } from '@/lib/fonte-vitrine'

/**
 * O cardápio da mesa (QR) usa a MESMA fonte da vitrine do delivery — a mesma instância de
 * `lib/fonte-vitrine.ts`, não uma cópia. A página aplica a família com a classe
 * `fonte-vitrine` (app/globals.css).
 */
export default function LayoutMesa({ children }: { children: React.ReactNode }) {
  return <div className={fonteVitrine.variable}>{children}</div>
}
