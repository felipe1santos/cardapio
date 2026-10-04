'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { CartaoNumero } from '@/components/admin/cartao-numero'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'
import { ICONES } from '@/lib/icones-painel'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { ARREDONDAMENTOS, type Arredondamento } from '@/lib/financeiro/cmv-regras'
import { ATALHOS, periodoDoAtalho } from '@/lib/financeiro/fluxo-regras'
import { BOTAO, Chip, PainelLateral, Selo } from '../ui/blocos'
import { FichaCusto, type AlvoFicha } from './ficha-custo'
import { SecaoInsumos, type InsumoCompleto } from './insumos'

/**
 * Financeiro › Precificação / CMV (Fase 5). Custos só aparecem para quem tem "Ver custos e margens".
 * O preço NUNCA muda sozinho: só pelo botão "Aplicar novo preço" com confirmação (antigo × novo).
 */
interface Linha {
  chave: string; itemId: string; nome: string; variante: string | null; categoria: string; grupoId: string | null; foto: string | null; status: string
  alvo: { tipo: 'item' | 'tamanho' | 'sabor'; id: string; tamanhoId: string | null }
  precoCentavos: number; custoCentavos: number | null; lucroCentavos: number | null; margemPct: number | null; margemBaixa: boolean; temFicha: boolean
  custoManualCentavos: number | null; margemAlvoPct: number; sugestaoCentavos: number | null
}
interface Dados {
  linhas: Linha[]; resumo: { total: number; comFicha: number; semFicha: number; margemBaixa: number; margemMediaPct: number | null }
  config: { margemAlvoPct: number; margemBaixaPct: number; custosVariaveisPct: number; arredondamento: Arredondamento; porCategoria: Record<string, number> }
  categorias: { id: string; nome: string }[]; pode: { editar: boolean; aplicarPreco: boolean; exportar: boolean }
}
type Aba = 'precos' | 'insumos' | 'vendas' | 'config'
type Ordem = 'nome' | 'margem' | 'lucro' | 'custo' | 'preco'

const brl = (c: number | null | undefined) => (c === null || c === undefined ? '—' : formatarCentavos(c))
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1).replace('.', ',')}%`)
const ROT_STATUS: Record<string, string> = { disponivel: 'Ativo', pausado: 'Pausado', esgotado: 'Esgotado' }

export function SecaoCmv() {
  const toasts = useToasts()
  const toast = toasts.mostrar
  const [aba, setAba] = useState<Aba>('precos')
  const [d, setD] = useState<Dados | null>(null)
  const [insumos, setInsumos] = useState<InsumoCompleto[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState('')
  const [status, setStatus] = useState('')
  const [soSemFicha, setSoSemFicha] = useState(false)
  const [soMargemBaixa, setSoMargemBaixa] = useState(false)
  const [ordem, setOrdem] = useState<Ordem>('margem')
  const [ficha, setFicha] = useState<AlvoFicha | null>(null)
  const [aplicar, setAplicar] = useState<Linha | null>(null)

  const carregar = useCallback(async () => {
    const [r1, r2] = await Promise.all([fetch('/api/admin/financeiro/cmv', { cache: 'no-store' }), fetch('/api/admin/financeiro/cmv/insumos', { cache: 'no-store' })])
    const j1 = await r1.json().catch(() => ({})), j2 = await r2.json().catch(() => ({}))
    if (!r1.ok) { setErro(j1.error ?? 'Não foi possível abrir.'); return }
    setErro(null); setD(j1); setInsumos(j2.insumos ?? [])
  }, [])
  useEffect(() => { void carregar() }, [carregar])

  const lista = useMemo(() => {
    if (!d) return []
    const q = busca.trim().toLowerCase()
    const r = d.linhas.filter((l) => (!q || `${l.nome} ${l.variante ?? ''}`.toLowerCase().includes(q)) && (!categoria || l.grupoId === categoria)
      && (!status || l.status === status) && (!soSemFicha || !l.temFicha) && (!soMargemBaixa || l.margemBaixa))
    const val = (l: Linha): number | string => ordem === 'nome' ? l.nome.toLowerCase() : ordem === 'margem' ? (l.margemPct ?? 1e9) : ordem === 'lucro' ? (l.lucroCentavos ?? -1e12) : ordem === 'custo' ? (l.custoCentavos ?? -1) : l.precoCentavos
    return r.sort((a, b) => { const va = val(a), vb = val(b); const c = typeof va === 'string' ? va.localeCompare(vb as string, 'pt-BR') : (va as number) - (vb as number); return ordem === 'nome' || ordem === 'margem' ? c : -c })
  }, [d, busca, categoria, status, soSemFicha, soMargemBaixa, ordem])

  async function exportar() {
    const r = await fetch('/api/admin/financeiro/cmv/exportar', { cache: 'no-store' })
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('erro', j.error ?? 'Não foi possível exportar.'); return }
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'precificacao.csv'; document.body.appendChild(a); a.click(); a.remove()
  }

  const abrirFicha = (l: Linha) => setFicha({ tipo: l.alvo.tipo, id: l.alvo.id, tamanhoId: l.alvo.tamanhoId, titulo: `${l.nome}${l.variante ? ` · ${l.variante}` : ''}`, precoCentavos: l.precoCentavos })
  const corMargem = (l: Linha) => (l.margemPct === null ? '#4B5563' : l.margemBaixa ? '#B91C1C' : '#15803D')

  return (
    <div className="flex flex-col gap-3" data-testid="secao-cmv">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]" role="tablist">
        {([['precos', 'Precificação'], ['insumos', 'Insumos'], ['vendas', 'CMV das vendas'], ['config', 'Margens e preço']] as [Aba, string][]).map(([id, r]) => (
          <Chip key={id} ativo={aba === id} onClick={() => setAba(id)} testid={`cmv-aba-${id}`}>{r}</Chip>
        ))}
      </div>
      {erro && <p role="alert" className="rounded-[4px] bg-[#FEE2E2] px-3 py-2 text-[13px] font-medium text-[#B91C1C]" data-testid="cmv-erro">{erro}</p>}

      {aba === 'precos' && d && (
        <>
          <div className="grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2 lg:grid-cols-4" data-testid="cmv-resumo">
            <CartaoNumero icone={ICONES.concluido} tom="verde" rotulo="Com ficha de custo" valor={<span data-testid="cmv-com-ficha">{d.resumo.comFicha}</span>} />
            <CartaoNumero icone={ICONES.aviso} tom="ambar" rotulo="Sem ficha" valor={<span data-testid="cmv-sem-ficha">{d.resumo.semFicha}</span>} />
            <CartaoNumero icone={ICONES.subindo} tom="azul" rotulo="Margem média" valor={<span data-testid="cmv-margem-media">{pct(d.resumo.margemMediaPct)}</span>} />
            <CartaoNumero icone={ICONES.caindo} tom="vermelho" rotulo={`Margem baixa (< ${d.config.margemBaixaPct}%)`} valor={<span data-testid="cmv-margem-baixa">{d.resumo.margemBaixa}</span>} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto" className="h-[38px] w-full max-w-[260px] rounded-[4px] border border-border px-2.5 text-[13px]" data-testid="cmv-busca" />
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="h-[38px] rounded-[4px] border border-border bg-white px-2 text-[13px]" data-testid="cmv-categoria">
              <option value="">Todas as categorias</option>{d.categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-[38px] rounded-[4px] border border-border bg-white px-2 text-[13px]" data-testid="cmv-status">
              <option value="">Todos os status</option><option value="disponivel">Ativos</option><option value="pausado">Pausados</option><option value="esgotado">Esgotados</option>
            </select>
            <Chip ativo={soSemFicha} onClick={() => setSoSemFicha((v) => !v)} testid="cmv-filtro-sem-ficha">Sem ficha</Chip>
            <Chip ativo={soMargemBaixa} onClick={() => setSoMargemBaixa((v) => !v)} testid="cmv-filtro-margem-baixa">Margem baixa</Chip>
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} className="h-[38px] rounded-[4px] border border-border bg-white px-2 text-[13px]" data-testid="cmv-ordem" aria-label="Ordenar">
              <option value="margem">Menor margem primeiro</option><option value="lucro">Maior lucro</option><option value="custo">Maior custo</option><option value="preco">Maior preço</option><option value="nome">Nome</option>
            </select>
            {d.pode.exportar && <button type="button" className={`${BOTAO.neutro} ml-auto`} onClick={() => void exportar()} data-testid="cmv-csv"><Download className="h-4 w-4" /> CSV</button>}
          </div>

          {/* Computador */}
          <div className="hidden overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white md:block">
            <div className="max-h-[calc(100dvh-360px)] min-h-[200px] overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-[13px]" data-testid="cmv-tabela">
                <thead className="sticky top-0 z-[2] bg-[#F6F7F9] text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                  <tr className="[&>th]:border-b [&>th]:border-border">
                    <th className="px-3 py-2.5">Produto</th><th className="px-3 py-2.5">Categoria</th><th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Preço</th><th className="px-3 py-2.5 text-right">Custo</th><th className="px-3 py-2.5 text-right">Lucro</th>
                    <th className="px-3 py-2.5 text-right">Margem</th><th className="px-3 py-2.5 text-right">Sugerido</th><th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {lista.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-text-subtle">Nenhum produto com esses filtros.</td></tr>}
                  {lista.map((l) => (
                    <tr key={l.chave} className="align-middle [&>td]:border-b [&>td]:border-border hover:[&>td]:bg-[#F9FAFB]" data-testid="cmv-linha" data-chave={l.chave} data-nome={`${l.nome}${l.variante ? ` · ${l.variante}` : ''}`}>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {l.foto ? <img src={l.foto} alt="" className="h-9 w-9 flex-shrink-0 rounded-[4px] object-cover" /> : <span className="h-9 w-9 flex-shrink-0 rounded-[4px] bg-page" />}
                          <span className="min-w-0"><b className="block truncate">{l.nome}</b>{l.variante && <span className="block truncate text-[12px] text-text-subtle">{l.variante}</span>}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-subtle">{l.categoria}</td>
                      <td className="px-3 py-2">{l.status === 'disponivel' ? <Selo cor="#15803D">Ativo</Selo> : <Selo cor="#4B5563">{ROT_STATUS[l.status] ?? l.status}</Selo>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{brl(l.precoCentavos)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right" data-testid="cmv-custo">{l.temFicha ? brl(l.custoCentavos) : <Selo cor="#B45309" testid="cmv-sem-ficha-selo">Sem ficha</Selo>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{brl(l.lucroCentavos)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{l.margemPct === null ? '—' : <span className="inline-flex rounded-[4px] px-1.5 py-[1px] font-semibold text-white" style={{ backgroundColor: corMargem(l) }} data-testid="cmv-margem">{pct(l.margemPct)}</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right" data-testid="cmv-sugerido">{brl(l.sugestaoCentavos)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <span className="inline-flex gap-1">
                          <button type="button" className={BOTAO.neutro} onClick={() => abrirFicha(l)} data-testid="cmv-abrir-ficha">Ficha</button>
                          {d.pode.aplicarPreco && l.sugestaoCentavos && l.sugestaoCentavos !== l.precoCentavos && <button type="button" className={BOTAO.primario} onClick={() => setAplicar(l)} data-testid="cmv-aplicar">Aplicar</button>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {/* Celular */}
          <div className="flex flex-col gap-2 md:hidden" data-testid="cmv-cartoes">
            {lista.map((l) => (
              <button type="button" key={l.chave} onClick={() => abrirFicha(l)} className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-3 text-left" data-testid="cmv-cartao">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0"><b className="block truncate text-[14px]">{l.nome}</b>{l.variante && <span className="block truncate text-[12px] text-text-subtle">{l.variante}</span>}</span>
                  {l.temFicha ? <span className="rounded-[4px] px-1.5 py-[1px] text-[12px] font-semibold text-white" style={{ backgroundColor: corMargem(l) }}>{pct(l.margemPct)}</span> : <Selo cor="#B45309">Sem ficha</Selo>}
                </div>
                <p className="mt-1 text-[12.5px] text-text-subtle">Preço {brl(l.precoCentavos)} · custo {brl(l.custoCentavos)} · lucro {brl(l.lucroCentavos)}</p>
              </button>
            ))}
          </div>
        </>
      )}

      {aba === 'insumos' && d && <SecaoInsumos insumos={insumos} podeEditar={d.pode.editar} onMudou={() => void carregar()} toast={toast} />}
      {aba === 'vendas' && <CmvVendas />}
      {aba === 'config' && d && <ConfigCmv d={d} onSalvou={() => void carregar()} toast={toast} />}

      {ficha && d && <FichaCusto alvo={ficha} insumos={insumos} podeEditar={d.pode.editar} onFechar={() => setFicha(null)} onSalvou={() => void carregar()} toast={toast} />}
      {aplicar && <AplicarPreco l={aplicar} onFechar={() => setAplicar(null)} onAplicou={() => { setAplicar(null); void carregar() }} toast={toast} />}
      <PilhaToasts itens={toasts.itens} />
    </div>
  )
}

function AplicarPreco({ l, onFechar, onAplicou, toast }: { l: Linha; onFechar: () => void; onAplicou: () => void; toast: (tom: 'ok' | 'erro', t: string) => void }) {
  const [novo, setNovo] = useState(((l.sugestaoCentavos ?? l.precoCentavos) / 100).toFixed(2).replace('.', ','))
  const [enviando, setEnviando] = useState(false)
  const novoC = Math.round(Number(novo.replace(/\./g, '').replace(',', '.')) * 100)
  async function confirmar() {
    setEnviando(true)
    try {
      const r = await fetch('/api/admin/financeiro/cmv/preco', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alvo: l.alvo, precoAtualCentavos: l.precoCentavos, novoCentavos: novoC }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast('erro', j.error ?? 'Não foi possível aplicar.'); return }
      toast('ok', `Preço aplicado: ${brl(j.antigoCentavos)} → ${brl(j.novoCentavos)}. Já vale na vitrine, no PDV e nas mesas.`); onAplicou()
    } finally { setEnviando(false) }
  }
  const margemNova = l.custoCentavos !== null && novoC > 0 ? ((novoC - l.custoCentavos) / novoC) * 100 : null
  return (
    <PainelLateral titulo="Aplicar novo preço" subtitulo={`${l.nome}${l.variante ? ` · ${l.variante}` : ''}`} onFechar={onFechar} largura={520} testid="aplicar-preco"
      acoes={<><button type="button" className={BOTAO.neutro} onClick={onFechar}>Cancelar</button><button type="button" className={BOTAO.primario} disabled={enviando || !(novoC > 0) || novoC === l.precoCentavos} onClick={() => void confirmar()} data-testid="aplicar-confirmar">{enviando ? 'Aplicando…' : 'Confirmar novo preço'}</button></>}>
      <div className="grid grid-cols-2 gap-3 text-[14px]">
        <div className="rounded-[6px] border border-border p-3"><p className="text-[12px] text-text-subtle">Preço atual</p><p className="text-[20px] font-bold" data-testid="aplicar-antigo">{brl(l.precoCentavos)}</p><p className="text-[12px] text-text-subtle">margem {pct(l.margemPct)}</p></div>
        <div className="rounded-[6px] border-2 border-[#0369A1] p-3"><p className="text-[12px] text-text-subtle">Preço novo</p>
          <input value={novo} onChange={(e) => setNovo(e.target.value)} inputMode="decimal" className="h-[40px] w-full rounded-[4px] border border-border px-2 text-[18px] font-bold" data-testid="aplicar-novo" />
          <p className="text-[12px] text-text-subtle">margem {pct(margemNova)}</p></div>
      </div>
      <p className="mt-3 text-[12.5px] text-text-subtle">Sugerido pela margem-alvo de {l.margemAlvoPct}%: {brl(l.sugestaoCentavos)}. O preço só muda ao confirmar, fica na auditoria e vale para a vitrine, o PDV e as mesas.</p>
    </PainelLateral>
  )
}

function CmvVendas() {
  const [periodo, setPeriodo] = useState(periodoDoAtalho('30d'))
  const [v, setV] = useState<Record<string, number | null> | null>(null)
  useEffect(() => {
    let vivo = true
    void fetch(`/api/admin/financeiro/cmv/vendas?de=${periodo.de}&ate=${periodo.ate}`, { cache: 'no-store' }).then(async (r) => { const j = await r.json().catch(() => null); if (vivo) setV(j) })
    return () => { vivo = false }
  }, [periodo])
  return (
    <div className="flex flex-col gap-3" data-testid="cmv-vendas">
      <div className="flex flex-wrap gap-1.5">{ATALHOS.map((a) => <Chip key={a.id} ativo={periodoDoAtalho(a.id).de === periodo.de && periodoDoAtalho(a.id).ate === periodo.ate} onClick={() => setPeriodo(periodoDoAtalho(a.id))}>{a.rotulo}</Chip>)}</div>
      <div className="grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2 lg:grid-cols-4">
        <CartaoNumero icone={ICONES.dinheiro} tom="verde" rotulo="Vendido (com custo registrado)" valor={<span data-testid="vendas-vendido">{brl(v?.vendidoComCustoCentavos as number)}</span>} />
        <CartaoNumero icone={ICONES.cartao} tom="laranja" rotulo="CMV (custo guardado)" valor={<span data-testid="vendas-cmv">{brl(v?.cmvCentavos as number)}</span>} />
        <CartaoNumero icone={ICONES.subindo} tom="azul" rotulo="CMV %" valor={<span data-testid="vendas-cmv-pct">{pct((v?.cmvPct as number) ?? null)}</span>} />
        <CartaoNumero icone={ICONES.aviso} tom="ambar" rotulo="Vendas sem custo registrado" valor={<span data-testid="vendas-sem-custo">{v?.semCustoRegistrado ?? '—'}</span>} />
      </div>
      <p className="text-[12.5px] text-text-subtle">O CMV usa o custo GUARDADO no momento em que cada item foi lançado. Mudar o custo de um insumo hoje não muda o CMV das vendas antigas. Vendas anteriores à Fase 5 (ou de produto sem ficha) aparecem como “sem custo registrado”.</p>
    </div>
  )
}

function ConfigCmv({ d, onSalvou, toast }: { d: Dados; onSalvou: () => void; toast: (tom: 'ok' | 'erro', t: string) => void }) {
  const [m, setM] = useState(String(d.config.margemAlvoPct)), [b, setB] = useState(String(d.config.margemBaixaPct)), [vv, setVv] = useState(String(d.config.custosVariaveisPct))
  const [arr, setArr] = useState<Arredondamento>(d.config.arredondamento)
  const [cats, setCats] = useState<Record<string, string>>(Object.fromEntries(Object.entries(d.config.porCategoria).map(([k, x]) => [k, String(x)])))
  const n = (s: string) => Number(s.replace(',', '.'))
  async function salvar() {
    const porCategoria: Record<string, number | null> = {}
    for (const c of d.categorias) porCategoria[c.id] = cats[c.id]?.trim() ? n(cats[c.id]) : null
    const r = await fetch('/api/admin/financeiro/cmv/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ margemAlvoPct: n(m), margemBaixaPct: n(b), custosVariaveisPct: n(vv), arredondamento: arr, porCategoria }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast('erro', j.error ?? 'Não foi possível salvar.'); return }
    toast('ok', 'Margens salvas.'); onSalvou()
  }
  const campo = 'h-[38px] w-[110px] rounded-[4px] border border-border px-2 text-[14px]'
  return (
    <div className="flex max-w-[720px] flex-col gap-4 rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-4" data-testid="cmv-config">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[13px]">Margem-alvo da loja (%)<br /><input value={m} onChange={(e) => setM(e.target.value)} disabled={!d.pode.editar} className={campo} data-testid="cfg-margem-alvo" /></label>
        <label className="text-[13px]">Avisar “margem baixa” abaixo de (%)<br /><input value={b} onChange={(e) => setB(e.target.value)} disabled={!d.pode.editar} className={campo} data-testid="cfg-margem-baixa" /></label>
        <label className="text-[13px]">Custos variáveis (%) — cartão, marketplace<br /><input value={vv} onChange={(e) => setVv(e.target.value)} disabled={!d.pode.editar} className={campo} data-testid="cfg-variaveis" /></label>
        <label className="text-[13px]">Arredondamento do preço sugerido<br />
          <select value={arr} onChange={(e) => setArr(e.target.value as Arredondamento)} disabled={!d.pode.editar} className="h-[38px] rounded-[4px] border border-border bg-white px-2 text-[14px]" data-testid="cfg-arredondamento">
            {ARREDONDAMENTOS.map((a) => <option key={a.id} value={a.id}>{a.rotulo}</option>)}
          </select></label>
      </div>
      <p className="rounded-[4px] bg-page px-3 py-2 text-[13px]" data-testid="cfg-formula"><b>Fórmula:</b> preço sugerido = custo ÷ (1 − margem-alvo − custos variáveis), arredondado PARA CIMA até o final escolhido. Ex.: custo R$ 7,48, margem 65% e cartão 5% → 7,48 ÷ 0,30 = R$ 24,94 → R$ 25,90 (final ,90).</p>
      <div>
        <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-text-subtle">Margem-alvo por categoria (opcional)</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {d.categorias.map((c) => (
            <label key={c.id} className="flex items-center justify-between gap-2 text-[13px]">{c.nome}
              <input value={cats[c.id] ?? ''} onChange={(e) => setCats({ ...cats, [c.id]: e.target.value })} disabled={!d.pode.editar} placeholder={`${d.config.margemAlvoPct}`} className={campo} /></label>
          ))}
        </div>
      </div>
      {d.pode.editar && <button type="button" className={`${BOTAO.primario} self-start`} onClick={() => void salvar()} data-testid="cfg-salvar">Salvar</button>}
    </div>
  )
}
