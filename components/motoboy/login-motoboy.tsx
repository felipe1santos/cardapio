'use client'

import { useState } from 'react'
import { Bike, Eye, EyeOff } from 'lucide-react'

/**
 * Login do app do motoboy (item 61): nome + senha, cadastrados pela loja no "+ Motoboy" do Despacho.
 * Fica no próprio /motoboy — quem chega pelo QR da comanda (/motoboy?qr=…) entra e cai direto no
 * pedido. A sessão fica salva no celular até tocar em "Sair".
 */
export function LoginMotoboy({ onEntrou }: { onEntrou: () => void }) {
  const [nome, setNome] = useState('')
  const [senha, setSenha] = useState('')
  const [ver, setVer] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    if (enviando) return
    setEnviando(true); setErro(null)
    try {
      const qr = new URLSearchParams(window.location.search).get('qr')
      const r = await fetch('/api/motoboy/entrar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, senha, qr }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error ?? 'Não foi possível entrar.'); return }
      onEntrou()
    } catch {
      setErro('Sem internet. Tente de novo quando a conexão voltar.')
    } finally { setEnviando(false) }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#111827] p-5" data-testid="motoboy-login">
      <form onSubmit={(e) => void entrar(e)} className="w-full max-w-sm rounded-[12px] bg-white p-5 shadow-[0_20px_48px_rgba(0,0,0,0.35)]">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#E0F2FE] text-[#0369A1]"><Bike className="h-6 w-6" /></span>
          <div>
            <h1 className="text-[18px] font-semibold text-[#1F2937]">App do motoboy</h1>
            <p className="text-[13px] text-[#4B5563]">Entre com o nome e a senha que a loja cadastrou.</p>
          </div>
        </div>
        <label className="block text-[13px] font-semibold text-[#1F2937]" htmlFor="motoboy-login-nome">Seu nome</label>
        <input id="motoboy-login-nome" autoComplete="username" autoCapitalize="words" value={nome} onChange={(e) => setNome(e.target.value.slice(0, 60))}
          className="mt-1 h-[48px] w-full rounded-[8px] border border-[#CBD2D9] px-3 text-[16px] text-[#1F2937]" data-testid="motoboy-login-nome" />
        <label className="mt-3 block text-[13px] font-semibold text-[#1F2937]" htmlFor="motoboy-login-senha">Senha</label>
        <div className="mt-1 flex h-[48px] items-center rounded-[8px] border border-[#CBD2D9] pr-1">
          <input id="motoboy-login-senha" type={ver ? 'text' : 'password'} autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value.slice(0, 72))}
            className="h-full min-w-0 flex-1 rounded-[8px] bg-transparent px-3 text-[16px] text-[#1F2937] outline-none" data-testid="motoboy-login-senha" />
          <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Esconder a senha' : 'Mostrar a senha'} className="flex h-[44px] w-[44px] items-center justify-center text-[#4B5563]">
            {ver ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {erro && <p className="mt-3 rounded-[8px] bg-[#FEE2E2] px-3 py-2 text-[13px] font-semibold text-[#B91C1C]" role="alert" data-testid="motoboy-login-erro">{erro}</p>}
        <button type="submit" disabled={enviando || !nome.trim() || !senha} data-testid="motoboy-login-entrar"
          className="mt-4 h-[52px] w-full rounded-[8px] bg-[#0570AE] text-[16px] font-semibold text-white disabled:opacity-50">
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
