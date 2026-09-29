'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Calculator, CalendarDays, CheckCheck, CircleX, Copy, Eye, Hourglass, Megaphone, MessageCircleReply,
  MousePointerClick, Percent, RotateCcw, Send, ShieldCheck, ShoppingBag, Wallet, type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatarReal } from '@/lib/moeda'
import { situacaoCampanha } from '@/lib/mensageria/campanhas'
import { BolhaIcone, Cartao, Etiqueta, TituloBloco, TONS, type Tom } from '@/components/admin/painel-visual'

/**
 * Painel de métricas das campanhas (0104). Os números vêm de campanhas_metricas, que
 * só responde a dono/gerente e só com a loja dele. Visual no idioma do Dashboard.
 *
 * Real: enviadas, falhas, tentativas, cliques (link rastreável), pedidos do mesmo
 * telefone em até 12h. Entregue/lida dependem do WhatsApp da loja integrado (webhook) e
 * "lida" é um piso: o cliente pode ter a confirmação de leitura desligada. Pedido sem
 * clique antes é "provável". ROI precisa de custo, que a campanha não registra.
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

const STATUS_ENVIO: Record<string, { label: string; tom: Tom }> = {
  pendente: { label: 'Na fila', tom: 'cinza' },
  reservado: { label: 'Enviando', tom: 'ambar' },
  enviado: { label: 'Enviada', tom: 'azul' },
  erro: { label: 'Falhou', tom: 'vermelho' },
  incerto: { label: 'Incerta', tom: 'ambar' },
  cancelado: { label: 'Cancelada', tom: 'cinza' },
  expirado: { label: 'Expirada', tom: 'cinza' },
}

const STATUS_CAMPANHA: Record<string, { label: string; tom: Tom }> = {
  rascunho: { label: 'Rascunho', tom: 'cinza' },
  agendada: { label: 'Agendada', tom: 'azul' },
  enviando: { label: 'Enviando', tom: 'ambar' },
  pausada: { label: 'Pausada', tom: 'ambar' },
  concluida: { label: 'Concluída', tom: 'verde' },
  concluida_com_falhas: { label: 'Concluída com falhas', tom: 'ambar' },
  falhou: { label: 'Falhou', tom: 'vermelho' },
  cancelada: { label: 'Cancelada', tom: 'vermelho' },
}

const inteiro = (n: number) => Number(n ?? 0).toLocaleString('pt-BR')
/** "1 cliente pediu" / "3 clientes pediram": número + a forma certa. */
export const contagem = (n: number, singular: string, plural: string) => `${inteiro(n)} ${Number(n) === 1 ? singular : plural}`
const pctNum = (parte: number, todo: number) => (todo > 0 ? (parte / todo) * 100 : 0)
const pct = (parte: number, todo: number) => (todo > 0 ? `${pctNum(parte, todo).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—')
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
  const provaveis = t ? t.pedidos - t.pedidos_clique : 0

  return (
    <div className="space-y-4" data-testid="metricas-campanhas">
      {/* Filtros */}
      <Cartao className="flex flex-wrap items-end gap-x-4 gap-y-3 p-4">
        <div className="min-w-0">
          <span className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--adm-texto-forte)]">
            <CalendarDays className="h-3.5 w-3.5 text-[var(--adm-texto-suave)]" /> Período
          </span>
          <div className="inline-flex flex-wrap rounded-full bg-[#F1F5F9] p-[3px]" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p.id} type="button" onClick={() => setPeriodo(p.id)} aria-pressed={periodo === p.id}
                className={['h-[30px] rounded-full px-3.5 text-[12px] font-semibold transition-colors',
                  periodo === p.id ? 'bg-white text-[#0688D4] shadow-[0_1px_2px_rgba(15,23,42,0.12)]' : 'text-[var(--adm-texto-suave)] hover:text-[var(--adm-texto)]'].join(' ')}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {periodo === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            {([['De', deCustom, setDeCustom], ['Até', ateCustom, setAteCustom]] as const).map(([rotulo, valor, mudar]) => (
              <label key={rotulo} className="text-[12px] font-semibold text-[var(--adm-texto-forte)]">
                {rotulo}
                <input type="date" value={valor} onChange={(e) => mudar(e.target.value)}
                  className="mt-1.5 block h-[36px] rounded-[6px] border border-[var(--adm-borda)] bg-white px-2.5 text-[13px] font-normal text-[var(--adm-texto)] outline-none focus:border-[#0688D4]" />
              </label>
            ))}
          </div>
        )}
        <label className="min-w-[220px] flex-1 text-[12px] font-semibold text-[var(--adm-texto-forte)] max-sm:min-w-full">
          <span className="flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5 text-[var(--adm-texto-suave)]" /> Campanha</span>
          <select value={campanha} onChange={(e) => setCampanha(e.target.value)}
            className="mt-1.5 block h-[36px] w-full rounded-[6px] border border-[var(--adm-borda)] bg-white px-2.5 text-[13px] font-normal text-[var(--adm-texto)] outline-none focus:border-[#0688D4]">
            <option value="">Todas as campanhas</option>
            {opcoesCampanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
      </Cartao>

      {erro ? (
        <Cartao className="flex flex-col items-center gap-3 px-4 py-10 text-center" role="alert">
          <BolhaIcone icone={AlertTriangle} tom="vermelho" />
          <p className="text-[13px] font-medium text-[#DC2626]">{erro}</p>
          <Button variant="outline" onClick={carregar}>Tentar de novo</Button>
        </Cartao>
      ) : carregando && !dados ? (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando métricas">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[112px] animate-pulse rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white" />)}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[92px] animate-pulse rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white" />)}
          </div>
        </div>
      ) : vazio ? (
        <Cartao className="flex flex-col items-center gap-3 px-4 py-14 text-center">
          <BolhaIcone icone={Megaphone} tom="azul" tamanho={52} />
          <p className="text-[15px] font-bold text-[var(--adm-texto)]">Nenhuma campanha neste período</p>
          <p className="max-w-[420px] text-[13px] text-[var(--adm-texto-suave)]">Quando você disparar uma campanha, aqui aparecem as mensagens enviadas, os cliques no link e os pedidos que vieram dela.</p>
        </Cartao>
      ) : t ? (
        <div className={['space-y-4 transition-opacity', carregando ? 'opacity-60' : ''].join(' ')}>
          {/* Resultado: o que a campanha trouxe */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Destaque icone={ShoppingBag} tom="azul" titulo="Pedidos em 12h" valor={inteiro(t.pedidos)}
              dica={`${inteiro(t.pedidos_clique)} com clique · ${contagem(provaveis, 'provável', 'prováveis')}`}
              etiqueta={provaveis > 0 ? <Etiqueta tom="ambar" title="Pedido do mesmo telefone sem clique no link antes">estimados</Etiqueta> : undefined} />
            <Destaque icone={Wallet} tom="verde" titulo="Faturamento" valor={formatarReal(Number(t.faturamento))} valorCor={TONS.verde.cor}
              dica="Pedidos atribuídos às campanhas" />
            <Destaque icone={Percent} tom="roxo" titulo="Conversão" valor={pct(t.convertidos, t.enviadas)}
              dica={contagem(t.convertidos, 'cliente pediu', 'clientes pediram')} barra={pctNum(t.convertidos, t.enviadas)} />
            <Destaque icone={Calculator} tom="cinza" titulo="ROI" valor="Indisponível" valorPequeno
              dica="Custo da campanha não informado — sem custo não dá para calcular o retorno." />
          </div>

          {/* Alcance e engajamento */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Numero icone={Send} tom="cinza" titulo="Enviadas" valor={inteiro(t.enviadas)} dica={`${inteiro(t.destinatarios)} na lista`} />
            <Numero icone={CheckCheck} tom="ceu" titulo="Entregues" valor={inteiro(t.entregues)} dica={pct(t.entregues, t.enviadas)} />
            <Numero icone={Eye} tom="roxo" titulo="Lidas (mínimo)" valor={inteiro(t.lidas)} dica={pct(t.lidas, t.enviadas)} />
            <Numero icone={MessageCircleReply} tom="laranja" titulo="Respondidas" valor={inteiro(t.respondidas)} dica={pct(t.respondidas, t.enviadas)} />
            <Numero className="max-md:col-span-2" icone={MousePointerClick} tom="ambar" titulo="Cliques no link" valor={inteiro(t.clicaram)} dica={`${contagem(t.cliques, 'clique', 'cliques')} no total`} />
          </div>

          {/* Funil + faturamento por campanha */}
          <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
            <Cartao className="p-4">
              <TituloBloco titulo="Funil" subtitulo="Do envio ao pedido — cada etapa sobre as mensagens enviadas" />
              <div className="mt-4">
                <Funil etapas={[
                  { nome: 'Enviadas', valor: t.enviadas, tom: 'azul' },
                  { nome: 'Entregues', valor: t.entregues, tom: 'ceu' },
                  { nome: 'Lidas', valor: t.lidas, tom: 'roxo' },
                  { nome: 'Clicaram', valor: t.clicaram, tom: 'ambar' },
                  { nome: 'Pediram', valor: t.convertidos, tom: 'verde' },
                ]} />
              </div>
            </Cartao>
            <Cartao className="p-4">
              <TituloBloco titulo="Faturamento por campanha" subtitulo="Pedidos em até 12h após o envio" />
              <FaturamentoPorCampanha campanhas={dados!.campanhas} />
            </Cartao>
          </div>

          {/* Saúde do envio */}
          <Cartao className="p-4">
            <TituloBloco titulo="Saúde do envio" subtitulo="O que aconteceu com cada mensagem na fila" />
            <dl className="mt-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
              <Saude icone={CircleX} tom="vermelho" nome="Falharam" valor={t.falhas} />
              <Saude icone={AlertTriangle} tom="ambar" nome="Incertas" valor={t.incertos} />
              <Saude icone={Hourglass} tom="cinza" nome="Não enviadas" valor={t.nao_enviadas} />
              <Saude icone={Send} tom="azul" nome="Na fila" valor={t.na_fila} />
              <Saude icone={RotateCcw} tom="roxo" nome="Novas tentativas" valor={t.retries} />
              <Saude icone={Copy} tom="verde" nome="Duplicidades barradas" valor={t.duplicados_bloqueados} />
            </dl>
          </Cartao>

          {/* Por campanha */}
          <Cartao className="overflow-hidden">
            <div className="px-4 pt-4">
              <TituloBloco titulo="Por campanha" subtitulo="Toque numa campanha para ver cada destinatário" />
            </div>
            <div className="mt-3 divide-y divide-[var(--adm-borda)] border-t border-[var(--adm-borda)] lg:hidden">
              {dados!.campanhas.map((c) => (
                <button key={c.id} type="button" onClick={() => setAberta(c)} className="block w-full px-4 py-3.5 text-left hover:bg-[var(--adm-hover)]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block break-words text-[14px] font-semibold text-[var(--adm-texto)]">{c.nome}</span>
                      <span className="text-[12px] text-[var(--adm-texto-suave)]">{dataCurta(c.quando)}</span>
                    </span>
                    <SeloCampanha status={c.status} />
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] text-[var(--adm-texto-medio)] min-[400px]:grid-cols-4">
                    <span>{contagem(c.enviadas, 'enviada', 'enviadas')}</span>
                    <span>{c.incluir_link ? contagem(c.clicaram, 'clique', 'cliques') : 'sem link'}</span>
                    <span>{contagem(c.pedidos, 'pedido', 'pedidos')}</span>
                    <span className="font-semibold" style={{ color: TONS.verde.cor }}>{formatarReal(Number(c.faturamento))}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3 hidden overflow-x-auto lg:block">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-y border-[var(--adm-borda)] bg-[#F8FAFC] text-[11.5px] font-semibold text-[var(--adm-texto-suave)]">
                    <th className="px-4 py-2.5 text-left">Campanha</th>
                    <th className="px-3 py-2.5 text-right">Enviadas</th>
                    <th className="px-3 py-2.5 text-left">Entrega</th>
                    <th className="px-3 py-2.5 text-right">Cliques</th>
                    <th className="px-3 py-2.5 text-right">Pedidos</th>
                    <th className="px-3 py-2.5 text-right">Faturamento</th>
                    <th className="px-4 py-2.5 text-right">Conversão</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--adm-borda)]">
                  {dados!.campanhas.map((c) => (
                    <tr key={c.id} onClick={() => setAberta(c)} className="cursor-pointer transition-colors hover:bg-[#F8FAFC]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <BolhaIcone icone={Megaphone} tom={STATUS_CAMPANHA[situacaoCampanha({ status: c.status, totalEnviados: c.enviadas, totalErros: c.falhas })]?.tom ?? 'cinza'} tamanho={32} />
                          <span className="min-w-0">
                            <span className="block font-semibold text-[var(--adm-texto)]">{c.nome}</span>
                            <span className="block text-[11.5px] text-[var(--adm-texto-suave)]">
                              {dataCurta(c.quando)} · {STATUS_CAMPANHA[situacaoCampanha({ status: c.status, totalEnviados: c.enviadas, totalErros: c.falhas })]?.label ?? c.status}{c.falhas > 0 ? ` · ${contagem(c.falhas, 'falha', 'falhas')}` : ''}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-[var(--adm-texto)]">{inteiro(c.enviadas)}</td>
                      <td className="px-3 py-3">
                        <BarraPct valor={pctNum(c.entregues, c.enviadas)} tom="ceu" rotulo={pct(c.entregues, c.enviadas)} />
                      </td>
                      <td className="px-3 py-3 text-right">{c.incluir_link ? inteiro(c.clicaram) : <span className="text-[var(--adm-texto-suave)]" title="Campanha sem link rastreável">—</span>}</td>
                      <td className="px-3 py-3 text-right">
                        {inteiro(c.pedidos)}
                        {c.pedidos > c.pedidos_clique && <span className="block text-[11px] text-[#B45309]">{contagem(c.pedidos - c.pedidos_clique, 'provável', 'prováveis')}</span>}
                      </td>
                      <td className="px-3 py-3 text-right font-bold" style={{ color: TONS.verde.cor }}>{formatarReal(Number(c.faturamento))}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-block rounded-full px-2 py-[2px] text-[12px] font-semibold" style={{ backgroundColor: TONS.roxo.fundo, color: TONS.roxo.cor }}>{pct(c.convertidos, c.enviadas)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>

          {/* Como contamos */}
          <Cartao className="bg-[#F8FAFC] p-4 text-[12px] leading-[18px] text-[var(--adm-texto-medio)]">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-[var(--adm-texto-forte)]"><ShieldCheck className="h-4 w-4 text-[#0688D4]" /> Como contamos</p>
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              <Etiqueta tom="verde">Real: enviadas, falhas, cliques, pedidos com clique</Etiqueta>
              <Etiqueta tom="ambar">Estimado: pedidos prováveis</Etiqueta>
              <Etiqueta tom="roxo">Mínimo: lidas</Etiqueta>
            </div>
            <ul className="list-disc space-y-1 pl-4">
              <li><strong>Pedidos em 12h</strong>: pedido não cancelado do mesmo telefone nas 12 horas depois do envio. Com clique no link antes do pedido é <strong>confirmado</strong>; sem clique, <strong>provável</strong>. Cada pedido conta para uma campanha só (a mais recente).</li>
              <li><strong>Entregues e lidas</strong> só aparecem quando o WhatsApp da loja está integrado ao Menuzia. “Lida” é o mínimo: quem desliga a confirmação de leitura não aparece.</li>
              <li><strong>Respondidas</strong>: mensagem do cliente em até 12h, nas lojas com o robô de atendimento ligado.</li>
              <li><strong>Cliques</strong> só existem em campanhas com o link do cardápio ligado; pré-visualização do WhatsApp não conta.</li>
              <li><strong>ROI</strong> precisa do custo da campanha, que ainda não é registrado — por isso aparece como indisponível.</li>
            </ul>
          </Cartao>
        </div>
      ) : null}

      {aberta && <DetalheCampanha campanha={aberta} onClose={() => setAberta(null)} />}
    </div>
  )
}

/** Cartão grande da faixa de resultado. */
function Destaque({ icone, tom, titulo, valor, dica, etiqueta, barra, valorCor, valorPequeno }: {
  icone: LucideIcon; tom: Tom; titulo: string; valor: string; dica?: string; etiqueta?: React.ReactNode; barra?: number; valorCor?: string; valorPequeno?: boolean
}) {
  return (
    <Cartao className="flex flex-col p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <BolhaIcone icone={icone} tom={tom} tamanho={40} />
        {etiqueta}
      </div>
      <p className="mt-3 text-[12.8px] font-medium text-[var(--adm-texto-medio)]">{titulo}</p>
      <p className={['mt-0.5 font-bold leading-tight', valorPequeno ? 'text-[16px] sm:text-[18px] text-[var(--adm-texto-suave)]' : 'text-[21px] sm:text-[26px]'].join(' ')}
        style={valorCor && !valorPequeno ? { color: valorCor } : { color: valorPequeno ? undefined : 'var(--adm-texto)' }}>
        {valor}
      </p>
      {barra !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eef0f3]">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, barra)}%`, backgroundColor: TONS[tom].forte }} />
        </div>
      )}
      {dica && <p className="mt-1.5 text-[11.5px] leading-[16px] text-[var(--adm-texto-suave)]">{dica}</p>}
    </Cartao>
  )
}

/** Cartão compacto da faixa de alcance/engajamento. */
function Numero({ icone, tom, titulo, valor, dica, className = '' }: { icone: LucideIcon; tom: Tom; titulo: string; valor: string; dica?: string; className?: string }) {
  return (
    <Cartao className={`flex items-start gap-3 p-3.5 ${className}`}>
      <BolhaIcone icone={icone} tom={tom} tamanho={36} />
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-[var(--adm-texto-medio)]">{titulo}</p>
        <p className="text-[20px] font-bold leading-tight text-[var(--adm-texto)]">{valor}</p>
        {dica && <p className="truncate text-[11px] text-[var(--adm-texto-suave)]">{dica}</p>}
      </div>
    </Cartao>
  )
}

function Saude({ icone: Icone, tom, nome, valor }: { icone: LucideIcon; tom: Tom; nome: string; valor: number }) {
  const t = TONS[tom]
  const zero = !valor
  return (
    <div className="flex items-center gap-2.5 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] px-3 py-2.5">
      <Icone className="h-4 w-4 flex-shrink-0" style={{ color: zero ? '#94A3B8' : t.cor }} strokeWidth={2.2} />
      <dt className="min-w-0 flex-1 truncate text-[12px] text-[var(--adm-texto-medio)]">{nome}</dt>
      <dd className="text-[15px] font-bold" style={{ color: zero ? 'var(--adm-texto-suave)' : tom === 'vermelho' || tom === 'ambar' ? t.cor : 'var(--adm-texto)' }}>{inteiro(valor)}</dd>
    </div>
  )
}

function SeloCampanha({ status }: { status: string }) {
  const s = STATUS_CAMPANHA[status] ?? { label: status, tom: 'cinza' as Tom }
  return <Etiqueta tom={s.tom}>{s.label}</Etiqueta>
}

function BarraPct({ valor, tom, rotulo }: { valor: number; tom: Tom; rotulo: string }) {
  return (
    <div className="flex min-w-[110px] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eef0f3]">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, valor)}%`, backgroundColor: TONS[tom].forte }} />
      </div>
      <span className="w-[42px] text-right text-[12px] text-[var(--adm-texto-medio)]">{rotulo}</span>
    </div>
  )
}

/** Funil em degraus: barra larga por etapa, cor própria, % sobre as enviadas e a queda entre etapas. */
function Funil({ etapas }: { etapas: { nome: string; valor: number; tom: Tom }[] }) {
  const topo = Math.max(1, etapas[0]?.valor ?? 0)
  return (
    <ol className="space-y-2.5">
      {etapas.map((e, i) => {
        const t = TONS[e.tom]
        const largura = e.valor > 0 ? Math.max(6, (e.valor / topo) * 100) : 0
        const anterior = i > 0 ? etapas[i - 1].valor : null
        return (
          <li key={e.nome}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="flex items-center gap-1.5 font-semibold text-[var(--adm-texto-forte)]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.forte }} />
                {e.nome}
              </span>
              <span className="text-[var(--adm-texto-suave)]">
                <strong className="text-[14px] text-[var(--adm-texto)]">{inteiro(e.valor)}</strong>
                {i > 0 ? ` · ${pct(e.valor, etapas[0].valor)}` : ''}
              </span>
            </div>
            <div className="h-[14px] overflow-hidden rounded-full bg-[#eef0f3]">
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${largura}%`, background: `linear-gradient(90deg, ${t.forte}, ${t.cor})` }} />
            </div>
            {/* Só quando a etapa cabe na anterior: pedido provável não passou pelo clique. */}
            {anterior !== null && anterior > 0 && e.valor <= anterior && (
              <p className="mt-0.5 text-right text-[10.5px] text-[var(--adm-texto-suave)]">{pct(e.valor, anterior)} da etapa anterior</p>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Barras horizontais de faturamento (verde) com pedidos confirmados/prováveis. */
function FaturamentoPorCampanha({ campanhas }: { campanhas: MetricaCampanha[] }) {
  const lista = [...campanhas].sort((a, b) => Number(b.faturamento) - Number(a.faturamento) || b.pedidos - a.pedidos).slice(0, 6)
  const maior = Math.max(1, ...lista.map((c) => Number(c.faturamento)))
  if (!lista.some((c) => Number(c.faturamento) > 0)) {
    return (
      <div className="mt-6 flex flex-col items-center gap-2 py-6 text-center">
        <BolhaIcone icone={Wallet} tom="verde" />
        <p className="text-[12.5px] text-[var(--adm-texto-suave)]">Nenhum pedido atribuído às campanhas neste período.</p>
      </div>
    )
  }
  return (
    <ul className="mt-4 space-y-3">
      {lista.map((c) => (
        <li key={c.id}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="min-w-0 truncate font-semibold text-[var(--adm-texto-forte)]">{c.nome}</span>
            <span className="flex-shrink-0 font-bold" style={{ color: TONS.verde.cor }}>{formatarReal(Number(c.faturamento))}</span>
          </div>
          <div className="flex h-[10px] overflow-hidden rounded-full bg-[#eef0f3]">
            <div className="h-full rounded-full" style={{ width: `${Number(c.faturamento) > 0 ? Math.max(4, (Number(c.faturamento) / maior) * 100) : 0}%`, backgroundColor: TONS.verde.forte }} />
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--adm-texto-suave)]">
            {contagem(c.pedidos, 'pedido', 'pedidos')}
            {c.pedidos ? ` · ${inteiro(c.pedidos_clique)} com clique, ${contagem(c.pedidos - c.pedidos_clique, 'provável', 'prováveis')}` : ''}
          </p>
        </li>
      ))}
    </ul>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/45 p-3 sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Detalhes da campanha ${campanha.nome}`}>
      <div className="flex max-h-[90vh] w-full max-w-[780px] flex-col overflow-hidden rounded-[8px] bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--adm-borda)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <BolhaIcone icone={Megaphone} tom="azul" tamanho={38} />
            <div className="min-w-0">
              <h2 className="break-words text-[15px] font-bold text-[var(--adm-texto)]">{campanha.nome}</h2>
              <p className="text-[12px] text-[var(--adm-texto-suave)]">{dataCurta(campanha.quando)} · {contagem(campanha.destinatarios, 'destinatário', 'destinatários')}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-xl font-light text-[var(--adm-texto-suave)] hover:text-[var(--adm-texto)]">×</button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Mini icone={Send} tom="cinza" titulo="Enviadas" valor={inteiro(campanha.enviadas)} />
            <Mini icone={MousePointerClick} tom="ambar" titulo="Cliques" valor={campanha.incluir_link ? inteiro(campanha.clicaram) : '—'} />
            <Mini icone={ShoppingBag} tom="azul" titulo="Pedidos" valor={inteiro(campanha.pedidos)} />
            <Mini icone={Wallet} tom="verde" titulo="Faturamento" valor={formatarReal(Number(campanha.faturamento))} />
          </div>
          <div className="mt-5">
            <Funil etapas={[
              { nome: 'Enviadas', valor: campanha.enviadas, tom: 'azul' },
              { nome: 'Entregues', valor: campanha.entregues, tom: 'ceu' },
              { nome: 'Lidas', valor: campanha.lidas, tom: 'roxo' },
              { nome: 'Clicaram', valor: campanha.clicaram, tom: 'ambar' },
              { nome: 'Pediram', valor: campanha.convertidos, tom: 'verde' },
            ]} />
          </div>
          <h3 className="mb-2 mt-5 text-[14px] font-bold text-[var(--adm-texto-forte)]">Destinatários</h3>
          {erro ? (
            <p className="text-[13px] text-[#DC2626]" role="alert">{erro}</p>
          ) : lista === null ? (
            <p className="text-[13px] text-[var(--adm-texto-suave)]">Carregando…</p>
          ) : lista.length === 0 ? (
            <p className="text-[13px] text-[var(--adm-texto-suave)]">Nenhum destinatário nesta campanha.</p>
          ) : (
            <ul className="divide-y divide-[var(--adm-borda)] rounded-[6px] border-[0.8px] border-[var(--adm-borda)]" data-testid="destinatarios">
              {lista.map((d, i) => {
                const st = STATUS_ENVIO[d.status] ?? { label: d.status, tom: 'cinza' as Tom }
                return (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[12px]">
                    <div className="min-w-0">
                      <span className="font-semibold text-[var(--adm-texto)]">{d.nome || 'Cliente'}</span>
                      <span className="ml-1.5 text-[var(--adm-texto-suave)]">{d.telefone}</span>
                      {d.erro && d.status !== 'enviado' && <span className="block text-[11px] text-[var(--adm-texto-suave)]">{d.erro}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Etiqueta tom={st.tom}>{st.label}</Etiqueta>
                      {d.entregue_em && <Etiqueta tom={d.lido_em ? 'roxo' : 'ceu'}>{d.lido_em ? 'Lida' : 'Entregue'}</Etiqueta>}
                      {d.respondeu && <Etiqueta tom="laranja">Respondeu</Etiqueta>}
                      {d.clicado_em && <Etiqueta tom="ambar">Clicou</Etiqueta>}
                      {d.pedido && (
                        <Etiqueta tom="verde">
                          Pedido #{d.pedido.numero} · {formatarReal(Number(d.pedido.total))}{d.pedido.via_clique ? '' : ' (provável)'}
                        </Etiqueta>
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

function Mini({ icone, tom, titulo, valor }: { icone: LucideIcon; tom: Tom; titulo: string; valor: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] px-3 py-2.5">
      <BolhaIcone icone={icone} tom={tom} tamanho={30} />
      <div className="min-w-0">
        <p className="truncate text-[11px] text-[var(--adm-texto-suave)]">{titulo}</p>
        <p className="truncate text-[15px] font-bold text-[var(--adm-texto)]">{valor}</p>
      </div>
    </div>
  )
}
