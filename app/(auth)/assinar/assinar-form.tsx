'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { authAviso, authButton, authInput, authLabel } from '@/components/auth/auth-shell'
import { PLANOS, type Plano } from '@/lib/assinatura/planos'
import { assinar } from './actions'

type StatusUsuario = 'vazio' | 'checando' | 'disponivel' | 'em_uso' | 'invalido'

const DETALHE: Record<Plano, string[]> = {
  basico: ['Cardápio digital, mesas com QR, PDV e caixa', 'Pix e cartão online, impressão automática e KDS', 'iFood, 99Food, app do entregador'],
  completo: ['Tudo do Básico', 'Robô de atendimento 24h no WhatsApp', 'Disparos e campanhas, Financeiro e lucro real'],
}

function Botao() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={`${authButton} disabled:cursor-wait`}>
      {pending ? 'Gerando a cobrança…' : 'Ir para o pagamento'}
    </button>
  )
}

export function AssinarForm({ error, planoInicial }: { error?: string; planoInicial: Plano }) {
  const [plano, setPlano] = useState<Plano>(planoInicial)
  const [usuario, setUsuario] = useState('')
  const [statusUsuario, setStatusUsuario] = useState<StatusUsuario>('vazio')
  const [senha, setSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mesma checagem ao vivo do /cadastro (rota pública com limite por IP).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const valor = usuario.trim()
    if (!valor) { setStatusUsuario('vazio'); return }
    setStatusUsuario('checando')
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cadastro/verificar-usuario?usuario=${encodeURIComponent(valor)}`)
        const j = (await res.json()) as { status?: StatusUsuario }
        setStatusUsuario(j.status === 'disponivel' || j.status === 'em_uso' || j.status === 'invalido' ? j.status : 'invalido')
      } catch { setStatusUsuario('vazio') }
    }, 400)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [usuario])

  const senhasOk = senha.length >= 6 && senha === confirmarSenha

  return (
    <form action={assinar}>
      {error && <p role="alert" className={authAviso.erro}>{error}</p>}

      <fieldset className="mb-[16px]">
        <legend className={authLabel}>Plano</legend>
        <div className="grid gap-[8px] sm:grid-cols-2">
          {(Object.keys(PLANOS) as Plano[]).map((p) => {
            const ativo = plano === p
            return (
              <label key={p} className={`block cursor-pointer rounded-[3px] border p-[12px] ${ativo ? 'border-[#0688D4] bg-[#E0F2FE]' : 'border-[#E5E7EB] bg-white'}`}>
                <input type="radio" name="plano" value={p} checked={ativo} onChange={() => setPlano(p)} className="sr-only" />
                <span className="flex items-baseline justify-between gap-[8px]">
                  <span className="text-[14px] font-semibold text-[#1F2937]">{PLANOS[p].nome.replace('Menuzia ', '')}</span>
                  <span className="text-[14px] font-semibold text-[#0570AE]">R$ {PLANOS[p].valor}<span className="text-[11px] font-medium text-[#6B7280]">/mês</span></span>
                </span>
                <ul className="mt-[6px] list-disc pl-[16px] text-[12px] leading-[17px] text-[#4B5563]">
                  {DETALHE[p].map((l) => <li key={l}>{l}</li>)}
                </ul>
              </label>
            )
          })}
        </div>
        <p className="mt-[6px] text-[12px] text-[#6B7280]">Sem taxa por pedido. Sem contrato: cancele quando quiser.</p>
      </fieldset>

      <label className="mb-[16px] block">
        <span className={authLabel}>Seu nome completo</span>
        <input name="nome" type="text" required maxLength={80} autoComplete="name" className={authInput} />
      </label>
      <label className="mb-[16px] block">
        <span className={authLabel}>Nome do delivery</span>
        <input name="nomeLoja" type="text" required maxLength={80} placeholder="Ex: Burger do João" className={authInput} />
      </label>
      <label className="mb-[16px] block">
        <span className={authLabel}>E-mail</span>
        <input name="email" type="email" required autoComplete="email" className={authInput} />
      </label>
      <div className="mb-[16px] grid gap-[16px] sm:grid-cols-2">
        <label className="block">
          <span className={authLabel}>Celular / WhatsApp</span>
          <input name="telefone" type="tel" required inputMode="numeric" placeholder="(00) 00000-0000" className={authInput} />
        </label>
        <label className="block">
          <span className={authLabel}>CPF ou CNPJ</span>
          <input name="documento" type="text" required inputMode="numeric" placeholder="Só números" className={authInput} />
        </label>
      </div>

      <label className="mb-[6px] block">
        <span className={authLabel}>Nome de usuário (seu login)</span>
        <input name="usuario" type="text" required autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Ex: burgerdojoao" className={authInput} />
      </label>
      <p className="mb-[16px] min-h-[18px] text-[12px]">
        {statusUsuario === 'disponivel' && <span className="text-[#16A34A]">Usuário disponível.</span>}
        {statusUsuario === 'em_uso' && <span className="text-danger">Este usuário já está em uso.</span>}
        {statusUsuario === 'invalido' && <span className="text-danger">De 3 a 30 caracteres: letras, números, ponto, hífen ou underline.</span>}
        {(statusUsuario === 'vazio' || statusUsuario === 'checando') && <span className="text-[#6B7075]">Não precisa ser o e-mail. É o nome que você vai usar pra entrar.</span>}
      </p>

      <label className="mb-[16px] block">
        <span className={authLabel}>Senha</span>
        <input name="senha" type="password" autoComplete="new-password" required minLength={6} value={senha} onChange={(e) => setSenha(e.target.value)} className={authInput} />
      </label>
      <label className="mb-[6px] block">
        <span className={authLabel}>Confirmar senha</span>
        <input name="confirmarSenha" type="password" autoComplete="new-password" required minLength={6} value={confirmarSenha} onChange={(e) => setConfirmarSenha(e.target.value)} className={authInput} />
      </label>
      <p className="mb-[20px] min-h-[18px] text-[12px]">
        {confirmarSenha.length > 0 && !senhasOk && <span className="text-danger">{senha.length < 6 ? 'A senha deve ter no mínimo 6 caracteres.' : 'As senhas não coincidem.'}</span>}
        {senhasOk && <span className="text-[#16A34A]">Senhas conferem.</span>}
      </p>

      <Botao />
      <p className="mt-[12px] text-[12px] leading-[17px] text-[#6B7280]">
        Você vai para a página de pagamento (Pix, boleto ou cartão). Assim que o pagamento for confirmado, o acesso é liberado e você recebe um e-mail com os dados de entrada.
      </p>
    </form>
  )
}
