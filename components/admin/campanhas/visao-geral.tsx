'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, Clock3, DollarSign, History, Repeat, Send, ShoppingBag, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatarReal } from '@/lib/moeda'
import { Ajuda, IlustracaoVazio, Paginacao, SeloStatusCampanha, formatarDataHora } from './comum'

/**
 * Visão geral das campanhas (repaginação 2026-10). Números vêm de `campanhas_visao_geral`
 * (0129): atribuição pelo mesmo telefone até 72 h depois do envio. Leitura e clique só
 * aparecem quando existem de verdade — sem rastreio, "Indisponível", nunca um número inventado.
 */

interface Totais {
  receita: number; pedidos: number; contatos: number; recorrentes: number; recuperados: number
  tentados: number; enviadas: number; leitura_rastreada: boolean; lidas: number; enviadas_rastreadas: number
  com_link: number; clicaram: number; minutos_para_pedir: number | null
}
interface Envio { id: string; nome: string; status: string; quando: string; contatos: number; enviadas: number; lidas: number; com_retorno: number; pedidos: number; convertidos: number; receita: number; imagem_url: string | null }
interface Dados { totais: Totais; serie: { dia: string; enviadas: number; pedidos: number; receita: number }[]; envios: Envio[] }

const DIA = 86_400_000
function inicioDoDia(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function fimDoDia(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }
function paraCampo(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function deCampo(s: string) { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d) }
const dataCurta = (d: Date) => d.toLocaleDateString('pt-BR')
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '0%')

function tempoLegivel(min: number | null): string {
  if (min === null || min === undefined) return '—'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h} h ${m} min` : `${h} h`
}

type Coluna = 'quando' | 'nome' | 'status' | 'contatos' | 'enviadas' | 'leitura' | 'conversao' | 'receita'

export function VisaoGeral({ onDisparar, detalhado }: { onDisparar: () => void; detalhado: React.ReactNode }) {
  const [periodo, setPeriodo] = useState(() => ({ de: inicioDoDia(new Date(Date.now() - 29 * DIA)), ate: fimDoDia(new Date()) }))
  const [calendario, setCalendario] = useState(false)
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({ col: 'quando', desc: true })
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState(10)
  const [serie, setSerie] = useState<'receita' | 'pedidos' | 'enviadas'>('receita')
  const [verDetalhado, setVerDetalhado] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const r = await fetch(`/api/admin/campanhas/visao-geral?de=${periodo.de.toISOString()}&ate=${periodo.ate.toISOString()}`, { cache: 'no-store' })
    const j = await r.json().catch(() => null)
    if (!r.ok) { setErro(j?.error ?? 'Não foi possível carregar.'); setDados(null) } else { setErro(null); setDados(j) }
    setCarregando(false)
    setPagina(0)
  }, [periodo])
  useEffect(() => { void carregar() }, [carregar])

  const dias = Math.round((inicioDoDia(periodo.ate).getTime() - periodo.de.getTime()) / DIA) + 1
  const mover = (sentido: -1 | 1) => setPeriodo((p) => ({ de: new Date(p.de.getTime() + sentido * dias * DIA), ate: new Date(p.ate.getTime() + sentido * dias * DIA) }))
  const futuro = periodo.ate.getTime() >= fimDoDia(new Date()).getTime()

  const t = dados?.totais
  const envios = useMemo(() => {
    const lista = [...(dados?.envios ?? [])]
    const valor = (e: Envio): number | string => {
      switch (ordem.col) {
        case 'quando': return e.quando
        case 'nome': return e.nome.toLowerCase()
        case 'status': return e.status
        case 'contatos': return e.contatos
        case 'enviadas': return e.enviadas
        case 'leitura': return e.enviadas ? e.lidas / e.enviadas : 0
        case 'conversao': return e.enviadas ? e.convertidos / e.enviadas : 0
        case 'receita': return Number(e.receita)
      }
    }
    lista.sort((a, b) => { const x = valor(a), y = valor(b); const c = x < y ? -1 : x > y ? 1 : 0; return ordem.desc ? -c : c })
    return lista
  }, [dados, ordem])
  const visiveis = envios.slice(pagina * porPagina, (pagina + 1) * porPagina)

  const Th = ({ col, children, alinhar = 'left' }: { col: Coluna; children: React.ReactNode; alinhar?: 'left' | 'right' }) => (
    <th className={`px-4 py-3 ${alinhar === 'right' ? 'text-right' : ''}`}>
      <button type="button" className={`inline-flex items-center gap-1 font-semibold hover:text-[#0688d4] ${ordem.col === col ? 'text-[#1f2937]' : ''}`} onClick={() => { setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : true })); setPagina(0) }} data-testid={`ordenar-${col}`}>
        {children}
        {ordem.col === col && (ordem.desc ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />)}
      </button>
    </th>
  )

  return (
    <div className="space-y-4" data-testid="visao-geral">
      {/* Período */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-[#5b6472]">Resultados das mensagens enviadas no período. Pedido conta para o envio quando o mesmo telefone pede em até 72 h.</p>
        <div className="relative flex items-center gap-1" data-testid="filtro-periodo">
          <button type="button" className="campanha-seta border border-[#d6dae1] bg-white" onClick={() => mover(-1)} aria-label="Período anterior" data-testid="periodo-anterior"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setCalendario((v) => !v)} className="inline-flex h-[34px] items-center gap-2 rounded-[5px] border border-[#d6dae1] bg-white px-3 text-[13px] font-semibold text-[#1f2937] hover:border-[#0688d4]" data-testid="periodo-rotulo">
            <CalendarDays className="h-4 w-4 text-[#0688d4]" />
            {dataCurta(periodo.de)} – {dataCurta(periodo.ate)}
          </button>
          <button type="button" className="campanha-seta border border-[#d6dae1] bg-white" onClick={() => mover(1)} disabled={futuro} aria-label="Próximo período" data-testid="periodo-proximo"><ChevronRight className="h-4 w-4" /></button>
          {calendario && (
            <div className="absolute right-0 top-[40px] z-30 w-[290px] rounded-[8px] border border-[#e5e7eb] bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.16)]" data-testid="calendario">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {[7, 30, 90].map((n) => (
                  <button key={n} type="button" className="h-8 rounded-[5px] border border-[#d6dae1] px-2.5 text-[12px] font-semibold text-[#374151] hover:border-[#0688d4] hover:text-[#0688d4]"
                    onClick={() => { setPeriodo({ de: inicioDoDia(new Date(Date.now() - (n - 1) * DIA)), ate: fimDoDia(new Date()) }); setCalendario(false) }}>
                    Últimos {n} dias
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11.5px] font-semibold text-[#5b6472]">
                <label className="space-y-1">De<input type="date" className="campanha-data w-full" value={paraCampo(periodo.de)} max={paraCampo(periodo.ate)} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, de: inicioDoDia(deCampo(e.target.value)) }))} data-testid="periodo-de" /></label>
                <label className="space-y-1">Até<input type="date" className="campanha-data w-full" value={paraCampo(periodo.ate)} min={paraCampo(periodo.de)} onChange={(e) => e.target.value && setPeriodo((p) => ({ ...p, ate: fimDoDia(deCampo(e.target.value)) }))} data-testid="periodo-ate" /></label>
              </div>
            </div>
          )}
        </div>
      </div>

      {erro && <p className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">{erro}</p>}

      {/* Cartões de métrica */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 [&>*:first-child]:col-span-2 sm:[&>*:first-child]:col-span-1" data-carregando={carregando ? 'sim' : 'nao'}>
        <Metrica icone={DollarSign} tom="verde" rotulo="Receita gerada" ajuda="Soma dos pedidos (não cancelados) feitos pelo mesmo telefone em até 72 h depois de receber a mensagem." valor={t ? formatarReal(Number(t.receita)) : '—'} testid="m-receita" />
        <Metrica icone={ShoppingBag} tom="laranja" rotulo="Quantidade de pedidos" ajuda="Pedidos atribuídos às mensagens (mesmo telefone, até 72 h depois)." valor={t ? String(t.pedidos) : '—'} testid="m-pedidos" />
        <Metrica icone={Users} tom="azul" rotulo="Contatos impactados" ajuda="Telefones diferentes que receberam pelo menos uma mensagem no período." valor={t ? String(t.contatos) : '—'} testid="m-contatos" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metrica icone={Repeat} tom="ceu" rotulo="Pedidos de clientes recorrentes" ajuda="Pedidos atribuídos de quem já tinha pedido nos 30 dias antes da mensagem." valor={t ? String(t.recorrentes) : '—'} testid="m-recorrentes" />
        <Metrica icone={History} tom="roxo" rotulo="Pedidos de clientes recuperados" ajuda="Pedidos atribuídos de quem estava há 30 dias ou mais sem pedir." valor={t ? String(t.recuperados) : '—'} testid="m-recuperados" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-[#e5e7eb] bg-[#e5e7eb] lg:grid-cols-4">
        <Indicador rotulo="Envios com sucesso" ajuda="Mensagens que o WhatsApp aceitou, sobre as tentadas (enviadas + falhas)." valor={t ? `${t.enviadas} de ${t.tentados}` : '—'} extra={t && t.tentados ? pct(t.enviadas, t.tentados) : undefined} testid="m-sucesso" />
        <Indicador rotulo="Taxa de leitura" ajuda="Lidas sobre enviadas. Só existe quando o WhatsApp devolve a confirmação de leitura." valor={!t ? '—' : t.leitura_rastreada ? pct(t.lidas, t.enviadas_rastreadas) : 'Indisponível'} indisponivel={!!t && !t.leitura_rastreada} testid="m-leitura" />
        <Indicador rotulo="Taxa de cliques (CTR)" ajuda="Quem tocou no link do cardápio, sobre quem recebeu mensagem com link." valor={!t ? '—' : t.com_link > 0 ? pct(t.clicaram, t.com_link) : 'Indisponível'} indisponivel={!!t && t.com_link === 0} testid="m-cliques" />
        <Indicador rotulo="Tempo médio para pedir" ajuda="Tempo entre a mensagem e o pedido atribuído." valor={t ? tempoLegivel(t.minutos_para_pedir) : '—'} icone={Clock3} testid="m-tempo" />
      </div>

      {/* Gráficos */}
      {dados && dados.envios.length > 0 && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
          <section className="campanha-cartao rounded-[6px] border border-[#e5e7eb] bg-white p-4 xl:col-span-3" data-testid="grafico-dias">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[14px] font-bold text-[#1f2937]">Resultado por dia</h3>
              <div className="flex rounded-[5px] border border-[#d6dae1] p-0.5">
                {(['receita', 'pedidos', 'enviadas'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSerie(s)} className={`h-7 rounded-[4px] px-2.5 text-[12px] font-semibold ${serie === s ? 'bg-[#0688d4] text-white' : 'text-[#5b6472] hover:text-[#1f2937]'}`}>
                    {s === 'receita' ? 'Receita' : s === 'pedidos' ? 'Pedidos' : 'Envios'}
                  </button>
                ))}
              </div>
            </div>
            <BarrasDias serie={dados.serie} campo={serie} />
          </section>
          <section className="campanha-cartao rounded-[6px] border border-[#e5e7eb] bg-white p-4 xl:col-span-2" data-testid="grafico-campanhas">
            <h3 className="mb-3 text-[14px] font-bold text-[#1f2937]">Receita por campanha</h3>
            <BarrasCampanhas envios={dados.envios} />
          </section>
        </div>
      )}

      {/* Envios */}
      <section className="overflow-hidden rounded-[6px] border border-[#e5e7eb] bg-white">
        {dados && dados.envios.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center" data-testid="vazio-envios">
            <IlustracaoVazio />
            <p className="mt-3 text-[15px] font-semibold text-[#374151]">Nenhum envio neste período</p>
            <p className="mt-1 text-[12.5px] text-[#5b6472]">Mude o período nas setas acima ou dispare uma mensagem para seus clientes.</p>
            <button type="button" onClick={onDisparar} className="mt-4 inline-flex h-10 items-center gap-2 rounded-[5px] bg-[#0688d4] px-4 text-[13px] font-semibold text-white hover:bg-[#0570ae]"><Send className="h-4 w-4" /> Disparar mensagem</button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left text-[13px]" data-testid="tabela-envios">
                <thead className="border-b border-[#e5e7eb] bg-[#f9fafb] text-[12px] text-[#5b6472]">
                  <tr>
                    <Th col="quando">Data do envio</Th><Th col="nome">Título do envio</Th><Th col="status">Status</Th>
                    <Th col="contatos" alinhar="right">Contatos</Th><Th col="enviadas" alinhar="right">Enviadas</Th><Th col="leitura" alinhar="right">Leitura</Th>
                    <Th col="conversao" alinhar="right">Conversão</Th><Th col="receita" alinhar="right">Receita gerada</Th>
                  </tr>
                </thead>
                <tbody>
                  {carregando && !dados && <tr><td colSpan={8} className="px-4 py-8 text-center text-[#5b6472]">Carregando…</td></tr>}
                  {visiveis.map((e) => (
                    <tr key={e.id} className="campanha-linha border-b border-[#f0f1f3] last:border-0" data-testid="linha-envio">
                      <td className="whitespace-nowrap px-4 py-3 text-[#374151]">{formatarDataHora(e.quando)}</td>
                      <td className="max-w-[240px] truncate px-4 py-3 font-semibold text-[#1f2937]" title={e.nome}>{e.nome}</td>
                      <td className="px-4 py-3"><SeloStatusCampanha status={e.status} /></td>
                      <td className="px-4 py-3 text-right tabular-nums">{e.contatos}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{e.enviadas}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{e.com_retorno > 0 ? pct(e.lidas, e.enviadas) : <span className="text-[#9ca3af]" title="O WhatsApp não devolveu leitura para esta campanha">Indisponível</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{pct(e.convertidos, e.enviadas)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#15803d]">{formatarReal(Number(e.receita))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {envios.length > 0 && <Paginacao total={envios.length} pagina={pagina} porPagina={porPagina} onPagina={setPagina} onPorPagina={setPorPagina} />}
          </>
        )}
      </section>

      <div>
        <button type="button" className="text-[12.5px] font-semibold text-[#0688d4] hover:underline" onClick={() => setVerDetalhado((v) => !v)} data-testid="ver-detalhado">
          {verDetalhado ? 'Esconder o relatório detalhado' : 'Ver relatório detalhado (entregues, respostas, falhas e destinatários)'}
        </button>
        {verDetalhado && <div className="mt-3">{detalhado}</div>}
      </div>
    </div>
  )
}

const TOM: Record<string, { fundo: string; cor: string }> = {
  verde: { fundo: '#DCFCE7', cor: '#16A34A' }, laranja: { fundo: '#FFEDD5', cor: '#EA580C' }, azul: { fundo: '#E0F2FE', cor: '#0688D4' },
  ceu: { fundo: '#E0F7FA', cor: '#0891B2' }, roxo: { fundo: '#F3E8FF', cor: '#9333EA' },
}

function Metrica({ icone: Icone, tom, rotulo, ajuda, valor, testid }: { icone: LucideIcon; tom: keyof typeof TOM; rotulo: string; ajuda: string; valor: string; testid: string }) {
  const c = TOM[tom]
  return (
    <div className="campanha-cartao flex items-center gap-3 rounded-[6px] border border-[#e5e7eb] bg-white px-3 py-3 sm:gap-3.5 sm:px-4 sm:py-4" data-testid={testid}>
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12" style={{ backgroundColor: c.fundo, color: c.cor }}><Icone className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.2} /></span>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[12px] leading-tight text-[#5b6472] sm:text-[12.5px]">{rotulo}<Ajuda texto={ajuda} /></div>
        <div className="mt-0.5 truncate text-[18px] sm:text-[20px] font-bold text-[#1f2937] tabular-nums" data-valor>{valor}</div>
      </div>
    </div>
  )
}

function Indicador({ rotulo, ajuda, valor, extra, indisponivel, testid }: { rotulo: string; ajuda: string; valor: string; extra?: string; indisponivel?: boolean; icone?: LucideIcon; testid: string }) {
  return (
    <div className="bg-white px-4 py-3.5" data-testid={testid}>
      <div className="flex items-center gap-1 text-[12.5px] text-[#5b6472]">{rotulo}<Ajuda texto={ajuda} /></div>
      <div className={`mt-0.5 text-[17px] font-bold tabular-nums ${indisponivel ? 'text-[#9ca3af]' : 'text-[#1f2937]'}`} data-valor>
        {valor}
        {extra && <span className="ml-1.5 text-[12px] font-semibold text-[#15803d]">{extra}</span>}
      </div>
    </div>
  )
}

function BarrasDias({ serie, campo }: { serie: Dados['serie']; campo: 'receita' | 'pedidos' | 'enviadas' }) {
  const valores = serie.map((s) => Number(s[campo]))
  const max = Math.max(1, ...valores)
  const W = 640, H = 180, base = 156
  const passo = W / Math.max(1, serie.length)
  const larg = Math.max(3, Math.min(28, passo * 0.62))
  const rotular = serie.length <= 16
  const fmt = (v: number) => (campo === 'receita' ? formatarReal(v) : String(v))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[190px] w-full" role="img" aria-label="Gráfico por dia">
      {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1="0" x2={W} y1={base - f * 130} y2={base - f * 130} stroke="#eef0f3" />)}
      <line x1="0" x2={W} y1={base} y2={base} stroke="#d6dae1" />
      {serie.map((s, i) => {
        const v = Number(s[campo])
        const h = (v / max) * 130
        const x = i * passo + (passo - larg) / 2
        const d = new Date(`${s.dia}T12:00:00`)
        return (
          <g key={s.dia}>
            <rect x={x} y={base - h} width={larg} height={Math.max(h, v > 0 ? 2 : 0)} rx="3" fill="#2779bd"><title>{`${d.toLocaleDateString('pt-BR')}: ${fmt(v)}`}</title></rect>
            {rotular && v > 0 && <text x={x + larg / 2} y={base - h - 4} textAnchor="middle" fontSize="10" fill="#374151">{campo === 'receita' ? Math.round(v).toLocaleString('pt-BR') : v}</text>}
            {(rotular || i % Math.ceil(serie.length / 10) === 0) && <text x={x + larg / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#6b7280">{`${d.getDate()}/${d.getMonth() + 1}`}</text>}
          </g>
        )
      })}
    </svg>
  )
}

/** Barras horizontais (estilo da referência 144019): receita das campanhas que mais venderam. */
function BarrasCampanhas({ envios }: { envios: Envio[] }) {
  const top = envios.filter((e) => Number(e.receita) > 0).sort((a, b) => Number(b.receita) - Number(a.receita)).slice(0, 6)
  const max = Math.max(1, ...top.map((e) => Number(e.receita)))
  if (top.length === 0) return <p className="py-10 text-center text-[12.5px] text-[#5b6472]">Nenhuma campanha gerou pedido no período.</p>
  return (
    <ul className="space-y-2.5">
      {top.map((e) => (
        <li key={e.id}>
          <div className="mb-1 truncate text-[12px] text-[#374151]" title={e.nome}>{e.nome}</div>
          <div className="flex items-center gap-2">
            <div className="h-[18px] rounded-[4px] bg-[#2779bd] transition-[width] duration-300" style={{ width: `${Math.max(2, (Number(e.receita) / max) * 72)}%` }} />
            <span className="whitespace-nowrap text-[12px] font-semibold tabular-nums text-[#1f2937]">{formatarReal(Number(e.receita))}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
