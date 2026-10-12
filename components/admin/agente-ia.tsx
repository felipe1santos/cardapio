'use client'

/**
 * Agente de IA (Claude) — Ajustes › Agente de IA, módulo pago (0176/0183). Modo HÍBRIDO: o robô responde primeiro; a IA
 * entra quando ele não entende, quando o cliente quer pedir pela conversa ou manda foto. Interruptor, gasto de hoje
 * contra o teto da loja e o balão "i". Sem o módulo, a seção mostra o "Quero liberar" (quem chama decide).
 */
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { ToggleSwitch } from '@/components/admin/campos-ajustes'
import { BalaoInfo } from '@/components/admin/balao-info'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'

interface Estado { ativo: boolean; roboAtivo: boolean; disponivel: boolean; gastoHojeMicroUsd: number; tetoUsd: number; cotacao: number }

const usd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 1 ? 4 : 2 })}`
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function InfoQuandoEntra() {
  return (
    <>
      <p className="font-semibold text-[#1F2937]">Quando a IA entra</p>
      <p className="mt-[2px]">O robô de atendimento responde primeiro (saudação, cardápio, taxa, horário, status, Pix, atendente). A IA só é chamada quando:</p>
      <ul className="mt-[6px] list-disc space-y-[3px] pl-[18px]">
        <li>o robô não entendeu a mensagem;</li>
        <li>o cliente quer pedir pela conversa (“quero um x-tudo”, “anota meu pedido”, “o link não abre”);</li>
        <li>o cliente manda uma foto.</li>
      </ul>
      <p className="mt-[10px] font-semibold text-[#1F2937]">O que ela faz</p>
      <p className="mt-[2px]">Tira dúvidas do cardápio, calcula a taxa, monta o pedido, mostra o resumo com o total e só cria o pedido depois que o cliente confirma. O pedido cai no Painel de Pedidos com a origem <strong className="font-semibold">WhatsApp IA</strong>.</p>
      <p className="mt-[10px] font-semibold text-[#1F2937]">O que ela não faz</p>
      <p className="mt-[2px]">Não dá desconto, não muda preço e não inventa item. Se o cliente pedir uma pessoa, chama o atendente (aparece em amarelo na central).</p>
      <p className="mt-[10px] font-semibold text-[#1F2937]">Custo</p>
      <p className="mt-[2px]">Cada resposta custa uma fração de centavo. Ao chegar no teto do dia, a IA para até a meia-noite e o robô continua respondendo sozinho.</p>
    </>
  )
}

export function AgenteIa() {
  const toasts = useToasts()
  const mostrar = toasts.mostrar
  const [e, setE] = useState<Estado | null>(null)
  const [erro, setErro] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    const r = await fetch('/api/admin/agente-ia', { cache: 'no-store' }).catch(() => null)
    if (!r?.ok) { setErro(true); return }
    setE(await r.json())
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  async function alternar(ativo: boolean) {
    setSalvando(true)
    const r = await fetch('/api/admin/agente-ia', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo }) }).catch(() => null)
    setSalvando(false)
    if (!r?.ok) { mostrar('erro', 'Não foi possível alterar.'); return }
    setE((x) => (x ? { ...x, ativo } : x))
    mostrar('ok', ativo ? 'Agente de IA ligado.' : 'Agente de IA desligado.')
  }

  if (erro) return <p className="p-6 text-[14px] text-[#6B7280]">Não foi possível carregar o Agente de IA. Recarregue a página.</p>
  if (!e) return <p className="flex items-center gap-2 p-6 text-[14px] text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>

  const gastoUsd = e.gastoHojeMicroUsd / 1e6
  const pct = e.tetoUsd > 0 ? Math.min(100, (gastoUsd / e.tetoUsd) * 100) : 100
  const cor = pct <= 50 ? '#10B981' : pct <= 80 ? '#F59E0B' : '#EF4444'
  return (
    <div className="max-w-[720px] space-y-4" data-testid="agente-ia">
      <section className="fin-card min-w-0 p-[16px]">
        <div className="flex flex-wrap items-center justify-between gap-[12px]">
          <div className="flex min-w-0 items-center gap-[12px]">
            <span className="flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-full bg-[#F3E8FF] text-[#7E22CE]"><Sparkles className="h-[20px] w-[20px]" /></span>
            <div className="min-w-0">
              <h2 className="flex items-center gap-[6px] text-[16px] font-semibold text-[#1C2B33]">
                Agente de IA
                <BalaoInfo titulo="Agente de IA"><InfoQuandoEntra /></BalaoInfo>
              </h2>
              <p className="text-[13px] text-[#6B7280]">O robô responde primeiro; a IA entra quando ele não entende ou quando o cliente quer pedir pela conversa.</p>
            </div>
          </div>
          <div className="flex items-center gap-[10px]">
            <span className={`rounded-full px-[10px] py-[2px] text-[12px] font-semibold ${e.ativo ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#EDEEF1] text-[#6B7280]'}`} data-testid="agente-estado">{e.ativo ? 'Ligado' : 'Desligado'}</span>
            <ToggleSwitch checked={e.ativo} onChange={(v) => void alternar(v)} disabled={salvando} rotulo="Agente de IA" />
          </div>
        </div>
        {!e.roboAtivo && (
          <p className="mt-[12px] rounded-[3px] bg-[#FEF3C7] px-[10px] py-[8px] text-[13px] text-[#92400E]">
            O Robô de atendimento está desligado. A IA trabalha junto com ele: ligue o robô em Ajustes › Robô de atendimento.
          </p>
        )}
        {e.ativo && !e.disponivel && (
          <p className="mt-[12px] rounded-[3px] bg-[#FEF3C7] px-[10px] py-[8px] text-[13px] text-[#92400E]">
            A IA ainda está sendo ativada pela Menuzia. Enquanto isso, o robô continua respondendo normalmente.
          </p>
        )}
      </section>

      <section className="fin-card min-w-0 p-[16px]" data-testid="agente-gasto">
        <h3 className="text-[16px] font-semibold leading-tight text-[#1C2B33]">Gasto de hoje</h3>
        <p className="mt-1 text-[13px] text-[#465A69]">Ao chegar no teto, a IA para até a meia-noite e o robô responde sozinho.</p>
        <div className="mt-[12px] h-[10px] overflow-hidden rounded-full bg-[#EDEEF1]" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Gasto de hoje">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cor }} />
        </div>
        <p className="mt-[8px] text-[13px] tabular-nums text-[#1F2937]">
          <strong className="font-semibold">{usd(gastoUsd)}</strong> de {usd(e.tetoUsd)} por dia
          <span className="text-[#6B7280]"> · cerca de {brl(gastoUsd * e.cotacao)} de {brl(e.tetoUsd * e.cotacao)}</span>
        </p>
      </section>
      <PilhaToasts {...toasts} />
    </div>
  )
}
