'use client'

import { type ComponentProps, type ReactNode, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { authAviso, authButton } from './auth-shell'

/** Formulário de login; a moldura é o AuthShell. */

/** Campo contornado com o rótulo dentro que sobe para a borda ao focar ou preencher. */
function CampoFlutuante({ id, rotulo, extra, className = '', ...props }: ComponentProps<'input'> & { id: string; rotulo: string; extra?: ReactNode }) {
  return (
    <div className="relative">
      <input
        id={id}
        placeholder=" "
        className={`peer h-[44px] w-full rounded-[4px] border border-[#C4C9D0] bg-white px-[14px] text-[16px] text-[#1F2937] transition-[border-color,box-shadow] hover:border-[#1F2937] focus:border-[#0165AD] focus:shadow-[inset_0_0_0_1px_#0165AD] focus:outline-none [&:-webkit-autofill]:[-webkit-box-shadow:inset_0_0_0_1000px_#fff] ${className}`}
        {...props}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 bg-white px-[4px] text-[16px] leading-none text-[#6B7280] transition-all duration-150 peer-focus:top-0 peer-focus:text-[12px] peer-focus:text-[#0165AD] peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[12px] peer-[:-webkit-autofill]:top-0 peer-[:-webkit-autofill]:text-[12px] motion-reduce:transition-none"
      >
        {rotulo}
      </label>
      {extra && <div className="absolute right-[8px] top-1/2 -translate-y-1/2">{extra}</div>}
    </div>
  )
}

// "Lembrar de mim": guarda só o usuário/e-mail neste aparelho para vir preenchido (nunca a senha).
const CHAVE_LEMBRAR = 'menuzia:login-usuario'

function BotaoEntrar() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={`${authButton} disabled:cursor-wait`}>
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  )
}

export function OlhoSenha({ visivel, alternar }: { visivel: boolean; alternar: () => void }) {
  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={visivel ? 'Esconder senha' : 'Mostrar senha'}
      aria-pressed={visivel}
      className="flex h-[36px] w-[36px] items-center justify-center rounded-full text-[#3B3F4A] hover:bg-[#F3F4F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F0F14]"
    >
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
        {visivel && <path d="M4 20L20 4" />}
      </svg>
    </button>
  )
}

export function LoginCartao({
  signIn,
  voltar,
  aviso,
  erro,
}: {
  signIn: (formData: FormData) => Promise<void>
  voltar: string | null
  aviso: string | null
  erro: string | null
}) {
  const [usuario, setUsuario] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const [lembrar, setLembrar] = useState(false)

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_LEMBRAR)
      if (salvo) {
        setUsuario(salvo)
        setLembrar(true)
      }
    } catch {}
  }, [])

  function aoEnviar() {
    try {
      if (lembrar && usuario.trim()) localStorage.setItem(CHAVE_LEMBRAR, usuario.trim())
      else localStorage.removeItem(CHAVE_LEMBRAR)
    } catch {}
  }

  return (
    <>
      {voltar && (
        <p className={authAviso.info} data-testid="login-motoboy-aviso">
          Entregador: entre com o login e a senha que a loja te passou.
        </p>
      )}
      {aviso && <p className={authAviso.ok}>{aviso}</p>}
      {erro && <p role="alert" className={authAviso.erro}>{erro}</p>}

      <form action={signIn} onSubmit={aoEnviar}>
        {voltar && <input type="hidden" name="next" value={voltar} />}

        <CampoFlutuante
          id="login-usuario"
          rotulo="E-mail ou usuário *"
          name="email"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={usuario}
          onChange={e => setUsuario(e.target.value)}
        />

        <div className="mt-[20px]">
          <CampoFlutuante
            id="login-senha"
            rotulo="Senha *"
            name="password"
            type={verSenha ? 'text' : 'password'}
            autoComplete="current-password"
            required
            className="pr-[52px]"
            extra={<OlhoSenha visivel={verSenha} alternar={() => setVerSenha(v => !v)} />}
          />
        </div>

        <label className="mt-[12px] flex min-h-[40px] w-fit cursor-pointer items-center gap-[8px] text-[14px] text-[#4B5563]">
          <input
            type="checkbox"
            checked={lembrar}
            onChange={e => setLembrar(e.target.checked)}
            className="h-[18px] w-[18px] cursor-pointer rounded-[4px] border-[#C5CAD3] accent-[#0165AD]"
          />
          Lembrar de mim
        </label>

        <div className="mt-[16px]">
          <BotaoEntrar />
        </div>
      </form>
    </>
  )
}
