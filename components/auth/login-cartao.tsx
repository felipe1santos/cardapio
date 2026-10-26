'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'

/**
 * Cartão de login no molde do portal de lojistas da 99Food (pedido do dono, 26/10/2026):
 * mesmas medidas e fonte (PingFang SC; fora da Apple cai na Inter do app), cor em azul próprio.
 * Medidas em px porque a raiz do painel é 87,5%.
 */

const FONTE = '"PingFang SC","PingFangSC-Regular",var(--font-inter),-apple-system,"Segoe UI",sans-serif'
const FONTE_MEDIA = '"PingFang SC","PingFangSC-Medium",var(--font-inter),-apple-system,"Segoe UI",sans-serif'

const campo =
  'flex h-[44px] w-full items-center rounded-[6px] bg-[#F2F4F6] px-[15px] transition-shadow focus-within:bg-white focus-within:shadow-[0_0_0_1px_#2457D6]'
const entrada =
  'h-full min-w-0 flex-1 bg-transparent text-[16px] text-[#2B3847] placeholder:text-[#A3A8AF] focus:outline-none'

function BotaoEntrar({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-[44px] w-full rounded-[6px] bg-[linear-gradient(90deg,#1B45C2_0%,#2F6FEB_100%)] text-[16px] text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2457D6] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? 'Entrando…' : children}
    </button>
  )
}

export function LoginCartao({
  signIn,
  entrarComGoogle,
  comGoogle,
  voltar,
  aviso,
  erro,
}: {
  signIn: (formData: FormData) => Promise<void>
  entrarComGoogle: () => Promise<void>
  comGoogle: boolean
  voltar: string | null
  aviso: string | null
  erro: string | null
}) {
  const [aba, setAba] = useState<'senha' | 'google'>('senha')
  const [usuario, setUsuario] = useState('')
  const [verSenha, setVerSenha] = useState(false)

  const abas = comGoogle
    ? ([['senha', 'Entrar com senha'], ['google', 'Entrar com Google']] as const)
    : ([['senha', 'Entrar com senha']] as const)

  return (
    <div
      className="w-full overflow-hidden rounded-[8px] bg-white shadow-[0_2px_8px_rgba(72,79,87,0.3)] sm:w-[540px]"
      style={{ fontFamily: FONTE }}
    >
      <div className="px-[20px] pt-[36px] sm:px-[30px]">
        <h1 className="text-[26px] font-normal leading-[26px] text-[#43474B]" style={{ fontFamily: FONTE_MEDIA }}>
          Login
        </h1>

        <div role="tablist" className="mt-[12px] flex gap-[22px] border-b border-[#E8EAED]">
          {abas.map(([id, rotulo]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={aba === id}
              onClick={() => setAba(id)}
              className={`-mb-px border-b-2 py-[11px] text-[16px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2457D6] ${
                aba === id ? 'border-[#1D4ED8] text-[#1D4ED8]' : 'border-transparent text-[#6B7075] hover:text-[#43474B]'
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <div className="pb-[40px] pt-[30px]">
          {voltar && (
            <p className="mb-[16px] rounded-[6px] bg-[#EEF3FF] px-[12px] py-[10px] text-[13px] text-[#1E3A8A]" data-testid="login-motoboy-aviso">
              Entregador: entre com o login e a senha que a loja te passou.
            </p>
          )}
          {aviso && (
            <p className="mb-[16px] rounded-[6px] bg-price-bg px-[12px] py-[10px] text-[13px] text-price-text">{aviso}</p>
          )}
          {erro && (
            <p role="alert" className="mb-[16px] rounded-[6px] bg-danger-bg px-[12px] py-[10px] text-[13px] text-[#B91C1C]">{erro}</p>
          )}

          {aba === 'senha' ? (
            <form action={signIn}>
              {voltar && <input type="hidden" name="next" value={voltar} />}
              <label className={campo}>
                <input
                  name="email"
                  type="text"
                  autoComplete="username"
                  required
                  value={usuario}
                  onChange={e => setUsuario(e.target.value)}
                  placeholder="Usuário ou e-mail"
                  aria-label="Usuário ou e-mail"
                  className={entrada}
                />
                {usuario && (
                  <button
                    type="button"
                    onClick={() => setUsuario('')}
                    aria-label="Limpar usuário"
                    className="ml-[8px] flex h-[24px] w-[24px] items-center justify-center text-[#A3A8AF] hover:text-[#43474B]"
                  >
                    <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </label>

              <label className={`mt-[24px] ${campo}`}>
                <input
                  name="password"
                  type={verSenha ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Senha"
                  aria-label="Senha"
                  className={entrada}
                />
                <button
                  type="button"
                  onClick={() => setVerSenha(v => !v)}
                  aria-label={verSenha ? 'Esconder senha' : 'Mostrar senha'}
                  aria-pressed={verSenha}
                  className="ml-[8px] flex h-[24px] w-[24px] items-center justify-center text-[#A3A8AF] hover:text-[#43474B]"
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                    <circle cx="12" cy="12" r="3" />
                    {!verSenha && <path d="M4 20L20 4" />}
                  </svg>
                </button>
              </label>

              <div className="mt-[40px]">
                <BotaoEntrar>Entrar</BotaoEntrar>
              </div>
            </form>
          ) : (
            <form action={entrarComGoogle}>
              <p className="mb-[24px] text-[14px] leading-[22px] text-[#5B5F65]">
                Use a conta Google com o mesmo e-mail cadastrado na Menuzia.
              </p>
              <button
                type="submit"
                data-testid="login-google"
                className="flex h-[44px] w-full items-center justify-center gap-[10px] rounded-[6px] border border-[#E8EAED] bg-white text-[16px] text-[#2B3847] transition-colors hover:bg-[#F8F9FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2457D6]"
              >
                <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden="true">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                Continuar com Google
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="flex min-h-[60px] flex-wrap items-center justify-center gap-x-[12px] gap-y-[4px] bg-[#F8F9FA] px-[20px] py-[12px] text-[12px] text-[#5B5F65]">
        <Link href="/recuperar-senha" className="hover:text-[#1D4ED8]">Esqueceu sua senha?</Link>
        <span className="hidden h-[12px] w-px bg-[#D5D8DD] sm:block" aria-hidden="true" />
        <span>
          Não tem uma conta?{' '}
          <Link href="/cadastro" className="text-[#1D4ED8] hover:underline">Cadastre-se</Link>
        </span>
      </div>
    </div>
  )
}
