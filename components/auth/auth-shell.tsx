import { ReactNode } from 'react'

/** Classe padrão dos inputs das telas de auth (navy/laranja). */
export const authInput =
  'w-full rounded-menuzia border border-transparent bg-[#EFF0F2] px-4 py-3 text-sm text-text-main placeholder:text-text-subtle focus:border-[#1D3E73] focus:bg-white focus:outline-none'

/** Classe padrão do botão primário das telas de auth. */
export const authButton =
  'w-full rounded-menuzia bg-[#21478C] py-3 text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#1D3E73]'

/**
 * Moldura comum das telas de autenticação: topo navy com a marca Menuzia
 * e um "sheet" branco com o conteúdo. Tela cheia no mobile, cartão
 * centralizado no desktop.
 */
export function AuthShell({
  heading,
  children,
  backgroundImage,
}: {
  heading: string
  children: ReactNode
  backgroundImage?: string
}) {
  return (
    <main
      className="flex min-h-screen flex-col bg-[#1D3E73] bg-cover bg-center sm:items-center sm:justify-center sm:py-8"
      style={backgroundImage ? { backgroundImage: `linear-gradient(rgba(29,62,115,0.55), rgba(29,62,115,0.55)), url(${backgroundImage})` } : undefined}
    >
      <div className="flex min-h-screen w-full flex-col sm:min-h-0 sm:max-w-[440px] sm:overflow-hidden sm:rounded-[28px] sm:shadow-2xl">
        {/* Marca */}
        <div className="flex flex-col items-center justify-center bg-[#21478C] px-6 pb-12 pt-16 text-center sm:py-12">
          <div className="flex items-center gap-2.5">
            <span className="text-4xl font-extrabold tracking-tight text-white">Menuzia</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-menuzia bg-[#E85D2A] text-2xl font-extrabold leading-none text-white">
              +
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-white/80">Peça com facilidade</p>
        </div>

        {/* Sheet */}
        <div className="flex-1 rounded-t-[28px] bg-white px-6 pb-12 pt-9 shadow-[0_-8px_28px_rgba(0,0,0,0.12)] sm:flex-none sm:rounded-none sm:shadow-none">
          <div className="mx-auto w-full max-w-sm">
            <h1 className="mb-6 text-center text-xl font-bold text-text-main">{heading}</h1>
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
