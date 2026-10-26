import { ReactNode } from 'react'

/**
 * Telas de acesso (login, cadastro, trocar e redefinir senha), 26/10/2026, desenhadas a partir da
 * imagem-modelo do dono (ARQUIVOS IMPORTANTES/1ea5c1e7…png), no tema azul: painel com o chef e a
 * frase, formulário branco com rótulos e botão azul. Ilustrações do dono: public/auth-chef.webp
 * (computador, fundo #0165AD = painel) e public/auth-chef-celular.webp (celular, já traz a curva
 * branca embaixo; fundo #0168B3 = faixa da marca).
 * Fonte Inter (do app). Medidas em px porque a raiz do painel é 87,5%.
 */

export const AUTH_FONTE = 'var(--font-inter),Inter,-apple-system,"Segoe UI",sans-serif'

/** Caixa do campo; use com `authEntrada` dentro quando houver ícone ao lado. */
export const authCampo =
  'flex h-[50px] w-full items-center rounded-[8px] border border-[#DFE2E8] bg-white px-[16px] transition-[border-color,box-shadow] focus-within:border-[#0165AD] focus-within:shadow-[0_0_0_3px_rgba(1,101,173,0.18)]'
export const authEntrada =
  'h-full min-w-0 flex-1 bg-transparent text-[16px] text-[#0F0F14] placeholder:text-[#8A90A2] focus:outline-none'

/** Campo simples (sem ícone). */
export const authInput =
  'h-[50px] w-full rounded-[8px] border border-[#DFE2E8] bg-white px-[16px] text-[16px] text-[#0F0F14] placeholder:text-[#8A90A2] transition-[border-color,box-shadow] focus:border-[#0165AD] focus:shadow-[0_0_0_3px_rgba(1,101,173,0.18)] focus:outline-none'

export const authButton =
  'h-[54px] w-full rounded-[10px] bg-[#0165AD] text-[17px] font-bold text-white transition-colors hover:bg-[#015290] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0165AD] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#0165AD]'

export const authLabel = 'mb-[8px] block text-[15px] font-bold text-[#0F0F14]'
export const authLink = 'font-bold text-[#0F0F14] underline underline-offset-[3px] hover:text-[#3B3F4A]'

/** Faixas de aviso dentro do formulário. */
export const authAviso = {
  info: 'mb-[18px] rounded-[8px] bg-[#E6F1FA] px-[14px] py-[10px] text-[14px] leading-[20px] text-[#014A80]',
  ok: 'mb-[18px] rounded-[8px] bg-price-bg px-[14px] py-[10px] text-[14px] leading-[20px] text-price-text',
  erro: 'mb-[18px] rounded-[8px] bg-danger-bg px-[14px] py-[10px] text-[14px] leading-[20px] text-[#B91C1C]',
}

function Marca({ className = '' }: { className?: string }) {
  return <span className={`text-[34px] font-extrabold leading-none tracking-[-0.03em] text-white ${className}`}>menuzia</span>
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
  /** Linhas no pé do formulário (ex.: "Ainda não tem uma conta?"). */
  rodape?: ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col bg-white lg:h-screen lg:min-h-[640px] lg:flex-row lg:overflow-hidden" style={{ fontFamily: AUTH_FONTE }}>
      {/* Painel azul */}
      <section className="relative flex shrink-0 flex-col items-center overflow-hidden bg-[#0168B3] pt-[28px] lg:h-screen lg:min-h-[640px] lg:w-[52.5%] lg:items-stretch lg:bg-[#0165AD] lg:px-[48px] lg:pb-[64px] lg:pt-[44px]">
        <Marca className="text-[28px] lg:text-[38px]" />
        {/* Celular: a imagem já termina na curva branca */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/auth-chef-celular.webp"
          alt="Chef com a concha erguida e a frigideira no fogo"
          width={900}
          height={610}
          className="mt-[4px] block h-auto w-full lg:hidden"
        />
        <div className="hidden min-h-0 w-full flex-1 items-center justify-center lg:flex lg:py-[16px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/auth-chef.webp"
            alt="Chef com a concha erguida e a frigideira no fogo"
            width={1200}
            height={960}
            className="h-auto max-h-full w-auto max-w-[620px] object-contain"
          />
        </div>
        <div className="hidden lg:block">
          <p className="text-[clamp(44px,4.6vw,68px)] font-extrabold leading-[1.02] tracking-[-0.035em] text-white">
            Seu restaurante,
            <br />
            no próximo nível.
          </p>
          <p className="mt-[14px] text-[clamp(18px,1.7vw,25px)] leading-[1.3] text-white">
            Mais organização. Mais pedidos. Mais sabor.
          </p>
        </div>
      </section>

      {/* Formulário */}
      <section className="relative flex flex-1 flex-col px-[24px] pb-[24px] pt-[28px] lg:overflow-y-auto lg:px-[48px] lg:pb-[32px] lg:pt-[48px]">
        <div className="mx-auto w-full max-w-[404px] lg:my-auto">
          <h1 className="text-center text-[26px] font-extrabold leading-[1.15] tracking-[-0.02em] text-[#0F0F14] lg:text-left lg:text-[36px]">
            {heading}
          </h1>
          {subtitulo && (
            <p className="mt-[6px] text-center text-[16px] leading-[24px] text-[#616A87] lg:mt-[8px] lg:text-left lg:text-[19px] lg:leading-[28px]">
              {subtitulo}
            </p>
          )}
          <div className="mt-[28px] lg:mt-[36px]">{children}</div>
          {rodape && <div className="mt-[24px] text-center text-[15px] leading-[24px] text-[#0F0F14] lg:mt-[32px] lg:text-[16px]">{rodape}</div>}
        </div>
        <p className="mt-auto pt-[28px] text-center text-[13px] text-[#8A90A2] lg:mt-0 lg:text-[14px]">
          © {new Date().getFullYear()} Menuzia
        </p>
      </section>
    </main>
  )
}
