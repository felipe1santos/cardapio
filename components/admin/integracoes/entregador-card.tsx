'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { ToggleSwitch } from '@/components/admin/campos-ajustes'
import type { ConfigPublica } from '@/lib/entregas/queries'

/**
 * Integrações › Entregador iFood (Sob Demanda) e Foody Delivery (Etapa 3, 19/10). Mesmo padrão da Lalamove: passo a
 * passo, credenciais (Foody; o iFood reaproveita a conexão do canal iFood), testar, ligar. A corrida é chamada no Kanban.
 */
interface Estado { nome: string; config: ConfigPublica | null; cofrePronto: boolean; webhookUrl: string | null; canalIfoodPronto: boolean | null; disponivel?: boolean }

const CAMPO = 'w-full rounded-[3px] border border-[#D1D5DB] bg-white px-2.5 py-1.5 text-[13px] text-[#1F2937] outline-none focus:border-[#0688D4]'
const BOTAO = 'rounded-[3px] border border-[#D1D5DB] bg-white px-3 py-[6px] text-[11px] font-semibold uppercase tracking-wide text-[#1F2937] hover:bg-[#F3F4F6] disabled:opacity-50'
const BOTAO_AZUL = 'rounded-[3px] bg-[#0688D4] px-3 py-[6px] text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-[#0570AE] disabled:opacity-50'

type ProvedorCard = 'ifood' | 'foody' | 'machine' | 'uber'

const PASSOS: Record<ProvedorCard, { titulo: string; passos: string[] }> = {
  uber: {
    titulo: 'Como ligar a Uber Direct (entregador da Uber) — conta da própria loja, autoatendimento',
    passos: [
      'Crie a conta da loja em direct.uber.com (entre com uma conta Uber, preencha os dados da empresa e aceite os termos). A conta nasce em modo TESTE: as corridas são simuladas e não custam nada.',
      'No painel da Uber Direct: Management ➡ Developer. Copie o Customer ID, o Client ID e o Client Secret e cole aqui. Clique em Salvar e depois em "Testar conexão".',
      'Ainda em Developer ➡ Webhooks ➡ Create Webhook: cole a URL do webhook mostrada abaixo e marque os eventos de status da entrega e de entregador. Depois, no menu "…" do webhook ➡ Edit, copie a Signing Key e cole aqui.',
      'Ligue "Chamar pelo Kanban". Em "Pronto p/ Despacho" aparece o botão Uber: cotação (preço e prazo) ➡ Confirmar ➡ corrida. Coletou = pedido em rota; entregou = pedido entregue e o custo da corrida vai para o Financeiro.',
      'A Uber Direct NÃO cobra o cliente na entrega: use só para pedido já pago (Pix ou cartão online). Para ir para produção, cadastre o pagamento na Uber e peça a liberação; aqui, troque "Ambiente" para Produção.',
    ],
  },
  ifood: {
    titulo: 'Como ligar o entregador do iFood (Sob Demanda)',
    passos: [
      'Conecte a loja ao iFood em Integrações › iFood (credenciais do aplicativo Menuzia, autorização da loja e id da loja). O entregador usa a mesma conexão.',
      'No Portal do Parceiro do iFood, a loja precisa ter o serviço "Sob Demanda / Entrega Fácil" habilitado (o iFood cobra a corrida por distância + 4% do pedido de fora).',
      'Ligue aqui. No Painel de Pedidos, em "Pronto p/ Despacho", aparece o botão iFood ao lado do Despachar: cotação → confirmar → corrida.',
      'O status do entregador (a caminho, coletou, entregou) chega pelo iFood e move o pedido sozinho; o custo da corrida entra no Financeiro.',
    ],
  },
  foody: {
    titulo: 'Como ligar a Foody Delivery (você mesmo gera as credenciais no painel da Foody)',
    passos: [
      'No painel da Foody: Menu ➡ Minha conta ➡ APIs e Hooks ➡ "Criar credencial". Dê um nome (ex.: Menuzia) e em "Tipo" escolha "Open Delivery".',
      'Na lista de credenciais, no menu "Ações" (três pontos), copie clientId, clientSecret e baseUrl. Cole os três aqui, clique em Salvar e depois em "Testar conexão".',
      'De volta à Foody: Menu ➡ Minha conta ➡ APIs e Hooks ➡ "Criar gatilho", escolha a credencial criada e cole a URL do webhook mostrada abaixo. A Foody testa na hora (o Menuzia responde ok).',
      'Ligue "Chamar pelo Kanban". No Painel de Pedidos, em "Pronto p/ Despacho", aparece o botão Foody: cotação (preço e prazo) → Confirmar → corrida. Coletou = pedido em rota; entregou = pedido entregue e custo no Financeiro.',
      'Guia completo com os links da Foody: docs/integracoes/foody.md (central de ajuda: help.foodydelivery.com › Open Delivery API e Webhooks).',
    ],
  },
  machine: {
    titulo: 'Como ligar a Machine (motoboys da sua cidade) — as credenciais vêm da central Machine, não é autoatendimento',
    passos: [
      'Fale com a central Machine da sua cidade (a empresa de motoboys que usa o app Machine) e peça a integração "Open Delivery — Logística" para o Menuzia: eles pedem à Machine/Gaudium a credencial e devolvem URL base, Client ID e Client Secret.',
      'Cole os três aqui, clique em Salvar e depois em "Testar conexão".',
      'Passe para a central a URL do webhook mostrada abaixo (eventos de status da entrega: aceita, a caminho, coletou, entregou, cancelada).',
      'Ligue "Chamar pelo Kanban". No Painel de Pedidos, em "Pronto p/ Despacho", aparece o botão Machine: cotação (preço e prazo) → Confirmar → corrida. Coletou = pedido em rota; entregou = pedido entregue e custo no Financeiro.',
      'Enquanto nenhuma loja tiver a credencial, a Machine aparece como "Em breve". Guia: docs/integracoes/machine.md.',
    ],
  },
}

export function EntregadorCard({ provedor, avisar }: { provedor: ProvedorCard; avisar: (m: string) => void }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [form, setForm] = useState({ baseUrl: '', clientId: '', clientSecret: '', customerId: '', webhookSecret: '' })
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const base = `/api/admin/entregas/${provedor}/config`

  const carregar = useCallback(() => fetch(base, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j: Estado | null) => {
    setEstado(j)
    if (j?.config) setForm((f) => ({ ...f, baseUrl: j.config!.baseUrl, customerId: j.config!.contaId ?? '' }))
  }).catch(() => setEstado(null)), [base])
  useEffect(() => { void carregar() }, [carregar])

  async function chamar(metodo: 'PUT' | 'POST', corpo: Record<string, unknown>, rotulo: string) {
    if (ocupado) return null
    setOcupado(rotulo); setErro(null); setOkMsg(null)
    const r = await fetch(base, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null)
    const j = (await r?.json().catch(() => ({}))) as Record<string, unknown>
    setOcupado(null)
    if (!r?.ok) { setErro(String(j.error ?? 'Não foi possível concluir.')); return null }
    return j
  }

  if (!estado) return <div className="flex items-center gap-2 text-[13px] text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
  const cfg = estado.config
  const passos = PASSOS[provedor]
  const pronto = provedor === 'ifood' ? estado.canalIfoodPronto === true : provedor === 'uber' ? !!(cfg?.temChaves && cfg.contaId) : !!(cfg?.temChaves && cfg.baseUrl)
  // Uber Direct (21/10): pronta no código, liberada no servidor depois do 1º teste no sandbox.
  if (estado.disponivel === false) return (
    <div className="space-y-2 text-[13px] text-[#374151]" data-testid={`entregador-em-breve-${provedor}`}>
      <p className="rounded-[3px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2"><b>Em breve.</b> A integração com a {estado.nome} está pronta e a Menuzia está concluindo o teste no ambiente de testes do parceiro. Quando liberar, ela aparece aqui pronta para conectar, sem custo.</p>
      <p className="text-[12.5px] text-[#6B7280]">Atende as principais cidades do Brasil (São Paulo, Rio de Janeiro, Goiânia, Curitiba e dezenas de outras). Quer ser avisado? Fale com o suporte da Menuzia pelo WhatsApp.</p>
    </div>
  )
  return (
    <div className="space-y-3 text-[13px] text-[#1F2937]" data-testid={`entregador-card-${provedor}`}>
      {provedor !== 'ifood' && !estado.cofrePronto && <p className="rounded-[3px] border border-[#FCD34D] bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">O cofre de segredos do servidor não está configurado: as credenciais não podem ser salvas. Fale com a Menuzia.</p>}
      <details className="rounded-[3px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
        <summary className="cursor-pointer font-semibold">{passos.titulo}</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px] text-[#374151]">{passos.passos.map((p, i) => <li key={i}>{p}</li>)}</ol>
      </details>
      {provedor === 'uber' && <p className="rounded-[3px] border border-[#E5E7EB] px-3 py-2 text-[12.5px] text-[#374151]"><b>Onde atende:</b> principais cidades do Brasil (São Paulo, Rio de Janeiro, Goiânia, Curitiba e dezenas de outras). Se a sua cidade não for atendida, a cotação avisa &ldquo;não atende sua cidade&rdquo;.</p>}
      {provedor !== 'ifood' && (
        <>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {provedor === 'uber' ? (
              <>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Customer ID</span><input className={CAMPO} value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} placeholder="Ex.: 1a2b3c4d-…" autoComplete="off" data-testid="uber-customer-id" /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Ambiente</span>
                  <select className={CAMPO} value={cfg?.ambiente ?? 'sandbox'} onChange={(e) => void chamar('PUT', { ambiente: e.target.value }, 'ambiente').then((j) => { if (j) void carregar() })} data-testid="uber-ambiente"><option value="sandbox">Teste (corridas simuladas)</option><option value="producao">Produção (entregador de verdade)</option></select></label>
              </>
            ) : (
            <label className="block md:col-span-2"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">URL base da API Open Delivery ({estado.nome})</span><input className={CAMPO} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://…" /></label>
            )}
            <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Client ID {cfg?.temChaves ? `(salvo · …${cfg.apiKeyFinal})` : ''}</span><input className={CAMPO} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} placeholder={cfg?.temChaves ? 'Cole para trocar' : ''} autoComplete="off" /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Client Secret</span><input className={CAMPO} type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} placeholder={cfg?.temChaves ? 'Cole para trocar' : ''} autoComplete="new-password" /></label>
            {provedor === 'uber' && <label className="block md:col-span-2"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Signing Key do webhook {cfg?.temWebhookSegredo ? '(salva)' : ''}</span><input className={CAMPO} type="password" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} placeholder={cfg?.temWebhookSegredo ? 'Cole para trocar' : 'direct.uber.com › Developer › Webhooks › Edit'} autoComplete="new-password" /></label>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BOTAO_AZUL} disabled={!!ocupado} onClick={() => void chamar('PUT', { ...(provedor === 'uber' ? { customerId: form.customerId, ...(form.webhookSecret.trim() ? { webhookSecret: form.webhookSecret } : {}) } : { baseUrl: form.baseUrl }), ...(form.clientId.trim() && form.clientSecret.trim() ? { clientId: form.clientId, clientSecret: form.clientSecret } : {}) }, 'salvar').then((j) => { if (j) { setForm((f) => ({ ...f, clientId: '', clientSecret: '', webhookSecret: '' })); setOkMsg('Salvo.'); avisar('Configuração salva.'); void carregar() } })}>{ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className={BOTAO} disabled={!!ocupado || !pronto} onClick={() => void chamar('POST', { acao: 'testar' }, 'testar').then((j) => { if (j) setOkMsg(String(j.mensagem ?? 'Ok.')) })}>{ocupado === 'testar' ? 'Testando…' : 'Testar conexão'}</button>
            {cfg?.temChaves && <button type="button" className={`${BOTAO} text-[#B91C1C]`} disabled={!!ocupado} onClick={() => { if (confirm(`Apagar as credenciais salvas (${estado.nome})?`)) void chamar('PUT', { limparCredenciais: true, ativo: false }, 'limpar').then((j) => { if (j) void carregar() }) }}>Apagar credenciais</button>}
          </div>
          {estado.webhookUrl && <p className="rounded-[3px] border border-[#E5E7EB] px-3 py-2 text-[12.5px]"><span className="font-semibold">URL do webhook{provedor === 'uber' ? '' : ' (deliveryUpdate)'}:</span> <code className="break-all font-mono text-[11.5px]">{estado.webhookUrl}</code></p>}
        </>
      )}
      {provedor === 'ifood' && (
        <p className={`rounded-[3px] border px-3 py-2 text-[12.5px] ${pronto ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]' : 'border-[#FCD34D] bg-[#FEF3C7] text-[#92400E]'}`}>
          {pronto ? 'Loja conectada ao iFood: o entregador usa a mesma conexão.' : 'A loja ainda não está conectada ao iFood. Conecte em Integrações › iFood (credenciais, autorização e id da loja).'}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-[#E5E7EB] px-3 py-2">
        <p className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          {cfg?.ativo ? <CheckCircle2 className="h-4 w-4 text-[#10B981]" /> : <AlertTriangle className="h-4 w-4 text-[#F59E0B]" />}
          {cfg?.ativo ? 'Ligado: o botão aparece no Painel de Pedidos' : 'Desligado'}
        </p>
        <ToggleSwitch checked={cfg?.ativo === true} disabled={!!ocupado || !pronto} onChange={(v) => void chamar('PUT', { ativo: v }, 'ativo').then((j) => { if (j) { avisar(v ? `${estado.nome} ligado.` : `${estado.nome} desligado.`); void carregar() } })} rotulo="Chamar pelo Kanban" />
      </div>
      {erro && <p className="text-[12.5px] font-medium text-[#B91C1C]">{erro}</p>}
      {okMsg && <p className="text-[12.5px] font-medium text-[#15803D]">{okMsg}</p>}
    </div>
  )
}
