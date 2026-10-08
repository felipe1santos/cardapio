'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { ModalCentral } from '@/components/ui/flutuante'

/**
 * "+ Motoboy" do Despacho (item 61): nome, senha e telefone (opcional). Cria o motoboy e o login
 * do app de uma vez (POST /api/admin/entregadores). O motoboy entra no app com o NOME e a senha.
 */
export function NovoMotoboy({ aberto, onFechar, onCriado }: { aberto: boolean; onFechar: () => void; onCriado: (nome: string) => void }) {
  const [nome, setNome] = useState('')
  const [senha, setSenha] = useState('')
  const [telefone, setTelefone] = useState('')
  const [ver, setVer] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  function fechar() { setNome(''); setSenha(''); setTelefone(''); setErro(null); onFechar() }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (salvando) return
    setSalvando(true); setErro(null)
    try {
      const r = await fetch('/api/admin/entregadores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome, senha, telefone }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error ?? 'Não foi possível cadastrar.'); return }
      const n = nome.trim()
      fechar(); onCriado(n)
    } catch {
      setErro('Sem conexão. Tente de novo.')
    } finally { setSalvando(false) }
  }

  const campo = 'mt-1 h-[44px] w-full rounded-[6px] border border-[#CBD2D9] px-3 text-[15px] text-[#1F2937]'
  return (
    <ModalCentral aberto={aberto} onFechar={fechar} titulo="Novo motoboy" subtitulo="Ele entra no app do motoboy com este nome e a senha." largura={420} testid="novo-motoboy" classeCorpo="p-4 sm:p-5">
      <form onSubmit={(e) => void salvar(e)} data-testid="novo-motoboy-form">
        <label className="block text-[13px] font-semibold text-[#1F2937]" htmlFor="novo-motoboy-nome">Nome</label>
        <input id="novo-motoboy-nome" value={nome} onChange={(e) => setNome(e.target.value.slice(0, 60))} placeholder="Ex.: João Silva" className={campo} data-testid="novo-motoboy-nome" />
        <label className="mt-3 block text-[13px] font-semibold text-[#1F2937]" htmlFor="novo-motoboy-senha">Senha</label>
        <div className="mt-1 flex h-[44px] items-center rounded-[6px] border border-[#CBD2D9] pr-1">
          <input id="novo-motoboy-senha" type={ver ? 'text' : 'password'} autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value.slice(0, 72))} placeholder="Mínimo 8 caracteres"
            className="h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] text-[#1F2937] outline-none" data-testid="novo-motoboy-senha" />
          <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Esconder a senha' : 'Mostrar a senha'} className="flex h-[40px] w-[40px] items-center justify-center text-[#4B5563]">
            {ver ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        </div>
        <label className="mt-3 block text-[13px] font-semibold text-[#1F2937]" htmlFor="novo-motoboy-telefone">Telefone <span className="font-normal text-[#4B5563]">(opcional)</span></label>
        <input id="novo-motoboy-telefone" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value.slice(0, 20))} placeholder="(27) 99999-9999" className={campo} data-testid="novo-motoboy-telefone" />
        {erro && <p className="mt-3 rounded-[6px] bg-[#FEE2E2] px-3 py-2 text-[13px] font-semibold text-[#B91C1C]" role="alert" data-testid="novo-motoboy-erro">{erro}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={fechar} className="h-[40px] rounded-[6px] border border-[#CBD2D9] bg-white px-4 text-[13px] font-semibold text-[#1F2937]">Cancelar</button>
          <button type="submit" disabled={salvando || !nome.trim() || senha.length < 8} className="h-[40px] rounded-[6px] bg-[#0570AE] px-4 text-[13px] font-semibold text-white disabled:opacity-50" data-testid="novo-motoboy-salvar">
            {salvando ? 'Salvando…' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </ModalCentral>
  )
}
