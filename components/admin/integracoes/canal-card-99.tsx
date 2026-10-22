'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2 } from 'lucide-react'
import type { ConfigCanalPublica } from '@/lib/canais/config'
import { ResultadoConexao } from '@/components/admin/integracoes/campos-conexao'

/**
 * Integrações › 99Food (22/10/2026, protocolo próprio da 99Food). O app é ÚNICO da Menuzia: a loja não digita nada —
 * só vincula o estabelecimento dela na página da 99Food e volta para confirmar. Pedidos chegam pelo webhook da Menuzia.
 */
const BOTAO = 'inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARIO = `${BOTAO} bg-[#0688D4] text-white hover:bg-[#0570AE]`
const SECUNDARIO = `${BOTAO} border border-[#D1D5DB] bg-white text-[#1F2937] hover:bg-[#F3F4F6]`

export function CanalCard99({ avisar }: { avisar: (m: string) => void }) {
  const [config, setConfig] = useState<ConfigCanalPublica | null | undefined>(undefined)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [abriuLink, setAbriuLink] = useState(false)

  const carregar = useCallback(() => fetch('/api/admin/canais/99food', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null)).then((j: { config: ConfigCanalPublica | null } | null) => setConfig(j?.config ?? null)).catch(() => setConfig(null)), [])
  useEffect(() => { void carregar() }, [carregar])

  async function chamar(metodo: 'PUT' | 'POST', corpo: Record<string, unknown>, rotulo: string) {
    setOcupado(rotulo); setErro(null); setOk(null)
    const r = await fetch('/api/admin/canais/99food', { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }).catch(() => null)
    const j = (await r?.json().catch(() => ({}))) as Record<string, unknown>
    setOcupado(null)
    if (!r?.ok) { setErro(String(j?.error ?? 'Não foi possível concluir.')); return null }
    return j
  }

  async function vincular() {
    // Abre a aba já (o navegador bloqueia janela aberta depois de esperar a resposta) e põe o link quando chegar.
    const aba = window.open('', '_blank')
    const j = await chamar('POST', { acao: 'vincular99' }, 'vincular')
    if (j?.url && aba) { aba.location.href = String(j.url); setAbriuLink(true) } else aba?.close()
  }

  async function conectar() {
    const j = await chamar('POST', { acao: 'verificar99' }, 'conectar')
    if (j) { setOk(String(j.mensagem ?? 'Conectado.')); avisar('99Food conectado.'); void carregar() }
  }

  async function desligar() {
    const j = await chamar('PUT', { ativo: false }, 'desligar')
    if (j) { avisar('99Food desligado.'); void carregar() }
  }

  if (config === undefined) return <p className="flex items-center gap-2 text-[13px] text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
  const conectada = !!config?.ativo && !!config?.autorizado
  return (
    <div className="space-y-3 text-[13px] text-[#1F2937]" data-testid="canal-card-99food">
      {conectada ? (
        <p className="flex items-center gap-2 rounded-[8px] border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2 text-[#166534]" data-testid="99food-conectada">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> Loja conectada à 99Food: os pedidos de lá entram no Painel de Pedidos.
        </p>
      ) : (
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-[#374151]">
          <li>Toque em <b>Vincular minha loja</b>. Abre a página da 99Food: entre com a conta do seu estabelecimento e autorize a Menuzia.</li>
          <li>Volte aqui e toque em <b>Já vinculei, conectar</b>.</li>
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!conectada && (
          <>
            <button type="button" className={PRIMARIO} disabled={!!ocupado} onClick={() => void vincular()} data-testid="99food-vincular">
              {ocupado === 'vincular' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Vincular minha loja
            </button>
            <button type="button" className={abriuLink ? PRIMARIO : SECUNDARIO} disabled={!!ocupado} onClick={() => void conectar()} data-testid="99food-conectar">
              {ocupado === 'conectar' && <Loader2 className="h-4 w-4 animate-spin" />} Já vinculei, conectar
            </button>
          </>
        )}
        {conectada && (
          <button type="button" className={`${BOTAO} border border-[#D1D5DB] bg-white text-[#B91C1C] hover:border-[#B91C1C]`} disabled={!!ocupado} onClick={() => void desligar()} data-testid="99food-desligar">Desligar</button>
        )}
      </div>
      <ResultadoConexao ok={ok} erro={erro} />
      <p className="text-[12px] text-[#6B7280]">Na 99Food cada loja só pode ter uma integradora. Se você usa outra (ex.: Saipos), ela deixa de receber os pedidos quando vincular a Menuzia.</p>
    </div>
  )
}
