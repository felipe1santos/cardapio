'use client'

import { useState } from 'react'
import { History, Plus, Trash2 } from 'lucide-react'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { UNIDADES_COMPRA, conversaoPadrao, type UnidadeCompra } from '@/lib/financeiro/cmv-regras'
import { BOTAO, PainelLateral, Selo } from '../ui/blocos'

/** Cadastro de insumos: compra → unidade base, aproveitamento, sub-receita e histórico de custos (append-only). */
export interface InsumoCompleto {
  id: string; nome: string; unidadeCompra: UnidadeCompra; quantidadeCompra: number; basePorUnidade: number; unidadeBase: 'g' | 'ml' | 'un'
  custoCompraCentavos: number; aproveitamentoPct: number; preparado: boolean; rendimentoBase: number | null; ativo: boolean
  componentes: { componenteId: string; quantidadeBase: number }[]; custoPorBase: number; usos: number
}

const brl = (c: number) => formatarCentavos(c)
/** Custo por unidade base legível: "R$ 0,008/g" ou "R$ 1,00/un"; por kg/L quando a base é g/ml. */
export function custoUnitarioTexto(i: Pick<InsumoCompleto, 'custoPorBase' | 'unidadeBase'>): string {
  if (i.unidadeBase === 'un') return `${brl(Math.round(i.custoPorBase))}/un`
  const por1000 = Math.round(i.custoPorBase * 1000)
  return `${brl(por1000)}/${i.unidadeBase === 'g' ? 'kg' : 'L'}`
}
const CAMPO = 'h-[40px] w-full rounded-[4px] border border-border bg-white px-2.5 text-[14px] outline-none focus:border-primary'
const ROTULO = 'mb-1 block text-[12.5px] font-semibold text-text-subtle'

export function SecaoInsumos({ insumos, podeEditar, onMudou, toast }: { insumos: InsumoCompleto[]; podeEditar: boolean; onMudou: () => void; toast: (tom: 'ok' | 'erro', t: string) => void }) {
  const [editando, setEditando] = useState<InsumoCompleto | 'novo' | null>(null)
  const [historico, setHistorico] = useState<{ nome: string; linhas: Record<string, unknown>[] } | null>(null)
  const [busca, setBusca] = useState('')
  const lista = insumos.filter((i) => !busca.trim() || i.nome.toLowerCase().includes(busca.trim().toLowerCase()))

  async function verHistorico(i: InsumoCompleto) {
    const r = await fetch(`/api/admin/financeiro/cmv/insumos/${i.id}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast('erro', j.error ?? 'Não foi possível abrir.'); return }
    setHistorico({ nome: i.nome, linhas: j.historico ?? [] })
  }
  async function ativar(i: InsumoCompleto, ativo: boolean) {
    const r = await fetch(`/api/admin/financeiro/cmv/insumos/${i.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'ativar', ativo }) })
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast('erro', j.error ?? 'Não foi possível.'); return }
    toast('ok', ativo ? 'Insumo reativado.' : 'Insumo desativado.'); onMudou()
  }

  return (
    <div className="flex flex-col gap-3" data-testid="secao-insumos">
      <div className="flex flex-wrap items-center gap-2">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo" className={`${CAMPO} max-w-[300px]`} data-testid="insumos-busca" />
        {podeEditar && <button type="button" className={`${BOTAO.primario} ml-auto`} onClick={() => setEditando('novo')} data-testid="insumo-novo"><Plus className="h-4 w-4" /> Novo insumo</button>}
      </div>
      <div className="flex flex-col divide-y divide-border overflow-hidden fin-card" data-testid="insumos-lista">
        {lista.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-text-subtle">Nenhum insumo. Cadastre o que você compra (carne, pão, embalagem…).</p>}
        {lista.map((i) => (
          <div key={i.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px] ${i.ativo ? '' : 'opacity-60'}`} data-testid="insumo-linha" data-nome={i.nome}>
            <div className="min-w-[180px] flex-1">
              <p className="font-semibold text-text-main">{i.nome} {i.preparado && <Selo cor="#7E22CE">Preparado</Selo>} {!i.ativo && <Selo cor="#465A69">Desativado</Selo>}</p>
              <p className="text-[12px] text-text-subtle">
                {i.preparado ? `Receita rende ${i.rendimentoBase} ${i.unidadeBase}` : `${brl(i.custoCompraCentavos)} por ${i.quantidadeCompra} ${UNIDADES_COMPRA.find((u) => u.id === i.unidadeCompra)?.rotulo.toLowerCase()}${conversaoPadrao(i.unidadeCompra) ? '' : ` (${i.basePorUnidade} ${i.unidadeBase} cada)`}`}
                {i.aproveitamentoPct < 100 ? ` · aproveitamento ${i.aproveitamentoPct}%` : ''} · usado em {i.usos}
              </p>
            </div>
            <span className="font-bold text-text-main" data-testid="insumo-custo">{custoUnitarioTexto(i)}</span>
            <div className="flex gap-1">
              <button type="button" className={BOTAO.neutro} onClick={() => void verHistorico(i)} data-testid="insumo-historico"><History className="h-4 w-4" /> Histórico</button>
              {podeEditar && <button type="button" className={BOTAO.neutro} onClick={() => setEditando(i)} data-testid="insumo-editar">Editar</button>}
              {podeEditar && (i.ativo
                ? <button type="button" className={BOTAO.neutro} onClick={() => void ativar(i, false)} data-testid="insumo-desativar">Desativar</button>
                : <button type="button" className={BOTAO.neutro} onClick={() => void ativar(i, true)}>Reativar</button>)}
            </div>
          </div>
        ))}
      </div>
      {editando && <FormInsumo inicial={editando === 'novo' ? null : editando} insumos={insumos} onFechar={() => setEditando(null)} onSalvou={() => { setEditando(null); onMudou() }} toast={toast} />}
      {historico && (
        <PainelLateral titulo={`Histórico de custos · ${historico.nome}`} subtitulo="Cada mudança fica registrada e não pode ser apagada." onFechar={() => setHistorico(null)} largura={620} testid="insumo-historico-painel">
          {historico.linhas.length === 0 ? <p className="text-[13px] text-text-subtle">Sem mudanças.</p> : (
            <ul className="divide-y divide-border text-[13px]">
              {historico.linhas.map((h, k) => (
                <li key={k} className="py-2" data-testid="historico-linha">
                  <b>{h.custo_antigo_centavos === null ? 'Cadastro' : `${brl(Number(h.custo_antigo_centavos))} → ${brl(Number(h.custo_novo_centavos))}`}</b>
                  <span className="text-text-subtle"> · {String(h.usuario_nome)} · {new Date(String(h.criado_em)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>
                  {h.motivo ? <p className="text-[12px] text-text-subtle">Motivo: {String(h.motivo)}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </PainelLateral>
      )}
    </div>
  )
}

function FormInsumo({ inicial, insumos, onFechar, onSalvou, toast }: { inicial: InsumoCompleto | null; insumos: InsumoCompleto[]; onFechar: () => void; onSalvou: () => void; toast: (tom: 'ok' | 'erro', t: string) => void }) {
  const [nome, setNome] = useState(inicial?.nome ?? '')
  const [unidadeCompra, setUnidadeCompra] = useState<UnidadeCompra>(inicial?.unidadeCompra ?? 'kg')
  const [quantidade, setQuantidade] = useState(String(inicial?.quantidadeCompra ?? 1))
  const [base, setBase] = useState<'g' | 'ml' | 'un'>(inicial?.unidadeBase ?? 'un')
  const [porUnidade, setPorUnidade] = useState(String(inicial?.basePorUnidade ?? ''))
  const [custo, setCusto] = useState(inicial ? (inicial.custoCompraCentavos / 100).toFixed(2).replace('.', ',') : '')
  const [aproveitamento, setAproveitamento] = useState(String(inicial?.aproveitamentoPct ?? 100))
  const [preparado, setPreparado] = useState(inicial?.preparado ?? false)
  const [rendimento, setRendimento] = useState(String(inicial?.rendimentoBase ?? ''))
  const [componentes, setComponentes] = useState(inicial?.componentes ?? [])
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const conv = conversaoPadrao(unidadeCompra)
  const outros = insumos.filter((i) => i.id !== inicial?.id && i.ativo)

  async function salvar() {
    setSalvando(true)
    try {
      const corpo = {
        acao: 'editar', nome, unidadeCompra, quantidadeCompra: Number(quantidade.replace(',', '.')), unidadeBase: conv ? conv.base : base,
        basePorUnidade: conv ? null : Number(porUnidade.replace(',', '.')), custoCompraCentavos: Math.round(Number(custo.replace(/\./g, '').replace(',', '.') || 0) * 100),
        aproveitamentoPct: Number(aproveitamento.replace(',', '.')), preparado, rendimentoBase: preparado ? Number(rendimento.replace(',', '.')) : null,
        componentes: preparado ? componentes.filter((c) => c.componenteId && c.quantidadeBase > 0) : [], motivo: motivo || null,
      }
      const r = await fetch(inicial ? `/api/admin/financeiro/cmv/insumos/${inicial.id}` : '/api/admin/financeiro/cmv/insumos', { method: inicial ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast('erro', j.error ?? 'Não foi possível salvar.'); return }
      toast('ok', inicial ? 'Insumo atualizado. Os produtos que usam ele foram recalculados.' : 'Insumo cadastrado.'); onSalvou()
    } finally { setSalvando(false) }
  }

  return (
    <PainelLateral titulo={inicial ? `Editar · ${inicial.nome}` : 'Novo insumo'} onFechar={onFechar} largura={620} testid="insumo-form"
      acoes={<><button type="button" className={BOTAO.neutro} onClick={onFechar}>Cancelar</button><button type="button" className={BOTAO.primario} disabled={salvando} onClick={() => void salvar()} data-testid="insumo-salvar">{salvando ? 'Salvando…' : 'Salvar'}</button></>}>
      <div className="flex flex-col gap-3">
        <label><span className={ROTULO}>Nome</span><input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} className={CAMPO} data-testid="insumo-nome" /></label>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={preparado} onChange={(e) => setPreparado(e.target.checked)} data-testid="insumo-preparado" /> Preparado na casa (sub-receita feita de outros insumos)</label>
        {!preparado ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className={ROTULO}>Compro por</span>
                <select value={unidadeCompra} onChange={(e) => setUnidadeCompra(e.target.value as UnidadeCompra)} className={CAMPO} data-testid="insumo-unidade">
                  {UNIDADES_COMPRA.map((u) => <option key={u.id} value={u.id}>{u.rotulo}</option>)}
                </select></label>
              <label><span className={ROTULO}>Quantidade comprada</span><input value={quantidade} onChange={(e) => setQuantidade(e.target.value)} inputMode="decimal" className={CAMPO} data-testid="insumo-quantidade" /></label>
              <label><span className={ROTULO}>Custo da compra (R$)</span><input value={custo} onChange={(e) => setCusto(e.target.value)} inputMode="decimal" placeholder="0,00" className={CAMPO} data-testid="insumo-custo-compra" /></label>
            </div>
            {conv ? (
              <p className="text-[12.5px] text-text-subtle">Conversão automática: 1 {unidadeCompra} = {conv.fator} {conv.base}.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label><span className={ROTULO}>Cada {unidadeCompra} vem com</span><input value={porUnidade} onChange={(e) => setPorUnidade(e.target.value)} inputMode="decimal" placeholder="ex.: 24" className={CAMPO} data-testid="insumo-por-unidade" /></label>
                <label><span className={ROTULO}>Unidade base</span>
                  <select value={base} onChange={(e) => setBase(e.target.value as 'g' | 'ml' | 'un')} className={CAMPO} data-testid="insumo-base">
                    <option value="un">unidades</option><option value="g">gramas (g)</option><option value="ml">mililitros (ml)</option>
                  </select></label>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className={ROTULO}>A receita rende</span><input value={rendimento} onChange={(e) => setRendimento(e.target.value)} inputMode="decimal" className={CAMPO} data-testid="insumo-rendimento" /></label>
              <label><span className={ROTULO}>Unidade base</span>
                <select value={base} onChange={(e) => { setBase(e.target.value as 'g' | 'ml' | 'un'); setUnidadeCompra(e.target.value === 'g' ? 'g' : e.target.value === 'ml' ? 'ml' : 'un') }} className={CAMPO}>
                  <option value="g">gramas (g)</option><option value="ml">mililitros (ml)</option><option value="un">unidades</option>
                </select></label>
            </div>
            <p className="text-[12.5px] font-semibold text-text-subtle">Ingredientes da receita</p>
            {componentes.map((c, k) => (
              <div key={k} className="flex items-center gap-2">
                <select value={c.componenteId} onChange={(e) => setComponentes(componentes.map((x, i) => (i === k ? { ...x, componenteId: e.target.value } : x)))} className={CAMPO}>
                  <option value="">Escolha…</option>{outros.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
                <input type="number" min="0" step="any" value={c.quantidadeBase || ''} onChange={(e) => setComponentes(componentes.map((x, i) => (i === k ? { ...x, quantidadeBase: Number(e.target.value) } : x)))} className={`${CAMPO} w-[120px]`} />
                <button type="button" aria-label="Tirar" onClick={() => setComponentes(componentes.filter((_, i) => i !== k))} className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-[4px] text-[#D93616] hover:bg-[#FCEBE7]"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <button type="button" className={BOTAO.neutro} onClick={() => setComponentes([...componentes, { componenteId: '', quantidadeBase: 0 }])}><Plus className="h-4 w-4" /> Ingrediente</button>
          </>
        )}
        <label><span className={ROTULO}>Aproveitamento (%)</span><input value={aproveitamento} onChange={(e) => setAproveitamento(e.target.value)} inputMode="decimal" className={`${CAMPO} max-w-[140px]`} data-testid="insumo-aproveitamento" />
          <span className="mt-1 block text-[12px] text-text-subtle">Ex.: tomate com 85% de aproveitamento — o custo real por grama sobe (custo ÷ 0,85).</span></label>
        {inicial && <label><span className={ROTULO}>Motivo da mudança de custo (opcional)</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="ex.: fornecedor reajustou" className={CAMPO} data-testid="insumo-motivo" /></label>}
      </div>
    </PainelLateral>
  )
}
