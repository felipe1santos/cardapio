import { ReactNode } from 'react'
import { IlustracaoChef } from './ilustracao-chef'

/**
 * Telas de acesso (login, cadastro, trocar e redefinir senha), 26/10/2026, referência escolhida pelo
 * dono: painel azul com ilustração própria + formulário em Poppins com ações em laranja.
 * No celular o azul vira o topo e o formulário sobe numa folha branca.
 * Medidas em px porque a raiz do painel é 87,5%.
 */

export const AUTH_FONTE = 'Poppins,var(--font-inter),-apple-system,"Segoe UI",sans-serif'

/** Caixa do campo; use com `authEntrada` dentro quando houver ícone ao lado. */
export const authCampo =
  'flex h-[52px] w-full items-center rounded-[10px] border border-[#E3E7ED] bg-white px-[16px] transition-[border-color,box-shadow] focus-within:border-[#FA5A00] focus-within:shadow-[0_0_0_4px_rgba(250,90,0,0.12)]'
export const authEntrada =
  'h-full min-w-0 flex-1 bg-transparent text-[15px] text-[#1B2430] placeholder:text-[#9AA3AF] focus:outline-none'

/** Campo simples (sem ícone). */
export const authInput =
  'h-[52px] w-full rounded-[10px] border border-[#E3E7ED] bg-white px-[16px] text-[15px] text-[#1B2430] placeholder:text-[#9AA3AF] transition-[border-color,box-shadow] focus:border-[#FA5A00] focus:shadow-[0_0_0_4px_rgba(250,90,0,0.12)] focus:outline-none'

export const authButton =
  'h-[52px] w-full rounded-[10px] bg-[#FA5A00] text-[16px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(250,90,0,0.6)] transition-colors hover:bg-[#E14F00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FA5A00] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none disabled:hover:bg-[#FA5A00]'

export const authLabel = 'mb-[6px] block text-[13px] font-medium text-[#3B4553]'
export const authLink = 'font-semibold text-[#C2410C] hover:underline'

/** Faixas de aviso dentro do formulário. */
export const authAviso = {
  info: 'mb-[16px] rounded-[10px] bg-[#EAF2F9] px-[14px] py-[10px] text-[13px] leading-[19px] text-[#0B4370]',
  ok: 'mb-[16px] rounded-[10px] bg-price-bg px-[14px] py-[10px] text-[13px] leading-[19px] text-price-text',
  erro: 'mb-[16px] rounded-[10px] bg-danger-bg px-[14px] py-[10px] text-[13px] leading-[19px] text-[#B91C1C]',
}

function Marca({ clara }: { clara?: boolean }) {
  return (
    <span className={`flex items-center gap-[8px] text-[20px] font-semibold tracking-[-0.01em] ${clara ? 'text-white' : 'text-[#0B2A45]'}`}>
      <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] bg-[#FA5A00] text-[20px] leading-none text-white">+</span>
      Menuzia
    </span>
  )
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
  /** Linha no pé do formulário (ex.: "Não tem uma conta? Cadastre-se"). */
  rodape?: ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col bg-[#0A5689] lg:flex-row" style={{ fontFamily: AUTH_FONTE }}>
      {/* Painel azul com a ilustração */}
      <section className="relative flex shrink-0 flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_45%,#1467A0_0%,#0A5689_60%)] px-[20px] pb-[44px] pt-[20px] lg:min-h-screen lg:w-[52%] lg:px-[56px] lg:pb-[56px] lg:pt-[40px]">
        <Marca clara />
        <div className="flex flex-1 flex-col items-center justify-center">
          <IlustracaoChef className="h-auto w-full max-w-[240px] lg:max-w-[560px]" />
          <div className="mt-[8px] hidden max-w-[440px] text-center lg:block">
            <p className="text-[28px] font-semibold leading-[36px] text-white">Do fogão à porta do cliente.</p>
            <p className="mt-[10px] text-[15px] leading-[24px] text-white/75">
              Pedidos, cozinha e entregas da sua loja em um só lugar.
            </p>
          </div>
        </div>
      </section>

      {/* Formulário */}
      <section className="relative -mt-[24px] flex flex-1 flex-col rounded-t-[28px] bg-white px-[20px] pb-[32px] pt-[32px] lg:mt-0 lg:items-center lg:justify-center lg:rounded-none lg:px-[48px]">
        <div className="mx-auto w-full max-w-[400px]">
          <h1 className="text-[28px] font-semibold leading-[36px] text-[#0B2A45]">{heading}</h1>
          {subtitulo && <p className="mt-[6px] text-[14px] leading-[22px] text-[#5F6B7A]">{subtitulo}</p>}
          <div className="mt-[28px]">{children}</div>
          {rodape && <p className="mt-[28px] text-center text-[14px] text-[#5F6B7A]">{rodape}</p>}
        </div>
        <p className="mt-auto pt-[32px] text-center text-[12px] text-[#9AA3AF] lg:absolute lg:bottom-[20px] lg:pt-0">
          © {new Date().getFullYear()} Menuzia
        </p>
      </section>
    </main>
  )
}
