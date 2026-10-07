import { useId } from 'react'

/**
 * Ilustração de hambúrguer (SVG, sem imagem externa) para as prévias de "Tamanho da imagem na lista"
 * e "Prévia na vitrine" em Ajustes (2026-10-06). Ocupa o quadrado inteiro no tamanho pedido, com o
 * fundo claro e os cantos da foto da vitrine (8px), para o dono ver o tamanho real do item.
 */
export function IlustracaoLanche({ tamanho, canto = 8, testid }: { tamanho: number; canto?: number; testid?: string }) {
  // ids únicos: com o mesmo id em outra prévia escondida (display: none), o gradiente some no Chrome.
  const u = useId().replace(/:/g, '')
  return (
    <svg
      viewBox="0 0 120 120"
      width={tamanho}
      height={tamanho}
      aria-hidden
      data-testid={testid}
      className="flex-shrink-0"
      style={{ borderRadius: canto, display: 'block' }}
    >
      <defs>
        <linearGradient id={`fundo-${u}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFF4E2" />
          <stop offset="1" stopColor="#FFE3C2" />
        </linearGradient>
        <linearGradient id={`pao-${u}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7B24A" />
          <stop offset="1" stopColor="#E08A24" />
        </linearGradient>
        <linearGradient id={`carne-${u}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7A3B1B" />
          <stop offset="1" stopColor="#5A2A12" />
        </linearGradient>
      </defs>
      <rect width="120" height="120" fill={`url(#fundo-${u})`} />
      {/* sombra */}
      <ellipse cx="60" cy="96" rx="40" ry="6" fill="#E9B98A" opacity="0.55" />
      {/* pão de baixo */}
      <path d="M22 80h76a4 4 0 0 1 4 4v1a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9v-1a4 4 0 0 1 4-4Z" fill={`url(#pao-${u})`} />
      {/* carne */}
      <rect x="18" y="66" width="84" height="15" rx="7.5" fill={`url(#carne-${u})`} />
      {/* queijo */}
      <path d="M20 64h80l-6 6-6-3-7 7-7-6-8 8-8-7-7 6-7-6-6 4-6-5-6 4Z" fill="#FFC531" />
      {/* alface */}
      <path d="M17 62c4-5 8 1 12-3s8 2 12-2 8 2 12-2 8 2 12-2 8 2 12-2 8 2 12-2 6 3 7 6c-3 3-7 3-10 1-4 3-8 1-12 3-4-2-8 1-12-1-4 2-8-1-12 1-4-2-8 1-12-1-4 2-8 0-11-1-3 1-7 1-9-1Z" fill="#5DB34A" />
      {/* tomate */}
      <rect x="24" y="56" width="72" height="6" rx="3" fill="#E5483A" />
      {/* pão de cima */}
      <path d="M18 55c0-19 19-31 42-31s42 12 42 31a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3Z" fill={`url(#pao-${u})`} />
      <path d="M30 38c7-6 17-9 28-9" stroke="#FFD58A" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.8" />
      {/* gergelim */}
      {[[44, 36, -20], [60, 32, 0], [76, 36, 20], [52, 44, -10], [68, 44, 10], [38, 46, -30], [84, 46, 30]].map(([x, y, r]) => (
        <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="2.6" ry="1.4" fill="#FFF3D6" transform={`rotate(${r} ${x} ${y})`} />
      ))}
    </svg>
  )
}
