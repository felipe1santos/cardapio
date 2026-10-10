'use client'

/**
 * Faixa "Cliente pedindo atendente" no Painel de Pedidos (robô de autoatendimento, 0177).
 * Consulta o servidor (banco próprio, nenhuma API paga) a cada 20 s, só com a aba visível. Lojas sem o
 * autoatendimento recebem lista vazia e a faixa não aparece.
 */
import { useCallback, useEffect, useState } from 'react'
import { Headset, Loader2 } from 'lucide-react'

interface Alerta { id: string; nome: string | null; telefone: string; desde: string }

function telefoneLegivel(t: string) {
  const d = t.replace(/\D/g, '').replace(/^55/, '')
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : t
}

export function AlertaClienteAtendente() {
  const [itens, setItens] = useState<Alerta[]>([])
  const [reativando, setReativando] = useState<string | null>(null)

  const ler = useCallback(async () => {
    if (document.visibilityState !== 'visible') return
    const r = await fetch('/api/admin/whatsapp/autoatendimento/alertas', { cache: 'no-store' }).catch(() => null)
    if (r?.ok) setItens((await r.json()).itens ?? [])
  }, [])

  useEffect(() => {
    void ler()
    const t = setInterval(() => void ler(), 20_000)
    document.addEventListener('visibilitychange', ler)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', ler) }
  }, [ler])

  async function reativar(id: string) {
    setReativando(id)
    const r = await fetch('/api/admin/whatsapp/autoatendimento/alertas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversaId: id }) }).catch(() => null)
    setReativando(null)
    if (r?.ok) setItens((l) => l.filter((x) => x.id !== id))
  }

  if (!itens.length) return null
  return (
    <div className="space-y-[6px] border-b border-[#E5E7EB] bg-[#FEF3C7] px-[12px] py-[8px] sm:px-[20px]" role="status" data-testid="alerta-atendente">
      {itens.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-x-[10px] gap-y-[4px] text-[13px] text-[#1F2937]">
          <Headset className="h-[16px] w-[16px] flex-shrink-0 text-[#F97316]" />
          <span className="font-semibold">Cliente pedindo atendente</span>
          <span className="min-w-0 truncate">{a.nome ? `${a.nome} · ` : ''}{telefoneLegivel(a.telefone)}</span>
          <span className="text-[12px] text-[#6B7280]">desde {new Date(a.desde).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
          <button
            type="button"
            onClick={() => void reativar(a.id)}
            disabled={reativando === a.id}
            className="ml-auto inline-flex min-h-[32px] items-center gap-[6px] rounded-[3px] border border-[#E5E7EB] bg-white px-[10px] text-[11px] font-semibold uppercase tracking-wide text-[#1F2937] hover:border-[#0688D4] hover:text-[#0688D4]"
          >
            {reativando === a.id && <Loader2 className="h-[12px] w-[12px] animate-spin" />}
            Reativar robô nesta conversa
          </button>
        </div>
      ))}
    </div>
  )
}
