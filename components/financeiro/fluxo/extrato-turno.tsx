'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Download, FileText, Printer, RotateCcw } from 'lucide-react'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import {
  COR_SITUACAO, ROTULO_CARTEIRA, ROTULO_FORMA, ROTULO_ORIGEM, ROTULO_SITUACAO, ROTULO_TIPO, corDiferenca, dataBR, type LancamentoExtrato, type Situacao,
} from '@/lib/financeiro/fluxo-regras'
import { BOTAO, PainelLateral, Selo } from '../ui/blocos'

/** Extrato de um turno: resumo do fechamento no topo, reaberturas em destaque e TODOS os lançamentos. */
type Turno = Record<string, unknown> & { id: string; aberto_em: string; fechado_em: string | null }
interface Extrato { turno: Turno; lancamentos: LancamentoExtrato[]; reaberturas: { em: string; por: string; motivo: string | null }[] }

const hora = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const so = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const brl = (c: unknown) => (c === null || c === undefined ? '—' : formatarCentavos(Number(c)))
const diaDe = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

export function situacaoDoTurno(t: Turno): Situacao {
  if (!t.fechado_em) return t.status === 'reaberto' ? 'reaberto' : 'aberto'
  return Number(t.diferenca_centavos ?? 0) !== 0 || Number(t.diferenca_cartao_centavos ?? 0) !== 0 ? 'divergente' : 'fechado'
}

export function ExtratoTurno({ turnoId, podeExportar, onFechar, onAbrirTurno, onExportar, toast }: {
  turnoId: string; podeExportar: boolean; onFechar: () => void; onAbrirTurno: (id: string) => void
  onExportar: (formato: 'csv' | 'pdf') => void; toast: (tom: 'ok' | 'erro', t: string) => void
}) {
  const [d, setD] = useState<Extrato | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    setD(null); setErro(null)
    void fetch(`/api/admin/financeiro/fluxo/turno/${turnoId}`, { cache: 'no-store' }).then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (!vivo) return
      if (!r.ok) setErro(j.error ?? 'Não foi possível abrir o turno.')
      else setD(j)
    })
    return () => { vivo = false }
  }, [turnoId])

  async function reimprimir() {
    const r = await fetch(`/api/admin/financeiro/fluxo/turno/${turnoId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'reimprimir' }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast('erro', j.error ?? 'Não foi possível reimprimir.'); return }
    window.open(j.url, '_blank', 'noopener')
  }

  const t = d?.turno
  const sit = t ? situacaoDoTurno(t) : null
  const linha = 'flex justify-between gap-3 border-b border-dashed border-border py-[5px] text-[13px]'
  return (
    <PainelLateral testid="extrato-turno"
      titulo={t ? `Turno de ${dataBR(diaDe(t.aberto_em))}` : 'Turno'}
      subtitulo={t ? <span className="inline-flex items-center gap-2">{sit && <Selo cor={COR_SITUACAO[sit]} testid="extrato-situacao">{ROTULO_SITUACAO[sit]}</Selo>} aberto {hora(t.aberto_em)}{t.fechado_em ? ` · fechado ${hora(t.fechado_em)}` : ' · em andamento'}</span> : null}
      onFechar={onFechar}
      acoes={t ? <>
        {t.fechado_em && <button type="button" className={BOTAO.neutro} onClick={() => void reimprimir()} data-testid="reimprimir-relatorio"><Printer className="h-4 w-4" /> Reimprimir relatório</button>}
        {podeExportar && <button type="button" className={BOTAO.neutro} onClick={() => onExportar('csv')} data-testid="extrato-csv"><Download className="h-4 w-4" /> CSV</button>}
        {podeExportar && <button type="button" className={BOTAO.neutro} onClick={() => onExportar('pdf')} data-testid="extrato-pdf"><FileText className="h-4 w-4" /> PDF</button>}
      </> : null}>
      {erro && <p role="alert" className="text-[13px] font-medium text-[#D93616]" data-testid="extrato-erro">{erro}</p>}
      {!d && !erro && <p className="text-[13px] text-text-subtle">Carregando…</p>}
      {d && t && (
        <>
          {/* Reaberturas em destaque */}
          {d.reaberturas.length > 0 && (
            <div className="mb-4 rounded-[6px] border border-[#D47B04] bg-[#FFFBEB] p-3" data-testid="extrato-reaberturas">
              {d.reaberturas.map((r, i) => (
                <p key={i} className="flex items-start gap-2 text-[13px] text-[#8A4B00]">
                  <RotateCcw className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span><b>Reaberto</b> por {r.por} em {hora(r.em)}{r.motivo ? ` — motivo: ${r.motivo}` : ''}</span>
                </p>
              ))}
            </div>
          )}
          {/* Resumo do fechamento */}
          <div className="mb-4 grid gap-x-6 sm:grid-cols-2" data-testid="extrato-resumo">
            <div>
              <p className="mb-1 text-[13px] font-semibold text-text-subtle">Dinheiro</p>
              <div className={linha}><span>Aberto por</span><b>{String(t.aberto_por_nome ?? '—')}</b></div>
              <div className={linha}><span>Fundo de troco</span><b>{brl(t.valor_inicial_centavos)}</b></div>
              <div className={linha}><span>Esperado</span><b data-testid="extrato-esperado">{t.fechado_em ? brl(t.esperado_dinheiro_centavos) : 'em andamento'}</b></div>
              <div className={linha}><span>Contado</span><b>{brl(t.contado_dinheiro_centavos)}</b></div>
              <div className={linha}><span>Diferença</span><b style={{ color: corDiferenca(t.diferenca_centavos === null || t.diferenca_centavos === undefined ? null : Number(t.diferenca_centavos)) ?? undefined }} data-testid="extrato-diferenca">{brl(t.diferenca_centavos)}</b></div>
            </div>
            <div>
              <p className="mb-1 text-[13px] font-semibold text-text-subtle">Maquininha (cartão)</p>
              <div className={linha}><span>Fechado por</span><b>{String(t.fechado_por_nome ?? '—')}</b></div>
              <div className={linha}><span>Esperado</span><b>{brl(t.esperado_cartao_centavos)}</b></div>
              <div className={linha}><span>Contado</span><b>{brl(t.contado_cartao_centavos)}</b></div>
              <div className={linha}><span>Diferença</span><b style={{ color: corDiferenca(t.diferenca_cartao_centavos === null || t.diferenca_cartao_centavos === undefined ? null : Number(t.diferenca_cartao_centavos)) ?? undefined }}>{brl(t.diferenca_cartao_centavos)}</b></div>
            </div>
          </div>
          {(t.justificativa || t.observacao) && <p className="mb-4 rounded-[4px] bg-page px-3 py-2 text-[12.5px]"><b>Observações:</b> {[t.observacao, t.justificativa].filter(Boolean).join(' · ')}</p>}

          {/* Lançamentos */}
          <p className="mb-2 text-[13px] font-semibold text-text-subtle">{d.lancamentos.length} lançamento{d.lancamentos.length === 1 ? '' : 's'}</p>
          <div className="flex flex-col divide-y divide-border rounded-[6px] border border-border" data-testid="extrato-lancamentos">
            {d.lancamentos.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-text-subtle">Nenhum lançamento neste turno.</p>}
            {d.lancamentos.map((l) => {
              const refOutro = l.referencia && l.referencia.turnoId && l.referencia.turnoId !== t.id
              // Contrapartida interna (conta da empresa / resultado): fica, mas esmaecida.
              const contra = l.carteira === 'empresa' || l.carteira === 'resultado'
              return (
                <div key={l.id} className={`flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5 text-[13px] ${contra ? 'bg-[#F9FAFB] opacity-70' : ''}`} data-testid="extrato-lancamento" data-tipo={l.tipo} data-id={l.id}>
                  <span className="w-[44px] flex-shrink-0 text-[12px] text-text-subtle">{so(l.criadoEm)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text-main">{ROTULO_TIPO[l.tipo] ?? l.tipo}
                      {l.semTurno && <span className="ml-1.5 rounded-[4px] bg-[#4B5563] px-1.5 py-[1px] text-[10.5px] font-semibold text-white" title="Lançado sem turno (entrega/Pix); entra neste turno pelo horário">entrega</span>}
                    </p>
                    {l.descricao && <p className="text-[12px] text-text-subtle">{l.descricao}</p>}
                    <p className="text-[11.5px] text-text-subtle">
                      {[l.origem ? ROTULO_ORIGEM[l.origem] ?? l.origem : null, l.forma ? ROTULO_FORMA[l.forma] ?? l.forma : null, ROTULO_CARTEIRA[l.carteira] ?? l.carteira].filter(Boolean).join(' · ')}
                      {' · '}feito por {l.usuario ?? '—'}{l.aprovadoPor ? ` · aprovado por ${l.aprovadoPor}` : ''}
                    </p>
                    {l.pedidoId && <Link href={`/admin/pedidos?pedido=${l.pedidoId}`} className="text-[12px] font-semibold text-primary hover:underline" data-testid="extrato-pedido">Pedido #{l.pedidoNumero ?? '—'}</Link>}
                    {l.referencia && (
                      <p className="text-[12px] text-[#8A4B00]" data-testid="extrato-referencia">
                        <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                        Corrige o lançamento #{l.referencia.id} ({ROTULO_TIPO[l.referencia.tipo] ?? l.referencia.tipo}, {formatarCentavos(l.referencia.valor)}, {hora(l.referencia.criadoEm)})
                        {refOutro && <> — <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onAbrirTurno(l.referencia!.turnoId!)} data-testid="extrato-turno-antigo">ver turno de {dataBR(diaDe(l.referencia.criadoEm))}</button></>}
                      </p>
                    )}
                  </div>
                  <span className="whitespace-nowrap font-bold" style={{ color: contra ? '#465A69' : l.valor >= 0 ? '#006B4E' : '#D93616' }} data-testid="extrato-valor">{l.valor >= 0 ? '+' : '−'}{formatarCentavos(Math.abs(l.valor))}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </PainelLateral>
  )
}
