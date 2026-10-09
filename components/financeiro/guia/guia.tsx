'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Search, X } from 'lucide-react'
import { FIN_COR } from '@/components/graficos/kit-meta'
import { GRUPOS, SECOES } from './conteudo'
import { FolhaFuncionarios } from './folha-funcionarios'
import { SecaoGuia } from './pecas'

/**
 * Guia do Financeiro (/admin/financeiro/guia). Índice fixo à esquerda no computador; no celular (< lg) o
 * índice vira uma lista no topo. A busca filtra as seções e marca o termo no texto (CSS Custom Highlight,
 * quando o navegador tem; sem ele, só filtra). As âncoras (#id) são estáveis: as telas linkam para elas.
 */
const FUNCIONARIOS = { id: 'funcionarios', titulo: 'Guia de 1 página para os funcionários', grupo: 'No dia a dia' as const }
const INDICE = [...SECOES.map(({ id, titulo, grupo }) => ({ id, titulo, grupo })), FUNCIONARIOS]
const NOME_MARCA = 'guia-busca'

/** Minúsculas e sem acento, caractere a caractere (mantém as posições do texto original). */
function normalizarChar(ch: string) {
  const n = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return n.length === 1 ? n : ch.toLowerCase().slice(0, 1) || ch
}
const normalizar = (t: string) => Array.from(t, normalizarChar).join('')

function suportaMarca() {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

export function GuiaFinanceiro() {
  const [busca, setBusca] = useState('')
  const [encontradas, setEncontradas] = useState<Set<string> | null>(null)
  const [ativa, setAtiva] = useState<string>(INDICE[0].id)
  const areaRef = useRef<HTMLDivElement>(null)
  const termo = normalizar(busca.trim())

  // Filtra pelas palavras de cada seção (o texto que está na tela, sem duplicar o conteúdo).
  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    if (!termo) { setEncontradas(null); return }
    const s = new Set<string>()
    area.querySelectorAll<HTMLElement>('[data-guia-secao]').forEach((el) => {
      if (normalizar(el.textContent ?? '').includes(termo)) s.add(el.dataset.guiaSecao as string)
    })
    setEncontradas(s)
  }, [termo])

  // Marca o termo encontrado no texto das seções visíveis.
  useEffect(() => {
    if (!suportaMarca()) return
    CSS.highlights.delete(NOME_MARCA)
    const area = areaRef.current
    if (!area || !termo || !encontradas?.size) return
    const intervalos: Range[] = []
    area.querySelectorAll<HTMLElement>('[data-guia-secao]').forEach((sec) => {
      if (!encontradas.has(sec.dataset.guiaSecao as string)) return
      const andarilho = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT)
      for (let no = andarilho.nextNode(); no; no = andarilho.nextNode()) {
        const texto = normalizar(no.textContent ?? '')
        let i = texto.indexOf(termo)
        while (i >= 0 && intervalos.length < 500) {
          const r = document.createRange()
          r.setStart(no, i); r.setEnd(no, i + termo.length)
          intervalos.push(r)
          i = texto.indexOf(termo, i + termo.length)
        }
      }
    })
    if (intervalos.length) CSS.highlights.set(NOME_MARCA, new Highlight(...intervalos))
    return () => { CSS.highlights.delete(NOME_MARCA) }
  }, [termo, encontradas])

  // Abre já na seção do link (/admin/financeiro/guia#caixa) e acompanha trocas de âncora.
  const irParaAncora = useCallback(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return
    const el = document.getElementById(id)
    if (el) { el.scrollIntoView({ block: 'start' }); setAtiva(id) }
  }, [])
  useEffect(() => {
    const t = setTimeout(irParaAncora, 60)
    window.addEventListener('hashchange', irParaAncora)
    return () => { clearTimeout(t); window.removeEventListener('hashchange', irParaAncora) }
  }, [irParaAncora])

  // Índice acompanha a seção que está no topo da área de leitura.
  useEffect(() => {
    const area = areaRef.current
    if (!area || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver((entradas) => {
      const visivel = entradas.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visivel) setAtiva((visivel.target as HTMLElement).dataset.guiaSecao as string)
    }, { root: area, rootMargin: '0px 0px -70% 0px' })
    area.querySelectorAll('[data-guia-secao]').forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  const visivel = useCallback((id: string) => !encontradas || encontradas.has(id), [encontradas])
  const indiceVisivel = useMemo(() => INDICE.filter((s) => visivel(s.id)), [visivel])

  const indice = (celular: boolean) => (
    <nav aria-label="Índice do guia" className={celular ? '' : 'space-y-4'}>
      {GRUPOS.map((g) => {
        const itens = indiceVisivel.filter((s) => s.grupo === g)
        if (!itens.length) return null
        return (
          <div key={g} className={celular ? 'mb-3 last:mb-0' : ''}>
            <p className="mb-1 px-2 text-[12px] font-semibold" style={{ color: FIN_COR.texto2 }}>{g}</p>
            <ul className={celular ? 'grid gap-x-2 sm:grid-cols-2' : 'space-y-0.5'}>
              {itens.map((s) => {
                const atual = !celular && ativa === s.id
                return (
                  <li key={s.id}>
                    <a href={`#${s.id}`} onClick={() => setAtiva(s.id)} aria-current={atual ? 'location' : undefined}
                      className={`block rounded-[8px] px-2 py-1.5 text-[14px] leading-[18px] hover:bg-[#F5F6F7] ${atual ? 'font-semibold' : ''}`}
                      style={{ color: atual ? FIN_COR.azulTexto : FIN_COR.texto, background: atual ? FIN_COR.ativoFundo : undefined }}>
                      {s.titulo}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )

  return (
    <div ref={areaRef} className="fin-meta fin-fundo min-h-0 flex-1 overflow-y-auto overflow-x-hidden" data-testid="guia-financeiro">
      <style>{`::highlight(${NOME_MARCA}) { background-color: #FFE58F; color: #1C2B33; }`}</style>
      <div className="mx-auto flex w-full max-w-[1180px] gap-6 p-4 sm:p-5 lg:p-6">
        <aside className="hidden w-[240px] flex-shrink-0 lg:block">
          <div className="sticky top-0 max-h-[calc(100vh-110px)] overflow-y-auto pb-4">{indice(false)}</div>
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          <header className="space-y-3">
            <Link href="/admin/financeiro" className="inline-flex items-center gap-1 text-[14px] font-semibold hover:underline" style={{ color: FIN_COR.azulTexto }} data-testid="guia-voltar">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Voltar ao Financeiro
            </Link>
            <div>
              <h1 className="text-[22px] font-semibold leading-tight" style={{ color: FIN_COR.texto }}>Como usar o Financeiro</h1>
              <p className="mt-1 text-[14px]" style={{ color: FIN_COR.texto2 }}>Um guia simples, tela por tela, com as situações que mais acontecem na loja.</p>
            </div>
            <label className="flex h-[40px] items-center gap-2 rounded-[8px] border bg-white px-3 focus-within:border-[#0A78BE] focus-within:shadow-[0_0_0_1px_#0A78BE]" style={{ borderColor: FIN_COR.borda }}>
              <Search className="h-4 w-4 flex-shrink-0" style={{ color: FIN_COR.texto2 }} aria-hidden="true" />
              <span className="sr-only">Buscar no guia</span>
              <input type="search" value={busca} onChange={(e) => setBusca(e.target.value.slice(0, 60))} placeholder="Buscar no guia (ex.: sangria, PIN, troco)"
                className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none focus-visible:!shadow-none [&::-webkit-search-cancel-button]:hidden" style={{ color: FIN_COR.texto }} data-testid="guia-busca" />
              {busca && (
                <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca" className="flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-[8px] hover:bg-[#F5F6F7]" style={{ color: FIN_COR.texto2 }}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            {encontradas && (
              <p className="text-[13px]" style={{ color: FIN_COR.texto2 }} aria-live="polite" data-testid="guia-resultado">
                {encontradas.size === 0 ? 'Nenhuma seção fala disso. Tente outra palavra.' : `${encontradas.size} ${encontradas.size === 1 ? 'seção encontrada' : 'seções encontradas'}.`}
              </p>
            )}
            <div className="fin-card px-3 py-3 lg:hidden">
              <p className="mb-2 px-2 text-[14px] font-semibold" style={{ color: FIN_COR.texto }}>Neste guia</p>
              {indice(true)}
            </div>
          </header>

          {SECOES.map((s) => (
            <div key={s.id} hidden={!visivel(s.id)}>
              <SecaoGuia id={s.id} titulo={s.titulo} resumo={s.resumo}>{s.corpo}</SecaoGuia>
            </div>
          ))}
          <div hidden={!visivel(FUNCIONARIOS.id)}>
            <SecaoGuia id={FUNCIONARIOS.id} titulo={FUNCIONARIOS.titulo} resumo="Uma folha para imprimir e deixar no caixa: abrir, vender, sangria, fechar, PIN e diferença.">
              <FolhaFuncionarios />
            </SecaoGuia>
          </div>
        </div>
      </div>
    </div>
  )
}
