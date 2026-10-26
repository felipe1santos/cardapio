import { ReactNode } from 'react'

/**
 * Telas de acesso (login, cadastro, trocar e redefinir senha) no molde do portal de lojistas da 99Food
 * (pedido do dono, 26/10/2026): foto cheia, faixa escura no topo e no rodapé, cartão de 540px à direita.
 * Fonte PingFang SC (fora da Apple cai na Inter do app). Medidas em px porque a raiz do painel é 87,5%.
 */

export const AUTH_FONTE = '"PingFang SC","PingFangSC-Regular",var(--font-inter),-apple-system,"Segoe UI",sans-serif'
const FONTE_MEDIA = '"PingFang SC","PingFangSC-Medium",var(--font-inter),-apple-system,"Segoe UI",sans-serif'

/** Caixa cinza do campo; use com `authEntrada` dentro quando houver ícone ao lado. */
export const authCampo =
  'flex h-[44px] w-full items-center rounded-[6px] bg-[#F2F4F6] px-[15px] transition-shadow focus-within:bg-white focus-within:shadow-[0_0_0_1px_#2457D6]'
export const authEntrada =
  'h-full min-w-0 flex-1 bg-transparent text-[16px] text-[#2B3847] placeholder:text-[#A3A8AF] focus:outline-none'

/** Campo simples (sem ícone). */
export const authInput =
  'h-[44px] w-full rounded-[6px] bg-[#F2F4F6] px-[15px] text-[16px] text-[#2B3847] placeholder:text-[#A3A8AF] transition-shadow focus:bg-white focus:shadow-[0_0_0_1px_#2457D6] focus:outline-none'

export const authButton =
  'h-[44px] w-full rounded-[6px] bg-[linear-gradient(90deg,#1B45C2_0%,#2F6FEB_100%)] text-[16px] text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2457D6] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:brightness-100'

export const authLabel = 'mb-[6px] block text-[13px] text-[#43474B]'
export const authLink = 'text-[#1D4ED8] hover:underline'

/** Faixas de aviso dentro do cartão. */
export const authAviso = {
  info: 'mb-[16px] rounded-[6px] bg-[#EEF3FF] px-[12px] py-[10px] text-[13px] leading-[19px] text-[#1E3A8A]',
  ok: 'mb-[16px] rounded-[6px] bg-price-bg px-[12px] py-[10px] text-[13px] leading-[19px] text-price-text',
  erro: 'mb-[16px] rounded-[6px] bg-danger-bg px-[12px] py-[10px] text-[13px] leading-[19px] text-[#B91C1C]',
}

export function AuthShell({
  heading,
  children,
  rodape,
}: {
  heading: string
  children: ReactNode
  /** Faixa cinza no pé do cartão (links de navegação). */
  rodape?: ReactNode
}) {
  return (
    <main
      className="relative flex min-h-screen flex-col bg-[#14213D] bg-cover bg-[position:30%_center]"
      style={{ backgroundImage: 'url(/auth-bg.webp)', fontFamily: AUTH_FONTE }}
    >
      <header className="flex h-[56px] shrink-0 items-center bg-black/50 px-[16px] sm:h-[70px] sm:px-[40px]">
        <span className="flex items-center gap-[8px] text-[24px] font-semibold tracking-[-0.01em] text-white">
          <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[6px] bg-[linear-gradient(135deg,#1B45C2,#2F6FEB)] text-[20px] leading-none">
            +
          </span>
          Menuzia
        </span>
      </header>

      <div className="flex flex-1 items-center justify-center px-[16px] py-[32px] sm:justify-end sm:px-[40px] lg:pr-[12%]">
        <div className="w-full overflow-hidden rounded-[8px] bg-white shadow-[0_2px_8px_rgba(72,79,87,0.3)] sm:w-[540px]">
          <div className="px-[20px] pb-[40px] pt-[36px] sm:px-[30px]">
            <h1 className="text-[26px] font-normal leading-[26px] text-[#43474B]" style={{ fontFamily: FONTE_MEDIA }}>
              {heading}
            </h1>
            {children}
          </div>
          {rodape && (
            <div className="flex min-h-[60px] flex-wrap items-center justify-center gap-x-[12px] gap-y-[4px] bg-[#F8F9FA] px-[20px] py-[12px] text-[12px] text-[#5B5F65]">
              {rodape}
            </div>
          )}
        </div>
      </div>

      <footer className="bg-black/50 py-[6px] text-center text-[12px] text-white/80">
        © {new Date().getFullYear()} Menuzia
      </footer>
    </main>
  )
}
