'use client'

import { useEffect, useMemo, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { loginParaMostrar, temGoogleVinculado } from '@/lib/auth/senha-padrao'

/** Abre a janela "Minha conta" de qualquer lugar do painel (ex.: a faixa da senha padrão). */
export const EVENTO_ABRIR_MINHA_CONTA = 'menuzia:minha-conta'
/** Disparado depois de trocar a senha: a faixa amarela da senha padrão some sem recarregar. */
export const EVENTO_SENHA_TROCADA = 'menuzia:senha-trocada'

/**
 * "Minha conta" (20/10/2026), no menu do perfil do topo: nome, login, conta Google vinculada e "Alterar senha". Vale
 * para o dono e para a equipe — a troca é a mesma de sempre (/api/admin/conta/senha, que confere a senha atual).
 */
export function ModalMinhaConta({ onFechar }: { onFechar: () => void }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [conta, setConta] = useState<{ nome: string; login: { rotulo: string; valor: string }; google: boolean } | null>(null)
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [conf, setConf] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user) return
      const { data: u } = await supabase.from('usuarios').select('nome, usuario').eq('id', data.user.id).maybeSingle()
      if (vivo) setConta({
        nome: (u?.nome as string | undefined) ?? '',
        login: loginParaMostrar({ email: data.user.email ?? null, usuario: (u?.usuario as string | undefined) ?? null }),
        google: temGoogleVinculado(data.user),
      })
    })().catch(() => {})
    return () => { vivo = false }
  }, [supabase])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])

  async function salvar() {
    setErro(null)
    if (!atual) return setErro('Informe a senha atual.')
    if (nova.length < 6) return setErro('A senha deve ter no mínimo 6 caracteres.')
    if (nova !== conf) return setErro('As senhas não coincidem.')
    setSalvando(true)
    try {
      const r = await fetch('/api/admin/conta/senha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ atual, nova }) })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) return setErro(j.error ?? 'Não foi possível alterar a senha. Tente novamente.')
      setAtual(''); setNova(''); setConf(''); setOk(true)
      window.dispatchEvent(new Event(EVENTO_SENHA_TROCADA))
    } catch {
      setErro('Não foi possível alterar a senha. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  const campo = 'h-[40px] w-full rounded-[3px] border border-[#E5E7EB] px-[10px] text-[14px] outline-none focus:border-[#0688D4]'
  const rotulo = 'mb-[4px] block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]'
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#111827]/60 p-4" data-testid="modal-minha-conta" data-esc-local onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <div role="dialog" aria-modal="true" aria-label="Minha conta" className="w-full max-w-[400px] rounded-[3px] border border-[#E5E7EB] bg-white shadow-xl">
        <div className="border-b border-[#E5E7EB] px-[16px] py-[12px]">
          <h2 className="text-[15px] font-semibold text-[#1F2937]">Minha conta</h2>
        </div>
        <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-[6px] border-b border-[#E5E7EB] px-[16px] py-[12px] text-[13px]" data-testid="minha-conta-dados">
          <dt className="text-[#6B7280]">Nome</dt><dd className="min-w-0 truncate font-medium text-[#1F2937]">{conta?.nome || '—'}</dd>
          <dt className="text-[#6B7280]">{conta?.login.rotulo ?? 'E-mail'}</dt><dd className="min-w-0 break-all font-medium text-[#1F2937]">{conta?.login.valor || '—'}</dd>
          {conta?.google && (<><dt className="text-[#6B7280]">Google</dt><dd><span className="rounded-[3px] bg-[#DCFCE7] px-2 py-[2px] text-[11px] font-semibold text-[#16A34A]" data-testid="minha-conta-google">Conta Google vinculada</span></dd></>)}
        </dl>
        {ok ? (
          <div className="px-[16px] py-[16px]">
            <p className="text-[13px] font-medium text-[#16A34A]" data-testid="minha-conta-senha-ok">Senha alterada. Use a nova senha no próximo login.</p>
            <div className="mt-[14px] flex justify-end">
              <button type="button" onClick={onFechar} className="h-[36px] rounded-[3px] bg-[#0688D4] px-[14px] text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-[#0570AE]">Fechar</button>
            </div>
          </div>
        ) : (
          <form className="space-y-[10px] px-[16px] py-[14px]" onSubmit={(e) => { e.preventDefault(); void salvar() }}>
            <h3 className="text-[13px] font-semibold text-[#1F2937]">Alterar senha</h3>
            <label className="block"><span className={rotulo}>Senha atual</span>
              <input type="password" autoComplete="current-password" className={campo} value={atual} onChange={(e) => setAtual(e.target.value)} data-testid="minha-conta-atual" />
            </label>
            {/* new-password: sem isto o navegador preenche com a senha salva e a pessoa "troca" pela mesma. */}
            <label className="block"><span className={rotulo}>Nova senha</span>
              <input type="password" autoComplete="new-password" placeholder="Mínimo 6 caracteres" className={campo} value={nova} onChange={(e) => setNova(e.target.value)} data-testid="minha-conta-nova" />
            </label>
            <label className="block"><span className={rotulo}>Confirmar nova senha</span>
              <input type="password" autoComplete="new-password" className={campo} value={conf} onChange={(e) => setConf(e.target.value)} data-testid="minha-conta-confirmar" />
            </label>
            {erro && <p className="rounded-[3px] bg-[#FEE2E2] px-3 py-2 text-[12.5px] text-[#B91C1C]" data-testid="minha-conta-erro">{erro}</p>}
            <div className="flex justify-end gap-2 pt-[4px]">
              <button type="button" onClick={onFechar} className="h-[36px] rounded-[3px] border border-[#E5E7EB] px-[14px] text-[11px] font-semibold uppercase tracking-wide text-[#1F2937] hover:bg-[#EDEEF1]">Cancelar</button>
              <button type="submit" disabled={salvando} className="h-[36px] rounded-[3px] bg-[#0688D4] px-[14px] text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-[#0570AE] disabled:opacity-60" data-testid="minha-conta-salvar">{salvando ? 'Salvando…' : 'Alterar senha'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
