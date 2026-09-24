'use client'

/** Ícone ilustrado pelo nome do grupo (bacon, queijo, pimenta…). Sem foto, dá cara ao grupo. */

type FoodIconType = 'bacon' | 'tomate' | 'cebola' | 'alface' | 'queijo' | 'pimenta' | 'pepino' | 'cogumelo' | 'default'

function detectFoodIcon(name: string): FoodIconType {
  const n = name.toLowerCase()
  if (n.includes('bacon')) return 'bacon'
  if (n.includes('tomate') || n.includes('tomato')) return 'tomate'
  if (n.includes('cebola') || n.includes('onion')) return 'cebola'
  if (n.includes('alface') || n.includes('lettuce')) return 'alface'
  if (n.includes('queijo') || n.includes('cheddar') || n.includes('mussarela') || n.includes('mozza')) return 'queijo'
  if (n.includes('pimenta') || n.includes('pepper') || n.includes('chili') || n.includes('jalap')) return 'pimenta'
  if (n.includes('pepino') || n.includes('cucumber')) return 'pepino'
  if (n.includes('cogumelo') || n.includes('mushroom')) return 'cogumelo'
  return 'default'
}

export function FoodIcon({ name, size = 40 }: { name: string; size?: number }) {
  const type = detectFoodIcon(name)
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
      {type === 'bacon' && <>
        <path d="M5 14 Q12.5 10 20 14 Q27.5 18 35 14" stroke="#EF4444" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M5 21 Q12.5 17 20 21 Q27.5 25 35 21" stroke="#FCA5A5" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M5 28 Q12.5 24 20 28 Q27.5 32 35 28" stroke="#EF4444" strokeWidth="4" fill="none" strokeLinecap="round" />
      </>}
      {type === 'tomate' && <>
        <circle cx="20" cy="23" r="14" fill="#EF4444" />
        <path d="M20 9 L20 5 M14 8 Q17 5 20 7 Q23 5 26 8" stroke="#16A34A" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="15" cy="20" r="2.5" fill="#FCA5A5" opacity="0.5" />
      </>}
      {type === 'cebola' && <>
        <ellipse cx="20" cy="25" rx="13" ry="10" fill="#FDE68A" />
        <ellipse cx="20" cy="25" rx="9" ry="7" fill="#FCD34D" />
        <ellipse cx="20" cy="25" rx="5" ry="4" fill="#FBBF24" />
        <path d="M20 15 Q22 9 20 5 Q18 9 20 15Z" fill="#86EFAC" />
      </>}
      {type === 'alface' && <>
        <circle cx="20" cy="21" r="13" fill="#4ADE80" />
        <path d="M7 21 Q10 16 14 21 Q17 26 20 21 Q23 16 26 21 Q30 26 33 21" stroke="#22C55E" strokeWidth="2.5" fill="none" />
        <circle cx="20" cy="21" r="5" fill="#BBF7D0" />
      </>}
      {type === 'queijo' && <>
        <path d="M5 31 L20 9 L35 31 Z" fill="#FCD34D" />
        <path d="M5 31 L35 31 L35 37 L5 37 Z" fill="#FBBF24" />
        <circle cx="20" cy="27" r="2" fill="#FEF08A" />
        <circle cx="14" cy="30" r="1.5" fill="#FEF08A" />
        <circle cx="26" cy="30" r="1.5" fill="#FEF08A" />
      </>}
      {type === 'pimenta' && <>
        <path d="M23 4 Q27 7 27 13 Q27 23 19 31 Q15 34 13 31 Q11 28 14 26 Q19 23 19 16 Q19 9 23 4Z" fill="#DC2626" />
        <path d="M22 4 Q26 2 28 5" stroke="#86EFAC" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <ellipse cx="20" cy="18" rx="3" ry="5" fill="#EF4444" opacity="0.4" />
      </>}
      {type === 'pepino' && <>
        <ellipse cx="20" cy="20" rx="8" ry="14" fill="#4ADE80" />
        <ellipse cx="20" cy="20" rx="5" ry="11" fill="#BBF7D0" />
        <circle cx="20" cy="13" r="1.5" fill="#4ADE80" />
        <circle cx="20" cy="20" r="1.5" fill="#4ADE80" />
        <circle cx="20" cy="27" r="1.5" fill="#4ADE80" />
      </>}
      {type === 'cogumelo' && <>
        <path d="M6 25 Q6 12 20 10 Q34 12 34 25Z" fill="#D4A27F" />
        <rect x="14" y="25" width="12" height="8" rx="2" fill="#E8C9A0" />
        <circle cx="14" cy="19" r="2" fill="#B8875A" />
        <circle cx="20" cy="16" r="2" fill="#B8875A" />
        <circle cx="26" cy="19" r="2" fill="#B8875A" />
      </>}
      {type === 'default' && <>
        <circle cx="20" cy="20" r="14" fill="#EDE9FE" />
        <path d="M20 12 L20 28 M12 20 L28 20" stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" />
      </>}
    </svg>
  )
}
