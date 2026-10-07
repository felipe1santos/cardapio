'use client'

import { useEffect, useMemo, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { carregarDashboard, type DadosDashboard, type PedidoDashboard } from '@/lib/queries/pedidos'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { FiltroPeriodo } from '@/components/dashboard/filtro-periodo'
import { DicaInfo } from '@/components/dashboard/dica-info'
import { CartaoFunil } from '@/components/dashboard/cartao-funil'
import { AnalisesAbas, type LinhaBairro, type LinhaProduto } from '@/components/dashboard/analises-abas'
import { LOJAS_DE_TESTE } from '@/lib/dashboard-limpeza'
import { resumoPorOrigem } from '@/lib/dashboard-origem'
import { OrigemVisitas } from '@/components/dashboard/origem-visitas'
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
  faturamentoPorOrigem,
  textoPorOrigem,
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
    <div className="flex min-w-[200px] flex-1 items-start gap-3" data-testid={`indicador-${rotulo}`}>
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

export default function DashboardPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [agora] = useState(() => Date.now())
  // Padrão: últimos 30 dias (2026-10-01). Só muda quando o usuário escolhe outro período.
  const [intervalo, setIntervalo] = useState<Intervalo>(() => intervaloDoPreset('30d', Date.now()))
  const [preset, setPreset] = useState<PresetPeriodo | null>('30d')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dados, setDados] = useState<DadosDashboard>({ pedidos: [], grupoPorItem: {} })
  const [lojaLocal, setLojaLocal] = useState('')
  const [lojaSlug, setLojaSlug] = useState('')
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
        if (loja) { setLojaLocal([loja.cep, loja.endereco].map((s) => s.trim()).filter(Boolean).join(', ')); setLojaSlug(loja.slug) }
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
    // Pedidos de TESTE ficam fora das análises das lojas reais; na loja de teste (Menuzia) continuam (item 54).
    const historico = LOJAS_DE_TESTE.has(lojaSlug) ? dados.pedidos : dados.pedidos.filter((p) => !p.teste)
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
      porOrigem: faturamentoPorOrigem(pedidos),
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
  }, [dados, intervalo, agora, temposEntrega, lojaSlug])

  const funil = useMemo(() => {
    if (vitrine === undefined) return null
    // Sem o rastreio no banco o funil aparece zerado, não como esqueleto eterno.
    if (vitrine === null) return funilDaVitrine({ funil: {}, funilAnterior: {}, porDia: [] }, diasDoIntervalo(intervalo, agora))
    const maisAntigo = vitrine.porDia.map((p) => p.dia).sort()[0]
    return funilDaVitrine(vitrine, diasDoIntervalo(intervalo, agora, maisAntigo))
  }, [vitrine, intervalo, agora])

  // Origem das visitas e dos pedidos por canal (item 55): visitas da vitrine + pedidos com origem (0149).
  const origem = useMemo(() => resumoPorOrigem(vitrine?.origens ?? [], m.pedidos), [vitrine, m.pedidos])


  // Filtro de período ÚNICO da página: o mesmo controle no topo e no cabeçalho das análises.
  const filtroPeriodo = (
    <FiltroPeriodo
      intervalo={intervalo}
      preset={preset}
      agora={agora}
      onEscolher={(novo, atalho) => {
        setIntervalo(novo)
        setPreset(atalho)
      }}
    />
  )

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

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 sm:flex-none">{filtroPeriodo}</div>
          {/* O aviso do rastreio da vitrine virou um ⓘ discreto (passar o mouse ou tocar). */}
          {vitrine !== null && (
            <DicaInfo texto="Visitas, visualizações, sacola e checkout são contadas a partir da ativação do rastreio da vitrine (23/09/2026). Cada visitante conta uma vez por etapa." />
          )}
        </div>

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
        ) : null}
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
              ajuda="Todos os canais: cardápio online (vitrine), PDV/balcão e mesas. O funil da vitrine abaixo conta só o cardápio online."
              valor={brl(m.receita)}
              rodape={textoPorOrigem(m.porOrigem, brl) || undefined}
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
              rotulo="Tempo médio na rua"
              ajuda="Da saída do motoboy até o pedido ser marcado como entregue. Se a loja marca vários pedidos como entregues de uma vez (em lote), o tempo sobe. Fora da média: testes, rotas de menos de 1 min ou de mais de 4 h e pedidos com mais de 6 h."
              valor={formatarDuracao(m.entrega?.rota ?? null)}
              rodape={
                m.entrega === null
                  ? 'Medição ainda não ativada'
                  : m.entrega.amostra
                    ? `${m.entrega.amostra} entrega${m.entrega.amostra > 1 ? 's' : ''} medida${m.entrega.amostra > 1 ? 's' : ''} · do pedido feito à entrega ${formatarDuracao(m.entrega.total)}`
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

        {/* Origem das visitas (item 55): área própria, logo acima das análises. */}
        <OrigemVisitas linhas={origem.linhas} totais={origem.totais} semOrigem={origem.semOrigem} />

        {/* Tudo de "Análise de pedidos" para baixo: um bloco só, em abas, no visual do kit (item 54). */}
        <AnalisesAbas
          dados={{
            totalPedidos: m.pedidos.length,
            novos: m.serie.reduce((t, p) => t + p.novos, 0),
            recorrentes: m.serie.reduce((t, p) => t + p.recorrentes, 0),
            receita: m.receita,
            serie: m.serie,
            rotulos: m.rotulos,
            periodos: m.serie.map((p) => new Date(p.ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })),
            canais: m.canais,
            pagamentos: m.pagamentos,
            entrega: m.entrega,
            produtos: m.produtos,
            categorias: m.categorias,
            bairros: m.bairros,
            rankingBairros: m.rankingBairros,
            pontos: m.heatPoints,
          }}
          filtro={filtroPeriodo}
          mapsKey={MAPS_KEY}
          centro={lojaLocal}
        />
      </div>
    </>
  )
}

function soma(pedidos: PedidoDashboard[]): number {
  return pedidos.reduce((s, p) => s + p.total, 0)
}
