'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { CIDADES_LALAMOVE_BR, type Cobertura } from '@/lib/entregas/lalamove-cidades'
import type { ConfigPublica } from '@/lib/entregas/queries'

/**
 * Integrações › Lalamove (0199). O DONO cola a API key e o secret da conta Lalamove DELE (cada loja paga a própria
 * Lalamove). As chaves ficam cifradas no servidor e nunca voltam (só "••••abcd"). "Testar conexão" lista as cidades da
 * conta, escolhe a da loja e registra o webhook. Aviso de cobertura ANTES de o lojista criar a conta.
 * Mesmo visual do MetaCapiCard (cantos 8px, botões 13px).
 */
const BOTAO = 'inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARIO = `${BOTAO} bg-[#0688D4] text-white hover:bg-[#0570AE]`
const SECUNDARIO = `${BOTAO} border border-[#D1D5DB] bg-white text-[#1F2937] hover:border-[#0688D4] hover:text-[#0688D4]`
const CAMPO = 'h-[38px] w-full rounded-[8px] border border-[#D1D5DB] px-3 font-mono text-[13px] outline-none focus:border-[#0688D4]'

interface Estado { config: ConfigPublica | null; cobertura: Cobertura; webhookUrl: string | null; cofrePronto: boolean }
interface Teste { ambiente: string; cidades: string[]; cidadeLoja: string; cidadeEscolhida: string | null; webhookOk: boolean; aviso: string | null }

export function LalamoveCard({ avisar }: { avisar: (m: string) => void }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [editando, setEditando] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [teste, setTeste] = useState<Teste | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = () => fetch('/api/admin/entregas/lalamove/config', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => setEstado(j)).catch(() => setEstado(null))
  useEffect(() => { void carregar() }, [])

  async function salvar(corpo: Record<string, unknown>, ok: string) {
    setSalvando(true); setErro(null)
    const r = await fetch('/api/admin/entregas/lalamove/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    const j = await r.json().catch(() => ({}))
    setSalvando(false)
    if (!r.ok) return setErro(j.error ?? 'Não foi possível salvar.')
    setEditando(false); setApiKey(''); setApiSecret(''); setEstado(j); avisar(ok)
  }
  async function testar() {
    setTestando(true); setErro(null); setTeste(null)
    const r = await fetch('/api/admin/entregas/lalamove/testar', { method: 'POST' })
    const j = await r.json().catch(() => ({}))
    setTestando(false)
    if (!r.ok) return setErro(j.error ?? 'A Lalamove não respondeu.')
    setTeste(j); void carregar()
  }

  const cfg = estado?.config ?? null
  const cob = estado?.cobertura
  const conectada = !!cfg?.temChaves
  return (
    <section className="space-y-4" data-testid="lalamove-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-[#6B7280]">
          Chame um entregador da Lalamove direto do Kanban, vendo o <b>preço antes de confirmar</b>. A corrida é paga pela <b>conta Lalamove da sua loja</b> (a Menuzia não cobra nada por isso).
        </p>
        <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${cfg?.ativo ? 'bg-[#DCFCE7] text-[#15803D]' : conectada ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#F3F4F6] text-[#6B7280]'}`} data-testid="lalamove-status">
          {cfg?.ativo ? 'Ativa' : conectada ? 'Desligada' : 'Não conectada'}
        </span>
      </div>

      {/* Cobertura: aviso antes de criar conta. */}
      {cob && cob.atende === false && (
        <p className="flex items-start gap-2 rounded-[8px] border border-[#FCD34D] bg-[#FEF3C7] px-3 py-2.5 text-[13px] text-[#92400E]" data-testid="lalamove-fora-area">
          <AlertTriangle className="mt-[2px] h-4 w-4 flex-shrink-0" aria-hidden />
          <span><b>Lalamove ainda não atende sua cidade</b> ({cob.cidade}). Cidades atendidas hoje: {CIDADES_LALAMOVE_BR.join(', ')}. Se a lista mudar, basta conectar.</span>
        </p>
      )}
      {cob && cob.atende === true && (
        <p className="flex items-center gap-2 text-[13px] text-[#15803D]" data-testid="lalamove-na-area">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> {cob.vizinha ? <>{cob.cidade} fica na região de <b>{cob.vizinha}</b>, atendida pela Lalamove — confirme com uma cotação.</> : <><b>{cob.cidade}</b> é atendida pela Lalamove.</>}
        </p>
      )}
      {cob && cob.atende === 'desconhecida' && <p className="text-[13px] text-[#6B7280]">Cadastre a cidade da loja em Ajustes para conferir a cobertura.</p>}
      {estado && !estado.cofrePronto && <p className="text-[13px] text-[#B91C1C]">O servidor está sem a chave do cofre; fale com o suporte da Menuzia antes de colar as chaves.</p>}

      <details className="rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[13px] text-[#374151]" data-testid="lalamove-passo-a-passo">
        <summary className="cursor-pointer font-semibold">Como pegar as chaves da Lalamove (passo a passo)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Crie a conta em <a href="https://partnerportal.lalamove.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#0688D4] underline">partnerportal.lalamove.com</a> com o e-mail da loja (país Brasil).</li>
          <li>No menu <b>Developers</b>, use o seletor no canto superior direito: <b>Sandbox</b> para testar (sem cobrança) ou <b>Production</b> para corridas de verdade.</li>
          <li>Copie a <b>API key</b> (pk_…) e o <b>Secret</b> (sk_…) e cole aqui. Guardamos cifrados; a tela só mostra os 4 últimos.</li>
          <li>Para produção, coloque crédito na <b>carteira Lalamove</b> (Wallet) — sem saldo a Lalamove recusa a corrida.</li>
          <li>Toque em <b>Testar conexão</b>: conferimos a cidade da loja e registramos o aviso automático (webhook). Depois, <b>Ligar no Kanban</b>.</li>
        </ol>
      </details>

      {conectada && !editando && (
        <div className="space-y-1 text-[13px] text-[#1F2937]" data-testid="lalamove-conectada">
          <p>API key salva <span className="font-mono">••••{cfg!.apiKeyFinal}</span> · ambiente <b>{cfg!.ambiente === 'producao' ? 'Produção' : 'Teste (sandbox)'}</b></p>
          {cfg!.cidadeNome && <p>Cidade na Lalamove: <b>{cfg!.cidadeNome}</b> · veículo <span className="font-mono">{cfg!.servico}</span></p>}
          <p className="text-[#6B7280]">Webhook {cfg!.webhookRegistradoEm ? <span className="text-[#15803D]">registrado</span> : <span className="text-[#92400E]">ainda não registrado — toque em Testar conexão</span>}</p>
        </div>
      )}

      {editando ? (
        <div className="space-y-2">
          <label className="block text-[12px] font-semibold text-[#374151]">API key (Partner Portal › Developers · começa com pk_test_ ou pk_prod_)
            <input autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} className={`${CAMPO} mt-1`} data-testid="lalamove-apikey" />
          </label>
          <label className="block text-[12px] font-semibold text-[#374151]">Secret (sk_test_ ou sk_prod_)
            <input type="password" autoComplete="off" value={apiSecret} onChange={(e) => setApiSecret(e.target.value.trim())} className={`${CAMPO} mt-1`} data-testid="lalamove-secret" />
          </label>
          <p className="text-[12px] text-[#6B7280]">O ambiente (Teste/Produção) segue a chave: pk_test = sandbox, sem cobrança; pk_prod = corridas de verdade.</p>
          {erro && <p className="text-[12.5px] text-[#B91C1C]" data-testid="lalamove-erro">{erro}</p>}
          <div className="flex gap-2">
            <button type="button" className={SECUNDARIO} onClick={() => { setEditando(false); setErro(null) }} disabled={salvando}>Cancelar</button>
            <button type="button" className={PRIMARIO} disabled={salvando || !apiKey || !apiSecret} data-testid="lalamove-salvar" onClick={() => void salvar({ apiKey, apiSecret }, 'Chaves da Lalamove salvas. Toque em Testar conexão.')}>{salvando ? 'Salvando…' : 'Salvar chaves'}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECUNDARIO} onClick={() => setEditando(true)} data-testid="lalamove-editar" disabled={estado ? !estado.cofrePronto : true}>{conectada ? 'Trocar chaves' : 'Conectar com minhas chaves'}</button>
          {conectada && (
            <>
              <button type="button" className={SECUNDARIO} onClick={() => void testar()} disabled={testando} data-testid="lalamove-testar">{testando ? <><Loader2 className="h-4 w-4 animate-spin" /> Testando…</> : 'Testar conexão'}</button>
              <button type="button" className={cfg!.ativo ? `${BOTAO} border border-[#D1D5DB] bg-white text-[#B91C1C] hover:border-[#B91C1C]` : PRIMARIO} disabled={salvando} data-testid="lalamove-ligar"
                onClick={() => void salvar({ ativo: !cfg!.ativo }, cfg!.ativo ? 'Lalamove desligada. O botão sai do Kanban.' : 'Lalamove ligada. O botão "Lalamove" aparece nos pedidos prontos para entrega.')}>
                {cfg!.ativo ? 'Desligar' : 'Ligar no Kanban'}
              </button>
              <button type="button" className={`${BOTAO} text-[#6B7280] hover:text-[#DC2626]`} disabled={salvando} data-testid="lalamove-remover" onClick={() => void salvar({ remover: true }, 'Chaves da Lalamove removidas.')}>Remover chaves</button>
            </>
          )}
        </div>
      )}
      {!editando && erro && <p className="text-[12.5px] text-[#B91C1C]" data-testid="lalamove-erro">{erro}</p>}
      {teste && (
        <div className="rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-[13px] text-[#1F2937]" data-testid="lalamove-teste">
          <p className="flex items-center gap-2 font-semibold text-[#15803D]"><CheckCircle2 className="h-4 w-4" aria-hidden /> Conexão ok ({teste.ambiente === 'producao' ? 'produção' : 'sandbox'}) · webhook {teste.webhookOk ? 'registrado' : 'não registrado'}</p>
          <p className="mt-1">Sua loja: <b>{teste.cidadeLoja || '—'}</b> → {teste.cidadeEscolhida ? <>cidade <b>{teste.cidadeEscolhida}</b> na Lalamove</> : <span className="text-[#92400E]">{teste.aviso}</span>}</p>
          <p className="mt-1 text-[12px] text-[#6B7280]">Cidades desta conta: {teste.cidades.join(', ') || '—'}</p>
        </div>
      )}
      {cfg && estado?.webhookUrl && (
        <p className="text-[11.5px] text-[#9CA3AF]">URL do webhook (registrada automaticamente no Testar conexão): <span className="break-all font-mono">{estado.webhookUrl}</span></p>
      )}
    </section>
  )
}
