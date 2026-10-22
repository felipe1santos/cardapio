'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { ConfigPublica } from '@/lib/entregas/queries'
import { CampoConexao, CAMPO_CONEXAO, ModoAvancado, ResultadoConexao } from '@/components/admin/integracoes/campos-conexao'
import { PassoAPasso } from '@/components/admin/integracoes/passo-a-passo'

/**
 * Integrações › Uber Direct, Foody, Machine e Entregador iFood (simplificado em 21/10/2026). À vista só os campos
 * obrigatórios para produção; um botão "Conectar" salva, testa e liga no Kanban, com o resultado em português.
 * Ambiente de teste (só Menuzia / Super Admin), signing key, URL do webhook e "apagar credenciais" ficam no Modo
 * avançado. Sem webhook, o status é acompanhado consultando o parceiro a cada minuto enquanto houver corrida.
 */
interface Estado { nome: string; config: ConfigPublica | null; cofrePronto: boolean; webhookUrl: string | null; canalIfoodPronto: boolean | null; disponivel?: boolean; podeTeste?: boolean }

const BOTAO = 'inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARIO = `${BOTAO} bg-[#0688D4] text-white hover:bg-[#0570AE]`

type ProvedorCard = 'ifood' | 'foody' | 'machine' | 'uber'

export function EntregadorCard({ provedor, avisar }: { provedor: ProvedorCard; avisar: (m: string) => void }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [form, setForm] = useState({ baseUrl: '', clientId: '', clientSecret: '', customerId: '', webhookSecret: '' })
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const base = `/api/admin/entregas/${provedor}/config`

  const carregar = useCallback(() => fetch(base, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j: Estado | null) => setEstado(j)).catch(() => setEstado(null)), [base])
  useEffect(() => { void carregar() }, [carregar])

  async function chamar(metodo: 'PUT' | 'POST', corpo: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const r = await fetch(base, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null)
    const j = (await r?.json().catch(() => ({}))) as Record<string, unknown>
    if (!r?.ok) { setErro(String(j?.error ?? 'Não foi possível concluir.')); return null }
    return j
  }

  /** Conectar = salvar o que foi digitado + testar + ligar no Kanban. */
  async function conectar() {
    setOcupado(true); setErro(null); setOk(null)
    try {
      const corpo: Record<string, unknown> = {}
      if (provedor === 'uber' && form.customerId) corpo.customerId = form.customerId
      if ((provedor === 'foody' || provedor === 'machine') && form.baseUrl) corpo.baseUrl = form.baseUrl
      if (form.clientId || form.clientSecret) {
        if (!form.clientId || !form.clientSecret) { setErro('Cole o Client ID e o Client Secret.'); return }
        corpo.clientId = form.clientId; corpo.clientSecret = form.clientSecret
      }
      if (form.webhookSecret) corpo.webhookSecret = form.webhookSecret
      if (Object.keys(corpo).length && !(await chamar('PUT', corpo))) return
      setForm({ baseUrl: '', clientId: '', clientSecret: '', customerId: '', webhookSecret: '' })
      const t = await chamar('POST', { acao: 'testar' })
      if (!t) return
      if (!(await chamar('PUT', { ativo: true }))) return
      setOk(`${String(t.mensagem ?? 'Conectado.').replace(/\.$/, '')}. Ligado: o botão ${estado?.nome ?? ''} aparece nos pedidos prontos para entrega.`)
      avisar(`${estado?.nome ?? 'Entregador'} conectado.`)
    } finally { setOcupado(false); void carregar() }
  }

  if (!estado) return <div className="flex items-center gap-2 text-[13px] text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
  const cfg = estado.config
  if (estado.disponivel === false) return (
    <div className="space-y-2 text-[13px] text-[#374151]" data-testid={`entregador-em-breve-${provedor}`}>
      <p className="rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2"><b>Em breve.</b> A Menuzia está concluindo a integração com a {estado.nome}. Quando liberar, ela aparece aqui pronta para conectar, sem custo.</p>
    </div>
  )
  const temChaves = !!cfg?.temChaves
  const temBase = !!cfg?.baseUrl
  const temConta = !!cfg?.contaId
  const prontoParaConectar = provedor === 'ifood' ? estado.canalIfoodPronto === true
    : provedor === 'uber' ? (temChaves || (!!form.clientId && !!form.clientSecret)) && (temConta || !!form.customerId)
    : (temChaves || (!!form.clientId && !!form.clientSecret)) && (temBase || !!form.baseUrl)
  return (
    <div className="space-y-3 text-[13px] text-[#1F2937]" data-testid={`entregador-card-${provedor}`}>
      {provedor !== 'ifood' && !estado.cofrePronto && <p className="rounded-[8px] border border-[#FCD34D] bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">O cofre de segredos do servidor não está configurado: as credenciais não podem ser salvas. Fale com a Menuzia.</p>}
      <PassoAPasso provedor={provedor} />

      {provedor === 'ifood' ? (
        <p className={`rounded-[8px] border px-3 py-2 text-[12.5px] ${estado.canalIfoodPronto ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]' : 'border-[#FCD34D] bg-[#FEF3C7] text-[#92400E]'}`}>
          {estado.canalIfoodPronto ? 'Loja conectada ao iFood: o entregador usa a mesma conexão.' : 'Conecte primeiro a loja ao iFood em Integrações › iFood.'}
        </p>
      ) : provedor === 'uber' ? (
        // Uber validada de ponta a ponta (22/10): os 3 campos com o MESMO nome da tela da Uber (Desenvolvedor › Chaves
        // de API), um embaixo do outro, na ordem em que aparecem lá. Nada de "Customer ID"/"Client ID" em inglês.
        <div className="space-y-2">
          <CampoConexao rotulo="ID do usuário" valor={form.customerId} onChange={(v) => setForm({ ...form, customerId: v })} salvo={temConta} final={cfg?.contaId.slice(-4)} testid="uber-customer-id" />
          <CampoConexao rotulo="ID de cliente do desenvolvedor" valor={form.clientId} onChange={(v) => setForm({ ...form, clientId: v })} salvo={temChaves} final={cfg?.apiKeyFinal} testid="uber-client-id" />
          <CampoConexao rotulo="Client Secret" valor={form.clientSecret} onChange={(v) => setForm({ ...form, clientSecret: v })} salvo={temChaves} segredo testid="uber-client-secret" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {(provedor === 'foody' || provedor === 'machine') && <div className="md:col-span-2"><CampoConexao rotulo="URL base" valor={form.baseUrl} onChange={(v) => setForm({ ...form, baseUrl: v })} salvo={temBase} final={cfg?.baseUrl ? ` ${cfg.baseUrl.replace(/^https:\/\//, '').slice(0, 30)}` : ''} testid={`${provedor}-base-url`} /></div>}
          <CampoConexao rotulo="Client ID" valor={form.clientId} onChange={(v) => setForm({ ...form, clientId: v })} salvo={temChaves} final={cfg?.apiKeyFinal} testid={`${provedor}-client-id`} />
          <CampoConexao rotulo="Client Secret" valor={form.clientSecret} onChange={(v) => setForm({ ...form, clientSecret: v })} salvo={temChaves} segredo testid={`${provedor}-client-secret`} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARIO} disabled={ocupado || !prontoParaConectar || (provedor !== 'ifood' && !estado.cofrePronto)} onClick={() => void conectar()} data-testid={`${provedor}-conectar`}>
          {ocupado ? <><Loader2 className="h-4 w-4 animate-spin" /> Conectando…</> : cfg?.ativo ? 'Conectar de novo' : 'Conectar'}
        </button>
        {cfg?.ativo && <button type="button" className={`${BOTAO} border border-[#D1D5DB] bg-white text-[#B91C1C] hover:border-[#B91C1C]`} disabled={ocupado}
          onClick={() => void chamar('PUT', { ativo: false }).then((j) => { if (j) { setOk(null); avisar(`${estado.nome} desligado.`); void carregar() } })} data-testid={`${provedor}-desligar`}>Desligar</button>}
        {cfg?.ativo && <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#047857]"><span className="h-[7px] w-[7px] rounded-full bg-[#10B981]" aria-hidden />Ligado no Kanban</span>}
      </div>
      <ResultadoConexao ok={ok} erro={erro} />

      {/* Uber (22/10): o lojista não precisa de nada técnico — ambiente, webhook e "apagar credenciais" só para a
          Menuzia / Super Admin. Sem webhook, o status chega pela consulta automática a cada minuto. */}
      {provedor !== 'ifood' && cfg && (provedor !== 'uber' || estado.podeTeste) && (
        <ModoAvancado testid={`${provedor}-avancado`}>
          {provedor === 'uber' && (
            <>
              <p>Ambiente: <b>{cfg.ambiente === 'producao' ? 'Produção (entregador de verdade)' : 'Teste (corridas simuladas)'}</b></p>
              {estado.podeTeste && (
                <label className="block">Trocar ambiente
                  <select className={`${CAMPO_CONEXAO} mt-1 font-sans`} value={cfg.ambiente} onChange={(e) => void chamar('PUT', { ambiente: e.target.value }).then((j) => { if (j) void carregar() })} data-testid="uber-ambiente">
                    <option value="sandbox">Teste (corridas simuladas)</option><option value="producao">Produção</option>
                  </select>
                </label>
              )}
              <CampoConexao rotulo="Signing Key do webhook (opcional)" dica="Desenvolvedor › Webhooks › Editar" valor={form.webhookSecret} onChange={(v) => setForm({ ...form, webhookSecret: v })} salvo={!!cfg.temWebhookSegredo} segredo />
            </>
          )}
          <p className="text-[#6B7280]">Webhook (opcional): sem ele, o Menuzia consulta o status no parceiro a cada minuto enquanto houver corrida. Com ele, o status chega na hora.</p>
          {estado.webhookUrl && <p className="break-all font-mono text-[11.5px]">{estado.webhookUrl}</p>}
          <button type="button" className="text-[12.5px] font-semibold text-[#B91C1C] hover:underline" disabled={ocupado}
            onClick={() => { if (confirm(`Apagar as credenciais salvas (${estado.nome})?`)) void chamar('PUT', { limparCredenciais: true, ativo: false }).then((j) => { if (j) { setOk(null); void carregar() } }) }}>Apagar credenciais</button>
        </ModoAvancado>
      )}
    </div>
  )
}
