'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { CIDADES_LALAMOVE_BR, type Cobertura } from '@/lib/entregas/lalamove-cidades'
import type { ConfigPublica } from '@/lib/entregas/queries'
import { CampoConexao, ModoAvancado, ResultadoConexao } from '@/components/admin/integracoes/campos-conexao'
import { PassoAPasso } from '@/components/admin/integracoes/passo-a-passo'

/**
 * Integrações › Lalamove (0199; simplificada em 21/10/2026). À vista só a API key e o Secret; um botão "Conectar"
 * salva, testa (lista as cidades, escolhe a da loja e registra o webhook sozinho) e liga no Kanban. Ambiente, cidade,
 * webhook e "remover chaves" ficam no Modo avançado. Chave de teste (pk_test) só na loja Menuzia / Super Admin.
 */
const BOTAO = 'inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARIO = `${BOTAO} bg-[#0688D4] text-white hover:bg-[#0570AE]`

interface Estado { config: ConfigPublica | null; cobertura: Cobertura; webhookUrl: string | null; cofrePronto: boolean; podeTeste?: boolean }
interface Teste { ambiente: string; cidades: string[]; cidadeLoja: string; cidadeEscolhida: string | null; webhookOk: boolean; aviso: string | null }

export function LalamoveCard({ avisar }: { avisar: (m: string) => void }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [teste, setTeste] = useState<Teste | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = () => fetch('/api/admin/entregas/lalamove/config', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => setEstado(j)).catch(() => setEstado(null))
  useEffect(() => { void carregar() }, [])

  async function put(corpo: Record<string, unknown>): Promise<boolean> {
    const r = await fetch('/api/admin/entregas/lalamove/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErro(j.error ?? 'Não foi possível salvar.'); return false }
    setEstado(j); return true
  }

  /** Conectar = salvar as chaves digitadas + testar + ligar no Kanban. */
  async function conectar() {
    setOcupado(true); setErro(null); setOk(null); setTeste(null)
    try {
      if (apiKey || apiSecret) {
        if (!apiKey || !apiSecret) { setErro('Cole a API key e o Secret.'); return }
        if (!(await put({ apiKey, apiSecret }))) return
        setApiKey(''); setApiSecret('')
      }
      const r = await fetch('/api/admin/entregas/lalamove/testar', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErro(j.error ?? 'A Lalamove não respondeu. Confira as chaves.'); return }
      setTeste(j)
      if (!(await put({ ativo: true }))) return
      const msg = `Conectado${j.ambiente === 'producao' ? '' : ' (TESTE — corridas simuladas)'}: o botão Lalamove aparece nos pedidos prontos para entrega.`
      setOk(msg); avisar('Lalamove conectada.')
    } finally { setOcupado(false); void carregar() }
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

      {cob && cob.atende === false && (
        <p className="flex items-start gap-2 rounded-[8px] border border-[#FCD34D] bg-[#FEF3C7] px-3 py-2.5 text-[13px] text-[#92400E]" data-testid="lalamove-fora-area">
          <AlertTriangle className="mt-[2px] h-4 w-4 flex-shrink-0" aria-hidden />
          <span><b>A Lalamove não atende sua cidade</b> ({cob.cidade}). Cidades atendidas hoje: {CIDADES_LALAMOVE_BR.join(', ')}.</span>
        </p>
      )}
      {cob && cob.atende === true && (
        <p className="flex items-center gap-2 text-[13px] text-[#15803D]" data-testid="lalamove-na-area">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> {cob.vizinha ? <>{cob.cidade} fica na região de <b>{cob.vizinha}</b>, atendida pela Lalamove.</> : <><b>{cob.cidade}</b> é atendida pela Lalamove.</>}
        </p>
      )}
      {estado && !estado.cofrePronto && <p className="text-[13px] text-[#B91C1C]">O servidor está sem a chave do cofre; fale com o suporte da Menuzia antes de colar as chaves.</p>}

      <PassoAPasso provedor="lalamove" />

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <CampoConexao rotulo="API key" dica="começa com pk_prod_" valor={apiKey} onChange={setApiKey} salvo={conectada} final={cfg?.apiKeyFinal} testid="lalamove-apikey" />
        <CampoConexao rotulo="Secret" dica="começa com sk_prod_" valor={apiSecret} onChange={setApiSecret} salvo={conectada} segredo testid="lalamove-secret" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARIO} onClick={() => void conectar()} disabled={ocupado || (!conectada && (!apiKey || !apiSecret)) || (estado ? !estado.cofrePronto : true)} data-testid="lalamove-conectar">
          {ocupado ? <><Loader2 className="h-4 w-4 animate-spin" /> Conectando…</> : conectada ? 'Conectar de novo' : 'Conectar'}
        </button>
        {cfg?.ativo && (
          <button type="button" className={`${BOTAO} border border-[#D1D5DB] bg-white text-[#B91C1C] hover:border-[#B91C1C]`} disabled={ocupado} data-testid="lalamove-desligar"
            onClick={() => void put({ ativo: false }).then((v) => { if (v) { setOk(null); avisar('Lalamove desligada. O botão sai do Kanban.') } })}>Desligar</button>
        )}
      </div>
      <ResultadoConexao ok={ok} erro={erro} />
      {teste && !teste.cidadeEscolhida && teste.aviso && <p className="text-[12.5px] text-[#92400E]">{teste.aviso}</p>}

      {conectada && (
        <ModoAvancado testid="lalamove-avancado">
          <p>Ambiente: <b>{cfg!.ambiente === 'producao' ? 'Produção' : 'Teste (sandbox)'}</b> <span className="text-[#6B7280]">— segue a chave colada{estado?.podeTeste ? ' (pk_test = teste, só nesta loja)' : ''}.</span></p>
          {cfg!.cidadeNome && <p>Cidade na Lalamove: <b>{cfg!.cidadeNome}</b> · veículo <span className="font-mono">{cfg!.servico}</span></p>}
          <p>Aviso automático (webhook): {cfg!.webhookRegistradoEm ? <span className="text-[#15803D]">registrado sozinho no Conectar</span> : <span className="text-[#92400E]">não registrado — o status é acompanhado consultando a Lalamove a cada minuto</span>}</p>
          {estado?.webhookUrl && <p className="break-all font-mono text-[11.5px] text-[#6B7280]">{estado.webhookUrl}</p>}
          <button type="button" className={`${BOTAO} px-0 text-[#6B7280] hover:text-[#DC2626]`} disabled={ocupado} data-testid="lalamove-remover"
            onClick={() => void put({ remover: true }).then((v) => { if (v) { setOk(null); avisar('Chaves da Lalamove removidas.') } })}>Remover chaves</button>
        </ModoAvancado>
      )}
    </section>
  )
}
