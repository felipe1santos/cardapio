/**
 * Miniatura do produto nas listas do PDV e das Mesas (2026-10-01): 40–48 px, cantos
 * arredondados, carregamento lazy; sem foto, ícone neutro do sistema.
 */
export function FotoItem({ url, nome, tamanho = 44, className = '' }: { url?: string | null; nome: string; tamanho?: number; className?: string }) {
  const caixa = { width: tamanho, height: tamanho }
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={nome} loading="lazy" decoding="async" width={tamanho} height={tamanho} style={caixa} className={`flex-shrink-0 rounded-[6px] bg-page object-cover ${className}`} data-foto-item />
    )
  }
  return (
    <span style={caixa} className={`flex flex-shrink-0 items-center justify-center rounded-[6px] bg-page text-text-subtle/60 ${className}`} aria-hidden data-foto-item="vazia">
      <svg viewBox="0 0 24 24" className="h-1/2 w-1/2 fill-current"><path d="M8.1 13.34l2.83-2.83L3.91 3.5a4.008 4.008 0 0 0 0 5.66l4.19 4.18zm6.78-1.81c1.53.71 3.68.21 5.27-1.38 1.91-1.91 2.28-4.65.81-6.12-1.46-1.46-4.2-1.1-6.12.81-1.59 1.59-2.09 3.74-1.38 5.27L3.7 19.87l1.41 1.41L12 14.41l6.88 6.88 1.41-1.41L13.41 13l1.47-1.47z" /></svg>
    </span>
  )
}
