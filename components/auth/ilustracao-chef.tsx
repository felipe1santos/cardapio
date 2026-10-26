/**
 * Ilustração original da tela de acesso (26/10/2026): chef com a concha erguida e a frigideira
 * sobre o fogo, cores chapadas sobre o painel amarelo. Desenho próprio, sem licença de terceiros.
 */

const N = '#13233A' // marinho (punhos, botões, frigideira)
const D = '#0B1626' // marinho escuro
const W = '#FFFFFF' // dólmã
const W2 = '#E4E8EF' // sombra do branco
const S = '#F6C9A6' // pele
const S2 = '#E5A985' // sombra da pele
const H = '#8E1B12' // cabelo
const M = '#3E140C' // bigode e sobrancelha
const R = '#F50A36' // lenço
const F = '#FD5B07' // chama
const F2 = '#FFB21A' // miolo da chama
const B = '#FDF3D9' // mancha creme

export function IlustracaoChef({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 640 520" className={className} role="img" aria-label="Chef com a concha erguida e a frigideira no fogo">
      {/* mancha creme */}
      <path
        d="M96 300c-30-92 40-176 140-196 70-14 104-60 186-56 104 6 170 92 150 190-12 60 22 92 4 150-24 78-120 104-214 96-70-6-104 22-170 8C108 476 118 370 96 300z"
        fill={B}
        opacity="0.75"
      />

      {/* vapor */}
      <g fill="none" stroke={W} strokeLinecap="round" transform="translate(30 70)">
        <path d="M486 236c-40-22 6-56-22-88-26-30 18-54 4-92" strokeWidth="16" />
        <path d="M528 250c-20-16 10-34-6-56" strokeWidth="10" />
        <path d="M440 238c-14-12 6-24-4-38" strokeWidth="8" />
      </g>

      {/* fogão */}
      <path d="M424 474h184v18H424z" fill={D} />
      <path d="M440 462h152v12H440z" fill={N} />

      {/* fogo */}
      <path
        d="M446 462c-16-28 6-48 14-74 8 20 18 24 22 8 4-18 8-32 22-50 4 30 20 34 26 16 10 18 18 32 10 56 12-8 18-20 22-32 16 30 14 58 2 76z"
        fill={F}
      />
      <path d="M474 462c-8-18 6-28 10-44 8 12 14 16 18 2 8 14 20 20 18 4 12 16 14 28 8 38z" fill={F2} />

      {/* frigideira com a comida saltando */}
      <g transform="rotate(-6 512 382)">
        <path d="M318 404l110-28 4 13-110 28z" fill={N} />
        <circle cx="326" cy="410" r="6" fill={F2} />
        <path d="M426 374h176c-4 32-38 52-88 52s-84-20-88-52z" fill={N} />
        <ellipse cx="514" cy="374" rx="88" ry="12" fill={D} />
        <ellipse cx="514" cy="373" rx="78" ry="8" fill="#22344E" />
        <path d="M470 362c10-14 26-16 36-6 10-12 30-10 38 4" fill="none" stroke={W} strokeWidth="9" strokeLinecap="round" />
      </g>

      {/* corpo */}
      <path d="M150 520l14-138c4-36 36-56 74-56h34c30 4 44 28 42 62l-8 132z" fill={W} />
      <path d="M150 520l14-138c3-26 20-44 44-52-20 24-26 56-26 90l-8 100z" fill={W2} />
      <path d="M244 336c10 32 16 96 12 184" fill="none" stroke={W2} strokeWidth="4" />
      <g fill={N}>
        <circle cx="262" cy="398" r="7" />
        <circle cx="266" cy="446" r="7" />
        <circle cx="294" cy="394" r="7" />
        <circle cx="298" cy="442" r="7" />
      </g>

      {/* pescoço e lenço */}
      <path d="M226 300h32v36h-32z" fill={S2} />
      <path d="M212 330l62 4-30 30z" fill={R} />
      <path d="M262 334l22 20-6 10-20-18z" fill={R} />

      {/* braço erguido com a concha */}
      <path d="M244 370c20-40 50-72 90-96l14 22c-34 20-62 50-82 88z" fill={W} />
      <path d="M244 370c12-26 28-48 46-66-8 22-14 46-16 70z" fill={W2} />
      <path d="M332 270l20-12 12 20-20 12z" fill={N} />
      <path d="M362 268l58-44" stroke={N} strokeWidth="8" strokeLinecap="round" />
      <path d="M414 210c10-12 30-12 38 0 8 12 0 28-16 30-18 2-30-16-22-30z" fill={N} />
      <circle cx="358" cy="270" r="15" fill={S} />

      {/* cabeça */}
      <circle cx="244" cy="268" r="46" fill={S} />
      <ellipse cx="214" cy="276" rx="10" ry="13" fill={S2} />
      <path d="M200 268c-4-32 20-46 48-44l-2 22c-16 0-26 12-30 36-9 2-15-4-16-14z" fill={H} />
      <path d="M286 256c18 6 20 22 2 28z" fill={S} />
      <circle cx="270" cy="282" r="7" fill="#F29B8B" opacity="0.6" />
      <path d="M260 258q9 8 18 0" fill="none" stroke={D} strokeWidth="4" strokeLinecap="round" />
      <path d="M256 244l20-5" stroke={M} strokeWidth="5" strokeLinecap="round" />
      <path d="M266 290c9-10 30-9 36 5-10-3-18 1-27 4-8 2-13-3-9-9z" fill={M} />

      {/* chapéu */}
      <path d="M198 240l82-16 5 24-82 16z" fill={W2} />
      <path d="M200 242c-24-42-8-96 28-102 14-24 56-24 66 0 32 6 36 56-12 88z" fill={W} stroke={W2} strokeWidth="3" />
      <path d="M238 150c4 26 6 48 4 78M270 146c6 24 8 46 6 72" fill="none" stroke={W2} strokeWidth="4" strokeLinecap="round" />

      {/* braço até o cabo */}
      <path d="M272 340c28 0 46 20 58 56l6 18-26 10-16-34c-6-16-16-22-26-24z" fill={W} />
      <path d="M308 424l26-16 8 14-26 16z" fill={N} />
      <circle cx="340" cy="420" r="15" fill={S} />
      <path d="M330 412c6-6 18-6 22 2" fill="none" stroke={S2} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
