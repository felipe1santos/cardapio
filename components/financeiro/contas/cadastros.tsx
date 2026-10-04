'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { BOTAO, Selo } from '../ui/blocos'
import { Janela } from '../apoio'
import type { Categoria, Fornecedor } from './secao-contas'

/** Plano de contas e fornecedores (Fase 5b). Nada se apaga: desativa. */
type Toast = (tom: 'ok' | 'erro', t: string) => void
const CAMPO = 'h-[40px] w-full rounded-[3px] border border-border bg-white px-2.5 text-[14px] outline-none focus:border-primary'
const ROT = 'mb-[4px] block text-[11px] font-bold uppercase tracking-wide text-text-subtle'
const ROT_GRUPO: Record<Categoria['grupo'], string> = {
  despesa: 'Despesa (entra no DRE)', insumo: 'Insumo/embalagem (já está no CMV)', receita: 'Receita (entra no DRE)', fora: 'Capital (fora do DRE)',
}

async function salvar(corpo: Record<string, unknown>) {
  const r = await fetch('/api/admin/financeiro/contas/cadastros', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, erro: j.error as string | undefined }
}

export function SecaoCadastros({ categorias, fornecedores, podeEditar, toast, onMudou }: { categorias: Categoria[]; fornecedores: Fornecedor[]; podeEditar: boolean; toast: Toast; onMudou: () => void }) {
  const [cat, setCat] = useState<Partial<Categoria> | null>(null)
  const [forn, setForn] = useState<Partial<Fornecedor> | null>(null)

  async function alternarCat(c: Categoria) {
    const r = await salvar({ cadastro: 'categoria', id: c.id, nome: c.nome, tipo: c.tipo, grupo: c.grupo, ativo: !c.ativo })
    if (!r.ok) toast('erro', r.erro ?? 'Não foi possível.'); else onMudou()
  }
  async function alternarForn(f: Fornecedor) {
    const r = await salvar({ cadastro: 'fornecedor', id: f.id, nome: f.nome, documento: f.documento, telefone: f.telefone, observacao: f.observacao, ativo: !f.ativo })
    if (!r.ok) toast('erro', r.erro ?? 'Não foi possível.'); else onMudou()
  }

  const bloco = 'rounded-[6px] border border-border bg-white'
  const linha = 'flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-[13px] last:border-b-0'
  return (
    <div className="grid gap-3 lg:grid-cols-2" data-testid="secao-cadastros">
      <section className={bloco}>
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <b className="text-[13px]">Plano de contas</b>
          {podeEditar && <button type="button" className={BOTAO.neutro} onClick={() => setCat({ tipo: 'pagar', grupo: 'despesa' })} data-testid="categoria-nova"><Plus className="h-4 w-4" /> Categoria</button>}
        </div>
        {(['pagar', 'receber'] as const).map((t) => (
          <div key={t}>
            <p className="bg-[#F6F7F9] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-text-subtle">{t === 'pagar' ? 'Saídas' : 'Entradas'}</p>
            {categorias.filter((c) => c.tipo === t).map((c) => (
              <div key={c.id} className={linha} data-testid="categoria-linha" data-nome={c.nome}>
                <span className="min-w-0"><b className={c.ativo ? '' : 'text-text-subtle line-through'}>{c.nome}</b><span className="block text-[11.5px] text-text-subtle">{ROT_GRUPO[c.grupo]}</span></span>
                {podeEditar && (
                  <span className="flex gap-1.5">
                    <button type="button" className="text-[11.5px] font-semibold uppercase text-[#0369A1]" onClick={() => setCat(c)}>Editar</button>
                    <button type="button" className="text-[11.5px] font-semibold uppercase text-text-subtle" onClick={() => void alternarCat(c)}>{c.ativo ? 'Desativar' : 'Reativar'}</button>
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </section>
      <section className={bloco}>
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <b className="text-[13px]">Fornecedores</b>
          {podeEditar && <button type="button" className={BOTAO.neutro} onClick={() => setForn({})} data-testid="fornecedor-novo"><Plus className="h-4 w-4" /> Fornecedor</button>}
        </div>
        {fornecedores.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-text-subtle">Nenhum fornecedor cadastrado.</p>}
        {fornecedores.map((f) => (
          <div key={f.id} className={linha} data-testid="fornecedor-linha" data-nome={f.nome}>
            <span className="min-w-0"><b className={f.ativo ? '' : 'text-text-subtle line-through'}>{f.nome}</b>{(f.documento || f.telefone) && <span className="block text-[11.5px] text-text-subtle">{[f.documento, f.telefone].filter(Boolean).join(' · ')}</span>}</span>
            <span className="flex items-center gap-1.5">
              {!f.ativo && <Selo cor="#4B5563">Inativo</Selo>}
              {podeEditar && <button type="button" className="text-[11.5px] font-semibold uppercase text-[#0369A1]" onClick={() => setForn(f)}>Editar</button>}
              {podeEditar && <button type="button" className="text-[11.5px] font-semibold uppercase text-text-subtle" onClick={() => void alternarForn(f)}>{f.ativo ? 'Desativar' : 'Reativar'}</button>}
            </span>
          </div>
        ))}
      </section>

      {cat && <FormCategoria inicial={cat} onFechar={() => setCat(null)} onSalvou={() => { setCat(null); onMudou() }} toast={toast} />}
      {forn && <FormFornecedor inicial={forn} onFechar={() => setForn(null)} onSalvou={() => { setForn(null); onMudou() }} toast={toast} />}
    </div>
  )
}

function FormCategoria({ inicial, onFechar, onSalvou, toast }: { inicial: Partial<Categoria>; onFechar: () => void; onSalvou: () => void; toast: Toast }) {
  const [nome, setNome] = useState(inicial.nome ?? '')
  const [tipo, setTipo] = useState<Categoria['tipo']>(inicial.tipo ?? 'pagar')
  const [grupo, setGrupo] = useState<Categoria['grupo']>(inicial.grupo ?? 'despesa')
  const grupos: Categoria['grupo'][] = tipo === 'pagar' ? ['despesa', 'insumo'] : ['receita', 'fora']
  return (
    <Janela titulo={inicial.id ? 'Editar categoria' : 'Nova categoria'} onFechar={onFechar} testid="form-categoria">
      <div className="grid gap-3">
        <label><span className={ROT}>Nome</span><input className={CAMPO} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} data-testid="categoria-nome" /></label>
        {!inicial.id && (
          <label><span className={ROT}>Tipo</span>
            <select className={CAMPO} value={tipo} onChange={(e) => { const t = e.target.value as Categoria['tipo']; setTipo(t); setGrupo(t === 'pagar' ? 'despesa' : 'receita') }}><option value="pagar">Saída (a pagar)</option><option value="receber">Entrada (a receber)</option></select>
          </label>
        )}
        <label><span className={ROT}>Como entra no DRE</span>
          <select className={CAMPO} value={grupo} onChange={(e) => setGrupo(e.target.value as Categoria['grupo'])} data-testid="categoria-grupo">{grupos.map((g) => <option key={g} value={g}>{ROT_GRUPO[g]}</option>)}</select>
        </label>
        <button type="button" className={BOTAO.primario} disabled={nome.trim().length < 2} data-testid="categoria-salvar"
          onClick={async () => { const r = await salvar({ cadastro: 'categoria', id: inicial.id, nome, tipo, grupo }); if (!r.ok) toast('erro', r.erro ?? 'Não foi possível.'); else { toast('ok', 'Categoria salva.'); onSalvou() } }}>Salvar</button>
      </div>
    </Janela>
  )
}

function FormFornecedor({ inicial, onFechar, onSalvou, toast }: { inicial: Partial<Fornecedor>; onFechar: () => void; onSalvou: () => void; toast: Toast }) {
  const [nome, setNome] = useState(inicial.nome ?? '')
  const [documento, setDocumento] = useState(inicial.documento ?? '')
  const [telefone, setTelefone] = useState(inicial.telefone ?? '')
  const [observacao, setObservacao] = useState(inicial.observacao ?? '')
  return (
    <Janela titulo={inicial.id ? 'Editar fornecedor' : 'Novo fornecedor'} onFechar={onFechar} testid="form-fornecedor">
      <div className="grid gap-3">
        <label><span className={ROT}>Nome</span><input className={CAMPO} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} data-testid="fornecedor-nome" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label><span className={ROT}>CNPJ/CPF</span><input className={CAMPO} value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={20} /></label>
          <label><span className={ROT}>Telefone</span><input className={CAMPO} value={telefone} onChange={(e) => setTelefone(e.target.value)} maxLength={20} /></label>
        </div>
        <label><span className={ROT}>Observação</span><input className={CAMPO} value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={300} /></label>
        <button type="button" className={BOTAO.primario} disabled={nome.trim().length < 2} data-testid="fornecedor-salvar"
          onClick={async () => { const r = await salvar({ cadastro: 'fornecedor', id: inicial.id, nome, documento, telefone, observacao, ativo: inicial.ativo }); if (!r.ok) toast('erro', r.erro ?? 'Não foi possível.'); else { toast('ok', 'Fornecedor salvo.'); onSalvou() } }}>Salvar</button>
      </div>
    </Janela>
  )
}
