'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowUpFromLine, Bike, CheckCircle2, ChefHat, Clock, CreditCard, Scale, Ticket, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { ATALHOS, periodoDoAtalho, type Atalho } from '@/lib/financeiro/fluxo-regras'
import { periodoAnterior, variacaoPct } from '@/lib/financeiro/contas-regras'
import { Chip } from '../ui/blocos'
import { CORES_GRAFICO, GraficoFinanceiro, Medidor, dataCurta } from '@/components/graficos/grafico'
import { Aviso, CabecalhoSecao, Card, Destaque, FIN_COR, FiltroPeriodo, Kpi } from '@/components/graficos/kit-meta'

/**
 * Financeiro › Dashboard (Fase 6). Números do livro-caixa e do custo guardado na venda; o gráfico usa o
 * componente único (cores do Gerenciador de Eventos da Meta). Visual "estilo Meta" (item 4b): KPIs com variação
 * contra o período anterior, filtro de período com calendário, cards e medidor circular.
 * Todos os cards na mesma base (0145): só vendas que estão no livro-caixa do período. Diferenças de caixa
 * (sobras − faltas) têm card próprio e entram no lucro líquido de forma explícita — não são despesa.
 */
interface Dados {
  periodo: { de: string; ate: string; grupo: 'dia' | 'semana' | 'mes' }
  cards: {
    faturamentoBrutoCentavos: number; vendas: number; ticketMedioCentavos: number | null; pagosCentavos: number; naoPagosCentavos: number; aConferirCentavos: number
    despesasCentavos: number; sangriasCentavos: number; diferencasCaixaCentavos: number; sobrasCentavos: number; faltasCentavos: number; divergenciasCentavos: number; turnosDivergentes: number; motoboyAgoraCentavos: number
    cmvCentavos: number | null; lucroBrutoCentavos: number | null; lucroLiquidoCentavos: number | null; cmvPct: number | null; cmvAlvoPct: number; semCustoRegistrado: number | null
  }
  porOrigem: Record<string, number>; porForma: Record<string, number>
  diferencasPorTurno: { turnoId: string | null; abertoEm: string | null; fechadoEm: string | null; fechadoPorNome: string | null; diferencaCentavos: number; diferencaCartaoCentavos: number; justificativa: string | null }[]
  conciliacao: { faturamentoCentavos: number; vendas: number; itensCentavos: number; taxasCentavos: number; descontosCentavos: number; outrosCentavos: number; outroPeriodoCentavos: number; semPedidoCentavos: number }
  itens: { receitaCentavos: number; maisVendido: { nome: string; quantidade: number; receitaCentavos: number } | null; maisLucrativo: { nome: string; lucroCentavos: number; margemPct: number } | null; piorMargem: { nome: string; margemPct: number; quantidade: number } | null }
  serie: { bucket: string; faturamentoCentavos: number; despesasCentavos: number; vendas: number; lucroBrutoCentavos: number | null; metaCentavos: number | null }[]
}
const brl = (c: number | null | undefined) => (c === null || c === undefined ? '—' : formatarCentavos(c))
const brlCurto = (c: number) => (Math.abs(c) >= 100000 ? `R$ ${(c / 100000).toFixed(Math.abs(c) >= 1000000 ? 0 : 1).replace('.', ',')} mil` : formatarCentavos(c).replace(',00', ''))
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1).replace('.', ',')}%`)
const ROT_ORIGEM: Record<string, string> = { balcao: 'Balcão / PDV', mesa: 'Mesas', delivery: 'Delivery', online: 'Cardápio online', manual: 'Manual', outros: 'Outros' }
const ROT_FORMA: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', outros: 'Outros' }
const MESES_LONGOS = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.']

export function SecaoDashboard() {
  const [atalho, setAtalho] = useState<Atalho>('30d')
  const [grupo, setGrupo] = useState<'dia' | 'semana' | 'mes'>('dia')
  const [d, setD] = useState<Dados | null>(null)
  /** Mesmo dashboard no período anterior de mesmo tamanho — só para a variação ▲▼ dos indicadores. */
  const [ant, setAnt] = useState<Dados | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const p = periodoDoAtalho(atalho)
    const a = periodoAnterior(p.de, p.ate)
    const [r, ra] = await Promise.all([
      fetch(`/api/admin/financeiro/dashboard?de=${p.de}&ate=${p.ate}&grupo=${grupo}`, { cache: 'no-store' }),
      fetch(`/api/admin/financeiro/dashboard?de=${a.de}&ate=${a.ate}&grupo=${grupo}`, { cache: 'no-store' }).catch(() => null),
    ])
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErro(j.error ?? 'Não foi possível carregar.'); return }
    setErro(null); setD(j)
    setAnt(ra?.ok ? await ra.json().catch(() => null) : null)
  }, [atalho, grupo])
  useEffect(() => { void carregar() }, [carregar])

  const c = d?.cards
  const ca = ant?.cards
  const v = (k: keyof Dados['cards']) => {
    const x = c?.[k], y = ca?.[k]
    return typeof x === 'number' && typeof y === 'number' ? variacaoPct(x, y) : null
  }
  const periodoDo = (b: string) => {
    const [a, m, dd] = b.split('-').map(Number)
    if (grupo === 'mes') return `${MESES_LONGOS[m - 1]} de ${a}`
    if (grupo === 'semana') { const fim = new Date(Date.UTC(a, m - 1, dd + 6)); return `${dd} de ${MESES_LONGOS[m - 1]} a ${fim.getUTCDate()} de ${MESES_LONGOS[fim.getUTCMonth()]}` }
    return `${dd} de ${MESES_LONGOS[m - 1]} de ${a}`
  }
  const serie = d?.serie ?? []
  const media = serie.length ? Math.round(serie.reduce((s, x) => s + x.faturamentoCentavos, 0) / serie.length) : 0
  const meta = serie.find((x) => x.metaCentavos !== null)?.metaCentavos ?? null
  const totalOrigem = Object.values(d?.porOrigem ?? {}).reduce((s, v) => s + v, 0)
  const totalForma = Object.values(d?.porForma ?? {}).reduce((s, v) => s + v, 0)
  const icone = (I: typeof Wallet) => <I className="h-[15px] w-[15px]" strokeWidth={2} />

  return (
    <div className="flex flex-col gap-4" data-testid="secao-dashboard-fin">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <CabecalhoSecao grande titulo="Dashboard financeiro" subtitulo="Tudo do livro-caixa e do custo guardado na venda. Variação comparada com o período anterior de mesmo tamanho." />
        <div className="flex flex-wrap items-center gap-2">
          <FiltroPeriodo atalhos={ATALHOS} ativo={atalho} onSelecionar={setAtalho} testidPrefixo="dash-atalho" />
          <div className="flex gap-1">
            {([['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']] as const).map(([g, r]) => <Chip key={g} ativo={grupo === g} onClick={() => setGrupo(g)} testid={`dash-grupo-${g}`}>{r}</Chip>)}
          </div>
        </div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {c && d && (
        <>
          <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-4" data-testid="dash-cards">
            <Kpi icone={icone(Wallet)} rotulo="Faturamento bruto" variacao={v('faturamentoBrutoCentavos')} valor={<span data-testid="dash-faturamento" data-valor={c.faturamentoBrutoCentavos}>{brl(c.faturamentoBrutoCentavos)}</span>} />
            {c.cmvCentavos !== null && <Kpi icone={icone(ChefHat)} rotulo="CMV (custo vendido)" inverso variacao={v('cmvCentavos')} valor={<span data-testid="dash-cmv" data-valor={c.cmvCentavos}>{brl(c.cmvCentavos)}</span>} />}
            {c.lucroBrutoCentavos !== null && <Kpi icone={icone(TrendingUp)} rotulo="Lucro bruto" variacao={v('lucroBrutoCentavos')} valor={<span data-testid="dash-lucro-bruto" data-valor={c.lucroBrutoCentavos}>{brl(c.lucroBrutoCentavos)}</span>} />}
            {c.lucroLiquidoCentavos !== null && <Kpi icone={icone(CheckCircle2)} rotulo="Lucro líquido estimado" variacao={v('lucroLiquidoCentavos')}
              valor={<span data-testid="dash-lucro-liquido" data-valor={c.lucroLiquidoCentavos} style={{ color: c.lucroLiquidoCentavos < 0 ? FIN_COR.vermelho : undefined }}>{brl(c.lucroLiquidoCentavos)}</span>}
              detalhe={c.diferencasCaixaCentavos ? <span data-testid="dash-lucro-inclui-diferencas">{c.diferencasCaixaCentavos > 0 ? 'com sobra de caixa de ' : 'com falta de caixa de '}{brl(Math.abs(c.diferencasCaixaCentavos))}</span> : undefined} />}
            <Kpi icone={icone(Ticket)} rotulo={`Ticket médio (${c.vendas} vendas)`} variacao={v('ticketMedioCentavos')} valor={<span data-testid="dash-ticket" data-valor={c.ticketMedioCentavos ?? ''}>{brl(c.ticketMedioCentavos)}</span>} />
            <Kpi icone={icone(CreditCard)} rotulo="Pagos" variacao={v('pagosCentavos')} valor={<span data-testid="dash-pagos" data-valor={c.pagosCentavos}>{brl(c.pagosCentavos)}</span>} />
            <Kpi icone={icone(AlertTriangle)} rotulo="Não pagos (a receber)" inverso variacao={v('naoPagosCentavos')} valor={<span data-testid="dash-nao-pagos" data-valor={c.naoPagosCentavos}>{brl(c.naoPagosCentavos)}</span>} />
            <Kpi icone={icone(Clock)} rotulo="Pix a conferir" valor={<span data-testid="dash-a-conferir" data-valor={c.aConferirCentavos}>{brl(c.aConferirCentavos)}</span>} />
            <Kpi icone={icone(TrendingDown)} rotulo="Despesas" inverso variacao={v('despesasCentavos')} valor={<span data-testid="dash-despesas" data-valor={c.despesasCentavos}>{brl(c.despesasCentavos)}</span>} />
            <Kpi icone={icone(ArrowUpFromLine)} rotulo="Sangrias e retiradas" valor={<span data-testid="dash-sangrias" data-valor={c.sangriasCentavos}>{brl(c.sangriasCentavos)}</span>} />
            <Kpi icone={icone(Scale)}
              rotulo={`Diferenças de caixa (${d.diferencasPorTurno.length} turno${d.diferencasPorTurno.length === 1 ? '' : 's'})`}
              valor={<span data-testid="dash-diferencas-caixa" data-valor={c.diferencasCaixaCentavos} style={{ color: c.diferencasCaixaCentavos < 0 ? FIN_COR.vermelho : undefined }}>{brl(c.diferencasCaixaCentavos)}</span>}
              detalhe={c.sobrasCentavos || c.faltasCentavos ? `sobras ${brl(c.sobrasCentavos)} · faltas ${brl(c.faltasCentavos)}` : undefined} />
            <Kpi icone={icone(Bike)} rotulo="Dinheiro com motoboy (agora)" valor={<span data-testid="dash-motoboy" data-valor={c.motoboyAgoraCentavos}>{brl(c.motoboyAgoraCentavos)}</span>} />
          </div>

          <Card testid="dash-evolucao"
            titulo={`Evolução ${grupo === 'dia' ? 'diária' : grupo === 'semana' ? 'semanal' : 'mensal'}`}
            subtitulo={`Faturamento${c.lucroBrutoCentavos !== null ? ', lucro bruto' : ''} e despesas por ${grupo === 'mes' ? 'mês' : grupo}.`}>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <GraficoFinanceiro testid="dash-grafico" rotulos={serie.map((s) => (grupo === 'mes' ? dataCurta(s.bucket).split(' ')[0] : dataCurta(s.bucket)))} periodos={serie.map((s) => periodoDo(s.bucket))}
                  formatar={brl} formatarEixo={brlCurto}
                  series={[
                    { nome: 'Faturamento', tipo: 'linha', cor: 1, secao: 'Vendas', valores: serie.map((s) => s.faturamentoCentavos) },
                    ...(c.lucroBrutoCentavos !== null ? [{ nome: 'Lucro bruto', tipo: 'linha' as const, cor: 2 as const, secao: 'Vendas', valores: serie.map((s) => s.lucroBrutoCentavos) }] : []),
                    { nome: 'Despesas', tipo: 'barra', secao: 'Saídas', valores: serie.map((s) => s.despesasCentavos) },
                  ]}
                  metas={[...(meta !== null ? [{ valor: meta, rotulo: 'Meta', estilo: 'solida' as const }] : []), { valor: media, rotulo: 'Média do período', estilo: 'tracejada' as const }]} />
              </div>
              {c.cmvPct !== null && (
                <div className="flex flex-shrink-0 flex-col items-center gap-2 lg:w-[220px] lg:border-l lg:border-[#E4E7EA] lg:pl-5">
                  <Medidor valor={Math.min(100, c.cmvPct)} alerta={c.cmvPct > c.cmvAlvoPct} rotulo={`Meta <= ${c.cmvAlvoPct.toFixed(0)}%`} texto={pct(c.cmvPct)} testid="dash-medidor-cmv" />
                  <p className="text-center text-[13px] leading-[18px]" style={{ color: FIN_COR.texto2 }}>CMV do faturamento: quanto do que entrou foi custo do que foi vendido.</p>
                </div>
              )}
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card testid="dash-origem" titulo="Vendas por origem">
              {Object.entries(d.porOrigem).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Barra key={k} rotulo={ROT_ORIGEM[k] ?? k} valor={v} total={totalOrigem} />)}
              {!totalOrigem && <p className="text-[13px]" style={{ color: FIN_COR.texto2 }}>Sem vendas no período.</p>}
            </Card>
            <Card testid="dash-forma" titulo="Formas de pagamento">
              {Object.entries(d.porForma).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Barra key={k} rotulo={ROT_FORMA[k] ?? k} valor={v} total={totalForma} />)}
              {!totalForma && <p className="text-[13px]" style={{ color: FIN_COR.texto2 }}>Sem vendas no período.</p>}
            </Card>
            <Card testid="dash-itens" titulo="Produtos">
              <Item rotulo="Mais vendido" testid="dash-mais-vendido" nome={d.itens.maisVendido?.nome} detalhe={d.itens.maisVendido ? `${d.itens.maisVendido.quantidade.toLocaleString('pt-BR')} un · ${brl(d.itens.maisVendido.receitaCentavos)}` : null} />
              {c.cmvCentavos !== null || d.itens.maisLucrativo ? (
                <>
                  <Item rotulo="Mais lucrativo" testid="dash-mais-lucrativo" nome={d.itens.maisLucrativo?.nome} detalhe={d.itens.maisLucrativo ? `lucro ${brl(d.itens.maisLucrativo.lucroCentavos)} · margem ${pct(d.itens.maisLucrativo.margemPct)}` : 'Sem custo registrado'} />
                  <Item rotulo="Pior margem" testid="dash-pior-margem" nome={d.itens.piorMargem?.nome} detalhe={d.itens.piorMargem ? `margem ${pct(d.itens.piorMargem.margemPct)}` : 'Sem custo registrado'} alerta />
                </>
              ) : null}
              {c.semCustoRegistrado ? <p className="mt-2 text-[12.5px]" style={{ color: FIN_COR.texto2 }}>{c.semCustoRegistrado} item(ns) vendido(s) sem custo registrado.</p> : null}
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Conciliacao c={d.conciliacao} />
            <DiferencasPorTurno turnos={d.diferencasPorTurno} total={c.diferencasCaixaCentavos} />
          </div>
        </>
      )}
    </div>
  )
}

/** De onde vem o faturamento: itens vendidos + taxas − descontos (+ o que não é de item). Sempre fecha. */
function Conciliacao({ c }: { c: Dados['conciliacao'] }) {
  const linhas: [string, number, string][] = [
    ['Produtos vendidos', c.itensCentavos, 'itens'],
    ['Taxas (entrega e outras)', c.taxasCentavos, 'taxas'],
    ['Descontos', -c.descontosCentavos, 'descontos'],
    ['Serviço, gorjeta e pagamentos parciais', c.outrosCentavos, 'outros'],
    ['Recebido de vendas de outro período', c.outroPeriodoCentavos, 'outro-periodo'],
    ['Vendas lançadas sem pedido', c.semPedidoCentavos, 'sem-pedido'],
  ]
  return (
    <Card testid="dash-conciliacao" titulo="Do que é feito o faturamento" subtitulo={`${c.vendas} venda${c.vendas === 1 ? '' : 's'} do livro-caixa no período`}>
      {linhas.filter(([, v], i) => v !== 0 || i < 3).map(([rot, v, id]) => (
        <div key={id} className="flex justify-between gap-3 border-b border-border py-1.5 text-[12.5px] last:border-b-0">
          <span>{rot}</span><b className="whitespace-nowrap" data-testid={`dash-conc-${id}`} data-valor={v}>{brl(v)}</b>
        </div>
      ))}
      <div className="mt-3">
        <Destaque titulo={<span className="flex justify-between gap-3"><span>Faturamento</span><span className="whitespace-nowrap" data-testid="dash-conc-faturamento" data-valor={c.faturamentoCentavos}>{brl(c.faturamentoCentavos)}</span></span>}>
          <p className="text-[12.5px]" style={{ color: FIN_COR.texto2 }}>A soma das linhas acima fecha com o faturamento do livro-caixa.</p>
        </Destaque>
      </div>
    </Card>
  )
}

const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

/** Sobra (+) ou falta (−) de cada turno fechado no período. É a mesma linha "Diferenças de caixa" do DRE. */
function DiferencasPorTurno({ turnos, total }: { turnos: Dados['diferencasPorTurno']; total: number }) {
  return (
    <Card testid="dash-diferencas-turnos" titulo="Diferenças de caixa por turno" subtitulo="Sobras − faltas no fechamento (dinheiro). Não é despesa: entra à parte no lucro líquido.">
      {turnos.length === 0 && <p className="text-[13px]" style={{ color: FIN_COR.texto2 }}>Nenhuma diferença no período.</p>}
      {turnos.map((t) => (
        <div key={t.turnoId ?? 'sem-turno'} className="flex items-start justify-between gap-3 border-b border-border py-1.5 text-[12.5px] last:border-b-0" data-testid="dash-diferenca-turno">
          <div className="min-w-0">
            <p className="font-semibold">Fechado {dataHora(t.fechadoEm)}{t.fechadoPorNome ? ` por ${t.fechadoPorNome}` : ''}</p>
            {t.justificativa && <p className="line-clamp-2 break-words text-[11.5px] text-text-subtle">{t.justificativa}</p>}
            {t.diferencaCartaoCentavos ? <p className="text-[11.5px] text-text-subtle">Cartão (só informativo): {brl(t.diferencaCartaoCentavos)}</p> : null}
          </div>
          <b className="whitespace-nowrap" style={{ color: t.diferencaCentavos < 0 ? FIN_COR.vermelho : FIN_COR.verde }} data-valor={t.diferencaCentavos}>
            {t.diferencaCentavos > 0 ? 'sobra ' : 'falta '}{brl(Math.abs(t.diferencaCentavos))}
          </b>
        </div>
      ))}
      {turnos.length > 0 && (
        <div className="mt-1 flex justify-between gap-3 pt-1.5 text-[14px] font-bold"><span>Total (sobras − faltas)</span><span className="whitespace-nowrap">{brl(total)}</span></div>
      )}
    </Card>
  )
}

function Barra({ rotulo, valor, total }: { rotulo: string; valor: number; total: number }) {
  const p = total > 0 ? Math.max(0, (valor / total) * 100) : 0
  return (
    <div className="mb-2">
      <div className="flex justify-between gap-2 text-[13px]"><span style={{ color: FIN_COR.texto }}>{rotulo}</span><b className="whitespace-nowrap">{brl(valor)} <span className="font-normal" style={{ color: FIN_COR.texto2 }}>{p.toFixed(0)}%</span></b></div>
      <div className="mt-1.5 h-[8px] rounded-full" style={{ background: CORES_GRAFICO.trilho }}><div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${p}%`, background: CORES_GRAFICO.serie1 }} /></div>
    </div>
  )
}

function Item({ rotulo, nome, detalhe, alerta, testid }: { rotulo: string; nome?: string | null; detalhe: string | null; alerta?: boolean; testid?: string }) {
  return (
    <div className="mb-2 border-b border-border pb-2 last:border-b-0" data-testid={testid}>
      <p className="text-[12px] font-semibold" style={{ color: FIN_COR.texto2 }}>{rotulo}</p>
      <p className="text-[14.5px] font-bold" style={{ color: alerta && nome ? CORES_GRAFICO.medidorAlerta : FIN_COR.texto }}>{nome ?? '—'}</p>
      {detalhe && <p className="text-[12.5px]" style={{ color: FIN_COR.texto2 }}>{detalhe}</p>}
    </div>
  )
}
