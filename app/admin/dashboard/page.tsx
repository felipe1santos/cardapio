'use client'

import { useEffect, useMemo, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { carregarDashboard, type DadosDashboard, type PedidoDashboard } from '@/lib/queries/pedidos'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { HeatmapCard } from '@/components/dashboard/heatmap-card'
import { FiltroPeriodo } from '@/components/dashboard/filtro-periodo'
import { CartaoFunil } from '@/components/dashboard/cartao-funil'
import { GraficoLinhas } from '@/components/dashboard/grafico-linhas'
import { GraficoArea } from '@/components/dashboard/grafico-area'
import { TabelaAnalitica, type ColunaTabela } from '@/components/dashboard/tabela-analitica'
import { MiniGrafico } from '@/components/dashboard/mini-grafico'
import { ICONES } from '@/lib/icones-painel'
import {
  carregarAnalyticsVitrine,
  carregarTemposEntrega,
  type AnalyticsVitrine,
  type TempoEntrega,
} from '@/lib/queries/analytics-vitrine'
import {
  diasDoIntervalo,
  filtrarPorIntervalo,
  formatarDuracao,
  funilDaVitrine,
  intervaloAnterior,
  resumoEntrega,
  intervaloDoPreset,
  recorteDeClientes,
  serieDePedidos,
  textoVariacao,
  variacao,
  type Intervalo,
  type PresetPeriodo,
} from '@/lib/dashboard-metricas'

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

const PAY_LABEL: Record<string, string> = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' }
const PAY_COR: Record<string, string> = { pix: 'var(--adm-serie-3)', cartao: 'var(--adm-serie-1)', dinheiro: 'var(--adm-serie-2)' }
// Barras de categoria: uma cor por posição, para o cartão não virar uma coluna azul só.
const CORES_CATEGORIA = ['var(--adm-serie-1)', 'var(--adm-serie-2)', 'var(--adm-serie-3)', 'var(--adm-serie-4)', 'var(--adm-serie-5)', '#9CA3AF']

/** Cor de cada indicador: fundo claro da bolha + cor do ícone. */
const TONS = {
  verde: { fundo: '#DCFCE7', cor: '#16A34A' },
  laranja: { fundo: '#FFEDD5', cor: '#EA580C' },
  roxo: { fundo: '#F3E8FF', cor: '#9333EA' },
  azul: { fundo: '#E0F2FE', cor: '#0369A1' },
  ambar: { fundo: '#FEF3C7', cor: '#B45309' },
} as const
type Tom = keyof typeof TONS

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const brlCurto = (v: number) =>
  v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : `R$ ${Math.round(v)}`
const dataCurta = (ms: number) => new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const inteiro = (v: number) => v.toLocaleString('pt-BR')

/** Cartão branco padrão do painel: borda fina, canto de 6px, sem sombra. */
function Cartao({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex-shrink-0 rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white ${className}`}>{children}</section>
  )
}

/**
 * Indicador da faixa de resumo: ícone em bolha clara, rótulo, valor grande e a
 * variação contra o período anterior. É o formato de "Análise de tempo" da
 * referência, com as medidas que a Menuzia tem de verdade.
 */
function Indicador({
  icone,
  rotulo,
  valor,
  ajuda,
  delta,
  tom = 'roxo',
  serie,
  inverso = false,
  rodape,
}: {
  icone: string[]
  rotulo: string
  valor: string
  ajuda?: string
  delta?: number | null
  tom?: Tom
  /** Série diária para o minigráfico. */
  serie?: number[]
  /** Métrica em que CAIR é bom (tempo de espera): inverte verde e vermelho. */
  inverso?: boolean
  rodape?: string
}) {
  const texto = delta === undefined ? null : textoVariacao(delta ?? null)
  const subiu = (delta ?? 0) > 0
  const bom = inverso ? !subiu : subiu
  const t = TONS[tom]
  return (
    <div className="flex min-w-[200px] flex-1 items-start gap-3">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: t.fundo, color: t.cor }}>
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
          {icone.map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-[12.8px] text-[var(--adm-texto-medio)]" title={ajuda}>
          {rotulo}
        </p>
        <div className="mt-0.5 flex items-center gap-3">
          <p className="text-[22px] font-bold leading-tight text-[var(--adm-texto)]">{valor}</p>
          {serie && <MiniGrafico valores={serie} tendencia={delta === undefined || delta === null ? null : inverso ? -delta : delta} largura={64} altura={22} />}
        </div>
        {rodape && <p className="mt-0.5 text-[11px] text-[var(--adm-texto-suave)]">{rodape}</p>}
        {texto && (
          <p
            className={[
              'mt-0.5 flex items-center gap-1 text-[11px] font-semibold',
              bom ? 'text-[var(--adm-alta)]' : 'text-[var(--adm-baixa)]',
            ].join(' ')}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
              {(subiu ? ICONES.subindo : ICONES.caindo).map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
            {texto} vs. período anterior
          </p>
        )}
      </div>
    </div>
  )
}

/** Rosca de participação — mesma do painel antigo, agora nas cores do tema. */
function Rosca({ fatias }: { fatias: { cor: string; pct: number; nome: string }[] }) {
  const R = 52
  const C = 2 * Math.PI * R
  let offset = 0
  const visiveis = fatias.filter((f) => f.pct > 0)
  return (
    <svg viewBox="0 0 140 140" className="h-[130px] w-[130px] flex-shrink-0 -rotate-90">
      <circle cx="70" cy="70" r={R} fill="none" stroke="#eef0f3" strokeWidth="20" />
      {visiveis.map((f) => {
        const dash = (f.pct / 100) * C
        const el = (
          <circle
            key={f.nome}
            cx="70"
            cy="70"
            r={R}
            fill="none"
            stroke={f.cor}
            strokeWidth="20"
            strokeDasharray={`${dash} ${C - dash}`}
            strokeDashoffset={-offset}
          >
            <title>{`${f.nome}: ${f.pct}%`}</title>
          </circle>
        )
        offset += dash
        return el
      })}
    </svg>
  )
}

interface LinhaProduto {
  id: string
  nome: string
  pedidos: number
  quantidade: number
  receita: number
}

interface LinhaBairro {
  id: string
  bairro: string
  pedidos: number
  receita: number
  ticket: number
  participacao: number
}

export default function DashboardPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [agora] = useState(() => Date.now())
  const [intervalo, setIntervalo] = useState<Intervalo>(() => intervaloDoPreset('7d', Date.now()))
  const [preset, setPreset] = useState<PresetPeriodo | null>('7d')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dados, setDados] = useState<DadosDashboard>({ pedidos: [], grupoPorItem: {} })
  const [lojaLocal, setLojaLocal] = useState('')
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  // undefined = carregando; null = rastreio ainda não instalado no banco.
  const [vitrine, setVitrine] = useState<AnalyticsVitrine | null | undefined>(undefined)
  const [temposEntrega, setTemposEntrega] = useState<TempoEntrega[] | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (!active) return
      if (!id) {
        setError('Não encontramos uma loja vinculada ao seu usuário.')
        setLoading(false)
        return
      }
      try {
        const [dash, loja] = await Promise.all([
          carregarDashboard(supabase, id),
          buscarConfigLoja(supabase, id).catch(() => null),
        ])
        if (!active) return
        setDados(dash)
        setRestauranteId(id)
        carregarTemposEntrega(supabase, id).then((t) => active && setTemposEntrega(t))
        if (loja) setLojaLocal([loja.cep, loja.endereco].map((s) => s.trim()).filter(Boolean).join(', '))
      } catch {
        setError('Não foi possível carregar o dashboard.')
      } finally {
        setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [supabase])

  // O funil da vitrine é agregado no banco (a tabela de eventos cresce a cada
  // clique), então é buscado de novo a cada troca de período.
  useEffect(() => {
    if (!restauranteId) return
    let ativo = true
    setVitrine(undefined)
    carregarAnalyticsVitrine(supabase, intervalo).then((v) => ativo && setVitrine(v))
    return () => {
      ativo = false
    }
  }, [supabase, restauranteId, intervalo])

  const m = useMemo(() => {
    const historico = dados.pedidos
    const pedidos = filtrarPorIntervalo(historico, intervalo)
    const anteriorIntervalo = intervaloAnterior(intervalo)
    const anteriores = anteriorIntervalo ? filtrarPorIntervalo(historico, anteriorIntervalo) : []

    const receita = soma(pedidos)
    const receitaAnterior = soma(anteriores)
    const ticket = pedidos.length ? receita / pedidos.length : 0
    const ticketAnterior = anteriores.length ? receitaAnterior / anteriores.length : 0

    const clientes = recorteDeClientes(pedidos, historico, intervalo)
    const serie = serieDePedidos(pedidos, historico, intervalo, agora)
    const rotulos = serie.map((p) => dataCurta(p.ms))

    // Entregues sobre o total — a régua de operação que o painel já mostrava.
    const entregues = pedidos.filter((p) => p.status === 'entregue').length
    const conclusao = pedidos.length ? (entregues / pedidos.length) * 100 : 0
    const entreguesAnt = anteriores.filter((p) => p.status === 'entregue').length
    const conclusaoAnt = anteriores.length ? (entreguesAnt / anteriores.length) * 100 : 0

    const horas = new Array(24).fill(0)
    for (const p of pedidos) horas[new Date(p.criadoEm).getHours()]++
    const pico = horas.reduce((melhor, c, h) => (c > horas[melhor] ? h : melhor), 0)
    const horarioPico = pedidos.length ? `${pico}h – ${(pico + 1) % 24}h` : '—'

    // Tempo de entrega: só pedidos com saída e chegada carimbadas (0078).
    const entrega = temposEntrega ? resumoEntrega(temposEntrega, intervalo) : null
    const entregaAnt = temposEntrega && anteriorIntervalo ? resumoEntrega(temposEntrega, anteriorIntervalo) : null

    const itensPorPedido = pedidos.length
      ? pedidos.reduce((s, p) => s + p.itens.reduce((t, i) => t + i.quantidade, 0), 0) / pedidos.length
      : 0

    // Produtos
    const agregadoProduto = new Map<string, LinhaProduto>()
    for (const p of pedidos) {
      const vistos = new Set<string>()
      for (const i of p.itens) {
        const atual = agregadoProduto.get(i.nome) ?? { id: i.nome, nome: i.nome, pedidos: 0, quantidade: 0, receita: 0 }
        atual.quantidade += i.quantidade
        atual.receita += i.receita
        if (!vistos.has(i.nome)) {
          atual.pedidos++
          vistos.add(i.nome)
        }
        agregadoProduto.set(i.nome, atual)
      }
    }
    const produtos = [...agregadoProduto.values()]

    // Bairros
    const agregadoBairro = new Map<string, { pedidos: number; receita: number }>()
    for (const p of pedidos) {
      const bairro = p.enderecoBairro.trim()
      if (!bairro) continue
      const atual = agregadoBairro.get(bairro) ?? { pedidos: 0, receita: 0 }
      atual.pedidos++
      atual.receita += p.total
      agregadoBairro.set(bairro, atual)
    }
    const bairros: LinhaBairro[] = [...agregadoBairro.entries()].map(([bairro, v]) => ({
      id: bairro,
      bairro,
      pedidos: v.pedidos,
      receita: v.receita,
      ticket: v.pedidos ? v.receita / v.pedidos : 0,
      participacao: receita ? (v.receita / receita) * 100 : 0,
    }))

    // Pagamentos e canal
    const porPagamento: Record<string, number> = {}
    for (const p of pedidos) porPagamento[p.formaPagamento] = (porPagamento[p.formaPagamento] ?? 0) + p.total
    const pagamentos = (['pix', 'cartao', 'dinheiro'] as const).map((k) => ({
      nome: PAY_LABEL[k],
      cor: PAY_COR[k],
      pct: receita ? Math.round(((porPagamento[k] ?? 0) / receita) * 100) : 0,
      valor: porPagamento[k] ?? 0,
    }))
    const qtdEntrega = pedidos.filter((p) => p.tipo === 'entrega').length
    const canais = {
      entrega: pedidos.length ? Math.round((qtdEntrega / pedidos.length) * 100) : 0,
      retirada: pedidos.length ? Math.round(((pedidos.length - qtdEntrega) / pedidos.length) * 100) : 0,
    }

    // Categorias
    const porCategoria: Record<string, number> = {}
    for (const p of pedidos)
      for (const i of p.itens) {
        const grupo = i.itemId ? dados.grupoPorItem[i.itemId] ?? 'Sem grupo' : 'Sem grupo'
        porCategoria[grupo] = (porCategoria[grupo] ?? 0) + i.receita
      }
    const categorias = Object.entries(porCategoria)
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 6)

    // Mapa de calor
    const porEndereco: Record<string, { weight: number; rua: string; bairro: string }> = {}
    for (const p of pedidos) {
      const partes = [p.enderecoRua.trim(), p.enderecoNumero.trim(), p.enderecoBairro.trim()].filter(Boolean)
      if (!partes.length) continue
      const chave = partes.join(', ')
      porEndereco[chave] = {
        weight: (porEndereco[chave]?.weight ?? 0) + 1,
        rua: p.enderecoRua.trim(),
        bairro: p.enderecoBairro.trim(),
      }
    }
    const heatPoints = Object.entries(porEndereco).map(([address, v]) => ({
      address,
      weight: v.weight,
      rua: v.rua,
      bairro: v.bairro,
    }))

    const rankingBairros = [...bairros].sort((a, b) => b.pedidos - a.pedidos || b.receita - a.receita).slice(0, 6)

    return {
      pedidos,
      receita,
      ticket,
      entrega,
      rankingBairros,
      deltaEntrega: entrega?.rota != null && entregaAnt?.rota != null ? variacao(entrega.rota, entregaAnt.rota) : null,
      clientes,
      serie,
      rotulos,
      conclusao,
      horarioPico,
      itensPorPedido,
      produtos,
      bairros,
      pagamentos,
      canais,
      categorias,
      heatPoints,
      temAnterior: Boolean(anteriorIntervalo),
      deltaReceita: variacao(receita, receitaAnterior),
      deltaTicket: variacao(ticket, ticketAnterior),
      deltaConclusao: variacao(conclusao, conclusaoAnt),
    }
  }, [dados, intervalo, agora, temposEntrega])

  const funil = useMemo(() => {
    if (vitrine === undefined) return null
    // Sem o rastreio no banco o funil aparece zerado, não como esqueleto eterno.
    if (vitrine === null) return funilDaVitrine({ funil: {}, funilAnterior: {}, porDia: [] }, diasDoIntervalo(intervalo, agora))
    const maisAntigo = vitrine.porDia.map((p) => p.dia).sort()[0]
    return funilDaVitrine(vitrine, diasDoIntervalo(intervalo, agora, maisAntigo))
  }, [vitrine, intervalo, agora])

  const colunasProduto: ColunaTabela<LinhaProduto>[] = [
    { id: 'nome', titulo: 'Produto', valor: (l) => l.nome, destaque: true },
    { id: 'pedidos', titulo: 'Pedidos', valor: (l) => l.pedidos, alinhar: 'direita' },
    { id: 'quantidade', titulo: 'Unidades', valor: (l) => l.quantidade, alinhar: 'direita' },
    { id: 'receita', titulo: 'Receita', valor: (l) => l.receita, render: (l) => brl(l.receita), alinhar: 'direita' },
  ]

  const colunasBairro: ColunaTabela<LinhaBairro>[] = [
    { id: 'bairro', titulo: 'Bairro', valor: (l) => l.bairro, destaque: true },
    { id: 'pedidos', titulo: 'Pedidos', valor: (l) => l.pedidos, alinhar: 'direita' },
    { id: 'receita', titulo: 'Receita', valor: (l) => l.receita, render: (l) => brl(l.receita), alinhar: 'direita' },
    { id: 'ticket', titulo: 'Ticket médio', valor: (l) => l.ticket, render: (l) => brl(l.ticket), alinhar: 'direita' },
    {
      id: 'participacao',
      titulo: 'Participação',
      valor: (l) => l.participacao,
      render: (l) => `${l.participacao.toFixed(1).replace('.', ',')}%`,
      alinhar: 'direita',
    },
  ]

  const colunasClique: ColunaTabela<{ id: string; alvo: string; cliques: number; visitantes: number }>[] = [
    { id: 'alvo', titulo: 'Onde clicaram', valor: (l) => l.alvo, destaque: true },
    { id: 'cliques', titulo: 'Cliques', valor: (l) => l.cliques, alinhar: 'direita' },
    { id: 'visitantes', titulo: 'Visitantes', valor: (l) => l.visitantes, alinhar: 'direita' },
  ]
  const colunasOrigem: ColunaTabela<{ id: string; origem: string; visitas: number; pedidos: number; conversao: number }>[] = [
    { id: 'origem', titulo: 'Origem', valor: (l) => l.origem, destaque: true },
    { id: 'visitas', titulo: 'Visitas', valor: (l) => l.visitas, alinhar: 'direita' },
    { id: 'pedidos', titulo: 'Pedidos', valor: (l) => l.pedidos, alinhar: 'direita' },
    {
      id: 'conversao',
      titulo: 'Conversão',
      valor: (l) => l.conversao,
      render: (l) => `${l.conversao.toFixed(1).replace('.', ',')}%`,
      alinhar: 'direita',
    },
  ]

  const maiorCategoria = Math.max(1, ...m.categorias.map((c) => c.valor))
  const maiorBairro = Math.max(1, ...m.rankingBairros.map((b) => b.pedidos))

  if (loading) {
    return (
      <>
        <TopBar title="Dashboard" breadcrumb="Visão geral › Desempenho" />
        <div className="flex flex-1 items-center justify-center p-5 text-[13px] text-[var(--adm-texto-suave)]">
          Carregando dashboard…
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar title="Dashboard" breadcrumb="Visão geral › Desempenho" />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
        {error && (
          <div className="rounded-[6px] border-[0.8px] border-danger bg-danger-bg px-3.5 py-2.5 text-[12.8px] font-semibold text-danger">
            {error}
          </div>
        )}

        <FiltroPeriodo
          intervalo={intervalo}
          preset={preset}
          agora={agora}
          onEscolher={(novo, atalho) => {
            setIntervalo(novo)
            setPreset(atalho)
          }}
        />

        {!m.temAnterior && (
          <p className="text-[11px] text-[var(--adm-texto-suave)]">
            Em “Tudo” não há período anterior para comparar — por isso as variações não aparecem.
          </p>
        )}

        {/* Funil da vitrine: do visitante ao pedido fechado. */}
        {vitrine === null ? (
          <p className="rounded-[6px] border-[0.8px] border-[#fcd34d] bg-[var(--adm-laranja-claro)] px-3.5 py-2.5 text-[12.8px] text-[var(--adm-laranja)]">
            O rastreio da vitrine ainda não foi ativado no banco — as métricas de visitas aparecem assim que ele for ligado.
          </p>
        ) : (
          <p className="rounded-[6px] border-[0.8px] border-[#bae6fd] bg-[#f0f9ff] px-3.5 py-2.5 text-[12.8px] text-[#0369A1]">
            Visitas, visualizações, sacola e checkout são contadas a partir da ativação do rastreio da vitrine (23/09/2026). Cada visitante conta uma vez por etapa.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {funil
            ? funil.map((etapa) => <CartaoFunil key={etapa.id} etapa={etapa} />)
            : Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-[236px] animate-pulse rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white" />
              ))}
        </div>

        {/* Quanto o cliente demora entre uma etapa e a seguinte. */}
        <Cartao className="p-4">
          <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Análise de tempo</h3>
          <p className="mt-0.5 text-[12px] text-[var(--adm-texto-suave)]">Tempo médio entre as etapas do funil de conversão</p>
          <div className="mt-4 flex flex-wrap gap-6">
            <Indicador icone={ICONES.visao} tom="roxo" rotulo="Visita → Visualização" valor={formatarDuracao(vitrine?.tempos.visita_visualizacao ?? null)} />
            <Indicador icone={ICONES.sacola} tom="laranja" rotulo="Visualização → Sacola" valor={formatarDuracao(vitrine?.tempos.visualizacao_sacola ?? null)} />
            <Indicador icone={ICONES.cartao} tom="azul" rotulo="Sacola → Checkout" valor={formatarDuracao(vitrine?.tempos.sacola_checkout ?? null)} />
            <Indicador icone={ICONES.concluido} tom="verde" rotulo="Checkout → Pedido" valor={formatarDuracao(vitrine?.tempos.checkout_pedido ?? null)} />
          </div>
        </Cartao>

        {/* Faixa de resumo: dinheiro, ritmo e operação. */}
        <Cartao className="p-4">
          <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Resumo do período</h3>
          <p className="mt-0.5 text-[12px] text-[var(--adm-texto-suave)]">
            Comparado com o período anterior de mesmo tamanho
          </p>
          <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
            <Indicador
              icone={ICONES.dinheiro}
              tom="verde"
              rotulo="Faturamento"
              valor={brl(m.receita)}
              delta={m.deltaReceita}
              serie={m.serie.map((p) => p.receita)}
            />
            <Indicador
              icone={ICONES.ticket}
              tom="laranja"
              rotulo="Ticket médio"
              valor={brl(m.ticket)}
              delta={m.deltaTicket}
              serie={m.serie.map((p) => (p.total ? p.receita / p.total : 0))}
            />
            <Indicador
              icone={ICONES.entregador}
              tom="roxo"
              rotulo="Tempo médio de entrega"
              ajuda="Da saída do motoboy até a entrega confirmada"
              valor={formatarDuracao(m.entrega?.rota ?? null)}
              rodape={
                m.entrega === null
                  ? 'Medição ainda não ativada'
                  : m.entrega.amostra
                    ? `${m.entrega.amostra} entrega${m.entrega.amostra > 1 ? 's' : ''} medida${m.entrega.amostra > 1 ? 's' : ''} · pedido → porta ${formatarDuracao(m.entrega.total)}`
                    : 'Sem entregas rastreadas no período'
              }
              delta={m.deltaEntrega}
              inverso
            />
            <Indicador
              icone={ICONES.concluido}
              tom="azul"
              rotulo="Taxa de conclusão"
              valor={`${Math.round(m.conclusao)}%`}
              ajuda="Pedidos entregues sobre o total do período"
              delta={m.deltaConclusao}
            />
            <Indicador icone={ICONES.relogio} tom="ambar" rotulo="Horário de pico" valor={m.horarioPico} />
            <Indicador
              icone={ICONES.carrinho}
              tom="laranja"
              rotulo="Itens por pedido"
              valor={m.itensPorPedido.toFixed(1).replace('.', ',')}
            />
          </div>
        </Cartao>

        {/* Clientes do período. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Cartao className="p-4">
            <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Clientes no período</h3>
            <p className="mt-1 text-[12px] text-[var(--adm-texto-suave)]">
              Pessoas diferentes que pediram no recorte selecionado
            </p>
            <p className="mt-3 text-[26px] font-bold leading-none text-[var(--adm-texto)]">{inteiro(m.clientes.total)}</p>
          </Cartao>
          <Cartao className="p-4">
            <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Clientes novos</h3>
            <p className="mt-1 text-[12px] text-[var(--adm-texto-suave)]">Fizeram o primeiro pedido dentro do período</p>
            <p className="mt-3 text-[26px] font-bold leading-none text-[var(--adm-texto)]">
              {inteiro(m.clientes.novos)}{' '}
              <span className="text-[14px] font-semibold text-[var(--adm-texto-suave)]">({m.clientes.pctNovos}%)</span>
            </p>
          </Cartao>
          <Cartao className="p-4">
            <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Clientes recorrentes</h3>
            <p className="mt-1 text-[12px] text-[var(--adm-texto-suave)]">Já haviam pedido antes e voltaram</p>
            <p className="mt-3 text-[26px] font-bold leading-none text-[var(--adm-texto)]">
              {inteiro(m.clientes.recorrentes)}{' '}
              <span className="text-[14px] font-semibold text-[var(--adm-texto-suave)]">
                ({m.clientes.pctRecorrentes}%)
              </span>
            </p>
          </Cartao>
        </div>

        {/* Análise de pedidos: o gráfico de três linhas. */}
        <Cartao className="p-4">
          <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Análise de pedidos</h3>
          <div className="mt-3 flex flex-wrap gap-8">
            <div>
              <p className="text-[24px] font-bold leading-none text-[var(--adm-texto)]">{inteiro(m.pedidos.length)}</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--adm-texto-medio)]">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--adm-serie-1)]" />
                Total de pedidos
              </p>
            </div>
            <div>
              <p className="text-[24px] font-bold leading-none text-[var(--adm-texto)]">
                {inteiro(m.serie.reduce((s, p) => s + p.novos, 0))}
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--adm-texto-medio)]">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--adm-serie-2)]" />
                De clientes novos
              </p>
            </div>
            <div>
              <p className="text-[24px] font-bold leading-none text-[var(--adm-texto)]">
                {inteiro(m.serie.reduce((s, p) => s + p.recorrentes, 0))}
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--adm-texto-medio)]">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--adm-serie-3)]" />
                De clientes recorrentes
              </p>
            </div>
          </div>
          <div className="mt-4">
            <GraficoLinhas
              rotulos={m.rotulos}
              series={[
                { nome: 'Total de pedidos', cor: '#A855F7', valores: m.serie.map((p) => p.total) },
                { nome: 'Pedidos de clientes novos', cor: '#F97316', valores: m.serie.map((p) => p.novos) },
                { nome: 'Pedidos de clientes recorrentes', cor: '#10B981', valores: m.serie.map((p) => p.recorrentes) },
              ]}
            />
          </div>
        </Cartao>

        {/* Faturamento no tempo. */}
        <Cartao className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Faturamento no período</h3>
              <p className="mt-0.5 text-[12px] text-[var(--adm-texto-suave)]">Receita dos pedidos não cancelados</p>
            </div>
            <p className="text-[22px] font-bold text-[var(--adm-texto)]">{brl(m.receita)}</p>
          </div>
          <div className="mt-3">
            <GraficoArea valores={m.serie.map((p) => p.receita)} rotulos={m.rotulos} formatarValor={brlCurto} cor="#10B981" />
          </div>
        </Cartao>

        {/* Tabelas analíticas. */}
        <TabelaAnalitica
          titulo="Performance dos produtos"
          colunas={colunasProduto}
          linhas={m.produtos}
          ordemInicial="receita"
          busca={{ placeholder: 'Pesquise por um produto', texto: (l) => l.nome }}
          vazio="Nenhum produto vendido no período"
        />

        <TabelaAnalitica
          titulo="Análise por bairro"
          colunas={colunasBairro}
          linhas={m.bairros}
          ordemInicial="receita"
          busca={{ placeholder: 'Pesquise por um bairro', texto: (l) => l.bairro }}
          vazio="Nenhum pedido com endereço no período"
        />

        {/* Comportamento na vitrine. */}
        {vitrine && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <TabelaAnalitica
              titulo="Cliques na vitrine"
              colunas={colunasClique}
              linhas={vitrine.cliques.map((c) => ({ id: c.alvo, ...c }))}
              ordemInicial="cliques"
              busca={{ placeholder: 'Pesquise um botão', texto: (l) => l.alvo }}
              vazio="Nenhum clique registrado no período"
            />
            <TabelaAnalitica
              titulo="Origem das visitas"
              colunas={colunasOrigem}
              linhas={vitrine.origens.map((o) => ({
                id: o.origem,
                ...o,
                conversao: o.visitas ? (o.pedidos / o.visitas) * 100 : 0,
              }))}
              ordemInicial="visitas"
              vazio="Nenhuma visita registrada no período"
            />
          </div>
        )}

        {/* Mapa + categorias. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Cartao className="p-4 lg:col-span-2">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Onde estão seus pedidos</h3>
                <p className="mt-0.5 text-[12px] text-[var(--adm-texto-suave)]">Bolha maior = mais pedidos naquele ponto</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_220px]">
              <HeatmapCard
                apiKey={MAPS_KEY}
                center={lojaLocal}
                points={m.heatPoints}
                className="h-[320px] w-full rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)]"
              />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--adm-texto-suave)]">
                  Bairros que mais pedem
                </p>
                {m.rankingBairros.length === 0 ? (
                  <p className="mt-6 text-center text-[12px] text-[var(--adm-texto-suave)]">Sem pedidos com endereço.</p>
                ) : (
                  <ol className="mt-3 space-y-3">
                    {m.rankingBairros.map((b, i) => (
                      <li key={b.id}>
                        <div className="flex items-baseline gap-2 text-[12.8px]">
                          <span className="w-4 flex-shrink-0 text-[11px] font-bold text-[var(--adm-texto-suave)]">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate font-semibold text-[var(--adm-texto)]">{b.bairro}</span>
                          <span className="tabular-nums text-[var(--adm-texto-medio)]">{b.pedidos}</span>
                        </div>
                        <div className="ml-6 mt-1 h-1.5 overflow-hidden rounded-full bg-[#f1f2f4]">
                          <div className="h-full rounded-full bg-[#F97316]" style={{ width: `${(b.pedidos / maiorBairro) * 100}%` }} />
                        </div>
                        <p className="ml-6 mt-0.5 text-[11px] text-[var(--adm-texto-suave)]">{brl(b.receita)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </Cartao>

          <Cartao className="p-4">
            <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Faturamento por categoria</h3>
            <div className="mt-4 space-y-3">
              {m.categorias.length === 0 && (
                <p className="py-6 text-center text-[12px] text-[var(--adm-texto-suave)]">Sem dados no período.</p>
              )}
              {m.categorias.map((cat, i) => (
                <div key={cat.nome}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="font-semibold text-[var(--adm-texto)]">{cat.nome}</span>
                    <span className="tabular-nums text-[var(--adm-texto-medio)]">{brl(cat.valor)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#eef0f3]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(cat.valor / maiorCategoria) * 100}%`, backgroundColor: CORES_CATEGORIA[i % CORES_CATEGORIA.length] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Cartao>
        </div>

        {/* Pagamento e canal. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Cartao className="p-4">
            <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Formas de pagamento</h3>
            <div className="mt-4 flex flex-wrap items-center gap-6">
              <Rosca fatias={m.pagamentos} />
              <div className="space-y-2.5">
                {m.pagamentos.map((p) => (
                  <div key={p.nome} className="flex items-center gap-2 text-[12.8px]">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.cor }} />
                    <span className="font-semibold text-[var(--adm-texto)]">{p.nome}</span>
                    <span className="text-[var(--adm-texto-medio)]">
                      {p.pct}% · {brl(p.valor)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Cartao>

          <Cartao className="p-4">
            <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Entrega e retirada</h3>
            <p className="mt-0.5 text-[12px] text-[var(--adm-texto-suave)]">Participação de cada canal nos pedidos</p>
            <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-[#eef0f3]">
              <div className="h-full bg-[var(--adm-serie-2)]" style={{ width: `${m.canais.entrega}%` }} />
              <div className="h-full bg-[var(--adm-serie-1)]" style={{ width: `${m.canais.retirada}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-3 text-[12.8px]">
              <span className="flex items-center gap-2 font-semibold text-[var(--adm-texto)]">
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[var(--adm-serie-2)]" aria-hidden="true">
                  {ICONES.moto.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </svg>
                Entrega · {m.canais.entrega}%
              </span>
              <span className="flex items-center gap-2 font-semibold text-[var(--adm-texto)]">
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[var(--adm-serie-1)]" aria-hidden="true">
                  {ICONES.loja.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </svg>
                Retirada · {m.canais.retirada}%
              </span>
            </div>
          </Cartao>
        </div>
      </div>
    </>
  )
}

function soma(pedidos: PedidoDashboard[]): number {
  return pedidos.reduce((s, p) => s + p.total, 0)
}
