'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Abas, Card, FIN_BTN, FIN_COR, Kpi, SeloMeta } from '@/components/graficos/kit-meta'
import { CORES_GRAFICO, GraficoFinanceiro, Medidor } from '@/components/graficos/grafico'
import { TabelaAnalitica, type ColunaTabela } from '@/components/dashboard/tabela-analitica'
import { MapaPedidos, type PontoMapa } from '@/components/dashboard/mapa-pedidos'
import { formatarDuracao } from '@/lib/dashboard-metricas'
import { ROTULO_TIPO_CLIQUE, organizarCliques, type CliqueClassificado } from '@/lib/dashboard-limpeza'

/**
 * Dashboard geral › análises em abas (item 54, 2026-10-04). Tudo o que ficava de "Análise de pedidos" para
 * baixo, agora num bloco só, no visual do kit do financeiro (components/graficos). Só visual e organização: os
 * números chegam prontos da página (mesmo cálculo de antes). A aba fica na URL (?aba=…) e o "voltar" do
 * navegador funciona. O período é o filtro único da página (o mesmo controle aparece no cabeçalho do bloco).
 */
export type AbaAnalise = 'pedidos' | 'entrega' | 'bairros' | 'produtos' | 'cliques'
const ABAS: [AbaAnalise, string][] = [['pedidos', 'Pedidos'], ['entrega', 'Entrega'], ['bairros', 'Bairros'], ['produtos', 'Produtos e categorias'], ['cliques', 'Cliques da vitrine']]

export interface LinhaProduto { id: string; nome: string; pedidos: number; quantidade: number; receita: number }
export interface LinhaBairro { id: string; bairro: string; pedidos: number; receita: number; ticket: number; participacao: number }
export interface DadosAnalises {
  totalPedidos: number
  novos: number
  recorrentes: number
  receita: number
  serie: { total: number; novos: number; recorrentes: number; receita: number }[]
  rotulos: string[]
  periodos: string[]
  canais: { entrega: number; retirada: number }
  pagamentos: { nome: string; pct: number; valor: number }[]
  entrega: { rota: number | null; total: number | null; amostra: number } | null
  produtos: LinhaProduto[]
  categorias: { nome: string; valor: number }[]
  bairros: LinhaBairro[]
  rankingBairros: LinhaBairro[]
  pontos: PontoMapa[]
}
export interface DadosVitrine { cliques: { alvo: string; cliques: number; visitantes: number }[]; origens: { origem: string; visitas: number; pedidos: number }[] }

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const brlCurto = (v: number) => (v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : `R$ ${Math.round(v)}`)
const inteiro = (v: number) => v.toLocaleString('pt-BR')

function abaDaUrl(validas: AbaAnalise[]): AbaAnalise {
  if (typeof window === 'undefined') return 'pedidos'
  const a = new URLSearchParams(window.location.search).get('aba') as AbaAnalise | null
  return a && validas.includes(a) ? a : 'pedidos'
}

/** Barra de distribuição (como as do financeiro): rótulo, valor, % e trilho. */
function Barra({ rotulo, valor, pct, extra, testid }: { rotulo: ReactNode; valor: string; pct: number; extra?: string; testid?: string }) {
  return (
    <div className="mb-3 last:mb-0" data-testid={testid}>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="min-w-0 truncate font-semibold" style={{ color: FIN_COR.texto }}>{rotulo}</span>
        <span className="whitespace-nowrap tabular-nums" style={{ color: FIN_COR.texto }}><b>{valor}</b>{extra && <span className="ml-1" style={{ color: FIN_COR.texto2 }}>{extra}</span>}</span>
      </div>
      <div className="mt-1.5 h-[8px] rounded-full" style={{ background: CORES_GRAFICO.trilho }}>
        <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: CORES_GRAFICO.serie1 }} />
      </div>
    </div>
  )
}

export function AnalisesAbas({ dados, vitrine, nomes, filtro, mapsKey, centro }: {
  dados: DadosAnalises
  /** undefined = carregando; null = rastreio não instalado (a aba de cliques não aparece). */
  vitrine: DadosVitrine | null | undefined
  nomes: { produtos: string[]; categorias: string[] }
  filtro: ReactNode
  mapsKey?: string
  centro: string
}) {
  const validas = useMemo(() => ABAS.map(([id]) => id).filter((id) => id !== 'cliques' || vitrine !== null), [vitrine])
  const [aba, setAba] = useState<AbaAnalise>('pedidos')
  useEffect(() => { setAba(abaDaUrl(validas)) }, [validas])
  // Voltar/avançar do navegador troca a aba.
  useEffect(() => {
    const aoVoltar = () => setAba(abaDaUrl(validas))
    window.addEventListener('popstate', aoVoltar)
    return () => window.removeEventListener('popstate', aoVoltar)
  }, [validas])
  const escolher = useCallback((id: AbaAnalise) => {
    setAba(id)
    const u = new URL(window.location.href)
    if (id === 'pedidos') u.searchParams.delete('aba'); else u.searchParams.set('aba', id)
    window.history.pushState({ aba: id }, '', u.toString())
  }, [])

  return (
    <section className="meta-tema fin-card" data-testid="dash-analises">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold" style={{ color: FIN_COR.texto }}>Análises do período</h2>
          <p className="mt-0.5 text-[13px]" style={{ color: FIN_COR.texto2 }}>Pedidos, entrega, bairros, produtos e cliques — o período vale para todas as abas.</p>
        </div>
        <div className="flex-shrink-0">{filtro}</div>
      </div>
      <div className="mt-3 border-b border-[#E4E7EA] px-4 pb-2">
        <Abas itens={ABAS.filter(([id]) => validas.includes(id))} ativo={aba} onSelecionar={escolher} testidPrefixo="dash-aba" />
      </div>
      <div className="p-4 sm:p-5" data-testid="dash-analises-painel" data-aba={aba}>
        {aba === 'pedidos' && <AbaPedidos d={dados} />}
        {aba === 'entrega' && <AbaEntrega d={dados} />}
        {aba === 'bairros' && <AbaBairros d={dados} mapsKey={mapsKey} centro={centro} />}
        {aba === 'produtos' && <AbaProdutos d={dados} />}
        {aba === 'cliques' && <AbaCliques vitrine={vitrine} nomes={nomes} />}
      </div>
    </section>
  )
}

function AbaPedidos({ d }: { d: DadosAnalises }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Total de pedidos" valor={<span data-testid="dash54-total" data-valor={d.totalPedidos}>{inteiro(d.totalPedidos)}</span>} />
        <Kpi rotulo="De clientes novos" valor={<span data-testid="dash54-novos" data-valor={d.novos}>{inteiro(d.novos)}</span>} />
        <Kpi rotulo="De clientes recorrentes" valor={<span data-testid="dash54-recorrentes" data-valor={d.recorrentes}>{inteiro(d.recorrentes)}</span>} />
        <Kpi rotulo="Faturamento no período" valor={<span data-testid="dash54-faturamento" data-valor={d.receita}>{brl(d.receita)}</span>} detalhe="Receita dos pedidos não cancelados" />
      </div>
      <Card titulo="Análise de pedidos" subtitulo="Barras: total de pedidos por dia. Linhas: de clientes novos e de clientes recorrentes.">
        <GraficoFinanceiro testid="dash54-grafico-pedidos" rotulos={d.rotulos} periodos={d.periodos} formatar={inteiro} formatarEixo={inteiro}
          series={[
            { nome: 'Total de pedidos', tipo: 'barra', secao: 'Pedidos', valores: d.serie.map((p) => p.total) },
            { nome: 'De clientes novos', tipo: 'linha', cor: 1, secao: 'Pedidos', valores: d.serie.map((p) => p.novos) },
            { nome: 'De clientes recorrentes', tipo: 'linha', cor: 2, secao: 'Pedidos', valores: d.serie.map((p) => p.recorrentes) },
          ]} />
      </Card>
      <Card titulo="Faturamento no período" subtitulo="Receita dos pedidos não cancelados, por dia.">
        <GraficoFinanceiro testid="dash54-grafico-faturamento" rotulos={d.rotulos} periodos={d.periodos} formatar={brl} formatarEixo={brlCurto}
          series={[{ nome: 'Faturamento', tipo: 'linha', cor: 1, secao: 'Vendas', valores: d.serie.map((p) => p.receita) }]} />
      </Card>
    </div>
  )
}

function AbaEntrega({ d }: { d: DadosAnalises }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card titulo="Entrega e retirada" subtitulo="Participação de cada canal nos pedidos">
        <div className="flex flex-col items-center gap-3">
          <Medidor valor={d.canais.entrega} alerta={false} rotulo={`Entrega · ${d.canais.entrega}%`} texto={`${d.canais.entrega}%`} testid="dash54-medidor-entrega" tamanho={120} />
          <div className="w-full">
            <Barra rotulo="Entrega" valor={`${d.canais.entrega}%`} pct={d.canais.entrega} />
            <Barra rotulo="Retirada" valor={`Retirada · ${d.canais.retirada}%`} pct={d.canais.retirada} />
          </div>
        </div>
      </Card>
      <Card titulo="Formas de pagamento" subtitulo="Quanto do faturamento entrou por cada forma">
        {d.pagamentos.map((p) => <Barra key={p.nome} rotulo={p.nome} valor={`${p.pct}% · ${brl(p.valor)}`} pct={p.pct} testid="dash54-pagamento" />)}
      </Card>
      <Card titulo="Tempos de entrega" subtitulo="Da saída do motoboy até o pedido ser marcado como entregue">
        {d.entrega === null ? <p className="text-[13px]" style={{ color: FIN_COR.texto2 }}>Medição ainda não ativada.</p> : (
          <div className="grid grid-cols-1 gap-3">
            <Kpi rotulo="Tempo médio na rua" valor={formatarDuracao(d.entrega.rota)} detalhe={d.entrega.amostra ? `${d.entrega.amostra} entrega${d.entrega.amostra > 1 ? 's' : ''} medida${d.entrega.amostra > 1 ? 's' : ''}` : 'Sem entregas rastreadas no período'} />
            <Kpi rotulo="Do pedido feito à entrega" valor={formatarDuracao(d.entrega.total)} />
          </div>
        )}
      </Card>
    </div>
  )
}

const colunasBairro: ColunaTabela<LinhaBairro>[] = [
  { id: 'bairro', titulo: 'Bairro', valor: (l) => l.bairro, destaque: true },
  { id: 'pedidos', titulo: 'Pedidos', valor: (l) => l.pedidos, alinhar: 'direita' },
  { id: 'receita', titulo: 'Receita', valor: (l) => l.receita, render: (l) => brl(l.receita), alinhar: 'direita' },
  { id: 'ticket', titulo: 'Ticket médio', valor: (l) => l.ticket, render: (l) => brl(l.ticket), alinhar: 'direita' },
  { id: 'participacao', titulo: 'Participação', valor: (l) => l.participacao, render: (l) => `${l.participacao.toFixed(1).replace('.', ',')}%`, alinhar: 'direita' },
]

function AbaBairros({ d, mapsKey, centro }: { d: DadosAnalises; mapsKey?: string; centro: string }) {
  const maior = Math.max(1, ...d.rankingBairros.map((b) => b.pedidos))
  return (
    <div className="flex flex-col gap-4">
      <Card titulo="Onde estão seus pedidos" subtitulo="Cada pino é um endereço que pediu; a área azul-clara marca os bairros que mais vendem (mais forte = mais vendas).">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_260px]">
          {/* No celular o mapa encosta nas bordas do card (mais área útil para o dedo). */}
          <div className="-mx-5 sm:mx-0"><MapaPedidos apiKey={mapsKey} centro={centro} pontos={d.pontos} bairros={d.bairros} className="h-[360px] w-full sm:h-[380px]" /></div>
          <div data-testid="dash54-ranking-bairros">
            <p className="mb-3 text-[13px] font-semibold" style={{ color: FIN_COR.texto2 }}>Bairros que mais pedem</p>
            {d.rankingBairros.length === 0 ? <p className="py-4 text-center text-[13px]" style={{ color: FIN_COR.texto2 }}>Sem pedidos com bairro.</p>
              : d.rankingBairros.map((b, i) => (
                <Barra key={b.id} rotulo={<><span className="mr-2 tabular-nums" style={{ color: FIN_COR.texto2 }}>{i + 1}</span>{b.bairro}</>} valor={String(b.pedidos)} extra={brl(b.receita)} pct={(b.pedidos / maior) * 100} />
              ))}
          </div>
        </div>
      </Card>
      <TabelaAnalitica titulo="Análise por bairro" colunas={colunasBairro} linhas={d.bairros} ordemInicial="receita"
        busca={{ placeholder: 'Pesquise por um bairro', texto: (l) => l.bairro }} vazio="Nenhum pedido com endereço no período" />
    </div>
  )
}

const colunasProduto: ColunaTabela<LinhaProduto>[] = [
  { id: 'nome', titulo: 'Produto', valor: (l) => l.nome, destaque: true },
  { id: 'pedidos', titulo: 'Pedidos', valor: (l) => l.pedidos, alinhar: 'direita' },
  { id: 'quantidade', titulo: 'Unidades', valor: (l) => l.quantidade, alinhar: 'direita' },
  { id: 'receita', titulo: 'Receita', valor: (l) => l.receita, render: (l) => brl(l.receita), alinhar: 'direita' },
]

function AbaProdutos({ d }: { d: DadosAnalises }) {
  const maior = Math.max(1, ...d.categorias.map((c) => c.valor))
  return (
    <div className="flex flex-col gap-4">
      <Card titulo="Faturamento por categoria" subtitulo="As 6 categorias que mais faturaram no período">
        {d.categorias.length === 0 ? <p className="py-4 text-center text-[13px]" style={{ color: FIN_COR.texto2 }}>Sem dados no período.</p>
          : d.categorias.map((c) => <Barra key={c.nome} rotulo={c.nome} valor={brl(c.valor)} pct={(c.valor / maior) * 100} testid="dash54-categoria" />)}
      </Card>
      <TabelaAnalitica titulo="Performance dos produtos" colunas={colunasProduto} linhas={d.produtos} ordemInicial="receita"
        busca={{ placeholder: 'Pesquise por um produto', texto: (l) => l.nome }} vazio="Nenhum produto vendido no período" />
    </div>
  )
}

const colunasClique: ColunaTabela<CliqueClassificado & { id: string }>[] = [
  { id: 'alvo', titulo: 'Onde clicaram', valor: (l) => l.alvo, destaque: true },
  { id: 'tipo', titulo: 'Tipo', valor: (l) => ROTULO_TIPO_CLIQUE[l.tipo] },
  { id: 'cliques', titulo: 'Cliques', valor: (l) => l.cliques, alinhar: 'direita' },
  { id: 'visitantes', titulo: 'Visitantes', valor: (l) => l.visitantes, alinhar: 'direita' },
]
const colunasOrigem: ColunaTabela<{ id: string; origem: string; visitas: number; pedidos: number; conversao: number }>[] = [
  { id: 'origem', titulo: 'Origem', valor: (l) => l.origem, destaque: true },
  { id: 'visitas', titulo: 'Visitas', valor: (l) => l.visitas, alinhar: 'direita' },
  { id: 'pedidos', titulo: 'Pedidos', valor: (l) => l.pedidos, alinhar: 'direita' },
  { id: 'conversao', titulo: 'Conversão', valor: (l) => l.conversao, render: (l) => `${l.conversao.toFixed(1).replace('.', ',')}%`, alinhar: 'direita' },
]
const TOM_TIPO: Record<string, 'verde' | 'azul' | 'laranja' | 'cinza' | 'vermelho'> = { produto: 'verde', categoria: 'azul', promocao: 'laranja', cupom: 'laranja', sacola: 'azul', pagamento: 'verde' }

function AbaCliques({ vitrine, nomes }: { vitrine: DadosVitrine | null | undefined; nomes: { produtos: string[]; categorias: string[] } }) {
  const [todos, setTodos] = useState(false)
  const o = useMemo(() => (vitrine ? organizarCliques(vitrine.cliques, nomes) : null), [vitrine, nomes])
  if (vitrine === undefined) return <p className="py-6 text-center text-[13px]" style={{ color: FIN_COR.texto2 }}>Carregando cliques…</p>
  if (!vitrine || !o) return null
  const maior = Math.max(1, ...o.principais.map((c) => c.cliques), o.navegacao?.cliques ?? 0)
  return (
    <div className="flex flex-col gap-4">
      <Card titulo="Cliques que importam" subtitulo="Produto, categoria, banner, cupom, sacola e ir para pagamento — os 10 maiores. Navegação (fechar, voltar, entrar…) e escolhas de complemento ficam agrupadas.">
        {o.principais.length === 0 && <p className="text-[13px]" style={{ color: FIN_COR.texto2 }}>Nenhum clique registrado no período.</p>}
        {o.principais.map((c) => (
          <Barra key={c.alvo} testid="clique-importante" pct={(c.cliques / maior) * 100} valor={`${inteiro(c.cliques)} cliques`} extra={`${inteiro(c.visitantes)} visitantes`}
            rotulo={<span className="inline-flex min-w-0 items-center gap-2"><SeloMeta tom={TOM_TIPO[c.tipo] ?? 'cinza'}>{ROTULO_TIPO_CLIQUE[c.tipo]}</SeloMeta><span className="truncate">{c.alvo}</span></span>} />
        ))}
        {[o.escolhas, o.navegacao].filter(Boolean).map((g) => (
          <Barra key={g!.tipo} testid={`clique-grupo-${g!.tipo}`} pct={(g!.cliques / maior) * 100} valor={`${inteiro(g!.cliques)} cliques`}
            rotulo={<span className="inline-flex min-w-0 items-center gap-2"><SeloMeta tom="cinza">{ROTULO_TIPO_CLIQUE[g!.tipo]}</SeloMeta><span className="truncate" title={g!.alvos.join(', ')}>{g!.alvos.slice(0, 5).join(', ')}{g!.alvos.length > 5 ? '…' : ''}</span></span>} />
        ))}
        <button type="button" className={`${FIN_BTN.contorno} mt-3`} onClick={() => setTodos((v) => !v)} aria-expanded={todos} data-testid="cliques-ver-todos">
          {todos ? 'Ver só os principais' : `Ver todos (${o.todos.length})`}
        </button>
      </Card>
      {todos && (
        <TabelaAnalitica titulo="Todos os cliques" colunas={colunasClique} linhas={o.todos.map((c) => ({ id: c.alvo, ...c }))} ordemInicial="cliques"
          busca={{ placeholder: 'Pesquise um botão', texto: (l) => l.alvo }} vazio="Nenhum clique registrado no período" />
      )}
      <TabelaAnalitica titulo="Origem das visitas" colunas={colunasOrigem}
        linhas={vitrine.origens.map((x) => ({ id: x.origem, ...x, conversao: x.visitas ? (x.pedidos / x.visitas) * 100 : 0 }))} ordemInicial="visitas" vazio="Nenhuma visita registrada no período" />
    </div>
  )
}
