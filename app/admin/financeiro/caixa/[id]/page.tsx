'use client'

import { use, useEffect, useState } from 'react'
import { formatarCentavos } from '@/lib/financeiro/centavos'

/**
 * Relatório de fechamento de caixa (Fase 2). Tela própria, imprimível pelo navegador (Ctrl+P / PDF).
 * Não passa pelo Assistente de impressão — o recibo térmico continua intocado.
 */
type T = Record<string, unknown>
const brl = (c: unknown) => (c == null ? '—' : formatarCentavos(Number(c)))
const hora = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')
const FORMA: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', credito: 'Crédito', debito: 'Débito', vale: 'Vale', fiado: 'Fiado' }
const TIPO: Record<string, string> = {
  abertura: 'Fundo de troco', recebimento: 'Recebimento', estorno: 'Estorno', sangria: 'Sangria', reforco: 'Reforço', despesa: 'Despesa',
  retirada: 'Retirada', perda: 'Perda', ajuste: 'Ajuste do fechamento', acerto_motoboy: 'Acerto do motoboy',
}

export default function RelatorioCaixa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [d, setD] = useState<{ loja: string; turno: T; saldos: Record<string, number>; porForma: Record<string, number>; extrato: T[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    void fetch(`/api/admin/financeiro/caixa/${id}`, { cache: 'no-store' }).then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setErro(j.error ?? 'Não foi possível abrir o relatório.')
      else setD(j)
    })
  }, [id])
  if (erro) return <p className="p-6 text-[13px] text-danger">{erro}</p>
  if (!d) return <p className="p-6 text-[13px] text-text-subtle">Carregando…</p>
  const t = d.turno
  const pend = t.pendencias as { motoboys?: { nome: string; pedidos: number }[]; contasAbertas?: number } | null
  const anterior = (t.resumo as { fechamento_anterior?: Record<string, unknown> } | null)?.fechamento_anterior ?? null
  const textoPend = pend ? [...(pend.motoboys ?? []).map((m) => `${m.nome} (${m.pedidos} entrega(s) sem acerto)`), ...(pend.contasAbertas ? [`${pend.contasAbertas} conta(s) aberta(s)`] : [])].join(' · ') : ''
  const linha = 'flex justify-between border-b border-dashed border-border py-[4px]'
  return (
    <div className="h-full overflow-y-auto bg-[#EDEEF1] p-4 print:bg-white print:p-0" data-testid="relatorio-caixa">
      <div className="mx-auto max-w-[720px] rounded-[3px] border border-border bg-white p-6 text-[13px] text-text-main print:border-0">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[18px] font-semibold">Fechamento de caixa</h1>
            <p className="text-text-subtle">{d.loja}</p>
          </div>
          <button type="button" onClick={() => window.print()} className="h-[34px] rounded-[3px] bg-primary px-3 text-[11px] font-semibold uppercase tracking-wide text-white print:hidden">Imprimir / PDF</button>
        </div>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <div className={linha}><span>Aberto por</span><b>{String(t.aberto_por_nome ?? '—')}</b></div>
          <div className={linha}><span>Abertura</span><b>{hora(t.aberto_em)}</b></div>
          <div className={linha}><span>Fechado por</span><b>{String(t.fechado_por_nome ?? '—')}</b></div>
          <div className={linha}><span>Fechamento</span><b>{hora(t.fechado_em)}</b></div>
        </div>
        <h2 className="mt-5 text-[14px] font-semibold">Dinheiro</h2>
        <div className={linha}><span>Fundo de troco</span><b>{brl(t.valor_inicial_centavos)}</b></div>
        <div className={linha}><span>Esperado na gaveta</span><b>{brl(t.esperado_dinheiro_centavos ?? d.saldos.gaveta)}</b></div>
        <div className={linha}><span>Contado</span><b>{brl(t.contado_dinheiro_centavos)}</b></div>
        <div className={linha}><span>Diferença</span><b className={Number(t.diferenca_centavos) < 0 ? 'text-[#EF4444]' : ''}>{brl(t.diferenca_centavos)}</b></div>
        <h2 className="mt-5 text-[14px] font-semibold">Cartão</h2>
        <div className={linha}><span>Esperado (registrado)</span><b>{brl(t.esperado_cartao_centavos ?? d.saldos.cartao)}</b></div>
        <div className={linha}><span>Maquininhas (contado)</span><b>{brl(t.contado_cartao_centavos)}</b></div>
        <div className={linha}><span>Diferença</span><b>{brl(t.diferenca_cartao_centavos)}</b></div>
        <h2 className="mt-5 text-[14px] font-semibold">Recebido por forma</h2>
        {Object.keys(d.porForma).length === 0 ? <p className="text-text-subtle">Nenhum recebimento.</p>
          : Object.entries(d.porForma).map(([f, v]) => <div key={f} className={linha}><span>{FORMA[f] ?? f}</span><b>{brl(v)}</b></div>)}
        <div className={linha}><span>Pix a conferir</span><b>{brl(d.saldos.pix_conferir)}</b></div>
        {(t.justificativa || t.fechamento_aprovado_por_nome) ? (
          <p className="mt-4 rounded-[3px] bg-[#FEF3C7] p-3 text-[12.5px]"><b>Justificativa:</b> {String(t.justificativa ?? '—')}{t.fechamento_aprovado_por_nome ? ` · aprovado por ${String(t.fechamento_aprovado_por_nome)}` : ''}</p>
        ) : null}
        {textoPend && <p className="mt-3 rounded-[3px] bg-[#FEE2E2] p-3 text-[12.5px]"><b>Fechado com pendências:</b> {textoPend}</p>}
        {t.reaberto_em ? (
          <div className="mt-3 rounded-[3px] bg-[#FEF3C7] p-3 text-[12.5px]" data-testid="relatorio-reaberto">
            <p><b>Reaberto</b> por {String(t.reaberto_por_nome ?? '—')} em {hora(t.reaberto_em)}. Motivo: {String(t.reaberto_motivo ?? '—')}</p>
            {anterior && <p className="mt-1">Fechamento anterior ({hora(anterior.fechado_em)}, por {String(anterior.fechado_por_nome ?? '—')}): esperado {brl(anterior.esperado_dinheiro_centavos)}, contado {brl(anterior.contado_dinheiro_centavos)}, diferença {brl(anterior.diferenca_centavos)}{anterior.justificativa ? ` — ${String(anterior.justificativa)}` : ''}.</p>}
          </div>
        ) : null}
        <h2 className="mt-5 text-[14px] font-semibold">Lançamentos</h2>
        <table className="mt-1 w-full text-left text-[12px]">
          <thead className="text-text-subtle"><tr><th className="py-1">Hora</th><th>O quê</th><th>Quem</th><th className="text-right">Valor</th></tr></thead>
          <tbody>
            {[...d.extrato].reverse().map((l) => (
              <tr key={String(l.id)} className="border-t border-border">
                <td className="py-1 pr-2">{new Date(String(l.criado_em)).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="pr-2">{TIPO[String(l.tipo)] ?? String(l.tipo)}{l.forma ? ` (${FORMA[String(l.forma)] ?? String(l.forma)})` : ''}{l.motivo ? ` · ${String(l.motivo)}` : ''}</td>
                <td className="pr-2">{String(l.usuario_nome)}{l.aprovado_por_nome ? ` / ${String(l.aprovado_por_nome)}` : ''}</td>
                <td className="text-right font-semibold">{brl(l.valor_centavos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-[11px] text-text-subtle">Emitido em {hora(new Date().toISOString())}. Os lançamentos são imutáveis e assinados (Financeiro › Auditoria).</p>
      </div>
    </div>
  )
}
