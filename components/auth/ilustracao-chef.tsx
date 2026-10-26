/**
 * Ilustração original da tela de acesso (26/10/2026): chef virando a frigideira sobre o fogo,
 * cores chapadas sobre o painel azul. Desenho próprio, sem licença de terceiros.
 */

const N = '#0B2A45' // marinho
const D = '#071A2E' // marinho escuro
const W = '#F4F5F7' // branco do dólmã
const W2 = '#D5DEE8' // sombra do branco
const S = '#F3C6A5' // pele
const S2 = '#E2A887' // sombra da pele
const C = '#E0104A' // chama
const Y = '#F5B400' // miolo da chama / queijo
const O = '#FA5A00' // lenço (laranja da marca)

export function IlustracaoChef({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 640 560" className={className} role="img" aria-label="Chef virando a frigideira sobre o fogo">
      {/* vapor */}
      <g fill="none" stroke={W} strokeLinecap="round" strokeWidth="9" opacity="0.9">
        <path d="M470 175c-22-20 14-34-6-58s12-36 2-54" />
        <path d="M528 205c-16-14 12-26-2-44" strokeWidth="7" />
        <path d="M424 200c-12-12 8-22-2-36" strokeWidth="6" />
      </g>

      {/* trajetória dos ingredientes */}
      <path d="M560 360c10-70-40-130-120-140" fill="none" stroke={W} strokeWidth="4" strokeLinecap="round" strokeDasharray="2 14" opacity="0.6" />

      {/* ingredientes no ar */}
      <g>
        <path d="M466 228c0-26 22-40 46-40s46 14 46 40z" fill="#F0A04B" />
        <g fill={W}>
          <ellipse cx="490" cy="206" rx="4" ry="2.4" transform="rotate(-20 490 206)" />
          <ellipse cx="512" cy="200" rx="4" ry="2.4" />
          <ellipse cx="534" cy="208" rx="4" ry="2.4" transform="rotate(20 534 208)" />
        </g>
        <rect x="412" y="258" width="44" height="44" rx="4" fill={Y} transform="rotate(-18 434 280)" />
        <ellipse cx="520" cy="292" rx="38" ry="12" fill="#7A4126" transform="rotate(10 520 292)" />
        <circle cx="586" cy="252" r="17" fill={C} />
        <circle cx="586" cy="252" r="10" fill="none" stroke="#FF6B8E" strokeWidth="3" />
      </g>

      {/* fogão e bancada */}
      <rect x="400" y="470" width="176" height="30" rx="4" fill={D} />
      <rect x="40" y="498" width="560" height="8" rx="4" fill={N} />

      {/* fogo */}
      <path
        d="M426 472c-14-30 8-46 14-72 9 20 17 24 21 10 4-16 7-28 18-44 4 26 19 31 25 16 8 16 16 28 10 50 11-6 16-16 19-28 15 26 15 52 4 68z"
        fill={C}
      />
      <path d="M452 472c-6-18 6-26 10-42 7 12 13 15 17 2 6 13 18 18 17 3 12 15 14 27 7 37z" fill={Y} />

      {/* frigideira, inclinada no movimento */}
      <g transform="rotate(-10 488 392)">
        <path d="M300 410l104-30 4 12-104 30z" fill={N} />
        <circle cx="306" cy="417" r="5" fill={Y} />
        <path d="M404 380h168c-4 30-36 48-84 48s-80-18-84-48z" fill={N} />
        <ellipse cx="488" cy="380" rx="84" ry="11" fill={D} />
        <ellipse cx="488" cy="379" rx="74" ry="7" fill="#12385A" />
      </g>

      {/* chef — corpo */}
      <path d="M146 500l12-118c4-34 34-52 70-52h34c28 4 40 26 38 58l-6 112z" fill={W} />
      <path d="M146 500l12-118c3-24 18-40 40-48-18 22-24 52-24 84l-6 82z" fill={W2} />
      <path d="M234 340c10 30 14 80 12 160" fill="none" stroke={W2} strokeWidth="4" />
      <g fill={N}>
        <circle cx="252" cy="392" r="5.5" />
        <circle cx="254" cy="432" r="5.5" />
        <circle cx="280" cy="390" r="5.5" />
        <circle cx="282" cy="430" r="5.5" />
      </g>

      {/* pescoço e lenço */}
      <path d="M218 304h30v34h-30z" fill={S2} />
      <path d="M210 334l52 2-24 30z" fill={O} />

      {/* braço erguido com a espátula */}
      <path d="M232 372c22-34 52-60 88-78l12 20c-30 16-56 40-74 72z" fill={W} />
      <path d="M232 372c14-22 30-40 48-56-10 20-16 40-18 62z" fill={W2} />
      <path d="M318 292l18-10 10 18-18 10z" fill={N} />
      <path d="M346 292l42-34" stroke={N} strokeWidth="7" strokeLinecap="round" />
      <path d="M380 252l22-24 16 14-22 24z" fill={N} />
      <path d="M392 246l10-11M398 252l10-11" stroke="#12385A" strokeWidth="3" strokeLinecap="round" />
      <circle cx="342" cy="296" r="13" fill={S} />

      {/* cabeça */}
      <circle cx="236" cy="276" r="42" fill={S} />
      <ellipse cx="208" cy="284" rx="9" ry="12" fill={S2} />
      <path d="M196 276c-4-30 18-42 44-40l-2 20c-14 0-24 10-28 34-8 2-13-4-14-14z" fill={N} />
      <path d="M274 266c16 6 18 20 2 26z" fill={S} />
      <path d="M250 268q8 7 16 0" fill="none" stroke={N} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M248 254l18-4" stroke={N} strokeWidth="4" strokeLinecap="round" />
      <path d="M258 296c8-9 26-8 32 4-9-2-16 1-24 3-7 2-11-2-8-7z" fill={N} />

      {/* chapéu */}
      <path d="M196 252l74-14 4 22-74 14z" fill={W2} />
      <path d="M198 252c-20-38-6-86 26-92 12-22 50-22 60 0 28 6 32 50-12 80z" fill={W} />
      <path d="M232 170c4 24 6 44 4 72M260 166c6 22 8 42 6 66" fill="none" stroke={W2} strokeWidth="4" strokeLinecap="round" />

      {/* braço até o cabo */}
      <path d="M262 342c26 0 42 18 54 52l6 16-24 10-14-32c-6-14-16-20-24-22z" fill={W} />
      <path d="M296 420l24-14 7 13-24 14z" fill={N} />
      <circle cx="324" cy="428" r="14" fill={S} />
      <path d="M314 420c6-6 16-6 20 2" fill="none" stroke={S2} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
