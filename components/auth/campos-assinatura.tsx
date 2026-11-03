'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { authAviso, authButton } from './auth-shell'
import { CampoFlutuante, OlhoSenha } from './login-cartao'
import { assinar } from '@/app/(auth)/assinar/actions'
import type { Plano } from '@/lib/assinatura/planos'

type StatusUsuario = 'vazio' | 'checando' | 'disponivel' | 'em_uso' | 'invalido'

function Botao() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={`${authButton} disabled:cursor-wait`} data-testid="assinar-enviar">
      {pending ? 'Gerando a cobrança…' : 'Ir para o pagamento'}
    </button>
  )
}

/**
 * Dados do lojista para a assinatura (docs/ASSINATURA-ASAAS.md), nos campos contornados do login.
 * Usado no modal "Adquirir acesso" (login) e na página /assinar. `plano` vai escondido; `origem` diz para
 * onde o servidor volta com erro (o modal reabre no mesmo passo).
 */
export function CamposAssinatura({ plano, origem, erro }: { plano: Plano; origem: 'login' | 'pagina'; erro?: string | null }) {
  const [usuario, setUsuario] = useState('')
  const [statusUsuario, setStatusUsuario] = useState<StatusUsuario>('vazio')
  const [senha, setSenha] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [verSenha, setVerSenha] = useState(false)
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

  const senhasOk = senha.length >= 6 && senha === confirmar

  return (
    <form action={assinar} className="space-y-[18px]">
      <input type="hidden" name="plano" value={plano} />
      <input type="hidden" name="origem" value={origem} />
      {erro && <p role="alert" className={authAviso.erro}>{erro}</p>}

      <CampoFlutuante id="ass-nome" rotulo="Seu nome completo *" name="nome" type="text" required maxLength={80} autoComplete="name" />
      <CampoFlutuante id="ass-loja" rotulo="Nome do delivery *" name="nomeLoja" type="text" required maxLength={80} />
      <CampoFlutuante id="ass-email" rotulo="E-mail *" name="email" type="email" required autoComplete="email" autoCapitalize="none" />
      <div className="grid gap-[18px] sm:grid-cols-2">
        <CampoFlutuante id="ass-tel" rotulo="Celular / WhatsApp *" name="telefone" type="tel" required inputMode="numeric" autoComplete="tel" />
        <CampoFlutuante id="ass-doc" rotulo="CPF ou CNPJ *" name="documento" type="text" required inputMode="numeric" />
      </div>
      <div>
        <CampoFlutuante id="ass-usuario" rotulo="Nome de usuário (seu login) *" name="usuario" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} value={usuario} onChange={(e) => setUsuario(e.target.value)} />
        <p className="mt-[6px] min-h-[16px] text-[12px] leading-[16px]">
          {statusUsuario === 'disponivel' && <span className="text-[#16A34A]">Usuário disponível.</span>}
          {statusUsuario === 'em_uso' && <span className="text-[#B91C1C]">Este usuário já está em uso.</span>}
          {statusUsuario === 'invalido' && <span className="text-[#B91C1C]">De 3 a 30 caracteres: letras, números, ponto, hífen ou underline.</span>}
          {(statusUsuario === 'vazio' || statusUsuario === 'checando') && <span className="text-[#6B7280]">Não precisa ser o e-mail. É o nome que você vai usar pra entrar.</span>}
        </p>
      </div>
      <CampoFlutuante id="ass-senha" rotulo="Senha *" name="senha" type={verSenha ? 'text' : 'password'} autoComplete="new-password" required minLength={6} value={senha} onChange={(e) => setSenha(e.target.value)} className="pr-[52px]" extra={<OlhoSenha visivel={verSenha} alternar={() => setVerSenha((v) => !v)} />} />
      <div>
        <CampoFlutuante id="ass-confirmar" rotulo="Confirmar senha *" name="confirmarSenha" type={verSenha ? 'text' : 'password'} autoComplete="new-password" required minLength={6} value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
        <p className="mt-[6px] min-h-[16px] text-[12px] leading-[16px]">
          {confirmar.length > 0 && !senhasOk && <span className="text-[#B91C1C]">{senha.length < 6 ? 'A senha deve ter no mínimo 6 caracteres.' : 'As senhas não coincidem.'}</span>}
          {senhasOk && <span className="text-[#16A34A]">Senhas conferem.</span>}
        </p>
      </div>

      <Botao />
      <p className="text-[12px] leading-[17px] text-[#6B7280]">
        Você vai para a página de pagamento (Pix, boleto ou cartão). Com o pagamento confirmado, o acesso é liberado na hora e você recebe um e-mail com os dados de entrada.
      </p>
    </form>
  )
}
