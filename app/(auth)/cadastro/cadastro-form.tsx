'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { authInput, authButton } from '@/components/auth/auth-shell'
import { cadastrar } from './actions'

const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-subtle'

type StatusEmail = 'vazio' | 'checando' | 'autorizado' | 'nao_encontrado' | 'ja_cadastrado'
type StatusUsuario = 'vazio' | 'checando' | 'disponivel' | 'em_uso' | 'invalido'

/** ✓ em círculo verde — confirmação visual de campo validado. */
function CheckVerde() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#16A34A] text-[13px] font-bold text-white shadow-sm">
      ✓
    </span>
  )
}

function Spinner() {
  return (
    <span className="block h-4 w-4 animate-spin rounded-full border-2 border-[#1e3a8a]/25 border-t-[#1e3a8a]" />
  )
}

export function CadastroForm({ error }: { error?: string }) {
  const [email, setEmail] = useState('')
  const [statusEmail, setStatusEmail] = useState<StatusEmail>('vazio')
  const [usuario, setUsuario] = useState('')
  const [statusUsuario, setStatusUsuario] = useState<StatusUsuario>('vazio')
  const [senha, setSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const emailTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const usuarioTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Checagem ao vivo do e-mail autorizado (debounce 500ms)
  useEffect(() => {
    if (emailTimer.current) clearTimeout(emailTimer.current)
    const valor = email.trim().toLowerCase()
    if (!valor || !valor.includes('@') || !valor.includes('.')) {
      setStatusEmail('vazio')
      return
    }
    setStatusEmail('checando')
    emailTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cadastro/verificar-email?email=${encodeURIComponent(valor)}`)
        const data = await res.json()
        setStatusEmail(data.status === 'autorizado' ? 'autorizado' : data.status === 'ja_cadastrado' ? 'ja_cadastrado' : 'nao_encontrado')
      } catch {
        setStatusEmail('nao_encontrado')
      }
    }, 500)
    return () => { if (emailTimer.current) clearTimeout(emailTimer.current) }
  }, [email])

  // Checagem ao vivo do nome de usuário (debounce 500ms)
  useEffect(() => {
    if (usuarioTimer.current) clearTimeout(usuarioTimer.current)
    const valor = usuario.trim()
    if (!valor) {
      setStatusUsuario('vazio')
      return
    }
    setStatusUsuario('checando')
    usuarioTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cadastro/verificar-usuario?usuario=${encodeURIComponent(valor)}`)
        const data = await res.json()
        setStatusUsuario(data.status === 'disponivel' ? 'disponivel' : data.status === 'em_uso' ? 'em_uso' : 'invalido')
      } catch {
        setStatusUsuario('invalido')
      }
    }, 500)
    return () => { if (usuarioTimer.current) clearTimeout(usuarioTimer.current) }
  }, [usuario])

  const liberado = statusEmail === 'autorizado'
  const senhasOk = senha.length >= 6 && senha === confirmarSenha
  const podeEnviar = liberado && statusUsuario === 'disponivel' && senhasOk

  return (
    <form action={cadastrar}>
      <p className="mb-5 rounded-menuzia bg-[#E0F2FE] px-3 py-2 text-center text-xs font-medium leading-relaxed text-[#1e3a8a]">
        Digite o e-mail autorizado pela Menuzia. Quando ele for confirmado, o restante do cadastro é liberado.
      </p>

      {error && (
        <p className="mb-4 rounded-menuzia bg-danger-bg px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {/* E-mail autorizado — campo em destaque com borda azul escura */}
      <label className="mb-1 block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#1e3a8a]">E-mail autorizado</span>
        <span className="relative block">
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@autorizado.com"
            className={[
              'w-full rounded-menuzia border-2 bg-white px-4 py-3 pr-12 text-sm text-text-main placeholder:text-text-subtle focus:outline-none transition-colors',
              statusEmail === 'autorizado' ? 'border-[#16A34A]' : 'border-[#1e3a8a]',
            ].join(' ')}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {statusEmail === 'checando' && <Spinner />}
            {statusEmail === 'autorizado' && <CheckVerde />}
          </span>
        </span>
      </label>
      <p className="mb-4 min-h-[16px] text-[11px] font-medium">
        {statusEmail === 'autorizado' && <span className="text-[#16A34A]">E-mail confirmado! Preencha os dados abaixo.</span>}
        {statusEmail === 'nao_encontrado' && <span className="text-danger">E-mail não autorizado. Confirme com a Menuzia o e-mail cadastrado pra você.</span>}
        {statusEmail === 'ja_cadastrado' && (
          <span className="text-danger">
            Este e-mail já concluiu o cadastro.{' '}
            <Link href="/login" className="font-semibold underline">Faça login</Link>.
          </span>
        )}
      </p>

      {/* Restante do cadastro — liberado só com e-mail confirmado */}
      <fieldset disabled={!liberado} className={liberado ? '' : 'pointer-events-none select-none opacity-40'}>
        <label className="mb-3 block">
          <span className={labelClass}>Nome completo</span>
          <input name="nome" type="text" required className={authInput} />
        </label>

        <label className="mb-3 block">
          <span className={labelClass}>Nome do delivery</span>
          <input name="nomeLoja" type="text" required placeholder="Ex: Burger do João" className={authInput} />
        </label>

        <label className="mb-3 block">
          <span className={labelClass}>Telefone / WhatsApp</span>
          <input name="telefone" type="tel" required placeholder="(00) 00000-0000" className={authInput} />
        </label>

        <label className="mb-1 block">
          <span className={labelClass}>Nome de usuário (seu login)</span>
          <span className="relative block">
            <input
              name="usuario"
              type="text"
              required
              autoComplete="username"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="Ex: burgerdojoao"
              className={`${authInput} pr-12`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              {statusUsuario === 'checando' && <Spinner />}
              {statusUsuario === 'disponivel' && <CheckVerde />}
            </span>
          </span>
        </label>
        <p className="mb-3 min-h-[16px] text-[11px] font-medium">
          {statusUsuario === 'disponivel' && <span className="text-[#16A34A]">Usuário disponível.</span>}
          {statusUsuario === 'em_uso' && <span className="text-danger">Este usuário já está em uso.</span>}
          {statusUsuario === 'invalido' && <span className="text-danger">De 3 a 30 caracteres: letras, números, ponto, hífen ou underline.</span>}
          {(statusUsuario === 'vazio' || statusUsuario === 'checando') && (
            <span className="text-text-subtle">Não precisa ser o e-mail — é o nome que você vai usar pra entrar.</span>
          )}
        </p>

        <label className="mb-3 block">
          <span className={labelClass}>Senha</span>
          <input name="senha" type="password" required minLength={6} value={senha} onChange={(e) => setSenha(e.target.value)} className={authInput} />
        </label>

        <label className="mb-1 block">
          <span className={labelClass}>Confirmar senha</span>
          <input name="confirmarSenha" type="password" required minLength={6} value={confirmarSenha} onChange={(e) => setConfirmarSenha(e.target.value)} className={authInput} />
        </label>
        <p className="mb-5 min-h-[16px] text-[11px] font-medium">
          {confirmarSenha.length > 0 && !senhasOk && <span className="text-danger">{senha.length < 6 ? 'A senha deve ter no mínimo 6 caracteres.' : 'As senhas não coincidem.'}</span>}
          {senhasOk && <span className="text-[#16A34A]">Senhas conferem.</span>}
        </p>

        <button type="submit" disabled={!podeEnviar} className={`${authButton} disabled:cursor-not-allowed disabled:opacity-50`}>
          Concluir cadastro
        </button>
      </fieldset>

      <p className="mt-4 text-center text-xs text-text-subtle">
        Já tem conta?{' '}
        <Link href="/login" className="font-semibold text-[#21478C]">
          Entrar
        </Link>
      </p>
    </form>
  )
}
