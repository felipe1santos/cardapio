'use client'

import { useCallback, useEffect, useState } from 'react'
import { mensagemAcessoMotoboy } from '@/lib/motoboy/login'
import { telefoneWhatsapp } from '@/lib/telefone-br'

/**
 * Tela "Acesso" do entregador (10/10/2026): UM jeito de entrar — login e senha no app.menuzia.com.br/login (ou o
 * QR da comanda). Sem QR de acesso e sem link mágico. A senha é gerada pelo servidor e aparece UMA vez (copiar /
 * enviar pelo WhatsApp); depois só é redefinida em "Gerar nova senha".
 */
const ENDERECO = 'app.menuzia.com.br/login'
const btn = 'h-[34px] rounded-[3px] border border-border bg-white px-3 text-[11px] font-semibold uppercase tracking-wide text-text-main hover:border-primary hover:text-primary disabled:opacity-50'
const btnPrim = 'h-[38px] w-full rounded-[3px] bg-primary px-3 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark disabled:opacity-50'

interface Info { usuario: string | null; ultimoLoginEm: string | null; loja: string; podeEquipe: boolean }

function Copiavel({ rotulo, valor, testid }: { rotulo: string; valor: string; testid: string }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{rotulo}</div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate rounded-[3px] border border-border bg-page px-2.5 py-2 font-mono text-[13px] text-text-main" data-testid={testid}>{valor}</div>
        <button type="button" className={btn} onClick={() => { void navigator.clipboard?.writeText(valor).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) }) }} data-testid={`${testid}-copiar`}>
          {ok ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}

export function AcessoMotoboy({ id, nome, telefone, desativado, credencialNova, onMudou }: {
  id: string; nome: string; telefone?: string | null; desativado?: boolean
  /** Login recém-criado no cadastro: a senha aparece aqui uma vez. */
  credencialNova?: { usuario: string; senha: string } | null
  onMudou: () => void
}) {
  const [info, setInfo] = useState<Info | null>(null)
  const [senha, setSenha] = useState<string | null>(credencialNova?.senha ?? null)
  const [msg, setMsg] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/admin/entregadores/${id}`, { cache: 'no-store' }).catch(() => null)
    if (r?.ok) setInfo(await r.json())
  }, [id])
  useEffect(() => { void carregar() }, [carregar])

  const acao = async (corpo: Record<string, unknown>, ok?: string) => {
    setOcupado(true); setMsg(null)
    const r = await fetch(`/api/admin/entregadores/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null)
    const j = (r ? await r.json().catch(() => ({})) : {}) as { error?: string; senha?: string; usuario?: string }
    setOcupado(false)
    if (!r?.ok) { setMsg(j.error ?? 'Não foi possível.'); return }
    if (j.senha) setSenha(j.senha)
    if (ok) setMsg(ok)
    await carregar()
    if (corpo.acao === 'desativar' || corpo.acao === 'reativar') onMudou()
  }

  const usuario = info?.usuario ?? credencialNova?.usuario ?? null
  const url = `https://${ENDERECO}`
  const whats = senha && usuario
    ? `https://wa.me/${telefone ? telefoneWhatsapp(telefone) ?? '' : ''}?text=${encodeURIComponent(mensagemAcessoMotoboy({ nome, loja: info?.loja ?? '', usuario, senha, url }))}`
    : null

  return (
    <div data-testid="acesso-motoboy">
      <p className="mb-4 text-xs leading-relaxed text-text-subtle">
        {nome} entra no app de entregas com login e senha — pelo endereço abaixo ou escaneando o QR da comanda. O app abre direto nas entregas dele.
      </p>

      {!info && <p className="text-[13px] text-text-subtle">Carregando…</p>}

      {info && !usuario && (
        <div className="rounded-[3px] border border-border p-3" data-testid="acesso-sem-login">
          <p className="mb-2 text-[13px] text-text-main">{nome} ainda não tem login.</p>
          {info.podeEquipe
            ? <button type="button" className={btnPrim} disabled={ocupado} onClick={() => void acao({ acao: 'criar_login' }, 'Login criado. Envie a senha agora — ela não aparece de novo.')} data-testid="acesso-criar-login">Criar login</button>
            : <p className="text-[12px] text-text-subtle">Peça ao dono ou gerente para criar o login.</p>}
        </div>
      )}

      {info && usuario && (
        <>
          <Copiavel rotulo="Login" valor={usuario} testid="acesso-login" />
          <Copiavel rotulo="Endereço do app" valor={ENDERECO} testid="acesso-endereco" />
          {senha ? (
            <div className="mb-3 rounded-[3px] border border-[#86EFAC] bg-[#F0FDF4] p-3" data-testid="acesso-senha-nova">
              <Copiavel rotulo="Senha (aparece só agora)" valor={senha} testid="acesso-senha" />
              {whats && <a href={whats} target="_blank" rel="noreferrer" className={`${btnPrim} flex items-center justify-center bg-[#16A34A] hover:bg-[#15803D]`} data-testid="acesso-whatsapp">Enviar pelo WhatsApp</a>}
              <p className="mt-2 text-[11.5px] text-[#166534]">Depois de fechar, a senha não aparece mais. Para trocar, gere outra.</p>
            </div>
          ) : (
            info.podeEquipe && <button type="button" className={`${btnPrim} mb-3`} disabled={ocupado} onClick={() => void acao({ acao: 'nova_senha' }, 'Senha nova gerada. A antiga parou de funcionar.')} data-testid="acesso-nova-senha">Gerar nova senha</button>
          )}
          <p className="mb-3 text-[12px] text-text-subtle">{info.ultimoLoginEm ? `Último acesso pelo login: ${new Date(info.ultimoLoginEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : 'Ainda não entrou com o login.'}</p>
        </>
      )}

      <div className="mt-2 flex flex-wrap gap-2 border-t border-border pt-3">
        {desativado
          ? <button type="button" className={btn} disabled={ocupado} onClick={() => void acao({ acao: 'reativar' }, `${nome} reativado.`)} data-testid="acesso-reativar">Reativar acesso</button>
          : <button type="button" className={`${btn} text-danger`} disabled={ocupado} onClick={() => void acao({ acao: 'desativar' }, `${nome} pausado: o app dele para na próxima ação.`)} data-testid="acesso-pausar">Pausar / desativar acesso</button>}
      </div>
      {msg && <p className="mt-2 text-[12px] font-semibold text-primary" data-testid="acesso-msg">{msg}</p>}
    </div>
  )
}
