'use client'

import { useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { authAviso, authButton, authCampo, authEntrada, authLabel } from './auth-shell'

/** Formulário de login; a moldura é o AuthShell. */

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
      className="-mr-[8px] ml-[8px] flex h-[40px] w-[40px] items-center justify-center rounded-full text-[#3B3F4A] hover:bg-[#F3F4F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F0F14]"
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

        <label htmlFor="login-usuario" className={authLabel}>E-mail ou usuário</label>
        <div className={authCampo}>
          <input
            id="login-usuario"
            name="email"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={usuario}
            onChange={e => setUsuario(e.target.value)}
            placeholder="seu@email.com"
            className={authEntrada}
          />
        </div>

        <label htmlFor="login-senha" className={`mt-[20px] ${authLabel}`}>Senha</label>
        <div className={authCampo}>
          <input
            id="login-senha"
            name="password"
            type={verSenha ? 'text' : 'password'}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className={authEntrada}
          />
          <OlhoSenha visivel={verSenha} alternar={() => setVerSenha(v => !v)} />
        </div>

        <div className="mt-[16px] flex items-center justify-between gap-[12px]">
          <label className="flex cursor-pointer items-center gap-[10px] text-[15px] text-[#3B3F4A]">
            <input
              type="checkbox"
              checked={lembrar}
              onChange={e => setLembrar(e.target.checked)}
              className="h-[20px] w-[20px] cursor-pointer rounded-[4px] border-[#C5CAD3] accent-[#0F0F14]"
            />
            Lembrar de mim
          </label>
          <Link href="/recuperar-senha" className="text-[15px] font-medium text-[#0F0F14] underline underline-offset-[3px] hover:text-[#3B3F4A]">
            Esqueci minha senha
          </Link>
        </div>

        <div className="mt-[28px]">
          <BotaoEntrar />
        </div>
      </form>
    </>
  )
}
