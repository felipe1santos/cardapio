'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatarReal } from '@/lib/moeda'
import { lerValor } from '@/components/pdv/util'
import type { PainelCaixa } from '@/lib/queries/caixa'
import { useEstadoSessao } from '@/lib/sessao-cliente'
import Link from 'next/link'

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

const FORMA: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', credito: 'Crédito', debito: 'Débito', fiado: 'Fiado' }

/**
 * Gaveta do turno de caixa (0114): abrir/fechar o turno, acerto de cada entregador no turno
 * aberto (esperado × declarado × diferença) e o resumo do dia (soma dos turnos do dia).
 * O servidor calcula o esperado; a tela só manda o que o entregador declarou.
 */
export function CaixaTurnoGaveta({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const [painel, setPainel] = useState<PainelCaixa | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [declarado, setDeclarado] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState(false)
  // Financeiro ligado (Fase 2): abrir e fechar são no Financeiro › Caixa (fundo e contagem cega).
  const financeiro = !!useEstadoSessao()?.financeiroAtivo
  const linkFin = <Link href="/admin/financeiro?secao=caixa" className="text-[12px] font-semibold text-primary underline" data-testid="caixa-no-financeiro">Abrir/fechar em Financeiro › Caixa</Link>

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const r = await fetch('/api/admin/caixa', { cache: 'no-store' })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível carregar o caixa.')
      setPainel(j as PainelCaixa)
      setErro(null)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { if (aberto) void carregar() }, [aberto, carregar])

  async function agir(corpo: Record<string, unknown>) {
    setEnviando(true)
    try {
      const r = await fetch('/api/admin/caixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      const j = await r.json().catch(() => null)
      if (r.status === 409 && corpo.acao === 'fechar' && j?.pendentes?.length) {
        const nomes = (j.pendentes as { nome: string }[]).map((p) => p.nome).join(', ')
        if (confirm(`${nomes} ainda tem dinheiro para acertar neste turno. Fechar o turno mesmo assim?`)) return agir({ acao: 'fechar', forcar: true })
        return
      }
      if (!r.ok) throw new Error(j?.error ?? 'Não foi possível concluir.')
      await carregar()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const turno = painel?.turnoAberto ?? null
  const dia = painel?.resumoDia

  return (
    <>
      {aberto && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={onFechar} />}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[440px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          aberto ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
        data-testid="gaveta-caixa"
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Fechamento de caixa</h2>
            <p className="mt-0.5 text-xs text-text-subtle">Por turno: da abertura ao fechamento, mesmo passando da meia-noite.</p>
          </div>
          <button onClick={onFechar} className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4.5">
          {erro && <p className="rounded-menuzia bg-danger/10 px-3 py-2 text-xs font-medium text-danger">{erro}</p>}
          {carregando && !painel && <p className="text-xs text-text-subtle">Carregando…</p>}

          {painel && (
            <div className="rounded-menuzia border border-border p-3.5">
              {turno ? (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-text-main">Turno aberto</p>
                    <p className="text-xs text-text-subtle">desde {hora(turno.abertoEm)}{turno.abertoPorNome ? ` · ${turno.abertoPorNome}` : ''}</p>
                  </div>
                  {financeiro ? linkFin : <Button variant="outline" disabled={enviando} onClick={() => void agir({ acao: 'fechar' })} data-testid="fechar-turno">Fechar turno</Button>}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] text-text-subtle">Nenhum turno de caixa aberto. Ele abre sozinho na primeira entrega.</p>
                  {financeiro ? linkFin : <Button variant="primary" disabled={enviando} onClick={() => void agir({ acao: 'abrir' })} data-testid="abrir-turno">Abrir turno</Button>}
                </div>
              )}
            </div>
          )}

          {financeiro && (
            // Com o financeiro o acerto é cego (conta primeiro, depois revela) e fica no Financeiro.
            <div className="rounded-menuzia border border-border p-3.5 text-[13px]" data-testid="acerto-no-financeiro">
              O acerto dos motoboys é feito em <Link href="/admin/financeiro?secao=motoboys" className="font-semibold text-primary underline">Financeiro › Acerto de Motoboys</Link> (contagem cega).
            </div>
          )}

          {!financeiro && turno && painel && painel.acerto.length === 0 && (
            <div className="rounded-menuzia border border-dashed border-border p-4 text-center text-xs text-text-subtle">Nenhuma entrega em dinheiro para acertar neste turno.</div>
          )}

          {!financeiro && turno && painel?.acerto.map((r) => {
            const texto = declarado[r.entregadorId] ?? ''
            const valor = lerValor(texto)
            const diff = texto !== '' && Number.isFinite(valor) ? valor - r.valorEsperado : null
            return (
              <div key={r.entregadorId} className="rounded-menuzia border border-border p-3.5" data-testid="acerto-entregador">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{r.nome}</h4>
                  <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold text-text-subtle">{r.pedidos} entregue(s){r.emRota ? ` · ${r.emRota} em rota` : ''}</span>
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-text-subtle">Dinheiro a devolver</span><span className="font-medium">{formatarReal(r.valorEsperado)}</span></div>
                  <div className="flex justify-between"><span className="text-text-subtle">Troco que ele levou</span><span className="font-medium">{formatarReal(r.trocoLevado)}</span></div>
                  {r.pedidos > 0 && (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-text-subtle">Valor declarado</span>
                      <input value={texto} inputMode="decimal" onChange={(e) => setDeclarado((p) => ({ ...p, [r.entregadorId]: e.target.value }))} placeholder="0,00"
                        className="w-28 rounded-menuzia border border-border px-2.5 py-1.5 text-right font-sans text-[13px] outline-none focus:border-primary" />
                    </div>
                  )}
                  {diff !== null && (
                    <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                      <span>Diferença</span>
                      <span className={Math.abs(diff) < 0.005 ? 'text-price-text' : 'text-danger'}>{diff < 0 ? '− ' : ''}{formatarReal(Math.abs(diff))}</span>
                    </div>
                  )}
                </div>
                {r.pedidos > 0 && (
                  <Button variant="primary" className="mt-3 w-full" disabled={enviando || texto === '' || !Number.isFinite(valor)}
                    onClick={() => void agir({ acao: 'acertar', entregadorId: r.entregadorId, valorDeclarado: valor }).then(() => setDeclarado((p) => ({ ...p, [r.entregadorId]: '' })))}>
                    Registrar acerto
                  </Button>
                )}
              </div>
            )
          })}

          {dia && (
            <div className="rounded-menuzia border border-border p-3.5" data-testid="resumo-dia">
              <p className="mb-2 text-[13px] font-semibold text-text-main">Resumo do dia · {dia.dia.split('-').reverse().join('/')}</p>
              {dia.turnos.length === 0 ? (
                <p className="text-xs text-text-subtle">Nenhum turno aberto hoje.</p>
              ) : (
                <div className="space-y-1.5 text-sm">
                  {dia.turnos.map((t) => (
                    <div key={t.turnoId} className="flex justify-between text-xs text-text-subtle">
                      <span>Turno {hora(t.abertoEm)} → {t.fechadoEm ? hora(t.fechadoEm) : 'aberto'}</span>
                      <span>{formatarReal(t.dinheiroEsperado)} em entregas</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-border pt-1.5"><span className="text-text-subtle">Entregas em dinheiro</span><span className="font-medium">{dia.entregasEmDinheiro} · {formatarReal(dia.dinheiroEsperado)}</span></div>
                  <div className="flex justify-between"><span className="text-text-subtle">Declarado nos acertos</span><span className="font-medium">{formatarReal(dia.dinheiroDeclarado)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Diferença</span><span className={Math.abs(dia.diferenca) < 0.005 ? 'text-price-text' : 'text-danger'}>{dia.diferenca < 0 ? '− ' : ''}{formatarReal(Math.abs(dia.diferenca))}</span></div>
                  {Object.entries(dia.pagamentosPorForma).map(([f, v]) => (
                    <div key={f} className="flex justify-between text-xs"><span className="text-text-subtle">Recebido no salão/balcão · {FORMA[f] ?? f}</span><span>{formatarReal(v)}</span></div>
                  ))}
                </div>
              )}
              {dia.foraDeTurno > 0 && (
                <p className="mt-2 rounded-menuzia bg-warn/15 px-2.5 py-1.5 text-[11px] font-medium text-warn">
                  {dia.foraDeTurno} entrega(s) em dinheiro hoje aconteceram com o caixa fechado — não entram em nenhum turno.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={onFechar}>Fechar</Button>
        </div>
      </aside>
    </>
  )
}
