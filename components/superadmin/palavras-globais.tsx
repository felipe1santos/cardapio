'use client'

import { useState, useTransition } from 'react'
import { decidirPalavraGlobalAction } from '@/app/superadmin/actions'

export interface PalavraGlobal { id: string; palavra: string; assunto: string; status: 'sugerida' | 'aprovada' | 'recusada'; vezes: number; criado_em: string; loja: string }

const ROTULO: Record<string, string> = {
  saudacao: 'Saudação', cardapio: 'Cardápio', entrega: 'Entrega', status_pedido: 'Status do pedido', horario: 'Horário', pagamento_pix: 'Pagamento e Pix',
  endereco_retirada: 'Endereço e retirada', reclamacao: 'Reclamação', atendente: 'Atendente', parar: 'Parar',
}
const SELO: Record<PalavraGlobal['status'], string> = {
  sugerida: 'bg-[#FEF3C7] text-[#92400E]', aprovada: 'bg-[#DCFCE7] text-[#15803D]', recusada: 'bg-[#F1F2F4] text-[#4B5563]',
}

/** Palavras do robô sugeridas pelas lojas: aprovar = vale para todas; recusar = some. */
export function PalavrasGlobais({ itens }: { itens: PalavraGlobal[] }) {
  const [lista, setLista] = useState(itens)
  const [msg, setMsg] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  const decidir = (p: PalavraGlobal, aprovar: boolean) => iniciar(async () => {
    const r = await decidirPalavraGlobalAction(p.id, aprovar)
    setMsg(r.ok ? r.mensagem ?? 'Salvo.' : r.erro ?? 'Erro.')
    if (r.ok) setLista((l) => l.map((x) => (x.id === p.id ? { ...x, status: aprovar ? 'aprovada' : 'recusada' } : x)))
  })
  const sugeridas = lista.filter((p) => p.status === 'sugerida').length
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <a href="/superadmin" className="text-[13px] font-semibold text-primary hover:underline">← Painel da plataforma</a>
        <h1 className="text-[19px] font-semibold text-text-main">Palavras do robô</h1>
        <span className="text-[13px] text-text-subtle">{sugeridas} para decidir · aprovada vale para todas as lojas</span>
      </div>
      {msg && <p className="mb-3 text-[13px] font-semibold text-text-main" role="status">{msg}</p>}
      <div className="overflow-x-auto rounded-[6px] border border-border bg-white">
        <table className="w-full text-left text-[13px]" data-testid="palavras-globais">
          <thead className="bg-[#F9FAFB] text-[11.5px] font-semibold text-text-subtle">
            <tr><th className="px-3 py-2.5">Palavra</th><th className="px-3 py-2.5">Assunto</th><th className="px-3 py-2.5">Loja que ensinou</th><th className="px-3 py-2.5 text-right">Vezes</th><th className="px-3 py-2.5">Situação</th><th className="px-3 py-2.5" /></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!lista.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-text-subtle">Nenhuma palavra sugerida ainda.</td></tr>}
            {lista.map((p) => (
              <tr key={p.id} data-testid="palavra-global">
                <td className="px-3 py-2 font-semibold">{p.palavra}</td>
                <td className="px-3 py-2">{ROTULO[p.assunto] ?? p.assunto}</td>
                <td className="px-3 py-2 text-text-subtle">{p.loja}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.vezes}</td>
                <td className="px-3 py-2"><span className={`rounded-[4px] px-2 py-[2px] text-[11.5px] font-semibold ${SELO[p.status]}`}>{p.status === 'sugerida' ? 'Sugerida' : p.status === 'aprovada' ? 'Aprovada' : 'Recusada'}</span></td>
                <td className="px-3 py-2 text-right">
                  {p.status !== 'aprovada' && <button type="button" disabled={pendente} onClick={() => decidir(p, true)} className="mr-2 h-[32px] rounded-[4px] bg-[#047857] px-3 text-[12px] font-semibold text-white hover:bg-[#065F46] disabled:opacity-50">Aprovar</button>}
                  {p.status !== 'recusada' && <button type="button" disabled={pendente} onClick={() => decidir(p, false)} className="h-[32px] rounded-[4px] border border-border px-3 text-[12px] font-semibold text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-50">{p.status === 'aprovada' ? 'Tirar de todas' : 'Recusar'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
