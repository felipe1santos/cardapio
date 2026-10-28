import { ReactNode } from 'react'

/**
 * Telas de acesso (login, cadastro, trocar e redefinir senha), 28/10/2026, no layout pedido pelo dono
 * (referência: portal de login de um concorrente): ilustração ocupando 2/3 da tela à esquerda e painel
 * branco de 1/3 à direita, título em caixa alta centralizado, campos contornados, botão de largura total.
 * Cores e marca da Menuzia. Ilustração: public/auth-ilustracao.svg, "Cooking" (Storyset, estilo Cuate),
 * licença gratuita com crédito — o crédito fica no rodapé do painel.
 * Fonte Inter (do app; regra do projeto). Medidas em px porque a raiz do painel é 87,5%.
 */

export const AUTH_FONTE = 'var(--font-inter),Inter,-apple-system,"Segoe UI",sans-serif'

/** Campo contornado (sem ícone). */
export const authInput =
  'h-[54px] w-full rounded-[4px] border border-[#C4C9D0] bg-white px-[14px] text-[16px] text-[#1F2937] placeholder:text-[#6B7280] transition-[border-color,box-shadow] hover:border-[#1F2937] focus:border-[#0165AD] focus:shadow-[inset_0_0_0_1px_#0165AD] focus:outline-none'

export const authButton =
  'h-[48px] w-full rounded-[4px] bg-[#0165AD] text-[15px] font-semibold uppercase tracking-[0.04em] text-white shadow-[0_2px_4px_rgba(1,101,173,0.25)] transition-colors hover:bg-[#015290] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165AD] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#0165AD]'

export const authLabel = 'mb-[6px] block text-[14px] font-medium text-[#374151]'
export const authLink = 'font-semibold text-[#0165AD] hover:underline underline-offset-[3px]'

/** Faixas de aviso dentro do formulário. */
export const authAviso = {
  info: 'mb-[18px] rounded-[4px] bg-[#E6F1FA] px-[14px] py-[10px] text-[14px] leading-[20px] text-[#014A80]',
  ok: 'mb-[18px] rounded-[4px] bg-price-bg px-[14px] py-[10px] text-[14px] leading-[20px] text-price-text',
  erro: 'mb-[18px] rounded-[4px] bg-danger-bg px-[14px] py-[10px] text-[14px] leading-[20px] text-[#B91C1C]',
}

export function AuthShell({
  heading,
  subtitulo,
  children,
  rodape,
}: {
  heading: string
  subtitulo?: string
  children: ReactNode
  /** Linhas no pé do formulário (ex.: "Esqueci minha senha", "Precisa de ajuda?"). */
  rodape?: ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col bg-white lg:h-screen lg:min-h-[600px] lg:flex-row lg:overflow-hidden" style={{ fontFamily: AUTH_FONTE }}>
      {/* Ilustração: faixa no topo no celular, 2/3 da tela no computador */}
      <div className="flex shrink-0 items-center justify-center bg-[#EAF3FA] px-[24px] pt-[12px] lg:flex-1 lg:px-[48px] lg:pt-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/auth-ilustracao.svg"
          alt=""
          aria-hidden="true"
          width={500}
          height={500}
          className="h-[170px] w-auto lg:h-auto lg:max-h-[86vh] lg:w-full lg:max-w-[720px]"
        />
      </div>

      {/* Painel do formulário */}
      <section className="flex flex-1 flex-col bg-white px-[24px] pb-[20px] pt-[28px] lg:w-[33.333%] lg:min-w-[420px] lg:max-w-[640px] lg:flex-none lg:overflow-y-auto lg:px-[48px] lg:pt-[32px] lg:shadow-[-8px_0_24px_rgba(15,23,42,0.06)]">
        <div className="mx-auto w-full max-w-[400px] lg:my-auto">
          <p className="text-center text-[30px] font-extrabold leading-none tracking-[-0.03em] text-[#0165AD]">menuzia</p>
          <h1 className="mt-[24px] text-center text-[22px] font-bold uppercase leading-[30px] tracking-[0.01em] text-[#1F2937] lg:mt-[28px] lg:text-[24px] lg:leading-[32px]">
            {heading}
          </h1>
          {subtitulo && <p className="mt-[8px] text-center text-[15px] leading-[22px] text-[#6B7280]">{subtitulo}</p>}
          <div className="mt-[28px]">{children}</div>
          {rodape && <div className="mt-[28px] space-y-[16px] text-center text-[15px] leading-[22px] text-[#4B5563]">{rodape}</div>}
        </div>
        <p className="mt-auto pt-[28px] text-center text-[12px] text-[#6B7280]">
          © {new Date().getFullYear()} Menuzia ·{' '}
          <a href="https://storyset.com/people" target="_blank" rel="noopener noreferrer" className="hover:underline">
            Ilustração: Storyset
          </a>
        </p>
      </section>
    </main>
  )
}
