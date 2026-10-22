'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { ToggleSwitch } from '@/components/admin/campos-ajustes'
import type { ConfigCanalPublica } from '@/lib/canais/config'
import type { Canal } from '@/lib/canais/tipos'

/**
 * Integrações › Keeta / 99Food (Open Delivery) e iFood (Etapa 2, 19/10). Passo a passo do lojista, credenciais (vão
 * cifradas para o servidor; nunca voltam), status da conexão, toggle e vínculo dos itens do app com o cardápio.
 * Só aparece com o módulo liberado no Super Admin (a página filtra). Tudo pela API /api/admin/canais/[canal].
 */
interface Estado {
  nome: string
  config: ConfigCanalPublica | null
  webhookUrl: string | null
  merchantUrl: string | null
  vinculos: { codigoExterno: string; nomeExterno: string; itemId: string | null; vistoEm: string }[]
  itens: { id: string; nome: string }[]
}

const CAMPO = 'w-full rounded-[3px] border border-[#D1D5DB] bg-white px-2.5 py-1.5 text-[13px] text-[#1F2937] outline-none focus:border-[#0688D4]'
const BOTAO = 'rounded-[3px] border border-[#D1D5DB] bg-white px-3 py-[6px] text-[11px] font-semibold uppercase tracking-wide text-[#1F2937] hover:bg-[#F3F4F6] disabled:opacity-50'
const BOTAO_AZUL = 'rounded-[3px] bg-[#0688D4] px-3 py-[6px] text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-[#0570AE] disabled:opacity-50'

const PASSOS: Record<Canal, { titulo: string; passos: string[] }> = {
  keeta: {
    titulo: 'Como ligar a Keeta (Open Delivery)',
    passos: [
      'A Keeta exige NDA e homologação com a Menuzia (não é por loja). Peça à Menuzia o status: enquanto não houver credencial de produção, este card fica só preparado.',
      'Com a credencial de produção, cole aqui o Client ID, o Client Secret, o App ID (X-App-Id) e a URL base da API da Keeta.',
      'No portal da Keeta, autorize o aplicativo Menuzia para a sua loja e copie o merchantId da loja para o campo "Id da loja no app".',
      'Cole a URL do webhook e a URL do cardápio (abaixo) no cadastro do aplicativo. O cardápio sai do seu Gestor de Cardápio automaticamente.',
      'Clique em "Testar conexão"; se ficar verde, ligue o canal. Os pedidos passam a entrar no Painel de Pedidos com o logo da Keeta.',
    ],
  },
  '99food': {
    titulo: 'Como ligar o 99Food (Open Delivery)',
    passos: [
      'O 99Food aderiu ao Open Delivery em 11/2025. O credenciamento do software é com a Menuzia; o lojista só vincula a loja.',
      'Com a credencial, cole Client ID, Client Secret, App ID e a URL base da API do 99Food.',
      'No gestor do 99Food, vincule a loja ao aplicativo Menuzia e copie o id da loja para "Id da loja no app".',
      'Cole a URL do webhook e a URL do cardápio no cadastro do aplicativo.',
      'Teste a conexão e ligue o canal.',
    ],
  },
  ifood: {
    titulo: 'Como ligar o iFood',
    passos: [
      'A Menuzia precisa de um aplicativo no Portal do Desenvolvedor do iFood (developer.ifood.com.br), homologado para o módulo de pedidos. Enquanto não houver, este card fica só preparado.',
      'Cole o Client ID e o Client Secret do aplicativo e salve.',
      'Clique em "Gerar código de autorização": abra o link do iFood, entre com a conta da loja no Portal do Parceiro e digite o código mostrado aqui.',
      'O iFood devolve um código de autorização: cole no campo e clique em "Autorizar".',
      'Clique em "Buscar lojas" e escolha a loja do iFood que vai receber os pedidos. Teste a conexão e ligue o canal.',
      'Os pedidos entram no Painel com o logo do iFood; aceitar, pronto e despachar são refletidos no iFood. Pedidos do iFood não são editáveis aqui (edite no app).',
    ],
  },
}

export function CanalCard({ canal, avisar }: { canal: Canal; avisar: (m: string) => void }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [form, setForm] = useState({ baseUrl: '', clientId: '', clientSecret: '', merchantIdExterno: '', appIdExterno: '' })
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [userCode, setUserCode] = useState<{ userCode: string; verificationUrlComplete: string; authorizationCodeVerifier: string } | null>(null)
  const [authCode, setAuthCode] = useState('')
  const [lojas, setLojas] = useState<{ id: string; name: string }[] | null>(null)

  const carregar = useCallback(() => fetch(`/api/admin/canais/${canal}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j: Estado | null) => {
    setEstado(j)
    if (j?.config) setForm((f) => ({ ...f, baseUrl: j.config!.baseUrl, merchantIdExterno: j.config!.merchantIdExterno, appIdExterno: j.config!.appIdExterno }))
  }).catch(() => setEstado(null)), [canal])
  useEffect(() => { void carregar() }, [carregar])

  async function chamar(metodo: 'PUT' | 'POST', corpo: Record<string, unknown>, rotulo: string) {
    if (ocupado) return null
    setOcupado(rotulo); setErro(null); setOkMsg(null)
    const r = await fetch(`/api/admin/canais/${canal}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null)
    const j = (await r?.json().catch(() => ({}))) as Record<string, unknown>
    setOcupado(null)
    if (!r?.ok) { setErro(String(j.error ?? 'Não foi possível concluir.')); return null }
    return j
  }

  async function salvar() {
    const corpo: Record<string, unknown> = { baseUrl: form.baseUrl, merchantIdExterno: form.merchantIdExterno, appIdExterno: form.appIdExterno }
    if (form.clientId.trim() && form.clientSecret.trim()) { corpo.clientId = form.clientId; corpo.clientSecret = form.clientSecret }
    const j = await chamar('PUT', corpo, 'salvar')
    if (j) { setForm((f) => ({ ...f, clientId: '', clientSecret: '' })); setOkMsg('Salvo.'); avisar('Configuração salva.'); void carregar() }
  }
  async function ligar(v: boolean) {
    const j = await chamar('PUT', { ativo: v }, 'ativo')
    if (j) { avisar(v ? `${estado?.nome ?? canal} ligado.` : `${estado?.nome ?? canal} desligado.`); void carregar() }
  }
  async function acao(a: string, extra: Record<string, unknown> = {}) {
    const j = await chamar('POST', { acao: a, ...extra }, a)
    if (!j) return null
    if (a === 'testar' || a === 'autorizar') { setOkMsg(String(j.mensagem ?? 'Ok.')); void carregar() }
    if (a === 'usercode') setUserCode(j as unknown as typeof userCode)
    if (a === 'lojas') setLojas((j.lojas as { id: string; name: string }[]) ?? [])
    return j
  }

  if (!estado) return <div className="flex items-center gap-2 text-[13px] text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
  const cfg = estado.config
  const passos = PASSOS[canal]
  const od = canal !== 'ifood'
  const pronto = !!cfg?.temCredenciais && (od ? !!cfg.baseUrl : true)
  return (
    <div className="space-y-3 text-[13px] text-[#1F2937]" data-testid={`canal-card-${canal}`}>
      {cfg && !cfg.cofrePronto && <p className="rounded-[3px] border border-[#FCD34D] bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">O cofre de segredos do servidor não está configurado: as credenciais não podem ser salvas. Fale com a Menuzia.</p>}
      <details className="rounded-[3px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2" data-testid={`canal-passos-${canal}`}>
        <summary className="cursor-pointer font-semibold">{passos.titulo}</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px] text-[#374151]">{passos.passos.map((p, i) => <li key={i}>{p}</li>)}</ol>
      </details>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {od && <label className="block md:col-span-2"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">URL base da API do app</span><input className={CAMPO} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://…/opendelivery" /></label>}
        <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Client ID {cfg?.temCredenciais ? `(salvo · …${cfg.clientIdFinal})` : ''}</span><input className={CAMPO} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} placeholder={cfg?.temCredenciais ? 'Cole para trocar' : ''} autoComplete="off" /></label>
        <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Client Secret</span><input className={CAMPO} type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} placeholder={cfg?.temCredenciais ? 'Cole para trocar' : ''} autoComplete="new-password" /></label>
        <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">Id da loja no app (merchantId)</span><input className={CAMPO} value={form.merchantIdExterno} onChange={(e) => setForm({ ...form, merchantIdExterno: e.target.value })} /></label>
        {od && <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">App ID (X-App-Id do webhook)</span><input className={CAMPO} value={form.appIdExterno} onChange={(e) => setForm({ ...form, appIdExterno: e.target.value })} /></label>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BOTAO_AZUL} disabled={!!ocupado} onClick={() => void salvar()} data-testid={`canal-salvar-${canal}`}>{ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" className={BOTAO} disabled={!!ocupado || !pronto} onClick={() => void acao('testar')}>{ocupado === 'testar' ? 'Testando…' : 'Testar conexão'}</button>
        {canal === 'ifood' && <button type="button" className={BOTAO} disabled={!!ocupado || !cfg?.temCredenciais} onClick={() => void acao('usercode')}>Gerar código de autorização</button>}
        {canal === 'ifood' && <button type="button" className={BOTAO} disabled={!!ocupado || !cfg?.temCredenciais} onClick={() => void acao('lojas')}>Buscar lojas</button>}
        {cfg?.temCredenciais && <button type="button" className={`${BOTAO} text-[#B91C1C]`} disabled={!!ocupado} onClick={() => { if (confirm('Apagar as credenciais salvas deste canal?')) void chamar('PUT', { limparCredenciais: true, ativo: false }, 'limpar').then((j) => { if (j) void carregar() }) }}>Apagar credenciais</button>}
      </div>
      {userCode && (
        <div className="rounded-[3px] border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-[12.5px]">
          <p>Código para digitar no Portal do Parceiro do iFood: <b className="font-mono text-[14px]">{userCode.userCode}</b> · <a className="text-[#0688D4] underline" href={userCode.verificationUrlComplete} target="_blank" rel="noreferrer">abrir o iFood</a></p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input className={`${CAMPO} md:w-[360px]`} value={authCode} onChange={(e) => setAuthCode(e.target.value)} placeholder="Cole aqui o código de autorização que o iFood mostrou" />
            <button type="button" className={BOTAO_AZUL} disabled={!!ocupado || !authCode.trim()} onClick={() => void acao('autorizar', { authorizationCode: authCode, authorizationCodeVerifier: userCode.authorizationCodeVerifier })}>Autorizar</button>
          </div>
        </div>
      )}
      {lojas && (
        <div className="rounded-[3px] border border-[#E5E7EB] px-3 py-2 text-[12.5px]">
          <p className="font-semibold">Lojas do iFood nesta conta</p>
          {lojas.length === 0 ? <p className="text-[#6B7280]">Nenhuma loja autorizada ainda.</p> : (
            <ul className="mt-1 space-y-1">{lojas.map((l) => <li key={l.id} className="flex items-center justify-between gap-2"><span>{l.name} <span className="font-mono text-[11px] text-[#6B7280]">{l.id}</span></span><button type="button" className={BOTAO} onClick={() => setForm({ ...form, merchantIdExterno: l.id })}>Usar esta</button></li>)}</ul>
          )}
        </div>
      )}
      {od && cfg && (
        <div className="space-y-1 rounded-[3px] border border-[#E5E7EB] px-3 py-2 text-[12.5px]">
          <p><span className="font-semibold">URL do webhook (newEvent):</span> <code className="break-all font-mono text-[11.5px]">{estado.webhookUrl}</code></p>
          <p><span className="font-semibold">URL do cardápio (merchant):</span> <code className="break-all font-mono text-[11.5px]">{estado.merchantUrl}</code></p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-[#E5E7EB] px-3 py-2">
        <div className="text-[12.5px]">
          <p className="flex items-center gap-1.5 font-semibold">
            {cfg?.ativo ? <CheckCircle2 className="h-4 w-4 text-[#10B981]" /> : <AlertTriangle className="h-4 w-4 text-[#F59E0B]" />}
            {cfg?.ativo ? 'Canal ligado' : 'Canal desligado'}{cfg?.pollingUltimoErro ? ` · erro: ${cfg.pollingUltimoErro}` : ''}
          </p>
          <p className="text-[#6B7280]">
            {cfg?.pollingUltimoEm ? `Última verificação ${new Date(cfg.pollingUltimoEm).toLocaleString('pt-BR')}` : 'Ainda não verificou pedidos'}
            {cfg?.ultimoPedidoEm ? ` · último pedido ${new Date(cfg.ultimoPedidoEm).toLocaleString('pt-BR')}` : ''}
            {canal === 'ifood' ? (cfg?.autorizado ? ' · loja autorizada' : ' · loja ainda não autorizada') : ''}
          </p>
        </div>
        <ToggleSwitch checked={cfg?.ativo === true} disabled={!!ocupado || !pronto} onChange={(v) => void ligar(v)} rotulo="Receber pedidos" />
      </div>

      {estado.vinculos.length > 0 && (
        <details className="rounded-[3px] border border-[#E5E7EB] px-3 py-2 text-[12.5px]" data-testid={`canal-vinculos-${canal}`}>
          <summary className="cursor-pointer font-semibold">Itens do app ↔ cardápio Menuzia ({estado.vinculos.filter((v) => !v.itemId).length} sem vínculo)</summary>
          <p className="mt-1 text-[#6B7280]">Sem vínculo o pedido entra do mesmo jeito (nome e preço do app). O vínculo serve para o KDS e os relatórios enxergarem o item certo.</p>
          <ul className="mt-2 space-y-1">
            {estado.vinculos.map((v) => (
              <li key={v.codigoExterno} className="flex flex-wrap items-center gap-2">
                <span className="min-w-[160px]">{v.nomeExterno || v.codigoExterno} <span className="font-mono text-[11px] text-[#6B7280]">{v.codigoExterno.slice(0, 12)}</span></span>
                <select className={`${CAMPO} md:w-[280px]`} value={v.itemId ?? ''} onChange={(e) => void acao('vincular', { codigoExterno: v.codigoExterno, itemId: e.target.value || null }).then(() => carregar())}>
                  <option value="">— sem vínculo —</option>
                  {estado.itens.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </details>
      )}
      {erro && <p className="text-[12.5px] font-medium text-[#B91C1C]">{erro}</p>}
      {okMsg && <p className="text-[12.5px] font-medium text-[#15803D]">{okMsg}</p>}
    </div>
  )
}
