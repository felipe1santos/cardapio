'use client'

import { useEffect, useState, useTransition } from 'react'
import { ArrowLeft, ChevronRight, X } from 'lucide-react'
import type { CustoFixo, CustoMes as Mes } from '@/lib/custo/custo-mensal'
import { definirCustoFixoAction } from '@/app/superadmin/actions'
import { CabecalhoHp, CLASSE_BOTAO_SECUNDARIO, PainelHp } from './hp'

/**
 * Custo do sistema (03/11/2026, pedido do dono): quanto a Menuzia paga para funcionar neste mês, na Visão geral, com o
 * histórico de todos os meses num modal. Fixos (Supabase, VPS, outros) vêm do formulário na aba Gastos de API; Google só
 * o que passa da cota grátis; IA pelo custo real. Só exibição.
 */
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 0.1 ? 4 : 2 })
const num = (n: number) => n.toLocaleString('pt-BR')
const nomeMes = (mes: string) => {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(/^./, (c) => c.toUpperCase())
}

function Modal({ titulo, onFechar, children, testid }: { titulo: string; onFechar: () => void; children: React.ReactNode; testid: string }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(24,24,26,0.45)] sm:items-center sm:p-6" onClick={onFechar}>
      <div role="dialog" aria-modal="true" aria-label={titulo} data-testid={testid} onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[90vh] sm:max-w-[760px] sm:rounded-[24px] sm:shadow-[0_24px_60px_rgba(24,24,26,0.18)]">
        <div className="flex flex-shrink-0 items-center gap-2 border-b-[0.8px] border-[rgba(0,0,0,0.1)] px-4 py-3 sm:px-5">
          <button type="button" onClick={onFechar} className="-ml-1 flex h-[40px] items-center gap-1 rounded-[12px] px-1.5 text-[13px] font-semibold text-[#673DE6] sm:hidden" data-testid="modal-voltar"><ArrowLeft className="h-5 w-5" /> Voltar</button>
          <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold leading-[24px] text-[#18181A] max-sm:text-center max-sm:pr-[70px]">{titulo}</h2>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="hidden h-[36px] w-[36px] items-center justify-center rounded-[12px] text-[#58585E] hover:bg-[#F2F3F6] sm:flex" data-testid="modal-fechar"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  )
}

export function CustoMes({ meses, cotacao }: { meses: Mes[]; cotacao: number }) {
  const [aberto, setAberto] = useState(false)
  const m = meses[0]
  if (!m) return null
  const itens: { rotulo: string; detalhe: string; valor: number; cor: string }[] = [
    { rotulo: 'Supabase (banco)', detalhe: `plano Pro · US$ ${(m.supabaseBrl / cotacao).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} × ${cotacao.toLocaleString('pt-BR')}`, valor: m.supabaseBrl, cor: '#3ECF8E' },
    { rotulo: 'VPS e outros', detalhe: m.vpsBrl + m.outrosBrl > 0 ? `VPS ${brl(m.vpsBrl)} · outros ${brl(m.outrosBrl)}` : 'preencha em Gastos de API › Custos fixos', valor: m.vpsBrl + m.outrosBrl, cor: '#673DE6' },
    { rotulo: 'Google Maps', detalhe: m.googleBrl > 0 ? 'acima da cota grátis' : `dentro da cota grátis (tabela ${brl(m.googleTabelaBrl)})`, valor: m.googleBrl, cor: '#0B86C9' },
    { rotulo: 'IA (Claude e áudio)', detalhe: `${num(m.iaChamadas)} respostas`, valor: m.iaBrl, cor: '#18181A' },
  ]
  const max = Math.max(1, ...itens.map((i) => i.valor))
  return (
    <PainelHp testid="sa-custo-mes">
      <CabecalhoHp titulo="Custo do sistema neste mês" sub={`${nomeMes(m.mes)} · parcial, até hoje · fixos + Google acima da cota + IA real`}
        info="Quanto a Menuzia paga para funcionar: Supabase e VPS são fixos por mês (você informa os valores em Gastos de API › Custos fixos); Google só cobra o que passa da cota grátis de 10 mil chamadas por serviço; IA é o custo real das respostas. O mês atual é parcial."
        acoes={<button type="button" onClick={() => setAberto(true)} data-testid="sa-custo-historico" className={CLASSE_BOTAO_SECUNDARIO}>Ver histórico <ChevronRight className="h-[16px] w-[16px]" aria-hidden /></button>} />
      <div className="grid gap-x-[32px] gap-y-[12px] px-[16px] pb-[16px] sm:px-[24px] sm:pb-[20px] lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
        <div>
          <p className="text-[28px] font-bold leading-[36px] tabular-nums text-[#18181A]" data-testid="sa-custo-total">{brl(m.totalBrl)}</p>
          <p className="text-[13px] leading-[18px] text-[#58585E]">total do mês até agora</p>
        </div>
        <ul className="m-0 grid list-none gap-x-[32px] gap-y-[10px] p-0 sm:grid-cols-2">
          {itens.map((i) => (
            <li key={i.rotulo} className="min-w-0">
              <div className="flex items-baseline justify-between gap-[8px] text-[13px] leading-[18px]">
                <span className="min-w-0 truncate text-[#18181A]">{i.rotulo}</span>
                <span className="flex-shrink-0 font-semibold tabular-nums text-[#18181A]">{brl(i.valor)}</span>
              </div>
              <div className="my-[3px] h-[8px] overflow-hidden rounded-full bg-[#F2F3F6]" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${(i.valor / max) * 100}%`, minWidth: i.valor > 0 ? 4 : 0, background: i.cor }} />
              </div>
              <p className="text-[12px] leading-[16px] text-[#58585E]">{i.detalhe}</p>
            </li>
          ))}
        </ul>
      </div>
      {aberto && (
        <Modal titulo="Histórico de custo do sistema" onFechar={() => setAberto(false)} testid="modal-custo-historico">
          <p className="mb-3 text-[13px] leading-[18px] text-[#58585E]">Um mês por linha, do mais recente ao mais antigo. Fixos valem o valor configurado hoje para todos os meses; Google só acima da cota grátis; IA pelo custo real. O mês atual é parcial.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[13px] leading-[18px]">
              <thead>
                <tr className="text-left text-[12px] text-[#58585E]">
                  <th className="py-2 pr-3 font-semibold">Mês</th>
                  <th className="py-2 pr-3 text-right font-semibold">Fixos</th>
                  <th className="py-2 pr-3 text-right font-semibold">IA</th>
                  <th className="py-2 pr-3 text-right font-semibold">Google</th>
                  <th className="py-2 pr-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {meses.map((x) => (
                  <tr key={x.mes} className="border-t-[0.8px] border-[rgba(0,0,0,0.08)]" data-testid="custo-mes-linha">
                    <td className="py-2 pr-3 text-[#18181A]">{nomeMes(x.mes)}{x.parcial && <span className="ml-2 rounded-[8px] bg-[#EBE4FF] px-[6px] text-[11px] font-semibold text-[#673DE6]">parcial</span>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[#18181A]">{brl(x.fixoBrl)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[#18181A]">{brl(x.iaBrl)}<span className="block text-[11px] text-[#58585E]">{num(x.iaChamadas)} resp.</span></td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[#18181A]">{brl(x.googleBrl)}<span className="block text-[11px] text-[#58585E]">tabela {brl(x.googleTabelaBrl)}</span></td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums text-[#18181A]">{brl(x.totalBrl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </PainelHp>
  )
}

/** Gastos de API › Custos fixos: o que o dono paga por mês fora das APIs (Supabase em US$; VPS e outros em R$). */
export function CustoFixoForm({ inicial }: { inicial: CustoFixo }) {
  const [v, setV] = useState({ supabaseUsd: String(inicial.supabaseUsd), vpsBrl: String(inicial.vpsBrl), outrosBrl: String(inicial.outrosBrl) })
  const [msg, setMsg] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  const campo = (k: keyof typeof v, rotulo: string, dica: string) => (
    <label className="flex flex-col gap-1 text-[12.5px]">
      <span className="font-semibold text-text-main">{rotulo}</span>
      <input inputMode="decimal" value={v[k]} onChange={(e) => { setV((x) => ({ ...x, [k]: e.target.value })); setMsg(null) }}
        className="h-[34px] w-[120px] rounded-[12px] border border-border px-2 tabular-nums" data-testid={`custo-fixo-${k}`} />
      <span className="text-text-subtle">{dica}</span>
    </label>
  )
  return (
    <form className="rounded-[20px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white p-[16px] sm:rounded-[24px] sm:p-[24px]" data-testid="custo-fixo"
      onSubmit={(e) => { e.preventDefault(); iniciar(async () => { const r = await definirCustoFixoAction(v); setMsg(r.ok ? r.mensagem ?? 'Salvo' : r.erro) }) }}>
      <p className="text-[16px] font-semibold leading-[24px] text-text-main">Custos fixos do sistema (por mês)</p>
      <p className="mt-1 text-[12.5px] text-text-subtle">Base do card &quot;Custo do sistema&quot; na Visão geral. O que você paga fora das APIs.</p>
      <div className="mt-3 flex flex-wrap gap-5">
        {campo('supabaseUsd', 'Supabase (US$)', 'Plano Pro: 25. Convertido pela cotação acima.')}
        {campo('vpsBrl', 'VPS Hostinger (R$)', 'Valor da fatura mensal.')}
        {campo('outrosBrl', 'Outros (R$)', 'Domínio, e-mail, etc. Pode ficar 0.')}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={pendente} className="h-[34px] rounded-[12px] bg-primary px-3 text-[13px] font-bold text-white hover:bg-primary-dark disabled:opacity-50">Salvar custos fixos</button>
        {msg && <span role="status" className="text-[12.5px] text-text-main">{msg}</span>}
      </div>
    </form>
  )
}
