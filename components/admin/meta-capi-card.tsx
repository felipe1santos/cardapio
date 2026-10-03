'use client'

import { useEffect, useState } from 'react'

/**
 * API de Conversões do Meta (0138) em Integrações › Medição. O token fica só no servidor:
 * a tela mostra "configurado ••••abcd" e nunca o token inteiro.
 */
const BOTAO = 'inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARIO = `${BOTAO} bg-[#0688D4] text-white hover:bg-[#0570AE]`
const SECUNDARIO = `${BOTAO} border border-[#D1D5DB] bg-white text-[#1F2937] hover:border-[#0688D4] hover:text-[#0688D4]`
const CAMPO = 'h-[38px] w-full rounded-[8px] border border-[#D1D5DB] px-3 font-mono text-[13px] outline-none focus:border-[#0688D4]'

export function MetaCapiCard({ temPixel, avisar }: { temPixel: boolean; avisar: (m: string) => void }) {
  const [estado, setEstado] = useState<{ configurado: boolean; final: string | null; codigoTeste: string | null } | null>(null)
  const [editando, setEditando] = useState(false)
  const [token, setToken] = useState('')
  const [codigo, setCodigo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = () => fetch('/api/admin/integracoes/meta-capi', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => setEstado(j)).catch(() => setEstado(null))
  useEffect(() => { void carregar() }, [])

  async function salvar(corpo: Record<string, string | null>, ok: string) {
    setSalvando(true); setErro(null)
    const r = await fetch('/api/admin/integracoes/meta-capi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    const j = await r.json().catch(() => ({}))
    setSalvando(false)
    if (!r.ok) return setErro(j.error ?? 'Não foi possível salvar.')
    setEditando(false); setToken(''); avisar(ok); void carregar()
  }

  return (
    <section className="rounded-[12px] border border-[#E5E7EB] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] md:col-span-2" data-testid="meta-capi">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-[#111827]">API de Conversões do Meta</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6B7280]">
            Manda a <b>compra</b> também pelo servidor, com o mesmo código do pixel. Assim o pedido chega ao Gerenciador de Eventos mesmo
            quando o navegador do Instagram ou um bloqueador impede o pixel — e não conta em dobro.
          </p>
        </div>
        <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${estado?.configurado ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#F3F4F6] text-[#6B7280]'}`} data-testid="meta-capi-status">
          {estado?.configurado ? 'Ativa' : 'Não configurada'}
        </span>
      </div>
      {!temPixel && <p className="mt-3 text-[12.5px] text-[#92400E]">Configure primeiro o Pixel ID acima: a API de Conversões usa o mesmo pixel.</p>}
      {estado?.configurado && !editando && (
        <p className="mt-3 text-[13px] text-[#1F2937]" data-testid="meta-capi-final">
          Token salvo <span className="font-mono">••••{estado.final}</span>
          {estado.codigoTeste && <> · código de teste <span className="font-mono">{estado.codigoTeste}</span> (remova depois de testar)</>}
        </p>
      )}
      {editando ? (
        <div className="mt-3 space-y-2">
          <label className="block text-[12px] font-semibold text-[#374151]">Token de acesso (Gerenciador de Eventos › Configurações › API de Conversões › Gerar token)
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value.trim())} className={`${CAMPO} mt-1`} data-testid="meta-capi-token" />
          </label>
          <label className="block text-[12px] font-semibold text-[#374151]">Código de teste (opcional, aba &quot;Testar eventos&quot;)
            <input value={codigo} onChange={(e) => setCodigo(e.target.value.trim())} placeholder="TEST12345" className={`${CAMPO} mt-1 max-w-[220px]`} data-testid="meta-capi-codigo" />
          </label>
          {erro && <p className="text-[12.5px] text-[#B91C1C]" data-testid="meta-capi-erro">{erro}</p>}
          <div className="flex gap-2">
            <button type="button" className={SECUNDARIO} onClick={() => { setEditando(false); setErro(null) }} disabled={salvando}>Cancelar</button>
            <button type="button" className={PRIMARIO} disabled={salvando || (!token && !estado?.configurado)} data-testid="meta-capi-salvar"
              onClick={() => void salvar({ ...(token ? { token } : {}), codigoTeste: codigo || null }, 'API de Conversões salva.')}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button type="button" className={SECUNDARIO} onClick={() => { setEditando(true); setCodigo(estado?.codigoTeste ?? '') }} data-testid="meta-capi-editar">
            {estado?.configurado ? 'Trocar token' : 'Adicionar token'}
          </button>
          {estado?.configurado && (
            <button type="button" className={`${BOTAO} text-[#6B7280] hover:text-[#DC2626]`} disabled={salvando} data-testid="meta-capi-remover"
              onClick={() => void salvar({ token: null, codigoTeste: null }, 'API de Conversões removida.')}>Remover</button>
          )}
        </div>
      )}
    </section>
  )
}
