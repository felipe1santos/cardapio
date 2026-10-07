'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { centavos, custoFicha, margemPct } from '@/lib/financeiro/cmv-regras'
import { BOTAO, PainelLateral } from '../ui/blocos'

/**
 * Ficha de custo de um alvo (item, tamanho, sabor×tamanho, adicional, borda, massa). Mostra o custo de cada
 * componente, o CMV, o lucro bruto e a margem. Custos só vêm do servidor (permissão "ver custos").
 */
export interface InsumoTela { id: string; nome: string; unidadeBase: 'g' | 'ml' | 'un'; custoPorBase: number; ativo: boolean }
export interface AlvoFicha { tipo: 'item' | 'tamanho' | 'sabor' | 'complemento' | 'borda' | 'massa'; id: string; tamanhoId: string | null; titulo: string; precoCentavos: number }
interface Extra { tipo: AlvoFicha['tipo']; id: string; nome: string; precoCentavos: number; custoCentavos: number | null }

const UN: Record<string, string> = { g: 'g', ml: 'ml', un: 'un' }
const brl = (c: number | null | undefined) => (c === null || c === undefined ? '—' : formatarCentavos(c))

export function FichaCusto({ alvo, insumos, podeEditar, onFechar, onSalvou, toast }: {
  alvo: AlvoFicha; insumos: InsumoTela[]; podeEditar: boolean; onFechar: () => void; onSalvou: () => void; toast: (tom: 'ok' | 'erro', t: string) => void
}) {
  const [atual, setAtual] = useState<AlvoFicha>(alvo)
  const [linhas, setLinhas] = useState<{ insumoId: string; quantidadeBase: number }[] | null>(null)
  const [extras, setExtras] = useState<Extra[]>([])
  const [temPreparo, setTemPreparo] = useState(false)
  const [itemId, setItemId] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setLinhas(null); setAviso(null)
    const q = new URLSearchParams({ tipo: atual.tipo, id: atual.id, ...(atual.tamanhoId ? { tamanho: atual.tamanhoId } : {}) })
    void fetch(`/api/admin/financeiro/cmv/ficha?${q}`, { cache: 'no-store' }).then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (!vivo) return
      if (!r.ok) { toast('erro', j.error ?? 'Não foi possível abrir a ficha.'); return }
      setLinhas(j.componentes ?? []); setExtras(j.extras ?? []); setTemPreparo(!!j.temFichaPreparo); setItemId(j.itemId ?? null)
    })
    return () => { vivo = false }
  }, [atual, toast])

  const ins = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos])
  const custo = linhas ? centavos(custoFicha(linhas.map((l) => ({ quantidadeBase: l.quantidadeBase || 0, custoPorBase: ins.get(l.insumoId)?.custoPorBase ?? 0 })))) : null
  const margem = custo === null ? null : margemPct(atual.precoCentavos, custo)

  async function importar() {
    if (!itemId) return
    const r = await fetch(`/api/admin/financeiro/cmv/ficha/importar?itemId=${itemId}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast('erro', j.error ?? 'Não foi possível importar.'); return }
    const sug = (j.ingredientes ?? []) as { nome: string; quantidadeTexto: string; insumoId: string | null; quantidadeBase: number | null }[]
    const novas = sug.filter((s) => s.insumoId && !(linhas ?? []).some((l) => l.insumoId === s.insumoId)).map((s) => ({ insumoId: s.insumoId!, quantidadeBase: s.quantidadeBase ?? 0 }))
    const semInsumo = sug.filter((s) => !s.insumoId).map((s) => s.nome)
    setLinhas([...(linhas ?? []), ...novas])
    setAviso(semInsumo.length ? `Sem insumo cadastrado com o mesmo nome (cadastre em Insumos): ${semInsumo.join(', ')}.` : 'Ingredientes importados. Confira as quantidades e salve — a ficha de custo fica independente da ficha de preparo.')
  }

  async function salvar() {
    if (!linhas) return
    setSalvando(true)
    try {
      const r = await fetch('/api/admin/financeiro/cmv/ficha', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: atual.tipo, id: atual.id, tamanho: atual.tamanhoId, componentes: linhas.filter((l) => l.insumoId && l.quantidadeBase > 0) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast('erro', j.error ?? 'Não foi possível salvar.'); return }
      toast('ok', 'Ficha de custo salva.'); onSalvou()
    } finally { setSalvando(false) }
  }

  const ativos = insumos.filter((i) => i.ativo)
  return (
    <PainelLateral titulo={`Ficha de custo · ${atual.titulo}`} subtitulo={`Preço de venda ${brl(atual.precoCentavos)}`} onFechar={onFechar} largura={760} testid="ficha-custo"
      acoes={<>
        {atual.tipo !== alvo.tipo || atual.id !== alvo.id ? <button type="button" className={BOTAO.neutro} onClick={() => setAtual(alvo)}>← {alvo.titulo}</button> : null}
        {podeEditar && temPreparo && (atual.tipo === 'item' || atual.tipo === 'tamanho' || atual.tipo === 'sabor') && <button type="button" className={BOTAO.neutro} onClick={() => void importar()} data-testid="importar-preparo"><Download className="h-4 w-4" /> Importar da ficha de preparo</button>}
        {podeEditar && <button type="button" className={BOTAO.primario} disabled={salvando || !linhas} onClick={() => void salvar()} data-testid="ficha-salvar">{salvando ? 'Salvando…' : 'Salvar ficha'}</button>}
      </>}>
      {!linhas ? <p className="text-[13px] text-text-subtle">Carregando…</p> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="ficha-resumo">
            {[['CMV (custo)', brl(custo), 'ficha-cmv'], ['Preço', brl(atual.precoCentavos), ''], ['Lucro bruto', custo === null ? '—' : brl(atual.precoCentavos - custo), 'ficha-lucro'], ['Margem', margem === null ? '—' : `${margem.toFixed(1).replace('.', ',')}%`, 'ficha-margem']].map(([r, v, t]) => (
              <div key={r} className="fin-card px-3 py-2"><p className="text-[11.5px] text-text-subtle">{r}</p><p className="text-[17px] font-semibold" data-testid={t || undefined}>{v}</p></div>
            ))}
          </div>
          {aviso && <p className="mb-3 fin-card border-l-[3px] !border-l-[#CBD2D9] px-4 py-2.5 text-[13px] text-[#1C2B33]" data-testid="ficha-aviso">{aviso}</p>}
          <table className="w-full text-[13px]" data-testid="ficha-componentes">
            <thead><tr className="border-b border-border text-left text-[12.5px] font-semibold text-text-subtle"><th className="py-2 pr-2">Insumo</th><th className="w-[120px] py-2 pr-2">Quantidade</th><th className="w-[90px] py-2 pr-2 text-right">Custo</th><th className="w-[36px]" /></tr></thead>
            <tbody>
              {linhas.map((l, i) => {
                const it = ins.get(l.insumoId)
                return (
                  <tr key={i} className="border-b border-border" data-testid="ficha-componente">
                    <td className="py-1.5 pr-2">
                      <select value={l.insumoId} disabled={!podeEditar} onChange={(e) => setLinhas(linhas.map((x, k) => (k === i ? { ...x, insumoId: e.target.value } : x)))} className="h-[36px] w-full rounded-[4px] border border-border bg-white px-2" data-testid="ficha-insumo">
                        <option value="">Escolha…</option>
                        {ativos.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                        {it && !it.ativo && <option value={it.id}>{it.nome} (desativado)</option>}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="flex items-center gap-1">
                        <input type="number" min="0" step="any" value={l.quantidadeBase || ''} disabled={!podeEditar} onChange={(e) => setLinhas(linhas.map((x, k) => (k === i ? { ...x, quantidadeBase: Number(e.target.value) } : x)))}
                          className="h-[36px] w-full rounded-[4px] border border-border px-2 text-right" data-testid="ficha-qtd" />
                        <span className="w-[22px] text-[12px] text-text-subtle">{it ? UN[it.unidadeBase] : ''}</span>
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right font-semibold" data-testid="ficha-custo-linha">{it ? brl(centavos((l.quantidadeBase || 0) * it.custoPorBase)) : '—'}</td>
                    <td className="py-1.5">{podeEditar && <button type="button" aria-label="Tirar" onClick={() => setLinhas(linhas.filter((_, k) => k !== i))} className="flex h-[32px] w-[32px] items-center justify-center rounded-[4px] text-[#D93616] hover:bg-[#FCEBE7]"><Trash2 className="h-4 w-4" /></button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {podeEditar && <button type="button" className={`${BOTAO.neutro} mt-2`} onClick={() => setLinhas([...linhas, { insumoId: '', quantidadeBase: 0 }])} data-testid="ficha-adicionar"><Plus className="h-4 w-4" /> Adicionar insumo</button>}
          {linhas.length === 0 && <p className="mt-2 text-[12.5px] text-text-subtle">Sem componentes ainda: escolha os insumos e a quantidade usada (na unidade base: g, ml ou unidade).</p>}

          {extras.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-[13px] font-semibold text-text-subtle">{atual.tipo === 'sabor' ? 'Adicionais, bordas e massas' : 'Adicionais deste produto'} (ficha própria)</p>
              <div className="flex flex-col divide-y divide-border rounded-[6px] border border-border" data-testid="ficha-extras">
                {extras.map((x) => (
                  <button key={`${x.tipo}:${x.id}`} type="button" onClick={() => setAtual({ tipo: x.tipo, id: x.id, tamanhoId: null, titulo: x.nome, precoCentavos: x.precoCentavos })}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-page" data-testid="ficha-extra">
                    <span className="min-w-0 truncate">{x.nome}</span>
                    <span className="flex-shrink-0 text-text-subtle">preço {brl(x.precoCentavos)} · custo {x.custoCentavos === null ? <b className="text-[#8A4B00]">sem ficha</b> : <b className="text-text-main">{brl(x.custoCentavos)}</b>}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </PainelLateral>
  )
}
