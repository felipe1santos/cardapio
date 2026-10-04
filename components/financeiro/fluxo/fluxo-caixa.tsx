'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Columns3, Download, FileText, Filter, X } from 'lucide-react'
import { CartaoNumero } from '@/components/admin/cartao-numero'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'
import { Flutuante } from '@/components/ui/flutuante'
import { ICONES } from '@/lib/icones-painel'
import {
  ATALHOS, COLUNAS, COLUNAS_PADRAO, COR_SITUACAO, FORMAS, ORIGENS, ROTULO_SITUACAO, SITUACOES, atalhoDoPeriodo, corDiferenca, dataBR,
  filtrosParaQuery, lerFiltros, periodoDoAtalho, temFiltroAlemDoPeriodo, type ColunaFluxo, type FiltrosFluxo, type LinhaFluxo, type Somavel,
} from '@/lib/financeiro/fluxo-regras'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { BOTAO, Chip, PainelLateral, RaizImpressao, Selo, imprimirDocumento } from '../ui/blocos'
import { ExtratoTurno } from './extrato-turno'
import { DocumentoFluxo, type DadosImpressao } from './documento'

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
    case 'data': return <span className="font-semibold">{l.data ? dataBR(l.data) : 'Fora de turno'}</span>
    case 'situacao':
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          <Selo cor={COR_SITUACAO[l.situacao]} testid="fluxo-situacao">{ROTULO_SITUACAO[l.situacao]}</Selo>
          {l.reabertoEm && l.situacao !== 'reaberto' && <Selo cor="#B45309">Reaberto</Selo>}
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
  const t = dados?.totais
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1
  const op = dados?.opcoes
  const selectCls = 'h-[38px] w-full rounded-[4px] border border-border bg-white px-2.5 text-[13px] outline-none focus:border-primary'

  const painelFiltros = (
    <div className="flex flex-col gap-4" data-testid="fluxo-filtros">
      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Origem</p>
        <div className="flex flex-wrap gap-1.5">{ORIGENS.map((o) => <Chip key={o.id} ativo={filtros.origens.includes(o.id)} onClick={() => alternar('origens', o.id)} testid={`filtro-origem-${o.id}`}>{o.rotulo}</Chip>)}</div>
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Forma de pagamento</p>
        <div className="flex flex-wrap gap-1.5">{FORMAS.map((o) => <Chip key={o.id} ativo={filtros.formas.includes(o.id)} onClick={() => alternar('formas', o.id)} testid={`filtro-forma-${o.id}`}>{o.rotulo}</Chip>)}</div>
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Status do caixa</p>
        <div className="flex flex-wrap gap-1.5">{SITUACOES.map((o) => <Chip key={o.id} ativo={filtros.situacoes.includes(o.id)} onClick={() => alternar('situacoes', o.id)} testid={`filtro-status-${o.id}`}>{o.rotulo}</Chip>)}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Operador</span>
          <select className={selectCls} value={filtros.operador ?? ''} onChange={(e) => aplicar({ operador: e.target.value || null })} data-testid="filtro-operador">
            <option value="">Todos</option>{op?.operadores.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select></label>
        <label><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Motoboy</span>
          <select className={selectCls} value={filtros.motoboy ?? ''} onChange={(e) => aplicar({ motoboy: e.target.value || null })} data-testid="filtro-motoboy">
            <option value="">Todos</option>{op?.motoboys.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select></label>
        <label><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Produto</span>
          <select className={selectCls} value={filtros.produto ?? ''} onChange={(e) => aplicar({ produto: e.target.value || null })} data-testid="filtro-produto">
            <option value="">Todos</option>{op?.produtos.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
          </select></label>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-3" data-testid="fluxo-caixa">
      {/* Período + ações */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex min-w-0 max-w-full gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Período">
          {ATALHOS.map((a) => (
            <Chip key={a.id} ativo={atalho === a.id} onClick={() => aplicar(periodoDoAtalho(a.id))} testid={`periodo-${a.id}`}>{a.rotulo}</Chip>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[13px]">
          <input type="date" value={filtros.de} max={filtros.ate} onChange={(e) => e.target.value && aplicar({ de: e.target.value })} aria-label="De" className="h-[34px] rounded-[4px] border border-border px-2" data-testid="periodo-de" />
          <span className="text-text-subtle">a</span>
          <input type="date" value={filtros.ate} min={filtros.de} onChange={(e) => e.target.value && aplicar({ ate: e.target.value })} aria-label="Até" className="h-[34px] rounded-[4px] border border-border px-2" data-testid="periodo-ate" />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className={`${BOTAO.neutro} lg:hidden`} onClick={() => setFiltrosAbertos(true)} data-testid="abrir-filtros">
            <Filter className="h-4 w-4" /> Filtros{temFiltroAlemDoPeriodo(filtros) ? ' •' : ''}
          </button>
          <button type="button" ref={botaoColunas} className={`${BOTAO.neutro} max-md:hidden`} onClick={() => setColunasAbertas((v) => !v)} aria-expanded={colunasAbertas} data-testid="fluxo-colunas">
            <Columns3 className="h-4 w-4" /> Colunas
          </button>
          {dados?.podeExportar && (
            <>
              <button type="button" className={BOTAO.neutro} disabled={!!exportando} onClick={() => void exportar('csv')} data-testid="exportar-csv"><Download className="h-4 w-4" /> CSV</button>
              <button type="button" className={BOTAO.neutro} disabled={!!exportando} onClick={() => void exportar('pdf')} data-testid="exportar-pdf"><FileText className="h-4 w-4" /> PDF</button>
            </>
          )}
        </div>
      </div>

      {/* Filtros: na tela no computador; tela cheia no celular */}
      <div className="hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-4 lg:block">
        {painelFiltros}
        {temFiltroAlemDoPeriodo(filtros) && <button type="button" onClick={limpar} className="mt-3 text-[12.5px] font-semibold text-[#B91C1C] hover:underline" data-testid="limpar-filtros"><X className="mr-1 inline h-3.5 w-3.5" />Limpar filtros</button>}
      </div>
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
        <p className="px-3 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Colunas da tabela</p>
        {COLUNAS.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-page">
            <input type="checkbox" checked={colunas.includes(c.id as string)} onChange={() => alternarColuna(c.id as string)} data-testid={`coluna-${c.id}`} /> {c.rotulo}
          </label>
        ))}
      </Flutuante>

      {erro && <p role="alert" className="rounded-[4px] bg-[#FEE2E2] px-3 py-2 text-[13px] font-medium text-[#B91C1C]">{erro}</p>}

      {/* Totais do período (todos os turnos, não só a página) */}
      <div className="grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" data-testid="fluxo-totais">
        <CartaoNumero icone={ICONES.subindo} tom="verde" rotulo="Vendido" valor={<span data-testid="total-vendido">{brl(t?.vendido)}</span>} />
        <CartaoNumero icone={ICONES.dinheiro} tom="verde" rotulo="Recebido" valor={<span data-testid="total-recebido">{brl(t?.recebido)}</span>} />
        <CartaoNumero icone={ICONES.dinheiro} tom="laranja" rotulo="Dinheiro" valor={<span data-testid="total-dinheiro">{brl(t?.dinheiro)}</span>} />
        <CartaoNumero icone={ICONES.relogio} tom="ambar" rotulo="Pix a conferir" valor={<span data-testid="total-pix-conferir">{brl(t?.pixAConferir)}</span>} />
        <CartaoNumero icone={ICONES.cartao} tom="azul" rotulo="Cartão" valor={<span data-testid="total-cartao">{brl(t?.cartao)}</span>} />
        <CartaoNumero icone={ICONES.aviso} tom={(t?.diferenca ?? 0) === 0 ? 'cinza' : 'vermelho'} rotulo="Diferenças de caixa" valor={<span data-testid="total-diferenca">{brl(t?.diferenca)}</span>} />
      </div>

      {/* Computador: tabela */}
      <div className="hidden overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white md:block">
        <div className="max-h-[calc(100dvh-380px)] min-h-[200px] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]" data-testid="fluxo-tabela">
            <thead className="sticky top-0 z-[2] bg-[#F6F7F9] text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
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
                  className={`align-middle [&>td]:border-b [&>td]:border-border ${l.turnoId ? 'cursor-pointer hover:[&>td]:bg-[#F0F9FF]' : ''} ${l.situacao === 'aberto' || l.situacao === 'reaberto' ? '[&>td]:bg-[#F0F9FF]' : ''}`}
                  data-testid="fluxo-linha" data-turno={l.turnoId ?? ''}>
                  {visiveis.map((c) => <td key={c.id} className={`px-3 py-2 ${c.tipo === 'centavos' || c.tipo === 'diferenca' ? 'whitespace-nowrap text-right' : ''}`}><Valor col={c} l={l} /></td>)}
                  {comProduto && <><td className="px-3 py-2 text-right" data-testid="produto-qtd">{l.produtoQtd ?? 0}</td><td className="px-3 py-2 text-right">{brl(l.produtoValor)}</td></>}
                </tr>
              ))}
            </tbody>
            {dados && dados.linhas.length > 0 && t && (
              <tfoot className="sticky bottom-0 bg-[#F6F7F9] font-bold">
                <tr className="[&>td]:border-t-2 [&>td]:border-[#D1D5DB]" data-testid="fluxo-rodape">
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
            className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-3 text-left" data-testid="fluxo-cartao" data-turno={l.turnoId ?? ''}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[15px] font-semibold">{l.data ? dataBR(l.data) : 'Fora de turno'}</p>
              <Selo cor={COR_SITUACAO[l.situacao]}>{ROTULO_SITUACAO[l.situacao]}</Selo>
            </div>
            <div className="mt-2 flex items-end justify-between gap-3 text-[13px]">
              <div><p className="text-[11px] text-text-subtle">Recebido</p><p className="font-semibold text-[#15803D]">{brl(l.recebido)}</p></div>
              <div className="text-right"><p className="text-[11px] text-text-subtle">Diferença</p>
                {l.diferenca === null ? <p className="text-text-subtle">—</p> : <p className="font-semibold" style={{ color: corDiferenca(l.diferenca) ?? undefined }}>{brl(l.diferenca)}</p>}
              </div>
            </div>
          </button>
        ))}
        {dados && dados.linhas.length > 0 && t && (
          <div className="rounded-[6px] bg-[#1F2937] p-3 text-[13px] text-white" data-testid="fluxo-rodape-celular">
            <p className="font-bold">Totais ({dados.total} turnos)</p>
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
