'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BarChart3, ChevronDown, Columns3, Download, FileText, Filter, X } from 'lucide-react'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'
import { Flutuante } from '@/components/ui/flutuante'
import { ICONES } from '@/lib/icones-painel'
import {
  ATALHOS, COLUNAS, COLUNAS_PADRAO, COR_SITUACAO, FORMAS, ORIGENS, ROTULO_SITUACAO, SITUACOES, atalhoDoPeriodo, avisoMeiaNoite, corDiferenca, dataBR,
  filtrosParaQuery, lerFiltros, periodoDoAtalho, temFiltroAlemDoPeriodo, type Atalho, type ColunaFluxo, type FiltrosFluxo, type LinhaFluxo, type Somavel,
} from '@/lib/financeiro/fluxo-regras'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { BOTAO, Chip, PainelLateral, RaizImpressao, Selo, imprimirDocumento } from '../ui/blocos'
import { ExtratoTurno } from './extrato-turno'
import { DocumentoFluxo, type DadosImpressao } from './documento'
import { Card, FIN_COR } from '@/components/graficos/kit-meta'
import { BarraFiltros, CAMPO_FILTRO, LinhaResumos } from '@/components/ui/topo-compacto'
import { GraficoFinanceiro } from '@/components/graficos/grafico'

/**
 * Financeiro › Fluxo de Caixa (Fase 4). Só leitura: tudo vem do livro-caixa pela API.
 * Filtros na URL (link compartilhável; o "voltar" do navegador desfaz o último filtro).
 */
interface Opcao { id: string; nome: string }
interface RespostaFluxo {
  filtros: FiltrosFluxo; total: number; pagina: number; porPagina: number; linhas: LinhaFluxo[]
  totais: Record<Somavel, number>; opcoes: { operadores: Opcao[]; motoboys: Opcao[]; produtos: Opcao[] }; podeExportar: boolean
}

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const brl = (c: number | null | undefined) => (c === null || c === undefined ? '—' : formatarCentavos(c))

function Valor({ col, l }: { col: ColunaFluxo; l: LinhaFluxo }) {
  switch (col.id) {
    case 'data': {
      const aviso = avisoMeiaNoite(l.abertoEm, l.fechadoEm)
      return (
        <span className="font-semibold">
          {l.data ? dataBR(l.data) : 'Fora de turno'}
          {aviso && <span className="mt-[2px] block max-w-[190px] text-[11.5px] font-normal leading-[15px] text-[#8A4B00]" data-testid="fluxo-meia-noite">{aviso}</span>}
        </span>
      )
    }
    case 'situacao':
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Selo cor={COR_SITUACAO[l.situacao]} testid="fluxo-situacao">{ROTULO_SITUACAO[l.situacao]}</Selo>
          {l.reabertoEm && l.situacao !== 'reaberto' && <Selo cor="#8A4B00">Reaberto</Selo>}
        </span>
      )
    case 'abertura': return l.abertoEm ? <span className="whitespace-nowrap">{l.abertoPor ?? '—'}<br /><span className="text-[11.5px] text-text-subtle">{hora(l.abertoEm)}</span></span> : <span className="text-text-subtle">—</span>
    case 'fechamento': return l.fechadoEm ? <span className="whitespace-nowrap">{l.fechadoPor ?? '—'}<br /><span className="text-[11.5px] text-text-subtle">{hora(l.fechadoEm)}</span></span> : <span className="text-text-subtle">{l.abertoEm ? 'em andamento' : '—'}</span>
    case 'observacoes': return <span className="line-clamp-2 max-w-[220px] text-[12px] text-text-subtle">{l.observacoes ?? ''}</span>
    case 'diferenca': {
      const cor = corDiferenca(l.diferenca)
      return l.diferenca === null ? <span className="text-text-subtle">—</span>
        : <span className="inline-flex rounded-[4px] px-1.5 py-[1px] font-semibold text-white" style={{ backgroundColor: cor ?? undefined }} data-testid="fluxo-diferenca">{brl(l.diferenca)}</span>
    }
    default: {
      const v = l[col.id as keyof LinhaFluxo] as number | null
      return <span className={v === null ? 'text-text-subtle' : ''}>{brl(v)}</span>
    }
  }
}

export function FluxoCaixa({ usuarioId }: { usuarioId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const filtros = useMemo(() => lerFiltros(new URLSearchParams(sp.toString())), [sp])
  const pagina = Math.max(0, Number(sp.get('pagina')) || 0)
  const turnoAberto = sp.get('turno')
  const [dados, setDados] = useState<RespostaFluxo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [colunasAbertas, setColunasAbertas] = useState(false)
  // Computador: o painel de filtros fica fechado até o botão "Filtros" (abre sozinho se o link já trouxer filtro).
  const [filtrosNaTela, setFiltrosNaTela] = useState(() => temFiltroAlemDoPeriodo(filtros))
  const [graficoAberto, setGraficoAberto] = useState(false)
  const [impressao, setImpressao] = useState<DadosImpressao | null>(null)
  const [exportando, setExportando] = useState<string | null>(null)
  const botaoColunas = useRef<HTMLButtonElement>(null)
  const toasts = useToasts()
  const fecharColunas = useCallback(() => setColunasAbertas(false), [])

  // Colunas visíveis: preferência por usuário (neste navegador).
  const chaveColunas = `menuzia:fluxo-colunas:${usuarioId}`
  const [colunas, setColunas] = useState<string[]>(COLUNAS_PADRAO as string[])
  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(chaveColunas) ?? 'null'); if (Array.isArray(s) && s.length) setColunas(s.filter((c) => COLUNAS.some((x) => x.id === c))) } catch { /* sem preferência */ }
  }, [chaveColunas])
  function alternarColuna(id: string) {
    setColunas((atual) => {
      const nova = atual.includes(id) ? atual.filter((c) => c !== id) : COLUNAS.map((c) => c.id as string).filter((c) => c === id || atual.includes(c))
      try { localStorage.setItem(chaveColunas, JSON.stringify(nova)) } catch { /* sem armazenamento */ }
      return nova.length ? nova : atual
    })
  }
  const visiveis = COLUNAS.filter((c) => colunas.includes(c.id as string))
  const comProduto = !!filtros.produto

  /** Muda a URL (push: o "voltar" desfaz). Filtro novo volta para a página 1. */
  const irPara = useCallback((f: FiltrosFluxo, extra: Record<string, string | null> = {}) => {
    const q = new URLSearchParams(filtrosParaQuery(f))
    q.set('secao', 'fluxo')
    for (const [k, v] of Object.entries(extra)) if (v !== null) q.set(k, v)
    router.push(`${pathname}?${q.toString()}`, { scroll: false })
  }, [pathname, router])
  const aplicar = (parcial: Partial<FiltrosFluxo>) => irPara({ ...filtros, ...parcial })
  const alternar = (campo: 'origens' | 'formas' | 'situacoes', id: string) => aplicar({ [campo]: filtros[campo].includes(id) ? filtros[campo].filter((x) => x !== id) : [...filtros[campo], id] } as Partial<FiltrosFluxo>)
  const limpar = () => irPara({ ...filtros, origens: [], formas: [], situacoes: [], operador: null, motoboy: null, produto: null })
  const abrirTurno = (id: string | null) => {
    const q = new URLSearchParams(sp.toString())
    if (id) q.set('turno', id); else q.delete('turno')
    router.push(`${pathname}?${q.toString()}`, { scroll: false })
  }

  const consulta = filtrosParaQuery(filtros)
  useEffect(() => {
    let vivo = true
    setCarregando(true)
    void fetch(`/api/admin/financeiro/fluxo?${consulta}&pagina=${pagina}`, { cache: 'no-store' }).then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (!vivo) return
      if (!r.ok) setErro(j.error ?? 'Não foi possível carregar o fluxo.')
      else { setErro(null); setDados(j) }
    }).finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [consulta, pagina])

  async function exportar(formato: 'csv' | 'pdf', turno?: string) {
    setExportando(formato)
    try {
      const url = `/api/admin/financeiro/fluxo/exportar?formato=${formato}&${consulta}${turno ? `&turno=${turno}` : ''}`
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) { const j = await r.json().catch(() => ({})); toasts.mostrar('erro', j.error ?? 'Não foi possível exportar.'); return }
      if (formato === 'csv') {
        const blob = await r.blob()
        const nome = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'fluxo-de-caixa.csv'
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove()
        toasts.mostrar('ok', 'CSV gerado.')
      } else {
        setImpressao(await r.json())
        setTimeout(imprimirDocumento, 150)
      }
    } finally {
      setExportando(null)
    }
  }

  const atalho = atalhoDoPeriodo(filtros.de, filtros.ate)
  const nFiltros = filtros.origens.length + filtros.formas.length + filtros.situacoes.length + (filtros.operador ? 1 : 0) + (filtros.motoboy ? 1 : 0) + (filtros.produto ? 1 : 0)
  const t = dados?.totais
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1
  const op = dados?.opcoes
  const selectCls = 'h-[38px] w-full fin-card px-2.5 text-[14px] outline-none hover:border-[#9AA6B1] focus:border-primary'

  const painelFiltros = (
    <div className="flex flex-col gap-4" data-testid="fluxo-filtros">
      <div>
        <p className="mb-1.5 text-[12.5px] font-semibold text-text-subtle">Origem</p>
        <div className="flex flex-wrap gap-1.5">{ORIGENS.map((o) => <Chip key={o.id} ativo={filtros.origens.includes(o.id)} onClick={() => alternar('origens', o.id)} testid={`filtro-origem-${o.id}`}>{o.rotulo}</Chip>)}</div>
      </div>
      <div>
        <p className="mb-1.5 text-[12.5px] font-semibold text-text-subtle">Forma de pagamento</p>
        <div className="flex flex-wrap gap-1.5">{FORMAS.map((o) => <Chip key={o.id} ativo={filtros.formas.includes(o.id)} onClick={() => alternar('formas', o.id)} testid={`filtro-forma-${o.id}`}>{o.rotulo}</Chip>)}</div>
      </div>
      <div>
        <p className="mb-1.5 text-[12.5px] font-semibold text-text-subtle">Status do caixa</p>
        <div className="flex flex-wrap gap-1.5">{SITUACOES.map((o) => <Chip key={o.id} ativo={filtros.situacoes.includes(o.id)} onClick={() => alternar('situacoes', o.id)} testid={`filtro-status-${o.id}`}>{o.rotulo}</Chip>)}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className="mb-1 block text-[12.5px] font-semibold text-text-subtle">Operador</span>
          <select className={selectCls} value={filtros.operador ?? ''} onChange={(e) => aplicar({ operador: e.target.value || null })} data-testid="filtro-operador">
            <option value="">Todos</option>{op?.operadores.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select></label>
        <label><span className="mb-1 block text-[12.5px] font-semibold text-text-subtle">Motoboy</span>
          <select className={selectCls} value={filtros.motoboy ?? ''} onChange={(e) => aplicar({ motoboy: e.target.value || null })} data-testid="filtro-motoboy">
            <option value="">Todos</option>{op?.motoboys.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select></label>
        <label><span className="mb-1 block text-[12.5px] font-semibold text-text-subtle">Produto</span>
          <select className={selectCls} value={filtros.produto ?? ''} onChange={(e) => aplicar({ produto: e.target.value || null })} data-testid="filtro-produto">
            <option value="">Todos</option>{op?.produtos.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select></label>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-3" data-testid="fluxo-caixa">
      {/* Linha 1: totais do período (todos os turnos, não só a página) em pílulas. */}
      <LinhaResumos testid="fluxo-totais" itens={[
        { rotulo: 'Vendido', valor: <span data-testid="total-vendido">{brl(t?.vendido)}</span>, icone: ICONES.subindo, tom: 'verde' },
        { rotulo: 'Recebido', valor: <span data-testid="total-recebido">{brl(t?.recebido)}</span>, icone: ICONES.dinheiro, tom: 'verde' },
        { rotulo: 'Dinheiro', valor: <span data-testid="total-dinheiro">{brl(t?.dinheiro)}</span>, icone: ICONES.dinheiro, tom: 'laranja' },
        { rotulo: 'Pix a conferir', valor: <span data-testid="total-pix-conferir">{brl(t?.pixAConferir)}</span>, icone: ICONES.relogio, tom: 'ambar', destaque: (t?.pixAConferir ?? 0) > 0 },
        { rotulo: 'Cartão', valor: <span data-testid="total-cartao">{brl(t?.cartao)}</span>, icone: ICONES.cartao, tom: 'azul' },
        { rotulo: 'Diferenças', valor: <span data-testid="total-diferenca">{brl(t?.diferenca)}</span>, icone: ICONES.aviso, tom: (t?.diferenca ?? 0) === 0 ? 'cinza' : 'vermelho', destaque: (t?.diferenca ?? 0) !== 0, dica: 'Diferenças de caixa nos fechamentos' },
      ]} />
      {/* Linha 2: período, filtros e ações. */}
      <BarraFiltros acoes={<>
        <button type="button" className={`${BOTAO.neutro} max-md:hidden ${graficoAberto ? '!border-[#0A78BE] !text-[#0868A6]' : ''}`} onClick={() => setGraficoAberto((v) => !v)} aria-pressed={graficoAberto}
          aria-label="Gráfico recebido por turno" title={graficoAberto ? 'Esconder o gráfico' : 'Mostrar o gráfico (recebido por turno)'} data-testid="fluxo-mostrar-grafico">
          <BarChart3 className="h-4 w-4" />
        </button>
        <button type="button" ref={botaoColunas} className={`${BOTAO.neutro} max-md:hidden`} onClick={() => setColunasAbertas((v) => !v)} aria-expanded={colunasAbertas}
          aria-label="Colunas da tabela" title="Escolher as colunas da tabela" data-testid="fluxo-colunas">
          <Columns3 className="h-4 w-4" />
        </button>
        {dados?.podeExportar && (
          <>
            <button type="button" className={BOTAO.neutro} disabled={!!exportando} onClick={() => void exportar('csv')} data-testid="exportar-csv"><Download className="h-4 w-4" /> CSV</button>
            <button type="button" className={BOTAO.neutro} disabled={!!exportando} onClick={() => void exportar('pdf')} data-testid="exportar-pdf"><FileText className="h-4 w-4" /> PDF</button>
          </>
        )}
      </>}>
        <label className="relative inline-flex flex-shrink-0 items-center">
          <span className="sr-only">Período</span>
          <select value={atalho ?? ''} onChange={(e) => e.target.value && aplicar(periodoDoAtalho(e.target.value as Atalho))} className={`${CAMPO_FILTRO} appearance-none pr-[30px] font-semibold`} data-testid="periodo-atalho">
            {!atalho && <option value="">Personalizado</option>}
            {ATALHOS.map((a) => <option key={a.id} value={a.id}>{a.rotulo}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-[8px] h-[15px] w-[15px] text-text-subtle" aria-hidden="true" />
        </label>
        <span className="flex items-center gap-1.5 text-[13px]">
          <input type="date" value={filtros.de} max={filtros.ate} onChange={(e) => e.target.value && aplicar({ de: e.target.value })} aria-label="De" className={CAMPO_FILTRO} data-testid="periodo-de" />
          <span className="text-text-subtle">a</span>
          <input type="date" value={filtros.ate} min={filtros.de} onChange={(e) => e.target.value && aplicar({ ate: e.target.value })} aria-label="Até" className={CAMPO_FILTRO} data-testid="periodo-ate" />
        </span>
        <button type="button" className={`${BOTAO.neutro} max-lg:hidden ${filtrosNaTela ? '!border-[#0A78BE] !text-[#0868A6]' : ''}`} onClick={() => setFiltrosNaTela((v) => !v)} aria-expanded={filtrosNaTela} data-testid="abrir-filtros-tela">
          <Filter className="h-4 w-4" /> Filtros{nFiltros ? ` (${nFiltros})` : ''}
        </button>
        <button type="button" className={`${BOTAO.neutro} lg:hidden`} onClick={() => setFiltrosAbertos(true)} data-testid="abrir-filtros">
          <Filter className="h-4 w-4" /> Filtros{nFiltros ? ` (${nFiltros})` : ''}
        </button>
        {nFiltros > 0 && <button type="button" onClick={limpar} className="rounded-[6px] px-2 py-1 text-[13px] font-semibold text-[#D93616] hover:bg-[#FCEBE7]" data-testid="limpar-filtros"><X className="mr-1 inline h-3.5 w-3.5" />Limpar filtros</button>}
      </BarraFiltros>

      {/* Filtros: abrem na tela no computador (botão "Filtros"); tela cheia no celular */}
      {filtrosNaTela && <div className="fin-card hidden p-4 lg:block">{painelFiltros}</div>}
      {filtrosAbertos && (
        <PainelLateral titulo="Filtros" onFechar={() => setFiltrosAbertos(false)} largura={520} testid="painel-filtros"
          acoes={<>
            <button type="button" className={BOTAO.primario} onClick={() => setFiltrosAbertos(false)}>Ver resultado</button>
            {temFiltroAlemDoPeriodo(filtros) && <button type="button" className={BOTAO.neutro} onClick={limpar} data-testid="limpar-filtros-celular">Limpar filtros</button>}
          </>}>
          {painelFiltros}
        </PainelLateral>
      )}
      <Flutuante ancora={botaoColunas} aberto={colunasAbertas} onFechar={fecharColunas} largura={260} alinhar="fim" testid="fluxo-colunas-menu" rotulo="Colunas" className="py-1.5">
        <p className="px-3 pb-1 pt-1 text-[12.5px] font-semibold text-text-subtle">Colunas da tabela</p>
        {COLUNAS.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-page">
            <input type="checkbox" checked={colunas.includes(c.id as string)} onChange={() => alternarColuna(c.id as string)} data-testid={`coluna-${c.id}`} /> {c.rotulo}
          </label>
        ))}
      </Flutuante>

      {erro && <p role="alert" className="fin-card border-l-[3px] !border-l-[#D93616] px-4 py-2.5 text-[14px] font-medium text-[#D93616]">{erro}</p>}

      {/* Barras por turno (recebido) + linha da diferença — o gráfico único da Meta. Abre pelo botão "Gráfico". */}
      {graficoAberto && dados && dados.linhas.some((l) => l.turnoId) && (() => {
        const turnos = dados.linhas.filter((l) => l.turnoId).slice().reverse()
        return (
          <Card testid="fluxo-grafico-turnos" titulo="Recebido por turno" subtitulo="Barras: quanto cada turno recebeu. Linha: a diferença no fechamento (zero é o ideal).">
            <GraficoFinanceiro testid="fluxo-grafico" altura={220}
              rotulos={turnos.map((l) => (l.data ? dataBR(l.data).slice(0, 5) : '—'))}
              periodos={turnos.map((l) => `Turno de ${l.data ? dataBR(l.data) : '—'}${l.abertoPor ? ` · ${l.abertoPor}` : ''}`)}
              formatar={brl} formatarEixo={(c) => brl(c).replace(',00', '')}
              series={[
                { nome: 'Recebido', tipo: 'barra', secao: 'Turno', valores: turnos.map((l) => l.recebido ?? 0) },
                { nome: 'Diferença no fechamento', tipo: 'linha', cor: 2, secao: 'Turno', valores: turnos.map((l) => l.diferenca) },
              ]} />
          </Card>
        )
      })()}

      {/* Computador: tabela */}
      <div className="fin-card hidden overflow-hidden md:block">
        <div className="max-h-[calc(100dvh-226px)] min-h-[240px] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]" data-testid="fluxo-tabela">
            <thead className="sticky top-0 z-[2] bg-[#F5F7F9] text-left text-[12px] font-semibold text-text-subtle">
              <tr className="[&>th]:border-b [&>th]:border-border">
                {visiveis.map((c) => <th key={c.id} className={`whitespace-nowrap px-3 py-2.5 ${c.tipo === 'centavos' || c.tipo === 'diferenca' ? 'text-right' : ''}`}>{c.rotulo}</th>)}
                {comProduto && <><th className="whitespace-nowrap px-3 py-2.5 text-right">Produto (qtd.)</th><th className="whitespace-nowrap px-3 py-2.5 text-right">Produto (R$)</th></>}
              </tr>
            </thead>
            <tbody>
              {dados && dados.linhas.length === 0 && <tr><td colSpan={visiveis.length + 2} className="px-4 py-10 text-center text-text-subtle" data-testid="fluxo-vazio">Nenhum turno no período e filtros escolhidos.</td></tr>}
              {dados?.linhas.map((l) => (
                <tr key={l.turnoId ?? 'sem-turno'} onClick={() => l.turnoId && abrirTurno(l.turnoId)} tabIndex={l.turnoId ? 0 : -1}
                  onKeyDown={(e) => { if (e.key === 'Enter' && l.turnoId) abrirTurno(l.turnoId) }}
                  className={`align-middle [&>td]:border-b [&>td]:border-[#E4E7EA] ${l.turnoId ? 'cursor-pointer hover:[&>td]:bg-[#F5F7F9] active:[&>td]:bg-[#E4E7EA]' : ''} ${l.situacao === 'aberto' || l.situacao === 'reaberto' ? '[&>td]:bg-[#E7F5FF]' : ''}`}
                  data-testid="fluxo-linha" data-turno={l.turnoId ?? ''}>
                  {visiveis.map((c) => <td key={c.id} className={`px-3 py-2 ${c.tipo === 'centavos' || c.tipo === 'diferenca' ? 'whitespace-nowrap text-right' : ''}`}><Valor col={c} l={l} /></td>)}
                  {comProduto && <><td className="px-3 py-2 text-right" data-testid="produto-qtd">{l.produtoQtd ?? 0}</td><td className="px-3 py-2 text-right">{brl(l.produtoValor)}</td></>}
                </tr>
              ))}
            </tbody>
            {dados && dados.linhas.length > 0 && t && (
              <tfoot className="sticky bottom-0 bg-[#E7F5FF] font-semibold">
                <tr className="[&>td]:border-t [&>td]:border-[#CBD2D9]" data-testid="fluxo-rodape">
                  {visiveis.map((c, i) => (
                    <td key={c.id} className={`whitespace-nowrap px-3 py-2.5 ${c.tipo === 'centavos' || c.tipo === 'diferenca' ? 'text-right' : ''}`}>
                      {i === 0 ? `Totais (${dados.total} turno${dados.total === 1 ? '' : 's'})` : (c.tipo === 'centavos' || c.tipo === 'diferenca') && (c.id as string) in t ? brl(t[c.id as Somavel]) : ''}
                    </td>
                  ))}
                  {comProduto && <><td className="px-3 py-2.5 text-right">{t.produtoQtd}</td><td className="px-3 py-2.5 text-right">{brl(t.produtoValor)}</td></>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Celular: cartões */}
      <div className="flex flex-col gap-2 md:hidden" data-testid="fluxo-cartoes">
        {dados?.linhas.map((l) => (
          <button type="button" key={l.turnoId ?? 'sem-turno'} onClick={() => l.turnoId && abrirTurno(l.turnoId)} disabled={!l.turnoId}
            className="fin-card p-4 text-left transition-colors hover:bg-[#F5F7F9] active:bg-[#E4E7EA]" data-testid="fluxo-cartao" data-turno={l.turnoId ?? ''}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[15px] font-semibold">{l.data ? dataBR(l.data) : 'Fora de turno'}</p>
              <Selo cor={COR_SITUACAO[l.situacao]}>{ROTULO_SITUACAO[l.situacao]}</Selo>
            </div>
            {avisoMeiaNoite(l.abertoEm, l.fechadoEm) && <p className="mt-1 text-[12px] leading-[16px] text-[#8A4B00]">{avisoMeiaNoite(l.abertoEm, l.fechadoEm)}</p>}
            <div className="mt-2 flex items-end justify-between gap-3 text-[13px]">
              <div><p className="text-[11px] text-text-subtle">Recebido</p><p className="font-semibold text-[#006B4E]">{brl(l.recebido)}</p></div>
              <div className="text-right"><p className="text-[11px] text-text-subtle">Diferença</p>
                {l.diferenca === null ? <p className="text-text-subtle">—</p> : <p className="font-semibold" style={{ color: corDiferenca(l.diferenca) ?? undefined }}>{brl(l.diferenca)}</p>}
              </div>
            </div>
          </button>
        ))}
        {dados && dados.linhas.length > 0 && t && (
          <div className="rounded-[6px] p-4 text-[14px]" style={{ background: FIN_COR.destaque, color: FIN_COR.texto }} data-testid="fluxo-rodape-celular">
            <p className="font-semibold">Totais ({dados.total} turnos)</p>
            <p>Recebido {brl(t.recebido)} · Diferença {brl(t.diferenca)}</p>
          </div>
        )}
      </div>

      {dados && (
        <div className="flex items-center justify-between text-[12.5px] text-text-subtle" data-testid="fluxo-paginacao">
          <span>{carregando ? 'Atualizando…' : `${dados.total} turno${dados.total === 1 ? '' : 's'} no período`}</span>
          {totalPaginas > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" className={BOTAO.neutro} disabled={pagina === 0} onClick={() => irPara(filtros, { pagina: String(pagina - 1) })}>Anterior</button>
              <span>{pagina + 1} / {totalPaginas}</span>
              <button type="button" className={BOTAO.neutro} disabled={pagina >= totalPaginas - 1} onClick={() => irPara(filtros, { pagina: String(pagina + 1) })} data-testid="fluxo-proxima">Próxima</button>
            </div>
          )}
        </div>
      )}

      {turnoAberto && (
        <ExtratoTurno turnoId={turnoAberto} podeExportar={!!dados?.podeExportar} onFechar={() => abrirTurno(null)} onAbrirTurno={abrirTurno}
          onExportar={(f) => void exportar(f, turnoAberto)} toast={toasts.mostrar} />
      )}
      {impressao && <RaizImpressao><DocumentoFluxo dados={impressao} /></RaizImpressao>}
      <PilhaToasts itens={toasts.itens} />
    </div>
  )
}
