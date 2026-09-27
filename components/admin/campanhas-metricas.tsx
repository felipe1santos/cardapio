'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatarReal } from '@/lib/moeda'

/**
 * Painel de métricas das campanhas (0104). Os números vêm de campanhas_metricas, que
 * só responde a dono/gerente e só com a loja dele.
 *
 * Real: enviadas, falhas, tentativas, cliques (link rastreável), pedidos do mesmo
 * telefone em até 12h. Entregue/lida dependem do WhatsApp da loja integrado (webhook) e
 * "lida" é um piso: o cliente pode ter a confirmação de leitura desligada. Pedido sem
 * clique antes é "provável".
 */

export interface MetricaCampanha {
  id: string
  nome: string
  status: string
  tipo_mensagem: string
  incluir_link: boolean
  quando: string
  destinatarios: number
  enviadas: number
  entregues: number
  lidas: number
  respondidas: number
  clicaram: number
  cliques: number
  pedidos: number
  pedidos_clique: number
  convertidos: number
  faturamento: number
  falhas: number
  incertos: number
  nao_enviadas: number
  na_fila: number
  tentativas: number
  retries: number
  duplicados_bloqueados: number
  rastreada: boolean
}

type Totais = Omit<MetricaCampanha, 'id' | 'nome' | 'status' | 'tipo_mensagem' | 'incluir_link' | 'quando' | 'rastreada'> & { campanhas: number; rastreadas: number }

interface Resposta { de: string; ate: string; campanhas: MetricaCampanha[]; totais: Totais }

interface Destinatario {
  nome: string
  telefone: string
  status: string
  erro: string | null
  tentativas: number
  enviado_em: string | null
  entregue_em: string | null
  lido_em: string | null
  clicado_em: string | null
  cliques: number
  respondeu: boolean
  pedido: { numero: number; total: number; criado_em: string; via_clique: boolean } | null
}

const DIA = 86_400_000
const PERIODOS = [
  { id: '7', label: '7 dias' },
  { id: '30', label: '30 dias' },
  { id: '90', label: '90 dias' },
  { id: 'custom', label: 'Personalizado' },
] as const

const STATUS_ENVIO: Record<string, { label: string; cls: string }> = {
  pendente: { label: 'Na fila', cls: 'bg-page text-text-subtle border border-border' },
  reservado: { label: 'Enviando', cls: 'bg-warn/20 text-warn' },
  enviado: { label: 'Enviada', cls: 'bg-alert-bg text-alert-text' },
  erro: { label: 'Falhou', cls: 'bg-danger/10 text-danger' },
  incerto: { label: 'Incerta', cls: 'bg-warn/20 text-warn' },
  cancelado: { label: 'Cancelada', cls: 'bg-page text-text-subtle border border-border' },
  expirado: { label: 'Expirada', cls: 'bg-page text-text-subtle border border-border' },
}

const inteiro = (n: number) => Number(n ?? 0).toLocaleString('pt-BR')
const pct = (parte: number, todo: number) => (todo > 0 ? `${((parte / todo) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—')
const dataCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const diaInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)

export function CampanhasMetricas({ opcoesCampanhas }: { opcoesCampanhas: { id: string; nome: string }[] }) {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['id']>('30')
  const [deCustom, setDeCustom] = useState(diaInput(new Date(Date.now() - 30 * DIA)))
  const [ateCustom, setAteCustom] = useState(diaInput(new Date()))
  const [campanha, setCampanha] = useState('')
  const [dados, setDados] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aberta, setAberta] = useState<MetricaCampanha | null>(null)

  const intervalo = useMemo(() => {
    if (periodo === 'custom') {
      const de = new Date(`${deCustom}T00:00:00`)
      const ate = new Date(`${ateCustom}T23:59:59`)
      return { de, ate }
    }
    const ate = new Date()
    return { de: new Date(ate.getTime() - Number(periodo) * DIA), ate }
  }, [periodo, deCustom, ateCustom])

  const carregar = useCallback(async () => {
    if (Number.isNaN(intervalo.de.getTime()) || Number.isNaN(intervalo.ate.getTime()) || intervalo.ate < intervalo.de) {
      setErro('Escolha um período válido: a data inicial vem antes da final.')
      setCarregando(false)
      return
    }
    setCarregando(true)
    setErro(null)
    try {
      const qs = new URLSearchParams({ de: intervalo.de.toISOString(), ate: intervalo.ate.toISOString() })
      if (campanha) qs.set('campanha', campanha)
      const res = await fetch(`/api/admin/campanhas/metricas?${qs}`)
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error ?? 'Não foi possível carregar as métricas.')
      setDados(j as Resposta)
    } catch (e) {
      setErro((e as Error).message || 'Não foi possível carregar as métricas.')
    } finally {
      setCarregando(false)
    }
  }, [intervalo, campanha])

  useEffect(() => { carregar() }, [carregar])

  const t = dados?.totais
  const vazio = !!dados && dados.campanhas.length === 0

  return (
    <div className="space-y-4" data-testid="metricas-campanhas">
      {/* Filtros */}
      <Card className="flex flex-wrap items-end gap-3 p-3.5">
        <div>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Período</span>
          <div className="flex flex-wrap gap-1.5">
            {PERIODOS.map((p) => (
              <button key={p.id} type="button" onClick={() => setPeriodo(p.id)}
                className={['h-[34px] rounded-menuzia border px-3 text-[12px] font-semibold transition-colors',
                  periodo === p.id ? 'border-primary bg-alert-bg text-primary' : 'border-border text-text-subtle hover:border-primary'].join(' ')}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {periodo === 'custom' && (
          <div className="flex items-end gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              De
              <input type="date" value={deCustom} onChange={(e) => setDeCustom(e.target.value)}
                className="mt-1 block h-[34px] rounded-menuzia border border-border bg-white px-2 text-[13px] font-normal normal-case text-text-main outline-none focus:border-primary" />
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              Até
              <input type="date" value={ateCustom} onChange={(e) => setAteCustom(e.target.value)}
                className="mt-1 block h-[34px] rounded-menuzia border border-border bg-white px-2 text-[13px] font-normal normal-case text-text-main outline-none focus:border-primary" />
            </label>
          </div>
        )}
        <label className="min-w-[200px] flex-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle max-sm:min-w-full">
          Campanha
          <select value={campanha} onChange={(e) => setCampanha(e.target.value)}
            className="mt-1 block h-[34px] w-full rounded-menuzia border border-border bg-white px-2 text-[13px] font-normal normal-case text-text-main outline-none focus:border-primary">
            <option value="">Todas as campanhas</option>
            {opcoesCampanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
      </Card>

      {erro ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center" role="alert">
          <p className="text-[13px] font-medium text-danger">{erro}</p>
          <Button variant="outline" onClick={carregar}>Tentar de novo</Button>
        </Card>
      ) : carregando && !dados ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true" aria-label="Carregando métricas">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[86px] animate-pulse rounded-menuzia border border-border bg-white" />)}
        </div>
      ) : vazio ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-[14px] font-semibold text-text-main">Nenhuma campanha neste período</p>
          <p className="max-w-[420px] text-[13px] text-text-subtle">Quando você disparar uma campanha, aqui aparecem as mensagens enviadas, os cliques no link e os pedidos que vieram dela.</p>
        </Card>
      ) : t ? (
        <div className={carregando ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Numero titulo="Enviadas" valor={inteiro(t.enviadas)} dica={`${inteiro(t.destinatarios)} na lista`} />
            <Numero titulo="Entregues" valor={inteiro(t.entregues)} dica={pct(t.entregues, t.enviadas)} />
            <Numero titulo="Lidas (mínimo)" valor={inteiro(t.lidas)} dica={pct(t.lidas, t.enviadas)} />
            <Numero titulo="Respondidas" valor={inteiro(t.respondidas)} dica={pct(t.respondidas, t.enviadas)} />
            <Numero titulo="Cliques no link" valor={inteiro(t.clicaram)} dica={`${inteiro(t.cliques)} clique${t.cliques === 1 ? '' : 's'} no total`} />
            <Numero titulo="Pedidos em 12h" valor={inteiro(t.pedidos)} dica={`${inteiro(t.pedidos_clique)} com clique · ${inteiro(t.pedidos - t.pedidos_clique)} ${t.pedidos - t.pedidos_clique === 1 ? 'provável' : 'prováveis'}`} />
            <Numero titulo="Faturamento" valor={formatarReal(Number(t.faturamento))} destaque />
            <Numero titulo="Conversão" valor={pct(t.convertidos, t.enviadas)} dica={`${inteiro(t.convertidos)} cliente${t.convertidos === 1 ? '' : 's'} pediram`} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <h3 className="mb-3 text-[13px] font-bold text-text-main">Funil</h3>
              <Funil etapas={[
                { nome: 'Enviadas', valor: t.enviadas },
                { nome: 'Entregues', valor: t.entregues },
                { nome: 'Lidas', valor: t.lidas },
                { nome: 'Clicaram', valor: t.clicaram },
                { nome: 'Pediram', valor: t.convertidos },
              ]} />
            </Card>
            <Card>
              <h3 className="mb-3 text-[13px] font-bold text-text-main">Saúde do envio</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                <Linha nome="Falharam" valor={t.falhas} alerta={t.falhas > 0} />
                <Linha nome="Incertas" valor={t.incertos} alerta={t.incertos > 0} />
                <Linha nome="Não enviadas" valor={t.nao_enviadas} />
                <Linha nome="Na fila" valor={t.na_fila} />
                <Linha nome="Novas tentativas" valor={t.retries} />
                <Linha nome="Duplicidades barradas" valor={t.duplicados_bloqueados} />
              </dl>
            </Card>
          </div>

          <Card className="mt-4 overflow-hidden p-0">
            <h3 className="border-b border-border px-4 py-3 text-[13px] font-bold text-text-main">Por campanha</h3>
            <div className="divide-y divide-border lg:hidden">
              {dados!.campanhas.map((c) => (
                <button key={c.id} type="button" onClick={() => setAberta(c)} className="block w-full px-4 py-3 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words text-[14px] font-semibold text-text-main">{c.nome}</span>
                    <span className="shrink-0 text-[12px] text-text-subtle">{dataCurta(c.quando)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-text-subtle">
                    <span>{inteiro(c.enviadas)} enviadas</span>
                    <span>{inteiro(c.clicaram)} cliques</span>
                    <span>{inteiro(c.pedidos)} pedidos</span>
                    <span className="font-semibold text-price-text">{formatarReal(Number(c.faturamento))}</span>
                  </div>
                </button>
              ))}
            </div>
            <table className="hidden w-full text-[13px] lg:table">
              <thead>
                <tr className="border-b border-border bg-page text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                  <th className="px-4 py-2.5 text-left">Campanha</th>
                  <th className="px-3 py-2.5 text-right">Enviadas</th>
                  <th className="px-3 py-2.5 text-right">Entregues</th>
                  <th className="px-3 py-2.5 text-right">Lidas</th>
                  <th className="px-3 py-2.5 text-right">Cliques</th>
                  <th className="px-3 py-2.5 text-right">Pedidos</th>
                  <th className="px-3 py-2.5 text-right">Faturamento</th>
                  <th className="px-4 py-2.5 text-right">Conversão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dados!.campanhas.map((c) => (
                  <tr key={c.id} onClick={() => setAberta(c)} className="cursor-pointer hover:bg-page/60">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-text-main">{c.nome}</span>
                      <span className="block text-[11px] text-text-subtle">{dataCurta(c.quando)}{c.falhas > 0 ? ` · ${c.falhas} falha${c.falhas === 1 ? '' : 's'}` : ''}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">{inteiro(c.enviadas)}</td>
                    <td className="px-3 py-2.5 text-right">{inteiro(c.entregues)}</td>
                    <td className="px-3 py-2.5 text-right">{inteiro(c.lidas)}</td>
                    <td className="px-3 py-2.5 text-right">{c.incluir_link ? inteiro(c.clicaram) : <span className="text-text-subtle" title="Campanha sem link rastreável">—</span>}</td>
                    <td className="px-3 py-2.5 text-right">{inteiro(c.pedidos)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-price-text">{formatarReal(Number(c.faturamento))}</td>
                    <td className="px-4 py-2.5 text-right">{pct(c.convertidos, c.enviadas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="mt-4 bg-page text-[12px] leading-[18px] text-text-subtle">
            <p className="mb-1 font-semibold text-text-main">Como contamos</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li><strong>Pedidos em 12h</strong>: pedido não cancelado do mesmo telefone nas 12 horas depois do envio. Com clique no link antes do pedido é <strong>confirmado</strong>; sem clique, <strong>provável</strong>. Cada pedido conta para uma campanha só (a mais recente).</li>
              <li><strong>Entregues e lidas</strong> só aparecem quando o WhatsApp da loja está integrado ao Menuzia. “Lida” é o mínimo: quem desliga a confirmação de leitura não aparece.</li>
              <li><strong>Respondidas</strong>: mensagem do cliente em até 12h, nas lojas com o robô de atendimento ligado.</li>
              <li><strong>Cliques</strong> só existem em campanhas com o link do cardápio ligado; pré-visualização do WhatsApp não conta.</li>
            </ul>
          </Card>
        </div>
      ) : null}

      {aberta && <DetalheCampanha campanha={aberta} onClose={() => setAberta(null)} />}
    </div>
  )
}

function Numero({ titulo, valor, dica, destaque }: { titulo: string; valor: string; dica?: string; destaque?: boolean }) {
  return (
    <Card className="p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{titulo}</p>
      <p className={['mt-1 text-[22px] font-bold leading-tight', destaque ? 'text-price-text' : 'text-text-main'].join(' ')}>{valor}</p>
      {dica && <p className="mt-0.5 truncate text-[11px] text-text-subtle">{dica}</p>}
    </Card>
  )
}

function Linha({ nome, valor, alerta }: { nome: string; valor: number; alerta?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-text-subtle">{nome}</dt>
      <dd className={['font-semibold', alerta ? 'text-danger' : 'text-text-main'].join(' ')}>{inteiro(valor)}</dd>
    </div>
  )
}

function Funil({ etapas }: { etapas: { nome: string; valor: number }[] }) {
  const topo = Math.max(1, etapas[0]?.valor ?? 0)
  return (
    <div className="space-y-2">
      {etapas.map((e, i) => (
        <div key={e.nome}>
          <div className="mb-0.5 flex items-baseline justify-between text-[12px]">
            <span className="font-medium text-text-main">{e.nome}</span>
            <span className="text-text-subtle">
              <strong className="text-text-main">{inteiro(e.valor)}</strong>{i > 0 ? ` · ${pct(e.valor, etapas[0].valor)}` : ''}
            </span>
          </div>
          <div className="h-[10px] overflow-hidden rounded-menuzia bg-page">
            <div className={['h-full rounded-menuzia', i === etapas.length - 1 ? 'bg-status-ready' : 'bg-primary'].join(' ')}
              style={{ width: `${Math.max(e.valor > 0 ? 2 : 0, (e.valor / topo) * 100)}%`, opacity: 1 - i * 0.12 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function DetalheCampanha({ campanha, onClose }: { campanha: MetricaCampanha; onClose: () => void }) {
  const [lista, setLista] = useState<Destinatario[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    fetch(`/api/admin/campanhas/metricas?detalhe=${campanha.id}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null)
        if (!r.ok) throw new Error(j?.error ?? 'Não foi possível carregar os destinatários.')
        if (vivo) setLista(j.destinatarios as Destinatario[])
      })
      .catch((e) => { if (vivo) setErro((e as Error).message) })
    return () => { vivo = false }
  }, [campanha.id])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827]/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Detalhes da campanha ${campanha.nome}`}>
      <div className="flex max-h-[90vh] w-full max-w-[760px] flex-col overflow-hidden rounded-menuzia bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="break-words text-[15px] font-bold text-text-main">{campanha.nome}</h2>
            <p className="text-[12px] text-text-subtle">{dataCurta(campanha.quando)} · {inteiro(campanha.destinatarios)} destinatários</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-page text-xl font-light text-text-subtle hover:text-text-main">×</button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini titulo="Enviadas" valor={inteiro(campanha.enviadas)} />
            <Mini titulo="Cliques" valor={campanha.incluir_link ? inteiro(campanha.clicaram) : '—'} />
            <Mini titulo="Pedidos" valor={inteiro(campanha.pedidos)} />
            <Mini titulo="Faturamento" valor={formatarReal(Number(campanha.faturamento))} />
          </div>
          <div className="mt-4">
            <Funil etapas={[
              { nome: 'Enviadas', valor: campanha.enviadas },
              { nome: 'Entregues', valor: campanha.entregues },
              { nome: 'Lidas', valor: campanha.lidas },
              { nome: 'Clicaram', valor: campanha.clicaram },
              { nome: 'Pediram', valor: campanha.convertidos },
            ]} />
          </div>
          <h3 className="mb-2 mt-5 text-[13px] font-bold text-text-main">Destinatários</h3>
          {erro ? (
            <p className="text-[13px] text-danger" role="alert">{erro}</p>
          ) : lista === null ? (
            <p className="text-[13px] text-text-subtle">Carregando…</p>
          ) : lista.length === 0 ? (
            <p className="text-[13px] text-text-subtle">Nenhum destinatário nesta campanha.</p>
          ) : (
            <ul className="divide-y divide-border rounded-menuzia border border-border" data-testid="destinatarios">
              {lista.map((d, i) => {
                const st = STATUS_ENVIO[d.status] ?? { label: d.status, cls: 'bg-page text-text-subtle' }
                return (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[12px]">
                    <div className="min-w-0">
                      <span className="font-semibold text-text-main">{d.nome || 'Cliente'}</span>
                      <span className="ml-1.5 text-text-subtle">{d.telefone}</span>
                      {d.erro && d.status !== 'enviado' && <span className="block text-[11px] text-text-subtle">{d.erro}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={['rounded-menuzia px-2 py-0.5 text-[11px] font-semibold', st.cls].join(' ')}>{st.label}</span>
                      {d.entregue_em && <Etiqueta>{d.lido_em ? 'Lida' : 'Entregue'}</Etiqueta>}
                      {d.respondeu && <Etiqueta>Respondeu</Etiqueta>}
                      {d.clicado_em && <Etiqueta>Clicou</Etiqueta>}
                      {d.pedido && (
                        <span className="rounded-menuzia bg-price-bg px-2 py-0.5 text-[11px] font-semibold text-price-text">
                          Pedido #{d.pedido.numero} · {formatarReal(Number(d.pedido.total))}{d.pedido.via_clique ? '' : ' (provável)'}
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function Mini({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-menuzia border border-border px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{titulo}</p>
      <p className="text-[16px] font-bold text-text-main">{valor}</p>
    </div>
  )
}

function Etiqueta({ children }: { children: React.ReactNode }) {
  return <span className="rounded-menuzia bg-alert-bg px-2 py-0.5 text-[11px] font-semibold text-alert-text">{children}</span>
}
