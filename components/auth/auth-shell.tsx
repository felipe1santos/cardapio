import { ReactNode } from 'react'

/**
 * Telas de acesso (login, cadastro, trocar e redefinir senha), 28/10/2026, a partir da referência
 * do dono (simples.vet/experimente): formulário enxuto à esquerda, foto em tela cheia à direita,
 * título com a primeira frase em negrito, campo com ícone e sombra leve, botão em pílula.
 * Foto: public/auth-foto.webp (Unsplash, licença livre, photo-1681270543584).
 * Fonte Inter (do app; regra do projeto). Medidas em px porque a raiz do painel é 87,5%.
 */

export const AUTH_FONTE = 'var(--font-inter),Inter,-apple-system,"Segoe UI",sans-serif'

const borda =
  'rounded-[6px] border border-[#E3E7EC] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.14)] transition-[border-color,box-shadow]'

/** Caixa do campo; use com `authEntrada` dentro quando houver ícone ao lado. */
export const authCampo = `flex h-[48px] w-full items-center gap-[12px] px-[16px] ${borda} focus-within:border-[#0165AD] focus-within:shadow-[0_0_0_3px_rgba(1,101,173,0.18)]`
export const authEntrada =
  'h-full min-w-0 flex-1 bg-transparent text-[16px] font-medium text-[#1F2937] placeholder:text-[#6B7280] focus:outline-none'

/** Campo simples (sem ícone). */
export const authInput = `h-[48px] w-full px-[16px] text-[16px] font-medium text-[#1F2937] placeholder:text-[#6B7280] ${borda} focus:border-[#0165AD] focus:shadow-[0_0_0_3px_rgba(1,101,173,0.18)] focus:outline-none`

export const authButton =
  'h-[48px] w-full rounded-full bg-[#0165AD] text-[17px] font-semibold text-white shadow-[0_1px_2px_rgba(1,101,173,0.35)] transition-colors hover:bg-[#015290] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165AD] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#0165AD]'

export const authLabel = 'mb-[6px] block text-[14px] font-semibold text-[#374151]'
export const authLink = 'font-medium text-[#4B5563] underline underline-offset-[3px] hover:text-[#1F2937]'

/** Faixas de aviso dentro do formulário. */
export const authAviso = {
  info: 'mb-[18px] rounded-[6px] bg-[#E6F1FA] px-[14px] py-[10px] text-[14px] leading-[20px] text-[#014A80]',
  ok: 'mb-[18px] rounded-[6px] bg-price-bg px-[14px] py-[10px] text-[14px] leading-[20px] text-price-text',
  erro: 'mb-[18px] rounded-[6px] bg-danger-bg px-[14px] py-[10px] text-[14px] leading-[20px] text-[#B91C1C]',
}

function Marca({ className = '' }: { className?: string }) {
  return <span className={`text-[28px] font-extrabold leading-none tracking-[-0.03em] ${className}`}>menuzia</span>
}

export function AuthShell({
  heading,
  subtitulo,
  children,
  rodape,
}: {
  /** Título; pode trazer um trecho em peso normal (ex.: <span className="font-normal">). */
  heading: ReactNode
  subtitulo?: string
  children: ReactNode
  /** Linhas no pé do formulário (ex.: "Ainda não tem uma conta?"). */
  rodape?: ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col bg-white lg:h-screen lg:min-h-[600px] lg:flex-row lg:overflow-hidden" style={{ fontFamily: AUTH_FONTE }}>
      {/* Foto: faixa no topo no celular, metade direita no computador */}
      <div className="relative h-[180px] shrink-0 overflow-hidden bg-[#2A1E17] lg:order-2 lg:h-auto lg:w-1/2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/auth-foto.webp"
          alt=""
          aria-hidden="true"
          width={1400}
          height={2061}
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover object-[center_66%] lg:object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-transparent lg:hidden" />
        <Marca className="absolute left-[24px] top-[22px] text-white lg:hidden" />
      </div>

      {/* Formulário */}
      <section className="flex flex-1 flex-col px-[24px] pb-[24px] pt-[28px] lg:order-1 lg:overflow-y-auto lg:px-[64px] lg:pb-[28px] lg:pt-[36px]">
        <Marca className="hidden text-[#0165AD] lg:block" />
        <div className="mx-auto w-full max-w-[420px] lg:my-auto lg:py-[32px]">
          <h1 className="text-[22px] font-bold leading-[30px] tracking-[-0.01em] text-[#1F2937] lg:text-[24px] lg:leading-[32px]">
            {heading}
          </h1>
          {subtitulo && <p className="mt-[10px] text-[15px] leading-[22px] text-[#6B7280] lg:text-[16px] lg:leading-[24px]">{subtitulo}</p>}
          <div className="mt-[28px] lg:mt-[32px]">{children}</div>
          {rodape && <div className="mt-[20px] text-center text-[14px] leading-[22px] text-[#4B5563]">{rodape}</div>}
        </div>
        <p className="mt-auto pt-[28px] text-center text-[13px] text-[#6B7280] lg:mt-0 lg:pt-0 lg:text-left">
          © {new Date().getFullYear()} Menuzia
        </p>
      </section>
    </main>
  )
}
